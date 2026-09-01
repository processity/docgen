import { LightningElement, api } from 'lwc';
import generateCompositeWithAttachments from '@salesforce/apex/DocgenController.generateCompositeWithAttachments';
import startCompositeGeneration from '@salesforce/apex/DocgenAsyncController.startCompositeGeneration';
import wakePoller from '@salesforce/apex/DocgenAsyncController.wakePoller';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';
import saveGeneratedDocument from '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument';
import cancelGeneratedDocument from '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_SECONDS = 180;

/**
 * LWC component for interactive composite document generation
 * Allows users to generate PDF/DOCX/PPTX/XLSX documents from multiple data sources.
 *
 * @component compositeDocgenButton
 * @example
 * <c-composite-docgen-button
 *   composite-document-id="a0Y1234567890ABC"
 *   record-id-field="accountId"
 *   output-format="PDF"
 *   button-label="Generate Composite Report"
 *   success-message="Composite report generated successfully!">
 * </c-composite-docgen-button>
 */
export default class CompositeDocgenButton extends NavigationMixin(LightningElement) {
  /**
   * Composite Document ID (Composite_Document__c record ID)
   * @type {string}
   * @required
   */
  @api compositeDocumentId;

  /**
   * Output format override (PDF, DOCX, PPTX, or XLSX). Blank uses the composite default.
   * @type {string}
   */
  @api outputFormat;

  /**
   * Protect generated DOCX content while leaving supported form fields editable.
   * Ignored for PDF, PPTX, and XLSX output.
   * @type {boolean}
   */
  @api readOnlyWord = false;
  @api additionalPdfContentVersionIds = [];

  /**
   * Current record ID (automatically provided by Lightning runtime)
   * @type {string}
   */
  @api recordId;

  /**
   * Variable name for the primary record ID (e.g., "accountId", "opportunityId")
   * Used as the key in the recordIds map.
   * @type {string}
   */
  @api recordIdField;

  /**
   * Additional record IDs as JSON string
   * Example: '{"contactId":"003xxx","opportunityId":"006xxx"}'
   * @type {string}
   */
  @api additionalRecordIds;

  /**
   * Custom button label
   * @type {string}
   * @default 'Generate Composite Document'
   */
  @api buttonLabel = 'Generate Composite Document';

  /**
   * Custom success message for toast
   * @type {string}
   * @default 'Composite document generated successfully!'
   */
  @api successMessage = 'Composite document generated successfully!';

  @api maxPollSeconds = DEFAULT_MAX_POLL_SECONDS;
  @api pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

  _hideButton = false;
  _hideFilePicker = false;
  _openOnSuccess = true;
  _previewBeforeSave = false;
  isProcessing = false;
  isSavingPreview = false;
  isCancelingPreview = false;
  progressValue = 0;
  status = null;
  generatedDocumentId = null;
  isPreviewPending = false;
  savedDownloadUrl = null;
  savedContentDocumentId = null;
  previewThumbnailUrl = null;
  outputFormatLabel = null;
  pollTimer = null;
  currentRunPromise = null;
  pollStartTime = 0;

  get showButton() {
    return !this.hideButton;
  }

  get showProgressPanel() {
    return this.isProcessing || this.status;
  }

  get showAttachmentSelector() {
    return !this.hideFilePicker && !this.isProcessing && !this.status;
  }

  get showPreviewPanel() {
    return Boolean(
      this.status === 'SUCCEEDED' &&
        this.generatedDocumentId &&
        this.isPreviewPending &&
        !this.savedDownloadUrl
    );
  }

  get showSavedDownloadPanel() {
    return Boolean(
      this.status === 'SUCCEEDED' &&
        this.generatedDocumentId &&
        (this.savedDownloadUrl || this.savedContentDocumentId)
    );
  }

  get showPdfPreview() {
    return this.showPreviewPanel && this.normalizedPreviewFormat === 'PDF';
  }

