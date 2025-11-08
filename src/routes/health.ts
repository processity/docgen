import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HealthStatus, ReadinessStatus } from '../types';
import { getCorrelationId, setCorrelationId } from '../utils/correlation-id';
import { getAADVerifier } from '../auth';
import { getSalesforceAuth } from '../sf';

/**
 * Health check routes
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /healthz - Liveness probe
   * Always returns 200 if the service is running
   */
  app.get<{ Reply: HealthStatus }>('/healthz', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = getCorrelationId(request);
    setCorrelationId(reply, correlationId);
    return reply.code(200).send({ status: 'ok' });
  });

  /**
   * GET /readyz - Readiness probe
   * Returns 200 when dependencies are ready, 503 otherwise
   *
   * Checks:
   * - JWKS endpoint connectivity (T-08)
   * - Salesforce connectivity (T-09)
   * - Key Vault accessibility (T-16)
   * - LibreOffice availability (T-11)
   */
  app.get<{ Reply: ReadinessStatus }>('/readyz', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = getCorrelationId(request);
    setCorrelationId(reply, correlationId);

    // Check JWKS connectivity if AAD is configured
    let jwksReady: boolean | undefined;
    const verifier = getAADVerifier();
    if (verifier) {
      try {
        jwksReady = await verifier.checkJWKSConnectivity();
      } catch (error) {
        jwksReady = false;
        request.log.error({ correlationId, error }, 'JWKS connectivity check failed');
      }
    }

    // Check Salesforce connectivity if configured (T-09)
    let salesforceReady: boolean | undefined;
    const sfAuth = getSalesforceAuth();
    if (sfAuth) {
      try {
        // Test token acquisition (uses cache if available)
        await sfAuth.getAccessToken();
        salesforceReady = true;
      } catch (error) {
        salesforceReady = false;
        request.log.error({ correlationId, error }, 'Salesforce connectivity check failed');
      }
    }

    // Determine overall readiness
    // In production, all configured dependencies must be ready
    const isProduction = process.env.NODE_ENV === 'production';
    const ready = !isProduction ||
      (jwksReady !== false && salesforceReady !== false);

    const status: ReadinessStatus = {
      ready,
      checks: {
        jwks: jwksReady,
        salesforce: salesforceReady,
        // Placeholder for future dependency checks (T-16)
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
