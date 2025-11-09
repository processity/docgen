import { AppConfig } from '../types';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
 * Load configuration from environment variables
 */
export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT || '8080', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    sfDomain: process.env.SF_DOMAIN,
    azureTenantId: process.env.AZURE_TENANT_ID,
    clientId: process.env.CLIENT_ID,
    keyVaultUri: process.env.KEY_VAULT_URI,
    imageAllowlist: process.env.IMAGE_ALLOWLIST?.split(',').map((s) => s.trim()),
    // Azure AD JWT validation settings (T-08)
    issuer: process.env.ISSUER,
    audience: process.env.AUDIENCE,
    jwksUri: process.env.JWKS_URI,
    // Salesforce JWT Bearer Flow settings (T-09)
    sfUsername: process.env.SF_USERNAME,
    sfClientId: process.env.SF_CLIENT_ID,
    sfPrivateKey: loadPrivateKey(),
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
  };
}

/**
 * Validate required configuration for production
 */
export function validateConfig(config: AppConfig): void {
  if (config.nodeEnv === 'production') {
    const required = [
      'sfDomain',
      'azureTenantId',
      'clientId',
      'keyVaultUri',
      'issuer',
      'audience',
      'jwksUri',
      'sfUsername',
      'sfClientId',
      'sfPrivateKey',
    ];
    const missing = required.filter((key) => !config[key as keyof AppConfig]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required configuration in production: ${missing.join(', ')}`
      );
    }
  }
}
