import jwt from 'jsonwebtoken';
import axios from 'axios';
import type { SalesforceTokenResponse, CachedToken } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('sf:auth');

const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // 60 seconds buffer

/**
 * Type guard for axios errors
 */
function isAxiosError(error: unknown): error is { response?: { status: number; data: any } } {
  return typeof error === 'object' && error !== null && 'response' in error;
}

export interface SalesforceAuthConfig {
  // JWT Bearer Flow fields (production/Connected App)
  sfDomain?: string;
  sfUsername?: string;
  sfClientId?: string;
  sfPrivateKey?: string;
  // SFDX Auth URL (development/scratch orgs)
  sfdxAuthUrl?: string;
}

/**
 * Parsed SFDX Auth URL components
 * Format: force://<clientId>:<clientSecret>:<refreshToken>@<instanceUrl>
 */
interface ParsedSfdxAuthUrl {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  instanceUrl: string;
}

/**
 * Salesforce Authentication
 *
 * Supports two authentication methods:
 * 1. JWT Bearer Flow (production/Connected App) - Server-to-server auth with private key
 * 2. SFDX Auth URL (development/scratch orgs) - Refresh token flow from sf CLI
 *
 * SFDX Auth URL takes precedence if both are configured.
 * Caches tokens with TTL and 60-second expiry buffer.
 *
 * References:
 * - JWT Bearer: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm
 * - Refresh Token: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_refresh_token_flow.htm
 */
export class SalesforceAuth {
  private config: SalesforceAuthConfig;
  private cachedToken: CachedToken | null = null;
  private tokenRefreshPromise: Promise<string> | null = null;
  private parsedSfdxAuth: ParsedSfdxAuthUrl | null = null;

  constructor(config: SalesforceAuthConfig) {
    this.validateConfig(config);
    this.config = config;
  }

