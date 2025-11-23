import { LightningElement, api, track } from 'lwc';
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

  /**
   * Tracks whether document generation is in progress
   * @type {boolean}
   * @private
   */
  @track isProcessing = false;

  /**
   * Handles button click event
   * Validates required properties, builds recordIds map, calls Apex, and handles response
   * @private
   */
  async handleGenerate() {
    // Validate required properties
    if (!this.compositeDocumentId) {
      this.showToast(
        'Configuration Error',
        'Composite Document ID is required. Please configure the component.',
        'error'
      );
      return;
    }

    // Build recordIds map
    const recordIdsMap = this.buildRecordIdsMap();

    // Validate at least one record ID exists
    if (Object.keys(recordIdsMap).length === 0) {
      this.showToast(
        'Configuration Error',
        'At least one record ID is required. Please configure the component with a record ID field or additional record IDs.',
        'error'
      );
      return;
    }

    if (!this.outputFormat) {
      this.showToast(
        'Configuration Error',
        'Output Format is required. Please configure the component.',
        'error'
      );
      return;
    }

    // Start processing
    this.isProcessing = true;

    try {
      // Call Apex method with recordIds as JSON string
      const downloadUrl = await generateComposite({
        compositeDocId: this.compositeDocumentId,
        recordIds: JSON.stringify(recordIdsMap),
        outputFormat: this.outputFormat
      });

      // Success: Open download URL in new tab
      window.open(downloadUrl, '_blank');

      // Show success toast
      this.showToast('Success', this.successMessage, 'success');

    } catch (error) {
      // Error: Extract and display error message
      const errorMessage = this.extractErrorMessage(error);
      this.showToast('Error Generating Document', errorMessage, 'error');
    } finally {
      // Always re-enable button
      this.isProcessing = false;
    }
  }

  /**
   * Builds recordIds map from component properties
   * Combines recordId (from page context) with additionalRecordIds (JSON)
   * @returns {Object} Map of record IDs (e.g., {"accountId": "001xxx", "contactId": "003xxx"})
   * @private
   */
  buildRecordIdsMap() {
    const recordIdsMap = {};

    // Add primary record ID from page context if provided
    if (this.recordId && this.recordIdField) {
      recordIdsMap[this.recordIdField] = this.recordId;
    }

    // Merge additional record IDs from JSON string
    if (this.additionalRecordIds) {
      try {
        const additional = JSON.parse(this.additionalRecordIds);
        Object.assign(recordIdsMap, additional);
      } catch (e) {
        // Invalid JSON - log error but continue with existing IDs
        console.error('Invalid JSON in additionalRecordIds:', e);
      }
    }

    return recordIdsMap;
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
}
