import { createElement } from 'lwc';
import DocgenStatus from 'c/docgenStatus';
import getSystemStatus from '@salesforce/apex/DocgenStatusController.getSystemStatus';
import getWorkerStatus from '@salesforce/apex/DocgenStatusController.getWorkerStatus';
import getWorkerStats from '@salesforce/apex/DocgenStatusController.getWorkerStats';
import getQueueMetrics from '@salesforce/apex/DocgenStatusController.getQueueMetrics';
import getRecentDocuments from '@salesforce/apex/DocgenStatusController.getRecentDocuments';
import getPerformanceMetrics from '@salesforce/apex/DocgenStatusController.getPerformanceMetrics';
import getResourceMetrics from '@salesforce/apex/DocgenStatusController.getResourceMetrics';
import getUsageMetrics from '@salesforce/apex/DocgenStatusController.getUsageMetrics';

jest.mock(
  '@salesforce/apex/DocgenStatusController.getSystemStatus',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenStatusController.getWorkerStatus',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenStatusController.getWorkerStats',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenStatusController.getQueueMetrics',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenStatusController.getRecentDocuments',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenStatusController.getPerformanceMetrics',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenStatusController.getResourceMetrics',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenStatusController.getUsageMetrics',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const USAGE = {
  lastHour: 3,
  last24Hours: 40,
  last7Days: 260,
  perHourAverage: 1.7,
  peakHourLabel: 'Wed 14:00',
  peakHourCount: 12,
  hourly: [
    { label: 'Wed 13:00', count: 4 },
    { label: 'Wed 14:00', count: 12 }
  ],
  byFormat: [{ format: 'PDF', count: 36 }, { format: 'DOCX', count: 4 }],
  topTemplates: [{ templateName: 'Order Form', count: 22 }]
};

const PERFORMANCE = {
  replicaId: 'docgen--abc123',
  windowSeconds: 3600,
  observedSeconds: 1800,
  processUptimeSeconds: 7200,
  documents: {
    count: 12,
    succeeded: 11,
    failed: 1,
    successRatePercent: 91.7,
    perMinute: 0.4,
    perHour: 24,
    latency: { p50Ms: 4200, p95Ms: 9100, p99Ms: 12000, avgMs: 5100, maxMs: 12000 },
    byOutputFormat: [{ key: 'PDF', count: 12, avgMs: 5100, p95Ms: 9100 }],
    byMode: [
      { key: 'batch', count: 10, avgMs: 5400, p95Ms: 9100 },
      { key: 'interactive', count: 2, avgMs: 3600, p95Ms: 4000 }
    ]
  },
  stages: [
    {
      stage: 'pdfConvert',
      count: 12,
      errorCount: 0,
      totalMs: 36000,
      avgMs: 3000,
      p50Ms: 2900,
      p95Ms: 4100,
      maxMs: 4300
    },
    {
      stage: 'templateFetch',
      count: 12,
      errorCount: 1,
      totalMs: 600,
      avgMs: 50,
      p50Ms: 20,
      p95Ms: 300,
      maxMs: 320
    }
  ],
  slowestStageByTotalTime: 'pdfConvert'
};

const RESOURCES = {
  replicaId: 'docgen--abc123',
  pid: 42,
  processUptimeSeconds: 7200,
  cpu: { percent: 37.5, cores: 2, source: 'cgroup-v2', sampleSeconds: 60 },
  memory: {
    source: 'cgroup-v2',
    usedMb: 1024,
    limitMb: 4096,
    percentOfLimit: 25,
    node: { rssMb: 320, heapUsedMb: 120, heapTotalMb: 180, externalMb: 12 }
  },
  eventLoopDelayMs: { p50: 1.2, p99: 18.4, max: 210 },
  libreOfficePool: {
    activeJobs: 2,
    queuedJobs: 1,
    maxConcurrent: 8,
    utilizationPercent: 25,
    completedJobs: 100,
    failedJobs: 2,
    totalConversions: 102
  },
  templateCache: {
    hits: 90,
    misses: 10,
    hitRatePercent: 90,
    lookups: 100,
    entryCount: 4,
    evictions: 0,
    sizeMb: 12.5,
    maxSizeMb: 500,
    utilizationPercent: 2.5
  }
};

function createStatusPage() {
  const element = createElement('c-docgen-status', { is: DocgenStatus });
  document.body.appendChild(element);
  return element;
}

function toggleSection(element, sections) {
  const accordion = element.shadowRoot.querySelector('lightning-accordion');
  accordion.dispatchEvent(
    new CustomEvent('sectiontoggle', { detail: { openSections: sections } })
  );
}

function textOf(element) {
  return element.shadowRoot.textContent;
}

