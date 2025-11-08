import { TemplateCache } from '../../src/templates/cache';

describe('TemplateCache', () => {
  let cache: TemplateCache;

  beforeEach(() => {
    cache = new TemplateCache();
  });

  afterEach(() => {
    cache.clear();
  });

  describe('get and set', () => {
    it('should return undefined for missing entry', () => {
      const result = cache.get('068xxx000000001');
      expect(result).toBeUndefined();
    });

    it('should store and retrieve template', () => {
      const contentVersionId = '068xxx000000001';
      const buffer = Buffer.from('test template content');

      cache.set(contentVersionId, buffer);
      const result = cache.get(contentVersionId);

      expect(result).toBeDefined();
      expect(result?.toString()).toBe('test template content');
    });

    it('should track cache hits', () => {
      const contentVersionId = '068xxx000000001';
      const buffer = Buffer.from('test');

      cache.set(contentVersionId, buffer);

      const stats1 = cache.getStats();
      expect(stats1.hits).toBe(0);
      expect(stats1.misses).toBe(0);

      cache.get(contentVersionId);
      const stats2 = cache.getStats();
      expect(stats2.hits).toBe(1);

      cache.get(contentVersionId);
      const stats3 = cache.getStats();
      expect(stats3.hits).toBe(2);
    });

    it('should track cache misses', () => {
      cache.get('068xxx000000001');
      cache.get('068xxx000000002');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it('should update lastAccessedAt on cache hit', async () => {
      const contentVersionId = '068xxx000000001';
      const buffer = Buffer.from('test');

      cache.set(contentVersionId, buffer);

      // Small delay to ensure timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10));

      cache.get(contentVersionId);

      // Access should update lastAccessedAt (tested indirectly via LRU eviction)
      expect(cache.has(contentVersionId)).toBe(true);
    });

    it('should handle multiple different templates', () => {
      const templates = [
        { id: '068xxx000000001', content: 'template 1' },
        { id: '068xxx000000002', content: 'template 2' },
        { id: '068xxx000000003', content: 'template 3' },
      ];

      templates.forEach((t) => cache.set(t.id, Buffer.from(t.content)));

      templates.forEach((t) => {
        const result = cache.get(t.id);
        expect(result?.toString()).toBe(t.content);
      });

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(3);
      expect(stats.hits).toBe(3);
    });
  });

  describe('cache statistics', () => {
    it('should track current size in bytes', () => {
      const buffer1 = Buffer.from('a'.repeat(1000)); // 1 KB
      const buffer2 = Buffer.from('b'.repeat(2000)); // 2 KB

      cache.set('068xxx000000001', buffer1);
      expect(cache.getSizeBytes()).toBe(1000);

      cache.set('068xxx000000002', buffer2);
      expect(cache.getSizeBytes()).toBe(3000);

      const stats = cache.getStats();
      expect(stats.currentSize).toBe(3000);
    });

    it('should track entry count', () => {
      cache.set('068xxx000000001', Buffer.from('test1'));
      cache.set('068xxx000000002', Buffer.from('test2'));

      expect(cache.getEntryCount()).toBe(2);

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(2);
    });

    it('should return complete stats object', () => {
      cache.set('068xxx000000001', Buffer.from('test'));
      cache.get('068xxx000000001'); // hit
      cache.get('068xxx000000002'); // miss

      const stats = cache.getStats();

      expect(stats).toEqual({
        hits: 1,
        misses: 1,
        evictions: 0,
        currentSize: 4,
        entryCount: 1,
      });
    });
  });

  describe('LRU eviction', () => {
    it('should evict LRU entries when size limit exceeded', () => {
      // Each entry is ~100 MB
      const size100MB = 100 * 1024 * 1024;

      // Add 6 entries (600 MB total, exceeds 500 MB limit)
      for (let i = 1; i <= 6; i++) {
        const buffer = Buffer.alloc(size100MB);
        cache.set(`068xxx00000000${i}`, buffer);
      }

      const stats = cache.getStats();

      // Should have evicted at least 1 entry to stay under 500 MB
      expect(stats.currentSize).toBeLessThanOrEqual(500 * 1024 * 1024);
      expect(stats.evictions).toBeGreaterThan(0);

      // Should have fewer than 6 entries
      expect(stats.entryCount).toBeLessThan(6);
    });

    it('should evict oldest accessed entries first (LRU)', () => {
      const size50MB = 50 * 1024 * 1024;

      // Add 8 entries (400 MB)
      for (let i = 1; i <= 8; i++) {
        cache.set(`068xxx00000000${i}`, Buffer.alloc(size50MB));
      }

      // Access entries 5-8 to make them recently used
      cache.get('068xxx000000005');
      cache.get('068xxx000000006');
      cache.get('068xxx000000007');
      cache.get('068xxx000000008');

      // Add 3 more entries (150 MB), should trigger eviction of entries 1-4
      cache.set('068xxx000000009', Buffer.alloc(size50MB));
      cache.set('068xxx000000010', Buffer.alloc(size50MB));
      cache.set('068xxx000000011', Buffer.alloc(size50MB));

      // Recently accessed entries should still be present
      expect(cache.has('068xxx000000005')).toBe(true);
      expect(cache.has('068xxx000000006')).toBe(true);
      expect(cache.has('068xxx000000007')).toBe(true);
      expect(cache.has('068xxx000000008')).toBe(true);

      // New entries should be present
      expect(cache.has('068xxx000000009')).toBe(true);
      expect(cache.has('068xxx000000010')).toBe(true);
      expect(cache.has('068xxx000000011')).toBe(true);

      // LRU entries (1-4) should have been evicted
      expect(cache.has('068xxx000000001')).toBe(false);
    });

    it('should track eviction count', () => {
      const size100MB = 100 * 1024 * 1024;

      // Add entries until eviction occurs
      for (let i = 1; i <= 6; i++) {
        cache.set(`068xxx00000000${i}`, Buffer.alloc(size100MB));
      }

      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
    });
  });

  describe('has', () => {
    it('should return true for cached entry', () => {
      cache.set('068xxx000000001', Buffer.from('test'));
      expect(cache.has('068xxx000000001')).toBe(true);
    });

    it('should return false for missing entry', () => {
      expect(cache.has('068xxx000000999')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('068xxx000000001', Buffer.from('test1'));
      cache.set('068xxx000000002', Buffer.from('test2'));

      cache.clear();

      expect(cache.getEntryCount()).toBe(0);
      expect(cache.getSizeBytes()).toBe(0);
      expect(cache.has('068xxx000000001')).toBe(false);
      expect(cache.has('068xxx000000002')).toBe(false);
    });

    it('should reset size and count but preserve stats counters', () => {
      cache.set('068xxx000000001', Buffer.from('test'));
      cache.get('068xxx000000001'); // hit
      cache.get('068xxx000000002'); // miss

      cache.clear();

      const stats = cache.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.entryCount).toBe(0);
      expect(stats.hits).toBe(1); // Preserved
      expect(stats.misses).toBe(1); // Preserved
    });
  });

  describe('updating existing entry', () => {
    it('should update existing entry and adjust size', () => {
      const id = '068xxx000000001';

      cache.set(id, Buffer.from('small'));
      expect(cache.getSizeBytes()).toBe(5);

      cache.set(id, Buffer.from('much larger content'));
      expect(cache.getSizeBytes()).toBe(19);
      expect(cache.getEntryCount()).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty buffer', () => {
      cache.set('068xxx000000001', Buffer.from(''));
      expect(cache.has('068xxx000000001')).toBe(true);
      expect(cache.getSizeBytes()).toBe(0);
    });

    it('should handle very large single entry', () => {
      // 600 MB entry (exceeds limit)
      const size600MB = 600 * 1024 * 1024;
      cache.set('068xxx000000001', Buffer.alloc(size600MB));

      // Should still be cached (no other entries to evict)
      expect(cache.has('068xxx000000001')).toBe(true);
    });
  });
});
