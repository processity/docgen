import { aggregateFleet, createFleetReader, fleetQuery, FleetRow } from '../src/obs/fleet';

const mockToken = jest.fn();
jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest
    .fn()
    .mockImplementation(() => ({ getToken: (...args: any[]) => mockToken(...args) })),
}));
const APP =
  '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.App/containerApps/docgen';
const NOW = new Date('2026-09-10T12:00:00Z');
const inventory = [
  { replicaId: 'a', revision: 'rev1' },
  { replicaId: 'b', revision: 'rev2' },
];
function resource(
  key: string,
  cores: number,
  cpu: number,
  limit: number,
  used: number,
  hits: number,
  misses: number
): FleetRow {
  return {
    kind: 'resource',
    key,
    value: {
      at: '2026-09-10T11:59:00Z',
      revision: 'rev1',
      snapshot: {
        cpu: { cores, percent: cpu, source: 'cgroup-v2' },
        memory: { usedMb: used, limitMb: limit, source: 'cgroup-v2' },
        libreOfficePool: { activeJobs: 1, maxConcurrent: 4, queuedJobs: 2 },
        templateCache: { hits, misses, sizeMb: 2, maxSizeMb: 100 },
      },
    },
  };
}
const samples = () => [
  resource('a', 1, 80, 1024, 512, 90, 10),
  resource('b', 3, 20, 3072, 512, 0, 1),
];

describe('fleet aggregation', () => {
  it('weights CPU and memory by capacity and cache hits by lookups, not mean percentages', () => {
    const result = aggregateFleet(samples(), inventory, NOW);
    expect(result.coverage).toMatchObject({
      complete: true,
      activeReplicas: 2,
      reportingReplicas: 2,
    });
    expect(result.resources).toMatchObject({
      cpuPercent: 35,
      memoryPercent: 25,
      cores: 4,
      memoryUsedMb: 1024,
      memoryLimitMb: 4096,
      cacheHitRatePercent: 89.1,
      activeJobs: 2,
      maxConcurrent: 8,
      queuedJobs: 4,
    });
  });
  it('lists missing replicas and withholds fleet totals instead of under-reporting usage', () => {
    const result = aggregateFleet(samples().slice(0, 1), inventory, NOW);
    expect(result.coverage.complete).toBe(false);
    expect(result.replicas.find((replica) => replica.replicaId === 'b')).toMatchObject({
      active: true,
      freshness: 'missing',
    });
    expect(result.resources.cpuPercent).toBeNull();
    expect(result.resources.memoryUsedMb).toBeNull();
    expect(result.resources.activeJobs).toBeNull();
  });
  it('excludes stale readings and retains historical completions when replicas stop', () => {
    const rows = samples();
    rows[1].value.at = '2026-09-10T11:50:00Z';
    const result = aggregateFleet(rows, inventory, NOW);
    expect(result.coverage.reportingReplicas).toBe(1);
    expect(result.resources.cores).toBeNull();
    const stopped = aggregateFleet(
      [...samples(), { kind: 'replicaDocuments', key: 'old', value: { count: 12, p95Ms: 4000 } }],
      inventory,
      NOW
    );
    expect(stopped.replicas.find((replica) => replica.replicaId === 'old')).toMatchObject({
      active: false,
      documents: { count: 12 },
    });
    expect(stopped.resources.cores).toBe(4);
  });
  it('preserves shared event percentiles and never combines per-replica percentiles', () => {
    const result = aggregateFleet(
      [
        ...samples(),
        {
          kind: 'documents',
          key: 'all',
          value: {
            count: 100,
            succeeded: 99,
            failed: 1,
            avgMs: 120,
            p50Ms: 50,
            p95Ms: 900,
            p99Ms: 950,
            maxMs: 1000,
          },
        },
        { kind: 'replicaDocuments', key: 'a', value: { count: 99, p95Ms: 50 } },
        { kind: 'replicaDocuments', key: 'b', value: { count: 1, p95Ms: 1000 } },
      ],
      inventory,
      NOW
    );
    expect(result.performance?.documents.latency?.p95Ms).toBe(900);
    expect(result.performance?.documents.perHour).toBe(100);
  });
  it('marks inventory failures, empty telemetry, and process-only resource coverage as unavailable', () => {
    expect(aggregateFleet(samples(), null, NOW).coverage.inventoryAvailable).toBe(false);
    expect(aggregateFleet(samples(), null, NOW).resources.cpuPercent).toBeNull();
    expect(aggregateFleet([], inventory, NOW).performance).toBeNull();
    const rows = samples();
    rows[0].value.snapshot.cpu.source = 'process';
    rows[0].value.snapshot.memory.limitMb = null;
    expect(aggregateFleet(rows, inventory, NOW).resources.cpuPercent).toBeNull();
    expect(aggregateFleet(rows, inventory, NOW).resources.memoryPercent).toBeNull();
  });
});

