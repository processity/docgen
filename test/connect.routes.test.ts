import Fastify from 'fastify';
import { createHash } from 'crypto';
import { connectRoutes } from '../src/routes/connect';
import { AppConfig } from '../src/types';
import { completeReconnect, verifyIntegration } from '../src/sf/reconnect';

jest.mock('../src/sf/reconnect', () => ({ ...jest.requireActual('../src/sf/reconnect'), completeReconnect: jest.fn(), verifyIntegration: jest.fn() }));
const config = { reconnectPublicUrl: 'https://docgen.example.com', reconnectAadClientSecret: 'entra-secret',
  sfDomain: 'acme--uat.sandbox.my.salesforce.com', sfUsername: 'integration@acme.com.uat',
  sfClientId: 'salesforce-client', sfPrivateKey: 'private-cookie-key', clientId: 'entra-client', azureTenantId: 'tenant' } as AppConfig;
const orgId = '00D000000000001AAA';
const userId = '005000000000001AAA';
const sourceOrigin = 'https://acme--uat.sandbox.lightning.force.com';
const query = { orgId, userId, namedCredential: 'Custom_Backend', sourceOrigin };
const completed = { connected: true, orgId, integrationUsername: config.sfUsername };

function appFor(settings = config, lines?: string[]) {
  const app = Fastify({ logger: lines ? { level: 'info', stream: { write: (line: string) => { lines.push(line); } } } : false });
  app.decorate('authenticate', async (request: any, reply: any) => {
    if (request.headers.authorization !== 'Bearer entra-token') return reply.code(401).send({ error: 'Unauthorized' });
  });
  app.register(connectRoutes, { config: settings });
  return app;
}
async function start(app: ReturnType<typeof appFor>) {
  const response = await app.inject({ method: 'GET', url: '/connect/start', query });
  expect(response.statusCode).toBe(302);
  const location = new URL(response.headers.location!);
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  return { response, location, cookie, state: location.searchParams.get('state')! };
}

beforeEach(() => {
  jest.clearAllMocks();
  (completeReconnect as jest.Mock).mockResolvedValue(completed);
  (verifyIntegration as jest.Mock).mockResolvedValue({ orgId, isSandbox: true, integrationUsername: config.sfUsername });
});
afterEach(() => jest.restoreAllMocks());

it('uses the configured Salesforce endpoint, PKCE and a protected cookie; ignores spoofed Host headers', async () => {
  const app = appFor();
  const { response, location } = await start(app);
  expect(location.origin).toBe('https://acme--uat.sandbox.my.salesforce.com');
  expect(location.searchParams.get('redirect_uri')).toBe('https://docgen.example.com/connect/callback');
  expect(location.searchParams.get('prompt')).toBe('consent');
  expect(location.searchParams.get('scope')).toBe('api openid');
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(response.headers['set-cookie']).toContain('HttpOnly; Secure; SameSite=Lax');
  expect(response.headers['set-cookie']).not.toContain('private-cookie-key');
  const spoofed = await app.inject({ method: 'GET', url: '/connect/start', query, headers: { host: 'attacker.example.com' } });
  expect(new URL(spoofed.headers.location!).searchParams.get('redirect_uri')).toBe('https://docgen.example.com/connect/callback');
  await app.close();
});

it('uses the production Salesforce org, callback and integration username throughout reconnect', async () => {
  const production = { ...config, sfDomain: 'acme.my.salesforce.com',
    sfUsername: 'integration@acme.com', reconnectPublicUrl: 'https://production.example.com' };
  const productionQuery = { ...query, namedCredential: 'Docgen_Node_API', sourceOrigin: 'https://acme.lightning.force.com' };
  const app = appFor(production);
  (completeReconnect as jest.Mock).mockResolvedValue({ ...completed, integrationUsername: production.sfUsername });
  const startResponse = await app.inject({ method: 'GET', url: '/connect/start', query: productionQuery });
  expect(startResponse.statusCode).toBe(302);
  const location = new URL(startResponse.headers.location!);
  expect(location.origin).toBe('https://acme.my.salesforce.com');
  expect(location.searchParams.get('redirect_uri')).toBe('https://production.example.com/connect/callback');
  const callback = await app.inject({ method: 'GET', url: '/connect/callback',
    query: { code: 'production-code', state: location.searchParams.get('state')! },
    headers: { cookie: String(startResponse.headers['set-cookie']).split(';')[0] } });
  expect(callback.statusCode).toBe(200);
  expect(completeReconnect).toHaveBeenCalledWith(expect.objectContaining({
    publicUrl: production.reconnectPublicUrl, salesforceOrigin: 'https://acme.my.salesforce.com',
    username: production.sfUsername,
  }), expect.objectContaining(productionQuery), 'production-code', expect.any(String));
  expect(callback.body).toContain(productionQuery.sourceOrigin);
  await app.close();
});

