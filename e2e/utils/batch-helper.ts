/**
 * Batch Helper Utilities for E2E Tests
 *
 * Provides utilities for testing BatchDocgenEnqueue functionality including:
 * - Batch execution and monitoring
 * - Batch job status polling
 * - Test data generation
 * - Batch results validation
 */

import { Page } from '@playwright/test';
import { ScratchOrgHelper } from './scratch-org';

export interface BatchJobInfo {
  Id: string;
  Status: string;
  JobItemsProcessed: number;
  TotalJobItems: number;
  NumberOfErrors: number;
  CompletedDate: string | null;
  ExtendedStatus: string | null;
}

export interface BatchEnqueueConfig {
  templateId: string;
  recordIds: string[];
  outputFormat: 'PDF' | 'DOCX';
  parentField?: string; // e.g., 'Account__c', 'Contact__c', 'Lead__c'
  batchSize?: number; // Chunk size for batch execution (default: 200)
}

export interface BatchResults {
  jobInfo: BatchJobInfo;
  documentsCreated: number;
  documentIds: string[];
  successCount: number;
  failureCount: number;
}

export class BatchHelper {
  constructor(
    private page: Page,
    private orgHelper: ScratchOrgHelper
  ) {}

  /**
   * Execute BatchDocgenEnqueue via anonymous Apex
   *
   * @param config - Batch configuration
   * @returns Batch job ID
   */
  async executeBatchEnqueue(config: BatchEnqueueConfig): Promise<string> {
    const recordIdsApex = config.recordIds.map(id => `'${id}'`).join(', ');
    const batchSize = config.batchSize || 200;

    // Build anonymous Apex to execute batch
    // Note: BatchDocgenEnqueue constructor takes 3 parameters: templateId, recordIds, outputFormat
    // The parentField is determined automatically from the record IDs
    const apexCode = `
// Create batch instance with configuration
BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
  '${config.templateId}',
  new List<Id>{ ${recordIdsApex} },
  '${config.outputFormat}'
);

// Execute batch with specified chunk size
Id jobId = Database.executeBatch(batch, ${batchSize});

// Return job ID for monitoring
System.debug('Batch Job ID: ' + jobId);
    `.trim();

    // Execute via Salesforce CLI
    const result = await this.orgHelper.executeAnonymousApex(apexCode);

    if (!result.success) {
      throw new Error(`Failed to execute batch: ${result.compileProblem || result.exceptionMessage}`);
    }

    // Extract job ID from debug logs
    const jobIdMatch = result.logs?.match(/Batch Job ID: ([\w]+)/);

    if (!jobIdMatch) {
      throw new Error('Failed to extract batch job ID from execution logs');
    }

    return jobIdMatch[1];
  }

  /**
   * Wait for batch job to complete
   * Polls AsyncApexJob every 5 seconds
   *
   * @param jobId - AsyncApexJob ID
   * @param maxWaitMs - Maximum wait time (default: 120s)
   * @returns Final job info
   */
  async waitForBatchCompletion(
    jobId: string,
    maxWaitMs: number = 120000
  ): Promise<BatchJobInfo> {
    const startTime = Date.now();
    const pollIntervalMs = 5000; // Poll every 5 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const jobInfo = await this.getBatchJobInfo(jobId);

      // Check if job completed (success, failure, or abort)
      if (['Completed', 'Failed', 'Aborted'].includes(jobInfo.Status)) {
        return jobInfo;
      }

      // Log progress
      console.log(
        `Batch progress: ${jobInfo.JobItemsProcessed}/${jobInfo.TotalJobItems} ` +
        `(Status: ${jobInfo.Status})`
      );

      await this.page.waitForTimeout(pollIntervalMs);
    }

