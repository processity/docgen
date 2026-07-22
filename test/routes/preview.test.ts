import Fastify, { FastifyInstance } from 'fastify';
import { AuthorizationError, createErrorHandler } from '../../src/errors';
import type { PdfPreviewService } from '../../src/preview/service';
import { previewRoutes } from '../../src/routes/preview';

const VALID_REQUEST = {
  generatedDocumentId: 'aGT000000000001AAA',
  requestingUserId: '005000000000001AAA',
  pageNumber: 1,
};

function createService() {
  return {
    getPdfPage: jest.fn().mockResolvedValue({
      contentType: 'image/jpeg',
      base64Data: Buffer.from('page').toString('base64'),
      pageNumber: 1,
      pageCount: 2,
      previewPageCount: 2,
      previewTruncated: false,
    }),
  } as unknown as jest.Mocked<Pick<PdfPreviewService, 'getPdfPage'>>;
}

async function buildRouteApp(service = createService()): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createErrorHandler(app));
  app.decorate('authenticate', async (request, reply) => {
    if (request.headers.authorization !== 'Bearer test-token') {
      await reply.code(401).send({ error: 'Unauthorized' });
    }
  });
  await app.register(previewRoutes, {
    prefix: '/preview',
    serviceFactory: () => service,
  });
  await app.ready();
  return app;
}

describe('POST /preview/pdf-page', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('requires the route authentication pre-handler', async () => {
    app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/preview/pdf-page',
      payload: VALID_REQUEST,
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns only one image response and disables caching', async () => {
    const service = createService();
    app = await buildRouteApp(service);

    const response = await app.inject({
      method: 'POST',
      url: '/preview/pdf-page',
      headers: {
        authorization: 'Bearer test-token',
        'x-correlation-id': 'corr-route',
      },
      payload: { ...VALID_REQUEST, maxPreviewPages: 20 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.json()).toEqual({
      contentType: 'image/jpeg',
      base64Data: Buffer.from('page').toString('base64'),
      pageNumber: 1,
      pageCount: 2,
      previewPageCount: 2,
      previewTruncated: false,
    });
    expect(service.getPdfPage).toHaveBeenCalledWith(
      { ...VALID_REQUEST, maxPreviewPages: 20 },
      'corr-route'
    );
  });

  it('rejects invalid IDs, page numbers, and additional properties before service execution', async () => {
    const service = createService();
    app = await buildRouteApp(service);

    const response = await app.inject({
      method: 'POST',
      url: '/preview/pdf-page',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        generatedDocumentId: 'bad-id',
        requestingUserId: VALID_REQUEST.requestingUserId,
        pageNumber: 0,
        outputFileId: '068000000000001AAA',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(service.getPdfPage).not.toHaveBeenCalled();
  });

  it('uses the shared error handler without leaking record or file metadata', async () => {
    const service = createService();
    service.getPdfPage.mockRejectedValue(
      new AuthorizationError('PDF preview is not available for this request')
    );
    app = await buildRouteApp(service);

    const response = await app.inject({
      method: 'POST',
      url: '/preview/pdf-page',
      headers: { authorization: 'Bearer test-token' },
      payload: VALID_REQUEST,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toBe('PDF preview is not available for this request');
    expect(response.body).not.toContain('OutputFileId');
    expect(response.body).not.toContain('ContentVersion');
  });
});
