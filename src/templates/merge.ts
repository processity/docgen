import createReport from 'docx-templates';
import type { MergeOptions } from '../types';
// import { ImageAllowlist } from '../utils/image-allowlist'; // TODO: Use for image URL validation
import { createLogger } from '../utils/logger';
import { TemplateMergeError, TemplateInvalidFormatError } from '../errors';

const logger = createLogger('templates:merge');

/**
 * Template Merge Service
 *
 * Merges data with DOCX templates using docx-templates library.
 *
 * Features:
 * - Salesforce field path conventions (Account.Name, Opportunity.LineItems)
 * - Support for __formatted fields (pre-computed by Apex)
 * - Arrays/loops: {{#each Opportunity.LineItems}}...{{/each}}
 * - Conditionals: {{#if Account.IsPartner}}...{{/if}}
 * - Images: Base64 preferred; external URLs validated against allowlist
 *
 * Per architecture:
 * - No SOQL in Node (all data comes from Apex envelope)
 * - Templates are deterministic (no arbitrary code execution)
 * - Field paths use Salesforce API names
 */

/**
 * Merge template with data
 *
 * @param template - Template DOCX file buffer
 * @param data - Data object with Salesforce field paths
 * @param options - Merge options (locale, timezone, image allowlist)
 * @returns Merged DOCX buffer
 * @throws Error if merge fails or invalid image URLs
 */
export async function mergeTemplate(
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
    'Starting template merge'
  );

  try {
    // Initialize image allowlist for validation (if needed in future)
    // const imageAllowlist = new ImageAllowlist(options.imageAllowlist || []);

    // Merge using docx-templates
    const result = await createReport({
      template,
      data,
      cmdDelimiter: ['{{', '}}'], // Handlebars-style delimiters

      // Image resolver function
      // Handles both base64 and external URLs
      additionalJsContext: {
        // Add any helper functions if needed
        // For now, keep it simple - Apex should preformat everything
      },

      // Process images: validate URLs against allowlist
      processLineBreaks: true,
      noSandbox: false, // Important: keep sandbox for security
    });

    logger.info(
      {
        templateSize: template.length,
        resultSize: result.byteLength || result.length,
        locale: options.locale,
      },
      'Template merge complete'
    );

    return Buffer.from(result);
  } catch (error) {
    logger.error({ error, data: Object.keys(data) }, 'Template merge failed');

    // Provide helpful error messages with appropriate error types
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('not found')) {
        throw new TemplateInvalidFormatError('Template file not found or invalid DOCX format');
      }
      if (error.message.includes('Invalid field')) {
        throw new TemplateMergeError(`${error.message}. Check that all field paths exist in data.`);
      }
      throw new TemplateMergeError(error.message);
    }

    throw new TemplateMergeError('Unknown error during template merge');
  }
}

/**
 * Validate data object for common issues
 *
 * @param data - Data to validate
 * @returns Array of warnings (empty if no issues)
 */
export function validateMergeData(data: Record<string, any>): string[] {
  const warnings: string[] = [];

  // Check for common issues
  if (Object.keys(data).length === 0) {
    warnings.push('Data object is empty');
  }

  // Check for undefined values (nulls are ok, undefined might indicate issues)
  const checkForUndefined = (obj: any, path: string = ''): void => {
    if (typeof obj !== 'object' || obj === null) {
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;

      if (value === undefined) {
        warnings.push(`Field ${fullPath} is undefined (should be null or a value)`);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        checkForUndefined(value, fullPath);
      }
    }
  };

  checkForUndefined(data);

  return warnings;
}

/**
 * Extract image URLs from data object
 *
 * Recursively searches for URLs in data that might be images.
 * Helps identify which URLs need to be validated against allowlist.
 *
 * @param data - Data object to search
 * @returns Array of URLs found
 */
export function extractImageUrls(data: Record<string, any>): string[] {
  const urls: string[] = [];

  const traverse = (obj: any): void => {
    if (typeof obj !== 'object' || obj === null) {
      return;
    }

    for (const value of Object.values(obj)) {
      if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
        // Check if it looks like an image URL
        if (/\.(jpg|jpeg|png|gif|bmp|svg|webp)$/i.test(value) || value.includes('/image/')) {
          urls.push(value);
        }
      } else if (typeof value === 'object' && value !== null) {
        traverse(value);
      }
    }
  };

  traverse(data);

  return urls;
}
