import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { build } from '../src/server';

describe('POST /generate - Data Contract Validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Validation failures (400)', () => {
    it('should return 400 when templateId is missing', async () => {
      const payload = {
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('templateId');
    });

    it('should return 400 when outputFormat is invalid', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'INVALID',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('outputFormat');
    });

    it('should return 400 when outputFileName is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('outputFileName');
    });

    it('should return 400 when locale is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('locale');
    });

    it('should return 400 when timezone is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('timezone');
    });

    it('should return 400 when options is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('options');
    });

    it('should return 400 when data is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('data');
    });
  });

  describe('Success cases (202)', () => {
    it('should return 202 with correlationId for minimal valid payload', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should return 202 for full valid payload with all optional fields', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'Opportunity_{{Opportunity.Name}}.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: true,
          returnDocxToBrowser: false,
        },
        parents: {
          AccountId: '001xx000000abcdXXX',
          OpportunityId: '006xx000000xyzABC',
          CaseId: null,
        },
        data: {
          Account: {
            Name: 'Acme Ltd',
            BillingCity: 'London',
            AnnualRevenue__formatted: '£1,200,000',
          },
          Opportunity: {
            Name: 'FY25 Renewal',
            CloseDate__formatted: '31 Oct 2025',
            TotalAmount__formatted: '£250,000',
            LineItems: [
              {
                Name: 'SKU-A',
                Qty: 10,
                UnitPrice__formatted: '£1,000',
                LineTotal__formatted: '£10,000',
              },
            ],
          },
        },
        requestHash:
          'sha256:a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should accept DOCX as outputFormat', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.docx',
        outputFormat: 'DOCX',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle correlation ID from header', async () => {
      const customCorrelationId = '12345678-1234-4567-89ab-123456789012';
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customCorrelationId,
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(customCorrelationId);
    });
  });

  describe('Edge cases and malformed payloads', () => {
    it('should return 400 for completely malformed JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'content-type': 'application/json',
        },
        payload: 'this is not json',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.statusCode).toBe(400);
      // Fastify returns SyntaxError for malformed JSON
      expect(body.error).toBe('SyntaxError');
    });

    it('should handle empty JSON object', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('required');
    });

    it('should handle null values in required fields', async () => {
      const payload = {
        templateId: null,
        outputFileName: null,
        outputFormat: null,
        locale: null,
        timezone: null,
        options: null,
        data: null,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject payload with parents=null (schema validation)', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
        parents: null,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      // Schema requires parents to be an object if present, not null
      expect(response.statusCode).toBe(400);
    });

    it('should accept payload without parents field', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
        // parents omitted
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should accept payload without requestHash field', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
        // requestHash omitted
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle very large data payload (>100KB)', async () => {
      // Create a large data object with 1000 line items
      const lineItems = Array.from({ length: 1000 }, (_, i) => ({
        Name: `Product ${i}`,
        Qty: i + 1,
        UnitPrice__formatted: `£${(i + 1) * 100}`,
        LineTotal__formatted: `£${(i + 1) * 100 * (i + 1)}`,
        Description: `This is a long description for product ${i} with lots of text to make the payload larger. `.repeat(
          10
        ),
      }));

      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'large_opportunity.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: {
          Opportunity: {
            Name: 'Large Opportunity',
            LineItems: lineItems,
          },
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle requestHash with sha256: prefix', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
        requestHash:
          'sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle different locale formats', async () => {
      const locales = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES'];

      for (const locale of locales) {
        const payload = {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale,
          timezone: 'Europe/London',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test Account' } },
        };

        const response = await app.inject({
          method: 'POST',
          url: '/generate',
          payload,
        });

        expect(response.statusCode).toBe(202);
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('correlationId');
      }
    });

    it('should handle different timezone formats', async () => {
      const timezones = [
        'Europe/London',
        'America/New_York',
        'Asia/Tokyo',
        'Australia/Sydney',
        'UTC',
      ];

      for (const timezone of timezones) {
        const payload = {
          templateId: '068xx000000abcdXXX',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone,
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: true,
          },
          data: { Account: { Name: 'Test Account' } },
        };

        const response = await app.inject({
          method: 'POST',
          url: '/generate',
          payload,
        });

        expect(response.statusCode).toBe(202);
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('correlationId');
      }
    });

    it('should handle empty data object', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: {},
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle nested data objects', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: {
          Account: {
            Name: 'Test Account',
            Owner: {
              Name: 'John Doe',
              Email: 'john.doe@example.com',
              Manager: {
                Name: 'Jane Smith',
                Email: 'jane.smith@example.com',
              },
            },
          },
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle special characters in data fields', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: {
          Account: {
            Name: 'Test & Co. <"Special"> Chars™',
            Description: "This contains 'quotes' and \"double quotes\" and newlines\nand tabs\t",
            Unicode: 'Émile, François, Müller, 日本語, 中文, Русский',
          },
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });
  });
});
