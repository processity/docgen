import axios from 'axios';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync, createPublicKey } from 'crypto';
import { completeReconnect, reconnectSettings, verifyIntegration, ReconnectSettings } from '../src/sf/reconnect';
import { SalesforceAuth, getSalesforceAuth } from '../src/sf/auth';
import { AppConfig } from '../src/types';

jest.mock('axios');
jest.mock('../src/sf/auth');
const http = axios as jest.Mocked<typeof axios>;
function response(data: unknown) { return { data, status: 200, statusText: 'OK', headers: {}, config: { url: 'https://test.invalid' } }; }
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const orgId = '00D000000000001AAA';
const userId = '005000000000001AAA';
const settings: ReconnectSettings = {
  publicUrl: 'https://docgen.example.com', salesforceOrigin: 'https://acme--uat.sandbox.my.salesforce.com',
  username: 'integration@acme.com.uat', clientId: 'salesforce-client', privateKey,
  aadClientId: 'entra-client', aadClientSecret: 'SECRET-NEVER-LOG',
  aadTokenEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token', aadScope: 'api://entra-client/.default',
};
const request = { orgId, userId, namedCredential: 'Custom_Backend' };
const setupUrl = `${settings.salesforceOrigin}/services/apexrest/docgen/connection/setup`;
const result = { connected: true, orgId, integrationUsername: settings.username };
const info = { ...request, backendUrl: settings.publicUrl, salesforceOrigin: settings.salesforceOrigin,
  externalCredential: 'Custom_Entra', principalName: 'Main',
  isSandbox: true, tokenEndpoint: settings.aadTokenEndpoint, scope: settings.aadScope };
const invalidateToken = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  (SalesforceAuth as jest.Mock).mockImplementation(() => ({ getAccessToken: jest.fn().mockResolvedValue('service-token') }));
  (getSalesforceAuth as jest.Mock).mockReturnValue({ invalidateToken });
  http.post.mockImplementation(async (url): Promise<any> => {
    if (url === `${settings.salesforceOrigin}/services/oauth2/token`) return { data: { access_token: 'admin-token' } };
    if (url === settings.aadTokenEndpoint) return { data: { access_token: 'entra-token' } };
    if (url === setupUrl) return { data: result };
    return { data: {} };
  });
  http.get.mockImplementation(async (url, options): Promise<any> => {
    if (url === setupUrl) return { data: info };
    if (String(url).endsWith('/query')) return { data: { records: [{ Id: orgId, IsSandbox: true }] } };
    if (options?.headers?.Authorization === 'Bearer service-token') {
      return { data: { organization_id: orgId, preferred_username: settings.username } };
    }
    return { data: { organization_id: orgId, user_id: userId } };
  });
  http.put.mockResolvedValue(response({ restored: true }));
});

it('restores the selected credential only after admin, integration-user, and Entra verification', async () => {
  expect(await completeReconnect(settings, request, 'code', 'verifier')).toEqual({
    ...result, salesforceToAzure: true, azureToSalesforce: true,
  });
  const body = new URLSearchParams(http.post.mock.calls[0][1] as string);
  expect(body.get('code_verifier')).toBe('verifier');
  expect(body.get('client_secret')).toBeNull();
  const assertion = jwt.verify(body.get('client_assertion')!, createPublicKey(privateKey), { algorithms: ['RS256'] });
  expect(assertion).toMatchObject({ iss: settings.clientId, sub: settings.clientId,
    aud: `${settings.salesforceOrigin}/services/oauth2/token` });
  expect(http.put).toHaveBeenCalledWith(setupUrl, { ...request, backendUrl: settings.publicUrl,
    externalCredential: info.externalCredential, principalName: info.principalName,
    tokenEndpoint: settings.aadTokenEndpoint, scope: settings.aadScope,
    clientId: settings.aadClientId, clientSecret: settings.aadClientSecret }, expect.objectContaining({
    headers: { Authorization: 'Bearer admin-token' }, maxRedirects: 0,
  }));
  expect(SalesforceAuth).toHaveBeenCalledWith(expect.objectContaining({ sfUsername: settings.username }));
  expect(invalidateToken).toHaveBeenCalledTimes(1);
  expect(http.post).toHaveBeenLastCalledWith(`${settings.salesforceOrigin}/services/oauth2/revoke`, 'token=admin-token', expect.anything());
});

