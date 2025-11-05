import { v4 as uuidv4 } from 'uuid';
import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return uuidv4();
}

/**
 * Extract or generate correlation ID from request
 */
export function getCorrelationId(request: FastifyRequest): string {
  const headerValue = request.headers['x-correlation-id'];

  if (typeof headerValue === 'string') {
    return headerValue;
  }

  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return headerValue[0];
  }

  return generateCorrelationId();
}

/**
 * Add correlation ID to response headers
 */
export function setCorrelationId(reply: FastifyReply, correlationId: string): void {
  reply.header('x-correlation-id', correlationId);
}
