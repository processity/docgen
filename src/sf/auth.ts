import jwt from 'jsonwebtoken';
import axios from 'axios';
import type { SalesforceTokenResponse, CachedToken } from '../types';
import pino from 'pino';

const logger = pino({ name: 'sf:auth' });

const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // 60 seconds buffer

/**
 * Type guard for axios errors
 */
function isAxiosError(error: unknown): error is { response?: { status: number; data: any } } {
  return typeof error === 'object' && error !== null && 'response' in error;
}

export interface SalesforceAuthConfig {
  sfDomain: string;
  sfUsername: string;
  sfClientId: string;
  sfPrivateKey: string;
}

/**
 * Salesforce JWT Bearer Flow Authentication
 *
 * Implements OAuth 2.0 JWT Bearer Token Flow for server-to-server auth.
 * Caches tokens with TTL and 60-second expiry buffer.
 *
 * References:
 * - https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm
 */
export class SalesforceAuth {
  private config: SalesforceAuthConfig;
  private cachedToken: CachedToken | null = null;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(config: SalesforceAuthConfig) {
    this.validateConfig(config);
    this.config = config;
  }

  /**
   * Validate required configuration
   */
  private validateConfig(config: SalesforceAuthConfig): void {
    const required = ['sfDomain', 'sfUsername', 'sfClientId', 'sfPrivateKey'];
    const missing = required.filter((key) => !config[key as keyof SalesforceAuthConfig]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required Salesforce configuration: ${missing.join(', ')}`
      );
    }
  }

  /**
   * Get access token (cached or fresh)
   *
   * Returns cached token if valid, otherwise fetches new token.
   * Implements 60-second buffer before expiry to avoid race conditions.
   */
  async getAccessToken(): Promise<string> {
    // Check if cached token is still valid (with buffer)
    if (this.cachedToken && this.isTokenValid(this.cachedToken)) {
      logger.debug('Using cached Salesforce access token');
      return this.cachedToken.accessToken;
    }

    // If a token refresh is already in progress, wait for it
    if (this.tokenRefreshPromise) {
      logger.debug('Token refresh already in progress, waiting...');
      return this.tokenRefreshPromise;
    }

    // Fetch new token
    logger.debug('Fetching new Salesforce access token');
    this.tokenRefreshPromise = this.fetchAccessToken()
      .then((token) => {
        this.tokenRefreshPromise = null;
        return token;
      })
      .catch((error) => {
        this.tokenRefreshPromise = null;
        throw error;
      });

    return this.tokenRefreshPromise;
  }

  /**
   * Check if cached token is valid (with 60s buffer)
   */
  private isTokenValid(token: CachedToken): boolean {
    const now = Date.now();
    const bufferExpiry = token.expiresAt - TOKEN_EXPIRY_BUFFER_MS;
    return now < bufferExpiry;
  }

  /**
   * Invalidate cached token (force refresh on next request)
   */
  invalidateToken(): void {
    logger.debug('Invalidating cached Salesforce token');
    this.cachedToken = null;
  }

  /**
   * Fetch new access token from Salesforce
   */
  private async fetchAccessToken(): Promise<string> {
    try {
      // Sign JWT assertion
      const assertion = this.signJWT();

      // Exchange JWT for access token
      const tokenUrl = `https://login.salesforce.com/services/oauth2/token`;
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      });

      logger.debug({ tokenUrl }, 'Requesting Salesforce access token');

      const response = await axios.post<SalesforceTokenResponse>(tokenUrl, body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const tokenResponse = response.data;

      if (!tokenResponse.access_token) {
        logger.error({ tokenResponse }, 'Malformed token response from Salesforce');
        throw new Error('Malformed token response: missing access_token');
      }

      // Cache token with expiry
      const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
      this.cachedToken = {
        accessToken: tokenResponse.access_token,
        expiresAt,
        instanceUrl: tokenResponse.instance_url,
      };

      logger.info(
        {
          expiresIn: tokenResponse.expires_in,
          expiresAt: new Date(expiresAt).toISOString(),
        },
        'Salesforce access token acquired'
      );

      return tokenResponse.access_token;
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to fetch Salesforce access token');

      // Re-throw axios errors with better messages
      if (isAxiosError(error) && error.response) {
        const errorBody = typeof error.response.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response.data);
        throw new Error(
          `Salesforce token exchange failed: ${error.response.status} - ${errorBody}`
        );
      }

      throw error;
    }
  }

  /**
   * Sign JWT assertion for OAuth 2.0 JWT Bearer Flow
   *
   * JWT claims:
   * - iss: Connected App Consumer Key (sfClientId)
   * - aud: https://login.salesforce.com (or test.salesforce.com for sandbox)
   * - sub: Integration User username
   * - exp: Expiration (5 minutes from now)
   */
  private signJWT(): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 300; // 5 minutes

    const payload = {
      iss: this.config.sfClientId,
      aud: 'https://login.salesforce.com',
      sub: this.config.sfUsername,
      exp,
    };

    try {
      return jwt.sign(payload, this.config.sfPrivateKey, {
        algorithm: 'RS256',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to sign JWT');
      throw new Error(`Failed to sign JWT: ${error}`);
    }
  }
}

// Singleton instance
let authInstance: SalesforceAuth | null = null;

/**
 * Create or return singleton SalesforceAuth instance
 */
export function createSalesforceAuth(config: SalesforceAuthConfig): SalesforceAuth {
  if (!authInstance) {
    authInstance = new SalesforceAuth(config);
  }
  return authInstance;
}

/**
 * Get existing SalesforceAuth instance
 */
export function getSalesforceAuth(): SalesforceAuth | null {
  return authInstance;
}

/**
 * Reset singleton (for testing)
 */
export function resetSalesforceAuth(): void {
  authInstance = null;
}
