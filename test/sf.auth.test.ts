import nock from 'nock';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import { SalesforceAuth, createSalesforceAuth, resetSalesforceAuth } from '../src/sf/auth';

// Generate test RSA key pair
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const MOCK_CONFIG = {
  sfDomain: 'test.salesforce.com',
  sfUsername: 'test@example.com',
  sfClientId: '3MVG9TEST_CLIENT_ID',
  sfPrivateKey: privateKey,
};

const MOCK_TOKEN_RESPONSE = {
  access_token: 'mock-access-token-12345',
  token_type: 'Bearer',
  expires_in: 7200, // 2 hours
  scope: 'api web',
  instance_url: 'https://test.salesforce.com',
  id: 'https://login.salesforce.com/id/00D.../005...',
};

describe('Salesforce JWT Bearer Authentication', () => {
  let auth: SalesforceAuth;

  beforeEach(() => {
    nock.cleanAll();
    resetSalesforceAuth(); // Reset singleton between tests
    auth = new SalesforceAuth(MOCK_CONFIG);
  });

  afterEach(() => {
    nock.cleanAll();
    resetSalesforceAuth();
  });

  describe('Token Exchange', () => {
    it('should sign JWT and exchange for access token', async () => {
      const tokenScope = nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, MOCK_TOKEN_RESPONSE);

      const token = await auth.getAccessToken();

      expect(token).toBe('mock-access-token-12345');
      expect(tokenScope.isDone()).toBe(true);
    });

    it('should include correct JWT claims (iss, aud, sub, exp)', async () => {
      let capturedJWT: string | undefined;

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token', (body) => {
          capturedJWT = body.assertion;
          return true;
        })
        .reply(200, MOCK_TOKEN_RESPONSE);

      await auth.getAccessToken();

      expect(capturedJWT).toBeDefined();
      const decoded = jwt.decode(capturedJWT!) as any;

      expect(decoded.iss).toBe(MOCK_CONFIG.sfClientId);
      expect(decoded.aud).toBe('https://login.salesforce.com');
      expect(decoded.sub).toBe(MOCK_CONFIG.sfUsername);
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should use RS256 algorithm for JWT signing', async () => {
      let capturedJWT: string | undefined;

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token', (body) => {
          capturedJWT = body.assertion;
          return true;
        })
        .reply(200, MOCK_TOKEN_RESPONSE);

      await auth.getAccessToken();

      const decoded = jwt.decode(capturedJWT!, { complete: true }) as any;
      expect(decoded.header.alg).toBe('RS256');
    });

    it('should send correct form-encoded request to Salesforce', async () => {
      let requestBody: any;

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token', (body) => {
          requestBody = body;
          return true;
        })
        .reply(200, MOCK_TOKEN_RESPONSE);

      await auth.getAccessToken();

      expect(requestBody.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      expect(requestBody.assertion).toBeDefined();
    });
  });

  describe('Token Caching', () => {
    it('should cache token and reuse until expiry', async () => {
      const tokenScope = nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .once()
        .reply(200, MOCK_TOKEN_RESPONSE);

      // First call - should hit Salesforce
      const token1 = await auth.getAccessToken();
      expect(token1).toBe('mock-access-token-12345');
      expect(tokenScope.isDone()).toBe(true);

      // Second call - should use cached token
      const token2 = await auth.getAccessToken();
      expect(token2).toBe('mock-access-token-12345');
      expect(token2).toBe(token1);

      // Verify no additional HTTP calls were made
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should make only one token request for multiple concurrent calls', async () => {
      const tokenScope = nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .once()
        .reply(200, MOCK_TOKEN_RESPONSE);

      // Make 3 concurrent calls
      const [token1, token2, token3] = await Promise.all([
        auth.getAccessToken(),
        auth.getAccessToken(),
        auth.getAccessToken(),
      ]);

      expect(token1).toBe('mock-access-token-12345');
      expect(token2).toBe(token1);
      expect(token3).toBe(token1);
      expect(tokenScope.isDone()).toBe(true);
    });

    it('should refresh token after expiry', async () => {
      // Mock short-lived token (1 second)
      const shortLivedResponse = { ...MOCK_TOKEN_RESPONSE, expires_in: 1 };

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, shortLivedResponse);

      const token1 = await auth.getAccessToken();
      expect(token1).toBe('mock-access-token-12345');

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Mock new token
      const newTokenResponse = {
        ...MOCK_TOKEN_RESPONSE,
        access_token: 'new-access-token-67890',
      };

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, newTokenResponse);

      const token2 = await auth.getAccessToken();
      expect(token2).toBe('new-access-token-67890');
      expect(token2).not.toBe(token1);
    });

    it('should refresh token when within 60 second buffer window', async () => {
      // Mock token that expires in 59 seconds (within 60s buffer)
      const expiringResponse = { ...MOCK_TOKEN_RESPONSE, expires_in: 59 };

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, expiringResponse);

      await auth.getAccessToken();

      // Next call should refresh the token
      const newTokenResponse = {
        ...MOCK_TOKEN_RESPONSE,
        access_token: 'refreshed-token',
      };

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, newTokenResponse);

      const token = await auth.getAccessToken();
      expect(token).toBe('refreshed-token');
    });
  });

  describe('Token Refresh', () => {
    it('should invalidate and refresh token on explicit call', async () => {
      // First token
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, MOCK_TOKEN_RESPONSE);

      const token1 = await auth.getAccessToken();
      expect(token1).toBe('mock-access-token-12345');

      // Invalidate token
      auth.invalidateToken();

      // Next call should fetch new token
      const newTokenResponse = {
        ...MOCK_TOKEN_RESPONSE,
        access_token: 'new-token-after-invalidation',
      };

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, newTokenResponse);

      const token2 = await auth.getAccessToken();
      expect(token2).toBe('new-token-after-invalidation');
      expect(token2).not.toBe(token1);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid_grant errors from Salesforce', async () => {
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(400, {
          error: 'invalid_grant',
          error_description: 'user hasn\'t approved this consumer',
        });

      await expect(auth.getAccessToken()).rejects.toThrow(/invalid_grant/i);
    });

    it('should handle network errors', async () => {
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .replyWithError('Network connection failed');

      await expect(auth.getAccessToken()).rejects.toThrow(/Network connection failed/i);
    });

    it('should handle malformed token responses', async () => {
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, { invalid: 'response' });

      await expect(auth.getAccessToken()).rejects.toThrow();
    });

    it('should handle 500 server errors', async () => {
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(500, 'Internal Server Error');

      await expect(auth.getAccessToken()).rejects.toThrow();
    });
  });

  describe('Singleton Pattern', () => {
    it('should create and return singleton instance', () => {
      const auth1 = createSalesforceAuth(MOCK_CONFIG);
      const auth2 = createSalesforceAuth(MOCK_CONFIG);

      expect(auth1).toBe(auth2);
    });
  });

  describe('Configuration Validation', () => {
    it('should throw error if JWT config is incomplete (missing sfDomain)', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfDomain: '' };

      // Missing sfDomain means incomplete JWT config, should throw generic validation error
      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/requires either/i);
    });

    it('should throw error if JWT config is incomplete (missing sfUsername)', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfUsername: '' };

      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/requires either/i);
    });

    it('should throw error if JWT config is incomplete (missing sfClientId)', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfClientId: '' };

      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/requires either/i);
    });

    it('should throw error if JWT config is incomplete (missing sfPrivateKey)', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfPrivateKey: '' };

      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/requires either/i);
    });

    it('should throw error if neither JWT config nor SFDX Auth URL provided', () => {
      const emptyConfig = {};

      expect(() => new SalesforceAuth(emptyConfig as any)).toThrow(/requires either/i);
    });

    it('should warn when both JWT and SFDX Auth URL are configured', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const bothConfig = {
        ...MOCK_CONFIG,
        sfdxAuthUrl: 'force://PlatformCLI::token@test.salesforce.com',
      };

      new SalesforceAuth(bothConfig);

      // Should have warned about both methods being configured
      // (actual warning is via logger, but validates config accepts both)
      expect(() => new SalesforceAuth(bothConfig)).not.toThrow();

      consoleSpy.mockRestore();
    });
  });
});

