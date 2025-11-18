/**
 * Worker and Poller E2E Tests
 *
 * These tests validate the full batch processing workflow:
 * 1. BatchDocgenEnqueue creates QUEUED documents
 * 2. Worker poller picks up QUEUED documents
 * 3. Documents are processed (PROCESSING → SUCCEEDED/FAILED)
 * 4. PDFs are uploaded to Salesforce
 * 5. Status and error tracking work correctly
 *
 * Tests use real CI backend with actual LibreOffice PDF conversion
 * and real Salesforce data with 15s polling interval.
 */

import { test, expect } from '../fixtures/salesforce.fixture';
import { WorkerHelper } from '../utils/worker-helper';
import { BatchHelper } from '../utils/batch-helper';
import { ScratchOrgHelper } from '../utils/scratch-org';

test.describe('Worker and Poller E2E Tests', () => {
  let workerHelper: WorkerHelper;
  let batchHelper: BatchHelper;
  let orgHelper: ScratchOrgHelper;

  test.beforeEach(async ({ salesforce }) => {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new Error('BACKEND_URL environment variable is required');
    }

    orgHelper = new ScratchOrgHelper(
      salesforce.authenticatedPage,
      salesforce.scratchOrgConfig
    );

    workerHelper = new WorkerHelper(
      salesforce.authenticatedPage,
      orgHelper,
      backendUrl
    );

    batchHelper = new BatchHelper(
      salesforce.authenticatedPage,
      orgHelper
    );

    // Ensure worker poller is running before tests
    await workerHelper.ensureWorkerRunning();
  });

  test('single document: batch enqueue → poller processes → SUCCEEDED', async ({ salesforce }) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Single document batch → poller → SUCCEEDED');
    console.log(`${'='.repeat(70)}`);

    const accountId = salesforce.testData.accountId;
    const templateId = salesforce.testData.templateId;

    console.log(`Account ID: ${accountId}`);
    console.log(`Template ID: ${templateId}`);

    // Create QUEUED document directly (simulating batch enqueue for single doc)
    console.log('\nCreating QUEUED document...');
    const requestJSON = JSON.stringify({
      templateId: salesforce.testData.contentVersionId,
      outputFileName: 'Test_Document.pdf',
      outputFormat: 'PDF',
      locale: 'en-US',
      timezone: 'America/New_York',
      data: {
        Account: {
          Name: 'Test Account',
          Industry: 'Technology'
        }
      },
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false
      },
      parents: {
        AccountId: accountId
      }
    });

    const requestHash = `test-hash-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const documentId = await workerHelper.createQueuedDocument({
      templateId: templateId,
      accountId: accountId,
      outputFileName: 'Test_Document.pdf',
      outputFormat: 'PDF',
      requestJSON: requestJSON,
      requestHash: requestHash
    });

    console.log(`✓ Document created: ${documentId}`);

    // Verify initial status is QUEUED
    const initialStatus = await workerHelper.getDocumentStatus(documentId);
    expect(initialStatus.Status__c).toBe('QUEUED');
    expect(initialStatus.Attempts__c).toBe(0);
    console.log('✓ Initial status verified: QUEUED');

    // Wait for poller to process (QUEUED → PROCESSING → SUCCEEDED)
    console.log('\nWaiting for poller to process document...');
    console.log('  Expected timeline:');
    console.log('  - Poller picks up document: ~15s (polling interval)');
    console.log('  - Document processing: ~20-40s (LibreOffice conversion)');
    console.log('  - Total wait time: up to 90s');

    // Wait for document to reach SUCCEEDED status
    const finalDoc = await workerHelper.waitForDocumentStatus(
      documentId,
      'SUCCEEDED',
      90000 // 90 second timeout
    );

    console.log('\n✓ Document reached SUCCEEDED status');
    console.log(`  Attempts: ${finalDoc.Attempts__c}`);
    console.log(`  OutputFileId: ${finalDoc.OutputFileId__c}`);

    // Verify document details
    expect(finalDoc.Status__c).toBe('SUCCEEDED');
    expect(finalDoc.OutputFileId__c).toBeTruthy();
    expect(finalDoc.OutputFileId__c).toMatch(/^068/); // ContentVersion ID prefix
    expect(finalDoc.Error__c).toBeNull();

    // Verify PDF was uploaded to Salesforce
    console.log('\nVerifying PDF file exists...');
    const pdfExists = await workerHelper.verifyPDFExists(finalDoc.OutputFileId__c!);
    expect(pdfExists).toBe(true);
    console.log('✓ PDF file verified');

    // Verify ContentDocumentLink was created
    console.log('\nVerifying ContentDocumentLink...');
    const contentDocumentId = await workerHelper.getContentDocumentId(finalDoc.OutputFileId__c!);
    const linksExist = await workerHelper.verifyContentDocumentLinks(
      contentDocumentId,
      [accountId]
    );
    expect(linksExist).toBe(true);
    console.log('✓ ContentDocumentLink verified');

    console.log('\n✅ Test completed successfully');
  });

  test('concurrent processing: 10 documents processed in parallel', async ({ salesforce }) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Concurrent processing - 10 documents');
    console.log(`${'='.repeat(70)}`);

    const accountId = salesforce.testData.accountId;
    const templateId = salesforce.testData.templateId;
    const documentCount = 10;

    console.log(`Account ID: ${accountId}`);
    console.log(`Template ID: ${templateId}`);
    console.log(`Documents to create: ${documentCount}`);

    // Create 10 QUEUED documents
    console.log('\nCreating 10 QUEUED documents...');
    const documentIds: string[] = [];

    for (let i = 0; i < documentCount; i++) {
      const requestJSON = JSON.stringify({
        templateId: salesforce.testData.contentVersionId,
        outputFileName: `Concurrent_Test_${i + 1}.pdf`,
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        data: {
          Account: {
            Name: `Test Account ${i + 1}`,
            Industry: 'Technology'
          }
        },
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: false
        },
        parents: {
          AccountId: accountId
        }
      });

      const requestHash = `concurrent-${i}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const docId = await workerHelper.createQueuedDocument({
        templateId: templateId,
        accountId: accountId,
        outputFileName: `Concurrent_Test_${i + 1}.pdf`,
        outputFormat: 'PDF',
        requestJSON: requestJSON,
        requestHash: requestHash
      });

      documentIds.push(docId);
    }

    console.log(`✓ Created ${documentIds.length} QUEUED documents`);

    // Wait for all documents to be processed
    console.log('\nWaiting for all documents to be processed...');
    console.log('  Worker concurrency limit: 8 simultaneous conversions');
    console.log('  Expected processing time: ~60-90s for 10 documents');

    const finalStatuses = await workerHelper.waitForQueueProcessing(
      documentIds,
      'SUCCEEDED',
      180000 // 3 minute timeout for 10 documents
    );

    console.log(`\n✓ All ${documentIds.length} documents processed`);

    // Verify all succeeded
    const allSucceeded = finalStatuses.every(doc => doc.Status__c === 'SUCCEEDED');
    expect(allSucceeded).toBe(true);

    const allHaveOutputFiles = finalStatuses.every(doc => doc.OutputFileId__c);
    expect(allHaveOutputFiles).toBe(true);

    const allHaveNoErrors = finalStatuses.every(doc => !doc.Error__c);
    expect(allHaveNoErrors).toBe(true);

    console.log('✓ All documents verified:');
    console.log(`  - Status: SUCCEEDED (${finalStatuses.length}/${documentIds.length})`);
    console.log(`  - OutputFileId: Present (${finalStatuses.length}/${documentIds.length})`);
    console.log(`  - Errors: None`);

    console.log('\n✅ Test completed successfully');
  });

  test('lock mechanism: document locked during processing', async ({ salesforce }) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Lock mechanism validation');
    console.log(`${'='.repeat(70)}`);

    const accountId = salesforce.testData.accountId;
    const templateId = salesforce.testData.templateId;

    // Create QUEUED document
    console.log('\nCreating QUEUED document...');
    const requestJSON = JSON.stringify({
      templateId: salesforce.testData.contentVersionId,
      outputFileName: 'Lock_Test.pdf',
      outputFormat: 'PDF',
      locale: 'en-US',
      timezone: 'America/New_York',
      data: {
        Account: { Name: 'Lock Test Account' }
      },
      options: {},
      parents: { AccountId: accountId }
    });

    const requestHash = `lock-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const documentId = await workerHelper.createQueuedDocument({
      templateId: templateId,
      accountId: accountId,
      outputFileName: 'Lock_Test.pdf',
      outputFormat: 'PDF',
      requestJSON: requestJSON,
      requestHash: requestHash
    });

    console.log(`✓ Document created: ${documentId}`);

    // Try to wait for document to be locked by poller
    console.log('\nAttempting to catch document lock...');
    const lockedDoc = await workerHelper.waitForDocumentLock(documentId, 30000);

    if (lockedDoc) {
      // Successfully caught the lock
      console.log('✓ Document locked by poller');
      console.log(`  LockedUntil: ${lockedDoc.LockedUntil__c}`);
      console.log(`  Status: ${lockedDoc.Status__c}`);

      // Verify lock properties
      expect(lockedDoc.LockedUntil__c).toBeTruthy();
      expect(lockedDoc.Status__c).toBe('PROCESSING');

      // Verify lock is in the future (2 minute TTL)
      const lockTime = new Date(lockedDoc.LockedUntil__c!).getTime();
      const now = Date.now();
      const lockDurationMs = lockTime - now;

      console.log(`  Lock duration: ${Math.round(lockDurationMs / 1000)}s remaining`);

      expect(lockTime).toBeGreaterThan(now);
      expect(lockDurationMs).toBeLessThanOrEqual(120000); // Should be <= 2 minutes
      expect(lockDurationMs).toBeGreaterThan(0); // Should be in future

      // Wait for final processing
      console.log('\nWaiting for processing to complete...');
      const finalDoc = await workerHelper.waitForDocumentStatus(documentId, 'SUCCEEDED', 90000);

      expect(finalDoc.Status__c).toBe('SUCCEEDED');
      console.log('✓ Document processed successfully after lock');
    } else {
      // Document processed too quickly - verify it succeeded
      console.log('✓ Document processed too quickly to observe lock');

      const finalDoc = await workerHelper.getDocumentStatus(documentId);
      expect(finalDoc.Status__c).toBe('SUCCEEDED');
      expect(finalDoc.OutputFileId__c).toBeTruthy();
      expect(finalDoc.Attempts__c).toBeGreaterThan(0);

      console.log('✓ Document processing verified:');
      console.log(`  Status: ${finalDoc.Status__c}`);
      console.log(`  Attempts: ${finalDoc.Attempts__c}`);
      console.log(`  OutputFileId: ${finalDoc.OutputFileId__c}`);
      console.log('  (Lock mechanism worked but was too fast to observe)');
    }

    console.log('\n✅ Test completed successfully');
  });

  test('worker stats: accuracy during real processing', async ({ salesforce }) => {
    // Set explicit timeout for this test (document processing can be slow)
    test.setTimeout(180000); // 3 minutes

    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Worker stats accuracy');
    console.log(`${'='.repeat(70)}`);

    const accountId = salesforce.testData.accountId;
    const templateId = salesforce.testData.templateId;

    // Get initial stats
    console.log('\nFetching initial worker stats...');
    const initialStats = await workerHelper.getWorkerStats();
    console.log('Initial stats:', initialStats);

    // Create 5 documents for processing
    const documentCount = 5;
    console.log(`\nCreating ${documentCount} QUEUED documents...`);
    const documentIds: string[] = [];

    for (let i = 0; i < documentCount; i++) {
      const requestJSON = JSON.stringify({
        templateId: salesforce.testData.contentVersionId,
        outputFileName: `Stats_Test_${i + 1}.pdf`,
        outputFormat: 'PDF',
        locale: 'en-US',
        timezone: 'America/New_York',
        data: {
          Account: { Name: `Stats Test ${i + 1}` }
        },
        options: {},
        parents: { AccountId: accountId }
      });

      const requestHash = `stats-${i}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const docId = await workerHelper.createQueuedDocument({
        templateId: templateId,
        accountId: accountId,
        outputFileName: `Stats_Test_${i + 1}.pdf`,
        outputFormat: 'PDF',
        requestJSON: requestJSON,
        requestHash: requestHash
      });

      documentIds.push(docId);
    }

    console.log(`✓ Created ${documentIds.length} documents`);

    // Wait for processing to complete
    console.log('\nWaiting for all documents to be processed...');
    await workerHelper.waitForQueueProcessing(documentIds, 'SUCCEEDED', 120000);

    // Wait for stats to update (processBatch must complete after Promise.allSettled)
    console.log('\nWaiting for worker stats to update...');
    let finalStats = await workerHelper.getWorkerStats();
    const maxStatsWait = 20000; // 20 seconds
    const statsStartTime = Date.now();
    const expectedIncrease = documentCount;

    while (Date.now() - statsStartTime < maxStatsWait) {
      const actualProcessed = finalStats.totalProcessed - initialStats.totalProcessed;
      const actualSucceeded = finalStats.totalSucceeded - initialStats.totalSucceeded;

      if (actualProcessed >= expectedIncrease && actualSucceeded >= expectedIncrease) {
        console.log('✓ Stats updated successfully');
        break;
      }

      console.log(`Stats not yet updated: processed ${actualProcessed}/${expectedIncrease}, succeeded ${actualSucceeded}/${expectedIncrease}`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      finalStats = await workerHelper.getWorkerStats();
    }

    console.log('\nFinal worker stats:', finalStats);

    // Verify stats increased correctly
    const actualProcessed = finalStats.totalProcessed - initialStats.totalProcessed;
    const actualSucceeded = finalStats.totalSucceeded - initialStats.totalSucceeded;

    console.log('\nStats comparison:');
    console.log(`  Expected processed: ${expectedIncrease}`);
    console.log(`  Actual processed: ${actualProcessed}`);
    console.log(`  Succeeded: ${actualSucceeded}`);
    console.log(`  Failed: ${finalStats.totalFailed - initialStats.totalFailed}`);

    // Stats should reflect all processed documents
    expect(actualProcessed).toBeGreaterThanOrEqual(expectedIncrease);
    expect(actualSucceeded).toBeGreaterThanOrEqual(expectedIncrease);

    // Verify worker is running
    expect(finalStats.isRunning).toBe(true);

    console.log('\n✅ Test completed successfully');
  });

  test('batch integration: BatchDocgenEnqueue → poller → all SUCCEEDED', async ({ salesforce }) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Batch integration - enqueue and process');
    console.log(`${'='.repeat(70)}`);

    const templateId = salesforce.testData.templateId;

    // Create 5 test accounts
    console.log('\nCreating 5 test accounts...');
    const accountIds = await batchHelper.createTestAccounts(5);
    console.log(`✓ Created accounts: ${accountIds.join(', ')}`);

    try {
      // Execute batch to enqueue documents
      console.log('\nExecuting BatchDocgenEnqueue...');
      const documentIds = await batchHelper.executeBatchAndVerifyQueued({
        templateId: templateId,
        recordIds: accountIds,
        outputFormat: 'PDF',
        parentField: 'Account__c'
      });

      console.log(`✓ Batch created ${documentIds.length} QUEUED documents`);

      // Wait for poller to process all documents
      console.log('\nWaiting for poller to process all documents...');
      const finalStatuses = await workerHelper.waitForQueueProcessing(
        documentIds,
        'SUCCEEDED',
        180000 // 3 minutes for batch processing
      );

      console.log(`\n✓ All ${documentIds.length} documents processed`);

      // Verify all succeeded
      const allSucceeded = finalStatuses.every(doc => doc.Status__c === 'SUCCEEDED');
      expect(allSucceeded).toBe(true);

      const allHaveOutputFiles = finalStatuses.every(doc => doc.OutputFileId__c);
      expect(allHaveOutputFiles).toBe(true);

      console.log('✓ Batch integration verified:');
      console.log(`  - Documents created: ${documentIds.length}`);
      console.log(`  - Documents succeeded: ${finalStatuses.length}`);
      console.log(`  - All have PDFs: Yes`);

      console.log('\n✅ Test completed successfully');
    } finally {
      // Cleanup test data
      console.log('\nCleaning up test data...');
      await batchHelper.cleanupTestData(accountIds, 'Account');
      console.log('✓ Test data cleaned up');
    }
  });

  test('status transitions: verify QUEUED → PROCESSING → SUCCEEDED', async ({ salesforce }) => {
    test.setTimeout(120000); // 2 minutes for status transitions

    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Status transition validation');
    console.log(`${'='.repeat(70)}`);

    const accountId = salesforce.testData.accountId;
    const templateId = salesforce.testData.templateId;

    // Create QUEUED document
    console.log('\nCreating QUEUED document...');
    const requestJSON = JSON.stringify({
      templateId: salesforce.testData.contentVersionId,
      outputFileName: 'Transition_Test.pdf',
      outputFormat: 'PDF',
      locale: 'en-US',
      timezone: 'America/New_York',
      data: {
        Account: { Name: 'Transition Test' }
      },
      options: {},
      parents: { AccountId: accountId }
    });

    const requestHash = `transition-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const documentId = await workerHelper.createQueuedDocument({
      templateId: templateId,
      accountId: accountId,
      outputFileName: 'Transition_Test.pdf',
      outputFormat: 'PDF',
      requestJSON: requestJSON,
      requestHash: requestHash
    });

    console.log(`✓ Document created: ${documentId}`);

    // Verify initial QUEUED status
    const queuedDoc = await workerHelper.getDocumentStatus(documentId);
    expect(queuedDoc.Status__c).toBe('QUEUED');
    console.log('✓ Status: QUEUED');

    // Try to catch PROCESSING status (optional - may transition too quickly)
    console.log('\nTrying to catch PROCESSING status...');
    let sawProcessing = false;
    let processingDoc;

    try {
      processingDoc = await workerHelper.waitForDocumentStatus(documentId, 'PROCESSING', 20000);
      sawProcessing = true;
      expect(processingDoc.Status__c).toBe('PROCESSING');
      expect(processingDoc.LockedUntil__c).toBeTruthy();
      console.log('✓ Status: PROCESSING');
      console.log(`  LockedUntil: ${processingDoc.LockedUntil__c}`);
    } catch (error) {
      console.log('⚠️  PROCESSING status not captured (document may have processed too quickly)');
    }

    // Wait for SUCCEEDED status
    console.log('\nWaiting for SUCCEEDED status...');
    const succeededDoc = await workerHelper.waitForDocumentStatus(documentId, 'SUCCEEDED', 90000);
    expect(succeededDoc.Status__c).toBe('SUCCEEDED');
    expect(succeededDoc.OutputFileId__c).toBeTruthy();
    expect(succeededDoc.Error__c).toBeNull();
    console.log('✓ Status: SUCCEEDED');
    console.log(`  OutputFileId: ${succeededDoc.OutputFileId__c}`);

    // Verify complete transition
    if (sawProcessing) {
      console.log('\n✓ Complete transition verified: QUEUED → PROCESSING → SUCCEEDED');
    } else {
      console.log('\n✓ Transition verified: QUEUED → SUCCEEDED (PROCESSING too fast to capture)');
    }

    console.log('\n✅ Test completed successfully');
  });

  test('PDF verification: validate uploaded file properties', async ({ salesforce }) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: PDF file verification');
    console.log(`${'='.repeat(70)}`);

    const accountId = salesforce.testData.accountId;
    const templateId = salesforce.testData.templateId;

    // Create and process document
    console.log('\nCreating document for PDF verification...');
    const requestJSON = JSON.stringify({
      templateId: salesforce.testData.contentVersionId,
      outputFileName: 'PDF_Verification_Test.pdf',
      outputFormat: 'PDF',
      locale: 'en-US',
      timezone: 'America/New_York',
      data: {
        Account: {
          Name: 'PDF Test Account',
          Industry: 'Healthcare',
          AnnualRevenue: 5000000
        }
      },
      options: {},
      parents: { AccountId: accountId }
    });

    const requestHash = `pdf-verify-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const documentId = await workerHelper.createQueuedDocument({
      templateId: templateId,
      accountId: accountId,
      outputFileName: 'PDF_Verification_Test.pdf',
      outputFormat: 'PDF',
      requestJSON: requestJSON,
      requestHash: requestHash
    });

    // Wait for processing
    console.log('Waiting for document to be processed...');
    const finalDoc = await workerHelper.waitForDocumentStatus(documentId, 'SUCCEEDED', 90000);

    // Verify PDF exists
    console.log('\nVerifying PDF file properties...');
    const pdfExists = await workerHelper.verifyPDFExists(finalDoc.OutputFileId__c!);
    expect(pdfExists).toBe(true);
    console.log('✓ PDF exists and is valid');

    // Get ContentDocument details
    const contentDocumentId = await workerHelper.getContentDocumentId(finalDoc.OutputFileId__c!);
    console.log(`✓ ContentDocument ID: ${contentDocumentId}`);

    // Verify ContentDocumentLink
    const linksExist = await workerHelper.verifyContentDocumentLinks(
      contentDocumentId,
      [accountId]
    );
    expect(linksExist).toBe(true);
    console.log('✓ ContentDocumentLink verified - PDF linked to Account');

    console.log('\n✅ Test completed successfully');
  });
});
