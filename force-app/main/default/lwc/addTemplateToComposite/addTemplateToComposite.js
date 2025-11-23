import { LightningElement, api, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import getActiveTemplates from '@salesforce/apex/CompositeDocumentController.getActiveTemplates';
import addTemplateToComposite from '@salesforce/apex/CompositeDocumentController.addTemplateToComposite';
import { refreshApex } from '@salesforce/apex';

/**
 * LWC component for adding Docgen Templates to Composite Documents
 * Creates junction records (Composite_Document_Template__c) with proper validation
 */
export default class AddTemplateToComposite extends NavigationMixin(LightningElement) {
  /**
   * Composite Document ID (automatically provided when on record page)
   * @type {string}
   */
  @api recordId;

  /**
   * Selected template ID
   * @type {string}
   */
  @track selectedTemplateId = '';

  /**
   * Namespace for the template
   * @type {string}
   */
  @track namespace = '';

  /**
   * Sequence number
   * @type {number}
   */
  @track sequence = 10;

  /**
   * Is active flag
   * @type {boolean}
   */
  @track isActive = true;

  /**
   * Loading state
   * @type {boolean}
   */
  @track isLoading = false;

  /**
   * Template options for combobox
   * @type {Array}
   */
  templateOptions = [];

  /**
   * Wired result for refresh
   */
  wiredTemplatesResult;

  /**
   * Wire adapter to load active Docgen Templates
   */
  @wire(getActiveTemplates)
  wiredTemplates(result) {
    this.wiredTemplatesResult = result;
    const { data, error } = result;

    if (data) {
      // Transform templates into combobox options
      this.templateOptions = data.map(template => ({
        label: template.Name,
        value: template.Id,
        description: `${template.PrimaryParent__c || 'Generic'} - ${template.DataSource__c}`
      }));
      this.isLoading = false;
    } else if (error) {
      this.handleError('Error loading templates', error);
      this.isLoading = false;
    }
  }

  /**
   * Handle template selection change
   */
  handleTemplateChange(event) {
    this.selectedTemplateId = event.detail.value;

    // Auto-suggest namespace based on template name
    if (this.selectedTemplateId && this.templateOptions.length > 0) {
      const selectedTemplate = this.templateOptions.find(
        opt => opt.value === this.selectedTemplateId
      );

      if (selectedTemplate && !this.namespace) {
        // Suggest namespace from template name (remove special chars, spaces)
        const suggestedNamespace = selectedTemplate.label
          .replace(/[^a-zA-Z0-9]/g, '_')
          .replace(/^[0-9]/, '_$&'); // Ensure starts with letter or underscore

        this.namespace = suggestedNamespace.substring(0, 80); // Field limit
      }
    }
  }

  /**
   * Handle namespace change
   */
  handleNamespaceChange(event) {
    this.namespace = event.detail.value;
  }

  /**
   * Handle sequence change
   */
  handleSequenceChange(event) {
    this.sequence = parseInt(event.detail.value, 10);
  }

  /**
   * Handle active checkbox change
   */
  handleActiveChange(event) {
    this.isActive = event.detail.checked;
  }

  /**
   * Validate form inputs
   * @returns {boolean} True if valid
   */
  validateInputs() {
    // Check required fields
    if (!this.selectedTemplateId) {
      this.showToast('Validation Error', 'Please select a template', 'error');
      return false;
    }

    if (!this.namespace || this.namespace.trim().length === 0) {
      this.showToast('Validation Error', 'Please enter a namespace', 'error');
      return false;
    }

    // Validate namespace pattern (must start with letter, alphanumeric + underscore)
    const namespacePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
    if (!namespacePattern.test(this.namespace)) {
      this.showToast(
        'Validation Error',
        'Namespace must start with a letter and contain only letters, numbers, and underscores',
        'error'
      );
      return false;
    }

    if (!this.sequence || this.sequence < 1) {
      this.showToast('Validation Error', 'Please enter a valid sequence (1 or greater)', 'error');
      return false;
    }

    if (!this.recordId) {
      this.showToast('Configuration Error', 'Composite Document ID is missing', 'error');
      return false;
    }

    return true;
  }

  /**
   * Handle Add Template button click
   */
  async handleAddTemplate() {
    // Validate inputs
    if (!this.validateInputs()) {
      return;
    }

    this.isLoading = true;

    try {
      // Call Apex method to create junction record
      const result = await addTemplateToComposite({
        compositeDocId: this.recordId,
        templateId: this.selectedTemplateId,
        namespace: this.namespace.trim(),
        sequence: this.sequence,
        isActive: this.isActive
      });

      // Success
      this.showToast(
        'Success',
        `Template added to composite document (Sequence: ${this.sequence})`,
        'success'
      );

      // Reset form
      this.resetForm();

      // Refresh the related list by dispatching a refresh event
      this.dispatchEvent(new CustomEvent('recordsaved'));

      // Optionally refresh templates list
      return refreshApex(this.wiredTemplatesResult);

    } catch (error) {
      this.handleError('Error adding template', error);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Handle Cancel button click
   */
  handleCancel() {
    // Navigate back to composite document record
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: {
        recordId: this.recordId,
        objectApiName: 'Composite_Document__c',
        actionName: 'view'
      }
    });
  }

  /**
   * Reset form to initial state
   */
  resetForm() {
    this.selectedTemplateId = '';
    this.namespace = '';
    this.sequence = this.sequence + 10; // Auto-increment for next template
    this.isActive = true;
  }

  /**
   * Check if Add button should be disabled
   * @returns {boolean}
   */
  get isAddDisabled() {
    return (
      this.isLoading ||
      !this.selectedTemplateId ||
      !this.namespace ||
      !this.sequence
    );
  }

  /**
   * Display toast notification
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
   * Handle errors from Apex or wire adapters
   */
  handleError(title, error) {
    let errorMessage = 'An unexpected error occurred';

    // Extract error message from various error formats
    if (error?.body?.message) {
      errorMessage = error.body.message;
    } else if (error?.message) {
      errorMessage = error.message;
    } else if (error?.body?.pageErrors && error.body.pageErrors.length > 0) {
      errorMessage = error.body.pageErrors[0].message;
    } else if (Array.isArray(error?.body?.fieldErrors)) {
      const fieldErrors = [];
      Object.keys(error.body.fieldErrors).forEach(field => {
        error.body.fieldErrors[field].forEach(fieldError => {
          fieldErrors.push(fieldError.message);
        });
      });
      if (fieldErrors.length > 0) {
        errorMessage = fieldErrors.join(', ');
      }
    }

    this.showToast(title, errorMessage, 'error');
    console.error(title, error);
  }
}
