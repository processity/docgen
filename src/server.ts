import Fastify, { FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health';
import { loadConfig } from './config';

/**
 * Build and configure the Fastify application
 * @returns Configured Fastify instance
 */
export async function build(): Promise<FastifyInstance> {
  const config = loadConfig();

  // Create Fastify instance with JSON logger
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: config.logLevel },
  });

  // Register error handler
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.status(error.statusCode || 500).send({
      error: error.name,
      message: error.message,
      statusCode: error.statusCode || 500,
    });
  });

  // Register routes
  await app.register(healthRoutes);

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
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