it('restores both directions across replicas and returns only a result message to the exact Salesforce origin', async () => {
  const first = appFor();
  const second = appFor();
  const { cookie, state, location } = await start(first);
  const callback = await second.inject({ method: 'GET', url: '/connect/callback', query: { code: 'secret-code', state }, headers: { cookie } });
  expect(callback.statusCode).toBe(200);
  const verifier = (completeReconnect as jest.Mock).mock.calls[0][3];
  expect(createHash('sha256').update(verifier).digest('base64url')).toBe(location.searchParams.get('code_challenge'));
  expect(completeReconnect).toHaveBeenCalledWith(expect.objectContaining({ username: config.sfUsername }),
    expect.objectContaining(query), 'secret-code', verifier);
  expect(callback.body).toContain(sourceOrigin);
  expect(callback.body).toContain('Both connection directions are verified');
  expect(callback.body).not.toContain('secret-code');
  expect(callback.headers['set-cookie']).toContain('Max-Age=0');
  expect(callback.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(callback.headers['cache-control']).toBe('no-store');
  await first.close(); await second.close();
});

it('rejects a callback without its browser cookie or with the wrong state', async () => {
  const app = appFor();
  const { cookie, state } = await start(app);
  for (const input of [{ query: { code: 'secret-code', state } },
    { query: { code: 'secret-code', state: 'x'.repeat(state.length) }, headers: { cookie } },
    { query: { code: 'secret-code', state }, headers: { cookie: cookie + 'tampered' } }]) {
    expect((await app.inject({ method: 'GET', url: '/connect/callback', ...input })).statusCode).toBe(400);
  }
  expect(completeReconnect).not.toHaveBeenCalled();
  await app.close();
});

it('rejects expired sessions and declined authorization without changing credentials', async () => {
  const app = appFor();
  const { cookie, state } = await start(app);
  const declined = await app.inject({ method: 'GET', url: '/connect/callback', query: { error: 'access_denied', state }, headers: { cookie } });
  expect(declined.body).toContain('canceled or declined');
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + 601000);
  const expired = await app.inject({ method: 'GET', url: '/connect/callback', query: { code: 'code', state }, headers: { cookie } });
  expect(expired.body).toContain('expired or is invalid');
  expect(completeReconnect).not.toHaveBeenCalled();
  await app.close();
});

it('rejects an unrelated Salesforce origin and incomplete backend setup', async () => {
  const app = appFor();
  const bad = await app.inject({ method: 'GET', url: '/connect/start', query: { ...query, sourceOrigin: 'https://other.lightning.force.com' } });
  expect(bad.statusCode).toBe(400);
  expect(bad.headers['set-cookie']).toBeUndefined();
  const unconfigured = appFor({ ...config, reconnectPublicUrl: undefined });
  const missing = await unconfigured.inject({ method: 'GET', url: '/connect/start', query });
  expect(missing.body).toContain('setup is incomplete');
  await app.close(); await unconfigured.close();
});

it('does not log OAuth codes or expose upstream credentials in error pages', async () => {
  const lines: string[] = [];
  const app = appFor(config, lines);
  const { cookie, state } = await start(app);
  (completeReconnect as jest.Mock).mockRejectedValue(new Error('upstream-secret-value'));
  const res = await app.inject({ method: 'GET', url: '/connect/callback', query: { code: 'OAUTH-CODE-MUST-NOT-LOG', state }, headers: { cookie } });
  expect(res.statusCode).toBe(400);
  expect(res.body).not.toContain('upstream-secret-value');
  expect(lines.join('')).not.toContain('OAUTH-CODE-MUST-NOT-LOG');
  expect(lines.join('')).not.toContain('upstream-secret-value');
  await app.close();
});

it('requires Entra authentication for verification and returns proof for the requested org', async () => {
  const app = appFor();
  expect((await app.inject({ method: 'POST', url: '/connect/verify', payload: { orgId } })).statusCode).toBe(401);
  expect(verifyIntegration).not.toHaveBeenCalled();
  const checked = await app.inject({ method: 'POST', url: '/connect/verify', payload: { orgId }, headers: { authorization: 'Bearer entra-token' } });
  expect(checked.json()).toEqual({ ...completed, salesforceToAzure: true, azureToSalesforce: true });
  (verifyIntegration as jest.Mock).mockRejectedValue(new Error('secret'));
  const failed = await app.inject({ method: 'POST', url: '/connect/verify', payload: { orgId }, headers: { authorization: 'Bearer entra-token' } });
  expect(failed.statusCode).toBe(503);
  expect(failed.json().connected).toBe(false);
  await app.close();
});
