import { PDFDocument } from 'pdf-lib';
import type { SalesforceApi } from '../src/sf/api';
import { ConversionFailedError, ConversionTimeoutError, SalesforceApiError, ValidationError } from '../src/errors';
import { convertDocxToPdf } from '../src/convert/soffice';
import {
  appendAdditionalPdfPages,
  MAX_ADDITIONAL_PDF_COUNT,
  MAX_ADDITIONAL_PDF_BYTES,
} from '../src/pdf/attachments';

jest.mock('../src/convert/soffice', () => ({ convertDocxToPdf: jest.fn() }));
const mockConvertDocxToPdf = jest.mocked(convertDocxToPdf);

const ID_1 = '068000000000001AAA';
const ID_2 = '068000000000002AAA';
const ID_3 = '068000000000003AAA';

async function createPdf(widths: number[]): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const width of widths) {
    document.addPage([width, 200]);
  }
  return Buffer.from(await document.save());
}

function createApi(records: any[], files: Record<string, Buffer | Error>): SalesforceApi {
  return {
    get: jest.fn().mockResolvedValue({ records }),
    downloadContentVersion: jest.fn(async (id: string) => {
      const value = files[id];
      if (value instanceof Error) {
        throw value;
      }
      return value;
    }),
  } as unknown as SalesforceApi;
}

