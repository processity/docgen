import { LightningElement, api } from 'lwc';
import generateComposite from '@salesforce/apex/DocgenController.generateComposite';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

/**
 * LWC component for interactive composite document generation
 * Allows users to generate PDF/DOCX documents from multiple data sources
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
   * Output format (PDF or DOCX)
   * @type {string}
   * @required
   */
  @api outputFormat;

  /**
   * Current record ID (automatically provided by Lightning runtime)
   * @type {string}
   */
  @api recordId;

  /**
   * Variable name for the primary record ID (e.g., "accountId", "opportunityId")
   * Used as the key in the recordIds map
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

  _hideButton = false;
  isProcessing = false;
  currentRunPromise = null;

  get showButton() {
    return !this.hideButton;
  }

  @api
  get hideButton() {
    return this._hideButton;
  }

  set hideButton(value) {
    this._hideButton = this.normalizeBoolean(value, false);
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
   * @returns {Promise<string|null>} Generated document download URL, or null on failure
   */
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

    this.isProcessing = true;
    this.dispatchDocgenEvent('docgenstart', request);

    try {
      const downloadUrl = await generateComposite({
        compositeDocId: request.compositeDocumentId,
        recordIds: JSON.stringify(request.recordIds),
        outputFormat: request.outputFormat
      });

      window.open(downloadUrl, '_blank');
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
      this.currentRunPromise = null;
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

    if (!request.outputFormat) {
      this.handleError('Output Format is required. Please configure the component.', 'Configuration Error');
      return false;
    }

    return true;
  }

  /**
   * Builds recordIds map from component properties
   * Combines recordId (from page context) with additionalRecordIds (JSON)
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
    this.showToast(title, errorMessage, 'error');
    this.dispatchDocgenEvent('docgenerror', { errorMessage });
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
   * Displays a toast notification
   * @param {string} title - Toast title
   * @param {string} message - Toast message
   * @param {string} variant - Toast variant (success, error, warning, info)
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
   * Extracts error message from various error formats
   * @param {Object|Error} error - Error object from Apex or JavaScript
   * @returns {string} Human-readable error message
   * @private
   */
  extractErrorMessage(error) {
    // Handle AuraHandledException (Apex error)
    if (error?.body?.message) {
      return error.body.message;
    }

    // Handle standard JavaScript Error
    if (error?.message) {
      return error.message;
    }

    // Handle array of errors
    if (error?.body?.pageErrors && error.body.pageErrors.length > 0) {
      return error.body.pageErrors[0].message;
    }

    // Handle field errors
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

    // Default error message
    return 'An unexpected error occurred. Please try again or contact your administrator.';
  }

  normalizeBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return Boolean(value);
  }
}
