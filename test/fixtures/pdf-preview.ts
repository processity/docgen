import { PDFDocument } from 'pdf-lib';

export async function createPdfPreviewFixture(pageCount: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([600 + index, 800 + index]);
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
