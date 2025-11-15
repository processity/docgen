import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Interface for secrets loaded from Azure Key Vault
 */
export interface KeyVaultSecrets {
  sfPrivateKey?: string;
  sfClientId?: string;
  sfUsername?: string;
  sfDomain?: string;
  sfdxAuthUrl?: string;
  azureMonitorConnectionString?: string;
}

/**
 * Secret names in Azure Key Vault (using hyphenated format per Azure conventions)
 */
const SECRET_NAMES = {
  SF_PRIVATE_KEY: 'SF-PRIVATE-KEY',
  SF_CLIENT_ID: 'SF-CLIENT-ID',
  SF_USERNAME: 'SF-USERNAME',
  SF_DOMAIN: 'SF-DOMAIN',
  SFDX_AUTH_URL: 'SFDX-AUTH-URL',
  AZURE_MONITOR_CONNECTION_STRING: 'AZURE-MONITOR-CONNECTION-STRING',
} as const;

/**
 * Load secrets from Azure Key Vault using DefaultAzureCredential
 *
 * This function supports:
 * - Managed Identity (Azure Container Apps, VMs, etc.)
 * - Azure CLI credentials (local development)
 * - Environment variables (CI/CD)
 *
 * Graceful degradation: Returns empty object on any error (Key Vault unavailable,
 * credential failure, invalid URI, etc.). Errors are logged for troubleshooting.
 *
 * @param keyVaultUri - The URI of the Azure Key Vault (e.g., https://my-kv.vault.azure.net/)
 * @returns Object containing loaded secrets (camelCase property names)
 *
 * @example
 * ```typescript
 * const secrets = await loadSecretsFromKeyVault('https://my-kv.vault.azure.net/');
 * if (secrets.sfPrivateKey) {
 *   // Use the secret
 * }
 * ```
 */
export async function loadSecretsFromKeyVault(keyVaultUri: string): Promise<KeyVaultSecrets> {
  const correlationId = `kv-load-${Date.now()}`;

  try {
    logger.info({ correlationId, keyVaultUri }, 'Loading secrets from Azure Key Vault');

    // Validate URI format
    if (!keyVaultUri || !keyVaultUri.startsWith('https://')) {
      logger.warn({ correlationId, keyVaultUri }, 'Invalid Key Vault URI format');
      return {};
    }

    // Create credential using DefaultAzureCredential
    // This supports multiple authentication methods in order:
    // 1. Environment variables (AZURE_CLIENT_ID, etc.)
    // 2. Managed Identity (Azure resources)
    // 3. Azure CLI (local development)
    // 4. Azure PowerShell
    const credential = new DefaultAzureCredential();

    // Create Secret Client
    const client = new SecretClient(keyVaultUri, credential);

    // Fetch all secrets in parallel for performance
    const secretPromises = Object.entries(SECRET_NAMES).map(async ([key, secretName]) => {
      try {
        const secret = await client.getSecret(secretName);
        return { key, value: secret.value };
      } catch (error) {
        logger.warn(
          { correlationId, secretName, error: error instanceof Error ? error.message : String(error) },
          'Failed to retrieve secret from Key Vault',
        );
        return { key, value: undefined };
      }
    });

    // Wait for all secrets to be fetched
    const secretResults = await Promise.all(secretPromises);

    // Build secrets object, filtering out undefined and empty values
    const secrets: KeyVaultSecrets = {};

    for (const { key, value } of secretResults) {
      if (value && value.trim() !== '') {
        switch (key) {
          case 'SF_PRIVATE_KEY':
            secrets.sfPrivateKey = value;
            break;
          case 'SF_CLIENT_ID':
            secrets.sfClientId = value;
            break;
          case 'SF_USERNAME':
            secrets.sfUsername = value;
            break;
          case 'SF_DOMAIN':
            secrets.sfDomain = value;
            break;
          case 'SFDX_AUTH_URL':
            secrets.sfdxAuthUrl = value;
            break;
          case 'AZURE_MONITOR_CONNECTION_STRING':
            secrets.azureMonitorConnectionString = value;
            break;
        }
      }
    }

    const loadedCount = Object.keys(secrets).length;
    logger.info({ correlationId, loadedCount, keyVaultUri }, 'Successfully loaded secrets from Key Vault');

    return secrets;
  } catch (error) {
    // Graceful degradation: Log error but don't throw
    // This allows the application to start with environment variables as fallback
    logger.error(
      {
        correlationId,
        keyVaultUri,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'Failed to load secrets from Azure Key Vault - falling back to environment variables',
    );

    return {};
  }
}

/**
 * Check connectivity to Azure Key Vault
 *
 * This function tests Key Vault connectivity by attempting to retrieve a single secret.
 * It's used by the /readyz health endpoint to determine if the application can access
 * required secrets.
 *
 * Graceful degradation: Returns false on any error (unreachable, credential failure, etc.)
 *
 * @param keyVaultUri - The URI of the Azure Key Vault
 * @returns true if Key Vault is accessible, false otherwise
 *
 * @example
 * ```typescript
 * const isHealthy = await checkKeyVaultConnectivity('https://my-kv.vault.azure.net/');
 * if (!isHealthy) {
 *   console.error('Key Vault is unreachable');
 * }
 * ```
 */
export async function checkKeyVaultConnectivity(keyVaultUri: string): Promise<boolean> {
  const correlationId = `kv-check-${Date.now()}`;

  try {
    // Validate URI format
    if (!keyVaultUri || !keyVaultUri.startsWith('https://')) {
      logger.debug({ correlationId, keyVaultUri }, 'Invalid Key Vault URI for connectivity check');
      return false;
    }

    // Create credential and client
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(keyVaultUri, credential);

    // Test connectivity by fetching one secret
    // We use SF-PRIVATE-KEY as it's required and should always exist in production
    await client.getSecret(SECRET_NAMES.SF_PRIVATE_KEY);

    logger.debug({ correlationId, keyVaultUri }, 'Key Vault connectivity check succeeded');
    return true;
  } catch (error) {
    // Connectivity check failed - log at debug level to avoid noise
    logger.debug(
      {
        correlationId,
        keyVaultUri,
        error: error instanceof Error ? error.message : String(error),
      },
      'Key Vault connectivity check failed',
    );

    return false;
  }
}
