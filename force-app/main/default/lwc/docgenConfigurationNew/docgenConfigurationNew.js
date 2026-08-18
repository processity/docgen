import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { deleteRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import createConfiguration from '@salesforce/apex/DocgenTemplateFileController.createConfiguration';
import getPrimaryParentOptions from '@salesforce/apex/DocgenTemplateFileController.getPrimaryParentOptions';
import getUploadedTemplateInfo from '@salesforce/apex/DocgenTemplateFileController.getUploadedTemplateInfo';

const TEMPLATE_OBJECT = 'Docgen_Template__c';
const COMPOSITE_OBJECT = 'Composite_Document__c';
const SOQL_DATA_SOURCE = 'SOQL';
const OWN_TEMPLATE_STRATEGY = 'Own Template';
const CONCATENATE_STRATEGY = 'Concatenate Templates';
const ACCEPTED_TEMPLATE_FORMATS = ['.docx', '.pptx', '.xlsx'];
const NO_PRIMARY_PARENT_OPTION = { label: '— No primary parent —', value: '' };

export default class DocgenConfigurationNew extends NavigationMixin(LightningElement) {
  @api objectApiName;

  dataSource = SOQL_DATA_SOURCE;
  templateStrategy = CONCATENATE_STRATEGY;
  primaryParent;
  primaryParentOptions = [NO_PRIMARY_PARENT_OPTION];
  primaryParentError;
  isLoadingPrimaryParents = true;
  uploadedFile;
  isBusy = false;
  formError;

  connectedCallback() {
    this.loadPrimaryParentOptions();
  }

  get isTemplate() {
    return this.objectApiName === TEMPLATE_OBJECT;
  }

  get isComposite() {
    return this.objectApiName === COMPOSITE_OBJECT;
  }

  get isSupportedObject() {
    return this.isTemplate || this.isComposite;
  }

  get pageTitle() {
    return this.isTemplate ? 'Create a Docgen Template' : 'Create a Composite Document';
  }

  get pageDescription() {
    return this.isTemplate
      ? 'Configure the data contract now; the source file can be added now or later.'
      : 'Choose how templates are assembled and set the shared document defaults.';
  }

  get isSoqlDataSource() {
    return this.dataSource === SOQL_DATA_SOURCE;
  }

  get isCustomDataSource() {
    return this.dataSource === 'Custom';
  }

  get isOwnTemplateStrategy() {
    return this.templateStrategy === OWN_TEMPLATE_STRATEGY;
  }

  get isConcatenateStrategy() {
    return this.templateStrategy === CONCATENATE_STRATEGY;
  }

  get showsTemplateUpload() {
    return this.isTemplate || (this.isComposite && this.isOwnTemplateStrategy);
  }

  get primaryParentPlaceholder() {
    return this.isLoadingPrimaryParents ? 'Loading supported objects…' : 'Select an object';
  }

  get acceptedTemplateFormats() {
    return ACCEPTED_TEMPLATE_FORMATS;
  }

  get saveLabel() {
    return this.isTemplate ? 'Create Template' : 'Create Composite';
  }

  get uploadedFileName() {
    if (!this.uploadedFile) {
      return '';
    }
    return (
      this.uploadedFile.fileName || `${this.uploadedFile.title}.${this.uploadedFile.fileExtension}`
    );
  }

  get uploadedFileDetails() {
    if (!this.uploadedFile) {
      return '';
    }
    const extension = String(this.uploadedFile.fileExtension || '').toUpperCase();
    return `${extension} · ${this.formatBytes(this.uploadedFile.contentSize)}`;
  }

  get uploadedFileIcon() {
    const extension = String(this.uploadedFile?.fileExtension || '').toLowerCase();
    if (extension === 'pptx') {
      return 'doctype:ppt';
    }
    if (extension === 'xlsx') {
      return 'doctype:excel';
    }
    return 'doctype:word';
  }

  async loadPrimaryParentOptions() {
    try {
      const options = await getPrimaryParentOptions();
      const supportedOptions = (options || [])
        .map((option) => ({
          label: option.label,
          value: option.value,
          displayOrder: option.displayOrder ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort(
          (left, right) =>
            left.displayOrder - right.displayOrder || left.label.localeCompare(right.label)
        )
        .map(({ label, value }) => ({ label, value }));

      this.primaryParentOptions = [NO_PRIMARY_PARENT_OPTION, ...supportedOptions];
      if (!supportedOptions.length) {
        this.primaryParentError = 'No active Docgen Supported Objects are configured.';
      }
    } catch (error) {
      this.primaryParentError = this.errorMessage(error);
    } finally {
      this.isLoadingPrimaryParents = false;
    }
  }

  handlePrimaryParentChange(event) {
    this.primaryParent = event.detail.value || undefined;
    this.formError = undefined;
  }

  handleDataSourceChange(event) {
    this.dataSource = event.detail?.value || event.target.value;
    this.formError = undefined;
  }

  async handleStrategyChange(event) {
    this.templateStrategy = event.detail?.value || event.target.value;
    this.formError = undefined;

    if (this.isConcatenateStrategy && this.uploadedFile) {
      await this.removeStagedFile(false);
    }
  }

  async handleUploadFinished(event) {
    const uploadedFiles = event.detail.files;
    if (!uploadedFiles?.length) {
      return;
    }

    const upload = uploadedFiles[0];
    const previousDocumentId = this.uploadedFile?.contentDocumentId;
    this.isBusy = true;
    this.formError = undefined;

    try {
      const fileInfo = await getUploadedTemplateInfo({
        contentDocumentId: upload.documentId,
      });
      this.uploadedFile = {
        ...fileInfo,
        fileName: upload.name,
      };

      if (previousDocumentId && previousDocumentId !== fileInfo.contentDocumentId) {
        await this.deleteStagedDocument(previousDocumentId, true);
      }
    } catch (error) {
      await this.deleteStagedDocument(upload.documentId, false);
      this.formError = this.errorMessage(error);
      this.showToast('Template upload failed', this.formError, 'error');
    } finally {
      this.isBusy = false;
    }
  }

  async handleRemoveFile() {
    this.isBusy = true;
    await this.removeStagedFile(true);
    this.isBusy = false;
  }

  async handleSubmit(event) {
    event.preventDefault();
    this.formError = undefined;

    if (!this.validateVisibleFields()) {
      this.formError = 'Complete the highlighted fields before saving.';
      return;
    }
    this.isBusy = true;
    try {
      const fieldValues = { ...event.detail.fields };
      if (this.primaryParent) {
        fieldValues.PrimaryParent__c = this.primaryParent;
      }
      const hasSourceFile = Boolean(this.uploadedFile);
      const recordId = await createConfiguration({
        objectApiName: this.objectApiName,
        fieldValues,
        contentDocumentId: this.uploadedFile?.contentDocumentId || null,
      });

      this.uploadedFile = undefined;
      this.showToast(
        'Configuration created',
        hasSourceFile || (this.isComposite && this.isConcatenateStrategy)
          ? 'The configuration is ready.'
          : 'The configuration was created with a TBD source. Upload the file from its record page when ready.',
        'success'
      );
      this.navigateToRecord(recordId);
    } catch (error) {
      this.formError = this.errorMessage(error);
      this.showToast('Unable to create configuration', this.formError, 'error');
    } finally {
      this.isBusy = false;
    }
  }

  async handleCancel() {
    if (this.isBusy) {
      return;
    }

    this.isBusy = true;
    await this.removeStagedFile(false);
    this.navigateToList();
  }

  validateVisibleFields() {
    return [
      ...this.template.querySelectorAll('lightning-input-field, lightning-combobox[data-validate]'),
    ].reduce((isValid, input) => {
      const result = typeof input.reportValidity === 'function' ? input.reportValidity() : true;
      return isValid && result !== false;
    }, true);
  }

  async removeStagedFile(showSuccessToast) {
    const stagedFile = this.uploadedFile;
    const documentId = this.uploadedFile?.contentDocumentId;
    this.uploadedFile = undefined;
    this.formError = undefined;

    if (documentId) {
      const wasDeleted = await this.deleteStagedDocument(documentId, !showSuccessToast);
      if (showSuccessToast && wasDeleted) {
        this.showToast('Upload removed', 'The staged template file was deleted.', 'success');
      } else if (showSuccessToast) {
        this.uploadedFile = stagedFile;
        this.showToast(
          'Unable to remove upload',
          'The staged file is still available. Try removing it again.',
          'warning'
        );
      }
    }
  }

  async deleteStagedDocument(documentId, showWarning) {
    try {
      await deleteRecord(documentId);
      return true;
    } catch (error) {
      if (showWarning) {
        this.showToast(
          'Private upload retained',
          'The previous staged file could not be deleted. You can remove it from Files.',
          'warning'
        );
      }
      return false;
    }
  }

  navigateToRecord(recordId) {
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: {
        recordId,
        objectApiName: this.objectApiName,
        actionName: 'view',
      },
    });
  }

  navigateToList() {
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: {
        objectApiName: this.objectApiName,
        actionName: 'list',
      },
      state: {
        filterName: 'Recent',
      },
    });
  }

  formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return 'Size unavailable';
    }
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  errorMessage(error) {
    return error?.body?.message || error?.message || 'An unexpected error occurred.';
  }

  showToast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
