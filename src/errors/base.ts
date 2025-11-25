import { ErrorCode } from './codes';
import { ErrorContext, ApiErrorResponse, SalesforceErrorPayload } from './types';

/**
 * Base error class for all Docgen errors
 *
 * Provides structured error handling with:
 * - Error codes for programmatic handling
 * - HTTP status codes for API responses
 * - Retryable flag for batch processing
 * - Context for debugging and logging
 * - Serialization methods for API and Salesforce
 */
export abstract class DocgenError extends Error {
  /** Structured error code for programmatic handling */
  abstract readonly code: ErrorCode;

  /** HTTP status code to return */
  abstract readonly statusCode: number;

  /** Whether this error is retryable in batch processing */
  abstract readonly retryable: boolean;

  /** Additional context for debugging and logging */
  readonly context: ErrorContext;

  /** ISO 8601 timestamp when error occurred */
  readonly timestamp: string;

  constructor(message: string, context: ErrorContext = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error for API response
   *
   * @param correlationId - Request correlation ID for tracing
   * @returns Structured API error response
   */
  toApiResponse(correlationId: string): ApiErrorResponse {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      correlationId,
      stack: this.stack,
      timestamp: this.timestamp,
      context: Object.keys(this.context).length > 0 ? this.context : undefined,
    };
  }

  /**
   * Serialize error for Salesforce Error__c field
   *
   * Includes full stack trace and context for debugging.
   * Output is JSON string, truncated if necessary to fit within field limits.
   *
   * @returns JSON string for Error__c field
   */
  toSalesforceError(): string {
    const payload: SalesforceErrorPayload = {
      code: this.code,
      message: this.message,
      stack: this.truncateStack(this.stack, 15), // First 15 lines
      context: this.context,
      timestamp: this.timestamp,
    };

    const json = JSON.stringify(payload, null, 2);

    // Salesforce LongTextArea limit is 32,768 characters
    // Leave some buffer for safety
    if (json.length > 30000) {
      // Truncate stack further if needed
      payload.stack = this.truncateStack(this.stack, 5) + '\n... truncated';
      return JSON.stringify(payload, null, 2);
    }

    return json;
  }

  /**
   * Truncate stack trace to specified number of lines
   */
  private truncateStack(stack: string | undefined, maxLines: number): string | undefined {
    if (!stack) return undefined;
    const lines = stack.split('\n');
    if (lines.length <= maxLines) return stack;
    return lines.slice(0, maxLines).join('\n') + '\n    ... (' + (lines.length - maxLines) + ' more lines)';
  }
}
