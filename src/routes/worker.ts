import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pollerService } from '../worker';

/**
 * Worker routes for monitoring the document generation poller
 *
 * NOTE: In multi-replica deployments (Azure Container Apps with 1-5 replicas),
 * the poller runs automatically on ALL replicas. The Salesforce lock mechanism
 * (LockedUntil__c) prevents duplicate work. Status and stats are per-replica.
 *
 * All endpoints require AAD authentication
 */
export async function workerRoutes(fastify: FastifyInstance) {
  /**
   * GET /worker/status
   * Get current poller status for this replica
   *
   * NOTE: In multi-replica deployments, each replica has independent status.
   * Multiple requests may return different results depending on which replica handles the request.
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
   * Get detailed poller statistics for this replica
   *
   * NOTE: In multi-replica deployments, statistics are per-replica.
   * To get total counts across all replicas, you would need to query all replicas
   * and aggregate the results (typically done via load balancer or monitoring tools).
   */
  fastify.get(
    '/stats',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Get detailed poller statistics for this replica',
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
