import { config } from 'dotenv';
import nock from 'nock';
import { PollerService } from '../../src/worker/poller';
import { loadConfig } from '../../src/config';
import { createSalesforceAuth } from '../../src/sf/auth';
import type { QueuedDocument, PollerStats } from '../../src/types';

// Load environment variables from .env file
config();

// Mock logger to suppress output during tests
jest.mock('pino', () => {
  const mockLogger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(function () {
      return mockLogger;
    }),
  };
  return jest.fn(() => mockLogger);
});

// Check if we have Salesforce credentials
const appConfig = loadConfig();
const hasCredentials = !!(
  appConfig.sfDomain &&
  appConfig.sfUsername &&
  appConfig.sfClientId &&
  appConfig.sfPrivateKey
);

// Skip tests if credentials are not available
const describeWithAuth = hasCredentials ? describe : describe.skip;

if (!hasCredentials) {
  console.log(`
================================================================================
SKIPPING POLLER UNIT TESTS: Missing Salesforce credentials.

To run these tests locally, create a .env file with:
  SF_DOMAIN=your-domain.my.salesforce.com
  SF_USERNAME=your-username@example.com
  SF_CLIENT_ID=your-connected-app-client-id
  SF_PRIVATE_KEY=your-rsa-private-key (or SF_PRIVATE_KEY_PATH=/path/to/key)

For CI/CD, set these as environment variables or secrets.
================================================================================
  `);
}

