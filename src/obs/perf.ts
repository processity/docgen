/**
 * In-process performance and runtime metrics registry
 *
 * Complements App Insights (src/obs/insights.ts) by keeping a short rolling
 * window of samples in memory so the Salesforce status page can read live
 * numbers without an App Insights query pipeline.
 *
 * Scope and caveats:
 * - Per-replica. In multi-replica deployments (ACA 1-5 replicas) a Salesforce
 *   callout lands on an arbitrary replica, so callers must display `replicaId`
 *   and handle the "no samples yet on this replica" case.
 * - Time-bounded window (METRICS_WINDOW_MINUTES, default 60) for both stage
 *   and document samples, so latency percentiles and stage stats always
 *   describe the same period.
 * - Stages are recorded at leaf call sites only (soffice conversion, template
 *   fetch, merge, upload, ...) so per-stage totals do not double-count nested
 *   work. They still do not sum to end-to-end duration, because orchestration,
 *   Salesforce status updates and JSON handling sit outside any stage.
 */

import os from 'os';
import { readFileSync } from 'fs';
import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';
import { createLogger } from '../utils/logger';

const logger = createLogger('obs:perf');

const DEFAULT_WINDOW_MINUTES = 60;
const MIN_WINDOW_MINUTES = 1;
const MAX_WINDOW_MINUTES = 1440;

/** Hard cap per series so a burst cannot grow memory without bound. */
const MAX_SAMPLES_PER_SERIES = 10000;

/** CPU sampler period and ring size (13 samples at 5s => ~60s average). */
const CPU_SAMPLE_INTERVAL_MS = 5000;
const CPU_SAMPLE_RING_SIZE = 13;

/** Pipeline stages recorded by the instrumented services. */
export type PipelineStage =
  | 'templateFetch'
  | 'merge'
  | 'concatenate'
  | 'pdfConvert'
  | 'pdfAttachments'
  | 'previewRender'
  | 'sfUpload';

interface StageSample {
  t: number;
  ms: number;
  ok: boolean;
}

interface DocumentSample {
  t: number;
  ms: number;
  success: boolean;
  outputFormat: string;
  mode: string;
}

export interface StageSummary {
  stage: string;
  count: number;
  errorCount: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface LatencySummary {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
}

export interface BreakdownEntry {
  key: string;
  count: number;
  avgMs: number;
  p95Ms: number;
}

export interface PerformanceSnapshot {
  replicaId: string;
  /** Configured rolling window length. */
  windowSeconds: number;
  /** Denominator used for throughput: min(window, process uptime). */
  observedSeconds: number;
  processUptimeSeconds: number;
  documents: {
    count: number;
    succeeded: number;
    failed: number;
    successRatePercent: number | null;
    perMinute: number;
    perHour: number;
    latency: LatencySummary | null;
    byOutputFormat: BreakdownEntry[];
    byMode: BreakdownEntry[];
  };
  stages: StageSummary[];
  /** Stage with the highest accumulated time in the window, if any. */
  slowestStageByTotalTime: string | null;
}

export interface RuntimeSnapshot {
  replicaId: string;
  pid: number;
  processUptimeSeconds: number;
  cpu: {
    /** Percent of all available cores, or null until two samples exist. */
    percent: number | null;
    cores: number;
    source: MetricSource;
    sampleSeconds: number | null;
  };
  memory: {
    source: MetricSource;
    usedMb: number | null;
    limitMb: number | null;
    percentOfLimit: number | null;
    node: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
      externalMb: number;
    };
  };
  eventLoopDelayMs: { p50: number; p99: number; max: number } | null;
}

export type MetricSource = 'cgroup-v2' | 'cgroup-v1' | 'process';

// ---------------------------------------------------------------------------
// Sample storage
// ---------------------------------------------------------------------------

const stageSamples = new Map<string, StageSample[]>();
let documentSamples: DocumentSample[] = [];

function windowMs(): number {
  const raw = parseInt(process.env.METRICS_WINDOW_MINUTES || '', 10);
  const minutes = Number.isFinite(raw)
    ? Math.min(MAX_WINDOW_MINUTES, Math.max(MIN_WINDOW_MINUTES, raw))
    : DEFAULT_WINDOW_MINUTES;
  return minutes * 60 * 1000;
}

