/**
 * Worker Helper Utilities for E2E Tests
 *
 * Provides utilities for testing worker/poller functionality including:
 * - Document status polling and verification
 * - Worker statistics monitoring
 * - PDF file validation
 * - Status transition tracking
 */

import { Page } from '@playwright/test';
import { ScratchOrgHelper } from './scratch-org';
import * as WorkerControl from './worker-control';

export interface DocumentStatus {
  Id: string;
  Status__c: string;
  Attempts__c: number;
  Error__c: string | null;
  OutputFileId__c: string | null;
  LockedUntil__c: string | null;
  ScheduledRetryTime__c: string | null;
}

export interface WorkerStats {
  isRunning: boolean;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  totalRetries: number;
  currentQueueDepth: number;
  lastPollTime: string | null;
}

export class WorkerHelper {
  constructor(
    private page: Page,
    private orgHelper: ScratchOrgHelper,
    private backendUrl: string
  ) {}

  /**
   * Wait for a document to reach a specific status
   * Polls every 2 seconds with configurable max wait time
   *
   * @param documentId - Generated_Document__c record ID
   * @param expectedStatus - Expected status value (QUEUED, PROCESSING, SUCCEEDED, FAILED)
   * @param maxWaitMs - Maximum time to wait in milliseconds (default: 90000 = 90s)
   * @returns Document record when status matches
   * @throws Error if timeout or document not found
   */
  async waitForDocumentStatus(
    documentId: string,
    expectedStatus: string,
    maxWaitMs: number = 90000
  ): Promise<DocumentStatus> {
    const startTime = Date.now();
    const pollIntervalMs = 2000; // Poll every 2 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const doc = await this.getDocumentStatus(documentId);

      if (doc.Status__c === expectedStatus) {
        return doc;
      }

      // Wait before next poll
      await this.page.waitForTimeout(pollIntervalMs);
    }

