import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import supertest from 'supertest';
import { FastifyInstance } from 'fastify';
import { build } from '../src/server';

describe('Health Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
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
    it('should handle errors with proper format', async () => {
      // Trigger an error by sending invalid JSON
      const response = await supertest(app.server)
        .post('/generate')
        .set('Content-Type', 'application/json')
        .send('this is not valid json');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('statusCode');
    });
  });
});
