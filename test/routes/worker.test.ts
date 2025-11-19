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

// Config will be loaded in beforeAll
let appConfig: Awaited<ReturnType<typeof loadConfig>>;

// Use conditional describe to skip entire suite if no credentials
const describeIfCredentials = process.env.SFDX_AUTH_URL ? describe : describe.skip;

describeIfCredentials('Worker Routes', () => {
  let app: FastifyInstance;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    // Load config first
    appConfig = await loadConfig();

    // Initialize real Salesforce auth
    createSalesforceAuth({
      sfdxAuthUrl: appConfig.sfdxAuthUrl!,
    });

    app = await build();
    await app.ready();
    request = supertest(app.server);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
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
    // Note: Poller now auto-starts and cannot be stopped via API
    // It will be stopped when the app closes in afterAll
    nock.cleanAll();
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

    it('should return status with isRunning field', async () => {
      const token = await generateValidJWT();

      // Note: In production, poller auto-starts. In tests, it may not be running.
      const response = await request
        .get('/worker/status')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isRunning');
      expect(typeof response.body.isRunning).toBe('boolean');
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
      const statusResponse = await request.get('/worker/status').send();
      const statsResponse = await request.get('/worker/stats').send();

      expect(statusResponse.status).toBe(401);
      expect(statsResponse.status).toBe(401);
    });

    it('should reject requests with malformed token', async () => {
      const token = 'not.a.valid.jwt';

      const statusResponse = await request
        .get('/worker/status')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(statusResponse.status).toBe(401);
    });

    it('should include correlation ID in error responses', async () => {
      const response = await request.get('/worker/status').send();

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('correlationId');
    });
  });

  describe('Error handling', () => {
    it('should return proper error structure', async () => {
      const response = await request.get('/worker/status').send();

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('correlationId');
      expect(typeof response.body.error).toBe('string');
    });
  });
});