  get showUnsupportedPreview() {
    return this.showPreviewPanel && !this.showPdfPreview;
  }

  get normalizedPreviewFormat() {
    return String(this.outputFormatLabel || this.outputFormat || '').toUpperCase();
  }

  get disablePreviewActions() {
    return this.isSavingPreview || this.isCancelingPreview;
  }

  get showPreviewActionSpinner() {
    return this.isSavingPreview || this.isCancelingPreview;
  }

  get previewActionMessage() {
    if (this.isSavingPreview) {
      return 'Saving document...';
    }
    if (this.isCancelingPreview) {
      return 'Canceling preview...';
    }
    return '';
  }

  get progressBarStyle() {
    const progress = Math.max(0, Math.min(100, Number(this.progressValue) || 0));
    return `width: ${progress}%`;
  }

  get fallbackMessage() {
    const format = this.normalizedPreviewFormat || 'This file type';
    return `${format} preview is not supported. Save the document to download and review it.`;
  }

  get hasSavedThumbnail() {
    return Boolean(this.previewThumbnailUrl);
  }

  get hasSavedDownloadUrl() {
    return Boolean(this.savedDownloadUrl);
  }

  get experienceSitePrefix() {
    const routeMatch = (window.location.pathname || '').match(/^(.*)\/s(?:\/|$)/);
    return routeMatch ? routeMatch[1] : null;
  }

  get savedFileTitle() {
    const format = this.normalizedPreviewFormat || 'Document';
    return `Generated ${format}`;
  }

  get savedFileIconName() {
    if (this.normalizedPreviewFormat === 'PDF') {
      return 'doctype:pdf';
    }
    if (this.normalizedPreviewFormat === 'DOCX') {
      return 'doctype:word';
    }
    if (this.normalizedPreviewFormat === 'PPTX') {
      return 'doctype:ppt';
    }
    if (this.normalizedPreviewFormat === 'XLSX') {
      return 'doctype:excel';
    }
    return 'doctype:attachment';
  }

  get savedPreviewDisabled() {
    return !this.savedContentDocumentId;
  }

  get savedPreviewActionLabel() {
    return !this.savedPreviewDisabled
      ? `Open ${this.savedFileTitle} in Salesforce preview`
      : 'Salesforce preview is unavailable';
  }

  get savedContentDocumentPageReference() {
    if (!this.savedContentDocumentId) {
      return null;
    }

    return {
      type: 'standard__recordPage',
      attributes: {
        recordId: this.savedContentDocumentId,
        objectApiName: 'ContentDocument',
        actionName: 'view'
      }
    };
  }

  get displayStatus() {
    if (this.status === 'QUEUED') {
      return 'Queued';
    }
    if (this.status === 'PROCESSING') {
      return 'Processing';
    }
    if (this.status === 'SUCCEEDED') {
      return 'Complete';
    }
    if (this.status === 'FAILED') {
      return 'Failed';
    }
    if (this.status === 'CANCELED') {
      return 'Canceled';
    }
    return this.isProcessing ? 'Starting' : '';
  }

  @api
  get hideButton() {
    return this._hideButton;
  }

  set hideButton(value) {
    this._hideButton = this.normalizeBoolean(value, false);
  }

  @api
  get hideFilePicker() {
    return this._hideFilePicker;
  }

  set hideFilePicker(value) {
    this._hideFilePicker = this.normalizeBoolean(value, false);
  }

  @api
  get openOnSuccess() {
    return this._openOnSuccess;
  }

  set openOnSuccess(value) {
    this._openOnSuccess = this.normalizeBoolean(value, true);
  }

  @api
  get previewBeforeSave() {
    return this._previewBeforeSave;
  }

  set previewBeforeSave(value) {
    this._previewBeforeSave = this.normalizeBoolean(value, false);
  }

  disconnectedCallback() {
    this.clearPollTimer();
    this.clearPreviewState();
  }

