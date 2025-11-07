import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import { build } from '../src/server';
import * as fs from 'fs';
import * as path from 'path';

describe('Sample Payloads Validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Set up environment to bypass auth in development mode
    process.env.NODE_ENV = 'development';
    process.env.AUTH_BYPASS_DEVELOPMENT = 'true';

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    // Clean up environment
    delete process.env.AUTH_BYPASS_DEVELOPMENT;
  });

  it('should validate account.json sample', async () => {
    const samplePath = path.join(__dirname, '..', 'samples', 'account.json');
    const payload = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));

    const response = await app.inject({
      method: 'POST',
      url: '/generate',
      payload,
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('correlationId');
  });

  it('should validate opportunity.json sample', async () => {
    const samplePath = path.join(__dirname, '..', 'samples', 'opportunity.json');
    const payload = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));

    const response = await app.inject({
      method: 'POST',
      url: '/generate',
      payload,
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('correlationId');
  });

  it('should validate case.json sample', async () => {
    const samplePath = path.join(__dirname, '..', 'samples', 'case.json');
    const payload = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));

    const response = await app.inject({
      method: 'POST',
      url: '/generate',
      payload,
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('correlationId');
  });

  it('should verify all sample files exist', () => {
    const samplesDir = path.join(__dirname, '..', 'samples');
    const expectedFiles = ['account.json', 'opportunity.json', 'case.json'];

    expectedFiles.forEach((file) => {
      const filePath = path.join(samplesDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
