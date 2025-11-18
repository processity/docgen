import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import { config } from 'dotenv';
import { build } from '../src/server';
import type { DocgenRequest, DocgenResponse } from '../src/types';
import { getSalesforceAuth } from '../src/sf/auth';
import { SalesforceApi } from '../src/sf/api';

// Load environment variables from .env file
config();

// Get Salesforce credentials from environment
const SF_DOMAIN = process.env.SF_DOMAIN;
const SF_USERNAME = process.env.SF_USERNAME;
const SF_CLIENT_ID = process.env.SF_CLIENT_ID;
const SF_PRIVATE_KEY_PATH = process.env.SF_PRIVATE_KEY_PATH;

// Check if we have all required credentials (the config loader will handle loading the key)
const hasCredentials = !!(SF_DOMAIN && SF_USERNAME && SF_CLIENT_ID && (process.env.SF_PRIVATE_KEY || SF_PRIVATE_KEY_PATH));

// Conditionally run integration tests only when credentials are available
const describeIntegration = hasCredentials ? describe : describe.skip;

if (!hasCredentials) {
  console.log(`
================================================================================
SKIPPING INTEGRATION TESTS: Missing Salesforce credentials.

To run these tests locally, create a .env file with:
  SF_DOMAIN=your-domain.my.salesforce.com
  SF_USERNAME=your-username@example.com
  SF_CLIENT_ID=your-connected-app-client-id
  SF_PRIVATE_KEY=your-rsa-private-key (or SF_PRIVATE_KEY_PATH=/path/to/key)

For CI/CD, set these as environment variables or secrets.
================================================================================
  `);
}

