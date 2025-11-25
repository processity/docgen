import { FastifyInstance, FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { DocgenError } from './base';
import { ErrorContext } from './types';
import {
  TemplateNotFoundError,
  TemplateMergeError,
  ValidationError,
  MissingNamespaceError,
  ConversionTimeoutError,
  ConversionFailedError,
  SalesforceApiError,
  SalesforceUploadError,
  AuthenticationError,
  AuthorizationError,
  UnknownError,
} from './classes';
import { getCorrelationId, setCorrelationId } from '../utils/correlation-id';

/**
 * Check if error is a Fastify schema validation error or JSON parsing error
 */
function isFastifyValidationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as Record<string, unknown>;

  // Check for Fastify validation errors
  if ('validation' in err) return true;

  // Check for Fastify errors with 400 status code
  if (err.statusCode === 400) return true;

  // Check for JSON parsing errors
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (
    message.includes('unexpected token') ||
    message.includes('json') && message.includes('parse') ||
    message.includes('syntax error')
  ) {
    return true;
  }

  return false;
}

/**
 * Wrap a plain Error in the appropriate DocgenError class
 *
 * This provides a migration path for existing code that throws plain errors.
 * Pattern matching on error message determines the error type.
 *
 * @param error - The error to wrap
 * @param context - Additional context to attach
 * @returns A DocgenError subclass instance
 */
export function wrapError(error: Error, context: ErrorContext = {}): DocgenError {
  // If already a DocgenError, merge context and return
  if (error instanceof DocgenError) {
    // Merge additional context into existing error
    const mergedContext = { ...error.context, ...context };
    const wrapped = Object.create(error);
    wrapped.context = mergedContext;
    return wrapped;
  }

  // Handle Fastify schema validation errors (have 'validation' property or statusCode 400)
  if (isFastifyValidationError(error)) {
    return new ValidationError(error.message, context);
  }

  const message = error.message.toLowerCase();

  // Template errors
  if (message.includes('template not found') || (message.includes('not found') && message.includes('template'))) {
    return new TemplateNotFoundError(context.templateId || 'unknown', context);
  }
  if (message.includes('404') && (message.includes('contentversion') || message.includes('template'))) {
    return new TemplateNotFoundError(context.templateId || 'unknown', context);
  }
  if (message.includes('template merge failed') || message.includes('merge failed')) {
    return new TemplateMergeError(error.message, context);
  }

  // Namespace errors (composite documents)
  if (message.includes('missing namespace data') || message.includes('namespace')) {
    const nsMatch = error.message.match(/namespace[:\s]+(\w+)/i);
    return new MissingNamespaceError(nsMatch?.[1] || 'unknown', context);
  }

  // Validation errors
  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('required') ||
    message.includes('bad request')
  ) {
    return new ValidationError(error.message, context);
  }

  // Conversion errors
  if (message.includes('timeout') && (message.includes('conversion') || message.includes('libreoffice'))) {
    const timeoutMatch = error.message.match(/(\d+)\s*ms/);
    return new ConversionTimeoutError(timeoutMatch ? parseInt(timeoutMatch[1], 10) : 60000, context);
  }
  if (message.includes('conversion failed') || message.includes('libreoffice')) {
    return new ConversionFailedError(error.message, context);
  }

  // Salesforce errors
  if (message.includes('salesforce api error')) {
    const statusMatch = error.message.match(/(\d{3})/);
    return new SalesforceApiError(statusMatch ? parseInt(statusMatch[1], 10) : 500, error.message, context);
  }
  if (message.includes('upload failed') || message.includes('file upload')) {
    return new SalesforceUploadError(error.message, context);
  }

  // Authentication errors
  if (message.includes('unauthorized') || message.includes('authentication failed') || message.includes('401')) {
    return new AuthenticationError(error.message, context);
  }
  if (message.includes('forbidden') || message.includes('403')) {
    return new AuthorizationError(error.message, context);
  }

  // Default to unknown error
  return new UnknownError(error.message, context);
}

/**
 * Create a Fastify error handler that uses DocgenError
 *
 * This handler:
 * 1. Extracts correlation ID from request
 * 2. Wraps plain errors in DocgenError
 * 3. Logs with full context
 * 4. Returns structured API response
 *
 * @param app - Fastify instance for logging
 * @returns Fastify error handler function
 */
export function createErrorHandler(app: FastifyInstance) {
  return (error: FastifyError | DocgenError | Error, request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = getCorrelationId(request);
    setCorrelationId(reply, correlationId);

    // Build context from request body if available
    const requestBody = request.body as Record<string, unknown> | undefined;
    const context: ErrorContext = {
      correlationId,
      templateId: requestBody?.templateId as string | undefined,
      compositeDocumentId: requestBody?.compositeDocumentId as string | undefined,
      generatedDocumentId: requestBody?.generatedDocumentId as string | undefined,
    };

    // Convert to DocgenError if needed
    let docgenError: DocgenError;
    if (error instanceof DocgenError) {
      docgenError = error;
    } else {
      docgenError = wrapError(error as Error, context);
    }

    // Log error with full context
    app.log.error(
      {
        correlationId,
        code: docgenError.code,
        message: docgenError.message,
        statusCode: docgenError.statusCode,
        retryable: docgenError.retryable,
        context: docgenError.context,
        stack: docgenError.stack,
      },
      'Request error'
    );

    // Build and send API response
    const response = docgenError.toApiResponse(correlationId);

    return reply.status(docgenError.statusCode).send(response);
  };
}

/**
 * Build structured error string for Salesforce Error__c field
 *
 * Convenience function that wraps plain errors before serializing.
 *
 * @param error - Error to serialize
 * @param context - Additional context
 * @returns JSON string for Error__c field
 */
export function buildSalesforceError(error: Error | DocgenError, context: ErrorContext = {}): string {
  const docgenError = error instanceof DocgenError ? error : wrapError(error, context);

  // Merge additional context
  const mergedContext = { ...docgenError.context, ...context };

  // Create payload with merged context
  const payload = {
    code: docgenError.code,
    message: docgenError.message,
    stack: docgenError.stack,
    context: mergedContext,
    timestamp: docgenError.timestamp,
  };

  const json = JSON.stringify(payload, null, 2);

  // Truncate if too long for Salesforce field (32KB limit)
  if (json.length > 30000) {
    const truncatedStack = docgenError.stack?.split('\n').slice(0, 5).join('\n') + '\n... truncated';
    payload.stack = truncatedStack;
    return JSON.stringify(payload, null, 2);
  }

  return json;
}
