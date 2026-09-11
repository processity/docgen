import getFleetMetrics from '@salesforce/apex/DocgenStatusController.getFleetMetrics';
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

jest.mock('@salesforce/apex/DocgenStatusController.getFleetMetrics', () => ({ default: jest.fn() }), { virtual: true });

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

const FLEET = {
  scope: 'fleet', generatedAt: '2026-09-10T12:00:00Z', windowSeconds: 3600,
  coverage: { inventoryAvailable: true, activeReplicas: 2, reportingReplicas: 2, complete: true, telemetryAvailable: true },
  performance: PERFORMANCE,
  resources: { cpuPercent: 37.5, cores: 4, memoryUsedMb: 2048, memoryLimitMb: 8192, memoryPercent: 25,
    activeJobs: 4, maxConcurrent: 16, queuedJobs: 2, cacheHits: 180, cacheMisses: 20, cacheHitRatePercent: 90 },
  replicas: [
    { replicaId: 'docgen--abc123', revision: 'rev1', active: true, freshness: 'fresh', lastSeen: '2026-09-10T11:59:00Z', snapshot: RESOURCES, documents: { count: 7, p95Ms: 9100 } },
    { replicaId: 'different-replica', revision: 'rev1', active: true, freshness: 'fresh', lastSeen: '2026-09-10T11:59:00Z', snapshot: RESOURCES, documents: { count: 5, p95Ms: 4000 } }
  ]
};

function createStatusPage() {
  const element = createElement('c-docgen-status', { is: DocgenStatus });
  document.body.appendChild(element);
  return element;
}

function activateTab(element, name) {
  const tab = [...element.shadowRoot.querySelectorAll('lightning-tab')].find(entry => entry.value === name);
  tab.dispatchEvent(new CustomEvent('active'));
}
function textOf(element) { return element.shadowRoot.textContent; }
function button(element, label) {
  return [...element.shadowRoot.querySelectorAll('lightning-button')].find(entry => entry.label === label);
}
function table(element) { return element.shadowRoot.querySelector('lightning-datatable'); }
function select(element, label, value) {
  const input = [...element.shadowRoot.querySelectorAll('lightning-combobox')].find(entry => entry.label === label);
  input.dispatchEvent(new CustomEvent('change', { detail: { value } }));
}

