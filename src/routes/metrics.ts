import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPerformanceSnapshot } from '../obs';
import { getResourceSnapshot } from '../obs/resources';
import { createFleetReader } from '../obs/fleet';
import { getCorrelationId } from '../utils/correlation-id';

/**
 * Metrics routes backing the Salesforce "System Status" page.
 *
 * /fleet queries shared telemetry and current Azure replica inventory.
 * /performance and /resources remain local snapshots for API compatibility;
 * the Salesforce dashboard uses /fleet for timing and resource metrics.
 *
 * The 200 responses declare `additionalProperties: true` rather than a full
 * property list: Fastify's serializer drops properties a response schema does
 * not name, and these payloads are deeply nested. The contract lives in
 * openapi.yaml.
 *
 * All endpoints require AAD authentication.
 */
export async function metricsRoutes(fastify: FastifyInstance) {
  const readFleet = createFleetReader();
  fastify.get(
    '/fleet',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description:
          'Shared performance metrics and resource snapshots across all backend replicas',
        tags: ['metrics'],
        security: [{ oauth2: [] }],
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const correlationId = getCorrelationId(request);
      try {
        return { ...(await readFleet()), correlationId };
      } catch {
        // Never substitute a single-replica snapshot for a failed shared query.
        fastify.log.warn({ correlationId }, 'Fleet metrics query unavailable');
        return reply.code(503).send({
          error:
            'Fleet metrics unavailable. Check workspace configuration, managed identity access, and Azure Monitor availability.',
          correlationId,
        });
      }
    }
  );
  /**
   * GET /metrics/performance
   * Processing times, throughput and per-stage timings over a rolling window
   */
  fastify.get(
    '/performance',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description:
          'Rolling-window document processing times, throughput and per-stage timings for this replica',
        tags: ['metrics'],
        security: [{ oauth2: [] }],
        response: {
          200: { description: 'Metrics snapshot', type: 'object', additionalProperties: true },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const correlationId = getCorrelationId(request);

      try {
        return reply.code(200).send({ ...getPerformanceSnapshot(), correlationId });
      } catch (error: any) {
        fastify.log.error({ error, correlationId }, 'Failed to get performance metrics');

        return reply.code(500).send({
          error: error.message || 'Failed to get performance metrics',
          correlationId,
        });
      }
    }
  );

  /**
   * GET /metrics/resources
   * CPU, memory, event loop delay, LibreOffice pool and template cache usage
   */
  fastify.get(
    '/resources',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description:
          'CPU, memory, event loop, LibreOffice pool and template cache utilization for this replica',
        tags: ['metrics'],
        security: [{ oauth2: [] }],
        response: {
          200: { description: 'Metrics snapshot', type: 'object', additionalProperties: true },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const correlationId = getCorrelationId(request);

      try {
        return reply.code(200).send({ ...getResourceSnapshot(), correlationId });
      } catch (error: any) {
        fastify.log.error({ error, correlationId }, 'Failed to get resource metrics');

        return reply.code(500).send({
          error: error.message || 'Failed to get resource metrics',
          correlationId,
        });
      }
    }
  );
}
