import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock the Azure SDK before importing the module
jest.mock('@azure/identity');
jest.mock('@azure/keyvault-secrets');

import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import {
  loadSecretsFromKeyVault,
  checkKeyVaultConnectivity,
} from '../src/config/secrets';

describe('Key Vault Secrets Loader', () => {
  const mockKeyVaultUri = 'https://test-kv.vault.azure.net/';
  let mockSecretClient: jest.Mocked<SecretClient>;
  let mockCredential: jest.Mocked<DefaultAzureCredential>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock DefaultAzureCredential
    mockCredential = {} as jest.Mocked<DefaultAzureCredential>;
    (DefaultAzureCredential as jest.MockedClass<typeof DefaultAzureCredential>).mockImplementation(
      () => mockCredential,
    );

    // Mock SecretClient
    mockSecretClient = {
      getSecret: jest.fn(),
    } as unknown as jest.Mocked<SecretClient>;
    (SecretClient as jest.MockedClass<typeof SecretClient>).mockImplementation(() => mockSecretClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('loadSecretsFromKeyVault', () => {
    it('should successfully load configured secrets from Key Vault', async () => {
      // Mock secret responses
      mockSecretClient.getSecret
        .mockResolvedValueOnce({
          value: 'test-private-key',
          name: 'SF-PRIVATE-KEY',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'test-client-id',
          name: 'SF-CLIENT-ID',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'test@example.com',
          name: 'SF-USERNAME',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'test.salesforce.com',
          name: 'SF-DOMAIN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SFDX-AUTH-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'scratch-access-token',
          name: 'SF-ACCESS-TOKEN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'https://scratch.example.my.salesforce.com',
          name: 'SF-INSTANCE-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'InstrumentationKey=test-key',
          name: 'AZURE-MONITOR-CONNECTION-STRING',
          properties: {},
        } as any);

      const secrets = await loadSecretsFromKeyVault(mockKeyVaultUri);

      expect(secrets).toEqual({
        sfPrivateKey: 'test-private-key',
        sfClientId: 'test-client-id',
        sfUsername: 'test@example.com',
        sfDomain: 'test.salesforce.com',
        sfAccessToken: 'scratch-access-token',
        sfInstanceUrl: 'https://scratch.example.my.salesforce.com',
        azureMonitorConnectionString: 'InstrumentationKey=test-key',
      });

      expect(mockSecretClient.getSecret).toHaveBeenCalledTimes(8);
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SF-PRIVATE-KEY');
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SF-CLIENT-ID');
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SF-USERNAME');
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SF-DOMAIN');
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SFDX-AUTH-URL');
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SF-ACCESS-TOKEN');
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SF-INSTANCE-URL');
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('AZURE-MONITOR-CONNECTION-STRING');
    });

    it('should handle undefined secret values gracefully', async () => {
      // Mock some secrets with undefined values
      mockSecretClient.getSecret
        .mockResolvedValueOnce({
          value: 'test-private-key',
          name: 'SF-PRIVATE-KEY',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SF-CLIENT-ID',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'test@example.com',
          name: 'SF-USERNAME',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SF-DOMAIN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SFDX-AUTH-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SF-ACCESS-TOKEN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SF-INSTANCE-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'InstrumentationKey=test-key',
          name: 'AZURE-MONITOR-CONNECTION-STRING',
          properties: {},
        } as any);

      const secrets = await loadSecretsFromKeyVault(mockKeyVaultUri);

      // Should only include secrets with values
      expect(secrets).toEqual({
        sfPrivateKey: 'test-private-key',
        sfUsername: 'test@example.com',
        azureMonitorConnectionString: 'InstrumentationKey=test-key',
      });
    });

    it('should return empty object when Key Vault is unavailable', async () => {
      // Mock Key Vault connection error
      mockSecretClient.getSecret.mockRejectedValue(new Error('Key Vault unavailable'));

      const secrets = await loadSecretsFromKeyVault(mockKeyVaultUri);

      expect(secrets).toEqual({});
    });

    it('should return empty object when DefaultAzureCredential fails', async () => {
      // Mock credential error
      (DefaultAzureCredential as jest.MockedClass<typeof DefaultAzureCredential>).mockImplementation(() => {
        throw new Error('Credential acquisition failed');
      });

      const secrets = await loadSecretsFromKeyVault(mockKeyVaultUri);

      expect(secrets).toEqual({});
    });

    it('should return empty object for invalid Key Vault URI', async () => {
      const invalidUri = 'not-a-valid-uri';

      const secrets = await loadSecretsFromKeyVault(invalidUri);

      expect(secrets).toEqual({});
    });

    it('should handle partial secret retrieval failures', async () => {
      // Mock first two secrets succeed, third fails, rest succeed
      mockSecretClient.getSecret
        .mockResolvedValueOnce({
          value: 'test-private-key',
          name: 'SF-PRIVATE-KEY',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'test-client-id',
          name: 'SF-CLIENT-ID',
          properties: {},
        } as any)
        .mockRejectedValueOnce(new Error('Secret not found'))
        .mockResolvedValueOnce({
          value: 'test.salesforce.com',
          name: 'SF-DOMAIN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SFDX-AUTH-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SF-ACCESS-TOKEN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: undefined,
          name: 'SF-INSTANCE-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'InstrumentationKey=test-key',
          name: 'AZURE-MONITOR-CONNECTION-STRING',
          properties: {},
        } as any);

      const secrets = await loadSecretsFromKeyVault(mockKeyVaultUri);

      // Should return successfully retrieved secrets
      expect(secrets).toEqual({
        sfPrivateKey: 'test-private-key',
        sfClientId: 'test-client-id',
        sfDomain: 'test.salesforce.com',
        azureMonitorConnectionString: 'InstrumentationKey=test-key',
      });
    });

    it('should handle empty string values', async () => {
      // Mock secrets with empty strings
      mockSecretClient.getSecret
        .mockResolvedValueOnce({
          value: '',
          name: 'SF-PRIVATE-KEY',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'test-client-id',
          name: 'SF-CLIENT-ID',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: '',
          name: 'SF-USERNAME',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: 'test.salesforce.com',
          name: 'SF-DOMAIN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: '',
          name: 'SFDX-AUTH-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: '',
          name: 'SF-ACCESS-TOKEN',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: '',
          name: 'SF-INSTANCE-URL',
          properties: {},
        } as any)
        .mockResolvedValueOnce({
          value: '',
          name: 'AZURE-MONITOR-CONNECTION-STRING',
          properties: {},
        } as any);

      const secrets = await loadSecretsFromKeyVault(mockKeyVaultUri);

      // Should only include non-empty values
      expect(secrets).toEqual({
        sfClientId: 'test-client-id',
        sfDomain: 'test.salesforce.com',
      });
    });

    it('should use DefaultAzureCredential for authentication', async () => {
      mockSecretClient.getSecret.mockResolvedValue({
        value: 'test-value',
        name: 'test-secret',
        properties: {},
      } as any);

      await loadSecretsFromKeyVault(mockKeyVaultUri);

      expect(DefaultAzureCredential).toHaveBeenCalledTimes(1);
    });

    it('should create SecretClient with correct URI and credential', async () => {
      mockSecretClient.getSecret.mockResolvedValue({
        value: 'test-value',
        name: 'test-secret',
        properties: {},
      } as any);

      await loadSecretsFromKeyVault(mockKeyVaultUri);

      expect(SecretClient).toHaveBeenCalledWith(mockKeyVaultUri, mockCredential);
    });
  });

  describe('checkKeyVaultConnectivity', () => {
    it('should return true when Key Vault is accessible', async () => {
      // Mock successful secret retrieval
      mockSecretClient.getSecret.mockResolvedValueOnce({
        value: 'test-value',
        name: 'SF-PRIVATE-KEY',
        properties: {},
      } as any);

      const isConnected = await checkKeyVaultConnectivity(mockKeyVaultUri);

      expect(isConnected).toBe(true);
      expect(mockSecretClient.getSecret).toHaveBeenCalledWith('SF-PRIVATE-KEY');
    });

    it('should return false when Key Vault is unreachable', async () => {
      // Mock connection error
      mockSecretClient.getSecret.mockRejectedValueOnce(new Error('Network error'));

      const isConnected = await checkKeyVaultConnectivity(mockKeyVaultUri);

      expect(isConnected).toBe(false);
    });

    it('should return false for invalid Key Vault URI', async () => {
      const invalidUri = 'invalid-uri';

      const isConnected = await checkKeyVaultConnectivity(invalidUri);

      expect(isConnected).toBe(false);
    });

    it('should return false when DefaultAzureCredential fails', async () => {
      // Mock credential error
      (DefaultAzureCredential as jest.MockedClass<typeof DefaultAzureCredential>).mockImplementation(() => {
        throw new Error('Credential error');
      });

      const isConnected = await checkKeyVaultConnectivity(mockKeyVaultUri);

      expect(isConnected).toBe(false);
    });

    it('should handle timeout gracefully', async () => {
      // Mock timeout
      mockSecretClient.getSecret.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 100);
          }),
      );

      const isConnected = await checkKeyVaultConnectivity(mockKeyVaultUri);

      expect(isConnected).toBe(false);
    });
  });
});
