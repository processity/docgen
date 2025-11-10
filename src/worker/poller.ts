import pino from 'pino';
import { loadConfig } from '../config';
import { getSalesforceAuth } from '../sf/auth';
import { SalesforceApi } from '../sf/api';
import { TemplateService } from '../templates/service';
import { mergeTemplate } from '../templates/merge';
import { convertDocxToPdf } from '../convert/soffice';
import {
  uploadContentVersion,
  createContentDocumentLinks,
  updateGeneratedDocument,
} from '../sf/files';
import type {
  QueuedDocument,
  PollerStats,
  ProcessingResult,
  DocgenRequest,
} from '../types';

const logger = pino();
const config = loadConfig();

export class PollerService {
  private running: boolean = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  private currentQueueDepth: number = 0;
  private stats: PollerStats = {
    isRunning: false,
    currentQueueDepth: 0,
    totalProcessed: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalRetries: 0,
    lastPollTime: null,
    uptimeSeconds: 0,
  };
  private startTime: number | null = null;
  private inFlightPromises: Set<Promise<any>> = new Set();

  constructor() {
    logger.info('PollerService initialized');
  }

  /**
   * Start the polling loop
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Poller is already running');
    }

    logger.info('Starting poller service');
    this.running = true;
    this.startTime = Date.now();
    this.stats.isRunning = true;

    // Start polling loop
    await this.scheduleNextPoll();
  }

  /**
   * Stop the polling loop gracefully
   */
  async stop(): Promise<void> {
    if (!this.running) {
      logger.info('Poller is not running');
      return;
    }

    logger.info('Stopping poller service');
    this.running = false;

    // Clear the timer
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    // Wait for in-flight jobs to complete
    if (this.inFlightPromises.size > 0) {
      logger.info(
        { count: this.inFlightPromises.size },
        'Waiting for in-flight jobs to complete'
      );
      await Promise.allSettled(Array.from(this.inFlightPromises));
    }

    this.stats.isRunning = false;
    logger.info('Poller service stopped');
  }

  /**
   * Check if poller is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get current statistics
   */
  getStats(): PollerStats {
    const uptimeSeconds =
      this.startTime && this.running ? Math.floor((Date.now() - this.startTime) / 1000) : 0;

    return {
      ...this.stats,
      uptimeSeconds,
    };
  }

  /**
   * Set queue depth (for testing and internal use)
   */
  setQueueDepth(depth: number): void {
    this.currentQueueDepth = depth;
    this.stats.currentQueueDepth = depth;
  }

  /**
   * Get adaptive polling interval based on queue activity
   */
  getPollingInterval(): number {
    if (this.currentQueueDepth > 0) {
      return config.poller.intervalMs; // 15 seconds when active
    }
    return config.poller.idleIntervalMs; // 60 seconds when idle
  }

  /**
   * Schedule next poll cycle
   */
  private async scheduleNextPoll(): Promise<void> {
    if (!this.running) {
      return;
    }

    const interval = this.getPollingInterval();

    this.pollingTimer = setTimeout(async () => {
      try {
        await this.processBatch();
      } catch (error) {
        logger.error({ error }, 'Error in polling cycle');
      } finally {
        // Schedule next poll
        await this.scheduleNextPoll();
      }
    }, interval);
  }