it('uses the configured Salesforce consumer secret for admin OAuth while retaining PKCE and the fixed JWT integration user', async () => {
  const sfSecret = 'SF-CONSUMER-SECRET-NEVER-LOG';
  await expect(completeReconnect({ ...settings, clientSecret: sfSecret }, request, 'code', 'verifier'))
    .resolves.toMatchObject({ salesforceToAzure: true, azureToSalesforce: true, integrationUsername: settings.username });
  const body = new URLSearchParams(http.post.mock.calls[0][1] as string);
  expect(body.get('client_secret')).toBe(sfSecret);
  expect(body.get('client_assertion')).toBeNull();
  expect(body.get('client_assertion_type')).toBeNull();
  expect(body.get('code_verifier')).toBe('verifier');
  expect(body.get('redirect_uri')).toBe(`${settings.publicUrl}/connect/callback`);
  expect(SalesforceAuth).toHaveBeenCalledWith(expect.objectContaining({
    sfUsername: settings.username, sfPrivateKey: settings.privateKey,
  }));
  expect(http.put).toHaveBeenCalledWith(setupUrl, expect.objectContaining({ clientSecret: settings.aadClientSecret }), expect.anything());
});

it('persists credentials only after the admin, integration user, org, endpoint and Entra are verified', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await completeReconnect(settings, request, 'code', 'verifier', save);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.invocationCallOrder[0]).toBeGreaterThan(http.get.mock.invocationCallOrder[3]);
  expect(save.mock.invocationCallOrder[0]).toBeGreaterThan(http.post.mock.invocationCallOrder[1]);
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(http.put.mock.invocationCallOrder[0]);
});

it.each(['admin', 'integration', 'entra'])('never persists candidate credentials when %s verification fails', async (failure) => {
  const save = jest.fn();
  if (failure === 'admin') http.get.mockRejectedValueOnce(new Error('Forbidden'));
  if (failure === 'integration') {
    http.get.mockResolvedValueOnce(response({ organization_id: orgId, user_id: userId }))
      .mockResolvedValueOnce(response(info))
      .mockResolvedValueOnce(response({ organization_id: orgId, preferred_username: 'wrong-user' }));
  }
  if (failure === 'entra') {
    http.post.mockResolvedValueOnce(response({ access_token: 'admin-token' })).mockRejectedValueOnce(new Error('Invalid Entra secret'));
  }
  await expect(completeReconnect(settings, request, 'code', 'verifier', save)).rejects.toThrow();
  expect(save).not.toHaveBeenCalled(); expect(http.put).not.toHaveBeenCalled();
});

it('does not restore the principal or report success when durable storage rejects the verified credentials', async () => {
  const save = jest.fn().mockRejectedValue(new Error('PRIVATE-SECRET-BODY'));
  await expect(completeReconnect(settings, request, 'code', 'verifier', save)).rejects.toThrow('Saving verified Salesforce credentials failed');
  expect(http.put).not.toHaveBeenCalled();
});

it('does not retry a rejected Salesforce consumer secret using a different authentication method or write credentials', async () => {
  http.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'invalid_client',
    error_description: 'SF-CONSUMER-SECRET-NEVER-LOG' } }, config: { data: 'PRIVATE-CODE-AND-SECRET' } });
  await expect(completeReconnect({ ...settings, clientSecret: 'SF-CONSUMER-SECRET-NEVER-LOG' }, request, 'code', 'verifier'))
    .rejects.toThrow('Salesforce token exchange failed (HTTP 400; invalid_client)');
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(http.put).not.toHaveBeenCalled();
});

it.each([
  { organization_id: '00D000000000002AAA', user_id: userId },
  { organization_id: orgId, user_id: '005000000000002AAA' },
])('refuses a different authenticated admin/org before accessing credentials (%j)', async (identity) => {
  http.get.mockResolvedValueOnce(response(identity));
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow('Sign in as the admin');
  expect(http.put).not.toHaveBeenCalled();
  expect(SalesforceAuth).not.toHaveBeenCalled();
});

it.each([
  { backendUrl: 'https://another-backend.example.com' },
  { namedCredential: 'Changed_Setting' },
  { tokenEndpoint: 'https://another-tenant.example.com/token' },
  { scope: 'api://another-app/.default' },
])('refuses changed endpoints or an incompatible External Credential (%j)', async (change) => {
  http.get.mockResolvedValueOnce(response({ organization_id: orgId, user_id: userId }));
  http.get.mockResolvedValueOnce(response({ ...info, ...change }));
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow();
  expect(http.put).not.toHaveBeenCalled();
});

