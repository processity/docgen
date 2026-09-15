import { SecretClient } from '@azure/keyvault-secrets';
import { ConnectionManager } from '../src/sf/connection-manager';
import { KeyVaultConnectionStore, CONNECTION_SECRET } from '../src/sf/connection-store';
import { AppConfig } from '../src/types';

jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.mock('@azure/keyvault-secrets');
jest.mock('../src/sf/auth', () => ({ getSalesforceAuth: () => ({ updateClientId: jest.fn() }) }));
const values = new Map<string, string>();
const client = {
  setSecret: jest.fn(async (name: string, value: string) => { values.set(name, value); return {}; }),
  getSecret: jest.fn(async (name: string) => { if (!values.has(name)) throw { statusCode: 404 }; return { value: values.get(name) }; }),
  beginDeleteSecret: jest.fn(async (name: string) => { values.delete(name); return {}; }),
};
const credentials = { clientId: 'new-client-id', clientSecret: 'NEVER-LOG-SECRET' };
const config = { sfDomain: 'acme--uat.sandbox.my.salesforce.com', sfClientId: 'old-client-id', reconnectSfClientSecret: 'old-secret' } as AppConfig;
beforeEach(() => {
  values.clear(); jest.clearAllMocks();
  (SecretClient as jest.MockedClass<typeof SecretClient>).mockImplementation(() => client as unknown as SecretClient);
});

it('stages credentials in server storage with an expiry, never in the name, and consumes them once', async () => {
  const store = new KeyVaultConnectionStore('https://test.vault.azure.net');
  const expiry = Date.now() + 600000;
  await store.stage('unpredictable-ticket', credentials, expiry);
  const name = client.setSecret.mock.calls[0][0];
  expect(name).toMatch(/^docgen-reconnect-pending-[a-f0-9]{64}$/);
  expect(name).not.toContain(credentials.clientSecret);
  expect(client.setSecret).toHaveBeenCalledWith(name, expect.any(String), expect.objectContaining({ expiresOn: new Date(expiry) }));
  expect(await store.take('unpredictable-ticket')).toEqual(credentials);
  await expect(store.take('unpredictable-ticket')).rejects.toThrow('expired or is unavailable');
});

it('rejects expired staged credentials and never includes secret-bearing SDK errors', async () => {
  const store = new KeyVaultConnectionStore('https://test.vault.azure.net');
  await store.stage('ticket', credentials, Date.now() - 1);
  await expect(store.take('ticket')).rejects.toThrow('expired or is unavailable');
  client.setSecret.mockRejectedValueOnce(new Error('NEVER-LOG-SECRET'));
  await expect(store.stage('ticket2', credentials, Date.now() + 600000)).rejects.toThrow('one-time credential-storage setup');
});

it('persists one atomic credential pair and reloads it after a restart or on another replica', async () => {
  const first = new ConnectionManager({ ...config }, new KeyVaultConnectionStore('https://test.vault.azure.net'));
  await first.save(credentials, '00D000000000001AAA', '005000000000001AAA');
  expect(client.setSecret.mock.calls[0][0]).toBe(CONNECTION_SECRET);
  const restarted = new ConnectionManager({ ...config }, new KeyVaultConnectionStore('https://test.vault.azure.net'));
  await restarted.refresh();
  expect(restarted.config.sfClientId).toBe(credentials.clientId);
  expect(restarted.config.reconnectSfClientSecret).toBe(credentials.clientSecret);
  expect(restarted.config.sfDomain).toBe(config.sfDomain);
});

it('does not change runtime credentials when durable storage fails', async () => {
  const manager = new ConnectionManager({ ...config }, new KeyVaultConnectionStore('https://test.vault.azure.net'));
  client.setSecret.mockRejectedValueOnce(new Error('SECRET-BODY'));
  await expect(manager.save(credentials, '00D000000000001AAA', '005000000000001AAA')).rejects.toThrow('could not be saved');
  expect(manager.config.sfClientId).toBe(config.sfClientId);
});

it('rejects records targeting another Salesforce domain', async () => {
  values.set(CONNECTION_SECRET, JSON.stringify({ ...credentials, salesforceOrigin: 'https://other.my.salesforce.com',
    orgId: '00D000000000001AAA', adminUserId: '005000000000001AAA', updatedAt: new Date().toISOString() }));
  const manager = new ConnectionManager({ ...config }, new KeyVaultConnectionStore('https://test.vault.azure.net'));
  await expect(manager.refresh()).rejects.toThrow('different Salesforce domain');
  expect(manager.config.sfClientId).toBe(config.sfClientId);
});

it('keeps the last runtime configuration if Key Vault is temporarily unavailable', async () => {
  const manager = new ConnectionManager({ ...config }, new KeyVaultConnectionStore('https://test.vault.azure.net'));
  client.getSecret.mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await manager.credentialsForWorker()).toBe(config.sfClientId);
});

it('does not let a delayed old read undo a newly saved credential pair', async () => {
  let resolveOld!: (value: { value: string }) => void;
  client.getSecret.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const manager = new ConnectionManager({ ...config }, new KeyVaultConnectionStore('https://test.vault.azure.net'));
  const oldRead = manager.refresh();
  await manager.save(credentials, '00D000000000001AAA', '005000000000001AAA');
  resolveOld({ value: JSON.stringify({ ...credentials, clientId: 'old-client-id', clientSecret: 'old-secret',
    salesforceOrigin: 'https://acme--uat.sandbox.my.salesforce.com', orgId: '00D000000000001AAA',
    adminUserId: '005000000000001AAA', updatedAt: new Date().toISOString() }) });
  await oldRead;
  expect(manager.config.sfClientId).toBe(credentials.clientId);
  expect(manager.config.reconnectSfClientSecret).toBe(credentials.clientSecret);
});
