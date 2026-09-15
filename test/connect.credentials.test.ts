import Fastify from 'fastify';
import { connectRoutes } from '../src/routes/connect';
import { AppConfig } from '../src/types';
import { ConnectionManager } from '../src/sf/connection-manager';
import { ClientCredentials, ConnectionStore, SavedConnection } from '../src/sf/connection-store';
import { completeReconnect, ReconnectError, verifyIntegration } from '../src/sf/reconnect';

jest.mock('../src/sf/reconnect', () => ({ ...jest.requireActual('../src/sf/reconnect'), completeReconnect: jest.fn(), verifyIntegration: jest.fn() }));
jest.mock('../src/sf/auth', () => ({ getSalesforceAuth: () => ({ updateClientId: jest.fn() }) }));
const base = { reconnectPublicUrl: 'https://docgen.example.com', reconnectAadClientSecret: 'entra-secret',
  reconnectCredentialEditing: true, sfDomain: 'acme--uat.sandbox.my.salesforce.com',
  sfUsername: 'integration@acme.com.uat', sfClientId: 'old-invalid-client', reconnectSfClientSecret: 'old-invalid-secret',
  sfPrivateKey: 'stable-server-private-key', clientId: 'entra-client', azureTenantId: 'tenant' } as AppConfig;
const query = { orgId: '00D000000000001AAA', userId: '005000000000001AAA', namedCredential: 'Custom_Backend',
  sourceOrigin: 'https://acme--uat.sandbox.lightning.force.com' };
const candidate = { clientId: 'new-refreshed-client', clientSecret: 'NEW-SF-SECRET-NOT-IN-RESPONSES' };

function memoryStore() {
  const pending = new Map<string, ClientCredentials>();
  let active: SavedConnection | undefined;
  return {
    stage: jest.fn(async (ticket: string, value: ClientCredentials) => { pending.set(ticket, { ...value }); }),
    take: jest.fn(async (ticket: string) => { const value = pending.get(ticket); pending.delete(ticket); if (!value) throw new ReconnectError('Session expired'); return value; }),
    discard: jest.fn(async (ticket: string) => { pending.delete(ticket); }),
    read: jest.fn(async () => active ? { ...active } : undefined),
    save: jest.fn(async (value: SavedConnection) => { active = { ...value }; }),
  };
}
function appFor(store: ConnectionStore, overrides: Partial<AppConfig> = {}, lines?: string[]) {
  const config = { ...base, ...overrides };
  const manager = new ConnectionManager(config, store);
  const app = Fastify({ logger: lines ? { level: 'info', stream: { write: (line: string) => { lines.push(line); } } } : false });
  app.decorate('authenticate', async () => undefined);
  app.register(connectRoutes, { config, connectionManager: manager });
  return app;
}
async function prepare(app: ReturnType<typeof appFor>, input = query, backendUrl = base.reconnectPublicUrl) {
  const page = await app.inject({ method: 'GET', url: '/connect/prepare', query: input });
  expect(page.statusCode).toBe(200);
  const state = JSON.parse(page.body.match(/state:("[A-Za-z0-9_-]+")/)![1]);
  const cookie = String(page.headers['set-cookie']).split(';')[0];
  const response = await app.inject({ method: 'POST', url: '/connect/prepare', payload: { ...candidate, state },
    headers: { cookie, origin: backendUrl } });
  expect(response.statusCode).toBe(200);
  return { page, response, state, cookie: String(response.headers['set-cookie']).split(';')[0] };
}
beforeEach(() => {
  jest.clearAllMocks();
  (completeReconnect as jest.Mock).mockImplementation(async (settings, request, _code, _verifier, save) => {
    await save?.();
    return { connected: true, orgId: request.orgId, integrationUsername: settings.username, salesforceToAzure: true, azureToSalesforce: true };
  });
  (verifyIntegration as jest.Mock).mockResolvedValue({ orgId: query.orgId, integrationUsername: base.sfUsername });
});

it('uses the same replacement flow in production with production origin, username and credential selection', async () => {
  const store = memoryStore();
  const production = { sfDomain: 'acme.my.salesforce.com', sfUsername: 'integration@acme.com',
    reconnectPublicUrl: 'https://production.docgen.example.com' };
  const input = { ...query, orgId: '00D000000000002AAA', namedCredential: 'Docgen_Node_API',
    sourceOrigin: 'https://acme.lightning.force.com' };
  const app = appFor(store, production);
  const { response, state, cookie } = await prepare(app, input, production.reconnectPublicUrl);
  const authorize = new URL(response.json().authorizationUrl);
  expect(authorize.origin).toBe('https://acme.my.salesforce.com');
  expect(authorize.searchParams.get('redirect_uri')).toBe(`${production.reconnectPublicUrl}/connect/callback`);
  const result = await app.inject({ method: 'GET', url: '/connect/callback', query: { state, code: 'production-code' }, headers: { cookie } });
  expect(result.statusCode).toBe(200);
  expect(result.body).toContain(production.sfUsername);
  expect(completeReconnect).toHaveBeenCalledWith(expect.objectContaining({ ...candidate,
    publicUrl: production.reconnectPublicUrl, username: production.sfUsername, salesforceOrigin: 'https://acme.my.salesforce.com' }),
    expect.objectContaining(input), 'production-code', expect.any(String), expect.any(Function));
  expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ salesforceOrigin: 'https://acme.my.salesforce.com', orgId: input.orgId }));
  await app.close();
});

