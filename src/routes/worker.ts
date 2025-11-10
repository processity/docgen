import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pollerService } from '../worker';

/**
 * Worker routes for controlling the document generation poller
 * All endpoints require AAD authentication
 */
export async function workerRoutes(fastify: FastifyInstance) {
  /**
   * POST /worker/start
   * Start the poller service
   */
  fastify.post(
    '/start',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Start the document generation poller',
        tags: ['worker'],
        security: [{ oauth2: [] }],
        response: {
          200: {
            description: 'Poller started successfully',
            type: 'object',
            properties: {
              message: { type: 'string' },
              isRunning: { type: 'boolean' },
              correlationId: { type: 'string' },
            },
          },
          409: {
            description: 'Poller is already running',
            type: 'object',
            properties: {
              error: { type: 'string' },
              correlationId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const correlationId = (request.headers['x-correlation-id'] as string) || request.id;

      try {
        // Check if already running
        if (pollerService.isRunning()) {
          return reply.code(409).send({
            error: 'Poller is already running',
            correlationId,
          });
        }

        // Start the poller
        await pollerService.start();

        fastify.log.info({ correlationId }, 'Poller started via API');

        return reply.code(200).send({
          message: 'Poller started successfully',
          isRunning: true,
          correlationId,
        });
      } catch (error: any) {
        fastify.log.error({ error, correlationId }, 'Failed to start poller');

        return reply.code(500).send({
          error: error.message || 'Failed to start poller',
          correlationId,
        });
      }
    }
  );

  /**
   * POST /worker/stop
   * Stop the poller service gracefully
   */
  fastify.post(
    '/stop',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Stop the document generation poller gracefully',
        tags: ['worker'],
        security: [{ oauth2: [] }],
        response: {
          200: {
            description: 'Poller stopped successfully',
            type: 'object',
            properties: {
              message: { type: 'string' },
              isRunning: { type: 'boolean' },
              correlationId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const correlationId = (request.headers['x-correlation-id'] as string) || request.id;

      try {
        // Stop the poller (idempotent - OK if not running)
        await pollerService.stop();

        fastify.log.info({ correlationId }, 'Poller stopped via API');

        return reply.code(200).send({
          message: 'Poller stopped successfully',
          isRunning: false,
          correlationId,
        });
      } catch (error: any) {
        fastify.log.error({ error, correlationId }, 'Failed to stop poller');

        return reply.code(500).send({
          error: error.message || 'Failed to stop poller',
          correlationId,
        });
      }
    }
  );

  /**
   * GET /worker/status
   * Get current poller status
   */
  fastify.get(
    '/status',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Get current poller status',
        tags: ['worker'],
        security: [{ oauth2: [] }],
        response: {
          200: {
            description: 'Current poller status',
            type: 'object',
            properties: {
              isRunning: { type: 'boolean' },
              currentQueueDepth: { type: 'number' },
              lastPollTime: { type: ['string', 'null'] },
              correlationId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const correlationId = (request.headers['x-correlation-id'] as string) || request.id;

      try {
        const stats = pollerService.getStats();

        return reply.code(200).send({
          isRunning: stats.isRunning,
          currentQueueDepth: stats.currentQueueDepth,
          lastPollTime: stats.lastPollTime,
          correlationId,
        });
      } catch (error: any) {
        fastify.log.error({ error, correlationId }, 'Failed to get poller status');

        return reply.code(500).send({
          error: error.message || 'Failed to get poller status',
          correlationId,
        });
      }
    }
  );

  /**
   * GET /worker/stats
   * Get detailed poller statistics
   */
  fastify.get(
    '/stats',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Get detailed poller statistics',
        tags: ['worker'],
        security: [{ oauth2: [] }],
        response: {
          200: {
            description: 'Detailed poller statistics',
            type: 'object',
            properties: {
              isRunning: { type: 'boolean' },
              currentQueueDepth: { type: 'number' },
              totalProcessed: { type: 'number' },
              totalSucceeded: { type: 'number' },
              totalFailed: { type: 'number' },
              totalRetries: { type: 'number' },
              lastPollTime: { type: ['string', 'null'] },
              uptimeSeconds: { type: 'number' },
              correlationId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const correlationId = (request.headers['x-correlation-id'] as string) || request.id;

      try {
        const stats = pollerService.getStats();

        return reply.code(200).send({
          ...stats,
          correlationId,
        });
      } catch (error: any) {
        fastify.log.error({ error, correlationId }, 'Failed to get poller stats');

        return reply.code(500).send({
          error: error.message || 'Failed to get poller stats',
          correlationId,
        });
      }
    }
  );
}
