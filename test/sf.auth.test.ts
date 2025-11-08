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
    it('should throw error if sfDomain is missing', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfDomain: '' };

      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/sfDomain/i);
    });

    it('should throw error if sfUsername is missing', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfUsername: '' };

      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/sfUsername/i);
    });

    it('should throw error if sfClientId is missing', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfClientId: '' };

      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/sfClientId/i);
    });

    it('should throw error if sfPrivateKey is missing', () => {
      const invalidConfig = { ...MOCK_CONFIG, sfPrivateKey: '' };

      expect(() => new SalesforceAuth(invalidConfig as any)).toThrow(/sfPrivateKey/i);
    });
  });
});
