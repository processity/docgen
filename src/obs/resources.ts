import { getRuntimeSnapshot } from './perf';
import { getLibreOfficeConverter } from '../convert/soffice';
import { templateCache } from '../templates/cache';
import { emitFleetMetric, hasFleetMetricsConfiguration } from './fleet-events';

export function getResourceSnapshot() {
  const runtime = getRuntimeSnapshot();

  const converter = getLibreOfficeConverter();
  const poolStats = converter.getStats();
  const maxConcurrent = converter.getMaxConcurrent();
  const activeJobs = converter.getActiveJobs();

  const cacheStats = templateCache.getStats();
  const cacheLookups = cacheStats.hits + cacheStats.misses;
  const maxCacheBytes = templateCache.getMaxSizeBytes();
  const toMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

  return {
    ...runtime,
    libreOfficePool: {
      activeJobs,
      queuedJobs: converter.getQueuedJobs(),
      maxConcurrent,
      utilizationPercent:
        maxConcurrent > 0 ? Math.round((activeJobs / maxConcurrent) * 1000) / 10 : null,
      completedJobs: poolStats.completedJobs,
      failedJobs: poolStats.failedJobs,
      totalConversions: poolStats.totalConversions,
    },
    templateCache: {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRatePercent:
        cacheLookups > 0 ? Math.round((cacheStats.hits / cacheLookups) * 1000) / 10 : null,
      lookups: cacheLookups,
      entryCount: cacheStats.entryCount,
      evictions: cacheStats.evictions,
      sizeMb: toMb(cacheStats.currentSize),
      maxSizeMb: toMb(maxCacheBytes),
      utilizationPercent:
        maxCacheBytes > 0 ? Math.round((cacheStats.currentSize / maxCacheBytes) * 1000) / 10 : null,
    },
  };
}

export type ResourceSnapshot = ReturnType<typeof getResourceSnapshot>;

export function startFleetHeartbeat(): () => void {
  if (!hasFleetMetricsConfiguration()) return () => {};
  const publish = () => {
    try {
      emitFleetMetric('resource', getResourceSnapshot());
    } catch {
      /* Retry next interval. */
    }
  };
  publish();
  const timer = setInterval(publish, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