describe('c-docgen-status metrics panels', () => {
  beforeEach(() => {
    getSystemStatus.mockResolvedValue({ ready: true, checks: {} });
    getWorkerStatus.mockResolvedValue({ isRunning: true, currentQueueDepth: 0, lastPollTime: null });
    getWorkerStats.mockResolvedValue({ uptimeSeconds: 100 });
    getQueueMetrics.mockResolvedValue({ total: 0, succeeded: 0, failed: 0 });
    getRecentDocuments.mockResolvedValue([]);
    getUsageMetrics.mockResolvedValue(USAGE);
    getPerformanceMetrics.mockResolvedValue(PERFORMANCE);
    getResourceMetrics.mockResolvedValue(RESOURCES);
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('does not call the metrics endpoints until a panel is opened', async () => {
    createStatusPage();
    await flushPromises();

    expect(getSystemStatus).toHaveBeenCalled();
    expect(getPerformanceMetrics).not.toHaveBeenCalled();
    expect(getUsageMetrics).not.toHaveBeenCalled();
    expect(getResourceMetrics).not.toHaveBeenCalled();
  });

  it('loads performance metrics when the performance panel is opened', async () => {
    const element = createStatusPage();
    await flushPromises();

    toggleSection(element, ['performance']);
    await flushPromises();

    expect(getUsageMetrics).toHaveBeenCalledTimes(1);
    expect(getPerformanceMetrics).toHaveBeenCalledTimes(1);
    expect(getResourceMetrics).not.toHaveBeenCalled();

    const text = textOf(element);
    // Org-wide volume
    expect(text).toContain('40');
    expect(text).toContain('Wed 14:00');
    expect(text).toContain('Order Form');
    // Formatted latency percentiles
    expect(text).toContain('4.2 s');
    expect(text).toContain('9.1 s');
    // Stage ranking with a friendly label
    expect(text).toContain('PDF conversion (LibreOffice)');
    // Replica identity so the sample is attributable
    expect(text).toContain('docgen--abc123');
  });

  it('renders the interactive vs batch split from byMode, not the format split', async () => {
    const element = createStatusPage();
    await flushPromises();

    toggleSection(element, ['performance']);
    await flushPromises();

    const text = textOf(element);
    expect(text).toContain('Batch (poller)');
    expect(text).toContain('Interactive');
    // byMode averages, not the byOutputFormat average of 5100
    expect(text).toContain('5.4 s');
    expect(text).toContain('3.6 s');
  });

  it('does not re-fetch a panel that is already loaded', async () => {
    const element = createStatusPage();
    await flushPromises();

    toggleSection(element, ['performance']);
    await flushPromises();
    toggleSection(element, ['performance', 'resources']);
    await flushPromises();

    expect(getPerformanceMetrics).toHaveBeenCalledTimes(1);
    expect(getResourceMetrics).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state instead of zeroed timings when a replica has no samples', async () => {
    getPerformanceMetrics.mockResolvedValue({
      ...PERFORMANCE,
      documents: {
        count: 0,
        succeeded: 0,
        failed: 0,
        successRatePercent: null,
        perMinute: 0,
        perHour: 0,
        latency: null,
        byOutputFormat: [],
        byMode: []
      },
      stages: [],
      slowestStageByTotalTime: null
    });

    const element = createStatusPage();
    await flushPromises();
    toggleSection(element, ['performance']);
    await flushPromises();

    const text = textOf(element);
    expect(text).toContain('No documents completed on this replica');
    expect(text).not.toContain('Median (p50)');
  });

  it('renders resource utilization when the resources panel is opened', async () => {
    const element = createStatusPage();
    await flushPromises();

    toggleSection(element, ['resources']);
    await flushPromises();

    expect(getResourceMetrics).toHaveBeenCalledTimes(1);

    const text = textOf(element);
    expect(text).toContain('37.5%');
    expect(text).toContain('1024 MB of 4096 MB');
    expect(text).toContain('2 of 8 slots converting');
    expect(text).toContain('1 conversion(s) waiting for a slot');
    expect(text).toContain('90 hits, 10 misses');
    expect(text).toContain('12.5 / 500 MB');
    expect(text).toContain('Container total (includes LibreOffice)');
  });

  it('warns when CPU and memory only cover the Node process', async () => {
    getResourceMetrics.mockResolvedValue({
      ...RESOURCES,
      cpu: { ...RESOURCES.cpu, source: 'process' },
      memory: { ...RESOURCES.memory, source: 'process' }
    });

    const element = createStatusPage();
    await flushPromises();
    toggleSection(element, ['resources']);
    await flushPromises();

    expect(textOf(element)).toContain('Node process only (LibreOffice not counted)');
  });

  it('surfaces a panel error without breaking the rest of the page', async () => {
    getPerformanceMetrics.mockRejectedValue({ body: { message: 'Backend unreachable' } });

    const element = createStatusPage();
    await flushPromises();
    toggleSection(element, ['performance']);
    await flushPromises();

    expect(textOf(element)).toContain('Backend unreachable');
  });

  it('reloads an open panel on refresh', async () => {
    const element = createStatusPage();
    await flushPromises();
    toggleSection(element, ['performance']);
    await flushPromises();

    const refresh = element.shadowRoot.querySelector('lightning-button');
    refresh.dispatchEvent(new CustomEvent('click'));
    await flushPromises();

    expect(getPerformanceMetrics).toHaveBeenCalledTimes(2);
    // A panel that was never opened stays unloaded
    expect(getResourceMetrics).not.toHaveBeenCalled();
  });
});
