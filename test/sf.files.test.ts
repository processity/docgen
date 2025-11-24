import nock from 'nock';
import { generateKeyPairSync } from 'crypto';
import { SalesforceAuth, resetSalesforceAuth } from '../src/sf/auth';
import { SalesforceApi } from '../src/sf/api';
import {
  uploadContentVersion,
  updateGeneratedDocument,
  uploadAndLinkFiles,
} from '../src/sf/files';
import type { DocgenRequest } from '../src/types';

// Generate test RSA key pair
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const MOCK_AUTH_CONFIG = {
  sfDomain: 'test.salesforce.com',
  sfUsername: 'test@example.com',
  sfClientId: '3MVG9TEST_CLIENT_ID',
  sfPrivateKey: privateKey,
};

const MOCK_TOKEN_RESPONSE = {
  access_token: 'test-access-token',
  token_type: 'Bearer',
  expires_in: 7200,
  scope: 'api web',
  instance_url: 'https://test.salesforce.com',
  id: 'https://login.salesforce.com/id/00D.../005...',
};

describe('Salesforce File Upload & Linking (T-12)', () => {
  let auth: SalesforceAuth;
  let api: SalesforceApi;

  beforeEach(() => {
    nock.cleanAll();
    resetSalesforceAuth();
    auth = new SalesforceAuth(MOCK_AUTH_CONFIG);
    api = new SalesforceApi(auth, 'https://test.salesforce.com');

    // Mock token acquisition by default
    nock('https://login.salesforce.com')
      .post('/services/oauth2/token')
      .reply(200, MOCK_TOKEN_RESPONSE);
  });

  afterEach(() => {
    nock.cleanAll();
    resetSalesforceAuth();
  });

  describe('uploadContentVersion', () => {
    const testBuffer = Buffer.from('fake PDF content');
    const fileName = 'TestDocument.pdf';

    it('should upload ContentVersion and return IDs', async () => {
      const contentVersionId = '068xx000000abcdXXX';

      // Mock ContentVersion creation
      const createScope = nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion', (body) => {
          expect(body.Title).toBe('TestDocument');
          expect(body.PathOnClient).toBe(fileName);
          expect(body.VersionData).toBeTruthy(); // Base64 string
          return true;
        })
        .matchHeader('Authorization', 'Bearer test-access-token')
        .reply(201, {
          id: contentVersionId,
          success: true,
          errors: [],
        });

      // Mock query to get ContentDocumentId
      const queryScope = nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query({
          q: `SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${contentVersionId}' LIMIT 1`,
        })
        .reply(200, {
          records: [
            {
              Id: contentVersionId,
              ContentDocumentId: '069xx000000defgYYY',
            },
          ],
          totalSize: 1,
        });

      const result = await uploadContentVersion(testBuffer, fileName, api);

      expect(result.contentVersionId).toBe(contentVersionId);
      expect(result.contentDocumentId).toBe('069xx000000defgYYY');
      expect(createScope.isDone()).toBe(true);
      expect(queryScope.isDone()).toBe(true);
    });

    it('should handle custom filename with special characters', async () => {
      const specialFileName = 'Invoice_£1,000_{{Name}}.pdf';
      const contentVersionId = '068xx000000specialXXX';

      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion', (body) => {
          expect(body.PathOnClient).toBe(specialFileName);
          return true;
        })
        .reply(201, {
          id: contentVersionId,
          success: true,
          errors: [],
        });

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          records: [
            {
              Id: contentVersionId,
              ContentDocumentId: '069xx000000specialYYY',
            },
          ],
          totalSize: 1,
        });

      const result = await uploadContentVersion(testBuffer, specialFileName, api);

      expect(result.contentVersionId).toBe(contentVersionId);
    });

    it('should retry on 5xx error and succeed', async () => {
      const contentVersionId = '068xx000000retryXXX';

      // First attempt fails with 503
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(503, { message: 'Service Unavailable' });

      // Second attempt succeeds
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(201, {
          id: contentVersionId,
          success: true,
          errors: [],
        });

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          records: [
            {
              Id: contentVersionId,
              ContentDocumentId: '069xx000000retryYYY',
            },
          ],
          totalSize: 1,
        });

      const result = await uploadContentVersion(testBuffer, fileName, api);

      expect(result.contentVersionId).toBe(contentVersionId);
    });

    it('should throw on 4xx error without retry', async () => {
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(400, {
          message: 'Bad Request',
          errorCode: 'INVALID_FIELD',
        });

      await expect(uploadContentVersion(testBuffer, fileName, api)).rejects.toThrow();
    });

    it('should propagate correlation ID', async () => {
      const contentVersionId = '068xx000000correlXXX';
      const correlationId = 'test-correlation-123';

      const createScope = nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .matchHeader('x-correlation-id', correlationId)
        .reply(201, {
          id: contentVersionId,
          success: true,
          errors: [],
        });

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query(true)
        .matchHeader('x-correlation-id', correlationId)
        .reply(200, {
          records: [
            {
              Id: contentVersionId,
              ContentDocumentId: '069xx000000correlYYY',
            },
          ],
          totalSize: 1,
        });

      await uploadContentVersion(testBuffer, fileName, api, { correlationId });

      expect(createScope.isDone()).toBe(true);
    });
  });

  describe('updateGeneratedDocument', () => {
    const generatedDocumentId = 'a00xx000000gdocXXX';

    it('should update Generated_Document__c with SUCCEEDED status and OutputFileId', async () => {
      const updateScope = nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`,
          (body) => {
            expect(body.Status__c).toBe('SUCCEEDED');
            expect(body.OutputFileId__c).toBe('068xx000000pdfXXX');
            return true;
          }
        )
        .matchHeader('Authorization', 'Bearer test-access-token')
        .reply(204); // Salesforce PATCH returns 204 No Content on success

      await updateGeneratedDocument(
        generatedDocumentId,
        {
          Status__c: 'SUCCEEDED',
          OutputFileId__c: '068xx000000pdfXXX',
        },
        api
      );

      expect(updateScope.isDone()).toBe(true);
    });

    it('should update with both PDF and DOCX file IDs when storeMergedDocx=true', async () => {
      const updateScope = nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`,
          (body) => {
            expect(body.Status__c).toBe('SUCCEEDED');
            expect(body.OutputFileId__c).toBe('068xx000000pdfXXX');
            expect(body.MergedDocxFileId__c).toBe('068xx000000docxYYY');
            return true;
          }
        )
        .reply(204);

      await updateGeneratedDocument(
        generatedDocumentId,
        {
          Status__c: 'SUCCEEDED',
          OutputFileId__c: '068xx000000pdfXXX',
          MergedDocxFileId__c: '068xx000000docxYYY',
        },
        api
      );

      expect(updateScope.isDone()).toBe(true);
    });

    it('should update with FAILED status and Error message', async () => {
      const errorMessage = 'LibreOffice conversion timeout';

      const updateScope = nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`,
          (body) => {
            expect(body.Status__c).toBe('FAILED');
            expect(body.Error__c).toBe(errorMessage);
            return true;
          }
        )
        .reply(204);

      await updateGeneratedDocument(
        generatedDocumentId,
        {
          Status__c: 'FAILED',
          Error__c: errorMessage,
        },
        api
      );

      expect(updateScope.isDone()).toBe(true);
    });

    it('should retry on 5xx errors', async () => {
      // First attempt fails
      nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`
        )
        .reply(503, { message: 'Service Unavailable' });

      // Second attempt succeeds
      nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`
        )
        .reply(204);

      await updateGeneratedDocument(
        generatedDocumentId,
        { Status__c: 'SUCCEEDED' },
        api
      );
    });

    it('should throw on 4xx errors (no retry)', async () => {
      nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`
        )
        .reply(404, {
          message: 'Record not found',
          errorCode: 'NOT_FOUND',
        });

      await expect(
        updateGeneratedDocument(generatedDocumentId, { Status__c: 'FAILED' }, api)
      ).rejects.toThrow();
    });
  });

  describe('uploadAndLinkFiles (Integration)', () => {
    const pdfBuffer = Buffer.from('PDF content');
    const docxBuffer = Buffer.from('DOCX content');

    const mockRequest: DocgenRequest = {
      templateId: '068xx000000tmplXXX',
      outputFileName: 'TestDocument.pdf',
      outputFormat: 'PDF',
      locale: 'en-GB',
      timezone: 'Europe/London',
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false,
      },
      data: { Account: { Name: 'Test' } },
      parents: {
        AccountId: '001xx000000acctXXX',
        OpportunityId: null,
        CaseId: null,
      },
      requestHash: 'sha256:abc123',
      generatedDocumentId: 'a00xx000000gdocXXX',
    };

    it('should upload PDF and update Generated_Document__c', async () => {
      const pdfContentVersionId = '068xx000000pdfXXX';
      const pdfContentDocumentId = '069xx000000cdocXXX';

      // Mock PDF upload
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(201, {
          id: pdfContentVersionId,
          success: true,
          errors: [],
        });

      // Mock query for ContentDocumentId
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          records: [
            {
              Id: pdfContentVersionId,
              ContentDocumentId: pdfContentDocumentId,
            },
          ],
          totalSize: 1,
        });

      // Mock Generated_Document__c update (links created by trigger now)
      nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${mockRequest.generatedDocumentId}`,
          (body) => {
            expect(body.Status__c).toBe('SUCCEEDED');
            expect(body.OutputFileId__c).toBe(pdfContentVersionId);
            expect(body.Account__c).toBe('001xx000000acctXXX');
            return true;
          }
        )
        .reply(204);

      const result = await uploadAndLinkFiles(
        pdfBuffer,
        null,
        mockRequest,
        api
      );

      expect(result.pdfContentVersionId).toBe(pdfContentVersionId);
      expect(result.pdfContentDocumentId).toBe(pdfContentDocumentId);
      expect(result.docxContentVersionId).toBeUndefined();
      expect(result.linkCount).toBe(0); // Links handled by trigger now
      expect(result.linkErrors).toHaveLength(0);
    });

    it('should upload both PDF and DOCX when storeMergedDocx=true', async () => {
      const requestWithDocx: DocgenRequest = {
        ...mockRequest,
        options: { ...mockRequest.options, storeMergedDocx: true },
      };

      const pdfContentVersionId = '068xx000000pdfXXX';
      const pdfContentDocumentId = '069xx000000cdocPDF';
      const docxContentVersionId = '068xx000000docxYYY';
      const docxContentDocumentId = '069xx000000cdocDOCX';

      // Mock PDF upload
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion', (body) => {
          return body.PathOnClient.endsWith('.pdf');
        })
        .reply(201, {
          id: pdfContentVersionId,
          success: true,
          errors: [],
        });

      // Mock DOCX upload
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion', (body) => {
          return body.PathOnClient.endsWith('.docx');
        })
        .reply(201, {
          id: docxContentVersionId,
          success: true,
          errors: [],
        });

      // Mock queries for ContentDocumentIds
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query((query) => typeof query.q === 'string' && query.q.includes(pdfContentVersionId))
        .reply(200, {
          records: [
            {
              Id: pdfContentVersionId,
              ContentDocumentId: pdfContentDocumentId,
            },
          ],
          totalSize: 1,
        });

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query((query) => typeof query.q === 'string' && query.q.includes(docxContentVersionId))
        .reply(200, {
          records: [
            {
              Id: docxContentVersionId,
              ContentDocumentId: docxContentDocumentId,
            },
          ],
          totalSize: 1,
        });

      // Mock Generated_Document__c update with both file IDs (links created by trigger)
      nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${requestWithDocx.generatedDocumentId}`,
          (body) => {
            expect(body.Status__c).toBe('SUCCEEDED');
            expect(body.OutputFileId__c).toBe(pdfContentVersionId);
            expect(body.MergedDocxFileId__c).toBe(docxContentVersionId);
            return true;
          }
        )
        .reply(204);

      const result = await uploadAndLinkFiles(
        pdfBuffer,
        docxBuffer,
        requestWithDocx,
        api
      );

      expect(result.pdfContentVersionId).toBe(pdfContentVersionId);
      expect(result.docxContentVersionId).toBe(docxContentVersionId);
      expect(result.linkCount).toBe(0); // Links handled by trigger now
    });

    // Removed test for link failures - links are now handled by trigger

    it('should update parent lookup fields for multiple parents', async () => {
      const requestMultiParent: DocgenRequest = {
        ...mockRequest,
        parents: {
          AccountId: '001xx000000acctXXX',
          OpportunityId: '006xx000000opptyXXX',
          CaseId: '500xx000000caseXXX',
        },
      };

      const pdfContentVersionId = '068xx000000pdfXXX';
      const pdfContentDocumentId = '069xx000000cdocXXX';

      // Mock PDF upload
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(201, {
          id: pdfContentVersionId,
          success: true,
          errors: [],
        });

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          records: [
            {
              Id: pdfContentVersionId,
              ContentDocumentId: pdfContentDocumentId,
            },
          ],
          totalSize: 1,
        });

      // Mock update with parent lookups
      nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${requestMultiParent.generatedDocumentId}`,
          (body) => {
            expect(body.Status__c).toBe('SUCCEEDED');
            expect(body.Account__c).toBe('001xx000000acctXXX');
            expect(body.Opportunity__c).toBe('006xx000000opptyXXX');
            expect(body.Case__c).toBe('500xx000000caseXXX');
            return true;
          }
        )
        .reply(204);

      const result = await uploadAndLinkFiles(
        pdfBuffer,
        null,
        requestMultiParent,
        api
      );

      expect(result.linkCount).toBe(0); // Links handled by trigger now
    });

    it('should handle requests with no parents', async () => {
      const requestNoParents: DocgenRequest = {
        ...mockRequest,
        parents: undefined,
      };

      const pdfContentVersionId = '068xx000000pdfXXX';
      const pdfContentDocumentId = '069xx000000cdocXXX';

      // Mock PDF upload
      nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(201, {
          id: pdfContentVersionId,
          success: true,
          errors: [],
        });

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          records: [
            {
              Id: pdfContentVersionId,
              ContentDocumentId: pdfContentDocumentId,
            },
          ],
          totalSize: 1,
        });

      // Mock update (no parent lookups)
      nock('https://test.salesforce.com')
        .patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${requestNoParents.generatedDocumentId}`,
          (body) => {
            expect(body.Status__c).toBe('SUCCEEDED');
            expect(body.OutputFileId__c).toBe(pdfContentVersionId);
            // No parent lookups expected
            expect(body.Account__c).toBeUndefined();
            expect(body.Opportunity__c).toBeUndefined();
            return true;
          }
        )
        .reply(204);

      const result = await uploadAndLinkFiles(
        pdfBuffer,
        null,
        requestNoParents,
        api
      );

      expect(result.linkCount).toBe(0); // No links created
    });
  });
});
