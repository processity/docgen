import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ConversionOptions, ConversionPoolStats } from '../types';
import { createLogger } from '../utils/logger';
import { trackDependency } from '../obs';

const logger = createLogger('convert:soffice');
const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 60000; // 60 seconds
const DEFAULT_WORKDIR = '/tmp';
const DEFAULT_MAX_CONCURRENT = 8;

/**
 * LibreOffice Conversion Pool
 *
 * Converts DOCX to PDF using soffice --headless with bounded concurrency.
 * Per ADR-0003: max 8 concurrent conversions per instance (ACA: 2 vCPU / 4 GB).
 *
 * Features:
 * - Bounded concurrency (configurable, default 8)
 * - Timeout handling with process kill
 * - Robust temp file cleanup
 * - Queue management for backpressure
 * - Stats tracking for observability
 *
 * @example
 * ```typescript
 * const converter = new LibreOfficeConverter(8);
 * const docxBuffer = Buffer.from('...');
 * const pdfBuffer = await converter.convertToPdf(docxBuffer, {
 *   timeout: 60000,
 *   correlationId: 'request-123'
 * });
 * ```
 */
export class LibreOfficeConverter {
  private activeJobs: number = 0;
  private queue: Array<() => void> = [];
  private stats: ConversionPoolStats = {
    activeJobs: 0,
    queuedJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    totalConversions: 0,
  };

  constructor(private maxConcurrent: number = DEFAULT_MAX_CONCURRENT) {
    logger.info(
      { maxConcurrent: this.maxConcurrent },
      'LibreOfficeConverter initialized'
    );
  }

  /**
   * Convert DOCX buffer to PDF buffer
   *
   * @param docxBuffer - DOCX file as Buffer
   * @param options - Conversion options (timeout, workdir, correlationId)
   * @returns PDF file as Buffer
   * @throws Error if conversion fails, times out, or cleanup fails
   */
  async convertToPdf(
    docxBuffer: Buffer,
    options: ConversionOptions = {}
  ): Promise<Buffer> {
    const correlationId = options.correlationId || this.generateCorrelationId();
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const workdir = options.workdir || DEFAULT_WORKDIR;

    logger.debug(
      {
        correlationId,
        docxSize: docxBuffer.length,
        timeout,
        workdir,
      },
      'Starting DOCX to PDF conversion'
    );

    // Acquire slot in the pool (may queue if pool is full)
    await this.acquireSlot(correlationId);

    const startTime = Date.now();

    try {
      this.stats.activeJobs = this.activeJobs;
      this.stats.totalConversions++;

      // Run the actual conversion
      const result = await this.runConversion(
        docxBuffer,
        timeout,
        workdir,
        correlationId
      );

      const duration = Date.now() - startTime;

      // Track successful dependency
      trackDependency({
        type: 'LibreOffice',
        name: 'DOCX to PDF conversion',
        duration,
        success: true,
        correlationId,
      });

      this.stats.completedJobs++;
      logger.info(
        {
          correlationId,
          pdfSize: result.length,
          stats: this.stats,
        },
        'Conversion completed successfully'
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Track failed dependency
      trackDependency({
        type: 'LibreOffice',
        name: 'DOCX to PDF conversion',
        duration,
        success: false,
        correlationId,
        error: errorMessage,
      });

      this.stats.failedJobs++;
      logger.error(
        {
          correlationId,
          error: errorMessage,
          stats: this.stats,
        },
        'Conversion failed'
      );
      throw error;
    } finally {
      this.releaseSlot(correlationId);
    }
  }

  /**
   * Acquire a slot in the conversion pool
   * If pool is full, the promise will wait in queue until a slot is available
   */
  private async acquireSlot(correlationId: string): Promise<void> {
    if (this.activeJobs < this.maxConcurrent) {
      this.activeJobs++;
      logger.debug(
        {
          correlationId,
          activeJobs: this.activeJobs,
          maxConcurrent: this.maxConcurrent,
        },
        'Slot acquired immediately'
      );
      return;
    }

    // Pool is full, queue and wait
    this.stats.queuedJobs++;
    logger.debug(
      {
        correlationId,
        queuedJobs: this.stats.queuedJobs,
      },
      'Pool full, waiting in queue'
    );

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });

