/**
 * Salesforce File Upload Module (T-12)
 *
 * Handles:
 * - ContentVersion upload (PDF/DOCX files)
 * - Generated_Document__c updates (status tracking)
 * - Orchestration of upload + update flow
 *
 * Note: ContentDocumentLink creation is now handled by Salesforce trigger
 * on Generated_Document__c when Status__c = 'SUCCEEDED'
 */

import type { SalesforceApi } from './api';
import type {
  ContentVersionCreateRequest,
  ContentVersionCreateResponse,
  ContentVersionRecord,
  GeneratedDocumentUpdateFields,
  DocgenRequest,
  FileUploadResult,
  CorrelationOptions,
} from '../types';
import { SalesforceUploadError, DocgenError, buildSalesforceError } from '../errors';

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
    throw new SalesforceUploadError(
      `ContentVersion creation failed: ${JSON.stringify(createResponse.errors)}`,
      { correlationId: options?.correlationId, fileSize: buffer.length }
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
    throw new SalesforceUploadError(
      `ContentVersion created but not found in query: ${contentVersionId}`,
      { correlationId: options?.correlationId }
    );
  }

  const contentDocumentId = queryResponse.records[0].ContentDocumentId;

  if (!contentDocumentId) {
    throw new SalesforceUploadError(
      `ContentDocumentId not populated for ContentVersion: ${contentVersionId}`,
      { correlationId: options?.correlationId }
    );
  }

  return {
    contentVersionId,
    contentDocumentId,
  };
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
 * Orchestrator function: Upload files and update Generated_Document__c
 *
 * This is the main entry point for T-12. It handles the complete flow:
 * 1. Upload PDF (always)
 * 2. Upload DOCX (if storeMergedDocx option is true)
 * 3. Update Generated_Document__c with status and file IDs
 *
 * ContentDocumentLink creation is now handled by Salesforce trigger when
 * Status__c = 'SUCCEEDED'. The trigger reads parent IDs from RequestJSON__c.
 *
 * Per T-12 requirements:
 * - storeMergedDocx creates two separate ContentVersions (PDF + DOCX)
 * - generatedDocumentId is required for status tracking
 *
 * @param pdfBuffer - PDF file content
 * @param docxBuffer - Optional DOCX file content (if storeMergedDocx=true)
 * @param request - Full DocgenRequest with parents, options, and generatedDocumentId
 * @param api - Salesforce API client instance
 * @param options - Optional correlation tracking
 * @returns Upload results
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
    linkCount: 0, // Kept for backward compatibility, always 0 now
    linkErrors: [], // Kept for backward compatibility, always empty now
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

    // Step 3: Update Generated_Document__c
    // ContentDocumentLinks will be created by trigger when Status__c = 'SUCCEEDED'
    if (request.generatedDocumentId) {
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
      // These are still useful for queries/reporting even though linking uses RequestJSON
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

    return result;
  } catch (error) {
    // If upload or update fails, set status to FAILED (if we have the record ID)
    if (request.generatedDocumentId) {
      try {
        await updateGeneratedDocument(
          request.generatedDocumentId,
          {
            Status__c: 'FAILED',
            Error__c: buildSalesforceError(
              error instanceof Error ? error : new Error(String(error)),
              { correlationId: options?.correlationId, generatedDocumentId: request.generatedDocumentId }
            ),
          },
          api,
          options
        );
      } catch (updateError) {
        // Log but don't throw (original error is more important)
        console.error('Failed to update Generated_Document__c:', updateError);
      }
    }

    // Re-throw DocgenError subclasses as-is, wrap others
    if (error instanceof DocgenError) {
      throw error;
    }

    throw new SalesforceUploadError(
      error instanceof Error ? error.message : String(error),
      { correlationId: options?.correlationId }
    );
  }
}
