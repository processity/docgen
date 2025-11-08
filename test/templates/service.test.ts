import nock from 'nock';
import { TemplateService } from '../../src/templates/service';
import { SalesforceApi } from '../../src/sf/api';
import { SalesforceAuth } from '../../src/sf/auth';
import { templateCache } from '../../src/templates/cache';

describe('TemplateService', () => {
  let service: TemplateService;
  let sfApi: SalesforceApi;
  const SF_DOMAIN = 'https://example.my.salesforce.com';
  const CONTENT_VERSION_ID = '068xxx000000001AAA';

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    // Reset cache and stats before each test
    templateCache.reset();

    // Mock Salesforce auth
    const mockAuth = {
      getAccessToken: jest.fn().mockResolvedValue('mock_access_token'),
      invalidateToken: jest.fn(),
    } as unknown as SalesforceAuth;

    sfApi = new SalesforceApi(mockAuth, SF_DOMAIN);
    service = new TemplateService(sfApi);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getTemplate', () => {
    it('should fetch template from Salesforce on cache miss', async () => {
      const templateBuffer = Buffer.from('mock template content');

      // Mock Salesforce API call
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(200, templateBuffer);

      const result = await service.getTemplate(CONTENT_VERSION_ID);

      expect(result).toEqual(templateBuffer);
      expect(result.toString()).toBe('mock template content');
    });

    it('should return cached template on subsequent requests', async () => {
      const templateBuffer = Buffer.from('mock template content');

      // Mock Salesforce API call - should only be called once
      const scope = nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(200, templateBuffer);

      // First call - cache miss, fetches from SF
      const result1 = await service.getTemplate(CONTENT_VERSION_ID);
      expect(result1).toEqual(templateBuffer);

      // Second call - cache hit, no SF call
      const result2 = await service.getTemplate(CONTENT_VERSION_ID);
      expect(result2).toEqual(templateBuffer);

      // Verify only one SF API call was made
      expect(scope.isDone()).toBe(true);

      // Verify cache stats
      const stats = service.getCacheStats();
      expect(stats.hits).toBe(1); // Second call was a hit
      expect(stats.misses).toBe(1); // First call was a miss
    });

    it('should cache templates by ContentVersionId', async () => {
      const template1 = Buffer.from('template 1 content');
      const template2 = Buffer.from('template 2 content');

      const id1 = '068xxx000000001AAA';
      const id2 = '068xxx000000002AAA';

      // Mock both API calls
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${id1}/VersionData`)
        .reply(200, template1);

      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${id2}/VersionData`)
        .reply(200, template2);

      const result1 = await service.getTemplate(id1);
      const result2 = await service.getTemplate(id2);

      expect(result1.toString()).toBe('template 1 content');
      expect(result2.toString()).toBe('template 2 content');

      // Both should be cached
      expect(service.isTemplateInCache(id1)).toBe(true);
      expect(service.isTemplateInCache(id2)).toBe(true);
    });

    it('should pass correlation ID to SF API', async () => {
      const templateBuffer = Buffer.from('test');
      const correlationId = 'test-correlation-123';

      const scope = nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .matchHeader('x-correlation-id', correlationId)
        .reply(200, templateBuffer);

      await service.getTemplate(CONTENT_VERSION_ID, correlationId);

      expect(scope.isDone()).toBe(true);
    });

    it('should throw error if SF API fails', async () => {
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(404, { error: 'Not Found' });

      await expect(service.getTemplate(CONTENT_VERSION_ID)).rejects.toThrow(
        /Failed to fetch template/
      );
    });

    it('should throw error if SF API returns 500', async () => {
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(500)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(500)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(500)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(500);

      await expect(service.getTemplate(CONTENT_VERSION_ID)).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .replyWithError('Network error')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .replyWithError('Network error')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .replyWithError('Network error')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .replyWithError('Network error');

      await expect(service.getTemplate(CONTENT_VERSION_ID)).rejects.toThrow();
    });
  });

  describe('isTemplateInCache', () => {
    it('should return false for uncached template', () => {
      expect(service.isTemplateInCache(CONTENT_VERSION_ID)).toBe(false);
    });

    it('should return true for cached template', async () => {
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(200, Buffer.from('test'));

      await service.getTemplate(CONTENT_VERSION_ID);

      expect(service.isTemplateInCache(CONTENT_VERSION_ID)).toBe(true);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const template = Buffer.from('test content');

      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(200, template);

      await service.getTemplate(CONTENT_VERSION_ID);
      await service.getTemplate(CONTENT_VERSION_ID); // Cache hit

      const stats = service.getCacheStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.entryCount).toBe(1);
      expect(stats.currentSize).toBe(template.length);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached templates', async () => {
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(200, Buffer.from('test'));

      await service.getTemplate(CONTENT_VERSION_ID);
      expect(service.isTemplateInCache(CONTENT_VERSION_ID)).toBe(true);

      service.clearCache();

      expect(service.isTemplateInCache(CONTENT_VERSION_ID)).toBe(false);
      const stats = service.getCacheStats();
      expect(stats.entryCount).toBe(0);
    });
  });

  describe('immutability of templates', () => {
    it('should safely cache templates by immutable ContentVersionId', async () => {
      const template = Buffer.from('original template');

      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(200, template);

      // Get template multiple times
      const result1 = await service.getTemplate(CONTENT_VERSION_ID);
      const result2 = await service.getTemplate(CONTENT_VERSION_ID);
      const result3 = await service.getTemplate(CONTENT_VERSION_ID);

      // All results should be identical (same ContentVersionId = same content)
      expect(result1.toString()).toBe('original template');
      expect(result2.toString()).toBe('original template');
      expect(result3.toString()).toBe('original template');

      // Only one SF API call should have been made
      const stats = service.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(2);
    });
  });

  describe('error handling with detailed messages', () => {
    it('should provide clear error message with ContentVersionId', async () => {
      nock(SF_DOMAIN)
        .get(`/services/data/v59.0/sobjects/ContentVersion/${CONTENT_VERSION_ID}/VersionData`)
        .reply(404);

      await expect(service.getTemplate(CONTENT_VERSION_ID)).rejects.toThrow(
        new RegExp(CONTENT_VERSION_ID)
      );
    });
  });
});
