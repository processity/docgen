import { LightningElement, api, wire } from 'lwc';
import getAttachmentContext from '@salesforce/apex/DocgenAttachmentService.getAttachmentContext';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

const MAX_FILE_COUNT = 20;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export default class DocgenAdditionalPdfSelector extends LightningElement {
  @api recordId;
  @api templateId;
  @api templateName;
  @api compositeDocumentId;
  @api outputFormat;

  files = [];
  selectedIds = [];
  isLoading = true;
  effectiveOutputFormat = null;
  loadError = null;

  @wire(getAttachmentContext, {
    recordId: '$recordId',
    templateId: '$templateId',
    templateName: '$templateName',
    compositeDocumentId: '$compositeDocumentId',
    requestedOutputFormat: '$outputFormat'
  })
  wiredContext({ data, error }) {
    this.isLoading = false;
    if (data) {
      this.loadError = null;
      this.effectiveOutputFormat = data.effectiveOutputFormat;
      this.files = (data.files || []).map((file) => ({
        ...file,
        formattedSize: this.formatBytes(file.contentSize)
      }));
      this.refreshFileState();
    } else if (error) {
      this.files = [];
      this.loadError = this.extractErrorMessage(error);
      this.showToast('Unable to Load PDF Files', this.loadError, 'error');
    }
  }

  get showSelector() {
    return this.effectiveOutputFormat === 'PDF';
  }

  get hasFiles() {
    return this.files.length > 0;
  }

  get hasSelectedFiles() {
    return this.selectedIds.length > 0;
  }

  get selectionSummary() {
    return `${this.selectedIds.length}/${MAX_FILE_COUNT} selected, ${this.formatBytes(this.selectedBytes)}`;
  }

  get selectedBytes() {
    const filesById = new Map(this.files.map((file) => [file.contentVersionId, file]));
    return this.selectedIds.reduce(
      (total, id) => total + (Number(filesById.get(id)?.contentSize) || 0),
      0
    );
  }

  get selectedFiles() {
    const filesById = new Map(this.files.map((file) => [file.contentVersionId, file]));
    return this.selectedIds.map((id, index) => {
      const file = filesById.get(id);
      return {
        contentVersionId: id,
        title: file?.title || id,
        formattedSize: file?.formattedSize || '',
        order: index + 1
      };
    });
  }

  @api
  setSelectedContentVersionIds(value) {
    let values = [];
    if (Array.isArray(value)) {
      values = value;
    } else if (typeof value === 'string' && value) {
      try {
        const parsed = JSON.parse(value);
        values = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        this.showToast(
          'Invalid PDF Selection',
          'Additional PDF ContentVersion IDs must be a JSON array.',
          'error'
        );
      }
    }
    this.selectedIds = [...new Set(values.filter(Boolean).map(String))].slice(0, MAX_FILE_COUNT);
    this.refreshFileState();
    this.dispatchSelectionChange();
  }

  @api
  getSelectedContentVersionIds() {
    return [...this.selectedIds];
  }

  @api
  clearSelection() {
    this.selectedIds = [];
    this.refreshFileState();
    this.dispatchSelectionChange();
  }

  handleSelectionChange(event) {
    const id = event.target.dataset.id;
    if (event.target.checked) {
      const file = this.files.find((item) => item.contentVersionId === id);
      const nextBytes = this.selectedBytes + (Number(file?.contentSize) || 0);
      if (this.selectedIds.length >= MAX_FILE_COUNT || nextBytes > MAX_TOTAL_BYTES) {
        event.target.checked = false;
        this.showToast(
          'Attachment Limit Reached',
          'Select no more than 20 PDF files or 50 MiB in total.',
          'warning'
        );
        return;
      }
      this.selectedIds = [...this.selectedIds, id];
    } else {
      this.selectedIds = this.selectedIds.filter((selectedId) => selectedId !== id);
    }
    this.refreshFileState();
    this.dispatchSelectionChange();
  }

  handleRemove(event) {
    const id = event.currentTarget.dataset.id;
    this.selectedIds = this.selectedIds.filter((selectedId) => selectedId !== id);
    this.refreshFileState();
    this.dispatchSelectionChange();
  }

  refreshFileState() {
    const selected = new Set(this.selectedIds);
    const selectedBytes = this.selectedBytes;
    this.files = this.files.map((file) => {
      const isSelected = selected.has(file.contentVersionId);
      return {
        ...file,
        selected: isSelected,
        disabled: !isSelected && (
          selected.size >= MAX_FILE_COUNT ||
          selectedBytes + (Number(file.contentSize) || 0) > MAX_TOTAL_BYTES
        )
      };
    });
  }

  dispatchSelectionChange() {
    this.dispatchEvent(new CustomEvent('selectionchange', {
      detail: {
        contentVersionIds: [...this.selectedIds],
        totalBytes: this.selectedBytes
      }
    }));
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

  extractErrorMessage(error) {
    return error?.body?.message || error?.message || 'Unable to load related PDF files.';
  }

  showToast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