    // Timeout - get final status for error message
    const finalDoc = await this.getDocumentStatus(documentId);
    throw new Error(
      `Timeout waiting for document ${documentId} to reach status ${expectedStatus}. ` +
      `Current status: ${finalDoc.Status__c}, Attempts: ${finalDoc.Attempts__c}, ` +
      `Error: ${finalDoc.Error__c || 'none'}`
    );
  }

  /**
   * Get current status of a document
   */
  async getDocumentStatus(documentId: string): Promise<DocumentStatus> {
    const query = `
      SELECT Id, Status__c, Attempts__c, Error__c, OutputFileId__c,
             LockedUntil__c, ScheduledRetryTime__c
      FROM Generated_Document__c
      WHERE Id = '${documentId}'
    `;

    const result = await this.orgHelper.query<DocumentStatus>(query);

    if (result.length === 0) {
      throw new Error(`Document not found: ${documentId}`);
    }

    return result[0];
  }

  /**
   * Verify document transitions through expected status sequence
   *
   * @param documentId - Generated_Document__c record ID
   * @param expectedStatuses - Array of expected statuses in order (e.g., ['QUEUED', 'PROCESSING', 'SUCCEEDED'])
   * @param maxWaitMs - Max wait time for entire sequence
   */
  async verifyDocumentTransition(
    documentId: string,
    expectedStatuses: string[],
    maxWaitMs: number = 120000
  ): Promise<void> {
    for (const status of expectedStatuses) {
      await this.waitForDocumentStatus(documentId, status, maxWaitMs);
    }
  }

  /**
   * Wait for multiple documents to all reach a specific status
   * Useful for batch processing tests
   *
   * @param documentIds - Array of document IDs
   * @param expectedStatus - Expected final status
   * @param maxWaitMs - Maximum wait time
   */
  async waitForQueueProcessing(
    documentIds: string[],
    expectedStatus: string = 'SUCCEEDED',
    maxWaitMs: number = 180000
  ): Promise<DocumentStatus[]> {
    const startTime = Date.now();
    const pollIntervalMs = 3000; // Poll every 3 seconds for batch operations

    while (Date.now() - startTime < maxWaitMs) {
      const statuses = await this.getBatchDocumentStatuses(documentIds);

      // Check if all documents reached expected status
      const allComplete = statuses.every(doc => doc.Status__c === expectedStatus);

      if (allComplete) {
        return statuses;
      }

      // Log progress for debugging
      const completedCount = statuses.filter(doc => doc.Status__c === expectedStatus).length;
      console.log(`Batch progress: ${completedCount}/${documentIds.length} documents completed`);

      // Wait before next poll
      await this.page.waitForTimeout(pollIntervalMs);
    }

    // Timeout - get final statuses for error reporting
    const finalStatuses = await this.getBatchDocumentStatuses(documentIds);
    const statusCounts = this.countStatuses(finalStatuses);

    throw new Error(
      `Timeout waiting for ${documentIds.length} documents to reach ${expectedStatus}. ` +
      `Current: ${JSON.stringify(statusCounts)}`
    );
  }

  /**
   * Get statuses for multiple documents
   */
  async getBatchDocumentStatuses(documentIds: string[]): Promise<DocumentStatus[]> {
    const idList = documentIds.map(id => `'${id}'`).join(',');
    const query = `
      SELECT Id, Status__c, Attempts__c, Error__c, OutputFileId__c,
             LockedUntil__c, ScheduledRetryTime__c
      FROM Generated_Document__c
      WHERE Id IN (${idList})
      ORDER BY CreatedDate ASC
    `;

    return await this.orgHelper.query<DocumentStatus>(query);
  }

  /**
   * Count documents by status for reporting
   */
  private countStatuses(statuses: DocumentStatus[]): Record<string, number> {
    return statuses.reduce((acc, doc) => {
      acc[doc.Status__c] = (acc[doc.Status__c] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Verify that a PDF file was successfully uploaded to Salesforce
   *
   * @param contentVersionId - ContentVersion ID from OutputFileId__c
   * @returns true if PDF exists and is valid
   */
  async verifyPDFExists(contentVersionId: string): Promise<boolean> {
    const query = `
      SELECT Id, Title, FileExtension, ContentSize, VersionData
      FROM ContentVersion
      WHERE Id = '${contentVersionId}'
    `;

    const result = await this.orgHelper.query<{
      Id: string;
      Title: string;
      FileExtension: string;
      ContentSize: number;
    }>(query);

    if (result.length === 0) {
      return false;
    }

    const file = result[0];

    // Validate it's a PDF with non-zero size
    return file.FileExtension === 'pdf' && file.ContentSize > 0;
  }

  /**
   * Verify worker is running via worker status check
   * Note: Worker is always-on, so this should always return true
   */
  async verifyWorkerRunning(): Promise<boolean> {
    try {
      const status = await WorkerControl.getWorkerStatus();
      return status.isRunning;
    } catch (error) {
      console.error('Failed to verify worker status:', error);
      return false;
    }
  }

  /**
   * Get worker statistics via Apex controller
   * Uses DocgenStatusController.getWorkerStats() which handles authentication
   */
  async getWorkerStats(): Promise<WorkerStats> {
    const apexCode = `
Map<String, Object> stats = DocgenStatusController.getWorkerStats();
System.debug('WORKER_STATS:' + JSON.serialize(stats));
    `.trim();

    const result = await this.orgHelper.executeAnonymousApex(apexCode);

    if (!result.success) {
      throw new Error(`Failed to get worker stats via Apex: ${result.compileProblem || result.exceptionMessage}`);
    }

    // Extract stats from debug logs
    const statsMatch = result.logs?.match(/WORKER_STATS:(\{.*?\})/);
    if (!statsMatch) {
      throw new Error('Could not extract worker stats from Apex logs');
    }

    return JSON.parse(statsMatch[1]);
  }

  /**
   * Wait for worker to process at least a certain number of documents
   * Polls worker stats endpoint
   *
   * @param minimumProcessed - Minimum number of documents that should be processed
   * @param maxWaitMs - Maximum wait time
   */
  async waitForWorkerToProcess(
    minimumProcessed: number,
    maxWaitMs: number = 120000
  ): Promise<WorkerStats> {
    const startTime = Date.now();
    const pollIntervalMs = 3000;

    while (Date.now() - startTime < maxWaitMs) {
      const stats = await this.getWorkerStats();

      if (stats.totalProcessed >= minimumProcessed) {
        return stats;
      }

      console.log(`Worker processed: ${stats.totalProcessed}/${minimumProcessed}`);
      await this.page.waitForTimeout(pollIntervalMs);
    }

    const finalStats = await this.getWorkerStats();
    throw new Error(
      `Timeout waiting for worker to process ${minimumProcessed} documents. ` +
      `Current: ${finalStats.totalProcessed}`
    );
  }

  /**
   * Verify ContentDocumentLinks exist for a document
   * Checks that PDF is linked to parent records
   *
   * @param contentDocumentId - ContentDocument ID (not ContentVersion)
   * @param expectedParentIds - Array of expected parent IDs (Account, Opportunity, etc.)
   */
  async verifyContentDocumentLinks(
    contentDocumentId: string,
    expectedParentIds: string[]
  ): Promise<boolean> {
    const parentIdList = expectedParentIds.map(id => `'${id}'`).join(',');
    const query = `
      SELECT Id, LinkedEntityId, ShareType, Visibility
      FROM ContentDocumentLink
      WHERE ContentDocumentId = '${contentDocumentId}'
      AND LinkedEntityId IN (${parentIdList})
    `;

    const links = await this.orgHelper.query<{
      Id: string;
      LinkedEntityId: string;
    }>(query);

    // Verify all expected parents are linked
    const linkedParentIds = links.map(link => link.LinkedEntityId);
    return expectedParentIds.every(parentId => linkedParentIds.includes(parentId));
  }

  /**
   * Get ContentDocument ID from ContentVersion ID
   */
  async getContentDocumentId(contentVersionId: string): Promise<string> {
    const query = `
      SELECT ContentDocumentId
      FROM ContentVersion
      WHERE Id = '${contentVersionId}'
    `;

    const result = await this.orgHelper.query<{ ContentDocumentId: string }>(query);

    if (result.length === 0) {
      throw new Error(`ContentVersion not found: ${contentVersionId}`);
    }

    return result[0].ContentDocumentId;
  }

  /**
   * Wait for document to be locked by poller
   * Useful for testing lock mechanism
   *
   * Note: Documents may process very quickly. This method tries to catch the lock,
   * but if the document processes before we can observe the lock, it will return
   * the processed document instead of throwing an error.
   */
  async waitForDocumentLock(
    documentId: string,
    maxWaitMs: number = 30000
  ): Promise<DocumentStatus | null> {
    const startTime = Date.now();
    const pollIntervalMs = 500; // Poll more frequently to catch lock (was 1000ms)

    while (Date.now() - startTime < maxWaitMs) {
      const doc = await this.getDocumentStatus(documentId);

      // Document is locked if LockedUntil is in the future
      if (doc.LockedUntil__c) {
        const lockTime = new Date(doc.LockedUntil__c).getTime();
        if (lockTime > Date.now()) {
          return doc;
        }
      }

      // If document already processed (SUCCEEDED or FAILED), return null
      // This means it processed too quickly for us to catch the lock
      if (doc.Status__c === 'SUCCEEDED' || doc.Status__c === 'FAILED') {
        console.log(`⚠️  Document ${documentId} processed too quickly - lock not observable`);
        return null;
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    // Final check - if document is now processed, that's acceptable
    const finalDoc = await this.getDocumentStatus(documentId);
    if (finalDoc.Status__c === 'SUCCEEDED' || finalDoc.Status__c === 'FAILED') {
      console.log(`⚠️  Document ${documentId} processed during wait - lock not observable`);
      return null;
    }

    throw new Error(
      `Timeout waiting for document ${documentId} to be locked or processed. ` +
      `Current status: ${finalDoc.Status__c}`
    );
  }

  /**
   * Create a QUEUED document directly (bypassing batch)
   * Useful for testing poller in isolation
   */
  async createQueuedDocument(config: {
    templateId: string;
    accountId: string;
    outputFileName: string;
    outputFormat: string;
    requestJSON: string;
    requestHash: string;
  }): Promise<string> {
    const result = await this.orgHelper.createRecord('Generated_Document__c', {
      Template__c: config.templateId,
      Account__c: config.accountId,
      Status__c: 'QUEUED',
      OutputFormat__c: config.outputFormat,
      RequestJSON__c: config.requestJSON,
      RequestHash__c: config.requestHash,
      Priority__c: 1,
      Attempts__c: 0
    });

    return result.id;
  }
}
