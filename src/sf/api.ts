import axios from 'axios';
import type { SalesforceAuth } from './auth';
import { createLogger } from '../utils/logger';
import { trackDependency } from '../obs';
import { SalesforceApiError } from '../errors';

const logger = createLogger('sf:api');

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

export interface RequestOptions {
  correlationId?: string;
}

/**
 * Salesforce REST API Client
 *
 * Provides GET/POST methods with:
 * - Automatic Bearer token injection
 * - 401 handling (token refresh + single retry)
 * - 5xx retry with exponential backoff
 * - Correlation ID propagation
 */
export class SalesforceApi {
  private auth: SalesforceAuth;
  private baseUrl: string;

  constructor(auth: SalesforceAuth, baseUrl: string) {
    this.auth = auth;
    this.baseUrl = baseUrl;
  }

  /**
   * GET request to Salesforce REST API
   */
  async get<T = any>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * POST request to Salesforce REST API
   */
  async post<T = any>(path: string, body: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  /**
   * PATCH request to Salesforce REST API (for record updates)
   */
  async patch<T = any>(path: string, body: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  /**
   * Download ContentVersion binary data (template DOCX file)
   *
   * @param contentVersionId - Salesforce ContentVersionId (18-char ID)
   * @param options - Request options including correlation ID
   * @returns Buffer containing the binary file data
   */
  async downloadContentVersion(contentVersionId: string, options?: RequestOptions): Promise<Buffer> {
    return this.downloadBinary(`/services/data/v59.0/sobjects/ContentVersion/${contentVersionId}/VersionData`, options);
  }

  /**
   * Download binary data from Salesforce
   */
  private async downloadBinary(
    path: string,
    options?: RequestOptions,
    attempt = 1,
    hasRefreshedToken = false
  ): Promise<Buffer> {
    try {
      const token = await this.auth.getAccessToken();
      const url = `${this.baseUrl}${path}`;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };

      if (options?.correlationId) {
        headers['x-correlation-id'] = options.correlationId;
      }

      logger.info(
        {
          url,
          baseUrl: this.baseUrl,
          path,
          attempt,
          correlationId: options?.correlationId,
          tokenPrefix: token.substring(0, 20) + '...'
        },
        'Downloading binary from Salesforce'
      );

      const response = await axios({
        method: 'GET',
        url,
        headers,
        responseType: 'arraybuffer', // Important: return binary data
      });

      const arrayBuffer = response.data as ArrayBuffer;

      logger.debug(
        { url, status: response.status, size: arrayBuffer.byteLength, correlationId: options?.correlationId },
        'Binary download complete'
      );

      return Buffer.from(arrayBuffer);
    } catch (error: unknown) {
      return this.handleBinaryError(error, path, options, attempt, hasRefreshedToken);
    }
  }

  /**
   * Handle errors for binary downloads
   */
  private async handleBinaryError(
    error: unknown,
    path: string,
    options: RequestOptions | undefined,
    attempt: number,
    hasRefreshedToken: boolean
  ): Promise<Buffer> {
    const isAxiosError = (err: unknown): err is { response?: { status: number; data: any; headers?: any } } => {
      return typeof err === 'object' && err !== null && 'response' in err;
    };

    if (!isAxiosError(error) || !error.response) {
      if (attempt <= MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        logger.warn(
          { error, attempt, delay, correlationId: options?.correlationId },
          'Network error downloading binary, retrying'
        );
        await this.sleep(delay);
        return this.downloadBinary(path, options, attempt + 1, hasRefreshedToken);
      }
      logger.error({ error, correlationId: options?.correlationId }, 'Binary download failed after retries');
      throw error;
    }

    const status = error.response.status;
    const errorData = error.response.data;
    const errorHeaders = error.response.headers;

    // Log detailed error information
    logger.error(
      {
        status,
        path,
        baseUrl: this.baseUrl,
        errorData: errorData ? (typeof errorData === 'string' ? errorData : JSON.stringify(errorData)) : 'no data',
        errorHeaders,
        correlationId: options?.correlationId
      },
      'Salesforce binary download error - detailed info'
    );

    // Handle 401 - refresh token and retry
    if (status === 401 && !hasRefreshedToken) {
      logger.info({ correlationId: options?.correlationId }, 'Received 401 on binary download, refreshing token');
      this.auth.invalidateToken();
      return this.downloadBinary(path, options, 1, true);
    }

    // Handle 5xx - retry with backoff
    if (status >= 500 && status < 600 && attempt <= MAX_RETRIES) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      logger.warn(
        { status, attempt, delay, correlationId: options?.correlationId },
        'Server error on binary download, retrying'
      );
      await this.sleep(delay);
      return this.downloadBinary(path, options, attempt + 1, hasRefreshedToken);
    }

    // Parse Salesforce error message if available
    let sfErrorMessage = '';
    if (errorData) {
      try {
        // Convert Buffer to string if needed
        let parsedData = errorData;
        if (Buffer.isBuffer(errorData)) {
          const bufferStr = errorData.toString('utf8');
          try {
            parsedData = JSON.parse(bufferStr);
          } catch {
            parsedData = bufferStr;
          }
        }

        if (typeof parsedData === 'string') {
          sfErrorMessage = parsedData;
        } else if (Array.isArray(parsedData) && parsedData.length > 0) {
          // Salesforce often returns errors as array: [{message: "...", errorCode: "..."}]
          sfErrorMessage = parsedData.map((e: any) => `${e.errorCode}: ${e.message}`).join('; ');
        } else if (typeof parsedData === 'object' && parsedData.message) {
          sfErrorMessage = parsedData.message;
        } else if (typeof parsedData === 'object') {
          sfErrorMessage = JSON.stringify(parsedData);
        }
      } catch (e) {
        sfErrorMessage = 'Unable to parse error response';
      }
    }

    logger.error(
      { status, path, sfErrorMessage, correlationId: options?.correlationId },
      'Binary download failed'
    );
    throw new SalesforceApiError(status, sfErrorMessage || 'Failed to download binary', {
      correlationId: options?.correlationId,
      path,
    });
  }

