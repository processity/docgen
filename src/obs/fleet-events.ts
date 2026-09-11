import { randomUUID } from 'crypto';
import os from 'os';
import pino from 'pino';

// Independent of LOG_LEVEL: these numeric events are the fleet metrics data source.
// Container Apps ships stdout to its existing shared Log Analytics workspace.
const telemetry = pino({ name: 'docgen-fleet', level: 'info' });
const processId = randomUUID();

export function emitFleetMetric(kind: 'document' | 'stage' | 'resource', data: object): void {
  if (process.env.FLEET_METRICS_ENABLED !== 'true') return;
  try {
    telemetry.info({
      fleetMetric: {
        version: 1,
        eventId: randomUUID(),
        processId,
        at: new Date().toISOString(),
        appResourceId: process.env.FLEET_METRICS_APP_RESOURCE_ID,
        replicaId: process.env.CONTAINER_APP_REPLICA_NAME || os.hostname(),
        revision: process.env.CONTAINER_APP_REVISION || 'unknown',
        kind,
        data,
      },
    });
  } catch {
    // Observability must never fail document generation.
  }
}
