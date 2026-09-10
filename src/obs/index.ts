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

export {
  recordStage,
  recordDocument,
  timeStage,
  getPerformanceSnapshot,
  getRuntimeSnapshot,
  getReplicaId,
  startCpuSampler,
  stopCpuSampler,
  resetPerfMetrics,
  type PipelineStage,
  type PerformanceSnapshot,
  type RuntimeSnapshot,
  type StageSummary,
} from './perf';