describe('additional PDF and DOCX attachments', () => {
  beforeEach(() => {
    mockConvertDocxToPdf.mockReset();
  });

  it('returns the original PDF without Salesforce calls when IDs are omitted', async () => {
    const base = await createPdf([100]);
    const api = createApi([], {});

    const result = await appendAdditionalPdfPages(base, undefined, api, 'corr-1');

    expect(result.buffer).toBe(base);
    expect(result.appendedAttachmentCount).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('appends every page in caller order and removes duplicate IDs', async () => {
    const base = await createPdf([100]);
    const first = await createPdf([210, 220]);
    const second = await createPdf([310]);
    const api = createApi(
      [
        { Id: ID_1, Title: 'First', FileType: 'PDF', FileExtension: 'pdf', ContentSize: first.length },
        { Id: ID_2, Title: 'Second', FileType: 'PDF', FileExtension: 'pdf', ContentSize: second.length },
      ],
      { [ID_1]: first, [ID_2]: second }
    );

    const result = await appendAdditionalPdfPages(
      base,
      [ID_2, ID_1, ID_2],
      api,
      'corr-2'
    );
    const output = await PDFDocument.load(result.buffer);

    expect(output.getPages().map((page) => page.getWidth())).toEqual([100, 310, 210, 220]);
    expect(result.appendedAttachmentCount).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(api.downloadContentVersion).toHaveBeenCalledTimes(2);
    expect(mockConvertDocxToPdf).not.toHaveBeenCalled();
  });

  it('converts DOCX attachments as documents and appends PDF and DOCX pages in caller order', async () => {
    const base = await createPdf([100]);
    const firstDocx = Buffer.from('DOCX with literal {{template commands}}');
    const pdf = await createPdf([310]);
    const secondDocx = Buffer.from('Second DOCX');
    mockConvertDocxToPdf
      .mockResolvedValueOnce(await createPdf([410, 420]))
      .mockResolvedValueOnce(await createPdf([210]));
    const api = createApi(
      [
        { Id: ID_1, Title: 'First', FileType: 'word_x', ContentSize: firstDocx.length },
        { Id: ID_2, Title: 'PDF', FileType: 'PDF', ContentSize: pdf.length },
        { Id: ID_3, Title: 'Second', FileExtension: 'DOCX', ContentSize: secondDocx.length },
      ],
      { [ID_1]: firstDocx, [ID_2]: pdf, [ID_3]: secondDocx }
    );

    const result = await appendAdditionalPdfPages(
      base, [ID_3, ID_2, ID_1, ID_3], api, 'corr-docx',
      { timeout: 12345, workdir: '/tmp/attachments' }
    );
    const output = await PDFDocument.load(result.buffer);

    expect(output.getPages().map((page) => page.getWidth())).toEqual([100, 410, 420, 310, 210]);
    expect(result.appendedAttachmentCount).toBe(3);
    expect(result.warnings).toEqual([]);
    expect(api.downloadContentVersion).toHaveBeenCalledTimes(3);
    expect(mockConvertDocxToPdf).toHaveBeenCalledTimes(2);
    expect(mockConvertDocxToPdf).toHaveBeenNthCalledWith(1, secondDocx, {
      timeout: 12345, workdir: '/tmp/attachments', correlationId: 'corr-docx',
    });
    expect(mockConvertDocxToPdf).toHaveBeenNthCalledWith(2, firstDocx, {
      timeout: 12345, workdir: '/tmp/attachments', correlationId: 'corr-docx',
    });
  });

  it.each([
    new ConversionTimeoutError(1000),
    new ConversionFailedError('Invalid DOCX'),
  ])('fails generation instead of dropping a DOCX when conversion fails (%s)', async (error) => {
    const base = await createPdf([100]);
    const api = createApi(
      [{ Id: ID_1, Title: 'Schedule', FileType: 'WORD_X', ContentSize: 10 }],
      { [ID_1]: Buffer.from('DOCX') }
    );
    mockConvertDocxToPdf.mockRejectedValueOnce(error);

    await expect(appendAdditionalPdfPages(base, [ID_1], api, 'corr-fail')).rejects.toBe(error);
  });

  it.each(['malformed', 'empty'])('fails generation when converted DOCX yields a %s PDF', async (resultType) => {
    const base = await createPdf([100]);
    const api = createApi(
      [{ Id: ID_1, Title: 'Schedule', FileExtension: 'docx', ContentSize: 10 }],
      { [ID_1]: Buffer.from('DOCX') }
    );
    const emptyPdf = await PDFDocument.create();
    mockConvertDocxToPdf.mockResolvedValueOnce(resultType === 'malformed'
      ? Buffer.from('not a PDF')
      : Buffer.from(await emptyPdf.save({ addDefaultPage: false })));

    await expect(appendAdditionalPdfPages(base, [ID_1], api, 'corr-fail'))
      .rejects.toBeInstanceOf(ConversionFailedError);
  });

  it('skips permanent invalid files and returns structured warnings', async () => {
    const base = await createPdf([100]);
    const malformed = Buffer.from('not a pdf');
    const api = createApi(
      [
        { Id: ID_1, Title: 'Legacy Word file', FileType: 'WORD', FileExtension: 'doc', ContentSize: 10 },
        { Id: ID_2, Title: 'Broken PDF', FileType: 'PDF', FileExtension: 'pdf', ContentSize: malformed.length },
      ],
      { [ID_2]: malformed }
    );

    const result = await appendAdditionalPdfPages(
      base,
      ['bad-id', ID_1, ID_2, ID_3],
      api,
      'corr-3'
    );

    expect(result.buffer).toBe(base);
    expect(result.appendedAttachmentCount).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'INVALID_CONTENT_VERSION_ID',
      'NOT_A_PDF',
      'CONTENT_VERSION_NOT_FOUND',
      'INVALID_PDF',
    ]);
  });

  it('skips a permanent download authorization failure', async () => {
    const base = await createPdf([100]);
    const forbidden = new SalesforceApiError(403, 'Forbidden');
    const api = createApi(
      [{ Id: ID_1, Title: 'Restricted', FileType: 'PDF', FileExtension: 'pdf', ContentSize: 100 }],
      { [ID_1]: forbidden }
    );

    const result = await appendAdditionalPdfPages(base, [ID_1], api, 'corr-4');

    expect(result.appendedAttachmentCount).toBe(0);
    expect(result.warnings[0].code).toBe('DOWNLOAD_FORBIDDEN');
  });

  it('propagates retryable Salesforce failures', async () => {
    const base = await createPdf([100]);
    const unavailable = new SalesforceApiError(503, 'Unavailable');
    const api = createApi(
      [{ Id: ID_1, Title: 'Temporary', FileType: 'PDF', FileExtension: 'pdf', ContentSize: 100 }],
      { [ID_1]: unavailable }
    );

    await expect(appendAdditionalPdfPages(base, [ID_1], api, 'corr-5')).rejects.toBe(unavailable);
  });

  it('rejects requests above count and aggregate size limits', async () => {
    const base = await createPdf([100]);
    const ids = Array.from({ length: MAX_ADDITIONAL_PDF_COUNT + 1 }, (_, index) =>
      `068${String(index).padStart(12, '0')}AAA`
    );
    const api = createApi([], {});

    await expect(appendAdditionalPdfPages(base, ids, api, 'corr-6')).rejects.toBeInstanceOf(
      ValidationError
    );

    const sizeApi = createApi(
      [
        { Id: ID_1, Title: 'Large one', FileType: 'PDF', ContentSize: MAX_ADDITIONAL_PDF_BYTES },
        { Id: ID_2, Title: 'Large DOCX', FileType: 'WORD_X', ContentSize: 1 },
      ],
      {}
    );
    await expect(
      appendAdditionalPdfPages(base, [ID_1, ID_2], sizeApi, 'corr-7')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('checks actual DOCX download size even when metadata understates the size', async () => {
    const base = await createPdf([100]);
    const api = createApi(
      [{ Id: ID_1, Title: 'Large DOCX', FileType: 'WORD_X', ContentSize: 1 }],
      { [ID_1]: Buffer.alloc(MAX_ADDITIONAL_PDF_BYTES + 1) }
    );

    await expect(appendAdditionalPdfPages(base, [ID_1], api, 'corr-size'))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mockConvertDocxToPdf).not.toHaveBeenCalled();
  });

  it('also bounds the PDF bytes produced by DOCX conversion', async () => {
    const base = await createPdf([100]);
    const api = createApi(
      [{ Id: ID_1, Title: 'Expanded DOCX', FileType: 'WORD_X', ContentSize: 1 }],
      { [ID_1]: Buffer.from('DOCX') }
    );
    mockConvertDocxToPdf.mockResolvedValueOnce(Buffer.alloc(MAX_ADDITIONAL_PDF_BYTES + 1));

    await expect(appendAdditionalPdfPages(base, [ID_1], api, 'corr-size'))
      .rejects.toThrow('Additional files after PDF conversion exceed the 50 MiB aggregate size limit');
  });
});