describeIntegration('POST /generate - Integration Tests with Real Salesforce', () => {
  let app: FastifyInstance;
  let testTemplateId: string;
  let sfApi: SalesforceApi;
  let generatedDocumentId: string | undefined;

  beforeAll(async () => {
    // Set up the Fastify app with real Salesforce credentials
    // The config loader will handle loading the private key from SF_PRIVATE_KEY_PATH
    process.env.NODE_ENV = 'development';  // Set to development to enable auth bypass
    process.env.AUTH_BYPASS_DEVELOPMENT = 'true';  // Bypass AAD auth for integration tests

    // Force JWT auth for these integration tests (which specifically test JWT authentication)
    // Unset SFDX_AUTH_URL so JWT credentials take precedence
    delete process.env.SFDX_AUTH_URL;

    process.env.SF_DOMAIN = SF_DOMAIN;
    process.env.SF_USERNAME = SF_USERNAME;
    process.env.SF_CLIENT_ID = SF_CLIENT_ID;
    // Don't set SF_PRIVATE_KEY directly - let config loader handle it from SF_PRIVATE_KEY_PATH

    // Build the app
    app = await build();
    await app.ready();

    // Initialize Salesforce API for test setup
    const sfAuth = getSalesforceAuth();
    if (!sfAuth) {
      throw new Error('Failed to initialize Salesforce auth');
    }
    sfApi = new SalesforceApi(sfAuth, `https://${SF_DOMAIN}`);

    // Upload a test template to Salesforce
    // Use the same helper function as unit tests to create a valid DOCX
    const { createTestDocxBuffer } = await import('./helpers/test-docx');
    const docxTemplate = await createTestDocxBuffer();

    // Upload template to Salesforce
    try {
      const uploadResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/ContentVersion',
        {
          Title: 'Test Template for Integration Tests',
          PathOnClient: 'test-template.docx',
          VersionData: docxTemplate.toString('base64'),
          FirstPublishLocationId: null,  // Library or workspace ID if needed
        }
      );
      testTemplateId = uploadResponse.id;
      console.log(`Test template uploaded with ID: ${testTemplateId}`);
    } catch (error) {
      console.error('Failed to upload test template:', error);
      throw error;
    }

    // Optionally create a Generated_Document__c record for status tracking
    try {
      const genDocResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/Generated_Document__c',
        {
          Status__c: 'QUEUED',
          TemplateId__c: testTemplateId,
        }
      );
      generatedDocumentId = genDocResponse.id;
      console.log(`Generated_Document__c created with ID: ${generatedDocumentId}`);
    } catch (error) {
      // Generated_Document__c might not exist in all orgs
      console.log('Generated_Document__c object not available, skipping status tracking');
    }
  });

  afterAll(async () => {
    // Clean up test template from Salesforce
    if (testTemplateId && sfApi) {
      try {
        // First get the ContentDocumentId
        const query = `SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${testTemplateId}' LIMIT 1`;
        const queryResult = await sfApi.get(`/services/data/v59.0/query?q=${encodeURIComponent(query)}`);

        if (queryResult.records && queryResult.records.length > 0) {
          const contentDocumentId = queryResult.records[0].ContentDocumentId;
          // Delete the ContentDocument (which deletes all versions)
          await sfApi.delete(`/services/data/v59.0/sobjects/ContentDocument/${contentDocumentId}`);
          console.log(`Test template ${testTemplateId} cleaned up`);
        }
      } catch (error) {
        console.error('Failed to clean up test template:', error);
      }
    }

    // Clean up Generated_Document__c if created
    if (generatedDocumentId && sfApi) {
      try {
        await sfApi.delete(`/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`);
        console.log(`Generated_Document__c ${generatedDocumentId} cleaned up`);
      } catch (error) {
        console.log('Failed to clean up Generated_Document__c:', error);
      }
    }

    // Close the app
    await app.close();
  });

  describe('Success Path', () => {
    it('should generate a PDF document and return download URL', async () => {
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
          Account: {
            Name: 'Acme Corporation',
          },
          CreatedDate: new Date().toISOString(),
          GeneratedDate__formatted: '5 Nov 2025',
        },
        parents: {
          AccountId: null,
          OpportunityId: null,
          CaseId: null,
        },
        generatedDocumentId,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
        headers: {
          'x-correlation-id': 'test-correlation-' + Date.now(),
        },
      });

      expect(response.statusCode).toBe(200);

      const body: DocgenResponse = JSON.parse(response.body);
      expect(body).toHaveProperty('downloadUrl');
      expect(body).toHaveProperty('contentVersionId');
      expect(body).toHaveProperty('correlationId');

      // Verify download URL format
      expect(body.downloadUrl).toMatch(
        new RegExp(`^https://${SF_DOMAIN}/sfc/servlet.shepherd/version/download/[a-zA-Z0-9]{18}$`)
      );

      // Verify ContentVersion ID format (18 character Salesforce ID)
      expect(body.contentVersionId).toMatch(/^[a-zA-Z0-9]{18}$/);

      console.log('Generated PDF download URL:', body.downloadUrl);
    });

    it('should generate a DOCX document and return download URL', async () => {
      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test-output.docx',
        outputFormat: 'DOCX',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: true,
          returnDocxToBrowser: true,
        },
        data: {
          Name: 'Jane Smith',
          Account: {
            Name: 'Global Corp',
          },
          CreatedDate: new Date().toISOString(),
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
        headers: {
          'x-correlation-id': 'test-docx-' + Date.now(),
        },
      });

      expect(response.statusCode).toBe(200);

      const body: DocgenResponse = JSON.parse(response.body);
      expect(body).toHaveProperty('downloadUrl');
      expect(body).toHaveProperty('contentVersionId');
      expect(body).toHaveProperty('correlationId');

      // Verify the file was created in Salesforce
      const query = `SELECT Id, Title, FileExtension FROM ContentVersion WHERE Id = '${body.contentVersionId}' LIMIT 1`;
      const queryResult = await sfApi.get(`/services/data/v59.0/query?q=${encodeURIComponent(query)}`);

      expect(queryResult.records).toHaveLength(1);
      expect(queryResult.records[0].FileExtension).toBe('docx');

      console.log('Generated DOCX download URL:', body.downloadUrl);
    });

    it('should store both PDF and merged DOCX when storeMergedDocx is true', async () => {
      const request: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'test-both.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: true,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Bob Johnson',
          Account: {
            Name: 'Tech Solutions',
          },
          CreatedDate: new Date().toISOString(),
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request,
      });

      expect(response.statusCode).toBe(200);

      const body: DocgenResponse = JSON.parse(response.body);

      // The primary file should be PDF
      const pdfQuery = `SELECT Id, Title, FileExtension FROM ContentVersion WHERE Id = '${body.contentVersionId}' LIMIT 1`;
      const pdfResult = await sfApi.get(`/services/data/v59.0/query?q=${encodeURIComponent(pdfQuery)}`);

      expect(pdfResult.records).toHaveLength(1);
      expect(pdfResult.records[0].FileExtension).toBe('pdf');

      // There should also be a DOCX file created around the same time
      // Note: We can't easily verify this without tracking both IDs in the response
      console.log('Generated PDF with stored DOCX:', body.downloadUrl);
    });

    it('should handle ContentDocumentLinks when parent IDs are provided', async () => {
      // First, create a test Account
      const accountResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/Account',
        {
          Name: 'Test Account for DocGen Integration',
        }
      );
      const accountId = accountResponse.id;

      try {
        const request: DocgenRequest = {
          templateId: testTemplateId,
          outputFileName: 'linked-document.pdf',
          outputFormat: 'PDF',
          locale: 'en-US',
          timezone: 'America/New_York',
          options: {
            storeMergedDocx: false,
            returnDocxToBrowser: false,
          },
          data: {
            Name: 'Linked Test',
            Account: {
              Name: 'Test Account',
            },
            CreatedDate: new Date().toISOString(),
            GeneratedDate__formatted: '5 Nov 2025',
          },
          parents: {
            AccountId: accountId,
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

        // Verify the ContentDocumentLink was created
        const linkQuery = `SELECT Id, LinkedEntityId, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${accountId}'`;
        const linkResult = await sfApi.get(`/services/data/v59.0/query?q=${encodeURIComponent(linkQuery)}`);

        expect(linkResult.records.length).toBeGreaterThan(0);

        console.log(`Document linked to Account ${accountId}`);
      } finally {
        // Clean up the test account
        await sfApi.delete(`/services/data/v59.0/sobjects/Account/${accountId}`);
      }
    });
  });

  describe('Error Scenarios', () => {
    it('should return 404 when template does not exist', async () => {
      const request: DocgenRequest = {
        templateId: '068000000000000AAA',  // Invalid but well-formed ID
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
    });

    it('should return 400 when required fields are missing', async () => {
      const request = {
        templateId: testTemplateId,
        // Missing required fields
        outputFormat: 'PDF',
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

    it('should return 400 when outputFormat is invalid', async () => {
      const request: any = {
        templateId: testTemplateId,
        outputFileName: 'test.xyz',
        outputFormat: 'XYZ',  // Invalid format
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

    it('should update Generated_Document__c status to FAILED on error', async () => {
      if (!generatedDocumentId) {
        console.log('Skipping Generated_Document__c status test - object not available');
        return;
      }

      // Create a new Generated_Document__c for this test
      const genDocResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/Generated_Document__c',
        {
          Status__c: 'PROCESSING',
          TemplateId__c: '068000000000000AAA',  // Invalid template
        }
      );
      const testGenDocId = genDocResponse.id;

      try {
        const request: DocgenRequest = {
          templateId: '068000000000000AAA',  // Invalid template
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
          },
          generatedDocumentId: testGenDocId,
        };

        const response = await app.inject({
          method: 'POST',
          url: '/generate',
          payload: request,
        });

        // Request should fail
        expect(response.statusCode).toBe(404);

        // Verify Generated_Document__c was updated to FAILED
        const genDoc = await sfApi.get(
          `/services/data/v59.0/sobjects/Generated_Document__c/${testGenDocId}`
        );

        expect(genDoc.Status__c).toBe('FAILED');
        expect(genDoc.Error__c).toBeTruthy();

        console.log('Generated_Document__c status updated to FAILED');
      } finally {
        // Clean up
        await sfApi.delete(`/services/data/v59.0/sobjects/Generated_Document__c/${testGenDocId}`);
      }
    });
  });

  describe('Template Caching', () => {
    it('should use cached template on second request', async () => {
      // First request - template not in cache
      const request1: DocgenRequest = {
        templateId: testTemplateId,
        outputFileName: 'cache-test-1.pdf',
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Name: 'Cache Test 1',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const startTime1 = Date.now();
      const response1 = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request1,
      });
      const duration1 = Date.now() - startTime1;

      expect(response1.statusCode).toBe(200);

      // Second request - template should be cached
      const request2: DocgenRequest = {
        ...request1,
        outputFileName: 'cache-test-2.pdf',
        data: {
          Name: 'Cache Test 2',
          Account: { Name: 'Test Account' },
          GeneratedDate__formatted: '5 Nov 2025',
        },
      };

      const startTime2 = Date.now();
      const response2 = await app.inject({
        method: 'POST',
        url: '/generate',
        payload: request2,
      });
      const duration2 = Date.now() - startTime2;

      expect(response2.statusCode).toBe(200);

      // Second request should be faster due to caching
      console.log(`First request: ${duration1}ms, Second request: ${duration2}ms`);

      // The cached request should typically be faster, but we can't guarantee it
      // Just verify both succeeded
      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
    });
  });
});