    this.stats.queuedJobs--;
    logger.debug(
      {
        correlationId,
        activeJobs: this.activeJobs,
      },
      'Slot acquired from queue'
    );
  }

  /**
   * Release a slot in the conversion pool
   * If queue has waiting jobs, immediately grant slot to next in queue
   */
  private releaseSlot(correlationId: string): void {
    this.activeJobs--;
    this.stats.activeJobs = this.activeJobs;

    logger.debug(
      {
        correlationId,
        activeJobs: this.activeJobs,
        queueLength: this.queue.length,
      },
      'Slot released'
    );

    // Grant slot to next queued job
    const next = this.queue.shift();
    if (next) {
      this.activeJobs++;
      next();
    }
  }

  /**
   * Run the actual conversion using LibreOffice
   *
   * Process:
   * 1. Create temp directory
   * 2. Write DOCX to temp file
   * 3. Execute soffice --headless --convert-to pdf
   * 4. Read PDF from output
   * 5. Cleanup temp directory
   */
  private async runConversion(
    docxBuffer: Buffer,
    timeout: number,
    workdir: string,
    correlationId: string
  ): Promise<Buffer> {
    // Create unique temp directory with random component to prevent collisions
    const randomSuffix = Math.random().toString(36).substring(2, 15);
    const jobId = `docgen-${correlationId}-${Date.now()}-${randomSuffix}`;
    const jobWorkdir = path.join(workdir, jobId);

    try {
      // Create temp directory
      await fs.mkdir(jobWorkdir, { recursive: true });
      logger.debug({ correlationId, jobWorkdir }, 'Created temp directory');

      // Write DOCX to temp file
      const inputPath = path.join(jobWorkdir, 'input.docx');
      await fs.writeFile(inputPath, docxBuffer);
      logger.debug(
        { correlationId, inputPath, size: docxBuffer.length },
        'Wrote DOCX to temp file'
      );

      // Execute LibreOffice conversion
      const outputPath = path.join(jobWorkdir, 'input.pdf');
      await this.executeLibreOffice(
        inputPath,
        jobWorkdir,
        timeout,
        correlationId
      );

      // Read PDF from output
      const pdfBuffer = await fs.readFile(outputPath);
      logger.debug(
        { correlationId, outputPath, size: pdfBuffer.length },
        'Read PDF from output'
      );

      return pdfBuffer;
    } finally {
      // Always cleanup temp directory
      if (jobWorkdir) {
        try {
          await fs.rm(jobWorkdir, { recursive: true, force: true });
          logger.debug({ correlationId, jobWorkdir }, 'Cleaned up temp directory');
        } catch (cleanupError) {
          logger.warn(
            {
              correlationId,
              jobWorkdir,
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
            },
            'Failed to cleanup temp directory'
          );
        }
      }
    }
  }

  /**
   * Execute LibreOffice soffice command
   *
   * Command: soffice --headless --convert-to pdf --outdir <dir> <inputFile>
   */
  private async executeLibreOffice(
    inputPath: string,
    outputDir: string,
    timeout: number,
    correlationId: string
  ): Promise<void> {
    // Create unique user profile directory to prevent lock conflicts
    const userProfile = path.join(outputDir, '.libreoffice-profile');

    const args = [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      `-env:UserInstallation=file://${userProfile}`,
      inputPath,
    ];

    logger.debug(
      {
        correlationId,
        command: 'soffice',
        args,
        timeout,
      },
      'Executing LibreOffice conversion'
    );

    try {
      const { stdout, stderr } = await execFileAsync('soffice', args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for stdout/stderr
      });

      if (stderr) {
        logger.warn(
          { correlationId, stderr },
          'LibreOffice produced stderr output'
        );
      }

      logger.debug(
        { correlationId, stdout: stdout ? stdout.trim() : '' },
        'LibreOffice conversion completed'
      );
    } catch (error: any) {
      // Check if error is timeout
      if (error.killed || error.signal === 'SIGTERM') {
        const timeoutError = new Error(
          `LibreOffice conversion timed out after ${timeout}ms`
        );
        logger.error(
          { correlationId, timeout, killed: error.killed, signal: error.signal },
          'LibreOffice conversion timed out'
        );
        throw timeoutError;
      }

      // Check if error is non-zero exit code
      if (error.code) {
        // Build detailed error message with both stderr and stdout
        const errorDetails = [];
        if (error.stderr) errorDetails.push(`stderr: ${error.stderr.trim()}`);
        if (error.stdout) errorDetails.push(`stdout: ${error.stdout.trim()}`);
        const detailsStr = errorDetails.length > 0 ? ` | ${errorDetails.join(' | ')}` : '';

        const exitError = new Error(
          `LibreOffice conversion failed with exit code ${error.code}: ${error.message}${detailsStr}`
        );
        logger.error(
          {
            correlationId,
            exitCode: error.code,
            stderr: error.stderr,
            stdout: error.stdout,
            command: error.cmd,
          },
          'LibreOffice conversion failed'
        );
        throw exitError;
      }

      // Other errors
      logger.error(
        { correlationId, error: error.message },
        'LibreOffice execution error'
      );
      throw error;
    }
  }

  /**
   * Get current pool statistics
   */
  getStats(): ConversionPoolStats {
    return { ...this.stats };
  }

  /**
   * Generate a correlation ID if not provided
   */
  private generateCorrelationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Singleton instance
let converterInstance: LibreOfficeConverter | null = null;

/**
 * Get or create the singleton LibreOfficeConverter instance
 */
export function getLibreOfficeConverter(): LibreOfficeConverter {
  if (!converterInstance) {
    converterInstance = new LibreOfficeConverter(DEFAULT_MAX_CONCURRENT);
  }
  return converterInstance;
}

/**
 * Create a new LibreOfficeConverter instance (for testing)
 */
export function createLibreOfficeConverter(
  maxConcurrent?: number
): LibreOfficeConverter {
  return new LibreOfficeConverter(maxConcurrent);
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetLibreOfficeConverter(): void {
  converterInstance = null;
}

/**
 * Singleton instance (default export)
 */
export const libreOfficeConverter = getLibreOfficeConverter();

/**
 * Convenience function for converting DOCX to PDF using the singleton instance
 *
 * @param docxBuffer - DOCX file as Buffer
 * @param options - Conversion options (timeout, workdir, correlationId)
 * @returns PDF file as Buffer
 */
export async function convertDocxToPdf(
  docxBuffer: Buffer,
  options?: ConversionOptions
): Promise<Buffer> {
  return getLibreOfficeConverter().convertToPdf(docxBuffer, options);
}
