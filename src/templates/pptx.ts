import JSZip from 'jszip';
import type { MergeOptions } from '../types';
import { createLogger } from '../utils/logger';
import { TemplateInvalidFormatError, TemplateMergeError } from '../errors';

const logger = createLogger('templates:pptx');

/**
 * Merge a PPTX template by replacing scalar {{Field.Path}} placeholders in slide XML.
 *
 * This intentionally keeps PPT support narrow: real PPTX in, real PPTX out,
 * with simple scalar replacements. More advanced slide loops/charts/images can
 * be added later once the authoring contract is known.
 */
export async function mergePptxTemplate(
  template: Buffer,
  data: Record<string, any>,
  options: MergeOptions
): Promise<Buffer> {
  logger.debug(
    {
      templateSize: template.length,
      dataKeys: Object.keys(data),
      locale: options.locale,
      timezone: options.timezone,
    },
    'Starting PPTX merge'
  );

  try {
    const zip = await JSZip.loadAsync(template);
    const slidePaths = Object.keys(zip.files).filter((path) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(path)
    );

    if (slidePaths.length === 0) {
      throw new TemplateInvalidFormatError('PPTX template is missing slide XML');
    }

    for (const path of slidePaths) {
      const file = zip.file(path);
      if (!file) {
        continue;
      }
      const xml = await file.async('string');
      zip.file(path, replaceScalarPlaceholders(xml, data));
    }

    const result = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    logger.info(
      {
        templateSize: template.length,
        resultSize: result.length,
        slideCount: slidePaths.length,
      },
      'PPTX merge complete'
    );

    return result;
  } catch (error) {
    if (error instanceof TemplateInvalidFormatError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new TemplateMergeError(`PPTX merge failed: ${error.message}`);
    }
    throw new TemplateMergeError('Unknown error during PPTX merge');
  }
}

function replaceScalarPlaceholders(xml: string, data: Record<string, any>): string {
  return xml.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g, (_match, path: string) => {
    const value = resolvePath(data, path);
    return escapePptxText(value == null ? '' : String(value)).replace(/\r?\n/g, '</a:t><a:br/><a:t>');
  });
}

function resolvePath(data: Record<string, any>, path: string): unknown {
  const parts = path.split('.');
  let current: any = data;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function escapePptxText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
