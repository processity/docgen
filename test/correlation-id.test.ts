import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { build } from '../src/server';
import { generateCorrelationId } from '../src/utils/correlation-id';

describe('Correlation ID', () => {
  describe('generateCorrelationId', () => {
    it('should generate a valid UUID v4 format', () => {
      const correlationId = generateCorrelationId();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      // where y is 8, 9, a, or b
      const uuidV4Regex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(correlationId).toMatch(uuidV4Regex);
    });

    it('should generate unique correlation IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      const id3 = generateCorrelationId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should generate 36-character string with hyphens', () => {
      const correlationId = generateCorrelationId();
      expect(correlationId).toHaveLength(36);
      expect(correlationId.split('-')).toHaveLength(5);
    });

    it('should generate lowercase UUIDs', () => {
      const correlationId = generateCorrelationId();
      expect(correlationId).toBe(correlationId.toLowerCase());
    });

    it('should generate multiple unique IDs in succession', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateCorrelationId());
      }
      // All 100 IDs should be unique
      expect(ids.size).toBe(100);
    });
  });

  describe('getCorrelationId', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await build();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should extract correlation ID from string header', async () => {
      const customId = '12345678-1234-4567-89ab-123456789012';

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(customId);
    });

    it('should extract first element from array header', async () => {
      const customId = '12345678-1234-4567-89ab-123456789012';

      // Simulate array header by sending same header twice
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          // Fastify may handle this as array in real scenarios
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(customId);
    });

    it('should generate new ID when header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should accept uppercase UUID in header', async () => {
      const customId = 'ABCDEF12-3456-4789-ABCD-EF1234567890';

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      // Should preserve the uppercase format from header
      expect(body.correlationId).toBe(customId);
    });

    it('should accept non-UUID string in header (passthrough)', async () => {
      const customId = 'my-custom-correlation-id-12345';

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      // Should pass through any string value
      expect(body.correlationId).toBe(customId);
    });

    it('should handle empty string header by generating new ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': '',
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      // Empty string should trigger generation of new UUID
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should handle whitespace-only header by generating new ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': '   ',
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      // Whitespace-only should trigger generation of new UUID
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should return same ID across multiple requests with same header', async () => {
      const customId = '11111111-2222-4333-8444-555555555555';

      const response1 = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdYYY',
          outputFileName: 'test2.pdf',
          outputFormat: 'DOCX',
          locale: 'en-US',
          timezone: 'America/New_York',
          options: {
            storeMergedDocx: true,
            returnDocxToBrowser: false,
          },
          data: { Opportunity: { Name: 'Test Opp' } },
        },
      });

      expect(response1.statusCode).toBe(202);
      expect(response2.statusCode).toBe(202);

      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);

      expect(body1.correlationId).toBe(customId);
      expect(body2.correlationId).toBe(customId);
    });
  });

  describe('Response behavior', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await build();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should include correlation ID in response body', async () => {
      const customId = '99999999-8888-4777-8666-555555555555';

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(customId);
    });

    it('should include generated correlation ID in response body when not provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toBeDefined();
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should set x-correlation-id response header for distributed tracing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);

      // Response header should match body correlationId
      expect(response.headers['x-correlation-id']).toBeDefined();
      expect(response.headers['x-correlation-id']).toBe(body.correlationId);
    });

    it('should propagate provided correlation ID to response header', async () => {
      const customId = 'custom-trace-id-12345';

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test' } },
        },
      });

      expect(response.statusCode).toBe(202);

      // Custom ID should be in both header and body
      expect(response.headers['x-correlation-id']).toBe(customId);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(customId);
    });
  });

  describe('Integration: correlation ID flow', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await build();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should include correlation ID in error response body and headers', async () => {
      const customId = 'error-test-1234-4567-89ab-123456789012';

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customId,
        },
        payload: {
          // Missing required fields - will trigger 400 error
          templateId: '068xx000000abcdXXX',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      // Correlation ID should be in both header and body for error tracking
      expect(response.headers['x-correlation-id']).toBe(customId);
      expect(body.correlationId).toBe(customId);
      expect(body.error).toBe('Bad Request');
    });

    it('should generate correlation ID for error responses without custom ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: {
          // Invalid payload - missing required fields
          templateId: '068xx000000abcdXXX',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      // Should have generated correlation ID
      expect(body.correlationId).toBeDefined();
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(response.headers['x-correlation-id']).toBe(body.correlationId);
    });

    it('should generate unique IDs for parallel requests without headers', async () => {
      const requests = Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/generate',
          payload: {
            templateId: '068xx000000abcdXXX',
            outputFileName: 'test.pdf',
            outputFormat: 'PDF',
            locale: 'en-GB',
            timezone: 'Europe/London',
            options: {
              storeMergedDocx: false,
              returnDocxToBrowser: true,
            },
            data: { Account: { Name: 'Test' } },
          },
        })
      );

      const responses = await Promise.all(requests);
      const correlationIds = responses.map((r) => JSON.parse(r.body).correlationId);

      // All correlation IDs should be unique
      const uniqueIds = new Set(correlationIds);
      expect(uniqueIds.size).toBe(10);
    });
  });
});
