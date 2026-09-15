import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateKeyPairSync, createPrivateKey } from 'crypto';
import { FileConnectionStore } from '../src/sf/file-connection-store';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const origin = 'https://acme--uat.sandbox.my.salesforce.com';
const credentials = { clientId: 'new-client-id', clientSecret: 'SECRET-MUST-BE-ENCRYPTED' };
const connection = { ...credentials, salesforceOrigin: origin, orgId: '00D000000000001AAA', adminUserId: '005000000000001AAA', updatedAt: new Date().toISOString() };
let folder: string;
beforeEach(async () => { folder = await fs.mkdtemp(join(tmpdir(), 'docgen-file-store-test-')); });
afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });

it('persists an encrypted pair that a restarted replica can read', async () => {
  const store = new FileConnectionStore(folder, key, origin);
  await store.save(connection);
  const raw = await fs.readFile(join(folder, 'active.enc'), 'utf8');
  expect(raw).not.toContain(credentials.clientSecret);
  expect(raw).not.toContain(credentials.clientId);
  expect(await new FileConnectionStore(folder, key, origin).read()).toEqual(connection);
});
it('canonicalizes equivalent private-key encodings', async () => {
  await new FileConnectionStore(folder, key, origin).save(connection);
  const pkcs1 = createPrivateKey(key).export({ type: 'pkcs1', format: 'pem' }).toString();
  expect(await new FileConnectionStore(folder, pkcs1, origin).read()).toEqual(connection);
});
it('rejects tampering and a different backend identity', async () => {
  const store = new FileConnectionStore(folder, key, origin);
  await store.save(connection);
  await expect(new FileConnectionStore(folder, key, 'https://other.my.salesforce.com').read()).rejects.toThrow('could not be read');
  const path = join(folder, 'active.enc');
  const envelope = JSON.parse(await fs.readFile(path, 'utf8'));
  envelope.data = Buffer.from('tampered').toString('base64');
  await fs.writeFile(path, JSON.stringify(envelope));
  await expect(store.read()).rejects.toThrow('could not be read');
});
it('allows exactly one replica to consume a pending session', async () => {
  const one = new FileConnectionStore(folder, key, origin);
  const two = new FileConnectionStore(folder, key, origin);
  await one.stage('ticket', credentials, Date.now() + 600000);
  const results = await Promise.allSettled([one.take('ticket'), two.take('ticket')]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect(await fs.readdir(folder)).toEqual([]);
});
it('rejects expired sessions and cannot substitute a pending record for active settings', async () => {
  const store = new FileConnectionStore(folder, key, origin);
  await store.stage('expired', credentials, Date.now() - 1);
  await expect(store.take('expired')).rejects.toThrow('expired');
  await store.stage('ticket', credentials, Date.now() + 600000);
  const file = (await fs.readdir(folder))[0];
  await fs.copyFile(join(folder, file), join(folder, 'active.enc'));
  await expect(store.read()).rejects.toThrow('could not be read');
});
it('does not silently create an ephemeral replacement for a missing mount', async () => {
  const missing = join(folder, 'not-mounted');
  const store = new FileConnectionStore(missing, key, origin);
  await expect(store.save(connection)).rejects.toThrow('could not be saved');
  await expect(fs.stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects an existing ephemeral directory when the backend requires SMB storage', async () => {
  const store = new FileConnectionStore(folder, key, origin, true);
  await expect(store.save(connection)).rejects.toThrow('could not be saved');
  expect(await fs.readdir(folder)).toEqual([]);
});
it('publishes complete pairs under concurrent saves', async () => {
  const one = new FileConnectionStore(folder, key, origin);
  const two = new FileConnectionStore(folder, key, origin);
  const second = { ...connection, clientId: 'second-client-id', clientSecret: 'second-secret' };
  await Promise.all([one.save(connection), two.save(second)]);
  expect([connection, second]).toContainEqual(await one.read());
  expect(await fs.readdir(folder)).toEqual(['active.enc']);
});
