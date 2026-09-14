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
  expect(() => reconnectSettings({ ...config, sfdxAuthUrl: 'force://unused' })).toThrow('configured JWT integration user');
  expect(() => reconnectSettings({ ...config, sfDomain: 'attacker.example.com' })).toThrow('My Domain');
  expect(() => reconnectSettings({ ...config, reconnectPublicUrl: 'http://insecure.example.com' })).toThrow('HTTPS');
});
