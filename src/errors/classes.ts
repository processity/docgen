import { ErrorCode } from './codes';
import { ErrorContext } from './types';
import { DocgenError } from './base';

// =============================================================================
// Template Errors (4xx - Client errors, non-retryable)
// =============================================================================

/**
 * Template not found in Salesforce Files
 */
export class TemplateNotFoundError extends DocgenError {
  readonly code = ErrorCode.TEMPLATE_NOT_FOUND;
  readonly statusCode = 404;
  readonly retryable = false;

  constructor(templateId: string, context: ErrorContext = {}) {
    super(`Template not found: ${templateId}`, { ...context, templateId });
  }
}

/**
 * Template file is invalid or cannot be parsed as DOCX
 */
export class TemplateParseError extends DocgenError {
  readonly code = ErrorCode.TEMPLATE_PARSE_ERROR;
  readonly statusCode = 400;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Template parse error: ${message}`, context);
  }
}

/**
 * Template merge failed (invalid placeholders, missing data, etc.)
 */
export class TemplateMergeError extends DocgenError {
  readonly code = ErrorCode.TEMPLATE_MERGE_ERROR;
  readonly statusCode = 400;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Template merge failed: ${message}`, context);
  }
}

/**
 * Template format is invalid (not a valid DOCX file)
 */
export class TemplateInvalidFormatError extends DocgenError {
  readonly code = ErrorCode.TEMPLATE_INVALID_FORMAT;
  readonly statusCode = 400;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Invalid template format: ${message}`, context);
  }
}

// =============================================================================
// Validation Errors (400 - Bad Request, non-retryable)
// =============================================================================

/**
 * Request validation failed
 */
export class ValidationError extends DocgenError {
  readonly code = ErrorCode.VALIDATION_ERROR;
  readonly statusCode = 400;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(message, context);
  }
}

/**
 * Missing namespace data for composite document
 */
export class MissingNamespaceError extends DocgenError {
  readonly code = ErrorCode.MISSING_NAMESPACE;
  readonly statusCode = 400;
  readonly retryable = false;

  constructor(namespace: string, context: ErrorContext = {}) {
    super(`Missing namespace data: ${namespace}`, { ...context, namespace });
  }
}

/**
 * Invalid request format or parameters
 */
export class InvalidRequestError extends DocgenError {
  readonly code = ErrorCode.INVALID_REQUEST;
  readonly statusCode = 400;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Invalid request: ${message}`, context);
  }
}

/**
 * Required field is missing
 */
export class MissingRequiredFieldError extends DocgenError {
  readonly code = ErrorCode.MISSING_REQUIRED_FIELD;
  readonly statusCode = 400;
  readonly retryable = false;

  constructor(fieldName: string, context: ErrorContext = {}) {
    super(`Missing required field: ${fieldName}`, context);
  }
}

// =============================================================================
// Conversion Errors (502 - Bad Gateway, typically retryable)
// =============================================================================

/**
 * LibreOffice conversion timed out
 */
export class ConversionTimeoutError extends DocgenError {
  readonly code = ErrorCode.CONVERSION_TIMEOUT;
  readonly statusCode = 502;
  readonly retryable = true;

  constructor(timeoutMs: number, context: ErrorContext = {}) {
    super(`LibreOffice conversion timed out after ${timeoutMs}ms`, { ...context, duration: timeoutMs });
  }
}

/**
 * LibreOffice conversion failed
 */
