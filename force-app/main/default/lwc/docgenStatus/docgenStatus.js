import { LightningElement } from 'lwc';
import getSystemStatus from '@salesforce/apex/DocgenStatusController.getSystemStatus';
import getQueueMetrics from '@salesforce/apex/DocgenStatusController.getQueueMetrics';
import getRecentDocuments from '@salesforce/apex/DocgenStatusController.getRecentDocuments';
import getFleetMetrics from '@salesforce/apex/DocgenStatusController.getFleetMetrics';
import getUsageMetrics from '@salesforce/apex/DocgenStatusController.getUsageMetrics';

const STAGE_LABELS = {
    templateFetch: 'Template fetch',
    merge: 'Template merge',
    concatenate: 'Section concatenate',
    pdfConvert: 'PDF conversion (LibreOffice)',
    pdfAttachments: 'PDF attachments',
    previewRender: 'Preview render',
    sfUpload: 'Salesforce upload'
};

export default class DocgenStatus extends LightningElement {
    systemStatus;
    queueMetrics;
    recentDocuments = [];
    usage;
    performance;
    fleet;
    healthError;
    queueError;
    documentsError;
    usageError;
    fleetError;
    isLoading = false;
    usageLoading = false;
    fleetLoading = false;
    lastUpdated;
    activeTab = 'overview';
    pageNumber = 1;
    pageSize = '10';
    searchTerm = '';
    statusFilter = 'ALL';
    sortedBy = 'createdDate';
    sortDirection = 'desc';

    pageSizeOptions = [
        { label: '10', value: '10' },
        { label: '25', value: '25' }
    ];
    statusOptions = [
        { label: 'All statuses', value: 'ALL' },
        { label: 'Succeeded', value: 'SUCCEEDED' },
        { label: 'Failed', value: 'FAILED' },
        { label: 'Queued', value: 'QUEUED' },
        { label: 'Processing', value: 'PROCESSING' },
        { label: 'Canceled', value: 'CANCELED' }
    ];
    documentColumns = [
        {
            label: 'Document',
            fieldName: 'recordUrl',
            type: 'url',
            sortable: true,
            initialWidth: 150,
            typeAttributes: { label: { fieldName: 'name' }, target: '_self' }
        },
        { label: 'Template', fieldName: 'templateName', type: 'text', sortable: true },
        {
            label: 'Status',
            fieldName: 'status',
            type: 'text',
            sortable: true,
            initialWidth: 130,
            cellAttributes: { class: { fieldName: 'statusClass' } }
        },
        { label: 'Format', fieldName: 'outputFormat', type: 'text', sortable: true, initialWidth: 90 },
        { label: 'Attempts', fieldName: 'attempts', type: 'number', sortable: true, initialWidth: 100 },
        {
            label: 'Created',
            fieldName: 'createdDate',
            type: 'date',
            sortable: true,
            initialWidth: 190,
            typeAttributes: { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
        },
        { label: 'Error', fieldName: 'error', type: 'text' }
    ];

    connectedCallback() {
        this.loadAllData();
        this.loadUsage();
        this.loadFleet();
    }

    // Each source fails independently so a backend outage does not hide the queue.
    async loadAllData() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.healthError = null;
        this.queueError = null;
        this.documentsError = null;
        const results = await Promise.allSettled([getSystemStatus(), getQueueMetrics(), getRecentDocuments()]);
        const [health, queue, docs] = results;
        this.systemStatus = health.status === 'fulfilled' ? health.value : null;
        this.healthError = health.status === 'rejected' ? this.reduceErrors(health.reason) : null;
        this.queueMetrics = queue.status === 'fulfilled' ? queue.value : null;
        this.queueError = queue.status === 'rejected' ? this.reduceErrors(queue.reason) : null;
        this.recentDocuments =
            docs.status === 'fulfilled'
                ? (docs.value || []).map((doc) => ({
                      ...doc,
                      recordUrl: `/lightning/r/Generated_Document__c/${doc.id}/view`,
                      statusClass:
                          doc.status === 'FAILED'
                              ? 'slds-text-color_error'
                              : doc.status === 'SUCCEEDED'
                                ? 'slds-text-color_success'
                                : '',
                      templateName: doc.templateName || '—'
                  }))
                : [];
        this.documentsError = docs.status === 'rejected' ? this.reduceErrors(docs.reason) : null;
        this.pageNumber = Math.min(this.pageNumber, this.totalPages);
        this.lastUpdated = new Date().toLocaleTimeString();
        this.isLoading = false;
    }

    handleRefresh() {
        if (this.isRefreshing) return;
        this.loadAllData();
        this.loadUsage();
        this.loadFleet();
    }

    handleTabActive(event) {
        this.activeTab = event.target.value;
    }

