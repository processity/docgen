import { PDFDocument } from 'pdf-lib';
import type {
  ContentVersionMetadata,
  ConversionOptions,
  PdfAttachmentWarning,
} from '../types';
import type { SalesforceApi } from '../sf/api';
import { ConversionFailedError, SalesforceApiError, ValidationError } from '../errors';
import { convertDocxToPdf } from '../convert/soffice';
import { createLogger } from '../utils/logger';
import { timeStage } from '../obs';

const logger = createLogger('pdf:attachments');

export const MAX_ADDITIONAL_PDF_COUNT = 20;
export const MAX_ADDITIONAL_PDF_BYTES = 50 * 1024 * 1024;

const CONTENT_VERSION_ID_PATTERN = /^068[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;

interface SalesforceQueryResponse<T> {
  records: T[];
}

export interface AppendPdfAttachmentsResult {
  buffer: Buffer;
  appendedAttachmentCount: number;
  warnings: PdfAttachmentWarning[];
}

export function normalizeAdditionalPdfContentVersionIds(
  ids: string[] | undefined
): string[] {
  if (!ids?.length) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of ids) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id && !seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  return normalized;
}

export async function appendAdditionalPdfPages(
  generatedPdf: Buffer,
  requestedIds: string[] | undefined,
  sfApi: SalesforceApi,
  correlationId: string,
  conversion: ConversionOptions = {}
): Promise<AppendPdfAttachmentsResult> {
  return timeStage('pdfAttachments', () =>
    appendAdditionalPdfPagesInternal(generatedPdf, requestedIds, sfApi, correlationId, conversion)
  );
}