export class ConversionFailedError extends DocgenError {
  readonly code = ErrorCode.CONVERSION_FAILED;
  readonly statusCode = 502;
  readonly retryable = true;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Conversion failed: ${message}`, context);
  }
}

/**
 * Conversion pool exhausted (all slots busy)
 */
export class ConversionPoolExhaustedError extends DocgenError {
  readonly code = ErrorCode.CONVERSION_POOL_EXHAUSTED;
  readonly statusCode = 503;
  readonly retryable = true;

  constructor(context: ErrorContext = {}) {
    super('Conversion pool exhausted: all slots are busy', context);
  }
}

// =============================================================================
// Salesforce Errors (502 - Bad Gateway, conditionally retryable)
// =============================================================================

/**
 * Salesforce API error
 */
export class SalesforceApiError extends DocgenError {
  readonly code = ErrorCode.SALESFORCE_API_ERROR;
  readonly statusCode = 502;
  readonly retryable: boolean;

  constructor(httpStatus: number, message: string, context: ErrorContext = {}) {
    super(`Salesforce API error: ${httpStatus} - ${message}`, { ...context, httpStatus });
    // 5xx errors from Salesforce are retryable, 4xx are not
    this.retryable = httpStatus >= 500;
  }
}

/**
 * File upload to Salesforce failed
 */
export class SalesforceUploadError extends DocgenError {
  readonly code = ErrorCode.SALESFORCE_UPLOAD_FAILED;
  readonly statusCode = 502;
  readonly retryable = true;

  constructor(message: string, context: ErrorContext = {}) {
    super(`File upload to Salesforce failed: ${message}`, context);
  }
}

/**
 * Salesforce authentication error (JWT Bearer flow)
 */
export class SalesforceAuthError extends DocgenError {
  readonly code = ErrorCode.SALESFORCE_AUTH_ERROR;
  readonly statusCode = 502;
  readonly retryable = true;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Salesforce authentication error: ${message}`, context);
  }
}

/**
 * Salesforce record not found
 */
export class SalesforceRecordNotFoundError extends DocgenError {
  readonly code = ErrorCode.SALESFORCE_RECORD_NOT_FOUND;
  readonly statusCode = 404;
  readonly retryable = false;

  constructor(objectType: string, recordId: string, context: ErrorContext = {}) {
    super(`Salesforce ${objectType} not found: ${recordId}`, context);
  }
}

// =============================================================================
// Authentication Errors (401/403 - non-retryable)
// =============================================================================

/**
 * Authentication failed (invalid or missing token)
 */
export class AuthenticationError extends DocgenError {
  readonly code = ErrorCode.AUTHENTICATION_ERROR;
  readonly statusCode = 401;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(message, context);
  }
}

/**
 * Authorization failed (valid token but insufficient permissions)
 */
export class AuthorizationError extends DocgenError {
  readonly code = ErrorCode.AUTHORIZATION_ERROR;
  readonly statusCode = 403;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(message, context);
  }
}

/**
 * Token has expired
 */
export class TokenExpiredError extends DocgenError {
  readonly code = ErrorCode.TOKEN_EXPIRED;
  readonly statusCode = 401;
  readonly retryable = false;

  constructor(context: ErrorContext = {}) {
    super('Token has expired', context);
  }
}

/**
 * Token is invalid
 */
export class InvalidTokenError extends DocgenError {
  readonly code = ErrorCode.INVALID_TOKEN;
  readonly statusCode = 401;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Invalid token: ${message}`, context);
  }
}

// =============================================================================
// Configuration Errors (500 - non-retryable)
// =============================================================================

/**
 * Configuration error
 */
export class ConfigurationError extends DocgenError {
  readonly code = ErrorCode.CONFIGURATION_ERROR;
  readonly statusCode = 500;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Configuration error: ${message}`, context);
  }
}

/**
 * Missing required configuration
 */
export class MissingConfigurationError extends DocgenError {
  readonly code = ErrorCode.MISSING_CONFIGURATION;
  readonly statusCode = 500;
  readonly retryable = false;

  constructor(configName: string, context: ErrorContext = {}) {
    super(`Missing required configuration: ${configName}`, context);
  }
}

// =============================================================================
// Internal Errors (500 - non-retryable)
// =============================================================================

/**
 * Internal server error
 */
export class InternalError extends DocgenError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly statusCode = 500;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(`Internal error: ${message}`, context);
  }
}

/**
 * Unknown/unclassified error (fallback)
 */
export class UnknownError extends DocgenError {
  readonly code = ErrorCode.UNKNOWN_ERROR;
  readonly statusCode = 500;
  readonly retryable = false;

  constructor(message: string, context: ErrorContext = {}) {
    super(message, context);
  }
}
