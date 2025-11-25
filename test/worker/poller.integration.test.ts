import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { config } from 'dotenv';
import { pollerService } from '../../src/worker';
import { getSalesforceAuth } from '../../src/sf/auth';
import { SalesforceApi } from '../../src/sf/api';
import type { DocgenRequest } from '../../src/types';

// Load environment variables from .env file
config();

// Get Salesforce credentials from environment
const SFDX_AUTH_URL = process.env.SFDX_AUTH_URL;

// Check if we have all required credentials
const hasCredentials = !!SFDX_AUTH_URL;

// Conditionally run integration tests only when credentials are available
const describeIntegration = hasCredentials ? describe : describe.skip;

if (!hasCredentials) {
  console.log(`
================================================================================
SKIPPING POLLER INTEGRATION TESTS: Missing Salesforce credentials.

To run these tests locally, set SFDX_AUTH_URL in your .env file.
Generate it with: sf org display --verbose --json | jq -r '.result.sfdxAuthUrl'

For CI/CD, set SFDX_AUTH_URL as an environment variable or secret.
================================================================================
  `);
}

describeIntegration('Poller Service - Integration Tests with Real Salesforce', () => {
  let sfApi: SalesforceApi;
  let testTemplateId: string;
  let testTemplateRecordId: string; // Docgen_Template__c record ID
  let generatedDocumentId: string;

  beforeAll(async () => {
    // Set up environment for tests
    process.env.NODE_ENV = 'development';
    process.env.SFDX_AUTH_URL = SFDX_AUTH_URL;

    // Initialize Salesforce API - must create auth before getting it
    const { loadConfig } = await import('../../src/config');
    const config = await loadConfig();

    const { createSalesforceAuth } = await import('../../src/sf/auth');
    createSalesforceAuth({
      sfdxAuthUrl: config.sfdxAuthUrl!,
    });

    // NOW get the auth instance
    const sfAuth = getSalesforceAuth();
    if (!sfAuth) {
      throw new Error('Failed to initialize Salesforce auth');
    }
    sfApi = new SalesforceApi(sfAuth, sfAuth.getInstanceUrl());

    // Upload a test template to Salesforce
    const { createTestDocxBuffer } = await import('../helpers/test-docx');
    const docxTemplate = await createTestDocxBuffer();

    try {
      // Upload ContentVersion first
      const uploadResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/ContentVersion',
        {
          Title: 'Test Template for Poller Integration Tests',
          PathOnClient: 'test-poller-template.docx',
          VersionData: docxTemplate.toString('base64'),
        }
      );
      testTemplateId = uploadResponse.id;
      console.log(`Test template uploaded with ID: ${testTemplateId}`);

      // Create Docgen_Template__c record that references the ContentVersion
      const templateRecordResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/Docgen_Template__c',
        {
          Name: 'Test Template for Poller',
          PrimaryParent__c: 'Account',
          DataSource__c: 'SOQL',
          SOQL__c: 'SELECT Id, Name FROM Account WHERE Id = :recordId',
          TemplateContentVersionId__c: testTemplateId,
          StoreMergedDocx__c: false,
          ReturnDocxToBrowser__c: true,
        }
      );
      testTemplateRecordId = templateRecordResponse.id;
      console.log(`Test Docgen_Template__c created with ID: ${testTemplateRecordId}`);
    } catch (error) {
      console.error('Failed to upload test template:', error);
      throw error;
    }
  });

  afterAll(async () => {
    // Clean up: Delete test records
    if (generatedDocumentId) {
      try {
        await sfApi.delete(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`
        );
        console.log(`Cleaned up Generated_Document__c: ${generatedDocumentId}`);
      } catch (error) {
        console.warn('Failed to clean up Generated_Document__c:', error);
      }
    }

    // Delete Docgen_Template__c record first (before ContentDocument, due to reference)
    if (testTemplateRecordId) {
      try {
        await sfApi.delete(
          `/services/data/v59.0/sobjects/Docgen_Template__c/${testTemplateRecordId}`
        );
        console.log(`Cleaned up Docgen_Template__c: ${testTemplateRecordId}`);
      } catch (error) {
        console.warn('Failed to clean up Docgen_Template__c:', error);
      }
    }

    if (testTemplateId) {
      try {
        // Query for ContentDocumentId
        const query = `SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${testTemplateId}'`;
        const queryResponse = await sfApi.get<{ records: Array<{ ContentDocumentId: string }> }>(
          `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
        );
        if (queryResponse.records && queryResponse.records.length > 0) {
          const contentDocumentId = queryResponse.records[0].ContentDocumentId;
          await sfApi.delete(`/services/data/v59.0/sobjects/ContentDocument/${contentDocumentId}`);
          console.log(`Cleaned up ContentDocument: ${contentDocumentId}`);
        }
      } catch (error) {
        console.warn('Failed to clean up ContentDocument:', error);
      }
    }

    // Ensure poller is stopped
    if (pollerService.isRunning()) {
      await pollerService.stop();
    }
  });

  it('should process a QUEUED document end-to-end', async () => {
    // Create a Generated_Document__c record first to get the ID
    const tempRequest = {
      templateId: testTemplateId,
      outputFileName: 'Test_Integration_Output.pdf',
      outputFormat: 'PDF',
      requestHash: 'sha256:integration-test-hash-' + Date.now(),
    };

    const createResponse = await sfApi.post(
      '/services/data/v59.0/sobjects/Generated_Document__c',
      {
        Status__c: 'QUEUED',
        RequestJSON__c: '{}', // Temporary, will update
        RequestHash__c: tempRequest.requestHash,
        CorrelationId__c: 'test-' + Date.now().toString().slice(-10), // Keep under 36 chars
        Attempts__c: 0,
        Template__c: testTemplateRecordId, // Required by validation rule
      }
    );

    expect(createResponse.success).toBe(true);
    generatedDocumentId = createResponse.id;
    console.log(`Created Generated_Document__c with ID: ${generatedDocumentId}`);

    // Now prepare the full request envelope with the generatedDocumentId
    const requestEnvelope: DocgenRequest = {
      templateId: testTemplateId,
      outputFileName: 'Test_Integration_Output.pdf',
      outputFormat: 'PDF',
      locale: 'en-GB',
      timezone: 'Europe/London',
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false,
      },
      data: {
        Account: {
          Name: 'Integration Test Account',
          AnnualRevenue__formatted: '£1,000,000',
        },
        GeneratedDate__formatted: new Date().toLocaleDateString('en-GB'),
      },
      parents: {
        AccountId: null,
        OpportunityId: null,
        CaseId: null,
      },
      requestHash: tempRequest.requestHash,
      generatedDocumentId: generatedDocumentId, // Include the document ID
    };

    // Update the record with the complete RequestJSON
    await sfApi.patch(
      `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`,
      {
        RequestJSON__c: JSON.stringify(requestEnvelope),
      }
    );

    // Start the poller so processBatch() will actually run
    await pollerService.start();

    // Run a single poll cycle
    await pollerService.processBatch();

    // Stop the poller immediately to prevent continuous polling
    await pollerService.stop();

    // Wait a bit for async processing to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Query the document to check its status
    const query = `SELECT Id, Status__c, OutputFileId__c, Error__c FROM Generated_Document__c WHERE Id = '${generatedDocumentId}'`;
    const queryResponse = await sfApi.get<{ records: Array<{
      Id: string;
      Status__c: string;
      OutputFileId__c: string | null;
      Error__c: string | null;
    }> }>(
      `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
    );

    expect(queryResponse.records).toHaveLength(1);
    const document = queryResponse.records[0];

    console.log('Document status:', document.Status__c);
    console.log('Output file ID:', document.OutputFileId__c);
    console.log('Error:', document.Error__c);

    // Verify the document was processed successfully
    expect(document.Status__c).toBe('SUCCEEDED');
    expect(document.OutputFileId__c).toBeTruthy();
    expect(document.Error__c).toBeFalsy();
  }, 60000); // 60 second timeout for LibreOffice conversion

  it('should handle invalid template (404) with non-retryable error', async () => {
    // Create record first to get ID
    const tempRequest = {
      templateId: '068000000000000AAA', // Invalid ContentVersionId
      outputFileName: 'Invalid_Template_Test.pdf',
      outputFormat: 'PDF',
      requestHash: 'sha256:integration-test-invalid-' + Date.now(),
    };

    const createResponse = await sfApi.post(
      '/services/data/v59.0/sobjects/Generated_Document__c',
      {
        Status__c: 'QUEUED',
        RequestJSON__c: '{}', // Temporary
        RequestHash__c: tempRequest.requestHash,
        CorrelationId__c: 'test-inv-' + Date.now().toString().slice(-10), // Keep under 36 chars
        Attempts__c: 0,
        Template__c: testTemplateRecordId, // Required by validation rule
      }
    );

    const testDocId = createResponse.id;

    // Now prepare the full request envelope with the generatedDocumentId
    const requestEnvelope: DocgenRequest = {
      templateId: tempRequest.templateId,
      outputFileName: tempRequest.outputFileName,
      outputFormat: tempRequest.outputFormat as 'PDF',
      locale: 'en-GB',
      timezone: 'Europe/London',
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false,
      },
      data: {
        Account: {
          Name: 'Test Account',
        },
        GeneratedDate__formatted: new Date().toLocaleDateString('en-GB'),
      },
      parents: {
        AccountId: null,
        OpportunityId: null,
        CaseId: null,
      },
      requestHash: tempRequest.requestHash,
      generatedDocumentId: testDocId, // Include the document ID
    };

    // Update with complete RequestJSON
    await sfApi.patch(
      `/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`,
      {
        RequestJSON__c: JSON.stringify(requestEnvelope),
      }
    );

    try {
      // Start poller, process batch, then stop
      await pollerService.start();
      await pollerService.processBatch();
      await pollerService.stop();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Query the document
      const query = `SELECT Id, Status__c, Error__c, Attempts__c FROM Generated_Document__c WHERE Id = '${testDocId}'`;
      const queryResponse = await sfApi.get<{ records: Array<{
        Id: string;
        Status__c: string;
        Error__c: string | null;
        Attempts__c: number;
      }> }>(
        `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
      );

      const document = queryResponse.records[0];

      // Debug: print actual values
      console.log('Test 2 - Document Status:', document.Status__c);
      console.log('Test 2 - Document Error:', document.Error__c);
      console.log('Test 2 - Document Attempts:', document.Attempts__c);

      // Should be marked as FAILED immediately (non-retryable)
      expect(document.Status__c).toBe('FAILED');
      expect(document.Error__c).toContain('TEMPLATE_NOT_FOUND'); // Check for error code
      expect(document.Attempts__c).toBe(1); // Only 1 attempt for non-retryable
    } finally {
      // Clean up
      try {
        await sfApi.delete(`/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`);
      } catch (error) {
        console.warn('Failed to clean up test document:', error);
      }
    }
  }, 30000); // 30 second timeout

  it('should respect lock TTL and not double-process', async () => {
    // Create record first to get ID
    const tempRequest = {
      templateId: testTemplateId,
      outputFileName: 'Lock_Test.pdf',
      outputFormat: 'PDF',
      requestHash: 'sha256:integration-test-lock-' + Date.now(),
    };

    const createResponse = await sfApi.post(
      '/services/data/v59.0/sobjects/Generated_Document__c',
      {
        Status__c: 'QUEUED',
        RequestJSON__c: '{}', // Temporary
        RequestHash__c: tempRequest.requestHash,
        CorrelationId__c: 'test-lock-' + Date.now().toString().slice(-10), // Keep under 36 chars
        Attempts__c: 0,
        Template__c: testTemplateRecordId, // Required by validation rule
      }
    );

    const testDocId = createResponse.id;

    // Prepare full request envelope with generatedDocumentId
    const requestEnvelope: DocgenRequest = {
      templateId: tempRequest.templateId,
      outputFileName: tempRequest.outputFileName,
      outputFormat: tempRequest.outputFormat as 'PDF',
      locale: 'en-GB',
      timezone: 'Europe/London',
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false,
      },
      data: {
        Account: {
          Name: 'Lock Test Account',
        },
      },
      parents: {
        AccountId: null,
        OpportunityId: null,
        CaseId: null,
      },
      requestHash: tempRequest.requestHash,
      generatedDocumentId: testDocId,
    };

    // Update with complete RequestJSON
    await sfApi.patch(
      `/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`,
      {
        RequestJSON__c: JSON.stringify(requestEnvelope),
      }
    );

    try {
      // Manually lock the document (simulating another worker)
      const lockUntil = new Date(Date.now() + 120000).toISOString(); // 2 minutes
      await sfApi.patch(
        `/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`,
        {
          Status__c: 'PROCESSING',
          LockedUntil__c: lockUntil,
        }
      );

      // Start poller, try to process (should skip locked doc), then stop
      await pollerService.start();
      await pollerService.processBatch();
      await pollerService.stop();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Query the document - should still be PROCESSING
      const query = `SELECT Id, Status__c FROM Generated_Document__c WHERE Id = '${testDocId}'`;
      const queryResponse = await sfApi.get<{ records: Array<{
        Id: string;
        Status__c: string;
      }> }>(
        `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
      );

      const document = queryResponse.records[0];

      // Should still be PROCESSING (not processed by poller)
      expect(document.Status__c).toBe('PROCESSING');
    } finally {
      // Clean up
      try {
        await sfApi.delete(`/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`);
      } catch (error) {
        console.warn('Failed to clean up test document:', error);
      }
    }
  }, 30000); // 30 second timeout

  it('should process composite document end-to-end with Concatenate Templates strategy', async () => {
    // Upload a second template for concatenation
    const { createTestDocxBuffer } = await import('../helpers/test-docx');
    const docxTemplate2 = await createTestDocxBuffer();

    let secondTemplateId: string | null = null;
    let secondTemplateRecordId: string | null = null;
    let compositeDocId: string | null = null;

    try {
      // Upload second ContentVersion
      const uploadResponse2 = await sfApi.post(
        '/services/data/v59.0/sobjects/ContentVersion',
        {
          Title: 'Second Test Template for Composite',
          PathOnClient: 'test-composite-template2.docx',
          VersionData: docxTemplate2.toString('base64'),
        }
      );
      secondTemplateId = uploadResponse2.id;
      console.log(`Second template uploaded with ID: ${secondTemplateId}`);

      // Create second Docgen_Template__c record
      const templateRecordResponse2 = await sfApi.post(
        '/services/data/v59.0/sobjects/Docgen_Template__c',
        {
          Name: 'Second Test Template for Composite',
          PrimaryParent__c: 'Account',
          DataSource__c: 'SOQL',
          SOQL__c: 'SELECT Id, Name FROM Account WHERE Id = :recordId',
          TemplateContentVersionId__c: secondTemplateId,
          StoreMergedDocx__c: false,
          ReturnDocxToBrowser__c: false,
        }
      );
      secondTemplateRecordId = templateRecordResponse2.id;
      console.log(`Second Docgen_Template__c created with ID: ${secondTemplateRecordId}`);

      // Create a composite document request
      const tempRequest = {
        requestHash: 'sha256:integration-composite-' + Date.now(),
      };

      const createResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/Generated_Document__c',
        {
          Status__c: 'QUEUED',
          RequestJSON__c: '{}', // Temporary, will update
          RequestHash__c: tempRequest.requestHash,
          CorrelationId__c: 'comp-' + Date.now().toString().slice(-10),
          Attempts__c: 0,
          // No Template__c since this is a composite document
        }
      );

      compositeDocId = createResponse.id;
      console.log(`Created composite Generated_Document__c with ID: ${compositeDocId}`);

      // Prepare composite request envelope
      const requestEnvelope: DocgenRequest = {
        compositeDocumentId: 'a00composite001', // Mock composite doc ID
        templateStrategy: 'Concatenate Templates',
        templates: [
          { templateId: testTemplateId!, namespace: 'Account', sequence: 1 },
          { templateId: secondTemplateId!, namespace: 'Terms', sequence: 2 },
        ],
        outputFileName: 'Composite_Integration_Test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false,
        },
        data: {
          Account: {
            Name: 'Composite Test Account',
            GeneratedDate__formatted: new Date().toLocaleDateString('en-GB'),
          },
          Terms: {
            Payment: 'Net 30',
            GeneratedDate__formatted: new Date().toLocaleDateString('en-GB'),
          },
        },
        parents: {
          AccountId: null,
        },
        requestHash: tempRequest.requestHash,
        generatedDocumentId: compositeDocId!,
      };

      // Update with complete RequestJSON
      await sfApi.patch(
        `/services/data/v59.0/sobjects/Generated_Document__c/${compositeDocId}`,
        {
          RequestJSON__c: JSON.stringify(requestEnvelope),
        }
      );

      // Start poller, process batch, then stop
      await pollerService.start();
      await pollerService.processBatch();
      await pollerService.stop();

      // Wait for processing (composite might take longer due to concatenation)
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Query the document to check its status
      const query = `SELECT Id, Status__c, OutputFileId__c, Error__c FROM Generated_Document__c WHERE Id = '${compositeDocId}'`;
      const queryResponse = await sfApi.get<{ records: Array<{
        Id: string;
        Status__c: string;
        OutputFileId__c: string | null;
        Error__c: string | null;
      }> }>(
        `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
      );

      expect(queryResponse.records).toHaveLength(1);
      const document = queryResponse.records[0];

      console.log('Composite document status:', document.Status__c);
      console.log('Composite output file ID:', document.OutputFileId__c);
      console.log('Composite error:', document.Error__c);

      // Verify the composite document was processed successfully
      expect(document.Status__c).toBe('SUCCEEDED');
      expect(document.OutputFileId__c).toBeTruthy();
      expect(document.Error__c).toBeFalsy();
    } finally {
      // Clean up: Delete test records in correct order
      if (compositeDocId) {
        try {
          await sfApi.delete(`/services/data/v59.0/sobjects/Generated_Document__c/${compositeDocId}`);
          console.log(`Cleaned up composite Generated_Document__c: ${compositeDocId}`);
        } catch (error) {
          console.warn('Failed to clean up composite Generated_Document__c:', error);
        }
      }

      if (secondTemplateRecordId) {
        try {
          await sfApi.delete(`/services/data/v59.0/sobjects/Docgen_Template__c/${secondTemplateRecordId}`);
          console.log(`Cleaned up second Docgen_Template__c: ${secondTemplateRecordId}`);
        } catch (error) {
          console.warn('Failed to clean up second Docgen_Template__c:', error);
        }
      }

      if (secondTemplateId) {
        try {
          // Query for ContentDocumentId
          const query = `SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${secondTemplateId}'`;
          const queryResponse = await sfApi.get<{ records: Array<{ ContentDocumentId: string }> }>(
            `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
          );
          if (queryResponse.records && queryResponse.records.length > 0) {
            const contentDocumentId = queryResponse.records[0].ContentDocumentId;
            await sfApi.delete(`/services/data/v59.0/sobjects/ContentDocument/${contentDocumentId}`);
            console.log(`Cleaned up second ContentDocument: ${contentDocumentId}`);
          }
        } catch (error) {
          console.warn('Failed to clean up second ContentDocument:', error);
        }
      }
    }
  }, 90000); // 90 second timeout for composite processing (concatenation + conversion)
});
