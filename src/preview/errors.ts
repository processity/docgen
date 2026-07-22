import { DocgenError } from '../errors/base';
import { ErrorCode } from '../errors/codes';
import type { ErrorContext } from '../errors/types';

export class PdfPreviewInvalidDocumentError extends DocgenError {
  readonly code = ErrorCode.VALIDATION_ERROR;
  readonly statusCode = 422;
  readonly retryable = false;

  constructor(context: ErrorContext = {}) {
    super('Generated PDF could not be rendered for preview', context);
  }
}

export class PdfPreviewTimeoutError extends DocgenError {
  readonly code = ErrorCode.CONVERSION_TIMEOUT;
  readonly statusCode = 504;
  readonly retryable = true;

  constructor(context: ErrorContext = {}) {
    super('PDF preview rendering timed out', context);
  }
}

export class PdfPreviewImageTooLargeError extends DocgenError {
  readonly code = ErrorCode.VALIDATION_ERROR;
  readonly statusCode = 413;
  readonly retryable = false;

  constructor(context: ErrorContext = {}) {
    super('Rendered PDF preview page exceeds the supported size', context);
  }
}
