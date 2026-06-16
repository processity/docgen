import { LightningElement, api } from 'lwc';
import startGeneration from '@salesforce/apex/DocgenAsyncController.startGeneration';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';
import saveGeneratedDocument from '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument';
import cancelGeneratedDocument from '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_SECONDS = 180;

export default class DocgenProgressButton extends LightningElement {
  @api templateId;
  @api templateName;
  @api outputFormat = 'PDF';
  @api recordId;
  @api buttonLabel = 'Generate Document';
  @api buttonVariant = 'brand';
  @api successMessage = 'Document generated successfully!';
  @api maxPollSeconds = DEFAULT_MAX_POLL_SECONDS;
  @api pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

  _openOnSuccess = true;
  _hideButton = false;
  _previewBeforeSave = false;
  isProcessing = false;
  isSavingPreview = false;
  isCancelingPreview = false;
  progressValue = 0;
  status = null;
  generatedDocumentId = null;
  previewUrl = null;
  downloadUrl = null;
  savedDownloadUrl = null;
  canInlinePreview = false;
  outputFormatLabel = null;
  pollTimer = null;
  currentRunPromise = null;
  pollStartTime = 0;

  get showProgressPanel() {
    return this.isProcessing || this.status;
  }

  get showButton() {
    return !this.hideButton;
  }

  get showPreviewPanel() {
    return this.status === 'SUCCEEDED' && this.previewUrl && this.generatedDocumentId;
  }

  get showSavedDownloadPanel() {
    return this.status === 'SUCCEEDED' && this.savedDownloadUrl && this.generatedDocumentId;
  }

  get showInlinePreview() {
    return this.showPreviewPanel && this.canInlinePreview;
  }

  get showPreviewFallback() {
    return this.showPreviewPanel && !this.canInlinePreview;
  }

  get disablePreviewActions() {
    return this.isSavingPreview || this.isCancelingPreview;
  }

  get fallbackMessage() {
    const format = this.outputFormatLabel || 'this file type';
    return `${format} files cannot be previewed inline in this panel.`;
  }

  @api
  get openOnSuccess() {
    return this._openOnSuccess;
  }

  set openOnSuccess(value) {
    this._openOnSuccess = this.normalizeBoolean(value, true);
  }

  @api
  get hideButton() {
    return this._hideButton;
  }

  set hideButton(value) {
    this._hideButton = this.normalizeBoolean(value, false);
  }

  @api
  get previewBeforeSave() {
    return this._previewBeforeSave;
  }

  set previewBeforeSave(value) {
    this._previewBeforeSave = this.normalizeBoolean(value, false);
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

  disconnectedCallback() {
    this.clearPollTimer();
  }

  async handleGenerateClick() {
    await this.generate();
  }

  @api
  async generate(config = {}) {
    if (this.isProcessing && this.currentRunPromise) {
      return this.currentRunPromise;
    }

    this.currentRunPromise = this.runGeneration(config);
    return this.currentRunPromise;
  }

  async runGeneration(config) {
    const request = this.buildRequest(config);
    if (!this.validateRequest(request)) {
      this.currentRunPromise = null;
      return null;
    }

    this.clearPollTimer();
    this.isProcessing = true;
    this.progressValue = 10;
    this.status = null;
    this.generatedDocumentId = null;
    this.clearPreviewState();
    this.pollStartTime = Date.now();

    try {
      const startResult = await startGeneration(request);
      this.applyStatus(startResult);
      this.generatedDocumentId = startResult.generatedDocumentId;
      this.dispatchDocgenEvent('docgenstart', startResult);

      if (startResult.isTerminal) {
        return this.finish(startResult);
      }

      return await this.waitForTerminalStatus();
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.handleError(errorMessage);
      return null;
    } finally {
      this.currentRunPromise = null;
    }
  }

  buildRequest(config) {
    const previewMode = this.shouldPreviewBeforeSave(config);
    const request = {
      templateId: config.templateId || this.templateId || null,
      templateName: config.templateName || this.templateName || null,
      recordId: config.recordId || this.recordId || null,
      outputFormat: (config.outputFormat || this.outputFormat || 'PDF').toUpperCase()
    };

    if (previewMode) {
      request.previewMode = true;
    }

    return request;
  }

  validateRequest(request) {
    if (!request.templateId && !request.templateName) {
      this.handleError('Template ID or Template Name is required.');
      return false;
    }

    if (!request.recordId) {
      this.handleError('Record ID is required.');
      return false;
    }

    if (!['PDF', 'DOCX', 'PPTX'].includes(request.outputFormat)) {
      this.handleError('Output Format must be PDF, DOCX, or PPTX.');
      return false;
    }

    return true;
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
          this.handleError('Document generation is still running. Open Generated Documents to check the latest status.');
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
        this.showToast('Review Document', 'Review the generated document, then save or cancel it.', 'info');
        this.dispatchDocgenEvent('docgenpreview', statusResult);
        return statusResult;
      }

      if (this.openOnSuccess && statusResult.downloadUrl) {
        window.open(statusResult.downloadUrl, '_blank');
      }
      this.showToast('Success', this.successMessage, 'success');
      this.dispatchDocgenEvent('docgensuccess', statusResult);
    } else {
      const errorMessage = statusResult.errorMessage || `Document generation ${statusResult.status.toLowerCase()}.`;
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
      const currentPreviewUrl = this.previewUrl;
      const currentDownloadUrl = this.downloadUrl;
      const result = await saveGeneratedDocument({
        generatedDocumentId: this.generatedDocumentId
      });
      this.applyStatus(result);
      this.setSavedDownloadState(result, currentPreviewUrl, currentDownloadUrl);
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
    if (this.downloadUrl) {
      window.open(this.downloadUrl, '_blank');
    }
  }

