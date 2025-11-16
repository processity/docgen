/**
 * Salesforce File Upload & Linking Module (T-12)
 *
 * Handles:
 * - ContentVersion upload (PDF/DOCX files)
 * - ContentDocumentLink creation (linking files to parent records)
 * - Generated_Document__c updates (status tracking)
 * - Orchestration of upload + link + update flow
 */

import type { SalesforceApi } from './api';
import type {
  ContentVersionCreateRequest,
  ContentVersionCreateResponse,
  ContentVersionRecord,
  ContentDocumentLinkCreateRequest,
  ContentDocumentLinkCreateResponse,
  GeneratedDocumentUpdateFields,
  DocgenRequest,
  DocgenParents,
  FileUploadResult,
  CorrelationOptions,
} from '../types';

/**
 * Upload a file (PDF or DOCX) to Salesforce as a ContentVersion
 *
 * @param buffer - File content as Buffer
 * @param fileName - Full filename with extension (e.g., "Invoice_12345.pdf")
 * @param api - Salesforce API client instance
 * @param options - Optional correlation tracking
 * @returns ContentVersionId and ContentDocumentId
 *
 * @throws Error if upload fails or ContentDocumentId cannot be retrieved
 */
export async function uploadContentVersion(
  buffer: Buffer,
  fileName: string,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<{ contentVersionId: string; contentDocumentId: string }> {
  // Extract title from filename (remove extension)
  const title = fileName.replace(/\.(pdf|docx)$/i, '');

  // Prepare ContentVersion creation payload
  const payload: ContentVersionCreateRequest = {
    Title: title,
    PathOnClient: fileName,
    VersionData: buffer.toString('base64'), // Salesforce requires base64-encoded binary
  };

  // Create ContentVersion
  const createResponse = await api.post<ContentVersionCreateResponse>(
    '/services/data/v59.0/sobjects/ContentVersion',
    payload,
    options
  );

  if (!createResponse.success || !createResponse.id) {
    throw new Error(
      `ContentVersion creation failed: ${JSON.stringify(createResponse.errors)}`
    );
  }

  const contentVersionId = createResponse.id;

  // Query to get ContentDocumentId (needed for linking)
  // ContentVersion.ContentDocumentId is populated after creation
  const query = `SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${contentVersionId}' LIMIT 1`;
  const queryResponse = await api.get<{ records: ContentVersionRecord[] }>(
    `/services/data/v59.0/query?q=${encodeURIComponent(query)}`,
    options
  );

  if (!queryResponse.records || queryResponse.records.length === 0) {
    throw new Error(
      `ContentVersion created but not found in query: ${contentVersionId}`
    );
  }

  const contentDocumentId = queryResponse.records[0].ContentDocumentId;

  if (!contentDocumentId) {
    throw new Error(
      `ContentDocumentId not populated for ContentVersion: ${contentVersionId}`
    );
  }

  return {
    contentVersionId,
    contentDocumentId,
  };
}

/**
 * Create a ContentDocumentLink to link a file to a parent record
 *
 * @param contentDocumentId - ContentDocument ID to link
 * @param linkedEntityId - Parent record ID (Account, Opportunity, Case, etc.)
 * @param api - Salesforce API client instance
 * @param options - Optional correlation tracking
 * @returns ContentDocumentLink ID
 *
 * @throws Error if link creation fails
 */
export async function createContentDocumentLink(
  contentDocumentId: string,
  linkedEntityId: string,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<string> {
  const payload: ContentDocumentLinkCreateRequest = {
    ContentDocumentId: contentDocumentId,
    LinkedEntityId: linkedEntityId,
    ShareType: 'V', // Viewer permission
    Visibility: 'AllUsers', // Visible to all users
  };

  const response = await api.post<ContentDocumentLinkCreateResponse>(
    '/services/data/v59.0/sobjects/ContentDocumentLink',
    payload,
    options
  );

  if (!response.success || !response.id) {
    throw new Error(
      `ContentDocumentLink creation failed for ${linkedEntityId}: ${JSON.stringify(
        response.errors
      )}`
    );
  }

  return response.id;
}

/**
 * Create ContentDocumentLinks for all non-null parent IDs
 *
 * This function filters out null/undefined parents and creates links only for valid IDs.
 * Per T-12 requirements, link failures are non-fatal (logged but don't throw).
 *
 * @param contentDocumentId - ContentDocument ID to link
 * @param parents - Parent record IDs (Account, Opportunity, Case)
 * @param api - Salesforce API client instance
 * @param options - Optional correlation tracking
 * @returns Number of links created and array of errors
 */
export async function createContentDocumentLinks(
  contentDocumentId: string,
  parents: DocgenParents,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<{ created: number; errors: string[] }> {
  // Filter non-null parent IDs (dynamic iteration for any object type)
  const parentIds: string[] = Object.values(parents).filter(
    (id): id is string => id !== null && id !== undefined
  );

  // No parents to link
  if (parentIds.length === 0) {
    return { created: 0, errors: [] };
  }

  const errors: string[] = [];
  let created = 0;

  // Create links sequentially (could parallelize but safer to serialize)
  for (const parentId of parentIds) {
    try {
      await createContentDocumentLink(contentDocumentId, parentId, api, options);
      created++;
    } catch (error) {
      // Per T-12: Link failures are non-fatal. Collect errors but continue.
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push(`Failed to link to ${parentId}: ${errorMessage}`);
    }
  }

  return { created, errors };
}

/**
 * Update a Generated_Document__c record with status and file IDs
 *
 * @param generatedDocumentId - Generated_Document__c record ID
 * @param fields - Fields to update (Status__c, OutputFileId__c, Error__c, etc.)
 * @param api - Salesforce API client instance
 * @param options - Optional correlation tracking
 *
 * @throws Error if update fails
 */
export async function updateGeneratedDocument(
  generatedDocumentId: string,
  fields: Partial<GeneratedDocumentUpdateFields>,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<void> {
  // Salesforce PATCH endpoint for updating records
  const endpoint = `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`;

  // PATCH returns 204 No Content on success (no response body)
  await api.patch(endpoint, fields, options);
}

/**
 * Orchestrator function: Upload files, create links, and update Generated_Document__c
 *
 * This is the main entry point for T-12. It handles the complete flow:
 * 1. Upload PDF (always)
 * 2. Upload DOCX (if storeMergedDocx option is true)
 * 3. Create ContentDocumentLinks for all non-null parents
 * 4. Update Generated_Document__c with status and file IDs
 *
 * Per T-12 requirements:
 * - If link creation fails, file is left orphaned and status set to FAILED
 * - storeMergedDocx creates two separate ContentVersions (PDF + DOCX)
 * - generatedDocumentId is required for status tracking
 *
 * @param pdfBuffer - PDF file content
 * @param docxBuffer - Optional DOCX file content (if storeMergedDocx=true)
 * @param request - Full DocgenRequest with parents, options, and generatedDocumentId
 * @param api - Salesforce API client instance
 * @param options - Optional correlation tracking
 * @returns Upload and link results
 *
 * @throws Error if PDF upload fails or update fails
 */
export async function uploadAndLinkFiles(
  pdfBuffer: Buffer,
  docxBuffer: Buffer | null,
  request: DocgenRequest,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<FileUploadResult> {
  const result: FileUploadResult = {
    pdfContentVersionId: '',
    pdfContentDocumentId: '',
    linkCount: 0,
    linkErrors: [],
  };

  try {
    // Step 1: Upload PDF (always required)
    const pdfUpload = await uploadContentVersion(
      pdfBuffer,
      request.outputFileName,
      api,
      options
    );
    result.pdfContentVersionId = pdfUpload.contentVersionId;
    result.pdfContentDocumentId = pdfUpload.contentDocumentId;

    // Step 2: Upload DOCX if requested
    if (docxBuffer && request.options.storeMergedDocx) {
      // Change extension to .docx
      const docxFileName = request.outputFileName.replace(
        /\.(pdf|docx)$/i,
        '.docx'
      );
      const docxUpload = await uploadContentVersion(
        docxBuffer,
        docxFileName,
        api,
        options
      );
      result.docxContentVersionId = docxUpload.contentVersionId;
      result.docxContentDocumentId = docxUpload.contentDocumentId;
    }

    // Step 3: Create ContentDocumentLinks if parents provided
    if (request.parents) {
      // Link PDF to parents
      const pdfLinks = await createContentDocumentLinks(
        result.pdfContentDocumentId,
        request.parents,
        api,
        options
      );
      result.linkCount += pdfLinks.created;
      result.linkErrors.push(...pdfLinks.errors);

      // Link DOCX to parents if uploaded
      if (result.docxContentDocumentId) {
        const docxLinks = await createContentDocumentLinks(
          result.docxContentDocumentId,
          request.parents,
          api,
          options
        );
        result.linkCount += docxLinks.created;
        result.linkErrors.push(...docxLinks.errors);
      }
    }

    // Step 4: Update Generated_Document__c
    if (request.generatedDocumentId) {
      // Check if link creation had errors
      const hasLinkErrors = result.linkErrors.length > 0;

      if (hasLinkErrors) {
        // Per T-12: Link failures → status FAILED, file orphaned
        await updateGeneratedDocument(
          request.generatedDocumentId,
          {
            Status__c: 'FAILED',
            Error__c: `Link creation failed: ${result.linkErrors.join('; ')}`,
            OutputFileId__c: result.pdfContentVersionId, // File exists but orphaned
          },
          api,
          options
        );
      } else {
        // Success: Update with file IDs and parent lookups
        const updateFields: Partial<GeneratedDocumentUpdateFields> = {
          Status__c: 'SUCCEEDED',
          OutputFileId__c: result.pdfContentVersionId,
        };

        // Include DOCX file ID if uploaded
        if (result.docxContentVersionId) {
          updateFields.MergedDocxFileId__c = result.docxContentVersionId;
        }

        // Map parent IDs to Generated_Document__c lookup fields
        // e.g., ContactId => Contact__c, LeadId => Lead__c
        if (request.parents) {
          for (const [parentKey, parentValue] of Object.entries(
            request.parents
          )) {
            // Convert "ContactId" → "Contact__c", "AccountId" → "Account__c", etc.
            if (parentKey.endsWith('Id')) {
              const lookupFieldName = parentKey.slice(0, -2) + '__c';
              updateFields[lookupFieldName] = parentValue;
            }
          }
        }

        await updateGeneratedDocument(
          request.generatedDocumentId,
          updateFields,
          api,
          options
        );
      }
    }

    return result;
  } catch (error) {
    // If upload or update fails, set status to FAILED (if we have the record ID)
    if (request.generatedDocumentId) {
      try {
        await updateGeneratedDocument(
          request.generatedDocumentId,
          {
            Status__c: 'FAILED',
            Error__c:
              error instanceof Error ? error.message : 'Unknown error occurred',
          },
          api,
          options
        );
      } catch (updateError) {
        // Log but don't throw (original error is more important)
        console.error('Failed to update Generated_Document__c:', updateError);
      }
    }

    // Re-throw original error
    throw error;
  }
}
