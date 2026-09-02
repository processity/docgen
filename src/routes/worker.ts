import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pollerService } from '../worker';
import { getCorrelationId } from '../utils/correlation-id';

/**
 * Worker routes for monitoring the document generation poller
 *
 * NOTE: In multi-replica deployments (Azure Container Apps with 1-5 replicas),
 * the poller runs automatically on ALL replicas. Status and stats are per-replica.
 *
 * Within a replica, PollerService serializes fetch-and-claim cycles, so a wake
 * and a scheduled tick cannot claim the same rows. Document processing continues
 * in the background while later cycles fill unused capacity. Across replicas
 * there is no such guarantee:
 * lockDocument() is an unconditional PATCH, not an atomic claim, so two replicas
 * fetching in the same window can both process a document. Pre-existing; making
 * the claim atomic is tracked separately.
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

  /**
   * POST /worker/wake
   * Trigger an immediate poll cycle on this replica
   *
   * Lets Salesforce signal that an interactive job was just enqueued, instead of
   * waiting out the adaptive timer (15s active / 60s idle). Returns immediately
   * without awaiting the claim cycle: holding the request open would count against
   * the HTTP autoscale rule and unnecessarily stall the caller's callout.
   *
   * Safe to call repeatedly and concurrently - fetch-and-claim is single-flight,
   * and a wake arriving mid-claim schedules exactly one trailing cycle.
   */
  fastify.post(
    '/wake',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Trigger an immediate poll cycle on this replica',
        tags: ['worker'],
        security: [{ oauth2: [] }],
        response: {
          202: {
            description: 'Wake accepted',
            type: 'object',
            properties: {
              triggered: { type: 'boolean' },
              correlationId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const correlationId = getCorrelationId(request);
      const triggered = pollerService.isRunning();

      if (triggered) {
        // Fire and forget - processBatch() handles its own errors, the catch is
        // a backstop so a rejection can never become an unhandled rejection.
        void pollerService.processBatch().catch((error: unknown) => {
          fastify.log.error({ error, correlationId }, 'Wake-triggered poll cycle failed');
        });
      } else {
        fastify.log.warn({ correlationId }, 'Wake received but poller is not running');
      }

      return reply.code(202).send({ triggered, correlationId });
    }
  );
}
