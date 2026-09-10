import {
  recordStage,
  recordDocument,
  timeStage,
  getPerformanceSnapshot,
  getRuntimeSnapshot,
  resetPerfMetrics,
} from '../src/obs/perf';

describe('Performance metrics registry', () => {
  beforeEach(() => {
    resetPerfMetrics();
    delete process.env.METRICS_WINDOW_MINUTES;
  });

  afterAll(() => {
    resetPerfMetrics();
    delete process.env.METRICS_WINDOW_MINUTES;
  });

  describe('empty state', () => {
    it('reports no samples rather than zeroed metrics', () => {
      const snapshot = getPerformanceSnapshot();

      expect(snapshot.documents.count).toBe(0);
      expect(snapshot.documents.latency).toBeNull();
      expect(snapshot.documents.successRatePercent).toBeNull();
      expect(snapshot.stages).toEqual([]);
      expect(snapshot.slowestStageByTotalTime).toBeNull();
    });

    it('always identifies the replica so callers can label the sample', () => {
      expect(getPerformanceSnapshot().replicaId).toBeTruthy();
      expect(getRuntimeSnapshot().replicaId).toBeTruthy();
    });
  });

  describe('document samples', () => {
    it('computes latency percentiles over the window', () => {
      // 1..10 seconds so nearest-rank percentiles are easy to verify
      for (let i = 1; i <= 10; i++) {
        recordDocument({ durationMs: i * 1000, success: true, outputFormat: 'PDF', mode: 'batch' });
      }

      const { documents } = getPerformanceSnapshot();

      expect(documents.count).toBe(10);
      expect(documents.latency).toEqual({
        p50Ms: 5000,
        p95Ms: 10000,
        p99Ms: 10000,
        avgMs: 5500,
        maxMs: 10000,
      });
    });

    it('tracks success rate across successes and failures', () => {
      recordDocument({ durationMs: 100, success: true, outputFormat: 'PDF', mode: 'batch' });
      recordDocument({ durationMs: 200, success: true, outputFormat: 'PDF', mode: 'batch' });
      recordDocument({ durationMs: 300, success: false, outputFormat: 'PDF', mode: 'batch' });
      recordDocument({ durationMs: 400, success: false, outputFormat: 'PDF', mode: 'batch' });

      const { documents } = getPerformanceSnapshot();

      expect(documents.succeeded).toBe(2);
      expect(documents.failed).toBe(2);
      expect(documents.successRatePercent).toBe(50);
    });

    it('breaks volume down by output format and mode', () => {
      recordDocument({ durationMs: 1000, success: true, outputFormat: 'PDF', mode: 'batch' });
      recordDocument({ durationMs: 3000, success: true, outputFormat: 'PDF', mode: 'interactive' });
      recordDocument({ durationMs: 500, success: true, outputFormat: 'DOCX', mode: 'batch' });

      const { documents } = getPerformanceSnapshot();

      expect(documents.byOutputFormat).toEqual([
        { key: 'PDF', count: 2, avgMs: 2000, p95Ms: 3000 },
        { key: 'DOCX', count: 1, avgMs: 500, p95Ms: 500 },
      ]);
      expect(documents.byMode.map((entry) => entry.key).sort()).toEqual(['batch', 'interactive']);
    });

    it('derives throughput from the observed period, not the full window', () => {
      recordDocument({ durationMs: 100, success: true, outputFormat: 'PDF', mode: 'batch' });
      recordDocument({ durationMs: 100, success: true, outputFormat: 'PDF', mode: 'batch' });

      const snapshot = getPerformanceSnapshot();

      // A process that has only been up a few seconds must not be reported as
      // idle just because the window is an hour long.
      expect(snapshot.observedSeconds).toBeLessThanOrEqual(snapshot.windowSeconds);
      expect(snapshot.observedSeconds).toBeGreaterThan(0);
      expect(snapshot.documents.perHour).toBeCloseTo(
        (2 / snapshot.observedSeconds) * 3600,
        1
      );
    });

    it('labels unknown format and mode instead of dropping the sample', () => {
      recordDocument({ durationMs: 100, success: true });

      const { documents } = getPerformanceSnapshot();

      expect(documents.count).toBe(1);
      expect(documents.byOutputFormat[0].key).toBe('UNKNOWN');
      expect(documents.byMode[0].key).toBe('unknown');
    });
  });

  describe('stage samples', () => {
    it('ranks stages by accumulated time', () => {
      recordStage('merge', 100);
      recordStage('merge', 100);
      recordStage('pdfConvert', 900);
      recordStage('templateFetch', 5);

      const snapshot = getPerformanceSnapshot();

      expect(snapshot.stages.map((stage) => stage.stage)).toEqual([
        'pdfConvert',
        'merge',
        'templateFetch',
      ]);
      expect(snapshot.slowestStageByTotalTime).toBe('pdfConvert');
      expect(snapshot.stages[1]).toEqual({
        stage: 'merge',
        count: 2,
        errorCount: 0,
        totalMs: 200,
        avgMs: 100,
        p50Ms: 100,
        p95Ms: 100,
        maxMs: 100,
      });
    });

    it('counts failed stage attempts separately', () => {
      recordStage('pdfConvert', 60000, false);
      recordStage('pdfConvert', 1000, true);

      const stage = getPerformanceSnapshot().stages.find((s) => s.stage === 'pdfConvert');

      expect(stage).toMatchObject({ count: 2, errorCount: 1, maxMs: 60000 });
    });
  });

  describe('timeStage', () => {
    it('records a resolved call', async () => {
      const result = await timeStage('merge', async () => 'done');

      expect(result).toBe('done');
      expect(getPerformanceSnapshot().stages.find((s) => s.stage === 'merge')).toMatchObject({
        count: 1,
        errorCount: 0,
      });
    });

    it('records a rejected call and rethrows the original error', async () => {
      const boom = new Error('boom');

      await expect(
        timeStage('pdfConvert', async () => {
          throw boom;
        })
      ).rejects.toBe(boom);

      expect(getPerformanceSnapshot().stages.find((s) => s.stage === 'pdfConvert')).toMatchObject({
        count: 1,
        errorCount: 1,
      });
    });
  });

  describe('rolling window', () => {
    it('drops samples older than the configured window', () => {
      jest.useFakeTimers();
      try {
        process.env.METRICS_WINDOW_MINUTES = '1';

        recordDocument({ durationMs: 100, success: true, outputFormat: 'PDF', mode: 'batch' });
        recordStage('merge', 100);
        expect(getPerformanceSnapshot().documents.count).toBe(1);

        jest.advanceTimersByTime(61 * 1000);

        const snapshot = getPerformanceSnapshot();
        expect(snapshot.documents.count).toBe(0);
        expect(snapshot.stages).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('clamps an out-of-range window to the supported maximum', () => {
      process.env.METRICS_WINDOW_MINUTES = '99999';

      expect(getPerformanceSnapshot().windowSeconds).toBe(1440 * 60);
    });

    it('falls back to the default window when the value is not a number', () => {
      process.env.METRICS_WINDOW_MINUTES = 'not-a-number';

      expect(getPerformanceSnapshot().windowSeconds).toBe(60 * 60);
    });
  });

  describe('runtime snapshot', () => {
    it('reports memory and process identity with a labeled source', () => {
      const runtime = getRuntimeSnapshot();

      expect(runtime.pid).toBe(process.pid);
      expect(runtime.processUptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(['cgroup-v2', 'cgroup-v1', 'process']).toContain(runtime.memory.source);
      expect(runtime.memory.node.rssMb).toBeGreaterThan(0);
      expect(runtime.memory.node.heapUsedMb).toBeGreaterThan(0);
    });

    it('reports CPU capacity and a labeled measurement source', () => {
      const runtime = getRuntimeSnapshot();

      expect(runtime.cpu.cores).toBeGreaterThan(0);
      expect(['cgroup-v2', 'cgroup-v1', 'process']).toContain(runtime.cpu.source);
      // Percent is null until the sampler has two data points.
      expect(runtime.cpu.percent === null || runtime.cpu.percent >= 0).toBe(true);
    });
  });
});
