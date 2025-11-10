/**
 * Observability module exports
 */

export {
  initializeAppInsights,
  trackMetric,
  trackGauge,
  trackDependency,
  isTelemetryEnabled,
  isAppInsightsInitialized,
  type DependencyOptions,
} from './insights';
