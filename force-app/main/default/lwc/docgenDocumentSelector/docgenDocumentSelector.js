import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import searchActiveCompositeDocuments from '@salesforce/apex/CompositeDocumentController.searchActiveCompositeDocuments';
import searchActiveTemplates from '@salesforce/apex/CompositeDocumentController.searchActiveTemplates';

const LOOKUP_SEARCH_LIMIT = 10;
const PRESET_SEARCH_LIMIT = 20;
const LOOKUP_SEARCH_DEBOUNCE_MS = 250;
const DOCGEN_SOURCE_OPTIONS = [
  { label: 'Template', value: 'template' },
  { label: 'Composite document', value: 'composite' }
];

/**
 * Selection UI for document generation. Lets the user pick a template or a
 * composite document configured for an object and generate it via the embedded
 * generator components.
 *
 * A parent component can preset the selection with docgen-type and docgen-name.
 * When a matching record is found the selection is locked and the user can only
 * generate that document.
 *
 * @component docgenDocumentSelector
 * @example
 * <c-docgen-document-selector
 *   record-id={recordId}
 *   object-api-name="SBQQ__Quote__c"
 *   object-label="Quote"
 *   record-id-field="quoteId"
 *   output-format="PDF"
 *   preview-before-save="true"
 *   docgen-type="template"
 *   docgen-name="Quote Template A">
 * </c-docgen-document-selector>
 */
export default class DocgenDocumentSelector extends LightningElement {
  /**
   * Record ID the document is generated for.
   * @type {string}
   */
  @api recordId;

  /**
   * API name of the object whose templates and composite documents are offered
   * (Docgen_Template__c / Composite_Document__c PrimaryParent__c). Automatically
   * provided by the Lightning runtime on record pages.
   * @type {string}
   */
  @api objectApiName;

  /**
   * Optional display label for the object used in lookup labels and messages
   * (e.g. "Quote"). Defaults to a label derived from objectApiName.
   * @type {string}
   */
  @api objectLabel;

  /**
   * Variable name for the record ID in composite generation (e.g. "quoteId").
   * Must match the record ID variable expected by the composite document.
   * @type {string}
   */
  @api recordIdField = 'recordId';

  /**
   * Output format passed to the generator components.
   * @type {string}
   */
  @api outputFormat = 'PDF';

  /**
   * Optional preset document type: 'template' or 'composite'.
   * When set together with docgenName and a matching record is found,
   * the selection is locked and the user can only generate that document.
   */
  @api docgenType;

  /**
   * Optional preset document name. For composite documents this can be the
   * Composite Document Number (CD-xxxxx) or the exact description.
   */
  @api docgenName;

  /**
   * Optional preset additional PDF ContentVersion IDs (array or JSON array
   * string) attached to the generated PDF. Typically combined with
   * hideFilePicker so the user cannot change the preset attachments.
   */
  @api additionalPdfContentVersionIds = [];

  @api
  get previewBeforeSave() {
    return this._previewBeforeSave;
  }

  set previewBeforeSave(value) {
    this._previewBeforeSave = value === true || String(value).toLowerCase() === 'true';
  }

  /**
   * Hide the additional PDF file picker rendered by the generator components.
   */
  @api
  get hideFilePicker() {
    return this._hideFilePicker;
  }

  set hideFilePicker(value) {
    this._hideFilePicker = value === true || String(value).toLowerCase() === 'true';
  }

  _previewBeforeSave = false;
  _hideFilePicker = false;
  @track docgenSource = 'template';
  @track templateId;
  @track templateSearchTerm = '';
  @track templateSearchResults = [];
  @track templateSearchLoading = false;
  @track showTemplateSearchResults = false;
  @track templateSelectedName;
  @track compositeDocumentId;
  @track compositeSearchTerm = '';
  @track compositeSearchResults = [];
  @track compositeSearchLoading = false;
  @track showCompositeSearchResults = false;
  @track compositeSelectedName;
  @track isSelectionLocked = false;
  @track isResolvingPreset = false;
  @track isGeneratingDocgen = false;
  @track isPreviewPending = false;
  templateSearchTimeout;
  templateSearchSequence = 0;
  compositeSearchTimeout;
  compositeSearchSequence = 0;

  connectedCallback() {
    this.applyPresetSelection();
  }

  get docgenSourceOptions() {
    return DOCGEN_SOURCE_OPTIONS;
  }

  get effectiveObjectLabel() {
    if (this.objectLabel) {
      return this.objectLabel;
    }
    // Derive a readable fallback from the API name: SBQQ__Quote__c -> Quote
    const apiName = this.objectApiName || '';
    const withoutSuffix = apiName.replace(/__c$/i, '');
    const localName = withoutSuffix.includes('__')
      ? withoutSuffix.slice(withoutSuffix.indexOf('__') + 2)
      : withoutSuffix;
    return localName.replace(/_/g, ' ') || 'record';
  }

  get templateLookupLabel() {
    return `${this.effectiveObjectLabel} template`;
  }

  get templateSearchPlaceholder() {
    return `Search ${this.effectiveObjectLabel} templates...`;
  }

