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
import getReconnectInfo from '@salesforce/apex/DocgenConnectionController.getReconnectInfo';
import checkConnection from '@salesforce/apex/DocgenConnectionController.checkConnection';

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

jest.mock('@salesforce/apex/DocgenConnectionController.getReconnectInfo', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/DocgenConnectionController.checkConnection', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/customPermission/Docgen_Manage_Connection', () => ({ default: true }), { virtual: true });

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
    getReconnectInfo.mockResolvedValue({ orgId: '00D000000000001AAA', userId: '005000000000001AAA', namedCredential: 'Docgen_Node_API_Sandbox', backendUrl: 'https://backend.example.com' });
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
  });
  afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('loads Salesforce volume and current-replica timings on the combined first tab', async () => {
    const element = createStatusPage();
    await flushPromises();
    expect(element.shadowRoot.querySelector('lightning-tabset').activeTabValue).toBe('overview');
    const tabs = [...element.shadowRoot.querySelectorAll('lightning-tab')];
    expect(tabs.map(tab => tab.label)).toEqual(['Overview & Performance', 'Documents', 'Diagnostics']);
    expect(tabs[0].textContent).toContain('Processing time · current replica');
    expect(tabs[0].querySelector('.donut')).not.toBeNull();
    expect(getSystemStatus).toHaveBeenCalledTimes(1);
    expect(getUsageMetrics).toHaveBeenCalledTimes(1);
    expect(getPerformanceMetrics).toHaveBeenCalledTimes(1);
    expect(getWorkerStats).not.toHaveBeenCalled();
    expect(getWorkerStatus).not.toHaveBeenCalled();
    activateTab(element, 'overview');
    await flushPromises();
    expect(getUsageMetrics).toHaveBeenCalledTimes(1);
    expect(getPerformanceMetrics).toHaveBeenCalledTimes(1);
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
    expect(textOf(element)).toContain('Processing time · current replica');
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
    getPerformanceMetrics.mockRejectedValue(new Error('Timings unavailable'));
    const element = createStatusPage();
    await flushPromises();
    expect(textOf(element)).toContain('Health unavailable');
    expect(textOf(element)).toContain('Unavailable');
    expect(table(element).data).toHaveLength(10);
    activateTab(element, 'overview');
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(textOf(element)).toContain('Timings unavailable');
    expect(textOf(element)).toContain('40');
    expect(textOf(element)).toContain('37.5%');
  });

  it('shows actual readiness failures and unavailable values without false zeroes', async () => {
    getSystemStatus.mockResolvedValue({ ready: false, checks: { salesforce: false } });
    getQueueMetrics.mockRejectedValue(new Error('Queue unavailable'));
    const element = createStatusPage();
    await flushPromises();
    expect(textOf(element)).toContain('Needs attention');
    expect(textOf(element)).toContain('Queue unavailable');
    const values = [...element.shadowRoot.querySelectorAll('.summary-value')].map(entry => entry.textContent);
    expect(values).toEqual(['—', '—', '—', '—']);
  });

  it('loads independent replica diagnostics and keeps their identity visible', async () => {
    getResourceMetrics.mockResolvedValue({ ...RESOURCES, replicaId: 'different-replica' });
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(getUsageMetrics).toHaveBeenCalledTimes(1);
    const text = textOf(element);
    for (const label of ['docgen--abc123', 'different-replica', '4.2 s', '9.1 s',
      'PDF conversion (LibreOffice)', 'Batch (poller)', 'Interactive', '5.4 s', '3.6 s',
      '1024 MB of 4096 MB', '1 conversion(s) waiting for a slot', '90 hits, 10 misses']) {
      expect(text).toContain(label);
    }
    activateTab(element, 'overview');
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(getPerformanceMetrics).toHaveBeenCalledTimes(1);
  });

  it('shows no-sample state and keeps empty charts honest', async () => {
    getPerformanceMetrics.mockResolvedValue({ ...PERFORMANCE, documents: { count: 0, latency: null }, stages: [] });
    getUsageMetrics.mockResolvedValue({ ...USAGE, last24Hours: 0, hourly: [], byFormat: [], topTemplates: [] });
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'overview');
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(textOf(element)).toContain('No documents completed on this replica');
    expect(textOf(element)).toContain('No document requests in the last 24 hours');
    expect(textOf(element)).not.toContain('Median (p50)');
    expect(element.shadowRoot.querySelector('.donut')).toBeNull();
  });

  it('refreshes visited tabs, retries errors, and clamps the document page after records disappear', async () => {
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
    expect(textOf(element)).not.toContain('Usage unavailable');
    expect(button(element, 'Previous').disabled).toBe(true);
    expect(getPerformanceMetrics).toHaveBeenCalledTimes(2);
    expect(getResourceMetrics).not.toHaveBeenCalled();
  });

  it('labels process-only resource readings', async () => {
    getResourceMetrics.mockResolvedValue({ ...RESOURCES, cpu: { ...RESOURCES.cpu, source: 'process' } });
    const element = createStatusPage();
    await flushPromises();
    activateTab(element, 'diagnostics');
    await flushPromises();
    expect(textOf(element)).toContain('Node process only (LibreOffice not counted)');
  });
});


