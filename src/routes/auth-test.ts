import { FastifyPluginAsync, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { getCorrelationId, setCorrelationId } from '../utils/correlation-id';

// Extend FastifyInstance type to include authenticate
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
}

/**
 * Response type for auth test endpoint
 */
interface AuthTestResponse {
  correlationId: string;
  message: string;
}

/**
 * Auth test route handler
 * Simple endpoint to test authentication without triggering document generation
 */
async function authTestHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Extract or generate correlation ID
  const correlationId = getCorrelationId(request);

  // Set correlation ID in response header for distributed tracing
  setCorrelationId(reply, correlationId);

  // Log the request
  request.log.info(
    {
      correlationId,
    },
    'Auth test request received'
  );

  // Return success response
  const response: AuthTestResponse = {
    correlationId,
    message: 'Authenticated',
  };

  reply.code(200).send(response);
}

/**
 * Register auth test routes
 */
export const authTestRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Reply: AuthTestResponse }>(
    '/auth-test',
    {
      preHandler: fastify.authenticate,  // AAD JWT validation (T-08)
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              correlationId: {
                type: 'string',
                description: 'Correlation ID for tracking',
              },
              message: {
                type: 'string',
                description: 'Success message',
              },
            },
          },
        },
      },
    },
    authTestHandler
  );
};
