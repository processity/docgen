import dotenv from 'dotenv';
import Fastify, { FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health';
import { generateRoutes } from './routes/generate';
import { authTestRoutes } from './routes/auth-test';
import { workerRoutes } from './routes/worker';
import authPlugin from './plugins/auth';
import { loadConfig } from './config';
import { getCorrelationId, setCorrelationId } from './utils/correlation-id';
import { createSalesforceAuth } from './sf/auth';
import { pollerService } from './worker';

// Load environment variables from .env file
dotenv.config();

/**
 * Build and configure the Fastify application
 * @returns Configured Fastify instance
 */
export async function build(): Promise<FastifyInstance> {
  const config = loadConfig();

  // Initialize Salesforce authentication if configured
  if (config.sfDomain && config.sfUsername && config.sfClientId && config.sfPrivateKey) {
    createSalesforceAuth({
      sfDomain: config.sfDomain,
      sfUsername: config.sfUsername,
      sfClientId: config.sfClientId,
      sfPrivateKey: config.sfPrivateKey,
    });
  }

  // Create Fastify instance with JSON logger and custom schema error formatter
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: config.logLevel },
    // Format validation errors consistently
    schemaErrorFormatter: (errors, dataVar) => {
      const error = new Error(`${dataVar} ${errors[0].message}`);
      (error as any).statusCode = 400;
      (error as any).validation = errors;
      return error;
    },
  });

  // Register error handler for all errors (including validation errors)
  app.setErrorHandler((error, request, reply) => {
    // Extract correlation ID for error tracking
    const correlationId = getCorrelationId(request);
    setCorrelationId(reply, correlationId);

    // Determine status code
    const statusCode = error.statusCode || (error as any).status || 500;

    // Log error with correlation ID for debugging
    app.log.error({ correlationId, error: error.message, statusCode, code: (error as any).code }, 'Request error');

    // Normalize error names for consistent client handling
    let errorName = error.name;
    if (statusCode === 400) {
      errorName = 'Bad Request';
    }

    // Build response with correlation ID
    // IMPORTANT: Use type assertion to ensure correlationId is sent
    const response: any = {
      error: errorName,
      message: error.message,
      statusCode,
      correlationId,
    };

    return reply.status(statusCode).send(response);
  });

  // Register auth plugin before routes
  await app.register(authPlugin, { config });

  // Register routes
  await app.register(healthRoutes);
  await app.register(generateRoutes);
  await app.register(authTestRoutes);
  await app.register(workerRoutes, { prefix: '/worker' });

  return app;
}

/**
 * Start the server if this file is run directly
 */
if (require.main === module) {
  const config = loadConfig();

  build()
    .then(async (app) => {
      try {
        await app.listen({
          port: config.port,
          host: '0.0.0.0', // Required for container deployments
        });

        app.log.info(`Server listening on port ${config.port}`);
        app.log.info(`Environment: ${config.nodeEnv}`);
      } catch (err) {
        app.log.error(err);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Failed to build application:', err);
      process.exit(1);
    });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    // Stop the poller if it's running
    if (pollerService.isRunning()) {
      // eslint-disable-next-line no-console
      console.log('Stopping poller service...');
      await pollerService.stop();
      // eslint-disable-next-line no-console
      console.log('Poller service stopped');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
