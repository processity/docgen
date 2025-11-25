/**
 * Enhanced Error Handling Module
 *
 * Provides structured error handling with:
 * - Error codes for programmatic handling
 * - HTTP status codes for API responses
 * - Retryable flag for batch processing
 * - Stack traces in API responses
 * - Full error details in Salesforce Error__c field
 *
 * Usage:
 *
 * ```typescript
 * import {
 *   DocgenError,
 *   TemplateNotFoundError,
 *   wrapError,
 *   buildSalesforceError,
 *   ErrorCode
 * } from './errors';
 *
 * // Throw a typed error
 * throw new TemplateNotFoundError('068xxx', { correlationId });
 *
 * // Wrap a plain error
 * const docgenError = wrapError(error, { templateId, correlationId });
 *
 * // Serialize for Salesforce
 * const errorJson = buildSalesforceError(error, { attempt: 1 });
 * ```
 */

// Error codes enum
export { ErrorCode } from './codes';

// Types and interfaces
export type { ErrorContext, ApiErrorResponse, SalesforceErrorPayload } from './types';

// Base error class
export { DocgenError } from './base';

// All specialized error classes
export {
  // Template errors
  TemplateNotFoundError,
  TemplateParseError,
  TemplateMergeError,
  TemplateInvalidFormatError,
  // Validation errors
  ValidationError,
  MissingNamespaceError,
  InvalidRequestError,
  MissingRequiredFieldError,
  // Conversion errors
  ConversionTimeoutError,
  ConversionFailedError,
  ConversionPoolExhaustedError,
  // Salesforce errors
  SalesforceApiError,
  SalesforceUploadError,
  SalesforceAuthError,
  SalesforceRecordNotFoundError,
  // Authentication errors
  AuthenticationError,
  AuthorizationError,
  TokenExpiredError,
  InvalidTokenError,
  // Configuration errors
  ConfigurationError,
  MissingConfigurationError,
  // Internal errors
  InternalError,
  UnknownError,
} from './classes';

// Handler utilities
export { wrapError, createErrorHandler, buildSalesforceError } from './handler';
