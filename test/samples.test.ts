import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import nock from 'nock';
import { build } from '../src/server';
import * as fs from 'fs';
import * as path from 'path';
import { createTestDocxBuffer } from './helpers/test-docx';

describe('Sample Payloads Validation', () => {
  let app: FastifyInstance;
  let testDocxBuffer: Buffer;

  beforeAll(async () => {
    // Clean up any previous nock interceptors
    nock.cleanAll();

    // Set up environment to bypass auth in development mode
    process.env.NODE_ENV = 'development';
    process.env.AUTH_BYPASS_DEVELOPMENT = 'true';
    process.env.SF_DOMAIN = 'test.salesforce.com';
    process.env.SF_USERNAME = 'test@example.com';
    process.env.SF_CLIENT_ID = 'test-client-id';
    // Use SF_PRIVATE_KEY from environment if set (CI), otherwise use local key path
    if (!process.env.SF_PRIVATE_KEY) {
      process.env.SF_PRIVATE_KEY_PATH = './keys/server.key';
    }

    // Pre-generate test DOCX buffer
    testDocxBuffer = await createTestDocxBuffer();

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    nock.cleanAll();
    // Clean up environment
    delete process.env.AUTH_BYPASS_DEVELOPMENT;
  });

  beforeEach(() => {
    // Reset nock interceptors before each test
    nock.cleanAll();

    // Mock Salesforce JWT token exchange (persist for multiple calls)
    nock('https://login.salesforce.com')
      .persist()
      .post('/services/oauth2/token')
      .reply(200, {
        access_token: 'test-access-token',
        instance_url: 'https://test.salesforce.com',
      });

    // Mock template fetch (persist for any template ID)
    nock('https://test.salesforce.com')
      .persist()
      .get(/\/services\/data\/v59\.0\/sobjects\/ContentVersion\/.*\/VersionData/)
      .reply(200, testDocxBuffer);

    // Mock ContentVersion creation for document upload (persist for multiple calls)
    nock('https://test.salesforce.com')
      .persist()
      .post('/services/data/v59.0/sobjects/ContentVersion')
      .reply(201, {
        id: '068TestContentVersionId',
        success: true,
        errors: [],
      });

    // Mock ContentVersion query to get ContentDocumentId (persist for multiple calls)
    nock('https://test.salesforce.com')
      .persist()
      .get('/services/data/v59.0/query')
      .query(true)
      .reply(200, {
        records: [{
          ContentDocumentId: '069TestContentDocId',
        }],
      });

    // Mock ContentDocumentLink creation (persist for multiple calls)
    nock('https://test.salesforce.com')
      .persist()
      .post('/services/data/v59.0/sobjects/ContentDocumentLink')
      .reply(201, {
        id: '06ATestContentDocLinkId',
        success: true,
        errors: [],
      });
  });

  afterEach(() => {
    // Clean up nock after each test
    nock.cleanAll();
  });

  it('should validate account.json sample', async () => {
    const samplePath = path.join(__dirname, '..', 'samples', 'account.json');
    const payload = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));

    const response = await app.inject({
      method: 'POST',
      url: '/generate',
      payload,
    });

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
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