/** Drop samples older than the window. Samples are appended in time order. */
function prune<T extends { t: number }>(samples: T[], cutoff: number): T[] {
  let firstFresh = 0;
  while (firstFresh < samples.length && samples[firstFresh].t < cutoff) {
    firstFresh++;
  }
  return firstFresh === 0 ? samples : samples.slice(firstFresh);
}

/**
 * Record the duration of a single pipeline stage.
 * Called from leaf services so both the interactive and batch paths are covered.
 */
export function recordStage(stage: PipelineStage, durationMs: number, ok: boolean = true): void {
  const now = Date.now();
  const existing = stageSamples.get(stage) ?? [];
  const pruned = prune(existing, now - windowMs());

  pruned.push({ t: now, ms: durationMs, ok });
  if (pruned.length > MAX_SAMPLES_PER_SERIES) {
    pruned.splice(0, pruned.length - MAX_SAMPLES_PER_SERIES);
  }

  stageSamples.set(stage, pruned);
}

/** Time an async stage and record its duration whether it resolves or throws. */
export async function timeStage<T>(stage: PipelineStage, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  let ok = true;
  try {
    return await fn();
  } catch (error) {
    ok = false;
    throw error;
  } finally {
    recordStage(stage, Date.now() - started, ok);
  }
}

