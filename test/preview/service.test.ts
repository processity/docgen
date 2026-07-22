import {
  AuthorizationError,
  ConversionFailedError,
  SalesforceRecordNotFoundError,
  ValidationError,
} from '../../src/errors';
import { PdfPreviewRenderError } from '../../src/preview/pdf-page-renderer';
import {
  PdfPreviewImageTooLargeError,
  PdfPreviewInvalidDocumentError,
  PdfPreviewTimeoutError,
} from '../../src/preview/errors';
import { PdfPreviewRenderer, PdfPreviewService } from '../../src/preview/service';
import type { GeneratedDocumentPreviewRecord } from '../../src/preview/types';
import type { SalesforceApi } from '../../src/sf/api';

const GENERATED_DOCUMENT_ID = 'aGT000000000001AAA';
const REQUESTING_USER_ID = '005000000000001AAA';
const OTHER_USER_ID = '005000000000002AAA';
const CONTENT_VERSION_ID = '068000000000001AAA';

function generatedDocument(
  overrides: Partial<GeneratedDocumentPreviewRecord> = {}
): GeneratedDocumentPreviewRecord {
  return {
    Id: GENERATED_DOCUMENT_ID,
    Status__c: 'SUCCEEDED',
    PendingPreview__c: true,
    OutputFormat__c: 'PDF',
    RequestedBy__c: REQUESTING_USER_ID,
    OutputFileId__c: CONTENT_VERSION_ID,
    ...overrides,
  };
}

function createDependencies(record: GeneratedDocumentPreviewRecord | null = generatedDocument()) {
  const sfApi = {
    get: jest.fn().mockResolvedValue({ records: record ? [record] : [] }),
    downloadContentVersion: jest.fn().mockResolvedValue(Buffer.from('source-pdf')),
  } as unknown as jest.Mocked<SalesforceApi>;
  const renderer = {
    renderPage: jest.fn().mockResolvedValue({
      imageData: Buffer.from('jpeg-page'),
      pageCount: 3,
    }),
  } as jest.Mocked<PdfPreviewRenderer>;
  return { sfApi, renderer };
}