  /**
   * Validate required configuration
   *
   * Requires either:
   * - JWT Bearer: sfDomain, sfUsername, sfClientId, sfPrivateKey
   * - SFDX Auth URL: sfdxAuthUrl
   */
  private validateConfig(config: SalesforceAuthConfig): void {
    const hasJwtConfig = !!(
      config.sfDomain &&
      config.sfUsername &&
      config.sfClientId &&
      config.sfPrivateKey
    );
    const hasSfdxConfig = !!config.sfdxAuthUrl;

    if (!hasJwtConfig && !hasSfdxConfig) {
      throw new Error(
        'Salesforce authentication requires either:\n' +
        '  1. JWT Bearer Flow: SF_DOMAIN, SF_USERNAME, SF_CLIENT_ID, SF_PRIVATE_KEY\n' +
        '  2. SFDX Auth URL: SFDX_AUTH_URL\n' +
        'Get SFDX Auth URL via: sf org display --verbose --json | jq -r \'.result.sfdxAuthUrl\''
      );
    }

    if (hasJwtConfig && hasSfdxConfig) {
      logger.warn(
        'Both JWT Bearer and SFDX Auth URL configured. SFDX Auth URL takes precedence.'
      );
    }

    // Parse and validate SFDX Auth URL if provided
    if (config.sfdxAuthUrl) {
      try {
        this.parsedSfdxAuth = this.parseSfdxAuthUrl(config.sfdxAuthUrl);
        logger.info(
          { instanceUrl: this.parsedSfdxAuth.instanceUrl },
          'Using SFDX Auth URL authentication'
        );
      } catch (error) {
        throw new Error(
          `Invalid SFDX Auth URL: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      logger.info('Using JWT Bearer Flow authentication');
    }
  }

  /**
   * Parse SFDX Auth URL
   *
   * Format: force://<clientId>:<clientSecret>:<refreshToken>@<instanceUrl>
   * Example: force://PlatformCLI::!refreshToken123@test.salesforce.com
   */
  private parseSfdxAuthUrl(authUrl: string): ParsedSfdxAuthUrl {
    const match = authUrl.match(/^force:\/\/([^:]+):([^:]*):([^@]+)@(.+)$/);

    if (!match) {
      throw new Error(
        'Invalid format. Expected: force://<clientId>:<clientSecret>:<refreshToken>@<instanceUrl>'
      );
    }

    const [, clientId, clientSecret, refreshToken, instanceUrl] = match;

    if (!clientId || !refreshToken || !instanceUrl) {
      throw new Error('Missing required components in SFDX Auth URL');
    }

    return {
      clientId,
      clientSecret: clientSecret || undefined,
      refreshToken,
      instanceUrl: instanceUrl.replace(/\/$/, ''), // Remove trailing slash
    };
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
   * Get the Salesforce instance URL
   * Returns the instance URL from the cached token if available,
   * otherwise returns the configured instance URL
   */
  getInstanceUrl(): string {
    // If we have a cached token, use its instance URL (most current)
    if (this.cachedToken?.instanceUrl) {
      return this.cachedToken.instanceUrl;
    }

    // If using SFDX Auth URL, return the instance URL from it
    if (this.parsedSfdxAuth?.instanceUrl) {
      return `https://${this.parsedSfdxAuth.instanceUrl}`;
    }

    // Fallback to configured domain (for JWT Bearer Flow)
    if (this.config.sfDomain) {
      return `https://${this.config.sfDomain}`;
    }

    throw new Error('No Salesforce instance URL available');
  }

  /**
   * Fetch new access token from Salesforce
   *
   * Routes to appropriate authentication method:
   * - SFDX Auth URL (refresh token flow) if configured
   * - JWT Bearer Flow otherwise
   */
  private async fetchAccessToken(): Promise<string> {
    // Prefer SFDX Auth URL if configured
    if (this.config.sfdxAuthUrl && this.parsedSfdxAuth) {
      return this.fetchAccessTokenFromRefreshToken();
    }

    // Fallback to JWT Bearer Flow
    return this.fetchAccessTokenViaJwt();
  }

  /**
   * Fetch access token using SFDX Auth URL (refresh token flow)
   */
  private async fetchAccessTokenFromRefreshToken(): Promise<string> {
    if (!this.parsedSfdxAuth) {
      throw new Error('SFDX Auth URL not configured');
    }

    try {
      const { clientId, clientSecret, refreshToken, instanceUrl } = this.parsedSfdxAuth;

      const tokenUrl = `https://${instanceUrl}/services/oauth2/token`;
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      });

      if (clientSecret) {
        body.append('client_secret', clientSecret);
      }

      logger.debug({ tokenUrl, instanceUrl }, 'Requesting Salesforce access token via refresh token');

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
      const expiresIn = tokenResponse.expires_in || 7200;
      const expiresAt = Date.now() + expiresIn * 1000;
      this.cachedToken = {
        accessToken: tokenResponse.access_token,
        expiresAt,
        instanceUrl: tokenResponse.instance_url || `https://${instanceUrl}`,
      };

      logger.info(
        {
          expiresIn,
          expiresAt: new Date(expiresAt).toISOString(),
          instanceUrl: this.cachedToken.instanceUrl,
        },
        'Salesforce access token acquired via refresh token'
      );

      return tokenResponse.access_token;
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to fetch Salesforce access token via refresh token');

      // Re-throw axios errors with better messages
      if (isAxiosError(error) && error.response) {
        const errorBody =
          typeof error.response.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response.data);
        throw new Error(
          `Salesforce refresh token exchange failed: ${error.response.status} - ${errorBody}`
        );
      }

      throw error;
    }
  }

  /**
   * Fetch access token using JWT Bearer Flow
   */
  private async fetchAccessTokenViaJwt(): Promise<string> {
    try {
      // Sign JWT assertion
      const assertion = this.signJWT();

      // Determine if this is a sandbox based on the domain
      const isSandbox = this.config.sfDomain?.toLowerCase().includes('sandbox') || false;
      const authDomain = isSandbox ? 'test.salesforce.com' : 'login.salesforce.com';

      logger.info({
        sfDomain: this.config.sfDomain,
        isSandbox,
        authDomain
      }, 'Determining Salesforce auth endpoint');

      // Exchange JWT for access token
      const tokenUrl = `https://${authDomain}/services/oauth2/token`;
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
      // JWT Bearer tokens don't return expires_in, default to 2 hours (Salesforce standard)
      const expiresIn = tokenResponse.expires_in || 7200;
      const expiresAt = Date.now() + expiresIn * 1000;
      this.cachedToken = {
        accessToken: tokenResponse.access_token,
        expiresAt,
        instanceUrl: tokenResponse.instance_url,
      };

      logger.info(
        {
          expiresIn,
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
    if (!this.config.sfPrivateKey) {
      throw new Error('SF_PRIVATE_KEY is required for JWT Bearer Flow');
    }
    if (!this.config.sfClientId) {
      throw new Error('SF_CLIENT_ID is required for JWT Bearer Flow');
    }
    if (!this.config.sfUsername) {
      throw new Error('SF_USERNAME is required for JWT Bearer Flow');
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 300; // 5 minutes

    // Determine audience based on whether this is a sandbox
    const isSandbox = this.config.sfDomain?.toLowerCase().includes('sandbox') || false;
    const audience = isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com';

    const payload = {
      iss: this.config.sfClientId,
      aud: audience,
      sub: this.config.sfUsername,
      exp,
    };

    try {
      return jwt.sign(payload, this.config.sfPrivateKey, {
        algorithm: 'RS256',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to sign JWT');
      throw new Error(`Failed to sign JWT: ${error instanceof Error ? error.message : String(error)}`);
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
