import { ErrorCode } from './codes';

/**
 * Context information attached to errors for debugging and logging
 */
export interface ErrorContext {
  /** Template ContentVersionId */
  templateId?: string;
  /** Composite document ID */
  compositeDocumentId?: string;
  /** Generated document record ID */
  generatedDocumentId?: string;
  /** Request correlation ID for distributed tracing */
  correlationId?: string;
  /** File size in bytes */
  fileSize?: number;
  /** Processing duration in milliseconds */
  duration?: number;
  /** Current retry attempt number */
  attempt?: number;
  /** Maximum retry attempts allowed */
  maxAttempts?: number;
  /** Salesforce API path */
  path?: string;
  /** HTTP status code from upstream service */
  httpStatus?: number;
  /** LibreOffice process exit code */
  exitCode?: number;
  /** Namespace for composite document errors */
  namespace?: string;
  /** Output format (PDF/DOCX) */
  outputFormat?: string;
  /** Allow additional context fields */
  [key: string]: unknown;
}

/**
 * Structured error response returned by the API
 */
export interface ApiErrorResponse {
  /** Error class name (e.g., "TemplateNotFoundError") */
  error: string;
  /** Structured error code for programmatic handling */
  code: ErrorCode;
  /** Human-readable error message */
  message: string;
  /** HTTP status code */
  statusCode: number;
  /** Request correlation ID */
  correlationId: string;
  /** Stack trace for debugging */
  stack?: string;
  /** ISO 8601 timestamp when error occurred */
  timestamp: string;
  /** Additional context for debugging */
  context?: ErrorContext;
}

/**
 * Structured error payload stored in Salesforce Error__c field
 */
export interface SalesforceErrorPayload {
  /** Structured error code */
  code: ErrorCode;
  /** Human-readable error message */
  message: string;
  /** Stack trace (first 10 lines) */
  stack?: string;
  /** Error context for debugging */
  context: ErrorContext;
  /** ISO 8601 timestamp */
  timestamp: string;
}
