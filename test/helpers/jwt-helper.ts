import jwt from 'jsonwebtoken';
import { generateKeyPairSync, createPublicKey } from 'crypto';
import { exportJWK } from 'jose';

/**
 * Test helper for generating JWTs for testing Azure AD authentication
 */

// Generate RSA key pair for testing
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

// Generate a separate "wrong" key pair for invalid signature tests
const wrongKeyPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

export const testKeys = {
  publicKey,
  privateKey,
  kid: 'test-key-id',
};

export const wrongKeys = {
  publicKey: wrongKeyPair.publicKey,
  privateKey: wrongKeyPair.privateKey,
  kid: 'wrong-key-id',
};

/**
 * Convert RSA public key to JWK format for JWKS endpoint mocking
 */
export function publicKeyToJWK(_publicKey: string, kid: string) {
  // For testing purposes, we'll return a simplified JWK
  // In production, Azure AD provides proper JWKs
  return {
    kty: 'RSA',
    use: 'sig',
    kid,
    x5t: kid,
    n: 'test-modulus', // In real scenarios, this would be the actual modulus
    e: 'AQAB',
  };
}

export interface TestTokenOptions {
  issuer?: string;
  audience?: string;
  subject?: string;
  expiresIn?: string | number;
  notBefore?: number;
  customClaims?: Record<string, any>;
  useInvalidSignature?: boolean;
}

/**
 * Generate a test JWT token
 */
export function generateTestToken(options: TestTokenOptions = {}): string {
  const {
    issuer = 'https://login.microsoftonline.com/d8353d2a-b153-4d17-8827-902c51f72357/v2.0',
    audience = 'api://f42d24be-0a17-4a87-bfc5-d6cd84339302',
    subject = 'test-client',
    expiresIn = '1h',
    notBefore,
    customClaims = {},
    useInvalidSignature = false,
  } = options;

  const payload = {
    iss: issuer,
    aud: audience,
    sub: subject,
    iat: Math.floor(Date.now() / 1000),
    nbf: notBefore || Math.floor(Date.now() / 1000),
    ...customClaims,
  };

  // Use wrong key if we want an invalid signature
  const signingKey = useInvalidSignature ? wrongKeys.privateKey : testKeys.privateKey;

  const signOptions: jwt.SignOptions = {
    algorithm: 'RS256',
    keyid: testKeys.kid, // Keep the same kid to simulate a signature mismatch
  };

  // Only add expiresIn if it's valid
  if (expiresIn && (typeof expiresIn === 'number' && expiresIn > 0)) {
    signOptions.expiresIn = expiresIn;
  } else if (expiresIn && typeof expiresIn === 'string') {
    // Parse duration strings like '1h', '30s', etc.
    signOptions.expiresIn = expiresIn as any;
  }

  return jwt.sign(payload, signingKey, signOptions);
}

/**
 * Generate an expired token
 */
export function generateExpiredToken(options: TestTokenOptions = {}): string {
  const expiredPayload = {
    iss: options.issuer || 'https://login.microsoftonline.com/d8353d2a-b153-4d17-8827-902c51f72357/v2.0',
    aud: options.audience || 'api://f42d24be-0a17-4a87-bfc5-d6cd84339302',
    sub: options.subject || 'test-client',
    iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
    exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    nbf: Math.floor(Date.now() / 1000) - 7200,
    ...(options.customClaims || {}),
  };

  return jwt.sign(expiredPayload, testKeys.privateKey, {
    algorithm: 'RS256',
    keyid: testKeys.kid,
  });
}

/**
 * Generate a token that's not yet valid
 */
export function generateNotYetValidToken(options: TestTokenOptions = {}): string {
  return generateTestToken({
    ...options,
    notBefore: Math.floor(Date.now() / 1000) + 3600, // Valid 1 hour from now
  });
}

/**
 * Generate a token with wrong audience
 */
export function generateWrongAudienceToken(options: TestTokenOptions = {}): string {
  return generateTestToken({
    ...options,
    audience: 'api://wrong-audience',
  });
}

/**
 * Generate a token with wrong issuer
 */
export function generateWrongIssuerToken(options: TestTokenOptions = {}): string {
  return generateTestToken({
    ...options,
    issuer: 'https://wrong-issuer.com',
  });
}

/**
 * Generate a malformed token (not a valid JWT)
 */
export function generateMalformedToken(): string {
  return 'not.a.valid.jwt.token';
}

/**
 * Generate a token with invalid signature
 */
export function generateInvalidSignatureToken(options: TestTokenOptions = {}): string {
  return generateTestToken({
    ...options,
    useInvalidSignature: true,
  });
}

/**
 * Mock JWKS response for testing
 */
export async function getMockJWKS() {
  // Convert PEM public key to KeyObject
  const publicKeyObject = createPublicKey(testKeys.publicKey);

  // Export to proper JWK format
  const jwk = await exportJWK(publicKeyObject);

  return {
    keys: [
      {
        ...jwk,
        kid: testKeys.kid,
        use: 'sig',
        alg: 'RS256',
        x5t: testKeys.kid,
        issuer: 'https://login.microsoftonline.com/d8353d2a-b153-4d17-8827-902c51f72357/v2.0',
      },
    ],
  };
}