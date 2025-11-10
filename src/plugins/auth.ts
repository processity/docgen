import { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { createAADVerifier, getAADVerifier, DecodedToken } from '../auth';
import { getCorrelationId } from '../utils/correlation-id';
import { AppConfig } from '../types';

/**
 * Fastify plugin for Azure AD JWT authentication
 */

declare module 'fastify' {
  interface FastifyRequest {
    user?: DecodedToken;
  }

  interface FastifyInstance {
    config?: AppConfig;
  }
}

/**
 * Auth plugin options
 */
interface AuthPluginOptions {
  config: AppConfig;
}

/**
 * Create auth preHandler hook
 */
export function createAuthPreHandler(): preHandlerHookHandler {
  return async function authPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const correlationId = getCorrelationId(request);
    const verifier = getAADVerifier();

    // Check if auth is bypassed in development
    const config = request.server.config as AppConfig;
    if (
      config.nodeEnv === 'development' &&
      process.env.AUTH_BYPASS_DEVELOPMENT === 'true'
    ) {
      request.log.info({ correlationId }, 'Auth bypassed in development mode');
      return;
    }

    if (!verifier) {
      // In development without AAD config, allow requests through
      // This allows local development without full Azure AD setup
      if (config.nodeEnv === 'development') {
        request.log.warn({ correlationId }, 'AAD verifier not initialized - allowing request in development');
        return;
      }

      // In production or test, AAD configuration is required
      request.log.error({ correlationId }, 'AAD verifier not initialized');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Authentication service not configured',
        correlationId,
      });
      return;
    }

    try {
      const decodedToken = await verifier.validateRequest(request);

      // Attach user to request for downstream use
      request.user = decodedToken;

      request.log.info(
        {
          correlationId,
          subject: decodedToken.sub,
          appId: decodedToken.appid,
        },
        'Authentication successful'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';

      // Determine status code based on error type
      let statusCode = 401; // Default to Unauthorized
      let errorType = 'Unauthorized';

      if (message.includes('Invalid audience')) {
        statusCode = 403;
        errorType = 'Forbidden';
      } else if (message.includes('Invalid issuer')) {
        statusCode = 403;
        errorType = 'Forbidden';
      } else if (message.includes('Missing authorization header')) {
        request.log.warn({ correlationId }, 'Missing authorization header');
      } else if (message.includes('invalid format') || message.includes('Invalid authorization format')) {
        request.log.warn({ correlationId }, 'Invalid authorization format');
      } else {
        request.log.warn(
          {
            correlationId,
            error: message,
          },
          'Authentication failed'
        );
      }

      reply.code(statusCode).send({
        error: errorType,
        message,
        correlationId,
      });
    }
  };
}

/**
 * Auth plugin
 */
async function authPlugin(
  fastify: FastifyInstance,
  options: AuthPluginOptions
): Promise<void> {
  const { config } = options;

  // Initialize AAD verifier if configured
  if (config.jwksUri && config.issuer && config.audience) {
    createAADVerifier({
      jwksUri: config.jwksUri,
      issuer: config.issuer,
      audience: config.audience,
    });

    fastify.log.info(
      {
        issuer: config.issuer,
        audience: config.audience,
      },
      'AAD JWT verifier initialized'
    );
  } else if (config.nodeEnv === 'production') {
    throw new Error('AAD authentication configuration missing in production');
  } else {
    fastify.log.warn('AAD authentication not configured - auth will be bypassed');
  }

  // Store config on the fastify instance for access in preHandler
  fastify.decorate('config', config);

  // Register the auth preHandler
  const authPreHandler = createAuthPreHandler();

  // Decorate with auth handler for routes to use
  fastify.decorate('authenticate', authPreHandler);
}

export default fp(authPlugin, {
  name: 'auth',
  fastify: '4.x',
});