  /**
   * Make HTTP request with retry logic
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: any,
    options?: RequestOptions,
    attempt = 1,
    hasRefreshedToken = false
  ): Promise<T> {
    try {
      const token = await this.auth.getAccessToken();
      const url = `${this.baseUrl}${path}`;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };

      if (method === 'POST' || method === 'PATCH') {
        headers['Content-Type'] = 'application/json';
      }

      if (options?.correlationId) {
        headers['x-correlation-id'] = options.correlationId;
      }

      logger.debug({ method, url, attempt, correlationId: options?.correlationId }, 'Salesforce API request');

      const startTime = Date.now();

      try {
        const response = await axios({
          method,
          url,
          headers,
          data: body,
        });

        const duration = Date.now() - startTime;

        // Track successful dependency
        trackDependency({
          type: 'Salesforce REST API',
          name: `${method} ${path}`,
          duration,
          success: true,
          correlationId: options?.correlationId || 'unknown',
        });

        logger.debug(
          { method, url, status: response.status, correlationId: options?.correlationId },
          'Salesforce API response'
        );

        return response.data as T;
      } catch (err) {
        const duration = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Track failed dependency
        trackDependency({
          type: 'Salesforce REST API',
          name: `${method} ${path}`,
          duration,
          success: false,
          correlationId: options?.correlationId || 'unknown',
          error: errorMessage,
        });

        throw err;
      }
    } catch (error: unknown) {
      return this.handleError<T>(error, method, path, body, options, attempt, hasRefreshedToken);
    }
  }

  /**
   * Handle API errors with retry logic
   */
  private async handleError<T>(
    error: unknown,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: any,
    options: RequestOptions | undefined,
    attempt: number,
    hasRefreshedToken: boolean
  ): Promise<T> {
    // Type guard for axios errors
    const isAxiosError = (err: unknown): err is { response?: { status: number; data: any } } => {
      return typeof err === 'object' && err !== null && 'response' in err;
    };

    if (!isAxiosError(error) || !error.response) {
      // Network error or non-axios error - retry with backoff
      if (attempt <= MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        logger.warn(
          { error, attempt, delay, correlationId: options?.correlationId },
          'Network error, retrying after delay'
        );
        await this.sleep(delay);
        return this.request<T>(method, path, body, options, attempt + 1, hasRefreshedToken);
      }

      logger.error({ error, correlationId: options?.correlationId }, 'Network error after max retries');
      throw error;
    }

    const status = error.response.status;

    // Handle 401 Unauthorized - refresh token and retry once
    if (status === 401 && !hasRefreshedToken) {
      logger.info({ correlationId: options?.correlationId }, 'Received 401, refreshing token and retrying');
      this.auth.invalidateToken();
      return this.request<T>(method, path, body, options, 1, true);
    }

    // Handle 5xx Server Errors - retry with exponential backoff
    if (status >= 500 && status < 600 && attempt <= MAX_RETRIES) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      logger.warn(
        { status, attempt, delay, correlationId: options?.correlationId },
        'Server error, retrying after delay'
      );
      await this.sleep(delay);
      return this.request<T>(method, path, body, options, attempt + 1, hasRefreshedToken);
    }

    // No retry for 4xx errors (except 401 which was handled above)
    logger.error(
      { status, data: error.response.data, correlationId: options?.correlationId },
      'Salesforce API error (no retry)'
    );

    const errorMessage = typeof error.response.data === 'string'
      ? error.response.data
      : JSON.stringify(error.response.data);

    throw new SalesforceApiError(status, errorMessage, {
      correlationId: options?.correlationId,
      path,
    });
  }

  /**
   * Delete a Salesforce record
   */
  async delete(path: string, options?: RequestOptions): Promise<void> {
    return this.request<void>('DELETE', path, undefined, options);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
