import nock from 'nock';
import { generateKeyPairSync } from 'crypto';
import { SalesforceAuth, resetSalesforceAuth } from '../src/sf/auth';
import { SalesforceApi } from '../src/sf/api';

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

const MOCK_AUTH_CONFIG = {
  sfDomain: 'test.salesforce.com',
  sfUsername: 'test@example.com',
  sfClientId: '3MVG9TEST_CLIENT_ID',
  sfPrivateKey: privateKey,
};

const MOCK_TOKEN_RESPONSE = {
  access_token: 'test-access-token',
  token_type: 'Bearer',
  expires_in: 7200,
  scope: 'api web',
  instance_url: 'https://test.salesforce.com',
  id: 'https://login.salesforce.com/id/00D.../005...',
};

describe('Salesforce API Client', () => {
  let auth: SalesforceAuth;
  let api: SalesforceApi;

  beforeEach(() => {
    nock.cleanAll();
    resetSalesforceAuth();
    auth = new SalesforceAuth(MOCK_AUTH_CONFIG);
    api = new SalesforceApi(auth, 'https://test.salesforce.com');

    // Mock token acquisition by default
    nock('https://login.salesforce.com')
      .post('/services/oauth2/token')
      .reply(200, MOCK_TOKEN_RESPONSE);
  });

  afterEach(() => {
    nock.cleanAll();
    resetSalesforceAuth();
  });

  describe('GET Requests', () => {
    it('should make GET request with Bearer token', async () => {
      const responseData = { id: '001xxx', name: 'Test Account' };

      const apiScope = nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .matchHeader('Authorization', 'Bearer test-access-token')
        .reply(200, responseData);

      const result = await api.get('/services/data/v59.0/sobjects/Account/001xxx');

      expect(result).toEqual(responseData);
      expect(apiScope.isDone()).toBe(true);
    });

    it('should return parsed JSON response', async () => {
      const responseData = {
        records: [{ Id: '001xxx', Name: 'Account 1' }],
        totalSize: 1,
      };

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/query')
        .query({ q: 'SELECT Id, Name FROM Account LIMIT 1' })
        .reply(200, responseData);

      const result = await api.get('/services/data/v59.0/query?q=SELECT Id, Name FROM Account LIMIT 1');

      expect(result).toEqual(responseData);
      expect(result.records).toHaveLength(1);
    });
  });

  describe('POST Requests', () => {
    it('should make POST request with JSON body', async () => {
      const requestBody = { Name: 'New Account', Industry: 'Technology' };
      const responseData = { id: '001xxx', success: true, errors: [] };

      const apiScope = nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/Account', requestBody)
        .matchHeader('Authorization', 'Bearer test-access-token')
        .matchHeader('Content-Type', 'application/json')
        .reply(201, responseData);

      const result = await api.post('/services/data/v59.0/sobjects/Account', requestBody);

      expect(result).toEqual(responseData);
      expect(apiScope.isDone()).toBe(true);
    });

    it('should set Content-Type header for JSON', async () => {
      const requestBody = { Name: 'Test' };

      const apiScope = nock('https://test.salesforce.com')
        .post('/services/data/v59.0/sobjects/Account')
        .matchHeader('Content-Type', 'application/json')
        .reply(201, { id: '001xxx', success: true, errors: [] });

      await api.post('/services/data/v59.0/sobjects/Account', requestBody);

      expect(apiScope.isDone()).toBe(true);
    });
  });

  describe('Token Refresh on 401', () => {
    it('should refresh token and retry on 401', async () => {
      // First request gets 401
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .matchHeader('Authorization', 'Bearer test-access-token')
        .reply(401, { error: 'Session expired' });

      // Token refresh
      const newTokenResponse = {
        ...MOCK_TOKEN_RESPONSE,
        access_token: 'new-access-token',
      };

      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, newTokenResponse);

      // Retry with new token succeeds
      const responseData = { id: '001xxx', name: 'Test Account' };

      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .matchHeader('Authorization', 'Bearer new-access-token')
        .reply(200, responseData);

      const result = await api.get('/services/data/v59.0/sobjects/Account/001xxx');

      expect(result).toEqual(responseData);
    });

    it('should not retry more than once for 401', async () => {
      // First request gets 401
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .reply(401, { error: 'Session expired' });

      // Token refresh
      nock('https://login.salesforce.com')
        .post('/services/oauth2/token')
        .reply(200, { ...MOCK_TOKEN_RESPONSE, access_token: 'new-token' });

      // Retry also gets 401
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .reply(401, { error: 'Session expired' });

      // Should throw after second 401
      await expect(api.get('/services/data/v59.0/sobjects/Account/001xxx')).rejects.toThrow(/401/);
    });
  });

  describe('Retry Logic', () => {
    it('should not retry on 4xx errors (except 401)', async () => {
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .reply(404, { error: 'Not found' });

      await expect(api.get('/services/data/v59.0/sobjects/Account/001xxx')).rejects.toThrow(/404/);

      // Verify only one request was made (no retries)
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should retry on 5xx errors and eventually succeed', async () => {
      // First 2 attempts fail with 500
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .times(2)
        .reply(500, 'Internal Server Error');

      // 3rd attempt succeeds
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .reply(200, { id: '001xxx', name: 'Test Account' });

      const result = await api.get('/services/data/v59.0/sobjects/Account/001xxx');
      expect(result).toEqual({ id: '001xxx', name: 'Test Account' });
    }, 10000);

    it('should fail after max retry attempts', async () => {
      // All 4 attempts fail (1 initial + 3 retries)
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .times(4)
        .reply(503, 'Service Unavailable');

      await expect(api.get('/services/data/v59.0/sobjects/Account/001xxx')).rejects.toThrow(/503/);
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should throw on network errors after retries', async () => {
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .times(4)
        .replyWithError('Network connection failed');

      await expect(api.get('/services/data/v59.0/sobjects/Account/001xxx')).rejects.toThrow(
        /Network connection failed/
      );
    }, 10000);

    it('should include error details in thrown errors', async () => {
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .times(4)
        .reply(500, 'Internal Server Error');

      try {
        await api.get('/services/data/v59.0/sobjects/Account/001xxx', {
          correlationId: 'test-correlation-123',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('500');
      }
    }, 10000);
  });

  describe('Correlation ID Propagation', () => {
    it('should include x-correlation-id in requests', async () => {
      const correlationId = 'test-correlation-abc123';

      const apiScope = nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .matchHeader('x-correlation-id', correlationId)
        .reply(200, { id: '001xxx' });

      await api.get('/services/data/v59.0/sobjects/Account/001xxx', { correlationId });

      expect(apiScope.isDone()).toBe(true);
    });

    it('should work without correlation ID', async () => {
      nock('https://test.salesforce.com')
        .get('/services/data/v59.0/sobjects/Account/001xxx')
        .reply(200, { id: '001xxx' });

      const result = await api.get('/services/data/v59.0/sobjects/Account/001xxx');

      expect(result).toEqual({ id: '001xxx' });
    });
  });
});
