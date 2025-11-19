import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getSystemStatus from '@salesforce/apex/DocgenStatusController.getSystemStatus';
import getWorkerStatus from '@salesforce/apex/DocgenStatusController.getWorkerStatus';
import getWorkerStats from '@salesforce/apex/DocgenStatusController.getWorkerStats';
import getQueueMetrics from '@salesforce/apex/DocgenStatusController.getQueueMetrics';
import getRecentDocuments from '@salesforce/apex/DocgenStatusController.getRecentDocuments';

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
     */
    handleRefresh() {
        this.loadAllData();
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