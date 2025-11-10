import jwt from 'jsonwebtoken';
import { SalesforceAuth, createSalesforceAuth } from '../src/sf/auth';
import { config } from 'dotenv';
import { loadConfig } from '../src/config';

// Load environment variables from .env file
config();

/**
 * Integration test for Salesforce JWT Bearer Authentication.
 * This test suite validates real authentication against a Salesforce org
 * when proper credentials are configured in environment variables.
 *
 * In CI/CD environments, this test will skip if credentials are not available.
 */

describe('Salesforce JWT Bearer Authentication - Integration', () => {
  const isCI = process.env.CI === 'true';

  // Check if we have SF_PRIVATE_KEY_PATH set
  if (!process.env.SF_PRIVATE_KEY_PATH && !process.env.SF_PRIVATE_KEY && !isCI) {
    // Set the path for local development if not already set
    process.env.SF_PRIVATE_KEY_PATH = './keys/server.key';
  }

  // Load config to check if we have all required credentials
  const appConfig = loadConfig();
  const hasCredentials = !!(
    appConfig.sfDomain &&
    appConfig.sfUsername &&
    appConfig.sfClientId &&
    appConfig.sfPrivateKey
  );

  // Skip integration tests if credentials are not configured
  const describeIntegration = hasCredentials ? describe : describe.skip;

  describeIntegration('Real Salesforce Authentication', () => {
    let auth: SalesforceAuth;

    beforeAll(() => {
      // Create auth using the loaded config (which properly handles SF_PRIVATE_KEY_PATH)
      auth = createSalesforceAuth({
        sfDomain: appConfig.sfDomain!,
        sfUsername: appConfig.sfUsername!,
        sfClientId: appConfig.sfClientId!,
        sfPrivateKey: appConfig.sfPrivateKey!,
      });
    });

    describe('JWT Creation and Signing', () => {
      it('should create a valid JWT with correct claims', () => {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 300; // 5 minutes

        const payload = {
          iss: appConfig.sfClientId,
          aud: 'https://login.salesforce.com',
          sub: appConfig.sfUsername,
          exp,
        };

        const token = jwt.sign(payload, appConfig.sfPrivateKey!, {
          algorithm: 'RS256',
        });

        // Verify token structure
        expect(token).toBeTruthy();
        expect(token.split('.')).toHaveLength(3); // Header.Payload.Signature

        // Decode and verify claims
        const decoded = jwt.decode(token, { complete: true }) as any;
        expect(decoded.header.alg).toBe('RS256');
        expect(decoded.payload.iss).toBe(appConfig.sfClientId);
        expect(decoded.payload.aud).toBe('https://login.salesforce.com');
        expect(decoded.payload.sub).toBe(appConfig.sfUsername);
        expect(decoded.payload.exp).toBeGreaterThan(now);
      });
    });

    describe('Token Exchange', () => {
      it('should successfully authenticate and receive access token', async () => {
        const token = await auth.getAccessToken();

        // Validate token format
        expect(token).toBeTruthy();
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(20);

        // Salesforce tokens contain alphanumeric characters, dots, underscores, hyphens, and exclamation marks
        expect(token).toMatch(/^[\w.!-]+$/);
      }, 30000); // Extended timeout for network request

      it('should return the same token on subsequent calls (caching)', async () => {
        const token1 = await auth.getAccessToken();
        const token2 = await auth.getAccessToken();

        expect(token1).toBe(token2);
      });

      it('should cache token and instance URL after authentication', async () => {
        // Get token to trigger authentication
        const token = await auth.getAccessToken();
        expect(token).toBeTruthy();

        // Access the cached token data via private property (for testing)
        // Note: In production, we'd use the token with the instance URL from config
        const authAny = auth as any;
        expect(authAny.cachedToken).toBeDefined();
        expect(authAny.cachedToken.accessToken).toBe(token);
        expect(authAny.cachedToken.instanceUrl).toBeTruthy();
        expect(authAny.cachedToken.instanceUrl).toMatch(/^https:\/\/[\w-]+\.(my\.)?salesforce\.com$/);
      }, 30000);
    });

    describe('API Validation', () => {
      it('should be able to make authenticated API calls', async () => {
        const token = await auth.getAccessToken();
        const authAny = auth as any;
        const instanceUrl = authAny.cachedToken?.instanceUrl || `https://${appConfig.sfDomain}`;

        // Test API call to get Salesforce version
        const response = await fetch(`${instanceUrl}/services/data`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);

        // Verify we can access at least one API version
        const latestVersion = data[data.length - 1];
        expect(latestVersion).toHaveProperty('version');
        expect(latestVersion).toHaveProperty('url');
      }, 30000);

      it('should be able to query Salesforce objects', async () => {
        const token = await auth.getAccessToken();
        const authAny = auth as any;
        const instanceUrl = authAny.cachedToken?.instanceUrl || `https://${appConfig.sfDomain}`;

        // Query for available sObjects
        const response = await fetch(
          `${instanceUrl}/services/data/v59.0/sobjects`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );

        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('sobjects');
        expect(Array.isArray(data.sobjects)).toBe(true);
        expect(data.sobjects.length).toBeGreaterThan(0);

        // Verify standard objects exist
        const standardObjects = ['Account', 'Contact', 'Lead', 'Opportunity'];
        const objectNames = data.sobjects.map((obj: any) => obj.name);

        standardObjects.forEach(objName => {
          expect(objectNames).toContain(objName);
        });
      }, 30000);
    });

    describe('Token Refresh', () => {
      it('should handle token invalidation and refresh', async () => {
        // Get initial token
        const token1 = await auth.getAccessToken();
        expect(token1).toBeTruthy();

        // Invalidate token
        auth.invalidateToken();

        // Get new token (should trigger refresh)
        const token2 = await auth.getAccessToken();
        expect(token2).toBeTruthy();

        // Tokens might be the same if Salesforce returns the same token
        // But the important thing is that we can still authenticate
        const authAny = auth as any;
        expect(token2).toBeTruthy();
        expect(authAny.cachedToken?.accessToken).toBeTruthy();
      }, 30000);
    });

    describe('Error Scenarios', () => {
      it('should handle invalid client ID gracefully', async () => {
        const invalidAuth = new SalesforceAuth({
          sfDomain: appConfig.sfDomain!,
          sfUsername: appConfig.sfUsername!,
          sfClientId: 'INVALID_CLIENT_ID',
          sfPrivateKey: appConfig.sfPrivateKey!,
        });

        await expect(invalidAuth.getAccessToken()).rejects.toThrow();
      }, 30000);

      it('should handle invalid username gracefully', async () => {
        const invalidAuth = new SalesforceAuth({
          sfDomain: appConfig.sfDomain!,
          sfUsername: 'invalid@example.com',
          sfClientId: appConfig.sfClientId!,
          sfPrivateKey: appConfig.sfPrivateKey!,
        });

        await expect(invalidAuth.getAccessToken()).rejects.toThrow();
      }, 30000);
    });
  });

  // Provide helpful message when tests are skipped
  if (!hasCredentials && !isCI) {
    it('should skip integration tests when credentials are not configured', () => {
      console.log('\n📝 Salesforce integration tests skipped.');
      console.log('To run these tests locally:');
      console.log('1. Set up environment variables:');
      console.log('   export SF_DOMAIN=<your-salesforce-domain>');
      console.log('   export SF_USERNAME=<your-username>');
      console.log('   export SF_CLIENT_ID=<your-client-id>');
      console.log('   export SF_PRIVATE_KEY="$(cat ./keys/server.key)"');
      console.log('2. Or source the helper script: source ./load-env.sh');
      console.log('3. Run tests: npm test -- sf.auth.integration.test.ts\n');
      expect(true).toBe(true);
    });
  }

  if (!hasCredentials && isCI) {
    it('should skip integration tests in CI when secrets are not configured', () => {
      console.log('\n⚠️  Salesforce integration tests skipped in CI.');
      console.log('GitHub secrets are not configured for this repository.');
      console.log('To enable these tests in CI, add the following secrets:');
      console.log('- SF_DOMAIN');
      console.log('- SF_USERNAME');
      console.log('- SF_CLIENT_ID');
      console.log('- SF_PRIVATE_KEY\n');
      expect(true).toBe(true);
    });
  }
});