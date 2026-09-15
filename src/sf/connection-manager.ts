import { AppConfig } from '../types';
import { createSalesforceAuth, getSalesforceAuth } from './auth';
import { ClientCredentials, ConnectionStore, SavedConnection } from './connection-store';

/** One atomic credential pair per backend; replicas refresh it without an Azure restart. */
export class ConnectionManager {
  private nextRead = 0;
  private reading?: Promise<void>;
  private saving?: Promise<void>;
  private generation = 0;
  constructor(readonly config: AppConfig, readonly store: ConnectionStore) {}
  private origin(): string { return new URL(this.config.sfDomain!.startsWith('https://') ? this.config.sfDomain! : `https://${this.config.sfDomain}`).origin; }
  private apply(connection: SavedConnection): void {
    if (connection.salesforceOrigin !== this.origin()) throw new Error('Saved credentials target a different Salesforce domain.');
    this.config.sfClientId = connection.clientId;
    this.config.reconnectSfClientSecret = connection.clientSecret;
    const auth = getSalesforceAuth() || createSalesforceAuth({ sfClientId: connection.clientId,
      sfDomain: this.config.sfDomain, sfUsername: this.config.sfUsername, sfPrivateKey: this.config.sfPrivateKey,
      refreshClientId: () => this.credentialsForWorker() });
    auth.updateClientId(connection.clientId);
  }
  async refresh(force = false): Promise<void> {
    if (force && this.saving) await this.saving.catch(() => undefined);
    if (this.reading) {
      if (!force) return this.reading;
      // A return check must not reuse a read that started before credentials changed.
      try { await this.reading; } catch { /* Try a fresh read below. */ }
      return this.refresh(true);
    }
    if (!force && Date.now() < this.nextRead) return;
    this.nextRead = Date.now() + 30000;
    const generation = this.generation;
    this.reading = (async () => {
      const connection = await this.store.read();
      if (connection && generation === this.generation) this.apply(connection);
    })();
    try { await this.reading; } finally { this.reading = undefined; }
  }
  async credentialsForWorker(): Promise<string | undefined> {
    // A storage outage must not discard the last known configuration or expose SDK errors.
    try { await this.refresh(); } catch { /* Existing credentials remain usable. */ }
    return this.config.sfClientId;
  }
  async save(credentials: ClientCredentials, orgId: string, adminUserId: string): Promise<void> {
    const connection: SavedConnection = { ...credentials, orgId, adminUserId,
      salesforceOrigin: this.origin(), updatedAt: new Date().toISOString() };
    const saving = (this.saving || Promise.resolve()).catch(() => undefined).then(async () => {
      this.generation++;
      await this.store.save(connection);
      this.apply(connection);
      this.nextRead = Date.now() + 30000;
    });
    this.saving = saving;
    try { await saving; } finally { if (this.saving === saving) this.saving = undefined; }
  }
}