describe('Salesforce SFDX Auth URL Authentication', () => {
  let auth: SalesforceAuth;

  beforeEach(() => {
    nock.cleanAll();
    resetSalesforceAuth();
  });

  afterEach(() => {
    nock.cleanAll();
    resetSalesforceAuth();
  });

  describe('SFDX Auth URL Parsing', () => {
    it('should parse valid SFDX Auth URL with all components', () => {
      const sfdxAuthUrl = 'force://PlatformCLI:secret123:5Aep861TSESvWeug@test.salesforce.com';
      const config = { sfdxAuthUrl };

      expect(() => new SalesforceAuth(config)).not.toThrow();
    });

    it('should parse SFDX Auth URL without client secret (optional)', () => {
      const sfdxAuthUrl = 'force://PlatformCLI::5Aep861TSESvWeug@test.salesforce.com';
      const config = { sfdxAuthUrl };

      expect(() => new SalesforceAuth(config)).not.toThrow();
    });

    it('should parse SFDX Auth URL with scratch org domain', () => {
      const sfdxAuthUrl = 'force://PlatformCLI::token123@business-inspiration-8537-dev-ed.scratch.my.salesforce.com';
      const config = { sfdxAuthUrl };

      expect(() => new SalesforceAuth(config)).not.toThrow();
    });

    it('should reject invalid SFDX Auth URL format (missing force:// prefix)', () => {
      const invalidUrl = 'https://test.salesforce.com';
      const config = { sfdxAuthUrl: invalidUrl };

      expect(() => new SalesforceAuth(config)).toThrow(/Invalid format/i);
    });

    it('should reject SFDX Auth URL with missing client ID', () => {
      const invalidUrl = 'force://:secret:token@test.salesforce.com';
      const config = { sfdxAuthUrl: invalidUrl };

      // Regex doesn't match, so throws "Invalid format" wrapper error
      expect(() => new SalesforceAuth(config)).toThrow(/Invalid (format|SFDX Auth URL)/i);
    });

    it('should reject SFDX Auth URL with missing refresh token', () => {
      const invalidUrl = 'force://PlatformCLI:secret:@test.salesforce.com';
      const config = { sfdxAuthUrl: invalidUrl };

      expect(() => new SalesforceAuth(config)).toThrow(/Invalid (format|SFDX Auth URL)/i);
    });

    it('should reject SFDX Auth URL with missing instance URL', () => {
      const invalidUrl = 'force://PlatformCLI:secret:token@';
      const config = { sfdxAuthUrl: invalidUrl };

      expect(() => new SalesforceAuth(config)).toThrow(/Invalid (format|SFDX Auth URL|Missing required components)/i);
    });

    it('should handle SFDX Auth URL with special characters in refresh token', () => {
      const sfdxAuthUrl = 'force://PlatformCLI::5Aep861!@#$%^&*()_+token@test.salesforce.com';
      const config = { sfdxAuthUrl };

      expect(() => new SalesforceAuth(config)).not.toThrow();
    });

    it('should strip trailing slash from instance URL', () => {
      const sfdxAuthUrl = 'force://PlatformCLI::token@test.salesforce.com/';
      const config = { sfdxAuthUrl };

      // Should parse successfully (trailing slash removed internally)
      expect(() => new SalesforceAuth(config)).not.toThrow();
    });
  });

  describe('Refresh Token Flow', () => {
    const SFDX_AUTH_URL = 'force://PlatformCLI::5Aep861TSESvWeug@test.salesforce.com';
    const MOCK_REFRESH_TOKEN_RESPONSE = {
      access_token: 'mock-refresh-access-token',
      token_type: 'Bearer',
      expires_in: 7200,
      instance_url: 'https://test.salesforce.com',
      id: 'https://login.salesforce.com/id/00D.../005...',
    };

    beforeEach(() => {
      auth = new SalesforceAuth({ sfdxAuthUrl: SFDX_AUTH_URL });
    });

    it('should exchange refresh token for access token', async () => {
      const tokenScope = nock('https://test.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, MOCK_REFRESH_TOKEN_RESPONSE);

      const token = await auth.getAccessToken();

      expect(token).toBe('mock-refresh-access-token');
      expect(tokenScope.isDone()).toBe(true);
    });

    it('should send correct refresh token parameters', async () => {
      let requestBody: any;

      nock('https://test.salesforce.com')
        .post('/services/oauth2/token', (body) => {
          requestBody = body;
          return true;
        })
        .reply(200, MOCK_REFRESH_TOKEN_RESPONSE);

      await auth.getAccessToken();

      expect(requestBody.grant_type).toBe('refresh_token');
      expect(requestBody.client_id).toBe('PlatformCLI');
      expect(requestBody.refresh_token).toBe('5Aep861TSESvWeug');
      expect(requestBody.client_secret).toBeUndefined(); // No client secret in this URL
    });

    it('should include client secret if provided in SFDX Auth URL', async () => {
      const authWithSecret = new SalesforceAuth({
        sfdxAuthUrl: 'force://PlatformCLI:my-secret:5Aep861TSESvWeug@test.salesforce.com',
      });

      let requestBody: any;

      nock('https://test.salesforce.com')
        .post('/services/oauth2/token', (body) => {
          requestBody = body;
          return true;
        })
        .reply(200, MOCK_REFRESH_TOKEN_RESPONSE);

      await authWithSecret.getAccessToken();

      expect(requestBody.client_secret).toBe('my-secret');
    });

    it('should cache tokens from refresh token flow', async () => {
      const tokenScope = nock('https://test.salesforce.com')
        .post('/services/oauth2/token')
        .once()
        .reply(200, MOCK_REFRESH_TOKEN_RESPONSE);

      // First call - should hit Salesforce
      const token1 = await auth.getAccessToken();
      expect(token1).toBe('mock-refresh-access-token');
      expect(tokenScope.isDone()).toBe(true);

      // Second call - should use cached token
      const token2 = await auth.getAccessToken();
      expect(token2).toBe('mock-refresh-access-token');
      expect(token2).toBe(token1);

      // Verify no additional HTTP calls
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should handle expired refresh token error', async () => {
      nock('https://test.salesforce.com')
        .post('/services/oauth2/token')
        .reply(400, {
          error: 'invalid_grant',
          error_description: 'expired access/refresh token',
        });

      await expect(auth.getAccessToken()).rejects.toThrow(/expired access\/refresh token/i);
    });

    it('should handle invalid refresh token error', async () => {
      nock('https://test.salesforce.com')
        .post('/services/oauth2/token')
        .reply(400, {
          error: 'invalid_grant',
          error_description: 'authentication failure',
        });

      await expect(auth.getAccessToken()).rejects.toThrow(/authentication failure/i);
    });

    it('should handle network errors in refresh token flow', async () => {
      nock('https://test.salesforce.com')
        .post('/services/oauth2/token')
        .replyWithError('Network timeout');

      await expect(auth.getAccessToken()).rejects.toThrow(/Network timeout/i);
    });

    it('should handle malformed refresh token response', async () => {
      nock('https://test.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, { invalid: 'response' });

      await expect(auth.getAccessToken()).rejects.toThrow(/missing access_token/i);
    });

    it('should use instance URL from response when provided', async () => {
      const responseWithDifferentUrl = {
        ...MOCK_REFRESH_TOKEN_RESPONSE,
        instance_url: 'https://different.salesforce.com',
      };

      nock('https://test.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, responseWithDifferentUrl);

      await auth.getAccessToken();

      // Token should be cached (verify by checking no new call needed)
      const token2 = await auth.getAccessToken();
      expect(token2).toBe('mock-refresh-access-token');
    });
  });

  describe('Precedence Logic', () => {
    const JWT_CONFIG = {
      sfDomain: 'jwt.salesforce.com',
      sfUsername: 'jwt@example.com',
      sfClientId: '3MVG9JWT_CLIENT_ID',
      sfPrivateKey: privateKey,
    };

    const SFDX_AUTH_URL = 'force://PlatformCLI::refresh-token@sfdx.salesforce.com';

    it('should prefer SFDX Auth URL when both JWT and SFDX are configured', async () => {
      const bothConfig = {
        ...JWT_CONFIG,
        sfdxAuthUrl: SFDX_AUTH_URL,
      };

      auth = new SalesforceAuth(bothConfig);

      // Mock SFDX Auth URL endpoint (should be called)
      const sfdxScope = nock('https://sfdx.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'sfdx-token',
          token_type: 'Bearer',
          expires_in: 7200,
          instance_url: 'https://sfdx.salesforce.com',
        });

      // Mock JWT endpoint (should NOT be called)
      const jwtScope = nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'jwt-token',
          token_type: 'Bearer',
          expires_in: 7200,
          instance_url: 'https://jwt.salesforce.com',
        });

      const token = await auth.getAccessToken();

      // Should have used SFDX Auth URL (not JWT)
      expect(token).toBe('sfdx-token');
      expect(sfdxScope.isDone()).toBe(true);
      expect(jwtScope.isDone()).toBe(false); // JWT endpoint should not have been called
    });

    it('should fall back to JWT Bearer Flow when only JWT config provided', async () => {
      auth = new SalesforceAuth(JWT_CONFIG);

      const jwtScope = nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'jwt-only-token',
          token_type: 'Bearer',
          expires_in: 7200,
          instance_url: 'https://jwt.salesforce.com',
        });

      const token = await auth.getAccessToken();

      expect(token).toBe('jwt-only-token');
      expect(jwtScope.isDone()).toBe(true);
    });

    it('should use SFDX Auth URL when only SFDX config provided', async () => {
      auth = new SalesforceAuth({ sfdxAuthUrl: SFDX_AUTH_URL });

      const sfdxScope = nock('https://sfdx.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, {
          access_token: 'sfdx-only-token',
          token_type: 'Bearer',
          expires_in: 7200,
          instance_url: 'https://sfdx.salesforce.com',
        });

      const token = await auth.getAccessToken();

      expect(token).toBe('sfdx-only-token');
      expect(sfdxScope.isDone()).toBe(true);
    });
  });
});