    async loadUsage() {
        if (this.usageLoading) return;
        this.usageLoading = true;
        this.usageError = null;
        this.usage = null;
        try {
            this.usage = this.buildUsageView(await getUsageMetrics());
        } catch (error) {
            this.usageError = this.reduceErrors(error);
        } finally {
            this.usageLoading = false;
        }
    }

    async loadFleet() {
        if (this.fleetLoading) return;
        this.fleetLoading = true;
        this.fleetError = null;
        this.fleet = null;
        this.performance = null;
        try {
            const snapshot = await getFleetMetrics();
            if (snapshot?.scope !== 'fleet') throw new Error('The backend did not return fleet metrics.');
            this.fleet = this.buildFleetView(snapshot);
            this.performance = snapshot.performance ? this.buildPerformanceView(snapshot.performance) : null;
        } catch (error) {
            this.fleetError = this.reduceErrors(error);
        } finally {
            this.fleetLoading = false;
        }
    }

    handleSearch(event) {
        this.searchTerm = event.target.value || '';
        this.pageNumber = 1;
    }
    handleStatusFilter(event) {
        this.statusFilter = event.detail.value;
        this.pageNumber = 1;
    }
    handlePageSize(event) {
        this.pageSize = event.detail.value;
        this.pageNumber = 1;
    }
    handlePrevious() {
        this.pageNumber = Math.max(1, this.pageNumber - 1);
    }
    handleNext() {
        this.pageNumber = Math.min(this.totalPages, this.pageNumber + 1);
    }
    handleSort(event) {
        this.sortedBy = event.detail.fieldName;
        this.sortDirection = event.detail.sortDirection;
        this.pageNumber = 1;
    }

    get filteredDocuments() {
        const query = this.searchTerm.trim().toLowerCase();
        const field = this.sortedBy === 'recordUrl' ? 'name' : this.sortedBy;
        const direction = this.sortDirection === 'asc' ? 1 : -1;
        return this.recentDocuments
            .filter(
                (doc) =>
                    (this.statusFilter === 'ALL' || doc.status === this.statusFilter) &&
                    (!query ||
                        [doc.name, doc.templateName, doc.error, doc.requestedBy].some((value) =>
                            (value || '').toLowerCase().includes(query)
                        ))
            )
            .sort((a, b) => {
                const left = a[field] ?? '';
                const right = b[field] ?? '';
                return (
                    direction *
                    (typeof left === 'number' && typeof right === 'number'
                        ? left - right
                        : String(left).localeCompare(String(right), undefined, { numeric: true }))
                );
            });
    }
    get pagedDocuments() {
        return this.filteredDocuments.slice(this.rowOffset, this.rowOffset + Number(this.pageSize));
    }
    get rowOffset() {
        return (this.pageNumber - 1) * Number(this.pageSize);
    }
    get totalPages() {
        return Math.max(1, Math.ceil(this.filteredDocuments.length / Number(this.pageSize)));
    }
    get previousDisabled() {
        return this.pageNumber === 1;
    }
    get nextDisabled() {
        return this.pageNumber >= this.totalPages;
    }
    get hasDocuments() {
        return this.filteredDocuments.length > 0;
    }
    get paginationLabel() {
        const count = this.filteredDocuments.length;
        return count
            ? `${this.rowOffset + 1}–${Math.min(this.rowOffset + Number(this.pageSize), count)} of ${count} · Page ${this.pageNumber} of ${this.totalPages}`
            : '0 documents';
    }
    get isRefreshing() {
        return this.isLoading || this.usageLoading || this.fleetLoading;
    }
    get updatedLabel() {
        return this.lastUpdated ? `Last refresh: ${this.lastUpdated}` : 'Loading status…';
    }
    get readinessStatus() {
        if (this.systemStatus?.ready === true) return 'Ready';
        if (this.systemStatus?.ready === false) return 'Not ready';
        return 'Unavailable';
    }
    get readinessBadgeClass() {
        return this.systemStatus?.ready === true
            ? 'success-badge'
            : this.systemStatus?.ready === false
              ? 'error-badge'
              : '';
    }
    get serviceChecks() {
        return [
            ['jwks', 'Authentication'],
            ['salesforce', 'Salesforce connection'],
            ['keyVault', 'Key Vault']
        ].map(([key, label]) => {
            const value = this.systemStatus?.checks?.[key];
            return {
                key,
                label,
                status: value === true ? 'Connected' : value === false ? 'Needs attention' : 'Unavailable',
                icon: value === true ? 'utility:success' : value === false ? 'utility:error' : 'utility:question'
            };
        });
    }
    get summaryCards() {
        const metrics = this.queueMetrics;
        return [
            {
                key: 'total',
                label: 'Documents requested',
                value: metrics?.total ?? '—',
                detail: 'Created in the last 24 hours'
            },
            {
                key: 'rate',
                label: 'Success rate',
                value: metrics?.successRate == null ? '—' : `${metrics.successRate}%`,
                detail: 'Succeeded ÷ (succeeded + failed)'
            },
            {
                key: 'failed',
                label: 'Failed documents',
                value: metrics?.failed ?? '—',
                detail: 'From requests in the last 24 hours'
            },
            {
                key: 'queue',
                label: 'Current backlog',
                value: metrics?.queueDepth ?? '—',
                detail: 'Queued + processing, all ages'
            }
        ];
    }
    get outcomes() {
        if (!this.queueMetrics) return [];
        return [
            ['succeeded', 'Succeeded'],
            ['failed', 'Failed'],
            ['queued', 'Queued'],
            ['processing', 'Processing'],
            ['canceled', 'Canceled']
        ].map(([key, label]) => ({
            key,
            label,
            count: this.queueMetrics[key] ?? 0,
            barStyle: this.barStyle(this.queueMetrics[key] || 0, this.queueMetrics.total),
            className: `metric-bar__fill outcome-${key}`
        }));
    }
    get attentionText() {
        if (!this.queueMetrics) return 'Queue data is unavailable. Refresh to try again.';
        if (this.queueMetrics.failed > 0)
            return `${this.queueMetrics.failed} failed documents among requests created in the last 24 hours. Open Documents to inspect recent errors.`;
        return 'No failed documents among requests created in the last 24 hours.';
    }

