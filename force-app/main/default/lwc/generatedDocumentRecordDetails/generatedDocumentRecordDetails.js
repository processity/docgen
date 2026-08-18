import { LightningElement, api, wire } from 'lwc';
import GENERATED_DOCUMENT_OBJECT from '@salesforce/schema/Generated_Document__c';
import getRecordView from '@salesforce/apex/GeneratedDocumentRecordController.getRecordView';

const FILE_ICONS = {
  pdf: 'doctype:pdf',
  doc: 'doctype:word',
  docx: 'doctype:word',
  ppt: 'doctype:ppt',
  pptx: 'doctype:ppt',
  xls: 'doctype:excel',
  xlsx: 'doctype:excel',
};

export default class GeneratedDocumentRecordDetails extends LightningElement {
  @api recordId;
  @api displayMode = 'full';

  objectApiName = GENERATED_DOCUMENT_OBJECT;
  summaryFields = [];
  lookupFields = [];
  files = [];
  payloads = [];
  openPayloadSections = [];
  loadError;
  isLoading = true;

  @wire(getRecordView, { recordId: '$recordId' })
  wiredRecordView({ data, error }) {
    if (data) {
      this.summaryFields = (data.summaryFieldApiNames || []).map((fieldApiName) => ({
        fieldApiName,
      }));
      this.lookupFields = data.lookupFields || [];
      this.files = (data.files || []).map((file) => this.toFileView(file));
      this.payloads = (data.payloads || []).map((payload) => ({
        ...payload,
        summary: this.formatCharacterCount(payload.characterCount),
      }));
      this.openPayloadSections = this.payloads
        .filter((payload) => {
          const key = String(payload.key || '').toLowerCase();
          return key === 'response' || key.includes('error');
        })
        .map((payload) => payload.key);
      this.loadError = undefined;
      this.isLoading = false;
    } else if (error) {
      this.summaryFields = [];
      this.lookupFields = [];
      this.files = [];
      this.payloads = [];
      this.openPayloadSections = [];
      this.loadError =
        error?.body?.message || error?.message || 'Unable to load the generated document.';
      this.isLoading = false;
    }
  }

  get hasSummaryFields() {
    return this.summaryFields.length > 0;
  }

  get hasLookupFields() {
    return this.lookupFields.length > 0;
  }

  get hasFiles() {
    return this.files.length > 0;
  }

  get hasPayloads() {
    return this.payloads.length > 0;
  }

  get showMainContent() {
    return this.normalizedDisplayMode !== 'diagnostics';
  }

  get showDiagnostics() {
    return this.normalizedDisplayMode !== 'main';
  }

  get normalizedDisplayMode() {
    return String(this.displayMode || 'full').toLowerCase();
  }

  toFileView(file) {
    const extension = String(file.fileExtension || '').toLowerCase();
    return {
      ...file,
      iconName: FILE_ICONS[extension] || 'doctype:unknown',
      recordUrl: `/lightning/r/ContentDocument/${file.contentDocumentId}/view`,
      detail: [
        file.role,
        extension ? extension.toUpperCase() : null,
        this.formatBytes(file.contentSize),
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatCharacterCount(value) {
    const count = Number(value) || 0;
    return `${new Intl.NumberFormat().format(count)} character${count === 1 ? '' : 's'}`;
  }
}