it('uses new credentials after refresh, completes on another replica, and never returns the secret or puts it in a cookie', async () => {
  const store = memoryStore();
  const first = appFor(store, { sfClientId: undefined, reconnectSfClientSecret: undefined });
  const second = appFor(store);
  const { page, response, state, cookie } = await prepare(first);
  const authUrl = new URL(response.json().authorizationUrl);
  expect(authUrl.origin).toBe('https://acme--uat.sandbox.my.salesforce.com');
  expect(authUrl.searchParams.get('client_id')).toBe(candidate.clientId);
  expect(store.save).not.toHaveBeenCalled();
  for (const output of [page.body, response.body, cookie]) expect(output).not.toContain(candidate.clientSecret);
  expect(page.headers['content-security-policy']).toContain("connect-src 'self'");
  expect(page.headers['referrer-policy']).toBe('same-origin');
  expect(page.body).toContain('event.source!==window.opener');
  const finished = await second.inject({ method: 'GET', url: '/connect/callback', query: { state, code: 'oauth-code' }, headers: { cookie } });
  expect(finished.statusCode).toBe(200);
  expect(completeReconnect).toHaveBeenCalledWith(expect.objectContaining({ ...candidate,
    username: base.sfUsername, salesforceOrigin: 'https://acme--uat.sandbox.my.salesforce.com' }),
    expect.objectContaining(query), 'oauth-code', expect.any(String), expect.any(Function));
  expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ ...candidate, orgId: query.orgId, adminUserId: query.userId }));
  expect(finished.body).not.toContain(candidate.clientSecret);
  // The first replica must read the new record before the Salesforce return call checks it.
  await first.inject({ method: 'POST', url: '/connect/verify', payload: { orgId: query.orgId } });
  expect(verifyIntegration).toHaveBeenCalledWith(expect.objectContaining(candidate), query.orgId);
  await first.close(); await second.close();
});

it('leaves active credentials untouched when the admin or integration verification fails and consumes the pending session', async () => {
  const store = memoryStore(); const app = appFor(store);
  const { state, cookie } = await prepare(app);
  (completeReconnect as jest.Mock).mockRejectedValueOnce(new ReconnectError('Admin permission denied'));
  const result = await app.inject({ method: 'GET', url: '/connect/callback', query: { state, code: 'code' }, headers: { cookie } });
  expect(result.statusCode).toBe(400); expect(store.save).not.toHaveBeenCalled();
  expect((await app.inject({ method: 'GET', url: '/connect/callback', query: { state, code: 'code' }, headers: { cookie } })).statusCode).toBe(400);
  expect(completeReconnect).toHaveBeenCalledTimes(1);
  await app.close();
});

it('rejects cross-origin submissions, missing cookies, and wrong state before staging any credentials', async () => {
  const store = memoryStore(); const app = appFor(store);
  const page = await app.inject({ method: 'GET', url: '/connect/prepare', query });
  const state = JSON.parse(page.body.match(/state:("[A-Za-z0-9_-]+")/)![1]);
  const cookie = String(page.headers['set-cookie']).split(';')[0];
  for (const input of [
    { headers: { cookie, origin: 'https://attacker.example.com' }, state },
    { headers: { origin: base.reconnectPublicUrl }, state },
    { headers: { cookie, origin: base.reconnectPublicUrl }, state: 'wrong' },
  ]) {
    expect((await app.inject({ method: 'POST', url: '/connect/prepare', payload: { ...candidate, state: input.state }, headers: input.headers })).statusCode).toBe(400);
  }
  expect(store.stage).not.toHaveBeenCalled(); expect(store.save).not.toHaveBeenCalled();
  await app.close();
});

it('rejects another Salesforce domain and disabled editing without requesting credentials from the opener', async () => {
  const store = memoryStore(); const app = appFor(store, { reconnectCredentialEditing: false });
  const disabled = await app.inject({ method: 'GET', url: '/connect/prepare', query });
  expect(disabled.statusCode).toBe(400); expect(disabled.body).toContain('not enabled');
  expect(disabled.body).not.toContain('docgen:credentials-ready');
  const wrongOrg = await app.inject({ method: 'GET', url: '/connect/prepare', query: { ...query, sourceOrigin: 'https://other.lightning.force.com' } });
  expect(wrongOrg.statusCode).toBe(400); expect(wrongOrg.body).toContain('different Salesforce org');
  expect(store.stage).not.toHaveBeenCalled(); await app.close();
});

it('redacts invalid submitted secrets from validation responses and logs', async () => {
  const lines: string[] = []; const app = appFor(memoryStore(), {}, lines);
  const secret = 'NEVER-LOG-THIS-SECRET-'.repeat(40);
  const result = await app.inject({ method: 'POST', url: '/connect/prepare', payload: { ...candidate, clientSecret: secret, state: 'state' } });
  expect(result.statusCode).toBe(400);
  expect(result.body + lines.join('')).not.toContain('NEVER-LOG-THIS-SECRET');
  await app.close();
});

it('limits anonymous staging writes', async () => {
  const store = memoryStore(); const app = appFor(store);
  const page = await app.inject({ method: 'GET', url: '/connect/prepare', query });
  const state = JSON.parse(page.body.match(/state:("[A-Za-z0-9_-]+")/)![1]);
  const headers = { cookie: String(page.headers['set-cookie']).split(';')[0], origin: base.reconnectPublicUrl };
  for (let i = 0; i < 20; i++) await app.inject({ method: 'POST', url: '/connect/prepare', payload: { ...candidate, state }, headers });
  expect((await app.inject({ method: 'POST', url: '/connect/prepare', payload: { ...candidate, state }, headers })).statusCode).toBe(429);
  expect(store.stage).toHaveBeenCalledTimes(20); await app.close();
});
