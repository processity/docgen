import axios from 'axios';
import type { SalesforceAuth } from './auth';
import pino from 'pino';

const logger = pino({ name: 'sf:api' });

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
   * Make HTTP request with retry logic
   */
  private async request<T>(
    method: 'GET' | 'POST',
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

      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
      }

      if (options?.correlationId) {
        headers['x-correlation-id'] = options.correlationId;
      }

      logger.debug({ method, url, attempt, correlationId: options?.correlationId }, 'Salesforce API request');

      const response = await axios({
        method,
        url,
        headers,
        data: body,
      });

      logger.debug(
        { method, url, status: response.status, correlationId: options?.correlationId },
        'Salesforce API response'
      );

      return response.data as T;
    } catch (error: unknown) {
      return this.handleError<T>(error, method, path, body, options, attempt, hasRefreshedToken);
    }
  }

  /**
   * Handle API errors with retry logic
   */
  private async handleError<T>(
    error: unknown,
    method: 'GET' | 'POST',
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

    throw new Error(`Salesforce API error: ${status} - ${errorMessage}`);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
