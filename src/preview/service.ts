import {
  AuthorizationError,
  ConversionFailedError,
  MissingConfigurationError,
  SalesforceRecordNotFoundError,
  ValidationError,
} from '../errors';
import { SalesforceApi } from '../sf/api';
import { getSalesforceAuth } from '../sf/auth';
import { PdfPageRenderer, PdfPreviewRenderError } from './pdf-page-renderer';
import {
  PdfPreviewImageTooLargeError,
  PdfPreviewInvalidDocumentError,
  PdfPreviewTimeoutError,
} from './errors';
import {
  DEFAULT_MAX_PREVIEW_PAGES,
  GeneratedDocumentPreviewRecord,
  HARD_MAX_PREVIEW_PAGES,
  PdfPagePreviewRequest,
  PdfPagePreviewResponse,
} from './types';

const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const SALESFORCE_USER_ID_PATTERN = /^005[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const CONTENT_VERSION_ID_PATTERN = /^068[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;

interface SalesforceQueryResponse<T> {
  records: T[];
}

export interface PdfPreviewRenderer {
  renderPage(pdfData: Buffer, pageNumber: number): ReturnType<PdfPageRenderer['renderPage']>;
}

export class PdfPreviewService {
  constructor(
    private readonly sfApi: SalesforceApi,
    private readonly renderer: PdfPreviewRenderer = new PdfPageRenderer()
  ) {}

  async getPdfPage(
    request: PdfPagePreviewRequest,
    correlationId: string
  ): Promise<PdfPagePreviewResponse> {
    const previewLimit = this.validateRequest(request, correlationId);
    const record = await this.loadGeneratedDocument(request.generatedDocumentId, correlationId);

    this.authorizeRecord(record, request.requestingUserId, correlationId);

    let pdfData: Buffer;
    try {
      pdfData = await this.sfApi.downloadContentVersion(record.OutputFileId__c!, {
        correlationId,
      });
    } catch {
      throw new ConversionFailedError('PDF preview source could not be loaded', {
        correlationId,
        generatedDocumentId: request.generatedDocumentId,
      });
    }

    try {
      const rendered = await this.renderer.renderPage(pdfData, request.pageNumber);
      const previewPageCount = Math.min(rendered.pageCount, previewLimit);

      if (request.pageNumber > previewPageCount) {
        throw new ValidationError(`Requested page must be between 1 and ${previewPageCount}`, {
          correlationId,
          generatedDocumentId: request.generatedDocumentId,
        });
      }

      return {
        contentType: 'image/jpeg',
        base64Data: rendered.imageData.toString('base64'),
        pageNumber: request.pageNumber,
        pageCount: rendered.pageCount,
        previewPageCount,
        previewTruncated: rendered.pageCount > previewPageCount,
      };
    } catch (error) {
      this.rethrowRenderError(error, request.generatedDocumentId, correlationId);
    }
  }

  private validateRequest(request: PdfPagePreviewRequest, correlationId: string): number {
    const context = { correlationId, generatedDocumentId: request.generatedDocumentId };

    if (!SALESFORCE_ID_PATTERN.test(request.generatedDocumentId)) {
      throw new ValidationError('Invalid generated document ID', context);
    }
    if (!SALESFORCE_USER_ID_PATTERN.test(request.requestingUserId)) {
      throw new ValidationError('Invalid requesting user ID', context);
    }
    if (!Number.isInteger(request.pageNumber) || request.pageNumber < 1) {
      throw new ValidationError('Page number must be a positive integer', context);
    }
    if (
      request.maxPreviewPages !== undefined &&
      (!Number.isInteger(request.maxPreviewPages) || request.maxPreviewPages < 1)
    ) {
      throw new ValidationError('Maximum preview pages must be a positive integer', context);
    }

    const previewLimit = Math.min(
      request.maxPreviewPages ?? DEFAULT_MAX_PREVIEW_PAGES,
      HARD_MAX_PREVIEW_PAGES
    );
    if (request.pageNumber > previewLimit) {
      throw new ValidationError(
        `Requested page exceeds the ${previewLimit}-page preview limit`,
        context
      );
    }
    return previewLimit;
  }

  private async loadGeneratedDocument(
    generatedDocumentId: string,
    correlationId: string
  ): Promise<GeneratedDocumentPreviewRecord> {
    const soql =
      'SELECT Id, Status__c, PendingPreview__c, OutputFormat__c, ' +
      'RequestedBy__c, OutputFileId__c ' +
      `FROM Generated_Document__c WHERE Id = '${generatedDocumentId}' LIMIT 1`;
    const result = await this.sfApi.get<SalesforceQueryResponse<GeneratedDocumentPreviewRecord>>(
      `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      { correlationId }
    );

    const record = result.records?.[0];
    if (!record) {
      throw new SalesforceRecordNotFoundError('Generated_Document__c', generatedDocumentId, {
        correlationId,
        generatedDocumentId,
      });
    }
    return record;
  }

  private authorizeRecord(
    record: GeneratedDocumentPreviewRecord,
    requestingUserId: string,
    correlationId: string
  ): void {
    const context = { correlationId, generatedDocumentId: record.Id };

    if (record.RequestedBy__c !== requestingUserId) {
      throw new AuthorizationError('PDF preview is not available for this request', context);
    }
    if (
      record.Status__c !== 'SUCCEEDED' ||
      record.PendingPreview__c !== true ||
      record.OutputFormat__c !== 'PDF' ||
      !record.OutputFileId__c ||
      !CONTENT_VERSION_ID_PATTERN.test(record.OutputFileId__c)
    ) {
      throw new ValidationError(
        'PDF preview is not available for this generated document',
        context
      );
    }
  }

  private rethrowRenderError(
    error: unknown,
    generatedDocumentId: string,
    correlationId: string
  ): never {
    const context = { correlationId, generatedDocumentId };

    if (error instanceof ValidationError) {
      throw error;
    }
    if (error instanceof PdfPreviewRenderError) {
      if (error.code === 'INVALID_PDF') {
        throw new PdfPreviewInvalidDocumentError(context);
      }
      if (error.code === 'PAGE_OUT_OF_RANGE') {
        throw new ValidationError('Requested preview page is outside the available range', context);
      }
      if (error.code === 'RENDER_TIMEOUT') {
        throw new PdfPreviewTimeoutError(context);
      }
      if (error.code === 'OUTPUT_TOO_LARGE') {
        throw new PdfPreviewImageTooLargeError(context);
      }
    }

    throw new ConversionFailedError('PDF preview page could not be rendered', context);
  }
}

export function createPdfPreviewService(): PdfPreviewService {
  const sfAuth = getSalesforceAuth();
  if (!sfAuth) {
    throw new MissingConfigurationError('Salesforce authentication');
  }
  return new PdfPreviewService(
    new SalesforceApi(sfAuth, sfAuth.getInstanceUrl()),
    new PdfPageRenderer()
  );
}
