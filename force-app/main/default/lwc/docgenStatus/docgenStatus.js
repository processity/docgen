import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getSystemStatus from '@salesforce/apex/DocgenStatusController.getSystemStatus';
import getWorkerStatus from '@salesforce/apex/DocgenStatusController.getWorkerStatus';
import getWorkerStats from '@salesforce/apex/DocgenStatusController.getWorkerStats';
import getQueueMetrics from '@salesforce/apex/DocgenStatusController.getQueueMetrics';
import getRecentDocuments from '@salesforce/apex/DocgenStatusController.getRecentDocuments';
import getPerformanceMetrics from '@salesforce/apex/DocgenStatusController.getPerformanceMetrics';
import getResourceMetrics from '@salesforce/apex/DocgenStatusController.getResourceMetrics';
import getUsageMetrics from '@salesforce/apex/DocgenStatusController.getUsageMetrics';

// Backend stage keys mapped to labels an admin can act on
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
    @track systemStatus = {};
    @track workerStatus = {};
    @track workerStats = {};
    @track queueMetrics = {
        total: 0,
        succeeded: 0,
        failed: 0,
        queued: 0,
        processing: 0,
        successRate: 0,
        queueDepth: 0,
        retries: 0
    };
    @track recentDocuments = [];
    @track error;
    @track isLoading = true;
    @track lastUpdated = '';

    // Expandable panels load on first open so the page does not make their
    // callouts until an admin actually looks at them.
    @track performance;
    @track resources;
    @track performanceError;
    @track resourcesError;
    @track performanceLoading = false;
    @track resourcesLoading = false;

    // Column definitions for recent documents table
    documentColumns = [
        { label: 'Name', fieldName: 'name', type: 'text' },
        { label: 'Template', fieldName: 'templateName', type: 'text' },
        { label: 'Status', fieldName: 'status', type: 'text', cellAttributes: { class: { fieldName: 'statusClass' } } },
        { label: 'Format', fieldName: 'outputFormat', type: 'text' },
        { label: 'Attempts', fieldName: 'attempts', type: 'number' },
        { label: 'Created', fieldName: 'createdDate', type: 'date', typeAttributes: {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }},
        { label: 'Error', fieldName: 'error', type: 'text', wrapText: true }
    ];

    connectedCallback() {
        this.loadAllData();
    }

    /**
     * Load all data from Apex controllers
     */
    async loadAllData() {
        this.isLoading = true;
        this.error = null;

        try {
            // Load all data in parallel
            const [systemStatus, workerStatus, workerStats, queueMetrics, recentDocs] = await Promise.all([
                getSystemStatus(),
                getWorkerStatus(),
                getWorkerStats(),
                getQueueMetrics(),
                getRecentDocuments()
            ]);

            this.systemStatus = systemStatus || {};
            this.workerStatus = workerStatus || {};
            this.workerStats = workerStats || {};
            this.queueMetrics = queueMetrics || this.queueMetrics;
            this.recentDocuments = this.formatRecentDocuments(recentDocs || []);
            this.lastUpdated = this.formatCurrentTime();
        } catch (error) {
            this.error = this.reduceErrors(error);
            this.showToast('Error', this.error, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Format recent documents for display
     */
    formatRecentDocuments(docs) {
        return docs.map(doc => ({
            ...doc,
            statusClass: this.getStatusClass(doc.status),
            createdDate: doc.createdDate
        }));
    }

    /**
     * Get CSS class for status badge
     */
    getStatusClass(status) {
        switch (status) {
            case 'SUCCEEDED':
                return 'slds-text-color_success';
            case 'FAILED':
                return 'slds-text-color_error';
            case 'PROCESSING':
                return 'slds-text-color_warning';
            case 'QUEUED':
                return 'slds-text-color_default';
            case 'CANCELED':
                return 'slds-text-color_weak';
            default:
                return '';
        }
    }

    /**
     * Handle manual refresh
     * Reloads the always-visible sections plus any expandable panel already open.
     */
    handleRefresh() {
        this.loadAllData();

        if (this.performance || this.performanceError) {
            this.loadPerformance();
        }
        if (this.resources || this.resourcesError) {
            this.loadResources();
        }
    }

    /**
     * Load an expandable panel the first time it is opened
     */
    handleSectionToggle(event) {
        const open = event.detail.openSections;
        const sections = Array.isArray(open) ? open : [open].filter(Boolean);

        if (sections.includes('performance') && !this.performance && !this.performanceLoading) {
            this.loadPerformance();
        }
        if (sections.includes('resources') && !this.resources && !this.resourcesLoading) {
            this.loadResources();
        }
    }

    /**
     * Load performance metrics: org-wide volume from Salesforce plus the
     * processing-time and stage sample from whichever backend replica answers.
     */
    async loadPerformance() {
        this.performanceLoading = true;
        this.performanceError = null;

        try {
            const [usage, backend] = await Promise.all([getUsageMetrics(), getPerformanceMetrics()]);
            this.performance = this.buildPerformanceView(usage, backend);
        } catch (error) {
            this.performance = null;
            this.performanceError = this.reduceErrors(error);
        } finally {
            this.performanceLoading = false;
        }
    }

    /**
     * Load CPU, memory, LibreOffice pool and template cache utilization
     */
    async loadResources() {
        this.resourcesLoading = true;
        this.resourcesError = null;

        try {
            this.resources = this.buildResourceView(await getResourceMetrics());
        } catch (error) {
            this.resources = null;
            this.resourcesError = this.reduceErrors(error);
        } finally {
            this.resourcesLoading = false;
        }
    }

    /**
     * Format current time for display
     */
    formatCurrentTime() {
        const now = new Date();
        return now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    /**
     * Show toast notification
     */
    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    /**
     * Reduce error to readable message
     */
    reduceErrors(error) {
        if (!error) return 'Unknown error';
        if (Array.isArray(error.body)) {
            return error.body.map(e => e.message).join(', ');
        } else if (typeof error.body?.message === 'string') {
            return error.body.message;
        } else if (typeof error.message === 'string') {
            return error.message;
        }
        return JSON.stringify(error);
    }

    // ---------------------------------------------------------------
    // View models
    //
    // The templates cannot call functions, so all formatting, percentages and
    // bar widths are precomputed here.
    // ---------------------------------------------------------------

    /**
     * Format a millisecond duration for display
     */
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

    /**
     * Combine org-wide volume (SOQL, all replicas) with the per-replica backend
     * timing sample into one view model.
     */
    buildPerformanceView(usage, backend) {
        const documents = (backend && backend.documents) || {};
        const latency = documents.latency;
        const stages = (backend && backend.stages) || [];
        const slowestTotal = stages.length > 0 ? stages[0].totalMs : 0;

        const hourly = (usage && usage.hourly) || [];
        const busiestHour = hourly.reduce((max, bucket) => Math.max(max, bucket.count), 0);

        return {
            usage: {
                lastHour: usage.lastHour,
                last24Hours: usage.last24Hours,
                last7Days: usage.last7Days,
                perHourAverage: usage.perHourAverage,
                peakHourLabel: usage.peakHourLabel || 'No activity',
                peakHourCount: usage.peakHourCount,
                hasVolume: usage.last24Hours > 0,
                hourly: hourly.map((bucket, index) => ({
                    key: `${index}-${bucket.label}`,
                    label: bucket.label,
                    count: bucket.count,
                    barStyle: this.barStyle(bucket.count, busiestHour)
                })),
                byFormat: (usage.byFormat || []).map(entry => ({
                    key: entry.format,
                    label: entry.format,
                    count: entry.count,
                    barStyle: this.barStyle(entry.count, usage.last24Hours)
                })),
                topTemplates: (usage.topTemplates || []).map(entry => ({
                    key: entry.templateName,
                    label: entry.templateName,
                    count: entry.count,
                    barStyle: this.barStyle(entry.count, usage.last24Hours)
                }))
            },
            replica: {
                replicaId: backend.replicaId,
                windowMinutes: Math.round((backend.windowSeconds || 0) / 60),
                observedLabel: this.formatSeconds(backend.observedSeconds),
                uptimeLabel: this.formatSeconds(backend.processUptimeSeconds)
            },
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
            byMode: (documents.byMode || []).map(entry => ({
                key: entry.key,
                // 'interactive' is a user clicking generate; 'batch' is the poller
                label: entry.key === 'interactive' ? 'Interactive' : 'Batch (poller)',
                count: entry.count,
                avg: this.formatMs(entry.avgMs),
                p95: this.formatMs(entry.p95Ms)
            })),
            hasStages: stages.length > 0,
            slowestStage: STAGE_LABELS[backend.slowestStageByTotalTime] || backend.slowestStageByTotalTime,
            stages: stages.map(stage => ({
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

    /**
     * Shape the per-replica resource snapshot for display
     */
    buildResourceView(snapshot) {
        const cpu = snapshot.cpu || {};
        const memory = snapshot.memory || {};
        const pool = snapshot.libreOfficePool || {};
        const cache = snapshot.templateCache || {};
        const eventLoop = snapshot.eventLoopDelayMs;

        return {
            replicaId: snapshot.replicaId,
            uptimeLabel: this.formatSeconds(snapshot.processUptimeSeconds),
            cpu: {
                hasReading: cpu.percent !== null && cpu.percent !== undefined,
                percent: cpu.percent,
                cores: cpu.cores,
                source: this.sourceLabel(cpu.source),
                sampleLabel: cpu.sampleSeconds ? `${cpu.sampleSeconds}s average` : 'Warming up',
                barStyle: this.barStyle(cpu.percent || 0, 100)
            },
            memory: {
                hasLimit: memory.limitMb !== null && memory.limitMb !== undefined,
                usedMb: memory.usedMb,
                limitMb: memory.limitMb,
                percentOfLimit: memory.percentOfLimit,
                source: this.sourceLabel(memory.source),
                barStyle: this.barStyle(memory.percentOfLimit || 0, 100),
                nodeRssMb: memory.node ? memory.node.rssMb : null,
                nodeHeapLabel: memory.node
                    ? `${memory.node.heapUsedMb} / ${memory.node.heapTotalMb} MB`
                    : '-'
            },
            eventLoop: eventLoop
                ? {
                      p50: `${eventLoop.p50} ms`,
                      p99: `${eventLoop.p99} ms`,
                      max: `${eventLoop.max} ms`,
                      isHealthy: eventLoop.p99 < 100
                  }
                : null,
            pool: {
                activeJobs: pool.activeJobs,
                queuedJobs: pool.queuedJobs,
                maxConcurrent: pool.maxConcurrent,
                utilizationPercent: pool.utilizationPercent,
                completedJobs: pool.completedJobs,
                failedJobs: pool.failedJobs,
                totalConversions: pool.totalConversions,
                barStyle: this.barStyle(pool.activeJobs || 0, pool.maxConcurrent || 1),
                isSaturated: pool.queuedJobs > 0
            },
            cache: {
                hasLookups: (cache.lookups || 0) > 0,
                hitRatePercent: cache.hitRatePercent,
                hits: cache.hits,
                misses: cache.misses,
                entryCount: cache.entryCount,
                evictions: cache.evictions,
                sizeLabel: `${cache.sizeMb} / ${cache.maxSizeMb} MB`,
                utilizationPercent: cache.utilizationPercent,
                hitBarStyle: this.barStyle(cache.hitRatePercent || 0, 100),
                sizeBarStyle: this.barStyle(cache.utilizationPercent || 0, 100)
            }
        };
    }

    /**
     * Explain where a CPU or memory reading came from
     */
    sourceLabel(source) {
        switch (source) {
            case 'cgroup-v2':
            case 'cgroup-v1':
                return 'Container total (includes LibreOffice)';
            case 'process':
                return 'Node process only (LibreOffice not counted)';
            default:
                return 'Unknown';
        }
    }

    // Computed properties for UI

    get readinessIcon() {
        return this.systemStatus.ready ? 'utility:success' : 'utility:error';
    }

    get readinessStatus() {
        return this.systemStatus.ready ? 'Ready' : 'Not Ready';
    }

    get readinessVariant() {
        return this.systemStatus.ready ? 'success' : 'error';
    }

    get readinessBadgeClass() {
        return this.systemStatus.ready ? 'success-badge' : 'error-badge';
    }

    get jwksIcon() {
        return this.systemStatus.checks?.jwks ? 'utility:success' : 'utility:error';
    }

    get salesforceIcon() {
        return this.systemStatus.checks?.salesforce ? 'utility:success' : 'utility:error';
    }

    get keyVaultIcon() {
        return this.systemStatus.checks?.keyVault ? 'utility:success' : 'utility:error';
    }

    get workerStatusLabel() {
        return 'Always Running';
    }

    get workerStatusBadgeClass() {
        return 'success-badge';
    }

    get lastPollTime() {
        if (!this.workerStatus.lastPollTime) return 'Never';
        try {
            const date = new Date(this.workerStatus.lastPollTime);
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (e) {
            return this.workerStatus.lastPollTime;
        }
    }
}