import { PDFDocument } from 'pdf-lib';
import { convertDocxToPdf } from '../convert/soffice';
import { applyWatermarkToDocx } from '../templates/docx-postprocess';
import { concatenateDocx } from '../templates/concatenate';
import type { ConversionOptions, DocgenOptions, TemplateSection } from '../types';

interface CompositePdfOptions {
  watermarkText?: DocgenOptions['watermarkText'];
  watermarkStyle?: DocgenOptions['watermarkStyle'];
  conversion: ConversionOptions;
}

interface CompositePdfSegment {
  sections: TemplateSection[];
  pdfAppendix: boolean;
}

export function hasPdfAppendixSections(sections: TemplateSection[]): boolean {
  return sections.some((section) => section.pdfAppendix === true);
}

export async function convertCompositeSectionsToPdf(
  sections: TemplateSection[],
  options: CompositePdfOptions
): Promise<Buffer> {
  if (sections.length === 0) {
    throw new Error('No sections provided for composite PDF conversion');
  }

  const segments = buildSegments(sections);
  const pdfBuffers: Buffer[] = [];

  for (const segment of segments) {
    let docxBuffer =
      segment.sections.length === 1
        ? segment.sections[0].buffer
        : await concatenateDocx(segment.sections, options.conversion.correlationId);

    if (!segment.pdfAppendix) {
      docxBuffer = await applyWatermarkToDocx(
        docxBuffer,
        options.watermarkText,
        options.watermarkStyle
      );
    }

    pdfBuffers.push(await convertDocxToPdf(docxBuffer, options.conversion));
  }

  return concatenatePdfBuffers(pdfBuffers);
}

function buildSegments(sections: TemplateSection[]): CompositePdfSegment[] {
  const segments: CompositePdfSegment[] = [];

  for (const section of [...sections].sort((a, b) => a.sequence - b.sequence)) {
    if (section.pdfAppendix === true) {
      segments.push({ sections: [section], pdfAppendix: true });
      continue;
    }

    const previous = segments[segments.length - 1];
    if (previous && !previous.pdfAppendix) {
      previous.sections.push(section);
    } else {
      segments.push({ sections: [section], pdfAppendix: false });
    }
  }

  return segments;
}

async function concatenatePdfBuffers(pdfBuffers: Buffer[]): Promise<Buffer> {
  const output = await PDFDocument.create();

  for (const pdfBuffer of pdfBuffers) {
    const source = await PDFDocument.load(pdfBuffer);
    const pages = await output.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      output.addPage(page);
    }
  }

  return Buffer.from(await output.save());
}