  handleDownloadSavedFile() {
    if (this.savedDownloadUrl) {
      window.open(this.savedDownloadUrl, '_blank');
    }
  }

  handleError(errorMessage) {
    this.clearPollTimer();
    this.isProcessing = false;
    this.progressValue = 100;
    this.status = 'FAILED';
    this.showToast('Error Generating Document', errorMessage, 'error');
    this.dispatchDocgenEvent('docgenerror', {
      generatedDocumentId: this.generatedDocumentId,
      status: this.status,
      progressValue: this.progressValue,
      errorMessage
    });
  }

  hasTimedOut() {
    const maxMs = Number(this.maxPollSeconds || DEFAULT_MAX_POLL_SECONDS) * 1000;
    return Date.now() - this.pollStartTime > maxMs;
  }

  effectivePollIntervalMs() {
    return Number(this.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
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

  shouldPreviewBeforeSave(config) {
    if (Object.prototype.hasOwnProperty.call(config, 'previewBeforeSave')) {
      return this.normalizeBoolean(config.previewBeforeSave, false);
    }
    return this.previewBeforeSave;
  }

  setPreviewState(statusResult) {
    this.previewUrl = statusResult.previewUrl || statusResult.downloadUrl || null;
    this.downloadUrl = statusResult.downloadUrl || this.previewUrl;
    this.savedDownloadUrl = null;
    this.canInlinePreview = Boolean(statusResult.canInlinePreview && statusResult.previewUrl);
    this.outputFormatLabel = statusResult.outputFormat || this.outputFormat || null;
  }

  setSavedDownloadState(statusResult, previousPreviewUrl, previousDownloadUrl) {
    this.savedDownloadUrl =
      statusResult.previewUrl || previousPreviewUrl || statusResult.downloadUrl || previousDownloadUrl || null;
    this.previewUrl = null;
    this.downloadUrl = statusResult.downloadUrl || previousDownloadUrl || null;
    this.canInlinePreview = false;
    this.outputFormatLabel = statusResult.outputFormat || this.outputFormat || null;
  }

  clearPreviewState() {
    this.previewUrl = null;
    this.downloadUrl = null;
    this.savedDownloadUrl = null;
    this.canInlinePreview = false;
    this.outputFormatLabel = null;
  }

  clearPollTimer() {
    if (this.pollTimer) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  showToast(title, message, variant) {
    this.dispatchEvent(
      new ShowToastEvent({
        title,
        message,
        variant
      })
    );
  }

  dispatchDocgenEvent(name, detail) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail,
        bubbles: true,
        composed: true
      })
    );
  }

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