/** Record one completed document generation (success or permanent failure). */
export function recordDocument(sample: {
  durationMs: number;
  success: boolean;
  outputFormat?: string;
  mode?: string;
}): void {
  const now = Date.now();
  documentSamples = prune(documentSamples, now - windowMs());

  documentSamples.push({
    t: now,
    ms: sample.durationMs,
    success: sample.success,
    outputFormat: sample.outputFormat || 'UNKNOWN',
    mode: sample.mode || 'unknown',
  });

  if (documentSamples.length > MAX_SAMPLES_PER_SERIES) {
    documentSamples.splice(0, documentSamples.length - MAX_SAMPLES_PER_SERIES);
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Nearest-rank percentile over an ascending array. */
function percentile(ascending: number[], p: number): number {
  if (ascending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * ascending.length) - 1;
  return ascending[Math.min(ascending.length - 1, Math.max(0, rank))];
}

function round(value: number, decimals: number = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function summarizeDurations(durations: number[]): LatencySummary | null {
  if (durations.length === 0) return null;
  const ascending = [...durations].sort((a, b) => a - b);
  const total = ascending.reduce((sum, ms) => sum + ms, 0);

  return {
    p50Ms: percentile(ascending, 50),
    p95Ms: percentile(ascending, 95),
    p99Ms: percentile(ascending, 99),
    avgMs: Math.round(total / ascending.length),
    maxMs: ascending[ascending.length - 1],
  };
}

function breakdownBy(samples: DocumentSample[], key: 'outputFormat' | 'mode'): BreakdownEntry[] {
  const groups = new Map<string, number[]>();
  for (const sample of samples) {
    const group = groups.get(sample[key]) ?? [];
    group.push(sample.ms);
    groups.set(sample[key], group);
  }

  return Array.from(groups.entries())
    .map(([groupKey, durations]) => {
      const ascending = [...durations].sort((a, b) => a - b);
      const total = ascending.reduce((sum, ms) => sum + ms, 0);
      return {
        key: groupKey,
        count: ascending.length,
        avgMs: Math.round(total / ascending.length),
        p95Ms: percentile(ascending, 95),
      };
    })
    .sort((a, b) => b.count - a.count);
}

export function getPerformanceSnapshot(): PerformanceSnapshot {
  const now = Date.now();
  const window = windowMs();
  const cutoff = now - window;
  const uptimeSeconds = Math.floor(process.uptime());

  documentSamples = prune(documentSamples, cutoff);

  const stages: StageSummary[] = [];
  for (const [stage, samples] of stageSamples) {
    const fresh = prune(samples, cutoff);
    stageSamples.set(stage, fresh);
    if (fresh.length === 0) continue;

    const ascending = fresh.map((sample) => sample.ms).sort((a, b) => a - b);
    const totalMs = ascending.reduce((sum, ms) => sum + ms, 0);

    stages.push({
      stage,
      count: fresh.length,
      errorCount: fresh.filter((sample) => !sample.ok).length,
      totalMs,
      avgMs: Math.round(totalMs / fresh.length),
      p50Ms: percentile(ascending, 50),
      p95Ms: percentile(ascending, 95),
      maxMs: ascending[ascending.length - 1],
    });
  }
  stages.sort((a, b) => b.totalMs - a.totalMs);

  const succeeded = documentSamples.filter((sample) => sample.success).length;
  const failed = documentSamples.length - succeeded;

  // Throughput over the shorter of the window and how long this replica has
  // been up, so a freshly restarted replica is not reported as idle.
  const observedSeconds = Math.max(1, Math.min(Math.floor(window / 1000), uptimeSeconds));

  return {
    replicaId: getReplicaId(),
    windowSeconds: Math.floor(window / 1000),
    observedSeconds,
    processUptimeSeconds: uptimeSeconds,
    documents: {
      count: documentSamples.length,
      succeeded,
      failed,
      successRatePercent:
        documentSamples.length > 0 ? round((succeeded / documentSamples.length) * 100) : null,
      perMinute: round((documentSamples.length / observedSeconds) * 60, 2),
      perHour: round((documentSamples.length / observedSeconds) * 3600, 1),
      latency: summarizeDurations(documentSamples.map((sample) => sample.ms)),
      byOutputFormat: breakdownBy(documentSamples, 'outputFormat'),
      byMode: breakdownBy(documentSamples, 'mode'),
    },
    stages,
    slowestStageByTotalTime: stages.length > 0 ? stages[0].stage : null,
  };
}

// ---------------------------------------------------------------------------
// Runtime metrics (CPU / memory / event loop)
// ---------------------------------------------------------------------------

/**
 * Replica identity. Azure Container Apps sets CONTAINER_APP_REPLICA_NAME;
 * hostname is the fallback elsewhere.
 */
export function getReplicaId(): string {
  return process.env.CONTAINER_APP_REPLICA_NAME || os.hostname();
}

function readNumberFile(path: string): number | null {
  try {
    const value = parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Total CPU time consumed, in microseconds.
 *
 * Read from the cgroup where available: LibreOffice runs as a child process
 * (`soffice --headless`), so process.cpuUsage() would miss the service's
 * dominant CPU consumer entirely.
 */
function readCpuUsageUsec(): { usec: number; source: MetricSource } | null {
  try {
    const cpuStat = readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    const match = cpuStat.match(/^usage_usec\s+(\d+)$/m);
    if (match) {
      return { usec: parseInt(match[1], 10), source: 'cgroup-v2' };
    }
  } catch {
    // Not cgroup v2 - fall through
  }

  const v1Nanos = readNumberFile('/sys/fs/cgroup/cpuacct/cpuacct.usage');
  if (v1Nanos !== null) {
    return { usec: Math.floor(v1Nanos / 1000), source: 'cgroup-v1' };
  }

  const usage = process.cpuUsage();
  return { usec: usage.user + usage.system, source: 'process' };
}

let cachedCores: number | null = null;

/** CPU cores available to this container, from the cgroup quota when set. */
function readCpuCores(): number {
  if (cachedCores !== null) return cachedCores;
  cachedCores = detectCpuCores();
  return cachedCores;
}

function detectCpuCores(): number {
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max') {
      const cores = parseInt(quota, 10) / parseInt(period, 10);
      if (Number.isFinite(cores) && cores > 0) return cores;
    }
  } catch {
    // Not cgroup v2 - fall through
  }

  const v1Quota = readNumberFile('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');
  const v1Period = readNumberFile('/sys/fs/cgroup/cpu/cpu.cfs_period_us');
  if (v1Quota !== null && v1Quota > 0 && v1Period !== null && v1Period > 0) {
    return v1Quota / v1Period;
  }

  return os.cpus().length || 1;
}

interface MemoryReading {
  usedBytes: number | null;
  limitBytes: number | null;
  source: MetricSource;
}

function readMemory(): MemoryReading {
  const v2Used = readNumberFile('/sys/fs/cgroup/memory.current');
  if (v2Used !== null) {
    let limit: number | null = null;
    try {
      const raw = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
      limit = raw === 'max' ? null : parseInt(raw, 10);
    } catch {
      limit = null;
    }
    return { usedBytes: v2Used, limitBytes: limit, source: 'cgroup-v2' };
  }

  const v1Used = readNumberFile('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  if (v1Used !== null) {
    const v1Limit = readNumberFile('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    // cgroup v1 reports "unlimited" as a value near 2^63; treat anything above
    // physical memory as unset.
    const limit = v1Limit !== null && v1Limit < os.totalmem() * 2 ? v1Limit : null;
    return { usedBytes: v1Used, limitBytes: limit, source: 'cgroup-v1' };
  }

  return {
    usedBytes: process.memoryUsage().rss,
    limitBytes: os.totalmem(),
    source: 'process',
  };
}

interface CpuSample {
  t: number;
  usec: number;
}

let cpuRing: CpuSample[] = [];
let cpuSource: MetricSource = 'process';
let cpuSampler: NodeJS.Timeout | null = null;

function sampleCpu(): void {
  const reading = readCpuUsageUsec();
  if (!reading) return;

  cpuSource = reading.source;
  cpuRing.push({ t: Date.now(), usec: reading.usec });
  if (cpuRing.length > CPU_SAMPLE_RING_SIZE) {
    cpuRing.shift();
  }
}

/**
 * Start the background CPU sampler. The timer is unref'd so it never keeps the
 * process (or a test run) alive.
 */
export function startCpuSampler(): void {
  if (cpuSampler) return;

  sampleCpu();
  cpuSampler = setInterval(sampleCpu, CPU_SAMPLE_INTERVAL_MS);
  cpuSampler.unref();
}

export function stopCpuSampler(): void {
  if (cpuSampler) {
    clearInterval(cpuSampler);
    cpuSampler = null;
  }
}

let eventLoopHistogram: IntervalHistogram | null = null;

/** Enabled on first read so nothing is monitored in processes that never ask. */
function getEventLoopHistogram(): IntervalHistogram | null {
  if (!eventLoopHistogram) {
    try {
      eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
      eventLoopHistogram.enable();
      return null; // No meaningful data on the very first read
    } catch (error) {
      logger.warn({ error }, 'Event loop delay monitoring unavailable');
      return null;
    }
  }
  return eventLoopHistogram;
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  // Idempotent: normally already started by the server, this covers other callers.
  startCpuSampler();

  let cpuPercent: number | null = null;
  let sampleSeconds: number | null = null;
  const cores = readCpuCores();

  if (cpuRing.length >= 2) {
    const oldest = cpuRing[0];
    const newest = cpuRing[cpuRing.length - 1];
    const elapsedMs = newest.t - oldest.t;
    if (elapsedMs > 0) {
      const cpuMs = (newest.usec - oldest.usec) / 1000;
      cpuPercent = round(Math.max(0, (cpuMs / (elapsedMs * cores)) * 100));
      sampleSeconds = round(elapsedMs / 1000);
    }
  }

  const memory = readMemory();
  const nodeMemory = process.memoryUsage();
  const toMb = (bytes: number) => round(bytes / (1024 * 1024));

  const histogram = getEventLoopHistogram();

  return {
    replicaId: getReplicaId(),
    pid: process.pid,
    processUptimeSeconds: Math.floor(process.uptime()),
    cpu: {
      percent: cpuPercent,
      cores: round(cores, 2),
      source: cpuSource,
      sampleSeconds,
    },
    memory: {
      source: memory.source,
      usedMb: memory.usedBytes !== null ? toMb(memory.usedBytes) : null,
      limitMb: memory.limitBytes !== null ? toMb(memory.limitBytes) : null,
      percentOfLimit:
        memory.usedBytes !== null && memory.limitBytes !== null && memory.limitBytes > 0
          ? round((memory.usedBytes / memory.limitBytes) * 100)
          : null,
      node: {
        rssMb: toMb(nodeMemory.rss),
        heapUsedMb: toMb(nodeMemory.heapUsed),
        heapTotalMb: toMb(nodeMemory.heapTotal),
        externalMb: toMb(nodeMemory.external),
      },
    },
    eventLoopDelayMs: histogram
      ? {
          p50: round(histogram.percentile(50) / 1e6, 2),
          p99: round(histogram.percentile(99) / 1e6, 2),
          max: round(histogram.max / 1e6, 2),
        }
      : null,
  };
}

/** Clear all samples and stop background collection. Used by tests. */
export function resetPerfMetrics(): void {
  stageSamples.clear();
  documentSamples = [];
  cpuRing = [];
  cpuSource = 'process';
  cachedCores = null;
  stopCpuSampler();

  if (eventLoopHistogram) {
    eventLoopHistogram.disable();
    eventLoopHistogram = null;
  }
}
