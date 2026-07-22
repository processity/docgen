import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { getCorrelationId } from '../utils/correlation-id';
import { createPdfPreviewService, PdfPreviewService } from '../preview/service';
import type { PdfPagePreviewRequest, PdfPagePreviewResponse } from '../preview/types';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
}

export interface PreviewRouteOptions {
  serviceFactory?: () => Pick<PdfPreviewService, 'getPdfPage'>;
}

const requestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['generatedDocumentId', 'requestingUserId', 'pageNumber'],
  properties: {
    generatedDocumentId: {
      type: 'string',
      pattern: '^([A-Za-z0-9]{15}|[A-Za-z0-9]{18})$',
    },
    requestingUserId: {
      type: 'string',
      pattern: '^005([A-Za-z0-9]{12}|[A-Za-z0-9]{15})$',
    },
    pageNumber: { type: 'integer', minimum: 1 },
    maxPreviewPages: { type: 'integer', minimum: 1 },
  },
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'contentType',
    'base64Data',
    'pageNumber',
    'pageCount',
    'previewPageCount',
    'previewTruncated',
  ],
  properties: {
    contentType: { type: 'string', enum: ['image/jpeg'] },
    base64Data: { type: 'string' },
    pageNumber: { type: 'integer', minimum: 1 },
    pageCount: { type: 'integer', minimum: 1 },
    previewPageCount: { type: 'integer', minimum: 1, maximum: 20 },
    previewTruncated: { type: 'boolean' },
  },
} as const;

export const previewRoutes: FastifyPluginAsync<PreviewRouteOptions> = async (
  fastify: FastifyInstance,
  options: PreviewRouteOptions
) => {
  const serviceFactory = options.serviceFactory ?? createPdfPreviewService;

  fastify.post<{ Body: PdfPagePreviewRequest; Reply: PdfPagePreviewResponse }>(
    '/pdf-page',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: requestSchema,
        response: { 200: responseSchema },
      },
    },
    async (request: FastifyRequest<{ Body: PdfPagePreviewRequest }>, reply: FastifyReply) => {
      const correlationId = getCorrelationId(request);
      const result = await serviceFactory().getPdfPage(request.body, correlationId);

      return reply
        .code(200)
        .header('Cache-Control', 'no-store, private')
        .header('Pragma', 'no-cache')
        .header('X-Content-Type-Options', 'nosniff')
        .send(result);
    }
  );
};
