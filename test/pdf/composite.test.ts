import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { convertDocxToPdf } from '../../src/convert/soffice';
import { convertCompositeSectionsToPdf, hasPdfAppendixSections } from '../../src/pdf/composite';
import type { TemplateSection } from '../../src/types';
import { createTestDocxWithContent } from '../helpers/test-docx';

jest.mock('../../src/convert/soffice', () => ({
  convertDocxToPdf: jest.fn(async () => {
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    return Buffer.from(await document.save());
  }),
}));

const mockedConvertDocxToPdf = jest.mocked(convertDocxToPdf);

describe('composite PDF conversion', () => {
  const conversion = { correlationId: 'composite-pdf-test' };

  beforeEach(() => {
    mockedConvertDocxToPdf.mockClear();
  });

  it('converts appendix sections independently without the composite watermark', async () => {
    const baseOne = await createTestDocxWithContent('Base One');
    const baseTwo = await createTestDocxWithContent('Base Two');
    const appendix = await createTestDocxWithContent('Appendix Native Formatting');
    const sections: TemplateSection[] = [
      { buffer: baseOne, sequence: 1, namespace: 'Quote' },
      { buffer: baseTwo, sequence: 2, namespace: 'Tables' },
      { buffer: appendix, sequence: 10, namespace: 'CMT_00285', pdfAppendix: true },
    ];

    const result = await convertCompositeSectionsToPdf(sections, {
      watermarkText: 'DRAFT',
      conversion,
    });

    expect(hasPdfAppendixSections(sections)).toBe(true);
    expect(mockedConvertDocxToPdf).toHaveBeenCalledTimes(2);

    const baseInput = mockedConvertDocxToPdf.mock.calls[0][0];
    const baseZip = await JSZip.loadAsync(baseInput);
    const baseDocumentXml = await baseZip.file('word/document.xml')!.async('string');
    expect(baseDocumentXml).toContain('Base One');
    expect(baseDocumentXml).toContain('Base Two');
    expect(baseDocumentXml).not.toContain('Appendix Native Formatting');

    const baseHeaderNames = Object.keys(baseZip.files).filter((name) =>
      /^word\/header\d+\.xml$/.test(name)
    );
    expect(baseHeaderNames.length).toBeGreaterThan(0);
    const baseHeaders = await Promise.all(
      baseHeaderNames.map((name) => baseZip.file(name)!.async('string'))
    );
    expect(baseHeaders.join('\n')).toContain('DRAFT');

    const appendixInput = mockedConvertDocxToPdf.mock.calls[1][0];
    expect(appendixInput.equals(appendix)).toBe(true);

    const outputPdf = await PDFDocument.load(result);
    expect(outputPdf.getPageCount()).toBe(2);
  });

  it('preserves sequence order and keeps each appendix in its own package', async () => {
    const base = await createTestDocxWithContent('Base');
    const appendixOne = await createTestDocxWithContent('Appendix One');
    const appendixTwo = await createTestDocxWithContent('Appendix Two');

    await convertCompositeSectionsToPdf(
      [
        { buffer: appendixTwo, sequence: 30, namespace: 'CMT_00354', pdfAppendix: true },
        { buffer: base, sequence: 10, namespace: 'Quote' },
        { buffer: appendixOne, sequence: 20, namespace: 'CMT_00285', pdfAppendix: true },
      ],
      {
        conversion,
      }
    );

    expect(mockedConvertDocxToPdf).toHaveBeenCalledTimes(3);
    expect(mockedConvertDocxToPdf.mock.calls[1][0].equals(appendixOne)).toBe(true);
    expect(mockedConvertDocxToPdf.mock.calls[2][0].equals(appendixTwo)).toBe(true);
  });

  it('rejects an empty section list', async () => {
    await expect(convertCompositeSectionsToPdf([], { conversion })).rejects.toThrow(
      'No sections provided for composite PDF conversion'
    );
  });
});
