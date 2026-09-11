const mockInfo = jest.fn();
jest.mock('pino', () =>
  jest.fn(() => ({ info: mockInfo, warn: jest.fn(), error: jest.fn(), debug: jest.fn() }))
);
import { recordDocument, recordStage, resetPerfMetrics } from '../src/obs/perf';
import { startFleetHeartbeat } from '../src/obs/resources';

beforeEach(() => {
  process.env.FLEET_METRICS_APP_RESOURCE_ID = '/test-app';
  process.env.FLEET_METRICS_WORKSPACE_ID = 'test-workspace';
  process.env.CONTAINER_APP_REPLICA_NAME = 'replica-a';
  mockInfo.mockClear();
});
afterEach(() => {
  resetPerfMetrics();
  delete process.env.FLEET_METRICS_APP_RESOURCE_ID;
  delete process.env.FLEET_METRICS_WORKSPACE_ID;
  delete process.env.CONTAINER_APP_REPLICA_NAME;
  jest.useRealTimers();
});
it('publishes leaf stages and completions once with unique identifiers and no document content', () => {
  recordDocument({
    durationMs: 123,
    success: true,
    mode: 'batch',
    outputFormat: 'PDF',
    secret: 'must not be logged',
  } as any);
  recordStage('pdfConvert', 100, false);
  const events = mockInfo.mock.calls
    .filter(([event]) => event?.fleetMetric)
    .map(([event]) => event.fleetMetric);
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    kind: 'document',
    replicaId: 'replica-a',
    appResourceId: '/test-app',
    data: { durationMs: 123, success: true },
  });
  expect(events[0].data).not.toHaveProperty('secret');
  expect(events[1]).toMatchObject({ kind: 'stage', data: { stage: 'pdfConvert', success: false } });
  expect(events[0].eventId).not.toBe(events[1].eventId);
  expect(events[0].processId).toBe(events[1].processId);
});
it('publishes idle replica heartbeats without dashboard traffic and stops on close', () => {
  jest.useFakeTimers();
  const stop = startFleetHeartbeat();
  jest.advanceTimersByTime(60000);
  const events = () =>
    mockInfo.mock.calls.filter(([event]) => event?.fleetMetric?.kind === 'resource');
  expect(events()).toHaveLength(3);
  stop();
  jest.advanceTimersByTime(60000);
  expect(events()).toHaveLength(3);
});
it('does not emit from local processes without deployment metadata', () => {
  delete process.env.FLEET_METRICS_WORKSPACE_ID;
  recordDocument({ durationMs: 100, success: true });
  const stop = startFleetHeartbeat();
  stop();
  expect(mockInfo.mock.calls.filter(([event]) => event?.fleetMetric)).toHaveLength(0);
});
