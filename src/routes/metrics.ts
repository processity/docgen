import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPerformanceSnapshot, getRuntimeSnapshot } from '../obs';
import { getLibreOfficeConverter } from '../convert/soffice';
import { templateCache } from '../templates/cache';
import { getCorrelationId } from '../utils/correlation-id';

/**
 * Metrics routes backing the Salesforce "System Status" page.
 *
 * NOTE: Every number here is per-replica. In multi-replica deployments (Azure
 * Container Apps, 1-5 replicas) a Salesforce callout lands on an arbitrary
 * replica, so both payloads carry `replicaId` and callers must present these
 * as a sample of one replica rather than a fleet total. Org-wide volume comes
 * from SOQL over Generated_Document__c instead.
 *
 * The 200 responses declare `additionalProperties: true` rather than a full
 * property list: Fastify's serializer drops properties a response schema does
 * not name, and these payloads are deeply nested. The contract lives in
 * openapi.yaml.
 *
 * All endpoints require AAD authentication.
 */
export async function metricsRoutes(fastify: FastifyInstance) {
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
        const runtime = getRuntimeSnapshot();

        const converter = getLibreOfficeConverter();
        const poolStats = converter.getStats();
        const maxConcurrent = converter.getMaxConcurrent();
        const activeJobs = converter.getActiveJobs();

        const cacheStats = templateCache.getStats();
        const cacheLookups = cacheStats.hits + cacheStats.misses;
        const maxCacheBytes = templateCache.getMaxSizeBytes();
        const toMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

        return reply.code(200).send({
          ...runtime,
          libreOfficePool: {
            activeJobs,
            queuedJobs: converter.getQueuedJobs(),
            maxConcurrent,
            utilizationPercent:
              maxConcurrent > 0 ? Math.round((activeJobs / maxConcurrent) * 1000) / 10 : null,
            completedJobs: poolStats.completedJobs,
            failedJobs: poolStats.failedJobs,
            totalConversions: poolStats.totalConversions,
          },
          templateCache: {
            hits: cacheStats.hits,
            misses: cacheStats.misses,
            hitRatePercent:
              cacheLookups > 0 ? Math.round((cacheStats.hits / cacheLookups) * 1000) / 10 : null,
            lookups: cacheLookups,
            entryCount: cacheStats.entryCount,
            evictions: cacheStats.evictions,
            sizeMb: toMb(cacheStats.currentSize),
            maxSizeMb: toMb(maxCacheBytes),
            utilizationPercent:
              maxCacheBytes > 0
                ? Math.round((cacheStats.currentSize / maxCacheBytes) * 1000) / 10
                : null,
          },
          correlationId,
        });
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
