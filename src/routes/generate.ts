import { FastifyPluginAsync, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { DocgenRequest, DocgenResponse, FileUploadResult } from '../types';
import { getCorrelationId, setCorrelationId } from '../utils/correlation-id';
import { getSalesforceAuth } from '../sf/auth';
import { SalesforceApi } from '../sf/api';
import { TemplateService } from '../templates/service';
import { mergeTemplate } from '../templates/merge';
import { convertDocxToPdf } from '../convert/soffice';
import { uploadAndLinkFiles } from '../sf/files';
import { loadConfig } from '../config';
import { trackMetric } from '../obs';

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
      description:
        'Parent record IDs for file linking. Keys: "{ObjectType}Id" (e.g., ContactId, LeadId). Values: Salesforce ID (15/18 chars) or null.',
      additionalProperties: true,
    },
    requestHash: {
      type: 'string',
      description: 'SHA-256 hash for idempotency (computed by Apex)',
    },
    generatedDocumentId: {
      type: 'string',
      description: 'ID of Generated_Document__c record for status tracking',
    },
  },
  additionalProperties: false,
};

/**
 * Generate route handler
 * Implements the complete document generation pipeline from template fetch to upload
 */
async function generateHandler(
  request: FastifyRequest<{ Body: DocgenRequest }>,
  reply: FastifyReply
): Promise<void> {
  // Extract or generate correlation ID
  const correlationId = getCorrelationId(request);

  // Set correlation ID in response header for distributed tracing
  setCorrelationId(reply, correlationId);

  // Start timing for metrics
  const startTime = Date.now();

  // Log the request (structured logging)
  request.log.info(
    {
      correlationId,
      templateId: request.body.templateId,
      outputFormat: request.body.outputFormat,
      locale: request.body.locale,
      timezone: request.body.timezone,
      hasRequestHash: !!request.body.requestHash,
      generatedDocumentId: request.body.generatedDocumentId,
    },
    'Received document generation request'
  );

  // Load config for Salesforce domain and other settings
  const config = await loadConfig();
  if (!config.sfDomain) {
    throw new Error('Salesforce domain not configured');
  }

  try {
    // Initialize services
    const sfAuth = getSalesforceAuth();
    if (!sfAuth) {
      throw new Error('Salesforce authentication not configured');
    }
    const sfApi = new SalesforceApi(sfAuth, sfAuth.getInstanceUrl());
    const templateService = new TemplateService(sfApi);

    // Step 1: Fetch template from Salesforce (with caching)
    request.log.info({ correlationId, templateId: request.body.templateId }, 'Fetching template');
    const templateBuffer = await templateService.getTemplate(
      request.body.templateId,
      correlationId
    );

    // Step 2: Merge template with data
    request.log.info({ correlationId }, 'Merging template with data');
    const mergedDocx = await mergeTemplate(
      templateBuffer,
      request.body.data,
      {
        locale: request.body.locale,
        timezone: request.body.timezone,
        imageAllowlist: config.imageAllowlist,
      }
    );

    // Step 3: Convert to PDF if needed
    let pdfBuffer: Buffer | null = null;

    if (request.body.outputFormat === 'PDF') {
      request.log.info({ correlationId }, 'Converting DOCX to PDF');
      pdfBuffer = await convertDocxToPdf(mergedDocx, {
        timeout: config.conversionTimeout,
        workdir: config.conversionWorkdir,
        correlationId,
      });
    }

    // Step 4: Upload to Salesforce and create links
    request.log.info({ correlationId }, 'Uploading file to Salesforce');

    // Determine what to upload based on output format
    let uploadResult: FileUploadResult;
    if (request.body.outputFormat === 'PDF') {
      // Upload PDF as primary, and optionally DOCX if storeMergedDocx is true
      uploadResult = await uploadAndLinkFiles(
        pdfBuffer!,  // We know this is not null when outputFormat is PDF
        request.body.options.storeMergedDocx ? mergedDocx : null,
        request.body,
        sfApi,
        { correlationId }
      );
    } else {
      // Output format is DOCX - upload DOCX as the primary file
      // Note: uploadAndLinkFiles expects PDF as first param, but we're uploading DOCX only
      // We need to handle this case differently
      uploadResult = await uploadAndLinkFiles(
        mergedDocx,  // Pass DOCX as the "PDF" parameter (it's just a buffer)
        null,  // No secondary DOCX needed
        request.body,
        sfApi,
        { correlationId }
      );
    }

    // Determine which ContentVersionId to use for download URL
    const downloadContentVersionId = uploadResult.pdfContentVersionId;

    // Build download URL
    const downloadUrl = `https://${config.sfDomain}/sfc/servlet.shepherd/version/download/${downloadContentVersionId}`;

    // Calculate duration for metrics
    const duration = Date.now() - startTime;

    // Track metrics with App Insights
    trackMetric('docgen_duration_ms', duration, {
      templateId: request.body.templateId,
      outputFormat: request.body.outputFormat,
      mode: 'interactive',
      correlationId,
    });

    // Also log for debugging
    request.log.info(
      {
        metric: 'docgen_duration_ms',
        value: duration,
        templateId: request.body.templateId,
        outputFormat: request.body.outputFormat,
        mode: 'interactive',
        correlationId,
      },
      'Document generation duration tracked'
    );

    // Log success
    request.log.info(
      {
        correlationId,
        contentVersionId: downloadContentVersionId,
        linkCount: uploadResult.linkCount,
        linkErrors: uploadResult.linkErrors.length,
        duration,
      },
      'Document generation completed successfully'
    );

    // Return success response
    const response: DocgenResponse = {
      downloadUrl,
      contentVersionId: downloadContentVersionId,
      correlationId,
    };

    reply.code(200).send(response);

  } catch (error) {
    // Calculate duration for metrics even on failure
    const duration = Date.now() - startTime;

    // Determine failure reason for metrics
    let failureReason = 'unknown';
    if (error instanceof Error) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        failureReason = 'template_not_found';
      } else if (error.message.includes('validation') || error.message.includes('invalid')) {
        failureReason = 'validation_error';
      } else if (error.message.includes('timeout')) {
        failureReason = 'conversion_timeout';
      } else if (error.message.includes('conversion failed')) {
        failureReason = 'conversion_failed';
      } else if (error.message.includes('upload failed') || error.message.includes('Salesforce API')) {
        failureReason = 'upload_failed';
      }
    }

    // Track failure metric with App Insights
    trackMetric('docgen_failures_total', 1, {
      reason: failureReason,
      templateId: request.body.templateId,
      outputFormat: request.body.outputFormat,
      mode: 'interactive',
      correlationId,
    });

    // Also log for debugging
    request.log.info(
      {
        metric: 'docgen_failures_total',
        reason: failureReason,
        templateId: request.body.templateId,
        outputFormat: request.body.outputFormat,
        mode: 'interactive',
        correlationId,
        duration,
      },
      'Document generation failure tracked'
    );

    // Log the error with details
    request.log.error(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        templateId: request.body.templateId,
        generatedDocumentId: request.body.generatedDocumentId,
        failureReason,
        duration,
      },
      'Document generation failed'
    );

    // If we have a generatedDocumentId, try to update its status to FAILED
    if (request.body.generatedDocumentId) {
      try {
        const sfAuth = getSalesforceAuth();
        if (!sfAuth) {
          throw new Error('Salesforce authentication not configured');
        }
        const sfApi = new SalesforceApi(sfAuth, sfAuth.getInstanceUrl());

        await sfApi.patch(
          `/services/data/v59.0/sobjects/Generated_Document__c/${request.body.generatedDocumentId}`,
          {
            Status__c: 'FAILED',
            Error__c: error instanceof Error ? error.message : String(error),
          },
          { correlationId }
        );
      } catch (updateError) {
        // Log but don't fail the request
        request.log.error(
          {
            correlationId,
            generatedDocumentId: request.body.generatedDocumentId,
            updateError: updateError instanceof Error ? updateError.message : String(updateError),
          },
          'Failed to update Generated_Document__c status'
        );
      }
    }

    // Determine appropriate status code
    let statusCode = 500;
    let errorName = 'Internal Server Error';

    if (error instanceof Error) {
      // Map specific error messages to status codes
      if (error.message.includes('404') || error.message.includes('not found')) {
        statusCode = 404;
        errorName = 'Not Found';
      } else if (error.message.includes('validation') || error.message.includes('invalid')) {
        statusCode = 400;
        errorName = 'Bad Request';
      } else if (error.message.includes('timeout') || error.message.includes('conversion failed')) {
        statusCode = 502;
        errorName = 'Bad Gateway';
      } else if (error.message.includes('upload failed') || error.message.includes('Salesforce API')) {
        statusCode = 502;
        errorName = 'Bad Gateway';
      }
    }

    // Re-throw to let Fastify's error handler format the response
    const apiError = new Error(error instanceof Error ? error.message : String(error));
    (apiError as any).statusCode = statusCode;
    (apiError as any).name = errorName;
    throw apiError;
  }
}

/**
 * Register generate routes
 */
export const generateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: DocgenRequest; Reply: DocgenResponse }>(
    '/generate',
    {
      preHandler: fastify.authenticate,  // AAD JWT validation (T-08)
      schema: {
        body: docgenRequestSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              downloadUrl: {
                type: 'string',
                description: 'Salesforce ContentVersion download URL',
              },
              contentVersionId: {
                type: 'string',
                description: 'The uploaded file ContentVersion ID',
              },
              correlationId: {
                type: 'string',
                description: 'Correlation ID for tracking',
              },
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
          404: {
            type: 'object',
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
              correlationId: { type: 'string' },
            },
          },
          502: {
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
