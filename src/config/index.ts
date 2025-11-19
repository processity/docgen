import { AppConfig } from '../types';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadSecretsFromKeyVault } from './secrets';

/**
 * Load private key from environment or file
 */
function loadPrivateKey(): string | undefined {
  // First check if key is directly provided
  if (process.env.SF_PRIVATE_KEY) {
    return process.env.SF_PRIVATE_KEY;
  }

  // Then check if a path to the key file is provided
  if (process.env.SF_PRIVATE_KEY_PATH) {
    try {
      const keyPath = resolve(process.cwd(), process.env.SF_PRIVATE_KEY_PATH);
      return readFileSync(keyPath, 'utf8');
    } catch (error) {
      console.error(`Failed to load SF_PRIVATE_KEY from file: ${process.env.SF_PRIVATE_KEY_PATH}`, error);
    }
  }

  return undefined;
}

/**
 * Load configuration from environment variables and Azure Key Vault
 *
 * In production mode with KEY_VAULT_URI set, secrets are loaded from Azure Key Vault
 * and override environment variables. In development mode, only environment variables are used.
 *
 * This approach:
 * - Maintains backward compatibility for local development
 * - Provides secure secret management in production (Azure Container Apps)
 * - Supports graceful degradation if Key Vault is unavailable
 */
export async function loadConfig(): Promise<AppConfig> {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const keyVaultUri = process.env.KEY_VAULT_URI;

  // Load base configuration from environment variables
  const config: AppConfig = {
    port: parseInt(process.env.PORT || '8080', 10),
    nodeEnv,
    logLevel: process.env.LOG_LEVEL || 'info',
    sfDomain: process.env.SF_DOMAIN,
    azureTenantId: process.env.AZURE_TENANT_ID,
    clientId: process.env.CLIENT_ID,
    keyVaultUri,
    imageAllowlist: process.env.IMAGE_ALLOWLIST?.split(',').map((s) => s.trim()),
    // Azure AD JWT validation settings (T-08)
    issuer: process.env.ISSUER,
    audience: process.env.AUDIENCE,
    jwksUri: process.env.JWKS_URI,
    // Salesforce JWT Bearer Flow settings (T-09)
    sfUsername: process.env.SF_USERNAME,
    sfClientId: process.env.SF_CLIENT_ID,
    sfPrivateKey: loadPrivateKey(),
    // Salesforce SFDX Auth URL (alternative to JWT Bearer)
    sfdxAuthUrl: process.env.SFDX_AUTH_URL,
    // LibreOffice conversion settings (T-11)
    conversionTimeout: parseInt(
      process.env.CONVERSION_TIMEOUT || '60000',
      10
    ),
    conversionWorkdir: process.env.CONVERSION_WORKDIR || '/tmp',
    conversionMaxConcurrent: parseInt(
      process.env.CONVERSION_MAX_CONCURRENT || '8',
      10
    ),
    // Worker Poller settings (T-14)
    // Note: Poller is always-on (auto-starts with application)
    poller: {
      intervalMs: parseInt(process.env.POLLER_INTERVAL_MS || '15000', 10),
      idleIntervalMs: parseInt(process.env.POLLER_IDLE_INTERVAL_MS || '60000', 10),
      batchSize: parseInt(process.env.POLLER_BATCH_SIZE || '20', 10),
      lockTtlMs: parseInt(process.env.POLLER_LOCK_TTL_MS || '120000', 10),
      maxAttempts: parseInt(process.env.POLLER_MAX_ATTEMPTS || '3', 10),
    },
    // Azure Application Insights settings (T-15)
    azureMonitorConnectionString: process.env.AZURE_MONITOR_CONNECTION_STRING,
    enableTelemetry: process.env.ENABLE_TELEMETRY !== 'false', // Enabled by default, can be explicitly disabled
  };

  // In production mode with Key Vault configured, load secrets from Key Vault
  // Key Vault secrets override environment variables for enhanced security
  if (nodeEnv === 'production' && keyVaultUri) {
    const kvSecrets = await loadSecretsFromKeyVault(keyVaultUri);

    // Merge Key Vault secrets into config (KV takes precedence over env vars)
    if (kvSecrets.sfPrivateKey) {
      config.sfPrivateKey = kvSecrets.sfPrivateKey;
    }
    if (kvSecrets.sfClientId) {
      config.sfClientId = kvSecrets.sfClientId;
    }
    if (kvSecrets.sfUsername) {
      config.sfUsername = kvSecrets.sfUsername;
    }
    if (kvSecrets.sfDomain) {
      config.sfDomain = kvSecrets.sfDomain;
    }
    if (kvSecrets.azureMonitorConnectionString) {
      config.azureMonitorConnectionString = kvSecrets.azureMonitorConnectionString;
    }
    if (kvSecrets.sfdxAuthUrl) {
      config.sfdxAuthUrl = kvSecrets.sfdxAuthUrl;
    }
  }

  return config;
}

/**
 * Validate required configuration for production
 *
 * Note: Salesforce auth validation is handled in SalesforceAuth class.
 * Either JWT Bearer config or SFDX Auth URL is required, but not enforced here.
 */
export function validateConfig(config: AppConfig): void {
  if (config.nodeEnv === 'production') {
    const required = [
      'azureTenantId',
      'clientId',
      'keyVaultUri',
      'issuer',
      'audience',
      'jwksUri',
    ];
    const missing = required.filter((key) => !config[key as keyof AppConfig]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required configuration in production: ${missing.join(', ')}`
      );
    }

    // Validate that at least one Salesforce auth method is configured
    const hasJwtConfig = !!(config.sfDomain && config.sfUsername && config.sfClientId && config.sfPrivateKey);
    const hasSfdxConfig = !!config.sfdxAuthUrl;

    if (!hasJwtConfig && !hasSfdxConfig) {
      throw new Error(
        'Production requires Salesforce authentication: either JWT Bearer config (SF_DOMAIN, SF_USERNAME, SF_CLIENT_ID, SF_PRIVATE_KEY) or SFDX_AUTH_URL'
      );
    }
  }
}
