/**
 * Tests for Azure Application Insights observability wrapper
 *
 * @group unit
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock OpenTelemetry modules before importing
jest.mock('@azure/monitor-opentelemetry', () => ({
  useAzureMonitor: jest.fn(),
}));

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn(),
  },
  trace: {
    getTracer: jest.fn(),
    setSpan: jest.fn(),
    getActiveSpan: jest.fn(),
  },
  context: {
    active: jest.fn(),
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
}));

describe('Observability - Azure Application Insights', () => {
  let mockCounter: any;
  let mockHistogram: any;
  let mockMeter: any;
  let mockTracer: any;
  let mockSpan: any;

  beforeEach(() => {
    // Reset modules to ensure clean state
    jest.resetModules();

    // Create mock instruments
    mockCounter = {
      add: jest.fn(),
    };

    mockHistogram = {
      record: jest.fn(),
    };

    // Create mock meter
    mockMeter = {
      createCounter: jest.fn().mockReturnValue(mockCounter),
      createHistogram: jest.fn().mockReturnValue(mockHistogram),
    };

    // Create mock span
    mockSpan = {
      end: jest.fn(),
      setStatus: jest.fn(),
      setAttribute: jest.fn(),
      recordException: jest.fn(),
    };

    // Create mock tracer
    mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };

    // Setup OpenTelemetry API mocks
    const otelApi = require('@opentelemetry/api');
    otelApi.metrics.getMeter.mockReturnValue(mockMeter);
    otelApi.trace.getTracer.mockReturnValue(mockTracer);
    otelApi.context.active.mockReturnValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with connection string', () => {
      // Set connection string
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
      process.env.NODE_ENV = 'production';

      const { initializeAppInsights } = require('../src/obs/insights');
      const useAzureMonitor = require('@azure/monitor-opentelemetry').useAzureMonitor;

      initializeAppInsights();

      expect(useAzureMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          azureMonitorExporterOptions: {
            connectionString: 'InstrumentationKey=test-key-12345',
          },
        })
      );
    });

    it('should not initialize in test environment', () => {
      process.env.NODE_ENV = 'test';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';

      const { initializeAppInsights } = require('../src/obs/insights');
      const useAzureMonitor = require('@azure/monitor-opentelemetry').useAzureMonitor;

      initializeAppInsights();

      expect(useAzureMonitor).not.toHaveBeenCalled();
    });

    it('should handle missing connection string gracefully', () => {
      delete process.env.AZURE_MONITOR_CONNECTION_STRING;
      process.env.NODE_ENV = 'development';

      const { initializeAppInsights } = require('../src/obs/insights');

      expect(() => initializeAppInsights()).not.toThrow();
    });

    it('should create meter with correct service name', () => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';

      const { initializeAppInsights } = require('../src/obs/insights');
      const otelApi = require('@opentelemetry/api');

      initializeAppInsights();

      expect(otelApi.metrics.getMeter).toHaveBeenCalledWith(
        'docgen-service',
        expect.any(String)
      );
    });
  });

  describe('trackMetric - docgen_duration_ms', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
    });

    it('should track document generation duration with dimensions', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('docgen_duration_ms', 2500, {
        templateId: '068xx000000001',
        outputFormat: 'PDF',
        mode: 'interactive',
        correlationId: 'test-corr-id-123',
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(2500, {
        templateId: '068xx000000001',
        outputFormat: 'PDF',
        mode: 'interactive',
        correlationId: 'test-corr-id-123',
      });
    });

    it('should track batch mode duration', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('docgen_duration_ms', 1800, {
        templateId: '068xx000000002',
        outputFormat: 'DOCX',
        mode: 'batch',
        correlationId: 'poll-456-abc',
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(1800, {
        templateId: '068xx000000002',
        outputFormat: 'DOCX',
        mode: 'batch',
        correlationId: 'poll-456-abc',
      });
    });

    it('should not track metrics in test environment', () => {
      process.env.NODE_ENV = 'test';

      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('docgen_duration_ms', 2500, {
        templateId: '068xx000000001',
        outputFormat: 'PDF',
        mode: 'interactive',
      });

      expect(mockHistogram.record).not.toHaveBeenCalled();
    });
  });

  describe('trackMetric - docgen_failures_total', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
    });

    it('should track template_not_found failures', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('docgen_failures_total', 1, {
        reason: 'template_not_found',
        templateId: '068xx000000001',
        outputFormat: 'PDF',
        mode: 'interactive',
        correlationId: 'test-corr-id-123',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        reason: 'template_not_found',
        templateId: '068xx000000001',
        outputFormat: 'PDF',
        mode: 'interactive',
        correlationId: 'test-corr-id-123',
      });
    });

    it('should track validation_error failures', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('docgen_failures_total', 1, {
        reason: 'validation_error',
        templateId: '068xx000000001',
        outputFormat: 'INVALID',
        mode: 'interactive',
        correlationId: 'test-corr-id-124',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        reason: 'validation_error',
        templateId: '068xx000000001',
        outputFormat: 'INVALID',
        mode: 'interactive',
        correlationId: 'test-corr-id-124',
      });
    });

    it('should track conversion_timeout failures', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('docgen_failures_total', 1, {
        reason: 'conversion_timeout',
        templateId: '068xx000000002',
        outputFormat: 'PDF',
        mode: 'batch',
        correlationId: 'poll-789-xyz',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        reason: 'conversion_timeout',
        templateId: '068xx000000002',
        outputFormat: 'PDF',
        mode: 'batch',
        correlationId: 'poll-789-xyz',
      });
    });

    it('should track upload_failed failures', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('docgen_failures_total', 1, {
        reason: 'upload_failed',
        templateId: '068xx000000003',
        outputFormat: 'PDF',
        mode: 'interactive',
        correlationId: 'test-corr-id-125',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        reason: 'upload_failed',
        templateId: '068xx000000003',
        outputFormat: 'PDF',
        mode: 'interactive',
        correlationId: 'test-corr-id-125',
      });
    });
  });

  describe('trackMetric - queue_depth', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
    });

    it('should track current queue depth', () => {
      const { initializeAppInsights, trackGauge } = require('../src/obs/insights');
      initializeAppInsights();

      trackGauge('queue_depth', 42, {
        correlationId: 'poll-123-abc',
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(42, {
        correlationId: 'poll-123-abc',
      });
    });

    it('should track zero queue depth', () => {
      const { initializeAppInsights, trackGauge } = require('../src/obs/insights');
      initializeAppInsights();

      trackGauge('queue_depth', 0, {
        correlationId: 'poll-124-def',
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(0, {
        correlationId: 'poll-124-def',
      });
    });
  });

  describe('trackMetric - retries_total', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
    });

    it('should track first retry attempt', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('retries_total', 1, {
        attempt: 1,
        documentId: 'a00xx000000001',
        reason: 'conversion_timeout',
        correlationId: 'doc-corr-id-123',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        attempt: 1,
        documentId: 'a00xx000000001',
        reason: 'conversion_timeout',
        correlationId: 'doc-corr-id-123',
      });
    });

    it('should track second retry attempt', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('retries_total', 1, {
        attempt: 2,
        documentId: 'a00xx000000002',
        reason: 'upload_failed',
        correlationId: 'doc-corr-id-124',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        attempt: 2,
        documentId: 'a00xx000000002',
        reason: 'upload_failed',
        correlationId: 'doc-corr-id-124',
      });
    });

    it('should track third retry attempt', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('retries_total', 1, {
        attempt: 3,
        documentId: 'a00xx000000003',
        reason: 'conversion_timeout',
        correlationId: 'doc-corr-id-125',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        attempt: 3,
        documentId: 'a00xx000000003',
        reason: 'conversion_timeout',
        correlationId: 'doc-corr-id-125',
      });
    });
  });

  describe('trackDependency', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
    });

    it('should track successful Salesforce API dependency', () => {
      const { initializeAppInsights, trackDependency } = require('../src/obs/insights');
      initializeAppInsights();

      trackDependency({
        type: 'Salesforce REST API',
        name: 'POST /services/data/v58.0/sobjects/ContentVersion',
        duration: 450,
        success: true,
        correlationId: 'test-corr-id-126',
      });

      expect(mockSpan.end).toHaveBeenCalled();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('dependency.type', 'Salesforce REST API');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('dependency.name', 'POST /services/data/v58.0/sobjects/ContentVersion');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
    });

    it('should track failed Salesforce API dependency', () => {
      const { initializeAppInsights, trackDependency } = require('../src/obs/insights');
      initializeAppInsights();

      trackDependency({
        type: 'Salesforce REST API',
        name: 'GET /services/data/v58.0/sobjects/ContentVersion/068xx001',
        duration: 850,
        success: false,
        correlationId: 'test-corr-id-127',
        error: 'ContentVersion not found',
      });

      expect(mockSpan.end).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // SpanStatusCode.ERROR
      expect(mockSpan.recordException).toHaveBeenCalledWith('ContentVersion not found');
    });

    it('should track LibreOffice conversion dependency', () => {
      const { initializeAppInsights, trackDependency } = require('../src/obs/insights');
      initializeAppInsights();

      trackDependency({
        type: 'LibreOffice',
        name: 'DOCX to PDF conversion',
        duration: 3200,
        success: true,
        correlationId: 'test-corr-id-128',
      });

      expect(mockSpan.end).toHaveBeenCalled();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('dependency.type', 'LibreOffice');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('dependency.name', 'DOCX to PDF conversion');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
    });

    it('should track failed LibreOffice conversion dependency', () => {
      const { initializeAppInsights, trackDependency } = require('../src/obs/insights');
      initializeAppInsights();

      trackDependency({
        type: 'LibreOffice',
        name: 'DOCX to PDF conversion',
        duration: 60500,
        success: false,
        correlationId: 'test-corr-id-129',
        error: 'Conversion timeout after 60s',
      });

      expect(mockSpan.end).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // SpanStatusCode.ERROR
      expect(mockSpan.recordException).toHaveBeenCalledWith('Conversion timeout after 60s');
    });

    it('should not track dependencies in test environment', () => {
      process.env.NODE_ENV = 'test';

      const { initializeAppInsights, trackDependency } = require('../src/obs/insights');
      initializeAppInsights();

      trackDependency({
        type: 'Salesforce REST API',
        name: 'POST /services/data/v58.0/sobjects/ContentVersion',
        duration: 450,
        success: true,
        correlationId: 'test-corr-id-130',
      });

      expect(mockSpan.end).not.toHaveBeenCalled();
    });
  });

  describe('Bonus Metrics', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
    });

    it('should track template cache hits', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('template_cache_hit', 1, {
        templateId: '068xx000000001',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        templateId: '068xx000000001',
      });
    });

    it('should track template cache misses', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      trackMetric('template_cache_miss', 1, {
        templateId: '068xx000000002',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        templateId: '068xx000000002',
      });
    });

    it('should track conversion pool active jobs', () => {
      const { initializeAppInsights, trackGauge } = require('../src/obs/insights');
      initializeAppInsights();

      trackGauge('conversion_pool_active', 6, {});

      expect(mockHistogram.record).toHaveBeenCalledWith(6, {});
    });

    it('should track conversion pool queued jobs', () => {
      const { initializeAppInsights, trackGauge } = require('../src/obs/insights');
      initializeAppInsights();

      trackGauge('conversion_pool_queued', 3, {});

      expect(mockHistogram.record).toHaveBeenCalledWith(3, {});
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle metrics when not initialized', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.AZURE_MONITOR_CONNECTION_STRING;

      const { trackMetric } = require('../src/obs/insights');

      expect(() => {
        trackMetric('docgen_duration_ms', 2500, {
          templateId: '068xx000000001',
          outputFormat: 'PDF',
          mode: 'interactive',
        });
      }).not.toThrow();
    });

    it('should handle dependencies when not initialized', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.AZURE_MONITOR_CONNECTION_STRING;

      const { trackDependency } = require('../src/obs/insights');

      expect(() => {
        trackDependency({
          type: 'Salesforce REST API',
          name: 'GET /test',
          duration: 100,
          success: true,
          correlationId: 'test-id',
        });
      }).not.toThrow();
    });

    it('should handle gauges when not initialized', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.AZURE_MONITOR_CONNECTION_STRING;

      const { trackGauge } = require('../src/obs/insights');

      expect(() => {
        trackGauge('queue_depth', 10, {
          correlationId: 'test-id',
        });
      }).not.toThrow();
    });
  });

  describe('Correlation ID as Operation ID', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.AZURE_MONITOR_CONNECTION_STRING =
        'InstrumentationKey=test-key-12345';
    });

    it('should include correlation ID in all metrics', () => {
      const { initializeAppInsights, trackMetric } = require('../src/obs/insights');
      initializeAppInsights();

      const correlationId = 'corr-id-distributed-trace-123';

      trackMetric('docgen_duration_ms', 2500, {
        templateId: '068xx000000001',
        outputFormat: 'PDF',
        mode: 'interactive',
        correlationId,
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(
        2500,
        expect.objectContaining({
          correlationId,
        })
      );
    });

    it('should include correlation ID in all dependencies', () => {
      const { initializeAppInsights, trackDependency } = require('../src/obs/insights');
      initializeAppInsights();

      const correlationId = 'corr-id-distributed-trace-124';

      trackDependency({
        type: 'Salesforce REST API',
        name: 'GET /test',
        duration: 100,
        success: true,
        correlationId,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('correlationId', correlationId);
    });
  });
});