it('does not grant privileges or replace the integration user when administrator access is denied', async () => {
  http.get.mockResolvedValueOnce(response({ organization_id: orgId, user_id: userId }));
  http.get.mockRejectedValueOnce(new Error('403 with PRIVATE-TOKEN'));
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow('Administrator and endpoint verification failed');
  expect(http.put).not.toHaveBeenCalled();
});

it.each(['invalid_client', 'invalid_client_id', 'invalid_client_credentials', 'invalid_grant',
  'invalid_request', 'invalid_scope', 'unsupported_grant_type', 'access_denied'])(
  'identifies a Salesforce token-exchange failure safely (%s)', async (code) => {
  http.post.mockRejectedValueOnce({ response: { status: 400, data: { error: code,
    error_description: 'SECRET-UPSTREAM-DESCRIPTION' } }, config: { data: 'PRIVATE-ASSERTION-AND-CODE' } });
  let failure: unknown;
  try { await completeReconnect(settings, request, 'PRIVATE-CODE', 'PRIVATE-VERIFIER'); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  const message = (failure as Error).message;
  expect(message).toContain(`Salesforce token exchange failed (HTTP 400; ${code})`);
  expect(message).not.toMatch(/SECRET-|PRIVATE-/);
  expect(http.get).not.toHaveBeenCalled();
  expect(http.put).not.toHaveBeenCalled();
});

it('never echoes unknown OAuth errors or descriptions', async () => {
  http.post.mockRejectedValueOnce({ response: { status: 400, data: {
    error: 'PRIVATE-TOKEN', error_description: 'PRIVATE-TOKEN' } } });
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow(
    'Salesforce token exchange failed (HTTP 400). Check the Salesforce OAuth app configuration and retry.');
});

it.each([
  ['invalid code verifier: PRIVATE-VERIFIER', 'PKCE verification'],
  ['audience is invalid: PRIVATE-ASSERTION', 'JWT audience'],
  ['invalid assertion: PRIVATE-ASSERTION', 'JWT assertion'],
  ['invalid authorization code: PRIVATE-CODE', 'authorization code'],
  ['user has not approved this consumer: PRIVATE-IDENTITY', 'OAuth app authorization'],
])('categorizes OAuth rejection details without exposing them (%s)', async (description, category) => {
  http.post.mockRejectedValueOnce({ response: { status: 400, data: {
    error: 'invalid_grant', error_description: description } } });
  let failure: unknown;
  try { await completeReconnect(settings, request, 'code', 'verifier'); } catch (error) { failure = error; }
  expect((failure as Error).message).toContain(`HTTP 400; invalid_grant; ${category}`);
  expect((failure as Error).message).not.toContain('PRIVATE-');
});

it('distinguishes rejected administrator tokens from the code exchange and still revokes the token', async () => {
  http.get.mockRejectedValueOnce({ response: { status: 401, data: { error: 'invalid_token', error_description: 'PRIVATE-TOKEN' } } });
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow(
    'Salesforce administrator identity check failed (HTTP 401; invalid_token)');
  expect(http.put).not.toHaveBeenCalled();
  expect(http.post).toHaveBeenLastCalledWith(`${settings.salesforceOrigin}/services/oauth2/revoke`, 'token=admin-token', expect.anything());
});

it('refuses an integration token for a different Salesforce org', async () => {
  http.get.mockResolvedValueOnce(response({ organization_id: '00D000000000002AAA', preferred_username: settings.username }));
  await expect(verifyIntegration(settings, orgId)).rejects.toThrow('different Salesforce org');
});

it('refuses an integration token for a different user in the same org', async () => {
  http.get.mockResolvedValueOnce(response({ organization_id: orgId, preferred_username: 'admin@acme.com.uat' }));
  await expect(verifyIntegration(settings, orgId)).rejects.toThrow('different Salesforce org');
});

it('does not overwrite the principal if the Entra secret is invalid', async () => {
  const original = http.post.getMockImplementation()!;
  http.post.mockImplementation((url, ...args): any => url === settings.aadTokenEndpoint
    ? Promise.reject(new Error('SECRET-NEVER-LOG')) : original(url, ...args));
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow('Entra credential verification failed');
  expect(http.put).not.toHaveBeenCalled();
});

it('reports partial failure if credentials were restored but the return callout fails', async () => {
  const original = http.post.getMockImplementation()!;
  http.post.mockImplementation((url, ...args): any => url === setupUrl
    ? Promise.reject(new Error('SECRET-NEVER-LOG')) : original(url, ...args));
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow('Salesforce-to-backend verification failed');
  expect(http.put).toHaveBeenCalledTimes(1);
  expect(invalidateToken).not.toHaveBeenCalled();
});

it('does not mistake a restored credential for a verified connection', async () => {
  const original = http.post.getMockImplementation()!;
  http.post.mockImplementation((url, ...args): any => url === setupUrl
    ? Promise.resolve({ data: { connected: false } }) : original(url, ...args));
  await expect(completeReconnect(settings, request, 'code', 'verifier')).rejects.toThrow('both connection directions');
});

it('requires explicit reconnect configuration and leaves non-JWT backends unsupported', () => {
  expect(() => reconnectSettings({} as AppConfig)).toThrow('setup is incomplete');
  const config = { reconnectPublicUrl: settings.publicUrl, reconnectAadClientSecret: 'secret',
    sfDomain: 'acme--uat.sandbox.my.salesforce.com', sfUsername: settings.username, sfClientId: settings.clientId,
    sfPrivateKey: privateKey, clientId: 'entra-client', azureTenantId: 'tenant' } as AppConfig;
  expect(reconnectSettings(config).username).toBe(settings.username);
  expect(reconnectSettings({ ...config, reconnectSfClientSecret: ' consumer-secret ' }).clientSecret).toBe('consumer-secret');
  expect(reconnectSettings({ ...config, reconnectSfClientSecret: ' ' }).clientSecret).toBeUndefined();
  expect(() => reconnectSettings({ ...config, sfdxAuthUrl: 'force://unused' })).toThrow('configured JWT integration user');
  expect(() => reconnectSettings({ ...config, sfDomain: 'attacker.example.com' })).toThrow('My Domain');
  expect(() => reconnectSettings({ ...config, reconnectPublicUrl: 'http://insecure.example.com' })).toThrow('HTTPS');
});

it('repairs production using its own JWT user and credential after verifying a non-sandbox org', async () => {
  const production = { ...settings, publicUrl: 'https://production.example.com',
    salesforceOrigin: 'https://acme.my.salesforce.com', username: 'integration@acme.com',
    aadClientId: 'production-entra', aadClientSecret: 'PRODUCTION-SECRET', aadScope: 'api://production-entra/.default' };
  const productionRequest = { ...request, namedCredential: 'Docgen_Node_API' };
  const productionSetup = `${production.salesforceOrigin}/services/apexrest/docgen/connection/setup`;
  const productionResult = { connected: true, orgId, integrationUsername: production.username };
  http.get.mockResolvedValueOnce(response({ organization_id: orgId, user_id: userId }))
    .mockResolvedValueOnce(response({ ...info, ...productionRequest, backendUrl: production.publicUrl,
      salesforceOrigin: production.salesforceOrigin, scope: production.aadScope, isSandbox: false }))
    .mockResolvedValueOnce(response({ organization_id: orgId, preferred_username: production.username }))
    .mockResolvedValueOnce(response({ records: [{ Id: orgId, IsSandbox: false }] }));
  http.post.mockResolvedValueOnce(response({ access_token: 'production-admin' }))
    .mockResolvedValueOnce(response({ access_token: 'production-entra-token' }))
    .mockResolvedValueOnce(response(productionResult))
    .mockResolvedValueOnce(response({}));
  expect(await completeReconnect(production, productionRequest, 'code', 'verifier')).toEqual({
    ...productionResult, salesforceToAzure: true, azureToSalesforce: true,
  });
  expect(SalesforceAuth).toHaveBeenCalledWith(expect.objectContaining({ sfDomain: 'acme.my.salesforce.com', sfUsername: production.username }));
  expect(http.put).toHaveBeenCalledWith(productionSetup, expect.objectContaining({
    namedCredential: 'Docgen_Node_API', backendUrl: production.publicUrl,
    clientId: production.aadClientId, clientSecret: production.aadClientSecret,
  }), expect.anything());
});