    reduceErrors(error) {
        if (Array.isArray(error?.body)) return error.body.map((entry) => entry.message).join(', ');
        return error?.body?.message || error?.message || 'Unable to load this section. Refresh to try again.';
    }

    buildUsageView(usage) {
        const hourly = usage.hourly || [];
        const peak = Math.max(1, ...hourly.map((bucket) => bucket.count));
        const breakdown = (entries, key) =>
            entries.map((entry, index) => ({
                key: `${index}`,
                label: entry[key],
                count: entry.count,
                barStyle: this.barStyle(entry.count, usage.last24Hours)
            }));
        const colors = ['#0176d3', '#04a59a', '#8a5ed6', '#e49b26', '#d55d83', '#687c94'];
        let cumulative = 0;
        const byFormat = breakdown(usage.byFormat || [], 'format').map((entry, index) => {
            const share = usage.last24Hours > 0 ? (entry.count / usage.last24Hours) * 100 : 0;
            const start = cumulative;
            cumulative += share;
            const color = colors[index % colors.length];
            return {
                ...entry,
                percent: share.toFixed(1),
                colorStyle: `background: ${color}`,
                segment: `${color} ${start}% ${cumulative}%`
            };
        });
        return {
            ...usage,
            byFormat,
            donutStyle: `background: conic-gradient(${byFormat.length ? byFormat.map((entry) => entry.segment).join(', ') : '#eef2f6 0% 100%'})`,
            formatDescription: byFormat
                .map((entry) => `${entry.label}: ${entry.count} requests (${entry.percent}%)`)
                .join(', '),
            hasVolume: usage.last24Hours > 0,
            peakHourLabel: usage.peakHourLabel || 'No activity',
            hourly: hourly.map((bucket, index) => ({
                key: `${index}`,
                label: bucket.label,
                count: bucket.count,
                title: `${bucket.label}: ${bucket.count} documents`,
                barStyle: `height: ${((bucket.count / peak) * 100).toFixed(1)}%`,
                axisLabel: index % 4 === 0 ? bucket.label.split(' ').slice(1, 2).join('') : ''
            })),
            topTemplates: breakdown(usage.topTemplates || [], 'templateName')
        };
    }

