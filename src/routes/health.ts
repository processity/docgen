import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HealthStatus, ReadinessStatus } from '../types';

/**
 * Health check routes
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /healthz - Liveness probe
   * Always returns 200 if the service is running
   */
  app.get<{ Reply: HealthStatus }>('/healthz', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  /**
   * GET /readyz - Readiness probe
   * Returns 200 when dependencies are ready, 503 otherwise
   *
   * In future tasks, this will check:
   * - Salesforce connectivity
   * - Key Vault accessibility
   * - LibreOffice availability
   */
  app.get<{ Reply: ReadinessStatus }>('/readyz', async (_request: FastifyRequest, reply: FastifyReply) => {
    // For now, always ready since we have no external dependencies yet
    // This will be expanded in future tasks (T-08, T-09, T-16)
    const ready = true;

    const status: ReadinessStatus = {
      ready,
      checks: {
        // Placeholder for future dependency checks
        salesforce: undefined,
        keyVault: undefined,
      },
    };

    if (ready) {
      return reply.code(200).send(status);
    } else {
      return reply.code(503).send(status);
    }
  });
}
