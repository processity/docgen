/**
 * Structured error codes for programmatic error handling
 *
 * Naming convention: DOMAIN_SPECIFIC_ERROR
 *
 * Categories:
 * - TEMPLATE_*    : Template-related errors
 * - VALIDATION_*  : Request validation errors
 * - CONVERSION_*  : LibreOffice conversion errors
 * - SALESFORCE_*  : Salesforce API errors
 * - AUTH_*        : Authentication/authorization errors
 * - INTERNAL_*    : Internal server errors
 */
export enum ErrorCode {
  // Template errors (4xx - client errors, non-retryable)
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  TEMPLATE_PARSE_ERROR = 'TEMPLATE_PARSE_ERROR',
  TEMPLATE_MERGE_ERROR = 'TEMPLATE_MERGE_ERROR',
  TEMPLATE_INVALID_FORMAT = 'TEMPLATE_INVALID_FORMAT',

  // Validation errors (400 - bad request, non-retryable)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MISSING_NAMESPACE = 'MISSING_NAMESPACE',
  INVALID_REQUEST = 'INVALID_REQUEST',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Conversion errors (502 - bad gateway, typically retryable)
  CONVERSION_TIMEOUT = 'CONVERSION_TIMEOUT',
  CONVERSION_FAILED = 'CONVERSION_FAILED',
  CONVERSION_POOL_EXHAUSTED = 'CONVERSION_POOL_EXHAUSTED',

  // Salesforce errors (502 - bad gateway, conditionally retryable)
  SALESFORCE_API_ERROR = 'SALESFORCE_API_ERROR',
  SALESFORCE_UPLOAD_FAILED = 'SALESFORCE_UPLOAD_FAILED',
  SALESFORCE_AUTH_ERROR = 'SALESFORCE_AUTH_ERROR',
  SALESFORCE_RECORD_NOT_FOUND = 'SALESFORCE_RECORD_NOT_FOUND',

  // Authentication errors (401/403 - non-retryable)
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',

  // Configuration errors (500 - non-retryable)
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  MISSING_CONFIGURATION = 'MISSING_CONFIGURATION',

  // Internal errors (500 - non-retryable)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
