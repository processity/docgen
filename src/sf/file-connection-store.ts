import { createCipheriv, createDecipheriv, createHash, createPrivateKey, randomBytes, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, isAbsolute } from 'path';
import { ClientCredentials, ConnectionStore, ConnectionStorageError, SavedConnection, validClientCredentials } from './connection-store';

/** Encrypted records on a shared persistent mount. Never creates a missing mount root. */
export class FileConnectionStore implements ConnectionStore {
  private key: Buffer;
  constructor(private directory: string, privateKey: string, salesforceOrigin: string, private requireSmbMount = false) {
    if (!isAbsolute(directory) || !privateKey) throw new ConnectionStorageError('Configure a persistent connection-storage mount.');
    const material = createPrivateKey(privateKey).export({ type: 'pkcs8', format: 'der' });
    this.key = createHash('sha256').update('docgen-file-store-v1\0').update(salesforceOrigin).update('\0').update(material).digest();
  }
  private async root(): Promise<void> {
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid mount');
    if (this.requireSmbMount) {
      const type = (await fs.statfs(this.directory)).type;
      if (type !== 0xfe534d42 && type !== 0xff534d42) throw new Error('An SMB mount is required');
    }
  }
  private name(ticket: string): string { return `pending-${createHash('sha256').update(ticket).digest('hex')}.enc`; }
  private seal(name: string, value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`docgen-file-store-v1:${name}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
  }
  private async open(path: string, name: string): Promise<unknown> {
    const file = await fs.open(path, 'r');
    try {
      if ((await file.stat()).size > 16384) throw new Error('Oversized record');
      const envelope = JSON.parse(await file.readFile('utf8'));
      if (envelope.v !== 1) throw new Error('Unsupported record');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(`docgen-file-store-v1:${name}`));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
    } finally { await file.close(); }
  }
  private async write(name: string, value: unknown): Promise<void> {
    await this.root();
    const temporary = join(this.directory, `.tmp-${randomUUID()}`);
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try { await file.writeFile(this.seal(name, value), 'utf8'); await file.sync(); }
      finally { await file.close(); }
      // One rename publishes a complete pair. Readers never see a half-written record.
      await fs.rename(temporary, join(this.directory, name));
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  private async cleanExpired(): Promise<void> {
    const names = (await fs.readdir(this.directory)).filter(name => /^pending-[a-f0-9]{64}\.enc$|^\.(tmp|claim)-[a-f0-9-]+$/.test(name));
    for (const name of names.slice(0, 1000)) {
      const path = join(this.directory, name);
      try { if ((await fs.stat(path)).mtimeMs < Date.now() - 600000) await fs.unlink(path); } catch { /* Another replica can clean the same entry. */ }
    }
  }
  async stage(ticket: string, credentials: ClientCredentials, expires: number): Promise<void> {
    if (!validClientCredentials(credentials)) throw new ConnectionStorageError('Enter a valid consumer key and consumer secret.');
    try {
      await this.root(); await this.cleanExpired();
      await this.write(this.name(ticket), { ...credentials, expires });
    } catch { throw new ConnectionStorageError('The backend cannot write its shared connection-storage mount. Ask its owner to check the storage setup.'); }
  }
  async take(ticket: string): Promise<ClientCredentials> {
    const name = this.name(ticket);
    const claimed = join(this.directory, `.claim-${randomUUID()}`);
    try {
      await this.root();
      // Claim once across replicas before decrypting. A concurrent callback loses the rename.
      await fs.rename(join(this.directory, name), claimed);
      const entry = await this.open(claimed, name) as ClientCredentials & { expires: number };
      if (!validClientCredentials(entry) || !Number.isFinite(entry.expires) || entry.expires <= Date.now()) throw new Error('Expired');
      return { clientId: entry.clientId, clientSecret: entry.clientSecret };
    } catch { throw new ConnectionStorageError('This credential setup session expired or is unavailable. Start Connect / Reconnect again.'); }
    finally { await fs.unlink(claimed).catch(() => undefined); }
  }
  async discard(ticket: string): Promise<void> { await fs.unlink(join(this.directory, this.name(ticket))).catch(() => undefined); }
  async read(): Promise<SavedConnection | undefined> {
    try {
      await this.root();
      let value: unknown;
      try { value = await this.open(join(this.directory, 'active.enc'), 'active.enc'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      const entry = value as SavedConnection;
      if (!validClientCredentials(entry) || typeof entry.salesforceOrigin !== 'string'
        || !/^00D[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/.test(entry.orgId)
        || !/^005[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/.test(entry.adminUserId)
        || typeof entry.updatedAt !== 'string') throw new Error('Invalid record');
      return entry;
    } catch { throw new ConnectionStorageError('Saved connection settings could not be read from the shared storage mount.'); }
  }
  async save(connection: SavedConnection): Promise<void> {
    try { await this.write('active.enc', connection); }
    catch { throw new ConnectionStorageError('The verified credentials could not be saved to the shared storage mount.'); }
  }
}
