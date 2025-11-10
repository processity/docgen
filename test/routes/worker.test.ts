import { config as dotenvConfig } from 'dotenv';
import supertest from 'supertest';
import nock from 'nock';
import { build } from '../../src/server';
import { loadConfig } from '../../src/config';
import { createSalesforceAuth } from '../../src/sf/auth';
import { generateValidJWT } from '../helpers/jwt-helper';
import type { FastifyInstance } from 'fastify';

// Load environment variables
dotenvConfig();

// Check if we have Salesforce credentials
const appConfig = loadConfig();
const hasCredentials = !!(
  appConfig.sfDomain &&
  appConfig.sfUsername &&
  appConfig.sfClientId &&
  appConfig.sfPrivateKey
);

// Skip tests if credentials are not available
const describeWithAuth = hasCredentials ? describe : describe.skip;

if (!hasCredentials) {
  console.log(`
================================================================================
SKIPPING WORKER ROUTE TESTS: Missing Salesforce credentials.

To run these tests locally, create a .env file with Salesforce credentials.
================================================================================
  `);
}

describeWithAuth('Worker Routes', () => {
  let app: FastifyInstance;
  let request: ReturnType<typeof supertest>;
  const sfDomain = appConfig.sfDomain;
  const baseUrl = `https://${sfDomain}`;

  beforeAll(async () => {
    // Initialize real Salesforce auth
    createSalesforceAuth({
      sfDomain: appConfig.sfDomain!,
      sfUsername: appConfig.sfUsername!,
      sfClientId: appConfig.sfClientId!,
      sfPrivateKey: appConfig.sfPrivateKey!,
    });

    app = await build();
    await app.ready();
    request = supertest(app.server);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    nock.cleanAll();

    // Note: We don't mock /services/oauth2/token - auth is real!

    // Mock JWKS for AAD validation with real JWK
    const { getMockJWKS } = await import('../helpers/jwt-helper');
    const jwks = await getMockJWKS();

    const jwksUri = `https://login.microsoftonline.com/${appConfig.azureTenantId}/discovery/v2.0/keys`;
    nock('https://login.microsoftonline.com')
      .get(`/${appConfig.azureTenantId}/v2.0/.well-known/openid-configuration`)
      .reply(200, {
        issuer: `https://login.microsoftonline.com/${appConfig.azureTenantId}/v2.0`,
        jwks_uri: jwksUri,
      })
      .persist();

    nock('https://login.microsoftonline.com')
      .get(`/${appConfig.azureTenantId}/discovery/v2.0/keys`)
      .reply(200, jwks)
      .persist();
  });

  afterEach(async () => {
    // Stop the poller if it's running to prevent hanging tests
    const { pollerService } = await import('../../src/worker/poller');
    if (pollerService.isRunning()) {
      await pollerService.stop();
    }
    nock.cleanAll();
  });

  describe('POST /worker/start', () => {
    it('should start the poller and return 200', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      const response = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('isRunning', true);

      // Cleanup - stop the poller
      await request.post('/worker/stop').set('Authorization', `Bearer ${token}`).send();
    });

    it('should return 409 if poller is already running', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      // Start poller first time
      const firstResponse = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(firstResponse.status).toBe(200);

      // Try to start again
      const secondResponse = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toHaveProperty('error');
      expect(secondResponse.body.error).toContain('already running');

      // Cleanup
      await request.post('/worker/stop').set('Authorization', `Bearer ${token}`).send();
    });

    it('should require AAD authentication', async () => {
      const response = await request.post('/worker/start').send();

      expect(response.status).toBe(401);
    });

    it('should reject invalid token', async () => {
      const response = await request
        .post('/worker/start')
        .set('Authorization', 'Bearer invalid-token')
        .send();

      expect(response.status).toBe(401);
    });
  });

  describe('POST /worker/stop', () => {
    it('should stop the poller and return 200', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      // Start poller first
      await request.post('/worker/start').set('Authorization', `Bearer ${token}`).send();

      // Stop poller
      const response = await request
        .post('/worker/stop')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('isRunning', false);
    });

    it('should return 200 even if poller is not running', async () => {
      const token = await generateValidJWT();

      const response = await request
        .post('/worker/stop')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('isRunning', false);
    });

    it('should require AAD authentication', async () => {
      const response = await request.post('/worker/stop').send();

      expect(response.status).toBe(401);
    });
  });

  describe('GET /worker/status', () => {
    it('should return current poller status', async () => {
      const token = await generateValidJWT();

      const response = await request
        .get('/worker/status')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isRunning');
      expect(response.body).toHaveProperty('currentQueueDepth');
      expect(response.body).toHaveProperty('lastPollTime');
      expect(typeof response.body.isRunning).toBe('boolean');
      expect(typeof response.body.currentQueueDepth).toBe('number');
    });

    it('should show running status when poller is active', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 5,
          done: true,
          records: [],
        })
        .persist();

      // Start poller
      await request.post('/worker/start').set('Authorization', `Bearer ${token}`).send();

      const response = await request
        .get('/worker/status')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.isRunning).toBe(true);

      // Cleanup
      await request.post('/worker/stop').set('Authorization', `Bearer ${token}`).send();
    });

    it('should require AAD authentication', async () => {
      const response = await request.get('/worker/status').send();

      expect(response.status).toBe(401);
    });
  });

  describe('GET /worker/stats', () => {
    it('should return detailed poller statistics', async () => {
      const token = await generateValidJWT();

      const response = await request
        .get('/worker/stats')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isRunning');
      expect(response.body).toHaveProperty('currentQueueDepth');
      expect(response.body).toHaveProperty('totalProcessed');
      expect(response.body).toHaveProperty('totalSucceeded');
      expect(response.body).toHaveProperty('totalFailed');
      expect(response.body).toHaveProperty('totalRetries');
      expect(response.body).toHaveProperty('lastPollTime');
      expect(response.body).toHaveProperty('uptimeSeconds');
    });

    it('should show zero counts for new poller', async () => {
      const token = await generateValidJWT();

      const response = await request
        .get('/worker/stats')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.totalProcessed).toBe(0);
      expect(response.body.totalSucceeded).toBe(0);
      expect(response.body.totalFailed).toBe(0);
      expect(response.body.totalRetries).toBe(0);
    });

    it('should require AAD authentication', async () => {
      const response = await request.get('/worker/stats').send();

      expect(response.status).toBe(401);
    });
  });

  describe('Authentication enforcement', () => {
    it('should reject requests with missing Authorization header', async () => {
      const startResponse = await request.post('/worker/start').send();
      const stopResponse = await request.post('/worker/stop').send();
      const statusResponse = await request.get('/worker/status').send();
      const statsResponse = await request.get('/worker/stats').send();

      expect(startResponse.status).toBe(401);
      expect(stopResponse.status).toBe(401);
      expect(statusResponse.status).toBe(401);
      expect(statsResponse.status).toBe(401);
    });

    it('should reject requests with malformed token', async () => {
      const token = 'not.a.valid.jwt';

      const startResponse = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(startResponse.status).toBe(401);
    });

    it('should include correlation ID in error responses', async () => {
      const response = await request.post('/worker/start').send();

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('correlationId');
    });
  });

  describe('Error handling', () => {
    it.skip('should handle Salesforce connection errors gracefully on start', async () => {
      // Note: This test is skipped because /worker/start doesn't actually connect to SF
      // SF connection only happens when processBatch() runs, so this scenario is impossible
      const token = await generateValidJWT();

      // Mock SF auth failure
      nock.cleanAll();
      nock(baseUrl)
        .post('/services/oauth2/token')
        .reply(500, { error: 'Internal server error' });

      const response = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      // Should return error but not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should return proper error structure', async () => {
      const response = await request.post('/worker/start').send();

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('correlationId');
      expect(typeof response.body.error).toBe('string');
    });
  });
});
