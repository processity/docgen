import { LightningElement, api } from 'lwc';
import generateComposite from '@salesforce/apex/DocgenController.generateComposite';
import startCompositeGeneration from '@salesforce/apex/DocgenAsyncController.startCompositeGeneration';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';
import getPdfPreviewContent from '@salesforce/apex/DocgenAsyncController.getPdfPreviewContent';
import saveGeneratedDocument from '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument';
import cancelGeneratedDocument from '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_SECONDS = 180;
const PDF_INLINE_PREVIEW_FRAGMENT = '#view=FitH&zoom=page-width&pagemode=none';

/**
 * LWC component for interactive composite document generation
 * Allows users to generate PDF/DOCX/PPTX documents from multiple data sources.
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
export default class CompositeDocgenButton extends LightningElement {
  /**
   * Composite Document ID (Composite_Document__c record ID)
   * @type {string}
   * @required
   */
  @api compositeDocumentId;

  /**
   * Output format override (PDF, DOCX, or PPTX). Blank uses the composite default.
   * @type {string}
   */
  @api outputFormat;

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
  _openOnSuccess = true;
  _previewBeforeSave = false;
  isProcessing = false;
  isSavingPreview = false;
  isCancelingPreview = false;
  progressValue = 0;
  status = null;
  generatedDocumentId = null;
  previewUrl = null;
  fileRecordUrl = null;
  downloadUrl = null;
  savedDownloadUrl = null;
  previewObjectUrl = null;
  isLoadingInlinePreview = false;
  canInlinePreview = false;
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

  get showPreviewPanel() {
    return Boolean(
      this.status === 'SUCCEEDED' &&
        this.generatedDocumentId &&
        !this.savedDownloadUrl &&
        (this.previewUrl || this.fileRecordUrl || this.downloadUrl || this.isLoadingInlinePreview)
    );
  }

  get showSavedDownloadPanel() {
    return this.status === 'SUCCEEDED' && this.savedDownloadUrl && this.generatedDocumentId;
  }

  get showInlinePreview() {
    return this.showPreviewPanel && this.canInlinePreview && this.previewUrl;
  }

  get showPreviewLoading() {
    return this.showPreviewPanel && this.isLoadingInlinePreview;
  }

  get showPreviewFallback() {
    return this.showPreviewPanel && !this.canInlinePreview && !this.isLoadingInlinePreview;
  }

  get openPreviewUrl() {
    return this.fileRecordUrl || this.downloadUrl;
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
    const format = this.outputFormatLabel || 'this file type';
    return `${format} files cannot be previewed inline in this panel.`;
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
      const downloadUrl = await generateComposite({
        compositeDocId: request.compositeDocumentId,
        recordIds: JSON.stringify(request.recordIds),
        outputFormat: request.outputFormat
      });

      this.progressValue = 100;
      if (this.openOnSuccess && downloadUrl) {
        window.open(downloadUrl, '_blank');
      }
      this.showToast('Success', this.successMessage, 'success');
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
        previewMode: true
      });

      this.applyStatus(startResult);
      this.generatedDocumentId = startResult.generatedDocumentId;
      this.dispatchDocgenEvent('docgenstart', startResult);

      if (startResult.isTerminal) {
        return this.finish(startResult);
      }

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
      this.showToast('Success', this.successMessage, 'success');
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
      const currentDownloadUrl = this.downloadUrl;
      const result = await saveGeneratedDocument({
        generatedDocumentId: this.generatedDocumentId
      });
      this.applyStatus(result);
      this.setSavedDownloadState(result, currentDownloadUrl);
      this.showToast('Saved', this.successMessage, 'success');
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

  handleOpenPreview() {
    if (this.openPreviewUrl) {
      window.open(this.openPreviewUrl, '_blank');
    }
  }

  handleDownloadSavedFile() {
    if (this.savedDownloadUrl) {
      window.open(this.savedDownloadUrl, '_blank');
    }
  }

  buildRequest(config) {
    const outputFormat = config.outputFormat || this.outputFormat;
    return {
      compositeDocumentId: config.compositeDocumentId || this.compositeDocumentId || null,
      recordIds: this.buildRecordIdsMap(config),
      outputFormat: outputFormat ? outputFormat.toUpperCase() : null
    };
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
    this.revokePreviewObjectUrl();
    this.previewUrl = null;
    this.fileRecordUrl = statusResult.previewUrl || statusResult.downloadUrl || null;
    this.downloadUrl = statusResult.downloadUrl || this.fileRecordUrl;
    this.savedDownloadUrl = null;
    this.canInlinePreview = false;
    this.outputFormatLabel = statusResult.outputFormat || this.outputFormat || null;

    if (this.shouldLoadPdfInlinePreview(statusResult)) {
      this.loadPdfInlinePreview(this.generatedDocumentId);
    }
  }

  setSavedDownloadState(statusResult, previousDownloadUrl) {
    this.savedDownloadUrl = statusResult.downloadUrl || previousDownloadUrl || null;
    this.revokePreviewObjectUrl();
    this.previewUrl = null;
    this.fileRecordUrl = statusResult.previewUrl || null;
    this.downloadUrl = statusResult.downloadUrl || previousDownloadUrl || null;
    this.isLoadingInlinePreview = false;
    this.canInlinePreview = false;
    this.outputFormatLabel = statusResult.outputFormat || this.outputFormat || null;
  }

  clearPreviewState() {
    this.revokePreviewObjectUrl();
    this.previewUrl = null;
    this.fileRecordUrl = null;
    this.downloadUrl = null;
    this.savedDownloadUrl = null;
    this.isLoadingInlinePreview = false;
    this.canInlinePreview = false;
    this.outputFormatLabel = null;
  }

  shouldLoadPdfInlinePreview(statusResult) {
    return Boolean(
      statusResult?.isPreviewPending &&
        statusResult?.canInlinePreview &&
        (statusResult?.outputFormat || this.outputFormat || '').toUpperCase() === 'PDF' &&
        this.generatedDocumentId
    );
  }

  async loadPdfInlinePreview(generatedDocumentId) {
    this.isLoadingInlinePreview = true;

    try {
      const content = await getPdfPreviewContent({ generatedDocumentId });
      if (generatedDocumentId !== this.generatedDocumentId || this.status !== 'SUCCEEDED') {
        return;
      }

      const objectUrl = this.createPdfObjectUrl(content?.base64Data, content?.contentType);
      this.revokePreviewObjectUrl();
      this.previewObjectUrl = objectUrl;
      this.previewUrl = this.buildPdfPreviewUrl(objectUrl);
      this.canInlinePreview = true;
    } catch {
      this.canInlinePreview = false;
    } finally {
      if (generatedDocumentId === this.generatedDocumentId) {
        this.isLoadingInlinePreview = false;
      }
    }
  }

  createPdfObjectUrl(base64Data, contentType) {
    if (!base64Data) {
      throw new Error('PDF preview data was empty.');
    }
    if (!window.URL || !window.URL.createObjectURL) {
      throw new Error('Browser does not support inline PDF preview.');
    }

    const byteCharacters = window.atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i += 1) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: contentType || 'application/pdf' });
    return window.URL.createObjectURL(blob);
  }

  buildPdfPreviewUrl(objectUrl) {
    return `${objectUrl}${PDF_INLINE_PREVIEW_FRAGMENT}`;
  }

  revokePreviewObjectUrl() {
    if (this.previewObjectUrl) {
      window.URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
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
