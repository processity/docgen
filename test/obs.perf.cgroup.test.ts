/**
 * CPU and memory readings must come from the container cgroup, not the Node
 * process: LibreOffice runs as a `soffice` child process, so process.cpuUsage()
 * and process.memoryUsage() miss the service's dominant consumer. These tests
 * simulate the cgroup filesystem, which does not exist on macOS dev machines.
 */

// readFileSync is non-configurable, so the module is mocked rather than spied on.
// Only /sys/fs/cgroup paths are intercepted; everything else uses the real fs.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

import * as fs from 'fs';
import { getRuntimeSnapshot, resetPerfMetrics } from '../src/obs/perf';

const readFileSyncMock = fs.readFileSync as unknown as jest.Mock;
const actualReadFileSync = jest.requireActual('fs').readFileSync;

const CGROUP_V2 = {
  cpuStat: '/sys/fs/cgroup/cpu.stat',
  cpuMax: '/sys/fs/cgroup/cpu.max',
  memoryCurrent: '/sys/fs/cgroup/memory.current',
  memoryMax: '/sys/fs/cgroup/memory.max',
};

const CGROUP_V1 = {
  cpuUsage: '/sys/fs/cgroup/cpuacct/cpuacct.usage',
  cpuQuota: '/sys/fs/cgroup/cpu/cpu.cfs_quota_us',
  cpuPeriod: '/sys/fs/cgroup/cpu/cpu.cfs_period_us',
  memoryUsage: '/sys/fs/cgroup/memory/memory.usage_in_bytes',
  memoryLimit: '/sys/fs/cgroup/memory/memory.limit_in_bytes',
};

const MB = 1024 * 1024;

/**
 * Replace readFileSync with a lookup over `files`, so any path the code probes
 * that is not present behaves like a missing cgroup file.
 */
function mockCgroup(files: Record<string, () => string>) {
  readFileSyncMock.mockImplementation((path: unknown, ...rest: unknown[]) => {
    const key = String(path);
    if (!key.startsWith('/sys/fs/cgroup')) {
      return actualReadFileSync(path, ...rest);
    }
    if (files[key]) return files[key]();
    throw Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' });
  });
}

describe('Runtime metrics cgroup sourcing', () => {
  afterEach(() => {
    readFileSyncMock.mockImplementation(actualReadFileSync);
    jest.useRealTimers();
    resetPerfMetrics();
  });

  it('reads CPU and memory from cgroup v2 and reports the container total', () => {
    jest.useFakeTimers();
    resetPerfMetrics();

    let cpuUsageUsec = 1_000_000;
    mockCgroup({
      [CGROUP_V2.cpuStat]: () => `usage_usec ${cpuUsageUsec}\nuser_usec 1\nsystem_usec 1\n`,
      // 200000/100000 => 2 cores
      [CGROUP_V2.cpuMax]: () => '200000 100000',
      [CGROUP_V2.memoryCurrent]: () => String(1024 * MB),
      [CGROUP_V2.memoryMax]: () => String(4096 * MB),
    });

    // First snapshot starts the sampler and takes one data point
    const first = getRuntimeSnapshot();
    expect(first.cpu.source).toBe('cgroup-v2');
    expect(first.cpu.cores).toBe(2);
    expect(first.cpu.percent).toBeNull();

    // 5 seconds later the process has burned 5 CPU-seconds across 2 cores => 50%
    cpuUsageUsec += 5_000_000;
    jest.advanceTimersByTime(5000);

    const second = getRuntimeSnapshot();
    expect(second.cpu.percent).toBeCloseTo(50, 1);
    expect(second.cpu.sampleSeconds).toBeCloseTo(5, 1);

    expect(second.memory.source).toBe('cgroup-v2');
    expect(second.memory.usedMb).toBe(1024);
    expect(second.memory.limitMb).toBe(4096);
    expect(second.memory.percentOfLimit).toBe(25);
  });

  it('treats an unlimited cgroup v2 memory limit as no limit', () => {
    resetPerfMetrics();

    mockCgroup({
      [CGROUP_V2.cpuStat]: () => 'usage_usec 1000\n',
      [CGROUP_V2.cpuMax]: () => 'max 100000',
      [CGROUP_V2.memoryCurrent]: () => String(512 * MB),
      [CGROUP_V2.memoryMax]: () => 'max',
    });

    const snapshot = getRuntimeSnapshot();

    expect(snapshot.memory.usedMb).toBe(512);
    expect(snapshot.memory.limitMb).toBeNull();
    expect(snapshot.memory.percentOfLimit).toBeNull();
    // "max" quota means no CPU limit, so fall back to the host core count
    expect(snapshot.cpu.cores).toBeGreaterThan(0);
  });

  it('falls back to cgroup v1 paths', () => {
    resetPerfMetrics();

    mockCgroup({
      [CGROUP_V1.cpuUsage]: () => '2000000000', // nanoseconds
      [CGROUP_V1.cpuQuota]: () => '400000',
      [CGROUP_V1.cpuPeriod]: () => '100000',
      [CGROUP_V1.memoryUsage]: () => String(2048 * MB),
      [CGROUP_V1.memoryLimit]: () => String(8192 * MB),
    });

    const snapshot = getRuntimeSnapshot();

    expect(snapshot.cpu.source).toBe('cgroup-v1');
    expect(snapshot.cpu.cores).toBe(4);
    expect(snapshot.memory.source).toBe('cgroup-v1');
    expect(snapshot.memory.usedMb).toBe(2048);
    expect(snapshot.memory.limitMb).toBe(8192);
  });

  it('ignores the cgroup v1 sentinel used for "no memory limit"', () => {
    resetPerfMetrics();

    mockCgroup({
      [CGROUP_V1.cpuUsage]: () => '1000000',
      [CGROUP_V1.memoryUsage]: () => String(256 * MB),
      // cgroup v1 reports unlimited as a value near 2^63
      [CGROUP_V1.memoryLimit]: () => '9223372036854771712',
    });

    const snapshot = getRuntimeSnapshot();

    expect(snapshot.memory.usedMb).toBe(256);
    expect(snapshot.memory.limitMb).toBeNull();
  });

  it('labels the reading as process-only when no cgroup is present', () => {
    resetPerfMetrics();
    mockCgroup({});

    const snapshot = getRuntimeSnapshot();

    expect(snapshot.cpu.source).toBe('process');
    expect(snapshot.memory.source).toBe('process');
    expect(snapshot.memory.usedMb).toBeGreaterThan(0);
    expect(snapshot.memory.limitMb).toBeGreaterThan(0);
  });
});
