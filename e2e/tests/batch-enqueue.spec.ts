/**
 * BatchDocgenEnqueue E2E Tests
 *
 * These tests validate the BatchDocgenEnqueue Apex class functionality:
 * 1. Batch execution creates correct number of QUEUED documents
 * 2. RequestHash uniqueness and idempotency
 * 3. Large batch sizes with chunking
 * 4. Multi-object support (Account, Contact, Lead, Opportunity)
 * 5. Integration with poller for end-to-end batch processing
 *
 * Tests use real Salesforce batch execution with actual CI backend processing.
 */

import { test, expect } from '../fixtures/salesforce.fixture';
import { WorkerHelper } from '../utils/worker-helper';
import { BatchHelper } from '../utils/batch-helper';
import { ScratchOrgHelper } from '../utils/scratch-org';

test.describe('BatchDocgenEnqueue E2E Tests', () => {
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

    // Ensure worker poller is running before tests that need it
    await workerHelper.ensureWorkerRunning();
  });

  test('batch 20 records: all QUEUED → poller processes → all SUCCEEDED', async ({ salesforce }) => {
    // Set explicit timeout for batch processing tests (20 records + processing)
    test.setTimeout(300000); // 5 minutes

    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Batch 20 records - complete workflow');
    console.log(`${'='.repeat(70)}`);

    const templateId = salesforce.testData.templateId;
    const recordCount = 20;

    // Create test accounts
    console.log(`\nCreating ${recordCount} test accounts...`);
    const accountIds = await batchHelper.createTestAccounts(recordCount);
    console.log(`✓ Created ${accountIds.length} accounts`);

    try {
      // Execute batch and verify documents are QUEUED
      console.log('\nExecuting batch enqueue...');
      const documentIds = await batchHelper.executeBatchAndVerifyQueued({
        templateId: templateId,
        recordIds: accountIds,
        outputFormat: 'PDF',
        parentField: 'Account__c',
        batchSize: 200 // Single chunk for 20 records
      });

      console.log(`✓ Batch created ${documentIds.length} documents`);
      expect(documentIds.length).toBe(recordCount);

      // Verify all documents have valid status (QUEUED, PROCESSING, or SUCCEEDED)
      // Worker poller may pick up documents immediately if running
      const documents = await batchHelper.getDocumentsByParent(accountIds, 'Account__c');
      const validStatuses = ['QUEUED', 'PROCESSING', 'SUCCEEDED'];
      const allValidStatus = documents.every(doc => validStatuses.includes(doc.Status__c));
      expect(allValidStatus).toBe(true);

      const statusCounts = documents.reduce((acc, doc) => {
        acc[doc.Status__c] = (acc[doc.Status__c] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log(`✓ All documents created with valid status: ${JSON.stringify(statusCounts)}`);

      // Verify RequestHash uniqueness
      const hashes = documents.map(doc => doc.RequestHash__c);
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(recordCount);
      console.log(`✓ All ${recordCount} RequestHash values are unique`);

      // Wait for poller to process all documents
      console.log('\nWaiting for poller to process all documents...');
      console.log('  Expected time: ~2-3 minutes for 20 documents');

      const finalStatuses = await workerHelper.waitForQueueProcessing(
        documentIds,
        'SUCCEEDED',
        240000 // 4 minutes for 20 documents
      );

      console.log(`\n✓ All ${documentIds.length} documents processed`);

      // Verify all succeeded
      const allSucceeded = finalStatuses.every(doc => doc.Status__c === 'SUCCEEDED');
      expect(allSucceeded).toBe(true);

      const allHaveOutputFiles = finalStatuses.every(doc => doc.OutputFileId__c);
      expect(allHaveOutputFiles).toBe(true);

      const allHaveNoErrors = finalStatuses.every(doc => !doc.Error__c);
      expect(allHaveNoErrors).toBe(true);

      console.log('✓ Batch workflow verified:');
      console.log(`  - Documents created: ${documentIds.length}`);
      console.log(`  - Documents succeeded: ${finalStatuses.length}`);
      console.log(`  - All have PDFs: Yes`);
      console.log(`  - All have unique hashes: Yes`);

      // Verify PDFs exist
      console.log('\nVerifying PDFs exist for sample documents...');
      const sampleDoc = finalStatuses[0];
      const pdfExists = await workerHelper.verifyPDFExists(sampleDoc.OutputFileId__c!);
      expect(pdfExists).toBe(true);
      console.log('✓ PDF files verified');

      console.log('\n✅ Test completed successfully');
    } finally {
      // Cleanup
      console.log('\nCleaning up test data...');
      await batchHelper.cleanupTestData(accountIds, 'Account');
      console.log('✓ Test data cleaned up');
    }
  });

  test('large batch: 50+ records with chunking', async ({ salesforce }) => {
    // Set explicit timeout for large batch test (50 accounts + processing)
    test.setTimeout(300000); // 5 minutes

    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Large batch with chunking - 50 records');
    console.log(`${'='.repeat(70)}`);

    const templateId = salesforce.testData.templateId;
    const recordCount = 50;

    // Create test accounts
    console.log(`\nCreating ${recordCount} test accounts...`);
    const accountIds = await batchHelper.createTestAccounts(recordCount);
    console.log(`✓ Created ${accountIds.length} accounts`);

    try {
      // Execute batch with smaller chunk size to test chunking
      console.log('\nExecuting batch with chunk size of 25...');
      console.log('  This will create 2 batch chunks');

      const jobId = await batchHelper.executeBatchEnqueue({
        templateId: templateId,
        recordIds: accountIds,
        outputFormat: 'PDF',
        parentField: 'Account__c',
        batchSize: 25 // 2 chunks: 25 + 25
      });

      console.log(`✓ Batch job started: ${jobId}`);

      // Wait for batch completion
      console.log('\nWaiting for batch to complete...');
      const jobInfo = await batchHelper.waitForBatchCompletion(jobId, 180000);

      console.log(`\n✓ Batch completed: ${jobInfo.Status}`);
      console.log(`  Items processed: ${jobInfo.JobItemsProcessed}`);
      console.log(`  Total items: ${jobInfo.TotalJobItems}`);
      console.log(`  Errors: ${jobInfo.NumberOfErrors}`);

      expect(jobInfo.Status).toBe('Completed');
      expect(jobInfo.JobItemsProcessed).toBe(2); // 2 chunks
      expect(jobInfo.NumberOfErrors).toBe(0);

      // Verify all documents created
      const documents = await batchHelper.getDocumentsByParent(accountIds, 'Account__c');
      console.log(`\n✓ Documents created: ${documents.length}/${recordCount}`);

      expect(documents.length).toBe(recordCount);

      // Verify all documents have valid status (QUEUED, PROCESSING, or SUCCEEDED)
      // Worker poller may pick up documents immediately if running
      const validStatuses = ['QUEUED', 'PROCESSING', 'SUCCEEDED'];
      const allValidStatus = documents.every(doc => validStatuses.includes(doc.Status__c));
      expect(allValidStatus).toBe(true);

      const statusCounts = documents.reduce((acc, doc) => {
        acc[doc.Status__c] = (acc[doc.Status__c] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log(`✓ All documents in valid status: ${JSON.stringify(statusCounts)}`);

      // Note: Not waiting for poller processing to save test time
      // The focus of this test is batch execution and chunking
      console.log('\n✓ Large batch with chunking verified successfully');
      console.log('  (Skipping poller processing to optimize test time)');

      console.log('\n✅ Test completed successfully');
    } finally {
      // Cleanup
      console.log('\nCleaning up test data...');
      await batchHelper.cleanupTestData(accountIds, 'Account');
      console.log('✓ Test data cleaned up');
    }
  });

  test('multi-object batch: Accounts + Contacts + Leads', async ({ salesforce }) => {
    test.setTimeout(300000); // 5 minutes for multi-object batch processing

    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Multi-object batch processing');
    console.log(`${'='.repeat(70)}`);

    const accountTemplateId = salesforce.testData.templateId;
    const recordsPerType = 5;

    // Create templates for Contact and Lead with appropriate SOQL
    console.log('\nCreating templates for Contact and Lead...');
    const contactTemplateId = await orgHelper.createRecord('Docgen_Template__c', {
      Name: `Contact_Template_${Date.now()}`,
      DataSource__c: 'SOQL',
      TemplateContentVersionId__c: salesforce.testData.contentVersionId,
      SOQL__c: 'SELECT Id, Name, Email, Department FROM Contact WHERE Id = :recordId',
      StoreMergedDocx__c: false,
      ReturnDocxToBrowser__c: false
    });

    const leadTemplateId = await orgHelper.createRecord('Docgen_Template__c', {
      Name: `Lead_Template_${Date.now()}`,
      DataSource__c: 'SOQL',
      TemplateContentVersionId__c: salesforce.testData.contentVersionId,
      SOQL__c: 'SELECT Id, Name, Email, Company, Status FROM Lead WHERE Id = :recordId',
      StoreMergedDocx__c: false,
      ReturnDocxToBrowser__c: false
    });

    console.log(`✓ Created Contact template: ${contactTemplateId.id}`);
    console.log(`✓ Created Lead template: ${leadTemplateId.id}`);

    // Create test records for multiple object types
    console.log(`\nCreating test records for multiple object types...`);

    console.log(`  Creating ${recordsPerType} Accounts...`);
    const accountIds = await batchHelper.createTestAccounts(recordsPerType);

    console.log(`  Creating ${recordsPerType} Contacts...`);
    const contactIds = await batchHelper.createTestContacts(recordsPerType);

    console.log(`  Creating ${recordsPerType} Leads...`);
    const leadIds = await batchHelper.createTestLeads(recordsPerType);

    console.log(`✓ Created ${accountIds.length + contactIds.length + leadIds.length} records across 3 object types`);

    try {
      // Execute 3 separate batches (one per object type with appropriate template)
      console.log('\nExecuting batch for Accounts...');
      const accountBatchJobId = await batchHelper.executeBatchEnqueue({
        templateId: accountTemplateId,
        recordIds: accountIds,
        outputFormat: 'PDF',
        parentField: 'Account__c'
      });

      console.log('Executing batch for Contacts...');
      const contactBatchJobId = await batchHelper.executeBatchEnqueue({
        templateId: contactTemplateId.id,
        recordIds: contactIds,
        outputFormat: 'PDF',
        parentField: 'Contact__c'
      });

      console.log('Executing batch for Leads...');
      const leadBatchJobId = await batchHelper.executeBatchEnqueue({
        templateId: leadTemplateId.id,
        recordIds: leadIds,
        outputFormat: 'PDF',
        parentField: 'Lead__c'
      });

      console.log('✓ All 3 batches submitted');

      // Wait for all batches to complete
      console.log('\nWaiting for all batches to complete...');
      const [accountJob, contactJob, leadJob] = await Promise.all([
        batchHelper.waitForBatchCompletion(accountBatchJobId, 120000),
        batchHelper.waitForBatchCompletion(contactBatchJobId, 120000),
        batchHelper.waitForBatchCompletion(leadBatchJobId, 120000)
      ]);

      console.log('\n✓ All batches completed:');
      console.log(`  Accounts batch: ${accountJob.Status}`);
      console.log(`  Contacts batch: ${contactJob.Status}`);
      console.log(`  Leads batch: ${leadJob.Status}`);

      expect(accountJob.Status).toBe('Completed');
      expect(contactJob.Status).toBe('Completed');
      expect(leadJob.Status).toBe('Completed');

      // Verify documents created for each object type
      const accountDocs = await batchHelper.getDocumentsByParent(accountIds, 'Account__c');
      const contactDocs = await batchHelper.getDocumentsByParent(contactIds, 'Contact__c');
      const leadDocs = await batchHelper.getDocumentsByParent(leadIds, 'Lead__c');

      console.log('\n✓ Documents created:');
      console.log(`  Account documents: ${accountDocs.length}/${recordsPerType}`);
      console.log(`  Contact documents: ${contactDocs.length}/${recordsPerType}`);
      console.log(`  Lead documents: ${leadDocs.length}/${recordsPerType}`);

      expect(accountDocs.length).toBe(recordsPerType);
      expect(contactDocs.length).toBe(recordsPerType);
      expect(leadDocs.length).toBe(recordsPerType);

      // Verify all have valid status (QUEUED, PROCESSING, or SUCCEEDED)
      // Worker poller may pick up documents immediately
      const validStatuses = ['QUEUED', 'PROCESSING', 'SUCCEEDED'];
      const allAccountsValid = accountDocs.every(doc => validStatuses.includes(doc.Status__c));
      const allContactsValid = contactDocs.every(doc => validStatuses.includes(doc.Status__c));
      const allLeadsValid = leadDocs.every(doc => validStatuses.includes(doc.Status__c));

      expect(allAccountsValid).toBe(true);
      expect(allContactsValid).toBe(true);
      expect(allLeadsValid).toBe(true);

      console.log('✓ All documents in valid status across all object types');

      console.log('\n✅ Test completed successfully');
    } finally {
      // Cleanup templates
      console.log('\nCleaning up templates...');
      try {
        await orgHelper.deleteRecords('Docgen_Template__c', [contactTemplateId.id, leadTemplateId.id]);
        console.log('✓ Templates deleted');
      } catch (error) {
        console.warn('⚠️  Failed to delete templates:', error);
      }

      // Cleanup test data
      console.log('\nCleaning up test data...');
      await Promise.all([
        batchHelper.cleanupTestData(accountIds, 'Account'),
        batchHelper.cleanupTestData(contactIds, 'Contact'),
        batchHelper.cleanupTestData(leadIds, 'Lead')
      ]);
      console.log('✓ Test data cleaned up');
    }
  });

  test('batch idempotency: duplicate RequestHash handling', async ({ salesforce }) => {
    // Set explicit timeout for batch processing tests
    test.setTimeout(180000); // 3 minutes

    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Batch idempotency - duplicate RequestHash');
    console.log(`${'='.repeat(70)}`);

    const templateId = salesforce.testData.templateId;
    const recordCount = 3;

    // Create test accounts
    console.log(`\nCreating ${recordCount} test accounts...`);
    const accountIds = await batchHelper.createTestAccounts(recordCount);
    console.log(`✓ Created ${accountIds.length} accounts`);

    try {
      // Execute first batch
      console.log('\nExecuting first batch...');
      const firstDocumentIds = await batchHelper.executeBatchAndVerifyQueued({
        templateId: templateId,
        recordIds: accountIds,
        outputFormat: 'PDF',
        parentField: 'Account__c'
      });

      console.log(`✓ First batch created ${firstDocumentIds.length} documents`);

      // Get RequestHash values from first batch
      const firstDocs = await batchHelper.getDocumentsByParent(accountIds, 'Account__c');
      const firstHashes = firstDocs.map(doc => doc.RequestHash__c);

      console.log('First batch RequestHash values:');
      firstHashes.forEach((hash, i) => console.log(`  ${i + 1}. ${hash}`));

      // Attempt to execute same batch again (same template, same records, same format)
      console.log('\nAttempting to execute duplicate batch...');
      console.log('  (Same template, same records, same output format)');
      console.log('  Note: Batch uses Database.insert with allOrNone=false, so it completes');
      console.log('        successfully even when duplicate External IDs cause individual DML failures');

      // Execute duplicate batch - it will succeed but not create new documents
      // The batch uses Database.insert(records, false) which allows partial success
      // Duplicate RequestHash values will fail individual inserts, but batch completes
      await batchHelper.executeBatchAndVerifyQueued({
        templateId: templateId,
        recordIds: accountIds,
        outputFormat: 'PDF',
        parentField: 'Account__c'
      });

      console.log('✓ Duplicate batch completed (as expected with partial success mode)');

      // Verify no additional documents were created (idempotency check)
      const afterDocs = await batchHelper.getDocumentsByParent(accountIds, 'Account__c');
      console.log(`\n✓ Document count after duplicate attempt: ${afterDocs.length}`);
      expect(afterDocs.length).toBe(recordCount); // Should still be original count

      // Verify RequestHash values are unchanged
      const afterHashes = afterDocs.map(doc => doc.RequestHash__c).sort();
      const firstHashesSorted = firstHashes.sort();
      expect(afterHashes).toEqual(firstHashesSorted);

      console.log('✓ Idempotency verified: Duplicate RequestHash prevented duplicate documents');

      console.log('\n✅ Test completed successfully');
    } finally {
      // Cleanup
      console.log('\nCleaning up test data...');
      await batchHelper.cleanupTestData(accountIds, 'Account');
      console.log('✓ Test data cleaned up');
    }
  });

  test('batch with DOCX output format', async ({ salesforce }) => {
    // Set explicit timeout for batch processing tests
    test.setTimeout(180000); // 3 minutes

    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: Batch with DOCX output format');
    console.log(`${'='.repeat(70)}`);

    const templateId = salesforce.testData.templateId;
    const recordCount = 3;

    // Create test accounts
    console.log(`\nCreating ${recordCount} test accounts...`);
    const accountIds = await batchHelper.createTestAccounts(recordCount);
    console.log(`✓ Created ${accountIds.length} accounts`);

    try {
      // Execute batch with DOCX output format
      console.log('\nExecuting batch with DOCX output format...');
      const documentIds = await batchHelper.executeBatchAndVerifyQueued({
        templateId: templateId,
        recordIds: accountIds,
        outputFormat: 'DOCX', // DOCX instead of PDF
        parentField: 'Account__c'
      });

      console.log(`✓ Batch created ${documentIds.length} QUEUED documents`);
      expect(documentIds.length).toBe(recordCount);

      // Verify documents have DOCX output format
      const documents = await batchHelper.getDocumentsByParent(accountIds, 'Account__c');

      const allDOCX = documents.every(doc => doc.OutputFormat__c === 'DOCX');
      expect(allDOCX).toBe(true);
      console.log('✓ All documents have OutputFormat__c = DOCX');

      // Wait for poller to process (optional - can skip for time)
      console.log('\nWaiting for poller to process DOCX documents...');
      const finalStatuses = await workerHelper.waitForQueueProcessing(
        documentIds,
        'SUCCEEDED',
        180000
      );

      console.log(`\n✓ All ${documentIds.length} DOCX documents processed`);

      // Verify all succeeded with DOCX files
      const allSucceeded = finalStatuses.every(doc => doc.Status__c === 'SUCCEEDED');
      expect(allSucceeded).toBe(true);

      const allHaveOutputFiles = finalStatuses.every(doc => doc.OutputFileId__c);
      expect(allHaveOutputFiles).toBe(true);

      console.log('✓ DOCX batch processing verified');

      console.log('\n✅ Test completed successfully');
    } finally {
      // Cleanup
      console.log('\nCleaning up test data...');
      await batchHelper.cleanupTestData(accountIds, 'Account');
      console.log('✓ Test data cleaned up');
    }
  });
});
