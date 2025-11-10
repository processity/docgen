import jwt from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';
import { FastifyRequest } from 'fastify';

/**
 * Azure AD JWT Verifier
 * Validates JWT tokens from Azure AD using JWKS for signature verification
 */

export interface DecodedToken {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  nbf: number;
  appid?: string;
  oid?: string;
  [key: string]: any;
}

export class AADJWTVerifier {
  private jwksClient: JwksClient;
  private issuer: string;
  private audience: string;

  constructor(config: {
    jwksUri: string;
    issuer: string;
    audience: string;
  }) {
    this.issuer = config.issuer;
    this.audience = config.audience;

    // Configure JWKS client with caching
    this.jwksClient = jwksClient({
      jwksUri: config.jwksUri,
      cache: true,
      cacheMaxAge: 5 * 60 * 1000, // Cache for 5 minutes
      cacheMaxEntries: 5, // Cache max 5 keys
      rateLimit: true,
      jwksRequestsPerMinute: 10, // Max 10 requests per minute
    });
  }

  /**
   * Extract token from Authorization header
   */
  extractToken(request: FastifyRequest): string | null {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return null;
    }

    return parts[1];
  }

  /**
   * Get signing key from JWKS
   */
  private async getSigningKey(kid: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.jwksClient.getSigningKey(kid, (err, key) => {
        if (err) {
          reject(err);
          return;
        }
        if (!key) {
          reject(new Error('No signing key found'));
          return;
        }
        const signingKey = 'publicKey' in key ? key.publicKey : key.rsaPublicKey;
        resolve(signingKey);
      });
    });
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<DecodedToken> {
    return new Promise((resolve, reject) => {
      // First decode to get the kid
      const decoded = jwt.decode(token, { complete: true });

      if (!decoded || typeof decoded === 'string') {
        reject(new Error('Invalid token format'));
        return;
      }

      const kid = decoded.header.kid;
      if (!kid) {
        reject(new Error('No kid found in token header'));
        return;
      }

      // Get the signing key from JWKS (async operation)
      this.getSigningKey(kid)
        .then((signingKey) => {
          // Verify the token
          jwt.verify(
            token,
            signingKey,
            {
              algorithms: ['RS256'],
              issuer: this.issuer,
              audience: this.audience,
            },
            (err, decoded) => {
              if (err) {
                if (err.name === 'TokenExpiredError') {
                  reject(new Error('Token has expired'));
                } else if (err.name === 'NotBeforeError') {
                  reject(new Error('Token is not yet valid'));
                } else if (err.name === 'JsonWebTokenError') {
                  if (err.message.includes('audience')) {
                    reject(new Error(`Invalid audience: expected ${this.audience}`));
                  } else if (err.message.includes('issuer')) {
                    reject(new Error(`Invalid issuer: expected ${this.issuer}`));
                  } else if (err.message.includes('signature')) {
                    reject(new Error('Invalid token signature'));
                  } else {
                    reject(new Error(`Invalid token: ${err.message}`));
                  }
                } else {
                  reject(err);
                }
                return;
              }

              if (!decoded || typeof decoded === 'string') {
                reject(new Error('Invalid token payload'));
                return;
              }

              resolve(decoded as DecodedToken);
            }
          );
        })
        .catch((error) => {
          if (error instanceof Error) {
            reject(new Error(`Unable to verify token: ${error.message}`));
          } else {
            reject(new Error('Unable to verify token'));
          }
        });
    });
  }

  /**
   * Validate token from request
   * Returns decoded token or throws an error
   */
  async validateRequest(request: FastifyRequest): Promise<DecodedToken> {
    const token = this.extractToken(request);

    if (!token) {
      throw new Error('Missing authorization header or invalid format');
    }

    return await this.verifyToken(token);
  }

  /**
   * Check if JWKS endpoint is accessible (for health checks)
   */
  async checkJWKSConnectivity(): Promise<boolean> {
    try {
      // Try to fetch keys - this will use cache if available
      await new Promise((resolve, reject) => {
        // Use a dummy kid to trigger JWKS fetch
        this.jwksClient.getSigningKey('dummy', (err) => {
          // We expect an error (no key with this kid), but it means JWKS was fetched
          if (err && err.message && err.message.includes('Unable to find')) {
            resolve(true); // JWKS endpoint is accessible
          } else if (err) {
            reject(err); // Real connectivity issue
          } else {
            resolve(true); // Unlikely but means it worked
          }
        });
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a singleton instance for the application
 */
let verifierInstance: AADJWTVerifier | null = null;

export function createAADVerifier(config: {
  jwksUri: string;
  issuer: string;
  audience: string;
}): AADJWTVerifier {
  if (!verifierInstance) {
    verifierInstance = new AADJWTVerifier(config);
  }
  return verifierInstance;
}

export function getAADVerifier(): AADJWTVerifier | null {
  return verifierInstance;
}