import { DefaultAzureCredential } from '@azure/identity';
import type { ResourceSnapshot } from './resources';

const ARM = 'https://management.azure.com';
const LOGS = 'https://api.loganalytics.azure.com';
const API_VERSION = '2025-01-01';
const WINDOW_SECONDS = 3600;
const FRESH_SECONDS = 300; // Allow for Azure Monitor ingestion delay.

export interface FleetRow {
  kind: string;
  key: string;
  value: Record<string, any>;
}
export interface ReplicaIdentity {
  replicaId: string;
  revision: string;
}

/** Aggregate individual events in the shared store, never average replica percentiles. */
export function fleetQuery(appResourceId: string, now: Date): string {
  const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'";
  const end = now.toISOString();
  const start = new Date(now.getTime() - WINDOW_SECONDS * 1000).toISOString();
  const ingestionStart = new Date(
    now.getTime() - (WINDOW_SECONDS + FRESH_SECONDS) * 1000
  ).toISOString();
  const appName = appResourceId.split('/').pop()!;
  return `
let events = materialize(ContainerAppConsoleLogs_CL
| where TimeGenerated >= datetime(${ingestionStart})
| where ContainerAppName_s =~ ${literal(appName)}
| extend m = parse_json(Log_s).fleetMetric
| where toint(m.version) == 1 and tostring(m.appResourceId) =~ ${literal(appResourceId)}
| extend at = todatetime(m.at), eventId = tostring(m.eventId), replicaId = tostring(m.replicaId), metricKind = tostring(m['kind']), d = m.data
| where at between (datetime(${start}) .. datetime(${end})) and isnotempty(eventId)
| summarize arg_max(TimeGenerated, *) by eventId);
let documents = events | where metricKind == 'document'
| extend ms = todouble(d.durationMs), ok = tobool(d.success)
| where isnotnull(ms) and ms >= 0
| extend groups = pack_array(
    bag_pack('kind', 'documents', 'key', 'all'),
    bag_pack('kind', 'mode', 'key', tostring(d.mode)),
    bag_pack('kind', 'format', 'key', tostring(d.outputFormat)),
    bag_pack('kind', 'replicaDocuments', 'key', replicaId))
| mv-expand g = groups
| summarize count=count(), succeeded=countif(ok), failed=countif(ok == false),
    avgMs=avg(ms), p50Ms=percentile(ms,50), p95Ms=percentile(ms,95), p99Ms=percentile(ms,99), maxMs=max(ms)
    by category=tostring(g['kind']), key=tostring(g.key)
| project ['kind']=category, key, value=bag_pack('count',count,'succeeded',succeeded,'failed',failed,
    'avgMs',avgMs,'p50Ms',p50Ms,'p95Ms',p95Ms,'p99Ms',p99Ms,'maxMs',maxMs);
let stages = events | where metricKind == 'stage'
| extend ms=todouble(d.durationMs), ok=tobool(d.success)
| where isnotnull(ms) and ms >= 0
| summarize count=count(), errorCount=countif(ok == false), totalMs=sum(ms), avgMs=avg(ms),
    p50Ms=percentile(ms,50), p95Ms=percentile(ms,95), maxMs=max(ms) by key=tostring(d.stage)
| project ['kind']='stage', key, value=bag_pack('count',count,'errorCount',errorCount,'totalMs',totalMs,
    'avgMs',avgMs,'p50Ms',p50Ms,'p95Ms',p95Ms,'maxMs',maxMs);
let resources = events | where metricKind == 'resource'
| summarize arg_max(at, *) by replicaId
| project ['kind']='resource', key=replicaId, value=bag_pack('at',at,'snapshot',d,'revision',tostring(m.revision),'processId',tostring(m.processId));
union documents, stages, resources`;
}

function decodeRows(body: any): FleetRow[] {
  // Azure can return HTTP 200 with PartialError. Do not present truncated totals.
  if (body.error || !Array.isArray(body.tables)) throw new Error('Incomplete Azure Monitor query');
  const table = body.tables.find((entry: any) => entry.name === 'PrimaryResult');
  if (!table || !Array.isArray(table.rows)) throw new Error('Missing Azure Monitor result');
  const indexes = ['kind', 'key', 'value'].map((name) =>
    table.columns.findIndex((column: any) => column.name === name)
  );
  if (indexes.some((index) => index < 0)) throw new Error('Unexpected Azure Monitor columns');
  return table.rows.map((row: any[]) => ({
    kind: row[indexes[0]],
    key: row[indexes[1]],
    value: typeof row[indexes[2]] === 'string' ? JSON.parse(row[indexes[2]]) : row[indexes[2]],
  }));
}

