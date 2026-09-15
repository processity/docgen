import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { createHash } from 'crypto';

export interface ClientCredentials { clientId: string; clientSecret: string }
export interface SavedConnection extends ClientCredentials {
  salesforceOrigin: string;
  orgId: string;
  adminUserId: string;
  updatedAt: string;
}
export interface ConnectionStore {
  stage(ticket: string, credentials: ClientCredentials, expires: number): Promise<void>;
  take(ticket: string): Promise<ClientCredentials>;
  discard(ticket: string): Promise<void>;
  read(): Promise<SavedConnection | undefined>;
  save(connection: SavedConnection): Promise<void>;
}
export class ConnectionStorageError extends Error {}
export const CONNECTION_SECRET = 'DOCGEN-SALESFORCE-CONNECTION';

export function validClientCredentials(value: unknown): value is ClientCredentials {
  const data = value as ClientCredentials | undefined;
  return !!data && typeof data.clientId === 'string' && /^[a-zA-Z0-9._-]{8,256}$/.test(data.clientId)
    && typeof data.clientSecret === 'string' && data.clientSecret.length > 0 && data.clientSecret.length <= 512;
}

/** Secret values never appear in names, logs, URLs, exceptions or deployment outputs. */
export class KeyVaultConnectionStore implements ConnectionStore {
  private client: SecretClient;
  constructor(vaultUri: string) { this.client = new SecretClient(vaultUri, new DefaultAzureCredential()); }
  private pendingName(ticket: string): string {
    return `docgen-reconnect-pending-${createHash('sha256').update(ticket).digest('hex')}`;
  }
  async stage(ticket: string, credentials: ClientCredentials, expires: number): Promise<void> {
    if (!validClientCredentials(credentials)) throw new ConnectionStorageError('Enter a valid consumer key and consumer secret.');
    try {
      await this.client.setSecret(this.pendingName(ticket), JSON.stringify({ ...credentials, expires }),
        { expiresOn: new Date(expires), tags: { purpose: 'docgen-reconnect-pending' } });
    } catch {
      throw new ConnectionStorageError('The backend cannot store connection settings. Its owner must finish the one-time credential-storage setup.');
    }
  }
  async take(ticket: string): Promise<ClientCredentials> {
    try {
      const entry = JSON.parse((await this.client.getSecret(this.pendingName(ticket))).value || 'null') as ClientCredentials & { expires: number };
      if (!validClientCredentials(entry) || !Number.isFinite(entry.expires) || entry.expires <= Date.now()) throw new Error();
      // Delete before returning. Concurrent callbacks are additionally protected by the
      // Salesforce authorization code being single-use. Abandoned entries expire in ten minutes.
      await this.client.beginDeleteSecret(this.pendingName(ticket));
      return { clientId: entry.clientId, clientSecret: entry.clientSecret };
    } catch { throw new ConnectionStorageError('This credential setup session expired or is unavailable. Start Connect / Reconnect again.'); }
  }
  async discard(ticket: string): Promise<void> {
    try { await this.client.beginDeleteSecret(this.pendingName(ticket)); } catch { /* Expiry still prevents use. */ }
  }
  async read(): Promise<SavedConnection | undefined> {
    try {
      const entry = JSON.parse((await this.client.getSecret(CONNECTION_SECRET)).value || 'null') as SavedConnection;
      if (!validClientCredentials(entry) || typeof entry.salesforceOrigin !== 'string'
        || !/^00D[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/.test(entry.orgId)
        || !/^005[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/.test(entry.adminUserId)
        || typeof entry.updatedAt !== 'string') throw new Error();
      return entry as SavedConnection;
    } catch (error) {
      if ((error as { statusCode?: number } | null)?.statusCode === 404) return undefined;
      throw new ConnectionStorageError('Saved connection settings could not be read.');
    }
  }
  async save(connection: SavedConnection): Promise<void> {
    try { await this.client.setSecret(CONNECTION_SECRET, JSON.stringify(connection)); }
    catch { throw new ConnectionStorageError('The verified credentials could not be saved. Ask the backend owner to check credential-storage access.'); }
  }
}