  get isTemplateSource() {
    return this.docgenSource === 'template';
  }

  get isCompositeSource() {
    return this.docgenSource === 'composite';
  }

  get isSelectionEditable() {
    return !this.isSelectionLocked;
  }

  get isDocumentConfigurationDisabled() {
    return this.isSelectionLocked || this.isGeneratingDocgen || this.isPreviewPending;
  }

  get canClearSelection() {
    return this.isSelectionEditable && !this.isGeneratingDocgen && !this.isPreviewPending;
  }

  get showDocgenProgress() {
    return this.isTemplateSource && !!this.templateId;
  }

  get showCompositeProgress() {
    return this.isCompositeSource && !!this.compositeDocumentId;
  }

  get docgenActionLabel() {
    return `Generate ${String(this.outputFormat || 'PDF').toUpperCase()}`;
  }

  get isGenerateDocgenDisabled() {
    const selectedDocument = this.isCompositeSource ? this.compositeDocumentId : this.templateId;
    return !selectedDocument || this.isGeneratingDocgen || this.isPreviewPending;
  }

  get hasTemplateSearchResults() {
    return this.templateSearchResults.length > 0;
  }

  get templateSearchStatusText() {
    return this.templateSearchTerm
      ? `No matching ${this.effectiveObjectLabel} templates.`
      : `No recent ${this.effectiveObjectLabel} templates.`;
  }

  get templateSelectedCaption() {
    if (!this.templateId) {
      return '';
    }

    return this.templateSelectedName || this.templateId;
  }

  get hasCompositeSearchResults() {
    return this.compositeSearchResults.length > 0;
  }

  get compositeSearchStatusText() {
    return this.compositeSearchTerm
      ? `No matching active ${this.effectiveObjectLabel} composite documents.`
      : `No recent active ${this.effectiveObjectLabel} composite documents.`;
  }

  get compositeSelectedCaption() {
    if (!this.compositeDocumentId) {
      return '';
    }

    return this.compositeSelectedName || this.compositeDocumentId;
  }

  /**
   * Resolves the optional docgenType/docgenName preset. When an exact match is
   * found, the selection is applied and locked so the user can only generate
   * that document. Otherwise the regular selection UI stays available.
   */
  async applyPresetSelection() {
    this.isSelectionLocked = false;

    const presetType = (this.docgenType || '').trim().toLowerCase();
    const presetName = (this.docgenName || '').trim();
    if (!presetName || (presetType !== 'template' && presetType !== 'composite')) {
      return;
    }

    this.isResolvingPreset = true;
    try {
      const searchApex =
        presetType === 'template' ? searchActiveTemplates : searchActiveCompositeDocuments;
      const results = await searchApex({
        objectApiName: this.objectApiName,
        searchTerm: presetName,
        limitSize: PRESET_SEARCH_LIMIT
      });

      const match = (results || []).find(
        (result) =>
          (result.name || '').toLowerCase() === presetName.toLowerCase() ||
          (result.description || '').toLowerCase() === presetName.toLowerCase()
      );
      if (!match) {
        return;
      }

      const normalizedMatch = this.normalizeLookupResults([match])[0];
      this.docgenSource = presetType;
      if (presetType === 'template') {
        this.templateId = normalizedMatch.id;
        this.templateSelectedName = normalizedMatch.name;
        this.templateSearchTerm = normalizedMatch.label;
        this.showTemplateSearchResults = false;
      } else {
        this.compositeDocumentId = normalizedMatch.id;
        this.compositeSelectedName = normalizedMatch.name;
        this.compositeSearchTerm = normalizedMatch.label;
        this.showCompositeSearchResults = false;
      }
      this.isSelectionLocked = true;
    } catch (error) {
      console.error('Could not resolve preset docgen document:', error);
    } finally {
      this.isResolvingPreset = false;
    }
  }

  handleTemplateSearchFocus() {
    if (!this.templateId) {
      this.showTemplateSearchResults = true;
      this.loadTemplateSearchResults(this.templateSearchTerm);
    }
  }

  handleTemplateSearchInput(event) {
    this.templateSearchTerm = event.target.value;
    this.templateId = null;
    this.templateSelectedName = null;
    this.showTemplateSearchResults = true;
    window.clearTimeout(this.templateSearchTimeout);
    this.templateSearchTimeout = window.setTimeout(() => {
      this.loadTemplateSearchResults(this.templateSearchTerm);
    }, LOOKUP_SEARCH_DEBOUNCE_MS);
  }

  handleTemplateResultSelect(event) {
    const selectedId = event.currentTarget.dataset.id;
    const selectedResult = this.templateSearchResults.find((result) => result.id === selectedId);
    if (!selectedResult) {
      return;
    }

    this.templateId = selectedResult.id;
    this.templateSelectedName = selectedResult.name;
    this.templateSearchTerm = selectedResult.label;
    this.showTemplateSearchResults = false;
  }

  clearTemplateSelection() {
    this.templateId = null;
    this.templateSelectedName = null;
    this.templateSearchTerm = '';
    this.showTemplateSearchResults = true;
    this.loadTemplateSearchResults('');
  }

