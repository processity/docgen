import { loadConfig, validateConfig } from '../src/config';
import { AppConfig } from '../src/types';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load config with default values when env vars are not set', () => {
      delete process.env.PORT;
      delete process.env.NODE_ENV;
      delete process.env.LOG_LEVEL;
      delete process.env.SF_DOMAIN;
      delete process.env.AZURE_TENANT_ID;
      delete process.env.CLIENT_ID;
      delete process.env.KEY_VAULT_URI;
      delete process.env.IMAGE_ALLOWLIST;

      const config = loadConfig();

      expect(config.port).toBe(8080);
      expect(config.nodeEnv).toBe('development');
      expect(config.logLevel).toBe('info');
      expect(config.sfDomain).toBeUndefined();
      expect(config.azureTenantId).toBeUndefined();
      expect(config.clientId).toBeUndefined();
      expect(config.keyVaultUri).toBeUndefined();
      expect(config.imageAllowlist).toBeUndefined();
    });

    it('should load config with environment variables when set', () => {
      process.env.PORT = '3000';
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'debug';
      process.env.SF_DOMAIN = 'https://example.salesforce.com';
      process.env.AZURE_TENANT_ID = 'test-tenant-id';
      process.env.CLIENT_ID = 'test-client-id';
      process.env.KEY_VAULT_URI = 'https://keyvault.vault.azure.net/';

      const config = loadConfig();

      expect(config.port).toBe(3000);
      expect(config.nodeEnv).toBe('production');
      expect(config.logLevel).toBe('debug');
      expect(config.sfDomain).toBe('https://example.salesforce.com');
      expect(config.azureTenantId).toBe('test-tenant-id');
      expect(config.clientId).toBe('test-client-id');
      expect(config.keyVaultUri).toBe('https://keyvault.vault.azure.net/');
    });

    it('should parse PORT as integer', () => {
      process.env.PORT = '5000';
      const config = loadConfig();
      expect(config.port).toBe(5000);
      expect(typeof config.port).toBe('number');
    });

    it('should handle invalid PORT gracefully with NaN', () => {
      process.env.PORT = 'not-a-number';
      const config = loadConfig();
      expect(config.port).toBeNaN();
    });

    it('should parse IMAGE_ALLOWLIST as comma-separated array', () => {
      process.env.IMAGE_ALLOWLIST = 'cdn.example.com,images.company.com,assets.example.org';
      const config = loadConfig();
      expect(config.imageAllowlist).toEqual([
        'cdn.example.com',
        'images.company.com',
        'assets.example.org',
      ]);
    });

    it('should trim whitespace from IMAGE_ALLOWLIST entries', () => {
      process.env.IMAGE_ALLOWLIST = ' cdn.example.com , images.company.com ,  assets.example.org  ';
      const config = loadConfig();
      expect(config.imageAllowlist).toEqual([
        'cdn.example.com',
        'images.company.com',
        'assets.example.org',
      ]);
    });

    it('should handle empty IMAGE_ALLOWLIST', () => {
      process.env.IMAGE_ALLOWLIST = '';
      const config = loadConfig();
      expect(config.imageAllowlist).toEqual(['']);
    });

    it('should handle single-item IMAGE_ALLOWLIST without comma', () => {
      process.env.IMAGE_ALLOWLIST = 'cdn.example.com';
      const config = loadConfig();
      expect(config.imageAllowlist).toEqual(['cdn.example.com']);
    });

    it('should load conversion config with default values when env vars are not set', () => {
      delete process.env.CONVERSION_TIMEOUT;
      delete process.env.CONVERSION_WORKDIR;
      delete process.env.CONVERSION_MAX_CONCURRENT;

      const config = loadConfig();

      expect(config.conversionTimeout).toBe(60000);
      expect(config.conversionWorkdir).toBe('/tmp');
      expect(config.conversionMaxConcurrent).toBe(8);
    });

    it('should load conversion config with environment variables when set', () => {
      process.env.CONVERSION_TIMEOUT = '30000';
      process.env.CONVERSION_WORKDIR = '/custom/tmp';
      process.env.CONVERSION_MAX_CONCURRENT = '4';

      const config = loadConfig();

      expect(config.conversionTimeout).toBe(30000);
      expect(config.conversionWorkdir).toBe('/custom/tmp');
      expect(config.conversionMaxConcurrent).toBe(4);
    });

    it('should parse CONVERSION_TIMEOUT as integer', () => {
      process.env.CONVERSION_TIMEOUT = '45000';
      const config = loadConfig();
      expect(config.conversionTimeout).toBe(45000);
      expect(typeof config.conversionTimeout).toBe('number');
    });

    it('should parse CONVERSION_MAX_CONCURRENT as integer', () => {
      process.env.CONVERSION_MAX_CONCURRENT = '16';
      const config = loadConfig();
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
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should throw error for production with missing sfDomain', () => {
      const config: AppConfig = {
        port: 8080,
        nodeEnv: 'production',
        logLevel: 'info',
        azureTenantId: 'tenant-id',
        clientId: 'client-id',
        keyVaultUri: 'https://vault.azure.net/',
        conversionTimeout: 60000,
        conversionWorkdir: '/tmp',
        conversionMaxConcurrent: 8,
      };

      expect(() => validateConfig(config)).toThrow(
        'Missing required configuration in production: sfDomain'
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
      };

      expect(() => validateConfig(config)).toThrow(
        'Missing required configuration in production: sfDomain, azureTenantId, clientId, keyVaultUri, issuer, audience, jwksUri'
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
        // imageAllowlist is optional
      };

      expect(() => validateConfig(config)).not.toThrow();
    });
  });

  describe('loadConfig + validateConfig integration', () => {
    it('should load and validate production config successfully', () => {
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

      const config = loadConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should load and fail validation for production with missing config', () => {
      process.env.NODE_ENV = 'production';
      // Missing required fields

      const config = loadConfig();
      expect(() => validateConfig(config)).toThrow('Missing required configuration in production');
    });
  });
});
