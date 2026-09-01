import { PollerService } from '../../src/worker/poller';

// Mock logger to suppress output during tests
jest.mock('pino', () => {
  const mockLogger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(function () {
      return mockLogger;
    }),
  };
  return jest.fn(() => mockLogger);
});

/**
 * Single-flight behaviour of PollerService.processBatch().
 *
 * POST /worker/wake lets Salesforce trigger a poll cycle out of band, so
 * processBatch() is no longer only reachable from one serial timer chain.
 * Document locking is not atomic - lockDocument() is an unconditional PATCH -
 * so two concurrent cycles would fetch the same rows and generate each
 * document twice.
 *
 * These tests need no Salesforce credentials: fetchQueuedDocuments is stubbed,
 * which also makes every cycle return early before touching config or the network.
 */
describe('PollerService single-flight', () => {
  let poller: PollerService;
  let cycles: number;
  let concurrent: number;
  let maxConcurrent: number;

  /** Stub a cycle that takes a tick, so overlapping calls land mid-batch. */
  function stubFetch(): jest.SpyInstance {
    return jest.spyOn(poller, 'fetchQueuedDocuments').mockImplementation(async () => {
      cycles++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent--;
      return [];
    });
  }

  beforeEach(() => {
    poller = new PollerService();
    // Bypass start(): it would load config and arm a real timer. processBatch()
    // early-returns unless the poller is running.
    (poller as any).running = true;
    cycles = 0;
    concurrent = 0;
    maxConcurrent = 0;
  });

  it('never runs two cycles concurrently', async () => {
    stubFetch();

    await Promise.all([poller.processBatch(), poller.processBatch(), poller.processBatch()]);

    expect(maxConcurrent).toBe(1);
  });

  it('runs a trailing cycle for a wake that arrives mid-batch', async () => {
    stubFetch();

    // The in-flight cycle has already fetched by the time the second call lands,
    // so coalescing alone would strand the newly-inserted row until the next tick.
    const inFlight = poller.processBatch();
    await Promise.resolve();
    await poller.processBatch();
    await inFlight;

    expect(cycles).toBe(2);
  });

  it('does not run a trailing cycle when no wake arrives', async () => {
    stubFetch();

    await poller.processBatch();

    expect(cycles).toBe(1);
  });

  it('collapses a burst of wakes into a single trailing cycle', async () => {
    stubFetch();

    // 20 simultaneous clicks must not become 20 batches.
    await Promise.all(Array.from({ length: 20 }, () => poller.processBatch()));

    expect(cycles).toBe(2);
    expect(maxConcurrent).toBe(1);
  });

  it('accepts new cycles after a burst has drained', async () => {
    stubFetch();

    await Promise.all([poller.processBatch(), poller.processBatch()]);
    expect(cycles).toBe(2);

    await poller.processBatch();
    expect(cycles).toBe(3);
  });

  it('does nothing when the poller is not running', async () => {
    const fetchSpy = stubFetch();
    (poller as any).running = false;

    await poller.processBatch();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('releases the guard when a cycle throws', async () => {
    const fetchSpy = jest
      .spyOn(poller, 'fetchQueuedDocuments')
      .mockRejectedValueOnce(new Error('salesforce unavailable'))
      .mockResolvedValue([]);

    // runBatchCycle swallows its own errors, but the guard must clear regardless.
    await expect(poller.processBatch()).resolves.toBeUndefined();
    expect((poller as any).batchInFlight).toBe(false);

    await poller.processBatch();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
