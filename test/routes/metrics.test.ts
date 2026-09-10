import { config as dotenvConfig } from 'dotenv';
import nock from 'nock';
import { build } from '../../src/server';
import { loadConfig } from '../../src/config';
import { createSalesforceAuth } from '../../src/sf/auth';
import { generateValidJWT } from '../helpers/jwt-helper';
import { recordDocument, recordStage, resetPerfMetrics } from '../../src/obs/perf';
import type { FastifyInstance } from 'fastify';

dotenvConfig();
process.env.SFDX_AUTH_URL = 'force://PlatformCLI::refresh-token@test.salesforce.com';

let appConfig: Awaited<ReturnType<typeof loadConfig>>;

describe('Metrics Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    appConfig = await loadConfig();

    createSalesforceAuth({
      sfdxAuthUrl: appConfig.sfdxAuthUrl!,
    });

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    resetPerfMetrics();
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    nock.cleanAll();
    resetPerfMetrics();

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

  afterEach(() => {
    nock.cleanAll();
  });

  async function get(url: string, token?: string) {
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    const response = await app.inject({ method: 'GET', url, headers });
    return { status: response.statusCode, body: response.json() };
  }

  describe('GET /metrics/performance', () => {
    it('should require AAD authentication', async () => {
      const response = await get('/metrics/performance');

      expect(response.status).toBe(401);
    });

    it('should return an empty-but-identified snapshot with no samples', async () => {
      const token = await generateValidJWT();

      const response = await get('/metrics/performance', token);

      expect(response.status).toBe(200);
      expect(response.body.replicaId).toBeTruthy();
      expect(response.body.correlationId).toBeTruthy();
      expect(response.body.documents.count).toBe(0);
      expect(response.body.documents.latency).toBeNull();
      expect(response.body.stages).toEqual([]);
    });

    it('should return recorded document and stage samples', async () => {
      const token = await generateValidJWT();

      recordDocument({ durationMs: 4000, success: true, outputFormat: 'PDF', mode: 'batch' });
      recordDocument({ durationMs: 2000, success: false, outputFormat: 'PDF', mode: 'batch' });
      recordStage('pdfConvert', 3000);
      recordStage('merge', 200);

      const response = await get('/metrics/performance', token);

      expect(response.status).toBe(200);
      expect(response.body.documents.count).toBe(2);
      expect(response.body.documents.succeeded).toBe(1);
      expect(response.body.documents.failed).toBe(1);
      expect(response.body.documents.latency.maxMs).toBe(4000);
      expect(response.body.documents.perHour).toBeGreaterThan(0);
      expect(response.body.slowestStageByTotalTime).toBe('pdfConvert');
      // additionalProperties on the response schema must not strip nested fields
      expect(response.body.stages[0]).toHaveProperty('p95Ms');
      expect(response.body.documents.byOutputFormat[0].key).toBe('PDF');
    });
  });

  describe('GET /metrics/resources', () => {
    it('should require AAD authentication', async () => {
      const response = await get('/metrics/resources');

      expect(response.status).toBe(401);
    });

    it('should return CPU, memory, pool and cache utilization', async () => {
      const token = await generateValidJWT();

      const response = await get('/metrics/resources', token);

      expect(response.status).toBe(200);
      expect(response.body.replicaId).toBeTruthy();
      expect(response.body.cpu.cores).toBeGreaterThan(0);
      expect(['cgroup-v2', 'cgroup-v1', 'process']).toContain(response.body.cpu.source);
      expect(response.body.memory.node.rssMb).toBeGreaterThan(0);

      expect(response.body.libreOfficePool.maxConcurrent).toBeGreaterThan(0);
      expect(response.body.libreOfficePool.utilizationPercent).not.toBeNull();

      expect(response.body.templateCache.maxSizeMb).toBe(500);
      expect(response.body.templateCache).toHaveProperty('hitRatePercent');
    });
  });
});