async function appendAdditionalPdfPagesInternal(
  generatedPdf: Buffer,
  requestedIds: string[] | undefined,
  sfApi: SalesforceApi,
  correlationId: string,
  conversion: ConversionOptions
): Promise<AppendPdfAttachmentsResult> {
  const ids = normalizeAdditionalPdfContentVersionIds(requestedIds);
  if (ids.length === 0) {
    return { buffer: generatedPdf, appendedAttachmentCount: 0, warnings: [] };
  }
  if (ids.length > MAX_ADDITIONAL_PDF_COUNT) {
    throw new ValidationError(
      `A maximum of ${MAX_ADDITIONAL_PDF_COUNT} additional PDF or DOCX files is supported`,
      { correlationId }
    );
  }

  const warnings: PdfAttachmentWarning[] = [];
  const syntacticallyValidIds = ids.filter((id) => {
    if (CONTENT_VERSION_ID_PATTERN.test(id)) {
      return true;
    }
    warnings.push({
      contentVersionId: id,
      code: 'INVALID_CONTENT_VERSION_ID',
      message: `Skipped invalid ContentVersion ID: ${id}`,
    });
    return false;
  });

  if (syntacticallyValidIds.length === 0) {
    return { buffer: generatedPdf, appendedAttachmentCount: 0, warnings };
  }

  const metadataById = await loadContentVersionMetadata(
    syntacticallyValidIds,
    sfApi,
    correlationId
  );
  const eligible: ContentVersionMetadata[] = [];
  let metadataBytes = 0;

  for (const id of syntacticallyValidIds) {
    const metadata = metadataById.get(id);
    if (!metadata) {
      warnings.push({
        contentVersionId: id,
        code: 'CONTENT_VERSION_NOT_FOUND',
        message: `Skipped missing or inaccessible ContentVersion: ${id}`,
      });
      continue;
    }

    const isPdf = metadata.FileType?.toUpperCase() === 'PDF' ||
      metadata.FileExtension?.toLowerCase() === 'pdf';
    if (!isPdf && !isDocx(metadata)) {
      warnings.push({
        contentVersionId: id,
        title: metadata.Title,
        code: 'NOT_A_PDF',
        message: `Skipped unsupported file (only PDF or DOCX is supported): ${metadata.Title || id}`,
      });
      continue;
    }

    metadataBytes += metadata.ContentSize || 0;
    if (metadataBytes > MAX_ADDITIONAL_PDF_BYTES) {
      throw new ValidationError(
        'Additional PDF or DOCX files exceed the 50 MiB aggregate size limit',
        { correlationId }
      );
    }
    eligible.push(metadata);
  }

  if (eligible.length === 0) {
    return { buffer: generatedPdf, appendedAttachmentCount: 0, warnings };
  }

  const output = await PDFDocument.load(generatedPdf);
  let downloadedBytes = 0;
  let pdfBytes = 0;
  let appendedAttachmentCount = 0;

  for (const metadata of eligible) {
    let sourceBytes: Buffer;
    try {
      sourceBytes = await sfApi.downloadContentVersion(metadata.Id, { correlationId });
    } catch (error) {
      if (isPermanentDownloadError(error)) {
        warnings.push({
          contentVersionId: metadata.Id,
          title: metadata.Title,
          code: 'DOWNLOAD_FORBIDDEN',
          message: `Skipped inaccessible PDF or DOCX file: ${metadata.Title || metadata.Id}`,
        });
        continue;
      }
      throw error;
    }

    downloadedBytes += sourceBytes.length;
    if (downloadedBytes > MAX_ADDITIONAL_PDF_BYTES) {
      throw new ValidationError(
        'Additional PDF or DOCX files exceed the 50 MiB aggregate size limit',
        { correlationId }
      );
    }

    const requiresConversion = isDocx(metadata);
    if (requiresConversion) {
      // Reuse the bounded conversion pool without merging or evaluating template commands
      // in the additional document. Conversion failures must not omit a requested schedule.
      sourceBytes = await convertDocxToPdf(sourceBytes, { ...conversion, correlationId });
    }
    pdfBytes += sourceBytes.length;
    if (pdfBytes > MAX_ADDITIONAL_PDF_BYTES) {
      throw new ValidationError(
        'Additional files after PDF conversion exceed the 50 MiB aggregate size limit',
        { correlationId }
      );
    }

    try {
      const source = await PDFDocument.load(sourceBytes);
      const pageIndices = source.getPageIndices();
      if (pageIndices.length === 0) {
        if (requiresConversion) {
          throw new Error('Converted DOCX contains no PDF pages');
        }
        warnings.push({
          contentVersionId: metadata.Id,
          title: metadata.Title,
          code: 'EMPTY_PDF',
          message: `Skipped PDF with no pages: ${metadata.Title || metadata.Id}`,
        });
        continue;
      }

      const copiedPages = await output.copyPages(source, pageIndices);
      for (const page of copiedPages) {
        output.addPage(page);
      }
      appendedAttachmentCount += 1;
    } catch (error) {
      if (requiresConversion) {
        throw new ConversionFailedError(
          `DOCX attachment did not produce a readable PDF: ${metadata.Title || metadata.Id}`,
          { correlationId }
        );
      }
      logger.warn(
        { correlationId, contentVersionId: metadata.Id, error },
        'Skipping unreadable additional PDF'
      );
      warnings.push({
        contentVersionId: metadata.Id,
        title: metadata.Title,
        code: 'INVALID_PDF',
        message: `Skipped malformed or encrypted PDF: ${metadata.Title || metadata.Id}`,
      });
    }
  }

  if (appendedAttachmentCount === 0) {
    return { buffer: generatedPdf, appendedAttachmentCount, warnings };
  }

  const combinedBytes = await output.save();
  logger.info(
    {
      correlationId,
      requestedAttachmentCount: ids.length,
      appendedAttachmentCount,
      warningCount: warnings.length,
      downloadedBytes,
      pdfBytes,
    },
    'Additional PDF pages appended'
  );

  return {
    buffer: Buffer.from(combinedBytes),
    appendedAttachmentCount,
    warnings,
  };
}

function isDocx(metadata: ContentVersionMetadata): boolean {
  return metadata.FileType?.toUpperCase() === 'WORD_X' ||
    metadata.FileExtension?.toLowerCase() === 'docx';
}

async function loadContentVersionMetadata(
  ids: string[],
  sfApi: SalesforceApi,
  correlationId: string
): Promise<Map<string, ContentVersionMetadata>> {
  const idList = ids.map((id) => `'${id}'`).join(',');
  const soql =
    'SELECT Id, Title, FileExtension, FileType, ContentSize ' +
    `FROM ContentVersion WHERE Id IN (${idList})`;
  const response = await sfApi.get<SalesforceQueryResponse<ContentVersionMetadata>>(
    `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
    { correlationId }
  );
  return new Map(response.records.map((record) => [record.Id, record]));
}

function isPermanentDownloadError(error: unknown): boolean {
  if (!(error instanceof SalesforceApiError)) {
    return false;
  }
  const status = error.context.httpStatus;
  return status === 403 || status === 404;
}