  /**
   * Handles button click event
   * @private
   */
  async handleGenerate() {
    await this.generate();
  }

  /**
   * Generates a composite document from a parent component or the internal button.
   * @param {Object} config Runtime values that override component properties
   * @returns {Promise<string|Object|null>} Download URL for immediate generation, status result for preview generation, or null on failure
   */
  @api
  async generate(config = {}) {
    if (this.isProcessing && this.currentRunPromise) {
      return this.currentRunPromise;
    }

    this.currentRunPromise = this.runGeneration(config).finally(() => {
      this.currentRunPromise = null;
    });
    return this.currentRunPromise;
  }

  async runGeneration(config) {
    const request = this.buildRequest(config);
    if (!this.validateRequest(request)) {
      return null;
    }

    if (this.shouldPreviewBeforeSave(config)) {
      return this.runPreviewGeneration(request);
    }

    return this.runImmediateGeneration(request);
  }

  async runImmediateGeneration(request) {
    this.clearPollTimer();
    this.clearPreviewState();
    this.isProcessing = true;
    this.status = null;
    this.progressValue = 10;
    this.dispatchDocgenEvent('docgenstart', request);

    try {
      const result = await generateCompositeWithAttachments({
        compositeDocId: request.compositeDocumentId,
        recordIds: JSON.stringify(request.recordIds),
        outputFormat: request.outputFormat,
        readOnlyWord: request.readOnlyWord,
        additionalPdfContentVersionIds: request.additionalPdfContentVersionIds
      });

      if (!result?.success) {
        throw new Error(result?.errorMessage || 'Composite document generation failed');
      }
      const downloadUrl = result.downloadUrl;

      this.progressValue = 100;
      if (this.openOnSuccess && downloadUrl) {
        window.open(downloadUrl, '_blank');
      }
      this.showCompletionToast(result, 'Success', this.successMessage);
      this.dispatchDocgenEvent('docgensuccess', {
        ...request,
        downloadUrl
      });

      return downloadUrl;
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.handleError(errorMessage);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  async runPreviewGeneration(request) {
    this.clearPollTimer();
    this.isProcessing = true;
    this.progressValue = 10;
    this.status = null;
    this.generatedDocumentId = null;
    this.clearPreviewState();
    this.pollStartTime = Date.now();

    try {
      const startResult = await startCompositeGeneration({
        compositeDocumentId: request.compositeDocumentId,
        recordIds: JSON.stringify(request.recordIds),
        outputFormat: request.outputFormat,
        previewMode: true,
        readOnlyWord: request.readOnlyWord,
        additionalPdfContentVersionIds: request.additionalPdfContentVersionIds
      });

      this.applyStatus(startResult);
      this.generatedDocumentId = startResult.generatedDocumentId;
      this.dispatchDocgenEvent('docgenstart', startResult);

      if (startResult.isTerminal) {
        return this.finish(startResult);
      }

      // Nudge the worker so it picks this up now rather than on its next
      // scheduled tick. Fire and forget - never awaited, never surfaced.
      wakePoller().catch(() => {});

      return this.waitForTerminalStatus();
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.handleError(errorMessage);
      return null;
    }
  }

  waitForTerminalStatus() {
    return new Promise((resolve) => {
      const poll = async () => {
        if (!this.generatedDocumentId) {
          this.handleError('Generated Document ID was not returned.');
          resolve(null);
          return;
        }

        if (this.hasTimedOut()) {
          this.handleError(
            'Document generation is still running. Open Generated Documents to check the latest status.'
          );
          resolve(null);
          return;
        }

        try {
          const statusResult = await getGenerationStatus({
            generatedDocumentId: this.generatedDocumentId
          });

          this.applyStatus(statusResult);
          this.dispatchDocgenEvent('docgenprogress', statusResult);

          if (statusResult.isTerminal) {
            resolve(this.finish(statusResult));
          } else {
            this.pollTimer = window.setTimeout(poll, this.effectivePollIntervalMs());
          }
        } catch (error) {
          const errorMessage = this.extractErrorMessage(error);
          this.handleError(errorMessage);
          resolve(null);
        }
      };

      poll();
    });
  }

  finish(statusResult) {
    this.clearPollTimer();
    this.applyStatus(statusResult);
    this.isProcessing = false;

    if (statusResult.status === 'SUCCEEDED') {
      if (statusResult.isPreviewPending) {
        this.setPreviewState(statusResult);
        this.showToast(
          'Review Document',
          'Review the generated document, then save or cancel it.',
          'info'
        );
        this.dispatchDocgenEvent('docgenpreview', statusResult);
        return statusResult;
      }

      if (this.openOnSuccess && statusResult.downloadUrl) {
        window.open(statusResult.downloadUrl, '_blank');
      }
      this.showCompletionToast(statusResult, 'Success', this.successMessage);
      this.dispatchDocgenEvent('docgensuccess', statusResult);
    } else {
      const errorMessage =
        statusResult.errorMessage || `Document generation ${statusResult.status.toLowerCase()}.`;
      this.showToast('Error Generating Document', errorMessage, 'error');
      this.dispatchDocgenEvent('docgenerror', {
        ...statusResult,
        errorMessage
      });
    }

    return statusResult;
  }

  applyStatus(result) {
    this.status = result?.status || null;
    this.progressValue = result?.progressValue || 10;
    this.generatedDocumentId = result?.generatedDocumentId || this.generatedDocumentId;
  }

  async handleSavePreview() {
    if (!this.generatedDocumentId || this.disablePreviewActions) {
      return;
    }

    this.isSavingPreview = true;
    try {
      const result = await saveGeneratedDocument({
        generatedDocumentId: this.generatedDocumentId
      });
      this.applyStatus(result);
      this.setSavedDownloadState(result);
      this.showCompletionToast(result, 'Saved', this.successMessage);
      this.dispatchDocgenEvent('docgensave', result);
      this.dispatchDocgenEvent('docgensuccess', result);
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.showToast('Error Saving Document', errorMessage, 'error');
      this.dispatchDocgenEvent('docgenerror', {
        generatedDocumentId: this.generatedDocumentId,
        status: this.status,
        errorMessage
      });
    } finally {
      this.isSavingPreview = false;
    }
  }

  async handleCancelPreview() {
    if (!this.generatedDocumentId || this.disablePreviewActions) {
      return;
    }

    const canceledDocumentId = this.generatedDocumentId;
    this.isCancelingPreview = true;
    try {
      await cancelGeneratedDocument({
        generatedDocumentId: canceledDocumentId
      });
      this.clearPreviewState();
      this.generatedDocumentId = null;
      this.status = 'CANCELED';
      this.progressValue = 100;
      this.showToast('Canceled', 'Generated document was discarded.', 'info');
      this.dispatchDocgenEvent('docgencancel', {
        generatedDocumentId: canceledDocumentId,
        status: 'CANCELED'
      });
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.showToast('Error Canceling Document', errorMessage, 'error');
      this.dispatchDocgenEvent('docgenerror', {
        generatedDocumentId: canceledDocumentId,
        status: this.status,
        errorMessage
      });
    } finally {
      this.isCancelingPreview = false;
    }
  }

  handleDownloadSavedFile() {
    if (this.experienceSitePrefix !== null && this.savedContentDocumentId) {
      const downloadPath = `${this.experienceSitePrefix}/sfc/servlet.shepherd/document/download/${this.savedContentDocumentId}?operationContext=S1`;
      window.open(new URL(downloadPath, window.location.origin).href, '_blank');
      return;
    }

    if (this.savedDownloadUrl) {
      const downloadUrl = new URL(this.savedDownloadUrl, window.location.origin).href;
      window.open(downloadUrl, '_blank');
    }
  }

  handlePreviewThumbnail(event) {
    const imageUrl = event.detail?.imageUrl;
    if (
      this.isPreviewPending &&
      typeof imageUrl === 'string' &&
      imageUrl.startsWith('data:image/jpeg;base64,')
    ) {
      this.previewThumbnailUrl = imageUrl;
    }
  }

  async handleOpenSavedPreview() {
    const contentDocumentPageReference = this.savedContentDocumentPageReference;
    if (!contentDocumentPageReference) {
      return;
    }

    let generatedUrl = null;
    try {
      generatedUrl = await this[NavigationMixin.GenerateUrl](contentDocumentPageReference);
    } catch {
      generatedUrl = null;
    }

    if (generatedUrl && !generatedUrl.includes('/lightning/r/ContentDocument/')) {
      window.open(generatedUrl, '_blank');
      return;
    }

    this[NavigationMixin.Navigate]({
      type: 'standard__namedPage',
      attributes: {
        pageName: 'filePreview'
      },
      state: {
        recordIds: this.savedContentDocumentId,
        selectedRecordId: this.savedContentDocumentId
      }
    });
  }

  buildRequest(config) {
    const outputFormat = config.outputFormat || this.outputFormat;
    return {
      compositeDocumentId: config.compositeDocumentId || this.compositeDocumentId || null,
      recordIds: this.buildRecordIdsMap(config),
      outputFormat: outputFormat ? outputFormat.toUpperCase() : null,
      additionalPdfContentVersionIds: this.normalizeContentVersionIds(
        config.additionalPdfContentVersionIds !== undefined
          ? config.additionalPdfContentVersionIds
          : this.additionalPdfContentVersionIds
      ),
      readOnlyWord: this.normalizeBoolean(
        config.readOnlyWord !== undefined ? config.readOnlyWord : this.readOnlyWord,
        false
      )
    };
  }

  handleAttachmentSelection(event) {
    this.additionalPdfContentVersionIds = event.detail.contentVersionIds;
  }

  normalizeContentVersionIds(value) {
    if (!value) {
      return [];
    }
    let values = value;
    if (typeof value === 'string') {
      try {
        values = JSON.parse(value);
      } catch {
        values = [];
      }
    }
    return Array.isArray(values) ? [...new Set(values.filter(Boolean).map(String))] : [];
  }

  showCompletionToast(result, successTitle, successMessage) {
    const warnings = this.parseAttachmentWarnings(result?.attachmentWarnings);
    if (warnings.length) {
      this.showToast(
        'Generated with Attachment Warnings',
        `${warnings.length} additional PDF file${warnings.length === 1 ? ' was' : 's were'} skipped.`,
        'warning'
      );
      return;
    }
    this.showToast(successTitle, successMessage, 'success');
  }

  parseAttachmentWarnings(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  validateRequest(request) {
    if (!request.compositeDocumentId) {
      this.handleError('Composite Document ID is required. Please configure the component.', 'Configuration Error');
      return false;
    }

    if (Object.keys(request.recordIds).length === 0) {
      this.handleError(
        'At least one record ID is required. Please configure the component with a record ID field or additional record IDs.',
        'Configuration Error'
      );
      return false;
    }

    return true;
  }

  /**
   * Builds recordIds map from component properties.
   * Combines recordId (from page context) with additionalRecordIds (JSON).
   * @param {Object} config Runtime values that override component properties
   * @returns {Object} Map of record IDs (e.g., {"accountId": "001xxx", "contactId": "003xxx"})
   * @private
   */
  buildRecordIdsMap(config = {}) {
    const recordIdsMap = {};
    const recordId = config.recordId || this.recordId;
    const recordIdField = config.recordIdField || this.recordIdField;
    const additionalRecordIds =
      config.additionalRecordIds !== undefined ? config.additionalRecordIds : this.additionalRecordIds;

    if (recordId && recordIdField) {
      recordIdsMap[recordIdField] = recordId;
    }

    if (additionalRecordIds) {
      try {
        const additional =
          typeof additionalRecordIds === 'string' ? JSON.parse(additionalRecordIds) : additionalRecordIds;
        Object.assign(recordIdsMap, additional);
      } catch (e) {
        console.error('Invalid JSON in additionalRecordIds:', e);
      }
    }

    if (config.recordIds) {
      Object.assign(recordIdsMap, config.recordIds);
    }

    return recordIdsMap;
  }

  handleError(errorMessage, title = 'Error Generating Document') {
    this.clearPollTimer();
    this.isProcessing = false;
    this.progressValue = 100;
    this.status = 'FAILED';
    this.showToast(title, errorMessage, 'error');
    this.dispatchDocgenEvent('docgenerror', {
      generatedDocumentId: this.generatedDocumentId,
      status: this.status,
      progressValue: this.progressValue,
      errorMessage
    });
  }

  shouldPreviewBeforeSave(config) {
    if (Object.prototype.hasOwnProperty.call(config, 'previewBeforeSave')) {
      return this.normalizeBoolean(config.previewBeforeSave, false);
    }
    return this.previewBeforeSave;
  }

  normalizeBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() === 'true';
  }

  setPreviewState(statusResult) {
    this.isPreviewPending = statusResult.isPreviewPending === true;
    this.savedDownloadUrl = null;
    this.savedContentDocumentId = null;
    this.previewThumbnailUrl = null;
    this.outputFormatLabel = statusResult.outputFormat || this.outputFormat || null;
  }

  setSavedDownloadState(statusResult) {
    this.isPreviewPending = false;
    this.savedDownloadUrl = statusResult.downloadUrl || null;
    this.savedContentDocumentId = statusResult.contentDocumentId || null;
    this.outputFormatLabel = statusResult.outputFormat || this.outputFormat || null;
  }

  clearPreviewState() {
    this.isPreviewPending = false;
    this.savedDownloadUrl = null;
    this.savedContentDocumentId = null;
    this.previewThumbnailUrl = null;
    this.outputFormatLabel = null;
  }

  hasTimedOut() {
    const maxMs = Number(this.maxPollSeconds || DEFAULT_MAX_POLL_SECONDS) * 1000;
    return Date.now() - this.pollStartTime > maxMs;
  }

  effectivePollIntervalMs() {
    return Number(this.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  }

  clearPollTimer() {
    if (this.pollTimer) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  dispatchDocgenEvent(eventName, detail) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail,
        bubbles: true,
        composed: true
      })
    );
  }

  /**
   * Displays a toast notification.
   * @param {string} title - Toast title
   * @param {string} message - Toast message
   * @param {string} variant - Toast variant
   * @private
   */
  showToast(title, message, variant) {
    const event = new ShowToastEvent({
      title,
      message,
      variant
    });
    this.dispatchEvent(event);
  }

  /**
   * Extracts error message from various error formats.
   * @param {Object|Error} error - Error object from Apex or JavaScript
   * @returns {string} Human-readable error message
   * @private
   */
  extractErrorMessage(error) {
    if (error?.body?.message) {
      return error.body.message;
    }

    if (error?.message) {
      return error.message;
    }

    if (error?.body?.pageErrors && error.body.pageErrors.length > 0) {
      return error.body.pageErrors[0].message;
    }

    if (error?.body?.fieldErrors) {
      const fieldErrorMessages = [];
      Object.keys(error.body.fieldErrors).forEach((field) => {
        error.body.fieldErrors[field].forEach((fieldError) => {
          fieldErrorMessages.push(fieldError.message);
        });
      });
      if (fieldErrorMessages.length > 0) {
        return fieldErrorMessages.join(', ');
      }
    }

    return 'An unexpected error occurred. Please try again or contact your administrator.';
  }
}