  handleCompositeSearchFocus() {
    if (!this.compositeDocumentId) {
      this.showCompositeSearchResults = true;
      this.loadCompositeSearchResults(this.compositeSearchTerm);
    }
  }

  handleCompositeSearchInput(event) {
    this.compositeSearchTerm = event.target.value;
    this.compositeDocumentId = null;
    this.compositeSelectedName = null;
    this.showCompositeSearchResults = true;
    window.clearTimeout(this.compositeSearchTimeout);
    this.compositeSearchTimeout = window.setTimeout(() => {
      this.loadCompositeSearchResults(this.compositeSearchTerm);
    }, LOOKUP_SEARCH_DEBOUNCE_MS);
  }

  handleCompositeResultSelect(event) {
    const selectedId = event.currentTarget.dataset.id;
    const selectedResult = this.compositeSearchResults.find((result) => result.id === selectedId);
    if (!selectedResult) {
      return;
    }

    this.compositeDocumentId = selectedResult.id;
    this.compositeSelectedName = selectedResult.name;
    this.compositeSearchTerm = selectedResult.label;
    this.showCompositeSearchResults = false;
  }

  clearCompositeSelection() {
    this.compositeDocumentId = null;
    this.compositeSelectedName = null;
    this.compositeSearchTerm = '';
    this.showCompositeSearchResults = true;
    this.loadCompositeSearchResults('');
  }

  handleDocgenSourceChange(event) {
    this.docgenSource = event.detail.value;
    if (this.isTemplateSource) {
      this.showTemplateSearchResults = true;
      this.loadTemplateSearchResults(this.templateSearchTerm);
    } else if (this.isCompositeSource) {
      this.showCompositeSearchResults = true;
      this.loadCompositeSearchResults(this.compositeSearchTerm);
    }
  }

  async loadTemplateSearchResults(searchTerm) {
    const sequence = ++this.templateSearchSequence;
    this.templateSearchLoading = true;

    try {
      const results = await searchActiveTemplates({
        objectApiName: this.objectApiName,
        searchTerm: searchTerm || '',
        limitSize: LOOKUP_SEARCH_LIMIT
      });

      if (sequence !== this.templateSearchSequence) {
        return;
      }

      this.templateSearchResults = this.normalizeLookupResults(results);
    } catch (error) {
      if (sequence === this.templateSearchSequence) {
        this.templateSearchResults = [];
      }
      const errorMessage = error?.body?.message || 'Could not search templates.';
      this.showToast('Error', errorMessage, 'error');
      console.error(error);
    } finally {
      if (sequence === this.templateSearchSequence) {
        this.templateSearchLoading = false;
      }
    }
  }

  async loadCompositeSearchResults(searchTerm) {
    const sequence = ++this.compositeSearchSequence;
    this.compositeSearchLoading = true;

    try {
      const results = await searchActiveCompositeDocuments({
        objectApiName: this.objectApiName,
        searchTerm: searchTerm || '',
        limitSize: LOOKUP_SEARCH_LIMIT
      });

      if (sequence !== this.compositeSearchSequence) {
        return;
      }

      this.compositeSearchResults = this.normalizeLookupResults(results);
    } catch (error) {
      if (sequence === this.compositeSearchSequence) {
        this.compositeSearchResults = [];
      }
      const errorMessage = error?.body?.message || 'Could not search composite documents.';
      this.showToast('Error', errorMessage, 'error');
      console.error(error);
    } finally {
      if (sequence === this.compositeSearchSequence) {
        this.compositeSearchLoading = false;
      }
    }
  }

  normalizeLookupResults(results) {
    return (results || []).map((result) => ({
      ...result,
      description: result.description || '',
      label: result.label || result.name,
      subLabel: result.subLabel || ''
    }));
  }

  async generateWithDocgen() {
    this.isGeneratingDocgen = true;

    const generator = this.template.querySelector(
      this.isCompositeSource ? 'c-composite-docgen-button' : 'c-docgen-progress-button'
    );
    if (!generator) {
      this.isGeneratingDocgen = false;
      this.showToast('Error', 'DocGen is not available. Please contact your Salesforce admin team.', 'error');
      return;
    }

    try {
      if (this.isCompositeSource) {
        const recordIds = {};
        recordIds[this.recordIdField] = this.recordId;
        await generator.generate({
          compositeDocumentId: this.compositeDocumentId,
          recordIds,
          outputFormat: this.outputFormat,
          previewBeforeSave: this.previewBeforeSave
        });
      } else {
        await generator.generate({
          recordId: this.recordId,
          templateId: this.templateId,
          outputFormat: this.outputFormat,
          previewBeforeSave: this.previewBeforeSave
        });
      }
    } catch (error) {
      const errorMessage = error?.body?.message || error?.message || 'DocGen could not generate the PDF.';
      this.showToast('Error', errorMessage, 'error');
      console.error(error);
    } finally {
      this.isGeneratingDocgen = false;
    }
  }

  handlePreviewPending() {
    this.isPreviewPending = true;
  }

  handlePreviewResolved() {
    this.isPreviewPending = false;
  }

  showToast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
