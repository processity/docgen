/**
 * Azure Application Insights observability wrapper using OpenTelemetry
 *
 * Provides:
 * - Metrics tracking (counters, histograms, gauges)
 * - Dependency tracking (Salesforce API, LibreOffice)
 * - Correlation ID propagation as operation ID
 * - Graceful degradation when App Insights unavailable
 */

import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { metrics, trace, context, SpanStatusCode } from '@opentelemetry/api';
import type {
  Counter,
  Histogram,
  Meter,
} from '@opentelemetry/api';
import { createLogger } from '../utils/logger';

const logger = createLogger('obs:insights');

// Service metadata
const SERVICE_NAME = 'docgen-service';
const SERVICE_VERSION = '1.0.0';

// Telemetry state
let isInitialized = false;
let telemetryEnabled = false;
let meter: Meter | null = null;

// Metric instruments
let docgenDurationHistogram: Histogram | null = null;
let docgenFailuresCounter: Counter | null = null;
let retriesTotalCounter: Counter | null = null;
let templateCacheHitCounter: Counter | null = null;
let templateCacheMissCounter: Counter | null = null;
let queueDepthHistogram: Histogram | null = null;
let conversionPoolActiveHistogram: Histogram | null = null;
let conversionPoolQueuedHistogram: Histogram | null = null;

/**
 * Initialize Azure Application Insights with OpenTelemetry
 *
 * Only initializes in production/development environments (not test).
 * Requires AZURE_MONITOR_CONNECTION_STRING environment variable.
 */
