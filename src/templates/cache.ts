import type { TemplateCacheEntry, TemplateCacheStats } from '../types';
import pino from 'pino';

const logger = pino({ name: 'templates:cache' });

// Maximum cache size in bytes (500 MB)
const MAX_CACHE_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * In-memory template cache
 *
 * Per ADR-0004:
 * - Templates are immutable (keyed by ContentVersionId), so no TTL needed
 * - Optional size limit of 500 MB with LRU eviction
 * - Thread-safe for single Node.js process (synchronous operations)
 */
export class TemplateCache {
  private cache: Map<string, TemplateCacheEntry> = new Map();
  private stats: TemplateCacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    currentSize: 0,
    entryCount: 0,
  };

  /**
   * Get template from cache
   *
   * @param contentVersionId - Salesforce ContentVersionId
   * @returns Buffer if found, undefined otherwise
   */
  get(contentVersionId: string): Buffer | undefined {
    const entry = this.cache.get(contentVersionId);

    if (entry) {
      // Cache hit - update lastAccessedAt for LRU
      entry.lastAccessedAt = Date.now();
      this.stats.hits++;

      logger.debug(
        { contentVersionId, sizeBytes: entry.sizeBytes, hits: this.stats.hits },
        'Template cache hit'
      );

      return entry.buffer;
    }

    // Cache miss
    this.stats.misses++;
    logger.debug({ contentVersionId, misses: this.stats.misses }, 'Template cache miss');

    return undefined;
  }

  /**
   * Store template in cache
   *
   * If adding this entry would exceed MAX_CACHE_SIZE_BYTES,
   * evict least-recently-used entries until there's space.
   *
   * @param contentVersionId - Salesforce ContentVersionId
   * @param buffer - Template file buffer
   */
  set(contentVersionId: string, buffer: Buffer): void {
    const sizeBytes = buffer.length;
    const now = Date.now();

    // Check if entry already exists (shouldn't happen in practice, but handle it)
    const existing = this.cache.get(contentVersionId);
    if (existing) {
      logger.warn({ contentVersionId }, 'Template already in cache, updating');
      this.stats.currentSize -= existing.sizeBytes;
      this.stats.entryCount--;
    }

    // Evict LRU entries if needed to make space
    this.evictIfNeeded(sizeBytes);

    // Add new entry
    const entry: TemplateCacheEntry = {
      contentVersionId,
      buffer,
      sizeBytes,
      cachedAt: now,
      lastAccessedAt: now,
    };

    this.cache.set(contentVersionId, entry);
    this.stats.currentSize += sizeBytes;
    this.stats.entryCount++;

    logger.info(
      {
        contentVersionId,
        sizeBytes,
        totalSize: this.stats.currentSize,
        entryCount: this.stats.entryCount,
      },
      'Template added to cache'
    );
  }

  /**
   * Evict least-recently-used entries until there's enough space
   *
   * @param requiredBytes - Bytes needed for new entry
   */
  private evictIfNeeded(requiredBytes: number): void {
    // Calculate how much space we need to free
    const availableSpace = MAX_CACHE_SIZE_BYTES - this.stats.currentSize;

    if (availableSpace >= requiredBytes) {
      // Enough space available
      return;
    }

    const spaceNeeded = requiredBytes - availableSpace;

    logger.info(
      { spaceNeeded, currentSize: this.stats.currentSize, maxSize: MAX_CACHE_SIZE_BYTES },
      'Cache size limit reached, evicting LRU entries'
    );

    // Sort entries by lastAccessedAt (oldest first)
    const entries = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt
    );

    let freedSpace = 0;

    for (const [key, entry] of entries) {
      if (freedSpace >= spaceNeeded) {
        break;
      }

      logger.debug(
        {
          contentVersionId: key,
          sizeBytes: entry.sizeBytes,
          lastAccessedAt: new Date(entry.lastAccessedAt).toISOString(),
        },
        'Evicting template from cache (LRU)'
      );

      this.cache.delete(key);
      this.stats.currentSize -= entry.sizeBytes;
      this.stats.entryCount--;
      this.stats.evictions++;
      freedSpace += entry.sizeBytes;
    }

    logger.info(
      {
        freedSpace,
        evictions: this.stats.evictions,
        remainingSize: this.stats.currentSize,
        remainingCount: this.stats.entryCount,
      },
      'Cache eviction complete'
    );
  }

  /**
   * Check if template exists in cache
   */
  has(contentVersionId: string): boolean {
    return this.cache.has(contentVersionId);
  }

  /**
   * Get current cache statistics
   */
  getStats(): TemplateCacheStats {
    return { ...this.stats };
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    const count = this.cache.size;
    this.cache.clear();
    this.stats.currentSize = 0;
    this.stats.entryCount = 0;

    logger.info({ clearedCount: count }, 'Cache cleared');
  }

  /**
   * Reset cache and all statistics
   * Useful for testing
   */
  reset(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      currentSize: 0,
      entryCount: 0,
    };

    logger.info('Cache reset with stats cleared');
  }

  /**
   * Get current cache size in bytes
   */
  getSizeBytes(): number {
    return this.stats.currentSize;
  }

  /**
   * Get number of entries in cache
   */
  getEntryCount(): number {
    return this.stats.entryCount;
  }
}

// Singleton instance
export const templateCache = new TemplateCache();
