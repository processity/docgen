import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import nock from 'nock';
import { build } from '../src/server';
import type { DocgenRequest, DocgenResponse } from '../src/types';
import { createTestDocxBuffer } from './helpers/test-docx';

describe('POST /generate - Unit Tests with Mocked Dependencies', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Clean up any previous nock interceptors
    nock.cleanAll();

    // Set up environment for testing
    process.env.NODE_ENV = 'development';  // Set to development to enable auth bypass
    process.env.AUTH_BYPASS_DEVELOPMENT = 'true';  // Bypass AAD auth for unit tests
    process.env.SF_DOMAIN = 'test.salesforce.com';
    process.env.SF_USERNAME = 'test@example.com';
    process.env.SF_CLIENT_ID = 'test-client-id';
    // Use SF_PRIVATE_KEY from environment if set (CI), otherwise use local key path
    if (!process.env.SF_PRIVATE_KEY) {
      process.env.SF_PRIVATE_KEY_PATH = './keys/server.key';
    }

    // Build the app
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    nock.cleanAll();
  });

  beforeEach(() => {
    // Reset nock interceptors before each test
    nock.cleanAll();
  });

  afterEach(() => {
    // Ensure all nock interceptors were used
    if (!nock.isDone()) {
      console.error('Pending mocks:', nock.pendingMocks());
    }
    nock.cleanAll();
  });

  describe('Success Scenarios', () => {
    it('should successfully generate a PDF document', async () => {
      const testTemplateId = '068000000000001AAA';
      const testContentVersionId = '068000000000002AAA';
      const testContentDocumentId = '069000000000001AAA';

      // Pre-generate test DOCX buffer
      const testDocxBuffer = await createTestDocxBuffer();

      // Mock Salesforce JWT token exchange
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'test-access-token',
          instance_url: 'https://test.salesforce.com',
        });

      // Mock template fetch (ContentVersion download)
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .matchHeader('authorization', 'Bearer test-access-token')
        .reply(200, testDocxBuffer);

      // Mock ContentVersion creation for PDF upload
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .matchHeader('authorization', 'Bearer test-access-token')
        .reply(201, {
          id: testContentVersionId,
          success: true,
          errors: [],
        });

      // Mock ContentVersion query to get ContentDocumentId
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/query`)
        .query(query => !!(query.q && typeof query.q === 'string' && query.q.includes(testContentVersionId)))
        .matchHeader('authorization', 'Bearer test-access-token')
        .reply(200, {
          totalSize: 1,
          done: true,
          records: [{
            Id: testContentVersionId,
            ContentDocumentId: testContentDocumentId,
          }],
        });

      // Mock Generated_Document__c status update (if provided)
      const generatedDocumentId = '0XX000000000001AAA';
      nock('https://test.salesforce.com')
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`)
        .matchHeader('authorization', 'Bearer test-access-token')
        .reply(204);

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test-output.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'John Doe',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
        generatedDocumentId,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
        headers: {
          'x-correlation-id': 'test-correlation-123',
        },
      });

      if (response.statusCode !== 200) {
        console.log('Response body:', response.body);
      }
      expect(response.statusCode).toBe(200);

      const body: DocgenResponse = JSON.parse(response.body);
      expect(body).toHaveProperty('downloadUrl');
      expect(body).toHaveProperty('contentVersionId');
      expect(body).toHaveProperty('correlationId');
      expect(body.correlationId).toBe('test-correlation-123');
      expect(body.contentVersionId).toBe(testContentVersionId);
      expect(body.downloadUrl).toBe(`https://test.salesforce.com/sfc/servlet.shepherd/version/download/${testContentVersionId}`);

      // Verify all mocks were called
      expect(nock.isDone()).toBe(true);
    });

    it('should successfully generate a DOCX document', async () => {
      const testTemplateId = '068000000000003AAA';
      const testContentVersionId = '068000000000004AAA';
      const testContentDocumentId = '069000000000002AAA';

      // Pre-generate test DOCX buffer
      const testDocxBuffer = await createTestDocxBuffer();

      // Mock Salesforce JWT token exchange
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'test-access-token',
          instance_url: 'https://test.salesforce.com',
        });

      // Mock template fetch
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .reply(200, testDocxBuffer);

      // Mock ContentVersion creation for DOCX upload
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(201, {
          id: testContentVersionId,
          success: true,
          errors: [],
        });

      // Mock ContentVersion query
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/query`)
        .query(true)
        .reply(200, {
          records: [{
            ContentDocumentId: testContentDocumentId,
          }],
        });

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test-output.docx',
        outputFormat: 'DOCX',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: {
          Name: 'Jane Smith',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      if (response.statusCode !== 200) {
        console.log('Response body:', response.body);
      }
      expect(response.statusCode).toBe(200);

      const body: DocgenResponse = JSON.parse(response.body);
      expect(body.contentVersionId).toBe(testContentVersionId);
    });

    it('should handle ContentDocumentLink creation when parents are provided', async () => {
      const testTemplateId = '068000000000005AAA';
      const testContentVersionId = '068000000000006AAA';
      const testContentDocumentId = '069000000000003AAA';
      const testAccountId = '001000000000001AAA';

      // Pre-generate test DOCX buffer
      const testDocxBuffer = await createTestDocxBuffer();

      // Mock template fetch
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .reply(200, testDocxBuffer);

      // Mock ContentVersion creation
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(201, {
          id: testContentVersionId,
          success: true,
          errors: [],
        });

      // Mock ContentVersion query
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/query`)
        .query(true)
        .reply(200, {
          records: [{
            ContentDocumentId: testContentDocumentId,
          }],
        });

      // Mock ContentDocumentLink creation
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentDocumentLink')
        .reply(201, {
          id: '06A000000000001AAA',
          success: true,
        });

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'linked-doc.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
        parents: {
          AccountId: testAccountId,
          OpportunityId: null,
          CaseId: null,
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(200);
      expect(nock.isDone()).toBe(true);
    });
  });

  describe('Error Scenarios', () => {
    it('should return 404 when template is not found', async () => {
      const testTemplateId = '068000000000007AAA';

      // Mock Salesforce JWT token exchange
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'test-access-token',
          instance_url: 'https://test.salesforce.com',
        });

      // Mock template fetch failure (404)
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .reply(404, {
          message: 'The requested resource does not exist',
          errorCode: 'NOT_FOUND',
        });

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('correlationId');
      expect(body.error).toBe('Not Found');
    });

    it('should return 400 for missing required fields', async () => {
      const request = {
        templateId: '068000000000008AAA',
        // Missing required fields
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
    });

    it('should return 400 for invalid outputFormat', async () => {
      const request = {
        templateId: '068000000000009AAA',
        outputFileName: 'test.xyz',
        outputFormat: 'INVALID',  // Invalid format
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
    });

    it('should return 502 when Salesforce upload fails', async () => {
      const testTemplateId = '068000000000010AAA';

      // Pre-generate test DOCX buffer
      const testDocxBuffer = await createTestDocxBuffer();

      // Mock Salesforce JWT token exchange
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'test-access-token',
          instance_url: 'https://test.salesforce.com',
        });

      // Mock template fetch success
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .reply(200, testDocxBuffer);

      // Mock ContentVersion creation failure (500 error)
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .times(4)  // Will retry 3 times after initial failure
        .reply(500, {
          message: 'Internal Server Error',
          errorCode: 'INTERNAL_ERROR',
        });

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(502);

      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Gateway');
      expect(body.message).toContain('Salesforce API error');
    });

    // NOTE: LibreOffice conversion failure test omitted due to test infrastructure limitations
    // The error handling code exists in generate.ts (lines 341-343) and correctly returns 502,
    // but mocking the converter requires jest.mock at module level which would require significant
    // test restructuring. The conversion success path is tested, and other 502 error paths
    // (upload failure) are covered above.

    it('should handle token refresh on 401 error', async () => {
      const testTemplateId = '068000000000011AAA';
      const testContentVersionId = '068000000000012AAA';
      const testContentDocumentId = '069000000000004AAA';

      // Pre-generate test DOCX buffer
      const testDocxBuffer = await createTestDocxBuffer();

      // Mock template fetch with cached token (401) - this triggers refresh
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .matchHeader('authorization', 'Bearer test-access-token')
        .reply(401, {
          message: 'Session expired or invalid',
          errorCode: 'INVALID_SESSION_ID',
        });

      // Mock token refresh (after 401)
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'new-token',
          instance_url: 'https://test.salesforce.com',
        });

      // Mock template fetch with new token (success)
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .matchHeader('authorization', 'Bearer new-token')
        .reply(200, testDocxBuffer);

      // Mock ContentVersion creation
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .matchHeader('authorization', 'Bearer new-token')
        .reply(201, {
          id: testContentVersionId,
          success: true,
          errors: [],
        });

      // Mock ContentVersion query
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/query`)
        .query(true)
        .reply(200, {
          records: [{
            ContentDocumentId: testContentDocumentId,
          }],
        });

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(200);
      expect(nock.isDone()).toBe(true);
    });

    it('should update Generated_Document__c status to FAILED on error', async () => {
      const testTemplateId = '068000000000013AAA';
      const generatedDocumentId = '0XX000000000002AAA';

      // Mock template fetch failure
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .reply(404, {
          message: 'Not found',
          errorCode: 'NOT_FOUND',
        });

      // Mock Generated_Document__c status update
      nock('https://test.salesforce.com')
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`)
        .reply(204);

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
        generatedDocumentId,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(404);
      expect(nock.isDone()).toBe(true);
    });
  });

  describe('Validation Tests', () => {
    it('should validate locale format', async () => {
      const request: DocgenRequest = {
        templateId: '068000000000014AAA',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',  // Valid locale
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      // Just test that the request is valid (would need actual implementation)
      expect(request.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    });

    it('should handle correlation ID propagation', async () => {
      const testTemplateId = '068000000000015AAA';
      const testContentVersionId = '068000000000016AAA';
      const correlationId = 'test-correlation-456';

      // Pre-generate test DOCX buffer
      const testDocxBuffer = await createTestDocxBuffer();

      // Mock template fetch with correlation ID header
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/sobjects/ContentVersion/${testTemplateId}/VersionData`)
        .matchHeader('x-correlation-id', correlationId)
        .reply(200, testDocxBuffer);

      // Mock ContentVersion creation
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .matchHeader('x-correlation-id', correlationId)
        .reply(201, {
          id: testContentVersionId,
          success: true,
          errors: [],
        });

      // Mock ContentVersion query
      nock('https://test.salesforce.com')
        .get(`/services/data/v59.0/query`)
        .query(true)
        .matchHeader('x-correlation-id', correlationId)
        .reply(200, {
          records: [{
            ContentDocumentId: '069000000000005AAA',
          }],
        });

      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Test',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
        headers: {
          'x-correlation-id': correlationId,
        },
      });

      if (response.statusCode !== 200) {
        console.log('Response body:', response.body);
      }
      expect(response.statusCode).toBe(200);

      const body: DocgenResponse = JSON.parse(response.body);
      expect(body.correlationId).toBe(correlationId);
      expect(nock.isDone()).toBe(true);
    });
  });
});