  /**
   * Main processing batch cycle
   */
  async processBatch(): Promise<void> {
    if (!this.running) {
      return;
    }

    const correlationId = `poll-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const log = logger.child({ correlationId });

    log.info('Starting poll cycle');
    this.stats.lastPollTime = new Date().toISOString();

    try {
      // Fetch queued documents
      const documents = await this.fetchQueuedDocuments();
      this.setQueueDepth(documents.length);

      if (documents.length === 0) {
        log.debug('No documents to process');
        return;
      }

      log.info({ count: documents.length }, 'Fetched queued documents');

      // Lock and process documents
      const results = await Promise.allSettled(
        documents.map((doc) => this.lockAndProcess(doc))
      );

      // Update statistics
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          this.stats.totalProcessed++;
          if (result.value.success) {
            this.stats.totalSucceeded++;
          } else {
            this.stats.totalFailed++;
            if (result.value.retried) {
              this.stats.totalRetries++;
            }
          }
        }
      });

      log.info(
        {
          processed: this.stats.totalProcessed,
          succeeded: this.stats.totalSucceeded,
          failed: this.stats.totalFailed,
        },
        'Poll cycle completed'
      );
    } catch (error) {
      log.error({ error }, 'Error in processBatch');
    }
  }

  /**
   * Lock a document and process it
   */
  private async lockAndProcess(doc: QueuedDocument): Promise<ProcessingResult | null> {
    const promise = (async () => {
      // Try to lock the document
      const locked = await this.lockDocument(doc.Id);
      if (!locked) {
        logger.debug({ documentId: doc.Id }, 'Failed to lock document, skipping');
        return null;
      }

      // Process the document
      const result = await this.processDocument(doc);
      return result;
    })();

    // Track in-flight promise
    this.inFlightPromises.add(promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.inFlightPromises.delete(promise);
    }
  }

  /**
   * Fetch queued documents from Salesforce
   */
  async fetchQueuedDocuments(): Promise<QueuedDocument[]> {
    try {
      const sfAuth = getSalesforceAuth();
      if (!sfAuth || !config.sfDomain) {
        throw new Error('Salesforce authentication not configured');
      }
      const sfApi = new SalesforceApi(sfAuth, `https://${config.sfDomain}`);

      const now = new Date().toISOString();
      const batchSize = config.poller.batchSize;

      // Query for QUEUED documents that are not locked or have expired locks
      const soql = `
        SELECT Id, Status__c, RequestJSON__c, Attempts__c, CorrelationId__c,
               Template__c, RequestHash__c, CreatedDate
        FROM Generated_Document__c
        WHERE Status__c = 'QUEUED'
          AND (LockedUntil__c < ${now} OR LockedUntil__c = null)
        ORDER BY Priority__c DESC NULLS LAST, CreatedDate ASC
        LIMIT ${batchSize}
      `.trim();

      const response = await sfApi.get<{ records: QueuedDocument[] }>(
        `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`
      );

      return response.records || [];
    } catch (error) {
      logger.error({ error }, 'Failed to fetch queued documents');
      return [];
    }
  }

  /**
   * Lock a document by setting Status=PROCESSING and LockedUntil
   */
  async lockDocument(documentId: string): Promise<boolean> {
    try {
      const sfAuth = getSalesforceAuth();
      if (!sfAuth || !config.sfDomain) {
        throw new Error('Salesforce authentication not configured');
      }
      const sfApi = new SalesforceApi(sfAuth, `https://${config.sfDomain}`);

      const lockUntil = new Date(Date.now() + config.poller.lockTtlMs).toISOString();

      await sfApi.patch(`/services/data/v59.0/sobjects/Generated_Document__c/${documentId}`, {
        Status__c: 'PROCESSING',
        LockedUntil__c: lockUntil,
      });

      logger.debug({ documentId, lockUntil }, 'Document locked successfully');
      return true;
    } catch (error) {
      logger.warn({ documentId, error }, 'Failed to lock document');
      return false;
    }
  }

  /**
   * Process a single document
   */
  async processDocument(doc: QueuedDocument): Promise<ProcessingResult> {
    const log = logger.child({
      correlationId: doc.CorrelationId__c,
      documentId: doc.Id,
    });

    log.info('Processing document');

    try {
      // Initialize Salesforce API and template service
      const sfAuth = getSalesforceAuth();
      if (!sfAuth || !config.sfDomain) {
        throw new Error('Salesforce authentication not configured');
      }
      const sfApi = new SalesforceApi(sfAuth, `https://${config.sfDomain}`);
      const templateService = new TemplateService(sfApi);

      // Parse request JSON
      const request: DocgenRequest = JSON.parse(doc.RequestJSON__c);

      // Fetch template
      log.debug({ templateId: request.templateId }, 'Fetching template');
      const templateBuffer = await templateService.getTemplate(
        request.templateId,
        doc.CorrelationId__c
      );

      // Merge template with data
      log.debug('Merging template');
      const mergedDocx = await mergeTemplate(templateBuffer, request.data, {
        locale: request.locale,
        timezone: request.timezone,
        imageAllowlist: config.imageAllowlist,
      });

      // Convert to PDF if needed
      let outputBuffer: Buffer;
      if (request.outputFormat === 'PDF') {
        log.debug('Converting DOCX to PDF');
        outputBuffer = await convertDocxToPdf(mergedDocx, {
          timeout: config.conversionTimeout,
          workdir: config.conversionWorkdir,
          correlationId: doc.CorrelationId__c,
        });
      } else {
        outputBuffer = mergedDocx;
      }

      // Upload file
      log.debug('Uploading file to Salesforce');
      const uploadResult = await uploadContentVersion(
        outputBuffer,
        request.outputFileName,
        sfApi,
        { correlationId: doc.CorrelationId__c }
      );

      // Create ContentDocumentLinks
      if (request.parents) {
        log.debug({ parents: request.parents }, 'Creating ContentDocumentLinks');
        await createContentDocumentLinks(uploadResult.contentDocumentId, request.parents, sfApi, {
          correlationId: doc.CorrelationId__c,
        });
      }

      // Handle merged DOCX storage if requested
      let mergedDocxFileId: string | undefined;
      if (request.options?.storeMergedDocx && request.outputFormat === 'PDF') {
        log.debug('Uploading merged DOCX');
        const docxFileName = request.outputFileName.replace(/\.pdf$/i, '.docx');
        const docxUpload = await uploadContentVersion(
          mergedDocx,
          docxFileName,
          sfApi,
          { correlationId: doc.CorrelationId__c }
        );
        mergedDocxFileId = docxUpload.contentVersionId;

        if (request.parents) {
          await createContentDocumentLinks(docxUpload.contentDocumentId, request.parents, sfApi, {
            correlationId: doc.CorrelationId__c,
          });
        }
      }

      // Update document status to SUCCEEDED
      await this.handleSuccess(doc.Id, uploadResult.contentVersionId, mergedDocxFileId);

      log.info({ contentVersionId: uploadResult.contentVersionId }, 'Document processed successfully');

      return {
        success: true,
        documentId: doc.Id,
        contentVersionId: uploadResult.contentVersionId,
      };
    } catch (error: any) {
      log.error({ error }, 'Failed to process document');

      // Determine if error is retryable
      const retryable = this.isRetryableError(error);

      // Handle failure
      await this.handleFailure(doc.Id, doc.Attempts__c, error.message, retryable);

      return {
        success: false,
        documentId: doc.Id,
        error: error.message,
        retryable,
        retried: retryable && doc.Attempts__c < config.poller.maxAttempts,
      };
    }
  }

  /**
   * Handle successful processing
   */
  async handleSuccess(
    documentId: string,
    contentVersionId: string,
    mergedDocxFileId?: string
  ): Promise<void> {
    try {
      const sfAuth = getSalesforceAuth();
      if (!sfAuth || !config.sfDomain) {
        throw new Error('Salesforce authentication not configured');
      }
      const sfApi = new SalesforceApi(sfAuth, `https://${config.sfDomain}`);

      await updateGeneratedDocument(
        documentId,
        {
          Status__c: 'SUCCEEDED',
          OutputFileId__c: contentVersionId,
          MergedDocxFileId__c: mergedDocxFileId,
        },
        sfApi
      );

      logger.debug({ documentId }, 'Updated document status to SUCCEEDED');
    } catch (error) {
      logger.error({ documentId, error }, 'Failed to update document status');
      // Non-fatal - the document was successfully processed
    }
  }

  /**
   * Handle failed processing
   */
  async handleFailure(
    documentId: string,
    currentAttempts: number,
    errorMessage: string,
    retryable: boolean
  ): Promise<void> {
    const newAttempts = currentAttempts + 1;

    try {
      const sfAuth = getSalesforceAuth();
      if (!sfAuth || !config.sfDomain) {
        throw new Error('Salesforce authentication not configured');
      }
      const sfApi = new SalesforceApi(sfAuth, `https://${config.sfDomain}`);

      // Check if we should retry
      if (retryable && newAttempts <= config.poller.maxAttempts) {
        // Calculate backoff
        const backoffMs = this.computeBackoff(newAttempts);
        const scheduledRetryTime = new Date(Date.now() + backoffMs).toISOString();

        // Requeue with backoff
        await sfApi.patch(`/services/data/v59.0/sobjects/Generated_Document__c/${documentId}`, {
          Status__c: 'QUEUED',
          Attempts__c: newAttempts,
          Error__c: `Attempt ${newAttempts} failed: ${errorMessage}`,
          ScheduledRetryTime__c: scheduledRetryTime,
        });

        logger.info(
          { documentId, attempts: newAttempts, backoffMs, scheduledRetryTime },
          'Document requeued for retry'
        );
      } else {
        // Mark as permanently FAILED
        await sfApi.patch(`/services/data/v59.0/sobjects/Generated_Document__c/${documentId}`, {
          Status__c: 'FAILED',
          Attempts__c: newAttempts,
          Error__c: retryable
            ? `Max attempts (${config.poller.maxAttempts}) exceeded. Last error: ${errorMessage}`
            : `Non-retryable error: ${errorMessage}`,
        });

        logger.warn(
          { documentId, attempts: newAttempts, retryable },
          'Document marked as FAILED'
        );
      }
    } catch (error) {
      logger.error({ documentId, error }, 'Failed to update document after failure');
    }
  }

  /**
   * Compute backoff delay based on attempt number
   */
  computeBackoff(attempts: number): number {
    switch (attempts) {
      case 1:
        return 60000; // 1 minute
      case 2:
        return 300000; // 5 minutes
      case 3:
        return 900000; // 15 minutes
      default:
        return 0; // No more retries
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';

    // Non-retryable errors
    if (
      message.includes('template not found') ||
      message.includes('not found') ||
      message.includes('invalid') ||
      message.includes('bad request') ||
      message.includes(' 404') || // Match ": 404" or " 404 "
      message.includes(' 400') || // Match ": 400" or " 400 "
      error.status === 404 ||
      error.status === 400
    ) {
      return false;
    }

    // Retryable errors (timeouts, network issues, 5xx errors)
    return true;
  }
}

// Singleton instance
export const pollerService = new PollerService();