    formatMs(ms) {
        if (ms === null || ms === undefined) return '-';
        if (ms < 1000) return `${Math.round(ms)} ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    }

    /**
     * Format a second-based duration for display
     */
    formatSeconds(seconds) {
        if (seconds === null || seconds === undefined) return '-';
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }

    /**
     * Percentage as a bar width, clamped so an over-limit reading stays in bounds
     */
    barStyle(value, max) {
        const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
        return `width: ${percent.toFixed(1)}%`;
    }

    buildPerformanceView(backend) {
        const documents = backend.documents || {};
        const latency = documents.latency;
        const stages = backend.stages || [];
        const slowestTotal = Math.max(0, ...stages.map((stage) => stage.totalMs));
        return {
            hasSamples: (documents.count || 0) > 0,
            sampleCount: documents.count || 0,
            succeeded: documents.succeeded || 0,
            failed: documents.failed || 0,
            successRate:
                documents.successRatePercent === null || documents.successRatePercent === undefined
                    ? '-'
                    : `${documents.successRatePercent}%`,
            perMinute: documents.perMinute,
            perHour: documents.perHour,
            latency: latency
                ? {
                      p50: this.formatMs(latency.p50Ms),
                      p95: this.formatMs(latency.p95Ms),
                      p99: this.formatMs(latency.p99Ms),
                      avg: this.formatMs(latency.avgMs),
                      max: this.formatMs(latency.maxMs)
                  }
                : null,
            byMode: (documents.byMode || []).map((entry) => ({
                key: entry.key,
                // 'interactive' is a user clicking generate; 'batch' is the poller
                label:
                    entry.key === 'interactive' ? 'Interactive' : entry.key === 'batch' ? 'Batch (poller)' : 'Unknown',
                count: entry.count,
                avg: this.formatMs(entry.avgMs),
                p95: this.formatMs(entry.p95Ms)
            })),
            hasStages: stages.length > 0,
            slowestStage: STAGE_LABELS[backend.slowestStageByTotalTime] || backend.slowestStageByTotalTime,
            stages: stages.map((stage) => ({
                key: stage.stage,
                label: STAGE_LABELS[stage.stage] || stage.stage,
                count: stage.count,
                errorCount: stage.errorCount,
                avg: this.formatMs(stage.avgMs),
                p50: this.formatMs(stage.p50Ms),
                p95: this.formatMs(stage.p95Ms),
                max: this.formatMs(stage.maxMs),
                total: this.formatMs(stage.totalMs),
                barStyle: this.barStyle(stage.totalMs, slowestTotal)
            }))
        };
    }

    buildFleetView(snapshot) {
        const coverage = snapshot.coverage || {};
        const resources = snapshot.resources || {};
        const number = (value, suffix = '') =>
            value == null ? '—' : `${Number(value).toFixed(1).replace(/\.0$/, '')}${suffix}`;
        return {
            coverageLabel: !coverage.inventoryAvailable
                ? 'Replica inventory unavailable'
                : `${coverage.reportingReplicas} of ${coverage.activeReplicas} active replicas reporting`,
            incomplete: !coverage.complete,
            noTelemetry: !coverage.telemetryAvailable,
            updatedLabel: new Date(snapshot.generatedAt).toLocaleString(),
            windowMinutes: Math.round(snapshot.windowSeconds / 60),
            resourceCards: [
                {
                    key: 'cpu',
                    label: 'Fleet CPU',
                    value: number(resources.cpuPercent, '%'),
                    detail: `${number(resources.cores)} allocated cores · capacity weighted`
                },
                {
                    key: 'memory',
                    label: 'Fleet memory',
                    value: number(resources.memoryPercent, '%'),
                    detail: `${number(resources.memoryUsedMb)} / ${number(resources.memoryLimitMb)} MB`
                },
                {
                    key: 'pool',
                    label: 'Conversion slots',
                    value: number(resources.activeJobs),
                    detail: `${number(resources.maxConcurrent)} total slots · ${number(resources.queuedJobs)} waiting`
                },
                {
                    key: 'cache',
                    label: 'Cache hit rate',
                    value: number(resources.cacheHitRatePercent, '%'),
                    detail: `${number(resources.cacheHits)} hits · ${number(resources.cacheMisses)} misses since active processes started`
                }
            ],
            replicas: (snapshot.replicas || []).map((replica) => {
                const resource = replica.snapshot || {};
                const cpu = resource.cpu || {};
                const memory = resource.memory || {};
                const pool = resource.libreOfficePool || {};
                const cache = resource.templateCache || {};
                const status =
                    replica.active === false
                        ? 'Historical · no longer active'
                        : replica.active === null
                          ? 'Activity unknown'
                          : replica.freshness === 'fresh'
                            ? 'Active · reporting'
                            : replica.freshness === 'stale'
                              ? 'Active · stale data'
                              : 'Active · awaiting telemetry';
                return {
                    ...replica,
                    status,
                    badgeClass: replica.active && replica.freshness === 'fresh' ? 'success-badge' : '',
                    lastSeenLabel: replica.lastSeen ? new Date(replica.lastSeen).toLocaleTimeString() : 'Not received',
                    cpuLabel: number(cpu.percent, '%'),
                    memoryLabel: number(memory.percentOfLimit, '%'),
                    cpuSource: cpu.source === 'process' ? 'Node process only' : 'Container total',
                    cpuStyle: this.barStyle(cpu.percent || 0, 100),
                    memoryStyle: this.barStyle(memory.percentOfLimit || 0, 100),
                    memoryDetail: `${number(memory.usedMb)} / ${number(memory.limitMb)} MB`,
                    poolLabel: `${number(pool.activeJobs)} / ${number(pool.maxConcurrent)} active · ${number(pool.queuedJobs)} waiting`,
                    cacheLabel: number(cache.hitRatePercent, '%'),
                    countLabel: replica.documents ? replica.documents.count : '—',
                    p95Label: replica.documents ? this.formatMs(replica.documents.p95Ms) : '—'
                };
            })
        };
    }
}