describe('PdfPreviewService', () => {
  it('validates the pending record, downloads internally, and returns only one JPEG page', async () => {
    const { sfApi, renderer } = createDependencies();
    const service = new PdfPreviewService(sfApi, renderer);

    const result = await service.getPdfPage(
      {
        generatedDocumentId: GENERATED_DOCUMENT_ID,
        requestingUserId: REQUESTING_USER_ID,
        pageNumber: 2,
      },
      'corr-valid'
    );

    expect(decodeURIComponent((sfApi.get as jest.Mock).mock.calls[0][0])).toContain(
      `WHERE Id = '${GENERATED_DOCUMENT_ID}' LIMIT 1`
    );
    expect(sfApi.downloadContentVersion).toHaveBeenCalledWith(CONTENT_VERSION_ID, {
      correlationId: 'corr-valid',
    });
    expect(renderer.renderPage).toHaveBeenCalledWith(Buffer.from('source-pdf'), 2);
    expect(result).toEqual({
      contentType: 'image/jpeg',
      base64Data: Buffer.from('jpeg-page').toString('base64'),
      pageNumber: 2,
      pageCount: 3,
      previewPageCount: 3,
      previewTruncated: false,
    });
    expect(JSON.stringify(result)).not.toContain(CONTENT_VERSION_ID);
    expect(JSON.stringify(result)).not.toContain(GENERATED_DOCUMENT_ID);
  });

  it('hard-caps preview navigation at 20 pages', async () => {
    const { sfApi, renderer } = createDependencies();
    renderer.renderPage.mockResolvedValue({ imageData: Buffer.from('page'), pageCount: 25 });
    const service = new PdfPreviewService(sfApi, renderer);

    const result = await service.getPdfPage(
      {
        generatedDocumentId: GENERATED_DOCUMENT_ID,
        requestingUserId: REQUESTING_USER_ID,
        pageNumber: 20,
        maxPreviewPages: 50,
      },
      'corr-cap'
    );

    expect(result.previewPageCount).toBe(20);
    expect(result.previewTruncated).toBe(true);

    await expect(
      service.getPdfPage(
        {
          generatedDocumentId: GENERATED_DOCUMENT_ID,
          requestingUserId: REQUESTING_USER_ID,
          pageNumber: 21,
          maxPreviewPages: 50,
        },
        'corr-over-cap'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('honors a lower caller preview limit without exceeding the server cap', async () => {
    const { sfApi, renderer } = createDependencies();
    renderer.renderPage.mockResolvedValue({ imageData: Buffer.from('page'), pageCount: 12 });
    const service = new PdfPreviewService(sfApi, renderer);

    const result = await service.getPdfPage(
      {
        generatedDocumentId: GENERATED_DOCUMENT_ID,
        requestingUserId: REQUESTING_USER_ID,
        pageNumber: 5,
        maxPreviewPages: 5,
      },
      'corr-lower-cap'
    );

    expect(result.previewPageCount).toBe(5);
    expect(result.previewTruncated).toBe(true);
  });

  it('rejects requests above the preview cap before querying Salesforce', async () => {
    const { sfApi, renderer } = createDependencies();
    const service = new PdfPreviewService(sfApi, renderer);

    await expect(
      service.getPdfPage(
        {
          generatedDocumentId: GENERATED_DOCUMENT_ID,
          requestingUserId: REQUESTING_USER_ID,
          pageNumber: 21,
        },
        'corr-limit'
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sfApi.get).not.toHaveBeenCalled();
    expect(renderer.renderPage).not.toHaveBeenCalled();
  });

  it('does not download or render when the requesting user does not match', async () => {
    const { sfApi, renderer } = createDependencies();
    const service = new PdfPreviewService(sfApi, renderer);

    await expect(
      service.getPdfPage(
        {
          generatedDocumentId: GENERATED_DOCUMENT_ID,
          requestingUserId: OTHER_USER_ID,
          pageNumber: 1,
        },
        'corr-user'
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(sfApi.downloadContentVersion).not.toHaveBeenCalled();
    expect(renderer.renderPage).not.toHaveBeenCalled();
  });

  it.each([
    ['not succeeded', { Status__c: 'FAILED' }],
    ['not pending', { PendingPreview__c: false }],
    ['not PDF', { OutputFormat__c: 'DOCX' }],
    ['missing output file', { OutputFileId__c: null }],
    ['invalid output file ID', { OutputFileId__c: 'not-an-id' }],
  ])('rejects a record that is %s', async (_label, overrides) => {
    const { sfApi, renderer } = createDependencies(generatedDocument(overrides));
    const service = new PdfPreviewService(sfApi, renderer);

    await expect(
      service.getPdfPage(
        {
          generatedDocumentId: GENERATED_DOCUMENT_ID,
          requestingUserId: REQUESTING_USER_ID,
          pageNumber: 1,
        },
        'corr-state'
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sfApi.downloadContentVersion).not.toHaveBeenCalled();
    expect(renderer.renderPage).not.toHaveBeenCalled();
  });

  it('returns a record-not-found error without attempting a file download', async () => {
    const { sfApi, renderer } = createDependencies(null);
    const service = new PdfPreviewService(sfApi, renderer);

    await expect(
      service.getPdfPage(
        {
          generatedDocumentId: GENERATED_DOCUMENT_ID,
          requestingUserId: REQUESTING_USER_ID,
          pageNumber: 1,
        },
        'corr-missing'
      )
    ).rejects.toBeInstanceOf(SalesforceRecordNotFoundError);
    expect(sfApi.downloadContentVersion).not.toHaveBeenCalled();
    expect(renderer.renderPage).not.toHaveBeenCalled();
  });

  it('sanitizes Salesforce download failures so the ContentVersion ID is not exposed', async () => {
    const { sfApi, renderer } = createDependencies();
    sfApi.downloadContentVersion.mockRejectedValue(
      new Error(`GET /ContentVersion/${CONTENT_VERSION_ID}/VersionData failed`)
    );
    const service = new PdfPreviewService(sfApi, renderer);

    const promise = service.getPdfPage(
      {
        generatedDocumentId: GENERATED_DOCUMENT_ID,
        requestingUserId: REQUESTING_USER_ID,
        pageNumber: 1,
      },
      'corr-download'
    );

    await expect(promise).rejects.toBeInstanceOf(ConversionFailedError);
    await expect(promise).rejects.not.toThrow(CONTENT_VERSION_ID);
    await promise.catch((error: ConversionFailedError) => {
      expect(JSON.stringify(error.context)).not.toContain(CONTENT_VERSION_ID);
    });
    expect(renderer.renderPage).not.toHaveBeenCalled();
  });

  it.each([
    ['INVALID_PDF', PdfPreviewInvalidDocumentError],
    ['PAGE_OUT_OF_RANGE', ValidationError],
    ['RENDER_TIMEOUT', PdfPreviewTimeoutError],
    ['RENDER_FAILED', ConversionFailedError],
    ['OUTPUT_TOO_LARGE', PdfPreviewImageTooLargeError],
  ] as const)('sanitizes renderer error %s', async (code, expectedType) => {
    const { sfApi, renderer } = createDependencies();
    renderer.renderPage.mockRejectedValue(new PdfPreviewRenderError(code, '/tmp/raw stderr'));
    const service = new PdfPreviewService(sfApi, renderer);

    const promise = service.getPdfPage(
      {
        generatedDocumentId: GENERATED_DOCUMENT_ID,
        requestingUserId: REQUESTING_USER_ID,
        pageNumber: 1,
      },
      'corr-render'
    );

    await expect(promise).rejects.toBeInstanceOf(expectedType);
    await expect(promise).rejects.not.toThrow('/tmp/raw stderr');
  });

  it.each([
    ['INVALID_PDF', 422],
    ['RENDER_TIMEOUT', 504],
    ['OUTPUT_TOO_LARGE', 413],
  ] as const)('maps renderer error %s to HTTP status %s', async (code, statusCode) => {
    expect.assertions(2);
    const { sfApi, renderer } = createDependencies();
    renderer.renderPage.mockRejectedValue(new PdfPreviewRenderError(code, 'private detail'));
    const service = new PdfPreviewService(sfApi, renderer);

    await service
      .getPdfPage(
        {
          generatedDocumentId: GENERATED_DOCUMENT_ID,
          requestingUserId: REQUESTING_USER_ID,
          pageNumber: 1,
        },
        'corr-status'
      )
      .catch((error: Error & { statusCode: number }) => {
        expect(error.statusCode).toBe(statusCode);
        expect(error.message).not.toContain('private detail');
      });
  });
});
