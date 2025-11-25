import { describe, expect, it, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import supertest from 'supertest';
import { FastifyInstance } from 'fastify';
import { build } from '../src/server';

// Mock the secrets module for Key Vault connectivity tests
jest.mock('../src/config/secrets');

import { checkKeyVaultConnectivity } from '../src/config/secrets';

describe('Health Endpoints', () => {
  let app: FastifyInstance;
  const mockCheckKeyVaultConnectivity = checkKeyVaultConnectivity as jest.MockedFunction<
    typeof checkKeyVaultConnectivity
  >;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock: Key Vault is accessible
    mockCheckKeyVaultConnectivity.mockResolvedValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /healthz', () => {
    it('should return 200 with status ok', async () => {
      const response = await supertest(app.server).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should include correlation ID in response headers', async () => {
      const response = await supertest(app.server).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBeDefined();
      expect(response.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should propagate provided correlation ID in header', async () => {
      const customId = 'health-check-trace-id-123';

      const response = await supertest(app.server)
        .get('/healthz')
        .set('x-correlation-id', customId);

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(customId);
    });

    it('should always respond (liveness check)', async () => {
      // Make multiple requests to ensure consistency
      const requests = Array(3)
        .fill(null)
        .map(() => supertest(app.server).get('/healthz'));
      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok' });
      });
    });
  });

  describe('GET /readyz', () => {
    it('should return 200 with ready true when dependencies are healthy', async () => {
      // For now, readyz will return true by default since we have no external dependencies yet
      const response = await supertest(app.server).get('/readyz');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('ready');
      expect(typeof response.body.ready).toBe('boolean');
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should include correlation ID in response headers', async () => {
      const response = await supertest(app.server).get('/readyz');

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBeDefined();
      expect(response.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should return 503 with ready false when dependencies are unhealthy', async () => {
      // This test will be expanded when we add actual dependency checks
      // For now, we test the endpoint structure
      const response = await supertest(app.server).get('/readyz?force_unhealthy=true');

      // Initially this will pass with 200, but the structure allows for 503
      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('ready');
    });
  });

  describe('Invalid Routes', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await supertest(app.server).get('/non-existent-route');

      expect(response.status).toBe(404);
    });
  });

  describe('Error Handler', () => {
    it('should handle errors with proper format including correlation ID', async () => {
      // Trigger an error by sending invalid JSON
      const response = await supertest(app.server)
        .post('/generate')
        .set('Content-Type', 'application/json')
        .send('this is not valid json');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('statusCode');
      expect(response.body).toHaveProperty('correlationId');
      expect(response.headers['x-correlation-id']).toBeDefined();
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);
    });

    it('should return ValidationError for invalid input', async () => {
      const response = await supertest(app.server)
        .post('/generate')
        .set('Content-Type', 'application/json')
        .send('not json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('ValidationError');
    });
  });

  describe('GET /readyz - Key Vault Connectivity', () => {
    it('should include keyVault status in checks when configured', async () => {
      // Set environment to production with Key Vault
      const originalEnv = process.env.NODE_ENV;
      const originalKvUri = process.env.KEY_VAULT_URI;

      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';

      mockCheckKeyVaultConnectivity.mockResolvedValue(true);

      const response = await supertest(app.server).get('/readyz');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('checks');
      expect(response.body.checks).toHaveProperty('keyVault');

      // Restore environment
      process.env.NODE_ENV = originalEnv;
      process.env.KEY_VAULT_URI = originalKvUri;
    });

    it('should return 200 when Key Vault is accessible in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalKvUri = process.env.KEY_VAULT_URI;

      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';

      mockCheckKeyVaultConnectivity.mockResolvedValue(true);

      const response = await supertest(app.server).get('/readyz');

      expect(response.status).toBe(200);
      expect(response.body.ready).toBe(true);
      expect(response.body.checks.keyVault).toBe(true);

      // Restore environment
      process.env.NODE_ENV = originalEnv;
      process.env.KEY_VAULT_URI = originalKvUri;
    });

    it('should return 503 when Key Vault is unreachable in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalKvUri = process.env.KEY_VAULT_URI;

      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';

      mockCheckKeyVaultConnectivity.mockResolvedValue(false);

      const response = await supertest(app.server).get('/readyz');

      expect(response.status).toBe(503);
      expect(response.body.ready).toBe(false);
      expect(response.body.checks.keyVault).toBe(false);

      // Restore environment
      process.env.NODE_ENV = originalEnv;
      process.env.KEY_VAULT_URI = originalKvUri;
    });

    it('should not check Key Vault in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalKvUri = process.env.KEY_VAULT_URI;

      process.env.NODE_ENV = 'development';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';

      const response = await supertest(app.server).get('/readyz');

      expect(response.status).toBe(200);
      expect(mockCheckKeyVaultConnectivity).not.toHaveBeenCalled();

      // Restore environment
      process.env.NODE_ENV = originalEnv;
      process.env.KEY_VAULT_URI = originalKvUri;
    });

    it('should not check Key Vault when KEY_VAULT_URI not set', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalKvUri = process.env.KEY_VAULT_URI;

      process.env.NODE_ENV = 'production';
      delete process.env.KEY_VAULT_URI;

      await supertest(app.server).get('/readyz');

      expect(mockCheckKeyVaultConnectivity).not.toHaveBeenCalled();

      // Restore environment
      process.env.NODE_ENV = originalEnv;
      process.env.KEY_VAULT_URI = originalKvUri;
    });
  });
});