describe('shared fleet reader', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  const response = (body: any, ok = true) => ({ ok, json: async () => body });
  const logsBody = (rows: FleetRow[] = []) => ({
    tables: [
      {
        name: 'PrimaryResult',
        columns: [{ name: 'kind' }, { name: 'key' }, { name: 'value' }],
        rows: rows.map((row) => [row.kind, row.key, JSON.stringify(row.value)]),
      },
    ],
  });
  beforeEach(() => {
    process.env.FLEET_METRICS_APP_RESOURCE_ID = APP;
    process.env.FLEET_METRICS_WORKSPACE_ID = 'f7f7cbf0-dd54-4201-8049-612c954a46ff';
    mockToken.mockResolvedValue({ token: 'test-token' });
    global.fetch = fetchMock;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/query')) return response(logsBody());
      if (url.includes('/replicas')) return response({ value: [{ name: 'a' }] });
      return response({ value: [{ name: 'rev1', properties: { active: true } }] });
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
    delete process.env.FLEET_METRICS_APP_RESOURCE_ID;
  delete process.env.FLEET_METRICS_WORKSPACE_ID;
    delete process.env.FLEET_METRICS_WORKSPACE_ID;
  });
  it('works without an enable flag and shares the query across concurrent callers and refreshes', async () => {
    const read = createFleetReader();
    const [one, two] = await Promise.all([read(), read()]);
    expect(one).toEqual(two);
    expect(one.coverage.activeReplicas).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await read();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('lists every page of active revisions and replica inventory', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/query')) return response(logsBody());
      if (url.includes('/replicas') && url.includes('page=2'))
        return response({ value: [{ name: 'b' }] });
      if (url.includes('/replicas'))
        return response({
          value: [{ name: 'a' }],
          nextLink: `https://management.azure.com${APP}/revisions/rev1/replicas?page=2`,
        });
      return response({
        value: [
          { name: 'rev1', properties: { active: true } },
          { name: 'stopped', properties: { active: false } },
        ],
      });
    });
    const result = await createFleetReader()();
    expect(result.replicas.map((replica) => replica.replicaId)).toEqual(['a', 'b']);
    expect(result.coverage.activeReplicas).toBe(2);
  });
  it('rejects partial log responses and retries instead of caching incomplete totals', async () => {
    fetchMock.mockImplementationOnce(async () =>
      response({ ...logsBody(), error: { code: 'PartialError' } })
    );
    const read = createFleetReader();
    await expect(read()).rejects.toThrow('Incomplete Azure Monitor query');
    await expect(read()).resolves.toHaveProperty('scope', 'fleet');
  });
  it('does not forward the management credential to an unsafe continuation', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/query')
        ? response(logsBody())
        : response({ value: [], nextLink: 'https://untrusted.example/token' })
    );
    const result = await createFleetReader()();
    expect(result.coverage.inventoryAvailable).toBe(false);
    expect(fetchMock.mock.calls.every(([url]) => !url.includes('untrusted'))).toBe(true);
  });
  it('never falls back to local metrics when deployment metadata is missing or Azure fails', async () => {
    delete process.env.FLEET_METRICS_WORKSPACE_ID;
    await expect(createFleetReader()()).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.FLEET_METRICS_WORKSPACE_ID = 'f7f7cbf0-dd54-4201-8049-612c954a46ff';
    fetchMock.mockResolvedValue(response({}, false));
    await expect(createFleetReader()()).rejects.toThrow('Azure Monitor query unavailable');
  });
});

it('scopes and deduplicates the shared event query before computing fleet percentiles', () => {
  const query = fleetQuery(APP, NOW);
  expect(query).toContain("tostring(m.appResourceId) =~ '" + APP + "'");
  expect(query).toContain('summarize arg_max(TimeGenerated, *) by eventId');
  expect(query).toContain('p95Ms=percentile(ms,95)');
  expect(query).toContain("metricKind == 'resource'");
});
