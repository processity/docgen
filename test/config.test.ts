import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals';
import { loadConfig, validateConfig } from '../src/config';
import { AppConfig } from '../src/types';

// Mock the secrets module
jest.mock('../src/config/secrets');

import { loadSecretsFromKeyVault } from '../src/config/secrets';

describe('Config', () => {
  const originalEnv = process.env;
  const mockLoadSecretsFromKeyVault = loadSecretsFromKeyVault as jest.MockedFunction<
    typeof loadSecretsFromKeyVault
  >;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    // Reset mocks
    jest.clearAllMocks();
    // Default mock returns empty object (no secrets loaded)
    mockLoadSecretsFromKeyVault.mockResolvedValue({});
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load config with default values when env vars are not set', async () => {
      delete process.env.PORT;
      delete process.env.NODE_ENV;
      delete process.env.LOG_LEVEL;
      delete process.env.SF_DOMAIN;
      delete process.env.AZURE_TENANT_ID;
      delete process.env.CLIENT_ID;
      delete process.env.KEY_VAULT_URI;
      delete process.env.IMAGE_ALLOWLIST;

      const config = await loadConfig();

      expect(config.port).toBe(8080);
      expect(config.nodeEnv).toBe('development');
      expect(config.logLevel).toBe('info');
      expect(config.sfDomain).toBeUndefined();
      expect(config.azureTenantId).toBeUndefined();
      expect(config.clientId).toBeUndefined();
      expect(config.keyVaultUri).toBeUndefined();
      expect(config.imageAllowlist).toBeUndefined();
    });

    it('should load config with environment variables when set', async () => {
      process.env.PORT = '3000';
      process.env.NODE_ENV = 'development'; // Changed to development to avoid KV loading
      process.env.LOG_LEVEL = 'debug';
      process.env.SF_DOMAIN = 'https://example.salesforce.com';
      process.env.AZURE_TENANT_ID = 'test-tenant-id';
      process.env.CLIENT_ID = 'test-client-id';
      process.env.KEY_VAULT_URI = 'https://keyvault.vault.azure.net/';

      const config = await loadConfig();

      expect(config.port).toBe(3000);
      expect(config.nodeEnv).toBe('development');
      expect(config.logLevel).toBe('debug');
      expect(config.sfDomain).toBe('https://example.salesforce.com');
      expect(config.azureTenantId).toBe('test-tenant-id');
      expect(config.clientId).toBe('test-client-id');
      expect(config.keyVaultUri).toBe('https://keyvault.vault.azure.net/');
    });

    it('should parse PORT as integer', async () => {
      process.env.PORT = '5000';
      const config = await loadConfig();
      expect(config.port).toBe(5000);
      expect(typeof config.port).toBe('number');
    });

    it('should handle invalid PORT gracefully with NaN', async () => {
      process.env.PORT = 'not-a-number';
      const config = await loadConfig();
      expect(config.port).toBeNaN();
    });

    it('should parse IMAGE_ALLOWLIST as comma-separated array', async () => {
      process.env.IMAGE_ALLOWLIST = 'cdn.example.com,images.company.com,assets.example.org';
      const config = await loadConfig();
      expect(config.imageAllowlist).toEqual([
        'cdn.example.com',
        'images.company.com',
        'assets.example.org',
      ]);
    });

    it('should trim whitespace from IMAGE_ALLOWLIST entries', async () => {
      process.env.IMAGE_ALLOWLIST = ' cdn.example.com , images.company.com ,  assets.example.org  ';
      const config = await loadConfig();
      expect(config.imageAllowlist).toEqual([
        'cdn.example.com',
        'images.company.com',
        'assets.example.org',
      ]);
    });

    it('should handle empty IMAGE_ALLOWLIST', async () => {
      process.env.IMAGE_ALLOWLIST = '';
      const config = await loadConfig();
      expect(config.imageAllowlist).toEqual(['']);
    });

    it('should handle single-item IMAGE_ALLOWLIST without comma', async () => {
      process.env.IMAGE_ALLOWLIST = 'cdn.example.com';
      const config = await loadConfig();
      expect(config.imageAllowlist).toEqual(['cdn.example.com']);
    });

    it('should load conversion config with default values when env vars are not set', async () => {
      delete process.env.CONVERSION_TIMEOUT;
      delete process.env.CONVERSION_WORKDIR;
      delete process.env.CONVERSION_MAX_CONCURRENT;

      const config = await loadConfig();

      expect(config.conversionTimeout).toBe(60000);
      expect(config.conversionWorkdir).toBe('/tmp');
      expect(config.conversionMaxConcurrent).toBe(8);
    });

    it('should load conversion config with environment variables when set', async () => {
      process.env.CONVERSION_TIMEOUT = '30000';
      process.env.CONVERSION_WORKDIR = '/custom/tmp';
      process.env.CONVERSION_MAX_CONCURRENT = '4';

      const config = await loadConfig();

      expect(config.conversionTimeout).toBe(30000);
      expect(config.conversionWorkdir).toBe('/custom/tmp');
      expect(config.conversionMaxConcurrent).toBe(4);
    });

    it('should parse CONVERSION_TIMEOUT as integer', async () => {
      process.env.CONVERSION_TIMEOUT = '45000';
      const config = await loadConfig();
      expect(config.conversionTimeout).toBe(45000);
      expect(typeof config.conversionTimeout).toBe('number');
    });

    it('should parse CONVERSION_MAX_CONCURRENT as integer', async () => {
      process.env.CONVERSION_MAX_CONCURRENT = '16';
      const config = await loadConfig();
      expect(config.conversionMaxConcurrent).toBe(16);
      expect(typeof config.conversionMaxConcurrent).toBe('number');
    });
  });

  describe('validateConfig', () => {
    it('should not throw error for development environment with missing config', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'development',
        logLevel: 'info',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should not throw error for test environment with missing config', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'test',
        logLevel: 'info',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should throw error for production with missing Salesforce auth (no JWT or SFDX Auth URL)', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        azureTenantId: 'tenant-id',
        clientId: 'client-id',
        keyVaultUri: 'https://vault.azure.net/',
        issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
        audience: 'api://client-id',
        jwksUri: 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).toThrow(
        /requires Salesforce authentication.*JWT Bearer.*SFDX_AUTH_URL/i
      );
    });

    it('should throw error for production with missing azureTenantId', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        sfDomain: 'https://example.salesforce.com',
        clientId: 'client-id',
        keyVaultUri: 'https://vault.azure.net/',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).toThrow(
        'Missing required configuration in production: azureTenantId'
      );
    });

    it('should throw error for production with missing clientId', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        sfDomain: 'https://example.salesforce.com',
        azureTenantId: 'tenant-id',
        keyVaultUri: 'https://vault.azure.net/',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).toThrow(
        'Missing required configuration in production: clientId'
      );
    });

    it('should throw error for production with missing keyVaultUri', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        sfDomain: 'https://example.salesforce.com',
        azureTenantId: 'tenant-id',
        clientId: 'client-id',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).toThrow(
        'Missing required configuration in production: keyVaultUri'
      );
    });

    it('should throw error for production with multiple missing required fields', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).toThrow(
        'Missing required configuration in production: azureTenantId, clientId, keyVaultUri, issuer, audience, jwksUri'
      );
    });

    it('should not throw error for production with all required fields present', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        sfDomain: 'https://example.salesforce.com',
        azureTenantId: 'tenant-id',
        clientId: 'client-id',
        keyVaultUri: 'https://vault.azure.net/',
        issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
        audience: 'api://client-id',
        jwksUri: 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys',
        sfUsername: 'integration@example.com',
        sfClientId: 'sf-client-id',
        sfPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should not require imageAllowlist in production', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        sfDomain: 'https://example.salesforce.com',
        azureTenantId: 'tenant-id',
        clientId: 'client-id',
        keyVaultUri: 'https://vault.azure.net/',
        issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
        audience: 'api://client-id',
        jwksUri: 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys',
        sfUsername: 'integration@example.com',
        sfClientId: 'sf-client-id',
        sfPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
        // imageAllowlist is optional
      };

      expect(() => validateConfig(config)).not.toThrow();
    });
  });

  describe('loadConfig + validateConfig integration', () => {
    it('should load and validate production config successfully', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SF_DOMAIN = 'https://example.salesforce.com';
      process.env.AZURE_TENANT_ID = 'tenant-id';
      process.env.CLIENT_ID = 'client-id';
      process.env.KEY_VAULT_URI = 'https://vault.azure.net/';
      process.env.ISSUER = 'https://login.microsoftonline.com/tenant-id/v2.0';
      process.env.AUDIENCE = 'api://client-id';
      process.env.JWKS_URI = 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys';
      process.env.SF_USERNAME = 'integration@example.com';
      process.env.SF_CLIENT_ID = 'sf-client-id';
      process.env.SF_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

      // Mock Key Vault to return empty (use env vars)
      mockLoadSecretsFromKeyVault.mockResolvedValue({});

      const config = await loadConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should load and fail validation for production with missing config', async () => {
      process.env.NODE_ENV = 'production';
      // Missing required fields

      const config = await loadConfig();
      expect(() => validateConfig(config)).toThrow('Missing required configuration in production');
    });
  });

  describe('Key Vault Integration', () => {
    it('should load secrets from Key Vault in production mode', async () => {
      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';

      // Mock Key Vault returning secrets
      mockLoadSecretsFromKeyVault.mockResolvedValue({
        sfPrivateKey: 'kv-private-key',
        sfClientId: 'kv-client-id',
        sfUsername: 'kv-user@example.com',
        sfDomain: 'kv.salesforce.com',
        azureMonitorConnectionString: 'kv-connection-string',
      });

      const config = await loadConfig();

      expect(mockLoadSecretsFromKeyVault).toHaveBeenCalledWith('https://test-kv.vault.azure.net/');
      expect(config.sfPrivateKey).toBe('kv-private-key');
      expect(config.sfClientId).toBe('kv-client-id');
      expect(config.sfUsername).toBe('kv-user@example.com');
      expect(config.sfDomain).toBe('kv.salesforce.com');
      expect(config.azureMonitorConnectionString).toBe('kv-connection-string');
    });

    it('should not load from Key Vault in development mode', async () => {
      process.env.NODE_ENV = 'development';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';
      process.env.SF_PRIVATE_KEY = 'env-private-key';

      const config = await loadConfig();

      expect(mockLoadSecretsFromKeyVault).not.toHaveBeenCalled();
      expect(config.sfPrivateKey).toBe('env-private-key');
    });

    it('should not load from Key Vault when KEY_VAULT_URI not set', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.KEY_VAULT_URI;
      process.env.SF_PRIVATE_KEY = 'env-private-key';

      const config = await loadConfig();

      expect(mockLoadSecretsFromKeyVault).not.toHaveBeenCalled();
      expect(config.sfPrivateKey).toBe('env-private-key');
    });

    it('should override environment variables with Key Vault secrets', async () => {
      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';
      process.env.SF_PRIVATE_KEY = 'env-private-key';
      process.env.SF_CLIENT_ID = 'env-client-id';

      // Mock Key Vault returning different values
      mockLoadSecretsFromKeyVault.mockResolvedValue({
        sfPrivateKey: 'kv-private-key',
        sfClientId: 'kv-client-id',
      });

      const config = await loadConfig();

      // Key Vault should override env vars
      expect(config.sfPrivateKey).toBe('kv-private-key');
      expect(config.sfClientId).toBe('kv-client-id');
    });

    it('should fallback to environment variables when Key Vault returns empty', async () => {
      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';
      process.env.SF_PRIVATE_KEY = 'env-private-key';
      process.env.SF_CLIENT_ID = 'env-client-id';

      // Mock Key Vault returning empty object (graceful degradation)
      mockLoadSecretsFromKeyVault.mockResolvedValue({});

      const config = await loadConfig();

      // Should use env vars as fallback
      expect(config.sfPrivateKey).toBe('env-private-key');
      expect(config.sfClientId).toBe('env-client-id');
    });

    it('should partially override with Key Vault secrets', async () => {
      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';
      process.env.SF_PRIVATE_KEY = 'env-private-key';
      process.env.SF_CLIENT_ID = 'env-client-id';
      process.env.SF_USERNAME = 'env-user@example.com';

      // Mock Key Vault returning only some secrets
      mockLoadSecretsFromKeyVault.mockResolvedValue({
        sfPrivateKey: 'kv-private-key',
        // sfClientId not in KV, will use env var
        sfUsername: 'kv-user@example.com',
      });

      const config = await loadConfig();

      // KV secrets override where available
      expect(config.sfPrivateKey).toBe('kv-private-key');
      expect(config.sfUsername).toBe('kv-user@example.com');
      // Env var used where KV doesn't have it
      expect(config.sfClientId).toBe('env-client-id');
    });
  });

  describe('SFDX Auth URL Configuration', () => {
    it('should load sfdxAuthUrl from environment variable', async () => {
      process.env.SFDX_AUTH_URL = 'force://PlatformCLI::refresh-token@test.salesforce.com';

      const config = await loadConfig();

      expect(config.sfdxAuthUrl).toBe('force://PlatformCLI::refresh-token@test.salesforce.com');
    });

    it('should load SFDX_AUTH_URL from Key Vault in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';

      mockLoadSecretsFromKeyVault.mockResolvedValue({
        sfdxAuthUrl: 'force://PlatformCLI::kv-refresh-token@kv.salesforce.com',
      });

      const config = await loadConfig();

      expect(config.sfdxAuthUrl).toBe('force://PlatformCLI::kv-refresh-token@kv.salesforce.com');
    });

    it('should override environment SFDX_AUTH_URL with Key Vault value', async () => {
      process.env.NODE_ENV = 'production';
      process.env.KEY_VAULT_URI = 'https://test-kv.vault.azure.net/';
      process.env.SFDX_AUTH_URL = 'force://PlatformCLI::env-token@env.salesforce.com';

      mockLoadSecretsFromKeyVault.mockResolvedValue({
        sfdxAuthUrl: 'force://PlatformCLI::kv-token@kv.salesforce.com',
      });

      const config = await loadConfig();

      expect(config.sfdxAuthUrl).toBe('force://PlatformCLI::kv-token@kv.salesforce.com');
    });

    it('should accept production config with SFDX Auth URL only (no JWT config)', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        azureTenantId: 'tenant-id',
        clientId: 'client-id',
        keyVaultUri: 'https://vault.azure.net/',
        issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
        audience: 'api://client-id',
        jwksUri: 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys',
        sfdxAuthUrl: 'force://PlatformCLI::refresh-token@test.salesforce.com',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should accept production config with both JWT and SFDX Auth URL', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        sfDomain: 'https://example.salesforce.com',
        sfUsername: 'integration@example.com',
        sfClientId: 'sf-client-id',
        sfPrivateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        sfdxAuthUrl: 'force://PlatformCLI::refresh-token@test.salesforce.com',
        azureTenantId: 'tenant-id',
        clientId: 'client-id',
        keyVaultUri: 'https://vault.azure.net/',
        issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
        audience: 'api://client-id',
        jwksUri: 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
        poller: {
          intervalMs: 15000,
          idleIntervalMs: 60000,
          batchSize: 20,
          lockTtlMs: 120000,
          maxAttempts: 3,
        },
        enableTelemetry: true,
      };

      // Should not throw - validates that either auth method is acceptable
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should load and validate production config with SFDX Auth URL from env', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SFDX_AUTH_URL = 'force://PlatformCLI::token@test.salesforce.com';
      process.env.AZURE_TENANT_ID = 'tenant-id';
      process.env.CLIENT_ID = 'client-id';
      process.env.KEY_VAULT_URI = 'https://vault.azure.net/';
      process.env.ISSUER = 'https://login.microsoftonline.com/tenant-id/v2.0';
      process.env.AUDIENCE = 'api://client-id';
      process.env.JWKS_URI = 'https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys';

      mockLoadSecretsFromKeyVault.mockResolvedValue({});

      const config = await loadConfig();
      expect(() => validateConfig(config)).not.toThrow();
      expect(config.sfdxAuthUrl).toBe('force://PlatformCLI::token@test.salesforce.com');
    });
  });
});