/** Each request reads all active revisions, including paginated inventory. */
async function replicaInventory(
  appId: string,
  token: string,
  signal: AbortSignal
): Promise<ReplicaIdentity[]> {
  const list = async (path: string): Promise<any[]> => {
    let next: string | undefined = ARM + path + '?api-version=' + API_VERSION;
    const entries: any[] = [];
    const visited = new Set<string>();
    while (next) {
      // Never forward the management token to a host/path supplied in an unsafe nextLink.
      const url = new URL(next);
      if (
        url.origin !== ARM ||
        !url.pathname.toLowerCase().startsWith(appId.toLowerCase() + '/') ||
        visited.has(next)
      ) {
        throw new Error('Invalid Azure inventory continuation');
      }
      visited.add(next);
      const response = await fetch(next, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Azure replica inventory unavailable');
      const body = (await response.json()) as { value?: any[]; nextLink?: string };
      if (!Array.isArray(body.value)) throw new Error('Invalid Azure replica inventory');
      entries.push(...body.value);
      next = body.nextLink || undefined;
    }
    return entries;
  };
  const revisions = (await list(appId + '/revisions')).filter(
    (revision) => revision.properties?.active === true
  );
  const replicas = await Promise.all(
    revisions.map(async (revision) => {
      const entries = await list(
        appId + '/revisions/' + encodeURIComponent(revision.name) + '/replicas'
      );
      return entries.map((replica) => ({ replicaId: replica.name, revision: revision.name }));
    })
  );
  return [...new Map(replicas.flat().map((replica) => [replica.replicaId, replica])).values()];
}

function sumComplete(
  snapshots: ResourceSnapshot[],
  read: (snapshot: ResourceSnapshot) => number | null | undefined
): number | null {
  if (!snapshots.length) return null;
  const values = snapshots.map(read);
  return values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? (values as number[]).reduce((total, value) => total + value, 0)
    : null;
}
const percent = (used: number | null, capacity: number | null) =>
  used !== null && capacity !== null && capacity > 0
    ? Math.round((used / capacity) * 1000) / 10
    : null;

/** Only fresh snapshots of currently active replicas contribute to capacity totals. */
export function aggregateFleet(rows: FleetRow[], inventory: ReplicaIdentity[] | null, now: Date) {
  const snapshots = new Map(
    rows.filter((row) => row.kind === 'resource').map((row) => [row.key, row.value])
  );
  const docRows = new Map(
    rows.filter((row) => row.kind === 'replicaDocuments').map((row) => [row.key, row.value])
  );
  const identities = new Map((inventory || []).map((replica) => [replica.replicaId, replica]));
  for (const [replicaId, row] of snapshots) {
    if (!identities.has(replicaId))
      identities.set(replicaId, { replicaId, revision: row.revision });
  }
  for (const replicaId of docRows.keys()) {
    if (!identities.has(replicaId))
      identities.set(replicaId, { replicaId, revision: 'Historical' });
  }
  const activeIds = new Set((inventory || []).map((replica) => replica.replicaId));
  const replicas = [...identities.values()]
    .map((identity) => {
      const row = snapshots.get(identity.replicaId);
      const age = row ? (now.getTime() - Date.parse(row.at)) / 1000 : null;
      const active = inventory === null ? null : activeIds.has(identity.replicaId);
      const freshness =
        age === null || !Number.isFinite(age) ? 'missing' : age > FRESH_SECONDS ? 'stale' : 'fresh';
      return {
        ...identity,
        active,
        freshness,
        lastSeen: row?.at || null,
        snapshot: row?.snapshot as ResourceSnapshot | undefined,
        documents: docRows.get(identity.replicaId) || null,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.replicaId.localeCompare(b.replicaId));
  const fresh = replicas.filter((replica) => replica.active && replica.freshness === 'fresh');
  const coverageComplete =
    inventory !== null && inventory.length > 0 && fresh.length === inventory.length;
  // All-or-unavailable totals: missing replicas must not look like spare capacity.
  const current = coverageComplete ? fresh.map((replica) => replica.snapshot!) : [];
  const cores = sumComplete(current, (s) => (s.cpu?.source === 'process' ? null : s.cpu?.cores));
  const usedCores = sumComplete(current, (s) =>
    s.cpu?.percent == null || s.cpu.source === 'process'
      ? null
      : (s.cpu.percent * s.cpu.cores) / 100
  );
  const memoryUsedMb = sumComplete(current, (s) =>
    s.memory?.source === 'process' ? null : s.memory?.usedMb
  );
  const memoryLimitMb = sumComplete(current, (s) =>
    s.memory?.source === 'process' ? null : s.memory?.limitMb
  );
  const activeJobs = sumComplete(current, (s) => s.libreOfficePool?.activeJobs);
  const maxConcurrent = sumComplete(current, (s) => s.libreOfficePool?.maxConcurrent);
  const cacheHits = sumComplete(current, (s) => s.templateCache?.hits);
  const cacheMisses = sumComplete(current, (s) => s.templateCache?.misses);
  const resourceTotals = {
    cpuPercent: percent(usedCores, cores),
    cores,
    memoryUsedMb,
    memoryLimitMb,
    memoryPercent: percent(memoryUsedMb, memoryLimitMb),
    activeJobs,
    maxConcurrent,
    queuedJobs: sumComplete(current, (s) => s.libreOfficePool?.queuedJobs),
    poolUtilizationPercent: percent(activeJobs, maxConcurrent),
    cacheHits,
    cacheMisses,
    cacheHitRatePercent: percent(
      cacheHits,
      cacheHits === null || cacheMisses === null ? null : cacheHits + cacheMisses
    ),
    cacheSizeMb: sumComplete(current, (s) => s.templateCache?.sizeMb),
    cacheMaxSizeMb: sumComplete(current, (s) => s.templateCache?.maxSizeMb),
  };
  const summary = rows.find((row) => row.kind === 'documents')?.value;
  const hasTelemetry = snapshots.size > 0 || !!summary;
  const count = summary?.count || 0;
  const stages = rows
    .filter((row) => row.kind === 'stage')
    .map((row) => ({ stage: row.key, ...row.value }))
    .sort((a: any, b: any) => b.totalMs - a.totalMs);
  const breakdown = (kind: string) =>
    rows.filter((row) => row.kind === kind).map((row) => ({ key: row.key, ...row.value }));
  return {
    scope: 'fleet',
    source: 'Azure Monitor Logs',
    generatedAt: now.toISOString(),
    windowSeconds: WINDOW_SECONDS,
    coverage: {
      inventoryAvailable: inventory !== null,
      activeReplicas: inventory?.length ?? null,
      reportingReplicas: fresh.length,
      complete: coverageComplete,
      freshnessSeconds: FRESH_SECONDS,
      telemetryAvailable: hasTelemetry,
    },
    resources: resourceTotals,
    replicas,
    performance: hasTelemetry
      ? {
          documents: {
            count,
            succeeded: summary?.succeeded || 0,
            failed: summary?.failed || 0,
            successRatePercent: count ? percent(summary!.succeeded, count) : null,
            perMinute: Math.round((count / (WINDOW_SECONDS / 60)) * 100) / 100,
            perHour: count,
            latency: summary
              ? {
                  avgMs: summary.avgMs,
                  p50Ms: summary.p50Ms,
                  p95Ms: summary.p95Ms,
                  p99Ms: summary.p99Ms,
                  maxMs: summary.maxMs,
                }
              : null,
            byMode: breakdown('mode'),
            byOutputFormat: breakdown('format'),
          },
          stages,
          slowestStageByTotalTime: stages[0]?.stage || null,
        }
      : null,
  };
}

/** Shared-query cache avoids duplicate expensive queries for simultaneous tab refreshes. */
export function createFleetReader() {
  const credential = new DefaultAzureCredential();
  let cached: { at: number; value: ReturnType<typeof aggregateFleet> } | undefined;
  let pending: Promise<ReturnType<typeof aggregateFleet>> | undefined;
  return async () => {
    const appId = process.env.FLEET_METRICS_APP_RESOURCE_ID || '';
    const workspace = process.env.FLEET_METRICS_WORKSPACE_ID || '';
    if (
      process.env.FLEET_METRICS_ENABLED !== 'true' ||
      !/^\/subscriptions\/[\w-]+\/resourceGroups\/[\w.()-]+\/providers\/Microsoft.App\/containerApps\/[\w-]+$/i.test(
        appId
      ) ||
      !/^[0-9a-f-]{36}$/i.test(workspace)
    )
      throw new Error('Fleet metrics not configured');
    if (cached && Date.now() - cached.at < 15000) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      const signal = AbortSignal.timeout(22000); // Stay within the Apex callout timeout.
      const now = new Date();
      const query = async () => {
        const token = await credential.getToken('https://api.loganalytics.io/.default', {
          abortSignal: signal,
        });
        if (!token) throw new Error('Azure Monitor token unavailable');
        const response = await fetch(`${LOGS}/v1/workspaces/${workspace}/query`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.token}`,
            Prefer: 'wait=15',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: fleetQuery(appId, now), timespan: 'PT65M' }),
          signal,
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Azure Monitor query unavailable');
        return decodeRows(await response.json());
      };
      const inventory = async () => {
        try {
          const token = await credential.getToken(ARM + '/.default', { abortSignal: signal });
          return token ? await replicaInventory(appId, token.token, signal) : null;
        } catch {
          return null;
        }
      };
      const [rows, replicas] = await Promise.all([query(), inventory()]);
      const value = aggregateFleet(rows, replicas, now);
      cached = { at: Date.now(), value };
      return value;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}