export function initializeAppInsights(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const connectionString = process.env.AZURE_MONITOR_CONNECTION_STRING;

  // Don't initialize in test environment
  if (nodeEnv === 'test') {
    logger.info('App Insights disabled in test environment');
    telemetryEnabled = false;
    isInitialized = true;
    return;
  }

  // Check for connection string
  if (!connectionString) {
    logger.warn(
      'AZURE_MONITOR_CONNECTION_STRING not set. App Insights telemetry disabled.'
    );
    telemetryEnabled = false;
    isInitialized = true;
    return;
  }

  try {
    // Initialize Azure Monitor with OpenTelemetry
    useAzureMonitor({
      azureMonitorExporterOptions: {
        connectionString,
      },
    });

    // Get OpenTelemetry meter for custom metrics
    meter = metrics.getMeter(SERVICE_NAME, SERVICE_VERSION);

    // Create metric instruments
    createMetricInstruments();

    telemetryEnabled = true;
    isInitialized = true;

    logger.info(
      { service: SERVICE_NAME, version: SERVICE_VERSION },
      'App Insights initialized successfully'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to initialize App Insights');
    telemetryEnabled = false;
    isInitialized = true;
  }
}

/**
 * Create all metric instruments
 */
function createMetricInstruments(): void {
  if (!meter) {
    return;
  }

  // Document generation duration (histogram for percentiles)
  docgenDurationHistogram = meter.createHistogram('docgen_duration_ms', {
    description: 'Document generation duration in milliseconds',
    unit: 'ms',
  });

  // Document generation failures (counter)
  docgenFailuresCounter = meter.createCounter('docgen_failures_total', {
    description: 'Total number of document generation failures',
  });

  // Retry attempts (counter)
  retriesTotalCounter = meter.createCounter('retries_total', {
    description: 'Total number of retry attempts',
  });

  // Template cache hits (counter)
  templateCacheHitCounter = meter.createCounter('template_cache_hit', {
    description: 'Template cache hit counter',
  });

  // Template cache misses (counter)
  templateCacheMissCounter = meter.createCounter('template_cache_miss', {
    description: 'Template cache miss counter',
  });

  // Queue depth (histogram for recording gauge-like values)
  queueDepthHistogram = meter.createHistogram('queue_depth', {
    description: 'Current number of queued documents',
  });

  // Conversion pool active jobs (histogram for recording gauge-like values)
  conversionPoolActiveHistogram = meter.createHistogram(
    'conversion_pool_active',
    {
      description: 'Number of active conversion jobs',
    }
  );

  // Conversion pool queued jobs (histogram for recording gauge-like values)
  conversionPoolQueuedHistogram = meter.createHistogram(
    'conversion_pool_queued',
    {
      description: 'Number of queued conversion jobs',
    }
  );

  logger.debug('Metric instruments created');
}

/**
 * Track a metric (counter or histogram)
 *
 * @param name - Metric name
 * @param value - Metric value
 * @param dimensions - Metric dimensions/attributes
 */
export function trackMetric(
  name: string,
  value: number,
  dimensions: Record<string, string | number> = {}
): void {
  if (!telemetryEnabled || !isInitialized) {
    return;
  }

  try {
    switch (name) {
      case 'docgen_duration_ms':
        docgenDurationHistogram?.record(value, dimensions);
        break;
      case 'docgen_failures_total':
        docgenFailuresCounter?.add(value, dimensions);
        break;
      case 'retries_total':
        retriesTotalCounter?.add(value, dimensions);
        break;
      case 'template_cache_hit':
        templateCacheHitCounter?.add(value, dimensions);
        break;
      case 'template_cache_miss':
        templateCacheMissCounter?.add(value, dimensions);
        break;
      default:
        logger.warn({ name }, 'Unknown metric name');
    }
  } catch (error) {
    logger.error({ error, name }, 'Failed to track metric');
  }
}

/**
 * Track a gauge metric (point-in-time measurement)
 *
 * @param name - Gauge name
 * @param value - Current value
 * @param dimensions - Metric dimensions/attributes
 */
export function trackGauge(
  name: string,
  value: number,
  dimensions: Record<string, string | number> = {}
): void {
  if (!telemetryEnabled || !isInitialized) {
    return;
  }

  try {
    // Use histograms to record gauge-like values
    switch (name) {
      case 'queue_depth':
        queueDepthHistogram?.record(value, dimensions);
        break;
      case 'conversion_pool_active':
        conversionPoolActiveHistogram?.record(value, dimensions);
        break;
      case 'conversion_pool_queued':
        conversionPoolQueuedHistogram?.record(value, dimensions);
        break;
      default:
        logger.warn({ name }, 'Unknown gauge name');
    }
  } catch (error) {
    logger.error({ error, name }, 'Failed to track gauge');
  }
}

/**
 * Dependency tracking options
 */
export interface DependencyOptions {
  /** Dependency type (e.g., "Salesforce REST API", "LibreOffice") */
  type: string;
  /** Dependency name (e.g., "POST /services/data/v58.0/sobjects/ContentVersion") */
  name: string;
  /** Duration in milliseconds */
  duration: number;
  /** Success status */
  success: boolean;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Optional error message for failed dependencies */
  error?: string;
}

/**
 * Track a dependency call (external service, LibreOffice, etc.)
 *
 * Uses OpenTelemetry spans for distributed tracing.
 *
 * @param options - Dependency tracking options
 */
export function trackDependency(options: DependencyOptions): void {
  if (!telemetryEnabled || !isInitialized) {
    return;
  }

  try {
    const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);
    const ctx = context.active();

    // Create a span for the dependency
    const span = tracer.startSpan(
      options.name,
      {
        startTime: Date.now() - options.duration,
      },
      ctx
    );

    // Set span attributes
    span.setAttribute('dependency.type', options.type);
    span.setAttribute('dependency.name', options.name);
    span.setAttribute('dependency.duration', options.duration);
    span.setAttribute('correlationId', options.correlationId);

    // Set span status
    if (options.success) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (options.error) {
        span.recordException(options.error);
      }
    }

    // End the span
    span.end();
  } catch (error) {
    logger.error({ error, options }, 'Failed to track dependency');
  }
}

/**
 * Check if telemetry is enabled
 */
export function isTelemetryEnabled(): boolean {
  return telemetryEnabled;
}

/**
 * Check if App Insights is initialized
 */
export function isAppInsightsInitialized(): boolean {
  return isInitialized;
}
