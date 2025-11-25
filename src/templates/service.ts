import type { SalesforceApi } from '../sf/api';
import { templateCache } from './cache';
import { createLogger } from '../utils/logger';
import { TemplateNotFoundError, SalesforceApiError, DocgenError } from '../errors';

const logger = createLogger('templates:service');

/**
 * Template Service
 *
 * Orchestrates template fetching with caching:
 * 1. Check cache first
 * 2. On miss, fetch from Salesforce
 * 3. Store in cache
 * 4. Return buffer
 *
 * Per ADR-0004:
 * - Templates are immutable (ContentVersionId never changes)
 * - Cache has infinite TTL
 * - LRU eviction when size exceeds 500 MB
 */
export class TemplateService {
  private sfApi: SalesforceApi;

  constructor(sfApi: SalesforceApi) {
    this.sfApi = sfApi;
  }

  /**
   * Get template by ContentVersionId
   *
   * Flow:
   * 1. Check cache
   * 2. If hit, return cached buffer
   * 3. If miss, download from Salesforce
   * 4. Store in cache
   * 5. Return buffer
   *
   * @param contentVersionId - Salesforce ContentVersionId (18-char ID)
   * @param correlationId - Optional correlation ID for tracing
   * @returns Buffer containing template DOCX file
   * @throws Error if download fails
   */
  async getTemplate(contentVersionId: string, correlationId?: string): Promise<Buffer> {
    logger.debug({ contentVersionId, correlationId }, 'Getting template');

    // Check cache first
    const cached = templateCache.get(contentVersionId);
    if (cached) {
      logger.info({ contentVersionId, correlationId }, 'Template served from cache');
      return cached;
    }

    // Cache miss - fetch from Salesforce
    logger.info({ contentVersionId, correlationId }, 'Template not in cache, fetching from Salesforce');

    try {
      const buffer = await this.sfApi.downloadContentVersion(contentVersionId, { correlationId });

      logger.info(
        { contentVersionId, sizeBytes: buffer.length, correlationId },
        'Template downloaded from Salesforce'
      );

      // Store in cache
      templateCache.set(contentVersionId, buffer);

      return buffer;
    } catch (error) {
      logger.error(
        { contentVersionId, correlationId, error },
        'Failed to download template from Salesforce'
      );

      // If it's a Salesforce 404 error, throw TemplateNotFoundError
      if (error instanceof SalesforceApiError && error.context.httpStatus === 404) {
        throw new TemplateNotFoundError(contentVersionId, { correlationId });
      }

      // Re-throw DocgenError subclasses as-is
      if (error instanceof DocgenError) {
        throw error;
      }

      // Wrap other errors as TemplateNotFoundError (most common case is download failure)
      throw new TemplateNotFoundError(contentVersionId, { correlationId });
    }
  }

  /**
   * Check if template exists in cache
   *
   * @param contentVersionId - Salesforce ContentVersionId
   * @returns true if template is cached
   */
  isTemplateInCache(contentVersionId: string): boolean {
    return templateCache.has(contentVersionId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return templateCache.getStats();
  }

  /**
   * Clear all templates from cache
   *
   * Useful for testing or manual cache invalidation
   */
  clearCache(): void {
    logger.warn('Clearing template cache');
    templateCache.clear();
  }
}
