import { FastifyPluginAsync, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { DocgenRequest, DocgenResponse } from '../types';
import { getCorrelationId, setCorrelationId } from '../utils/correlation-id';

// Extend FastifyInstance type to include authenticate
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
}

/**
 * Fastify JSON Schema for POST /generate request validation
 */
const docgenRequestSchema = {
  type: 'object',
  required: [
    'templateId',
    'outputFileName',
    'outputFormat',
    'locale',
    'timezone',
    'options',
    'data',
  ],
  properties: {
    templateId: {
      type: 'string',
      description: 'ContentVersionId of the template DOCX file',
    },
    outputFileName: {
      type: 'string',
      description: 'Desired output file name (may contain placeholders)',
    },
    outputFormat: {
      type: 'string',
      enum: ['PDF', 'DOCX'],
      description: 'Output format',
    },
    locale: {
      type: 'string',
      description: 'Locale for formatting (e.g., en-GB, en-US)',
    },
    timezone: {
      type: 'string',
      description: 'Timezone for date formatting (e.g., Europe/London)',
    },
    options: {
      type: 'object',
      required: ['storeMergedDocx', 'returnDocxToBrowser'],
      properties: {
        storeMergedDocx: {
          type: 'boolean',
          description: 'Whether to store the merged DOCX alongside the PDF',
        },
        returnDocxToBrowser: {
          type: 'boolean',
          description: 'Whether to return DOCX URL instead of PDF (interactive mode)',
        },
      },
    },
    data: {
      type: 'object',
      description: 'Template data object with Salesforce field paths',
      additionalProperties: true,
    },
    parents: {
      type: 'object',
      properties: {
        AccountId: {
          type: ['string', 'null'],
          description: 'Salesforce Account ID (18 chars)',
        },
        OpportunityId: {
          type: ['string', 'null'],
          description: 'Salesforce Opportunity ID (18 chars)',
        },
        CaseId: {
          type: ['string', 'null'],
          description: 'Salesforce Case ID (18 chars)',
        },
      },
      additionalProperties: false,
    },
    requestHash: {
      type: 'string',
      description: 'SHA-256 hash for idempotency (computed by Apex)',
    },
  },
  additionalProperties: false,
};

/**
 * Generate route handler
 * Accepts a document generation request and returns a 202 (Accepted) with correlation ID
 *
 * NOTE: This is a stub implementation for T-03. Actual processing (template fetch,
 * merge, conversion, upload) will be implemented in later tasks (T-10, T-11, T-12, T-13).
 */
async function generateHandler(
  request: FastifyRequest<{ Body: DocgenRequest }>,
  reply: FastifyReply
): Promise<void> {
  // Extract or generate correlation ID
  const correlationId = getCorrelationId(request);

  // Set correlation ID in response header for distributed tracing
  setCorrelationId(reply, correlationId);

  // Log the request (structured logging)
  request.log.info(
    {
      correlationId,
      templateId: request.body.templateId,
      outputFormat: request.body.outputFormat,
      locale: request.body.locale,
      timezone: request.body.timezone,
      hasRequestHash: !!request.body.requestHash,
    },
    'Received document generation request'
  );

  // Authentication is handled via preHandler in route registration
  // TODO (T-09): Implement Salesforce client for template fetch & upload
  // TODO (T-10): Implement template fetch & merge
  // TODO (T-11): Implement LibreOffice conversion
  // TODO (T-12): Implement upload & linking; check idempotency
  // TODO (T-13): Wire full pipeline

  // Stub response: Return 202 Accepted with correlation ID
  // In the full implementation (T-13), this will return:
  // - downloadUrl: Salesforce ContentVersion download URL
  // - contentVersionId: The uploaded file's ID
  // - correlationId: For tracking/observability

  reply.code(202).send({
    correlationId,
    message: 'Document generation request accepted (stub - processing not implemented)',
  });
}

/**
 * Register generate routes
 */
export const generateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: DocgenRequest; Reply: DocgenResponse | { correlationId: string; message: string } }>(
    '/generate',
    {
      preHandler: fastify.authenticate,  // AAD JWT validation (T-08)
      schema: {
        body: docgenRequestSchema,
        response: {
          202: {
            type: 'object',
            properties: {
              correlationId: { type: 'string' },
              message: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
              correlationId: { type: 'string' },
            },
          },
        },
      },
    },
    generateHandler
  );
};