describe('Docgen reconnect', () => {
  const info = { orgId: '00D000000000001AAA', userId: '005000000000001AAA',
    namedCredential: 'Custom_Backend', backendUrl: 'https://custom-backend.example.com' };
  let popup;
  beforeEach(() => {
    getReconnectInfo.mockResolvedValue(info);
    checkConnection.mockResolvedValue({ connected: true, orgId: info.orgId, integrationUsername: 'integration@uipath.com.uatfull' });
    // Locker returns a restricted popup without a writable location property.
    popup = Object.preventExtensions({ closed: false, close: jest.fn(() => { popup.closed = true; }), postMessage: jest.fn() });
    jest.spyOn(window, 'open').mockImplementation((url) => {
      if (!String(url).startsWith('https://')) throw new Error('SecureWindow.open only supports allowed URL schemes');
      return popup;
    });
  });
  afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  function startSavedReconnect(element) {
    button(element, 'Connect / Reconnect').click();
    // Rendering the modal is asynchronous; use a queued click in existing async tests.
    return Promise.resolve().then(() => {
      const saved = button(element, 'Reconnect with saved credentials');
      if (saved) saved.click();
    });
  }
  function notify(data = {}, origin = 'https://custom-backend.example.com', source = popup) {
    window.dispatchEvent(new MessageEvent('message', { origin, source, data: {
      type: 'docgen:reconnect', success: true, orgId: info.orgId, namedCredential: info.namedCredential, ...data
    } }));
  }
  function enterCredentials(element, clientId = 'new-client-id', clientSecret = 'SECRET-INPUT') {
    for (const [field, value] of [['clientId', clientId], ['clientSecret', clientSecret]]) {
      const input = element.shadowRoot.querySelector(`[data-connection-field="${field}"]`);
      input.value = value;
      input.dispatchEvent(new CustomEvent('change'));
    }
  }

  it('opens a credential modal with the selected callback, app instructions and a password field', async () => {
    const element = createStatusPage(); await flushPromises();
    button(element, 'Connect / Reconnect').click(); await flushPromises();
    expect(element.shadowRoot.querySelector('[role="dialog"]')).not.toBeNull();
    expect(textOf(element)).toContain('External Client App Manager');
    expect(textOf(element)).toContain('https://custom-backend.example.com/connect/callback');
    expect(element.shadowRoot.querySelector('[data-connection-field="clientSecret"]').type).toBe('password');
    expect(window.open).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('a[download="uat_server.crt"]')).toBeNull();
  });

  it('offers the UAT public certificate only for the matching UAT backend', async () => {
    getReconnectInfo.mockResolvedValue({ ...info, backendUrl: 'https://docgen-uat.mangostone-78031136.eastus.azurecontainerapps.io' });
    const element = createStatusPage(); await flushPromises();
    button(element, 'Connect / Reconnect').click(); await flushPromises();
    expect(element.shadowRoot.querySelector('a[download="uat_server.crt"]')).not.toBeNull();
  });

  it('hands credentials only to the matching backend popup, once, without putting them in the launch URL', async () => {
    const element = createStatusPage(); await flushPromises();
    button(element, 'Connect / Reconnect').click(); await flushPromises();
    enterCredentials(element);
    button(element, 'Save credentials and connect').click();
    const launch = new URL(window.open.mock.calls[0][0]);
    expect(launch.pathname).toBe('/connect/prepare');
    expect(launch.toString()).not.toContain('SECRET-INPUT');
    expect(launch.toString()).not.toContain('new-client-id');
    notify({ type: 'docgen:credentials-ready' }, 'https://attacker.example.com');
    notify({ type: 'docgen:credentials-ready' }, 'https://custom-backend.example.com', window);
    expect(popup.postMessage).not.toHaveBeenCalled();
    notify({ type: 'docgen:credentials-ready' });
    expect(popup.postMessage).toHaveBeenCalledWith({ type: 'docgen:credentials', clientId: 'new-client-id',
      clientSecret: 'SECRET-INPUT', orgId: info.orgId, namedCredential: info.namedCredential }, 'https://custom-backend.example.com');
    notify({ type: 'docgen:credentials-ready' });
    expect(popup.postMessage).toHaveBeenCalledTimes(1);
    notify({ success: false, message: 'Authorization denied' }); await flushPromises();
    button(element, 'Connect / Reconnect').click(); await flushPromises();
    expect(element.shadowRoot.querySelector('[data-connection-field="clientSecret"]').value).toBe('');
  });

  it('validates input and clears canceled secrets', async () => {
    const element = createStatusPage(); await flushPromises();
    button(element, 'Connect / Reconnect').click(); await flushPromises();
    button(element, 'Save credentials and connect').click(); await flushPromises();
    expect(textOf(element)).toContain('Enter the OAuth app'); expect(window.open).not.toHaveBeenCalled();
    enterCredentials(element);
    button(element, 'Cancel').click(); await flushPromises();
    button(element, 'Connect / Reconnect').click(); await flushPromises();
    expect(element.shadowRoot.querySelector('[data-connection-field="clientSecret"]').value).toBe('');
  });

  it('clears entered credentials when the selected backend changes during setup', async () => {
    const element = createStatusPage(); await flushPromises();
    button(element, 'Connect / Reconnect').click(); await flushPromises(); enterCredentials(element);
    getReconnectInfo.mockResolvedValue({ ...info, backendUrl: 'https://changed.example.com' });
    button(element, 'Refresh').click(); await flushPromises();
    expect(element.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
    button(element, 'Connect / Reconnect').click(); await flushPromises();
    expect(element.shadowRoot.querySelector('[data-connection-field="clientSecret"]').value).toBe('');
  });
  it('opens the resolved override endpoint without relying on an authenticated Named Credential callout', async () => {
    const element = createStatusPage();
    await flushPromises();
    await startSavedReconnect(element);
    expect(window.open).toHaveBeenCalled();
    await flushPromises();
    const url = new URL(window.open.mock.calls[0][0]);
    expect(url.origin).toBe('https://custom-backend.example.com');
    expect(url.pathname).toBe('/connect/start');
    expect(url.searchParams.get('namedCredential')).toBe(info.namedCredential);
    expect(url.searchParams.get('orgId')).toBe(info.orgId);
    expect(url.searchParams.get('sourceOrigin')).toBe(window.location.origin);
    expect(checkConnection).not.toHaveBeenCalled();
    expect(button(element, 'Connecting…').disabled).toBe(true);
  });
  it('requires a matching popup message and a fresh connection check before reporting success', async () => {
    const element = createStatusPage(); await flushPromises();
    await startSavedReconnect(element); await flushPromises();
    notify({}, 'https://attacker.example.com');
    notify({}, 'https://custom-backend.example.com', window);
    notify({ orgId: 'different-org' });
    expect(checkConnection).not.toHaveBeenCalled();
    notify(); await flushPromises();
    expect(checkConnection).toHaveBeenCalledTimes(1);
    expect(textOf(element)).toContain('Both directions verified as integration@uipath.com.uatfull');
    expect(popup.close).toHaveBeenCalled();
  });
  it('reports a failed final check rather than trusting popup success', async () => {
    checkConnection.mockRejectedValue({ body: { message: 'Wrong backend org' } });
    const element = createStatusPage(); await flushPromises();
    await startSavedReconnect(element); await flushPromises();
    notify(); await flushPromises();
    expect(textOf(element)).toContain('Wrong backend org');
    expect(textOf(element)).not.toContain('Both directions verified as');
  });
  it('handles declined authorization and blocked popups without claiming a connection', async () => {
    const element = createStatusPage(); await flushPromises();
    await startSavedReconnect(element); await flushPromises();
    notify({ success: false, message: 'Authorization declined' }); await flushPromises();
    expect(textOf(element)).toContain('Authorization declined');
    expect(checkConnection).not.toHaveBeenCalled();
    window.open.mockReturnValue(null);
    await startSavedReconnect(element); await flushPromises();
    expect(textOf(element)).toContain('Allow popups');
  });
  it('reports missing credential metadata without opening a popup', async () => {
    getReconnectInfo.mockRejectedValue({ body: { message: 'Named Credential is missing' } });
    const element = createStatusPage(); await flushPromises();
    await startSavedReconnect(element); await flushPromises();
    expect(textOf(element)).toContain('Named Credential is missing');
    expect(button(element, 'Connect / Reconnect').disabled).toBe(true);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('waits for metadata, then opens HTTPS synchronously with the click', async () => {
    let resolveInfo;
    getReconnectInfo.mockReturnValueOnce(new Promise(resolve => { resolveInfo = resolve; }));
    const element = createStatusPage(); await flushPromises();
    expect(button(element, 'Preparing connection…').disabled).toBe(true);
    button(element, 'Preparing connection…').click();
    expect(window.open).not.toHaveBeenCalled();
    resolveInfo(info); await flushPromises();
    await startSavedReconnect(element);
    expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/custom-backend\.example\.com\/connect\/start\?/), '_blank', 'popup,width=680,height=800');
    expect(getReconnectInfo).toHaveBeenCalledTimes(1);
  });
  it('reloads endpoint selection on Refresh', async () => {
    const element = createStatusPage(); await flushPromises();
    getReconnectInfo.mockResolvedValue({ ...info, backendUrl: 'https://changed-backend.example.com', namedCredential: 'Changed_Backend' });
    button(element, 'Refresh').click(); await flushPromises();
    await startSavedReconnect(element);
    const url = new URL(window.open.mock.calls[0][0]);
    expect(url.hostname).toBe('changed-backend.example.com');
    expect(url.searchParams.get('namedCredential')).toBe('Changed_Backend');
  });

  it('refreshes stale endpoint details after a failed reconnect while preserving the error', async () => {
    const element = createStatusPage(); await flushPromises();
    await startSavedReconnect(element);
    getReconnectInfo.mockResolvedValue({ ...info, backendUrl: 'https://updated-backend.example.com' });
    notify({ success: false, message: 'Connection settings changed. Start again.' });
    await flushPromises();
    expect(textOf(element)).toContain('Connection settings changed');
    await startSavedReconnect(element);
    expect(new URL(window.open.mock.calls[1][0]).hostname).toBe('updated-backend.example.com');
  });

  it('prepares the connection when the runtime does not expose isConnected', async () => {
    class LockerStatus extends DocgenStatus {
      get isConnected() { return undefined; }
    }
    const element = createElement('c-locker-status', { is: LockerStatus });
    document.body.appendChild(element);
    await flushPromises();
    expect(button(element, 'Connect / Reconnect').disabled).toBe(false);
    await startSavedReconnect(element);
    expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/custom-backend\.example\.com\/connect\/start\?/), '_blank', 'popup,width=680,height=800');
  });

  it('ignores late metadata from a removed view and reloads when it is attached again', async () => {
    let resolveOld;
    getReconnectInfo.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const element = createStatusPage(); await flushPromises();
    document.body.removeChild(element);
    getReconnectInfo.mockResolvedValue({ ...info, backendUrl: 'https://new-view.example.com' });
    document.body.appendChild(element); await flushPromises();
    resolveOld(info); await flushPromises();
    expect(button(element, 'Connect / Reconnect').disabled).toBe(false);
    await startSavedReconnect(element);
    expect(new URL(window.open.mock.calls[0][0]).hostname).toBe('new-view.example.com');
  });
  it('explains incomplete endpoint details instead of silently disabling the button', async () => {
    getReconnectInfo.mockResolvedValue({});
    const element = createStatusPage(); await flushPromises();
    expect(button(element, 'Connect / Reconnect').disabled).toBe(true);
    expect(textOf(element)).toContain('Connection details are incomplete');
  });

});
