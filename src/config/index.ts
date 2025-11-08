import { AppConfig } from '../types';

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
    sfPrivateKey: process.env.SF_PRIVATE_KEY,
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