    // Timeout
    const finalJobInfo = await this.getBatchJobInfo(jobId);
    throw new Error(
      `Timeout waiting for batch ${jobId} to complete. ` +
      `Status: ${finalJobInfo.Status}, ` +
      `Processed: ${finalJobInfo.JobItemsProcessed}/${finalJobInfo.TotalJobItems}`
    );
  }

  /**
   * Get current batch job information
   */
  async getBatchJobInfo(jobId: string): Promise<BatchJobInfo> {
    const query = `
      SELECT Id, Status, JobItemsProcessed, TotalJobItems,
             NumberOfErrors, CompletedDate, ExtendedStatus
      FROM AsyncApexJob
      WHERE Id = '${jobId}'
    `;

    const result = await this.orgHelper.query<BatchJobInfo>(query);

    if (result.length === 0) {
      throw new Error(`Batch job not found: ${jobId}`);
    }

    return result[0];
  }

  /**
   * Get comprehensive batch execution results
   * Includes job info and created documents
   *
   * @param jobId - AsyncApexJob ID
   * @param templateId - Template ID to filter documents
   * @returns Complete batch results
   */
  async getBatchResults(jobId: string, templateId: string): Promise<BatchResults> {
    // Wait for batch to complete
    const jobInfo = await this.waitForBatchCompletion(jobId);

    // Query documents created by this batch
    // Use Template__c and CreatedDate to identify documents from this batch run
    const query = `
      SELECT Id, Status__c, RequestHash__c, Error__c
      FROM Generated_Document__c
      WHERE Template__c = '${templateId}'
      AND CreatedDate >= YESTERDAY
      ORDER BY CreatedDate DESC
    `;

    const documents = await this.orgHelper.query<{
      Id: string;
      Status__c: string;
      Error__c: string | null;
    }>(query);

    // Count by status
    const successCount = documents.filter(d => d.Status__c === 'SUCCEEDED').length;
    const failureCount = documents.filter(d => d.Status__c === 'FAILED').length;

    return {
      jobInfo,
      documentsCreated: documents.length,
      documentIds: documents.map(d => d.Id),
      successCount,
      failureCount
    };
  }

  /**
   * Create test records for batch processing
   * Generates multiple records of the same type
   *
   * @param objectType - SObject API name (e.g., 'Account', 'Contact', 'Lead')
   * @param count - Number of records to create
   * @param fieldValues - Additional field values to set
   * @returns Array of created record IDs
   */
  async createTestRecords(
    objectType: string,
    count: number,
    fieldValues: Record<string, any> = {}
  ): Promise<string[]> {
    const recordIds: string[] = [];

    // Generate records with unique names
    for (let i = 0; i < count; i++) {
      const timestamp = Date.now();
      const uniqueName = `Test ${objectType} ${i + 1} - ${timestamp}`;

      const record = {
        Name: uniqueName,
        ...fieldValues
      };

      const result = await this.orgHelper.createRecord(objectType, record);
      recordIds.push(result.id);
    }

    console.log(`Created ${count} ${objectType} records for batch testing`);
    return recordIds;
  }

  /**
   * Create test Accounts for batch processing
   * Convenience method with Account-specific defaults
   */
  async createTestAccounts(count: number): Promise<string[]> {
    const timestamp = Date.now();
    return await this.createTestRecords('Account', count, {
      Industry: 'Technology',
      AnnualRevenue: 1000000,
      Description: `Test Account for Batch Processing - ${timestamp}`
    });
  }

  /**
   * Create test Contacts for batch processing
   */
  async createTestContacts(count: number, accountId?: string): Promise<string[]> {
    const recordIds: string[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
      const uniqueIdentifier = `${timestamp}-${i}`;
      const fields: Record<string, any> = {
        FirstName: `TestContact${i + 1}`,
        LastName: `Batch${uniqueIdentifier}`,
        Email: `test.contact.${uniqueIdentifier}@example.com`,
        Department: 'Sales'
      };

      if (accountId) {
        fields.AccountId = accountId;
      }

      const result = await this.orgHelper.createRecord('Contact', fields);
      recordIds.push(result.id);
    }

    console.log(`Created ${count} Contact records for batch testing`);
    return recordIds;
  }

  /**
   * Create test Leads for batch processing
   */
  async createTestLeads(count: number): Promise<string[]> {
    const recordIds: string[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
      const uniqueIdentifier = `${timestamp}-${i}`;
      const fields: Record<string, any> = {
        FirstName: `TestLead${i + 1}`,
        LastName: `Batch${uniqueIdentifier}`,
        Company: `Test Company ${uniqueIdentifier}`,
        Email: `test.lead.${uniqueIdentifier}@example.com`,
        Status: 'Open - Not Contacted'
      };

      const result = await this.orgHelper.createRecord('Lead', fields);
      recordIds.push(result.id);
    }

    console.log(`Created ${count} Lead records for batch testing`);
    return recordIds;
  }

  /**
   * Create test Opportunities for batch processing
   */
  async createTestOpportunities(count: number, accountId: string): Promise<string[]> {
    const recordIds: string[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
      const uniqueName = `Test Opportunity ${i + 1} - ${timestamp}`;
      const closeDate = new Date();
      closeDate.setMonth(closeDate.getMonth() + 1);

      const record = {
        Name: uniqueName,
        AccountId: accountId,
        StageName: 'Prospecting',
        CloseDate: closeDate.toISOString().split('T')[0],
        Amount: 50000
      };

      const result = await this.orgHelper.createRecord('Opportunity', record);
      recordIds.push(result.id);
    }

    console.log(`Created ${count} Opportunity records for batch testing`);
    return recordIds;
  }

  /**
   * Query Generated_Document__c records by parent IDs
   * Useful for verifying batch created correct documents
   *
   * @param parentIds - Array of parent record IDs (Account, Contact, etc.)
   * @param parentField - Parent field name (e.g., 'Account__c')
   * @returns Array of document records
   */
  async getDocumentsByParent(
    parentIds: string[],
    parentField: string = 'Account__c'
  ): Promise<Array<{
    Id: string;
    Status__c: string;
    [key: string]: any;
  }>> {
    const idList = parentIds.map(id => `'${id}'`).join(',');
    const query = `
      SELECT Id, Status__c, RequestHash__c, ${parentField},
             Template__c, OutputFileId__c, Error__c, Attempts__c, OutputFormat__c
      FROM Generated_Document__c
      WHERE ${parentField} IN (${idList})
      ORDER BY CreatedDate DESC
    `;

    return await this.orgHelper.query(query);
  }

  /**
   * Verify all records have corresponding documents created by batch
   * Run immediately after batch execution
   *
   * Note: When worker poller is running, documents may be picked up immediately,
   * so we accept QUEUED, PROCESSING, or SUCCEEDED status as valid.
   *
   * @param recordIds - Array of record IDs that should have documents
   * @param parentField - Parent field to check
   * @returns true if all have documents created
   */
  async verifyAllQueued(recordIds: string[], parentField: string = 'Account__c'): Promise<boolean> {
    const documents = await this.getDocumentsByParent(recordIds, parentField);

    // Check that we have one document per record
    if (documents.length !== recordIds.length) {
      console.error(
        `Expected ${recordIds.length} documents, found ${documents.length}`
      );
      return false;
    }

    // Verify all are in valid states (QUEUED, PROCESSING, or SUCCEEDED)
    // Worker poller may pick up documents immediately, so we can't assume they're still QUEUED
    const validStatuses = ['QUEUED', 'PROCESSING', 'SUCCEEDED'];
    const allValid = documents.every(doc => validStatuses.includes(doc.Status__c));

    if (!allValid) {
      const statusCounts = documents.reduce((acc, doc) => {
        acc[doc.Status__c] = (acc[doc.Status__c] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.error(`Documents have unexpected statuses: ${JSON.stringify(statusCounts)}`);
      return false;
    }

    return true;
  }

  /**
   * Execute batch and wait for all documents to be QUEUED
   * Convenience method that combines execution and verification
   *
   * @returns Document IDs created by batch
   */
  async executeBatchAndVerifyQueued(config: BatchEnqueueConfig): Promise<string[]> {
    // Execute batch
    const jobId = await this.executeBatchEnqueue(config);
    console.log(`Batch job started: ${jobId}`);

    // Wait for batch completion
    const jobInfo = await this.waitForBatchCompletion(jobId);

    if (jobInfo.Status !== 'Completed') {
      throw new Error(
        `Batch did not complete successfully. Status: ${jobInfo.Status}, ` +
        `Extended: ${jobInfo.ExtendedStatus}`
      );
    }

    console.log(
      `Batch completed: ${jobInfo.JobItemsProcessed} items processed, ` +
      `${jobInfo.NumberOfErrors} errors`
    );

    // Verify documents created
    const parentField = config.parentField || 'Account__c';
    const documents = await this.getDocumentsByParent(config.recordIds, parentField);

    if (documents.length === 0) {
      throw new Error('Batch completed but no documents were created');
    }

    // Verify all documents created (may be QUEUED, PROCESSING, or SUCCEEDED if worker is active)
    const allCreated = await this.verifyAllQueued(config.recordIds, parentField);

    if (!allCreated) {
      throw new Error('Not all batch documents were created successfully');
    }

    console.log(`Verified ${documents.length} documents created and QUEUED`);
    return documents.map(d => d.Id);
  }

  /**
   * Delete test records and associated documents
   * Cleanup utility for test isolation
   */
  async cleanupTestData(recordIds: string[], objectType: string): Promise<void> {
    if (recordIds.length === 0) {
      return;
    }

    // Delete Generated_Document__c records first (due to lookup relationships)
    const parentField = `${objectType}__c`;
    const documents = await this.getDocumentsByParent(recordIds, parentField);

    if (documents.length > 0) {
      const docIds = documents.map(d => d.Id);
      await this.orgHelper.deleteRecords('Generated_Document__c', docIds);
      console.log(`Deleted ${documents.length} Generated_Document__c records`);
    }

    // Delete parent records
    await this.orgHelper.deleteRecords(objectType, recordIds);
    console.log(`Deleted ${recordIds.length} ${objectType} records`);
  }
}