describe('c-docgen-status dashboard', () => {
  beforeEach(() => {
    getSystemStatus.mockResolvedValue({ ready: true, checks: { salesforce: true } });
    getQueueMetrics.mockResolvedValue({ total: 40, succeeded: 36, failed: 1, queued: 2, processing: 1,
      canceled: 0, currentQueued: 3, currentProcessing: 1, queueDepth: 4, retries: 2, successRate: 97.3 });
    getRecentDocuments.mockResolvedValue(Array.from({ length: 23 }, (_, i) => ({
      id: `doc-${i}`, name: `GD-${i}`, templateName: 'Order Form', status: i < 3 ? 'FAILED' : 'SUCCEEDED',
      attempts: i, createdDate: new Date(Date.UTC(2026, 8, 10, 0, i)).toISOString(), error: i < 3 ? 'Conversion error' : ''
    })));
    getUsageMetrics.mockResolvedValue(USAGE);
    getPerformanceMetrics.mockResolvedValue(PERFORMANCE);
    getResourceMetrics.mockResolvedValue(RESOURCES);
    getFleetMetrics.mockResolvedValue(FLEET);
  });
  afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    jest.clearAllMocks();
  });

  it('opens the combined first tab and loads overview and performance without switching tabs', async () => {
    const element = createStatusPage();
    await flushPromises();
    expect(element.shadowRoot.querySelector('lightning-tabset').activeTabValue).toBe('overview');
    expect(getSystemStatus).toHaveBeenCalledTimes(1);
    expect(getUsageMetrics).toHaveBeenCalledTimes(1);
    expect(getFleetMetrics).toHaveBeenCalledTimes(1);
    const tabs = [...element.shadowRoot.querySelectorAll('lightning-tab')];
    expect(tabs.map(tab => tab.label)).toEqual(['Overview & Performance', 'Documents', 'Diagnostics']);
    expect(tabs[0].textContent).toContain('Document outcomes');
    expect(tabs[0].textContent).toContain('Processing time · all replicas');
    expect(tabs[0].querySelector('.donut')).not.toBeNull();
    expect(getPerformanceMetrics).not.toHaveBeenCalled();
    expect(getWorkerStats).not.toHaveBeenCalled();
    expect(getWorkerStatus).not.toHaveBeenCalled();
    activateTab(element, 'overview');
    await flushPromises();
    expect(getUsageMetrics).toHaveBeenCalledTimes(1);
    expect(getPerformanceMetrics).not.toHaveBeenCalled();
    expect(getResourceMetrics).not.toHaveBeenCalled();
  });

  it('renders accessible volume and format charts from Salesforce totals', async () => {
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'overview');
    await flushPromises();
    expect(element.shadowRoot.querySelectorAll('.chart-bar-target')).toHaveLength(2);
    expect(element.shadowRoot.querySelector('.chart-bar-target').getAttribute('aria-label')).toBe('Wed 13:00: 4 documents');
    const donut = element.shadowRoot.querySelector('.donut');
    expect(donut.getAttribute('aria-label')).toContain('PDF: 36 requests (90.0%)');
    expect(donut.getAttribute('style')).toContain('conic-gradient');
    expect(textOf(element)).toContain('Order Form');
    expect(textOf(element)).toContain('Processing time · all replicas');
    expect(getFleetMetrics).toHaveBeenCalledTimes(1);
  });

  it('paginates, sorts before paging, filters and resets the page', async () => {
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'documents');
    await flushPromises();
    expect(table(element).data).toHaveLength(10);
    expect(table(element).data[0].name).toBe('GD-22');
    expect(table(element).data[0].recordUrl).toBe('/lightning/r/Generated_Document__c/doc-22/view');
    button(element, 'Next').click();
    await flushPromises();
    expect(table(element).data[0].name).toBe('GD-12');
    expect(table(element).rowNumberOffset).toBe(10);
    button(element, 'Next').click();
    await flushPromises();
    expect(table(element).data).toHaveLength(3);
    expect(button(element, 'Next').disabled).toBe(true);
    table(element).dispatchEvent(new CustomEvent('sort', { detail: { fieldName: 'attempts', sortDirection: 'asc' } }));
    await flushPromises();
    expect(table(element).data[0].attempts).toBe(0);
    expect(button(element, 'Previous').disabled).toBe(true);
    select(element, 'Status', 'FAILED');
    await flushPromises();
    expect(table(element).data).toHaveLength(3);
    expect(table(element).data.every(doc => doc.status === 'FAILED')).toBe(true);
    select(element, 'Status', 'ALL');
    select(element, 'Rows per page', '25');
    await flushPromises();
    expect(table(element).data).toHaveLength(23);
    const search = element.shadowRoot.querySelector('lightning-input');
    search.value = 'Conversion error';
    search.dispatchEvent(new CustomEvent('change'));
    await flushPromises();
    expect(table(element).data).toHaveLength(3);
    search.value = 'no match';
    search.dispatchEvent(new CustomEvent('change'));
    await flushPromises();
    expect(table(element)).toBeNull();
    expect(textOf(element)).toContain('0 documents');
  });

  it('keeps org metrics and records when health or diagnostics fail', async () => {
    getSystemStatus.mockRejectedValue(new Error('Health unavailable'));
    getFleetMetrics.mockRejectedValue(new Error('Fleet unavailable'));
    const element = createStatusPage();
    await flushPromises();
    expect(textOf(element)).toContain('Health unavailable');
    expect(textOf(element)).toContain('Unavailable');
    expect(table(element).data).toHaveLength(10);
    activateTab(element, 'overview');
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(textOf(element)).toContain('Fleet unavailable');
    expect(textOf(element)).toContain('40');
    expect(textOf(element)).not.toContain('37.5%');
  });

  it('shows actual readiness failures and unavailable values without false zeroes', async () => {
    getSystemStatus.mockResolvedValue({ ready: false, checks: { salesforce: false } });
    getQueueMetrics.mockRejectedValue(new Error('Queue unavailable'));
    const element = createStatusPage();
    await flushPromises();
    expect(textOf(element)).toContain('Needs attention');
    expect(textOf(element)).toContain('Queue unavailable');
    const values = [...element.shadowRoot.querySelectorAll('.dashboard > .summary-grid .summary-value')].map(entry => entry.textContent);
    expect(values).toEqual(['—', '—', '—', '—']);
  });

  it('loads one shared snapshot and displays every replica with fleet totals', async () => {
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'overview');
    await flushPromises();
    activateTab(element, 'diagnostics');
    await flushPromises();
    const text = textOf(element);
    for (const label of ['docgen--abc123', 'different-replica', '4.2 s', '9.1 s',
      'PDF conversion (LibreOffice)', 'Batch (poller)', 'Interactive',
      '2 of 2 active replicas reporting', '2048 / 8192 MB', '37.5%']) {
      expect(text).toContain(label);
    }
    expect(element.shadowRoot.querySelectorAll('.replica-panel')).toHaveLength(2);
    expect(getFleetMetrics).toHaveBeenCalledTimes(1);
    expect(getPerformanceMetrics).not.toHaveBeenCalled();
    expect(getResourceMetrics).not.toHaveBeenCalled();
  });

  it('shows no-sample state and keeps empty charts honest', async () => {
    getFleetMetrics.mockResolvedValue({ ...FLEET, performance: { ...PERFORMANCE, documents: { count: 0, latency: null }, stages: [] } });
    getUsageMetrics.mockResolvedValue({ ...USAGE, last24Hours: 0, hourly: [], byFormat: [], topTemplates: [] });
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'overview');
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(textOf(element)).toContain('No completed-document timing events have arrived');
    expect(textOf(element)).toContain('No document requests in the last 24 hours');
    expect(textOf(element)).not.toContain('Median (p50)');
    expect(element.shadowRoot.querySelector('.donut')).toBeNull();
  });

  it('refreshes overview and performance, retries errors, and clamps the document page', async () => {
    getUsageMetrics.mockRejectedValueOnce(new Error('Usage unavailable'));
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'overview');
    await flushPromises();
    expect(textOf(element)).toContain('Usage unavailable');
    button(element, 'Next').click();
    await flushPromises();
    getRecentDocuments.mockResolvedValue([]);
    button(element, 'Refresh').click();
    await flushPromises();
    expect(getUsageMetrics).toHaveBeenCalledTimes(2);
    expect(getFleetMetrics).toHaveBeenCalledTimes(2);
    expect(textOf(element)).not.toContain('Usage unavailable');
    expect(button(element, 'Previous').disabled).toBe(true);
    expect(getPerformanceMetrics).not.toHaveBeenCalled();
    expect(getResourceMetrics).not.toHaveBeenCalled();
  });

  it('labels process-only resource readings', async () => {
    getFleetMetrics.mockResolvedValue({ ...FLEET, replicas: [{ ...FLEET.replicas[0], snapshot: { ...RESOURCES, cpu: { ...RESOURCES.cpu, source: 'process' } } }] });
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(textOf(element)).toContain('Node process only');
  });

  it('shows missing replicas and unavailable capacity when coverage is incomplete', async () => {
    getFleetMetrics.mockResolvedValue({ ...FLEET, resources: {},
      coverage: { ...FLEET.coverage, reportingReplicas: 1, complete: false },
      replicas: [FLEET.replicas[0], { ...FLEET.replicas[1], snapshot: null, freshness: 'missing', lastSeen: null }]
    });
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(textOf(element)).toContain('1 of 2 active replicas reporting');
    expect([...element.shadowRoot.querySelectorAll('.replica-panel lightning-badge')].map(badge => badge.label)).toContain('Active · awaiting telemetry');
    expect(textOf(element)).toContain('Fleet resource totals are unavailable');
    const values = [...element.shadowRoot.querySelectorAll('.summary-value')].slice(-4).map(entry => entry.textContent);
    expect(values).toEqual(['—', '—', '—', '—']);
  });

  it('rejects a legacy single-replica response instead of labeling it as fleet metrics', async () => {
    getFleetMetrics.mockResolvedValue(PERFORMANCE);
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'overview');
    await flushPromises();
    expect(textOf(element)).toContain('The backend did not return fleet metrics');
    expect(getPerformanceMetrics).not.toHaveBeenCalled();
    expect(textOf(element)).not.toContain('4.2 s');
  });
});