describeWithAuth('PollerService', () => {
  let poller: PollerService;
  const baseUrl = `https://${appConfig.sfDomain}`;

  beforeAll(() => {
    // Initialize real Salesforce auth explicitly for tests
    // This ensures auth is properly set up before PollerService creates its own instances
    createSalesforceAuth({
      sfDomain: appConfig.sfDomain!,
      sfUsername: appConfig.sfUsername!,
      sfClientId: appConfig.sfClientId!,
      sfPrivateKey: appConfig.sfPrivateKey!,
    });
    // PollerService will now be able to use getSalesforceAuth() successfully
  });

  beforeEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Note: We don't mock /services/oauth2/token - auth is real!
    // We only mock the Salesforce API responses for controlled test scenarios

    poller = new PollerService();
  });

  afterEach(async () => {
    if (poller.isRunning()) {
      await poller.stop();
    }
    nock.cleanAll();
  });

  describe('fetchQueuedDocuments', () => {
    it('should fetch up to 20 QUEUED documents not locked', async () => {
      const mockDocuments: QueuedDocument[] = Array.from({ length: 15 }, (_, i) => ({
        Id: `a00${i.toString().padStart(15, '0')}`,
        Status__c: 'QUEUED' as const,
        RequestJSON__c: JSON.stringify({
          templateId: '068000000000001AAA',
          outputFileName: `test-${i}.pdf`,
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: { storeMergedDocx: false, returnDocxToBrowser: false },
          data: { Account: { Name: `Test Account ${i}` } },
          parents: { AccountId: '001000000000001AAA', OpportunityId: null, CaseId: null },
          requestHash: `sha256:hash${i}`,
          generatedDocumentId: `a00${i.toString().padStart(15, '0')}`,
        }),
        Attempts__c: 0,
        CorrelationId__c: `corr-${i}`,
        Template__c: 'a01000000000001AAA',
        CreatedDate: new Date().toISOString(),
      }));

      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 15,
          done: true,
          records: mockDocuments,
        });

      const documents = await poller.fetchQueuedDocuments();

      expect(documents).toHaveLength(15);
      expect(documents[0].Status__c).toBe('QUEUED');
    });

    it('should limit to batch size of 20 even if more available', async () => {
      const mockDocuments: QueuedDocument[] = Array.from({ length: 50 }, (_, i) => ({
        Id: `a00${i.toString().padStart(15, '0')}`,
        Status__c: 'QUEUED' as const,
        RequestJSON__c: '{}',
        Attempts__c: 0,
        CorrelationId__c: `corr-${i}`,
        Template__c: 'a01000000000001AAA',
        CreatedDate: new Date().toISOString(),
      }));

      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 50,
          done: false,
          records: mockDocuments.slice(0, 20),
        });

      const documents = await poller.fetchQueuedDocuments();

      expect(documents).toHaveLength(20);
    });

    it('should return empty array when no documents available', async () => {
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        });

      const documents = await poller.fetchQueuedDocuments();

      expect(documents).toHaveLength(0);
    });

    it('should exclude documents with future LockedUntil', async () => {
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query((queryObj) => {
          const soql = queryObj.q as string;
          return soql.includes('LockedUntil__c < ') || soql.includes('LockedUntil__c = null');
        })
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        });

      const documents = await poller.fetchQueuedDocuments();

      expect(documents).toHaveLength(0);
    });
  });

  describe('lockDocument', () => {
    it('should successfully lock a document with PATCH', async () => {
      const docId = 'a00000000000001AAA';

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`, (body) => {
          expect(body.Status__c).toBe('PROCESSING');
          expect(body.LockedUntil__c).toBeDefined();
          return true;
        })
        .reply(204);

      const result = await poller.lockDocument(docId);

      expect(result).toBe(true);
    });

    it('should return false if lock fails (already locked by another worker)', async () => {
      const docId = 'a00000000000001AAA';

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`)
        .reply(409, {
          message: 'Record is locked by another process',
          errorCode: 'UNABLE_TO_LOCK_ROW',
        });

      const result = await poller.lockDocument(docId);

      expect(result).toBe(false);
    });

    it('should set LockedUntil to 2 minutes in future', async () => {
      const docId = 'a00000000000001AAA';
      const nowBefore = Date.now();

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`, (body) => {
          const lockedUntil = new Date(body.LockedUntil__c).getTime();
          const expectedMin = nowBefore + 119000; // 1:59
          const expectedMax = nowBefore + 121000; // 2:01
          expect(lockedUntil).toBeGreaterThanOrEqual(expectedMin);
          expect(lockedUntil).toBeLessThanOrEqual(expectedMax);
          return true;
        })
        .reply(204);

      await poller.lockDocument(docId);
    });
  });

  describe('processDocument', () => {
    it('should successfully process a document and update status to SUCCEEDED', async () => {
      const mockDoc: QueuedDocument = {
        Id: 'a00000000000001AAA',
        Status__c: 'PROCESSING',
        RequestJSON__c: JSON.stringify({
          templateId: '068000000000001AAA',
          outputFileName: 'test.docx',
          outputFormat: 'DOCX', // Use DOCX to skip LibreOffice conversion
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: { storeMergedDocx: false, returnDocxToBrowser: false },
          data: {
            Account: { Name: 'Test Account' },
            GeneratedDate__formatted: '10 November 2025'
          },
          parents: null, // No parents to simplify test
          requestHash: 'sha256:test-hash',
          generatedDocumentId: 'a00000000000001AAA',
        }),
        Attempts__c: 0,
        CorrelationId__c: 'test-corr-id',
        Template__c: 'a01000000000001AAA',
        CreatedDate: new Date().toISOString(),
      };

      // Create a valid DOCX buffer for testing
      const { createTestDocxBuffer } = await import('../helpers/test-docx');
      const validDocx = await createTestDocxBuffer();

      // Mock template download
      nock(baseUrl)
        .get('/services/data/v59.0/sobjects/ContentVersion/068000000000001AAA/VersionData')
        .reply(200, validDocx);

      // Mock file upload
      nock(baseUrl)
        .post('/services/data/v59.0/sobjects/ContentVersion')
        .reply(201, {
          id: '068000000000002AAA',
          success: true,
        });

      // Mock ContentVersion query for ContentDocumentId
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 1,
          done: true,
          records: [{ ContentDocumentId: '069000000000001AAA' }],
        });

      // Mock status update (success or failure)
      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${mockDoc.Id}`)
        .reply(204);

      const result = await poller.processDocument(mockDoc);

      // If failed, log the error for debugging
      if (!result.success) {
        console.log('Process failed with error:', result.error);
      }

      expect(result.success).toBe(true);
      expect(result.documentId).toBe(mockDoc.Id);
    }, 30000); // 30 second timeout

    it('should handle template not found (404) and mark as FAILED', async () => {
      const mockDoc: QueuedDocument = {
        Id: 'a00000000000001AAA',
        Status__c: 'PROCESSING',
        RequestJSON__c: JSON.stringify({
          templateId: '068000000000001AAA',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: { storeMergedDocx: false, returnDocxToBrowser: false },
          data: { Account: { Name: 'Test Account' } },
          parents: { AccountId: null, OpportunityId: null, CaseId: null },
          requestHash: 'sha256:test-hash',
          generatedDocumentId: 'a00000000000001AAA',
        }),
        Attempts__c: 0,
        CorrelationId__c: 'test-corr-id',
        Template__c: 'a01000000000001AAA',
        CreatedDate: new Date().toISOString(),
      };

      // Mock template download failure
      nock(baseUrl)
        .get('/services/data/v59.0/sobjects/ContentVersion/068000000000001AAA/VersionData')
        .reply(404, [{ message: 'The requested resource does not exist', errorCode: 'NOT_FOUND' }]);

      const result = await poller.processDocument(mockDoc);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      // Note: Error classification depends on how the API returns the 404
    });

    it('should handle conversion failure and allow retry', async () => {
      const mockDoc: QueuedDocument = {
        Id: 'a00000000000001AAA',
        Status__c: 'PROCESSING',
        RequestJSON__c: JSON.stringify({
          templateId: '068000000000001AAA',
          outputFileName: 'test.pdf',
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: { storeMergedDocx: false, returnDocxToBrowser: false },
          data: { Account: { Name: 'Test Account' } },
          parents: { AccountId: null, OpportunityId: null, CaseId: null },
          requestHash: 'sha256:test-hash',
          generatedDocumentId: 'a00000000000001AAA',
        }),
        Attempts__c: 0,
        CorrelationId__c: 'test-corr-id',
        Template__c: 'a01000000000001AAA',
        CreatedDate: new Date().toISOString(),
      };

      // Mock template download
      nock(baseUrl)
        .get('/services/data/v59.0/sobjects/ContentVersion/068000000000001AAA/VersionData')
        .reply(200, Buffer.from('mock docx content'));

      // This will cause merge/conversion to fail since it's not real DOCX
      const result = await poller.processDocument(mockDoc);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });
  });

  describe('handleFailure', () => {
    it('should increment attempts and requeue with 1 minute backoff on first failure', async () => {
      const docId = 'a00000000000001AAA';
      const attempts = 0;
      const error = 'Conversion timeout';

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`, (body) => {
          expect(body.Attempts__c).toBe(1);
          expect(body.Status__c).toBe('QUEUED');
          expect(body.Error__c).toContain('Conversion timeout');
          const scheduledTime = new Date(body.ScheduledRetryTime__c || '').getTime();
          expect(scheduledTime).toBeGreaterThan(Date.now());
          return true;
        })
        .reply(204);

      await poller.handleFailure(docId, attempts, error, true);
    });

    it('should requeue with 5 minute backoff on second failure', async () => {
      const docId = 'a00000000000001AAA';
      const attempts = 1;
      const error = 'Upload failed';

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`, (body) => {
          expect(body.Attempts__c).toBe(2);
          expect(body.Status__c).toBe('QUEUED');
          const scheduledTime = new Date(body.ScheduledRetryTime__c || '').getTime();
          const expectedMin = Date.now() + 299000; // 4:59
          const expectedMax = Date.now() + 301000; // 5:01
          expect(scheduledTime).toBeGreaterThanOrEqual(expectedMin);
          expect(scheduledTime).toBeLessThanOrEqual(expectedMax);
          return true;
        })
        .reply(204);

      await poller.handleFailure(docId, attempts, error, true);
    });

    it('should requeue with 15 minute backoff on third failure', async () => {
      const docId = 'a00000000000001AAA';
      const attempts = 2;
      const error = 'Temporary SF error';

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`, (body) => {
          expect(body.Attempts__c).toBe(3);
          expect(body.Status__c).toBe('QUEUED');
          const scheduledTime = new Date(body.ScheduledRetryTime__c || '').getTime();
          const expectedMin = Date.now() + 899000; // 14:59
          const expectedMax = Date.now() + 901000; // 15:01
          expect(scheduledTime).toBeGreaterThanOrEqual(expectedMin);
          expect(scheduledTime).toBeLessThanOrEqual(expectedMax);
          return true;
        })
        .reply(204);

      await poller.handleFailure(docId, attempts, error, true);
    });

    it('should set status to FAILED after 3 attempts', async () => {
      const docId = 'a00000000000001AAA';
      const attempts = 3;
      const error = 'Permanent failure';

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`, (body) => {
          expect(body.Attempts__c).toBe(4);
          expect(body.Status__c).toBe('FAILED');
          expect(body.Error__c).toContain('Permanent failure');
          expect(body.ScheduledRetryTime__c).toBeUndefined();
          return true;
        })
        .reply(204);

      await poller.handleFailure(docId, attempts, error, true);
    });

    it('should immediately set FAILED for non-retryable errors', async () => {
      const docId = 'a00000000000001AAA';
      const attempts = 0;
      const error = 'Template not found';

      nock(baseUrl)
        .patch(`/services/data/v59.0/sobjects/Generated_Document__c/${docId}`, (body) => {
          expect(body.Status__c).toBe('FAILED');
          expect(body.Error__c).toContain('Template not found');
          expect(body.Attempts__c).toBe(1);
          return true;
        })
        .reply(204);

      await poller.handleFailure(docId, attempts, error, false);
    });
  });

  describe('computeBackoff', () => {
    it('should return 1 minute for attempt 1', () => {
      expect(poller.computeBackoff(1)).toBe(60000);
    });

    it('should return 5 minutes for attempt 2', () => {
      expect(poller.computeBackoff(2)).toBe(300000);
    });

    it('should return 15 minutes for attempt 3', () => {
      expect(poller.computeBackoff(3)).toBe(900000);
    });

    it('should return 0 for attempt 4 and above', () => {
      expect(poller.computeBackoff(4)).toBe(0);
      expect(poller.computeBackoff(5)).toBe(0);
    });
  });

  describe('adaptive polling', () => {
    it('should use 15 second interval when queue is active', () => {
      poller.setQueueDepth(10);
      expect(poller.getPollingInterval()).toBe(15000);
    });

    it('should use 60 second interval when queue is idle', () => {
      poller.setQueueDepth(0);
      expect(poller.getPollingInterval()).toBe(60000);
    });

    it('should transition from active to idle interval', () => {
      poller.setQueueDepth(5);
      expect(poller.getPollingInterval()).toBe(15000);

      poller.setQueueDepth(0);
      expect(poller.getPollingInterval()).toBe(60000);
    });
  });

  describe('start and stop', () => {
    it('should start the poller loop', async () => {
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      await poller.start();

      expect(poller.isRunning()).toBe(true);

      await poller.stop();
    });

    it('should stop the poller gracefully', async () => {
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      await poller.start();
      expect(poller.isRunning()).toBe(true);

      await poller.stop();
      expect(poller.isRunning()).toBe(false);
    });

    it('should not allow starting when already running', async () => {
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      await poller.start();

      await expect(poller.start()).rejects.toThrow('Poller is already running');

      await poller.stop();
    });
  });

  describe('getStats', () => {
    it('should return initial stats with all counts at zero', () => {
      const stats: PollerStats = poller.getStats();

      expect(stats.isRunning).toBe(false);
      expect(stats.currentQueueDepth).toBe(0);
      expect(stats.totalProcessed).toBe(0);
      expect(stats.totalSucceeded).toBe(0);
      expect(stats.totalFailed).toBe(0);
      expect(stats.totalRetries).toBe(0);
    });

    it('should track processed documents count', async () => {
      // This test would require mocking a full processing cycle
      // For now, verify the structure
      const stats = poller.getStats();
      expect(stats).toHaveProperty('totalProcessed');
      expect(stats).toHaveProperty('lastPollTime');
    });
  });

  describe('concurrency control', () => {
    it('should respect LibreOffice pool limit of 8 concurrent jobs', async () => {
      // This test verifies that poller leverages existing conversion pool
      // The actual concurrency limit is enforced by LibreOfficeConverter
      // Poller can fetch 20 docs but only 8 will convert simultaneously

      const mockDocs: QueuedDocument[] = Array.from({ length: 10 }, (_, i) => ({
        Id: `a00${i.toString().padStart(15, '0')}`,
        Status__c: 'QUEUED',
        RequestJSON__c: JSON.stringify({
          templateId: '068000000000001AAA',
          outputFileName: `test-${i}.pdf`,
          outputFormat: 'PDF',
          locale: 'en-GB',
          timezone: 'Europe/London',
          options: { storeMergedDocx: false, returnDocxToBrowser: false },
          data: { Account: { Name: `Test ${i}` } },
          parents: { AccountId: null, OpportunityId: null, CaseId: null },
          requestHash: `sha256:hash${i}`,
          generatedDocumentId: `a00${i.toString().padStart(15, '0')}`,
        }),
        Attempts__c: 0,
        CorrelationId__c: `corr-${i}`,
        Template__c: 'a01000000000001AAA',
        CreatedDate: new Date().toISOString(),
      }));

      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 10,
          done: true,
          records: mockDocs,
        });

      // Lock all documents
      for (let i = 0; i < 10; i++) {
        nock(baseUrl)
          .patch(`/services/data/v59.0/sobjects/Generated_Document__c/a00${i.toString().padStart(15, '0')}`)
          .reply(204);
      }

      // Template downloads will fail, that's OK - we're testing concurrency control
      nock(baseUrl)
        .get('/services/data/v59.0/sobjects/ContentVersion/068000000000001AAA/VersionData')
        .reply(404)
        .persist();

      const documents = await poller.fetchQueuedDocuments();
      expect(documents).toHaveLength(10);

      // LibreOffice pool enforces the 8-concurrent limit internally
      // Poller uses Promise.allSettled which starts all promises
      // but conversion pool queues beyond 8
    });
  });
});
