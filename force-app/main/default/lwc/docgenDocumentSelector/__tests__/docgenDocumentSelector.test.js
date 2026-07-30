import { createElement } from 'lwc';

const createGeneratorStub = () => {
  const { LightningElement, registerDecorators } = require('lwc');
  class GeneratorStub extends LightningElement {
    static generateMock = jest.fn(() => Promise.resolve(null));
    generate(config) {
      return GeneratorStub.generateMock(config);
    }
  }
  registerDecorators(GeneratorStub, {
    publicProps: {
      recordId: { config: 0 },
      recordIdField: { config: 0 },
      templateId: { config: 0 },
      compositeDocumentId: { config: 0 },
      outputFormat: { config: 0 },
      previewBeforeSave: { config: 0 },
      hideButton: { config: 0 },
      hideFilePicker: { config: 0 },
      additionalPdfContentVersionIds: { config: 0 }
    },
    publicMethods: ['generate']
  });
  return { __esModule: true, default: GeneratorStub };
};

jest.mock('c/docgenProgressButton', () => createGeneratorStub(), { virtual: true });
jest.mock('c/compositeDocgenButton', () => createGeneratorStub(), { virtual: true });

jest.mock(
  '@salesforce/apex/CompositeDocumentController.searchActiveCompositeDocuments',
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@salesforce/apex/CompositeDocumentController.searchActiveTemplates',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

import DocgenDocumentSelector from 'c/docgenDocumentSelector';
import DocgenProgressButtonStub from 'c/docgenProgressButton';
import CompositeDocgenButtonStub from 'c/compositeDocgenButton';
import searchActiveCompositeDocuments from '@salesforce/apex/CompositeDocumentController.searchActiveCompositeDocuments';
import searchActiveTemplates from '@salesforce/apex/CompositeDocumentController.searchActiveTemplates';

const QUOTE_ID = 'a0Qxx0000000001AAA';
const OBJECT_API_NAME = 'SBQQ__Quote__c';
const TEMPLATE_RESULT = {
  id: 'a0Txx0000000001AAA',
  name: 'Quote Template A',
  description: null,
  label: 'Quote Template A',
  subLabel: null
};
const COMPOSITE_RESULT = {
  id: 'a0Cxx0000000001AAA',
  name: 'CD-00042',
  description: 'Draft Offer Composite',
  label: 'Draft Offer Composite',
  subLabel: 'CD-00042'
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const createComponent = (props = {}) => {
  const element = createElement('c-docgen-document-selector', { is: DocgenDocumentSelector });
  element.recordId = QUOTE_ID;
  element.objectApiName = OBJECT_API_NAME;
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
};

const getRadioGroup = (element) => element.shadowRoot.querySelector('lightning-radio-group');
const getSearchInput = (element) => element.shadowRoot.querySelector('lightning-input');
const getSelectedRecord = (element) => element.shadowRoot.querySelector('.selected-docgen-record');
const getClearButton = (element) => element.shadowRoot.querySelector('lightning-button-icon');
const getGenerateButton = (element) => element.shadowRoot.querySelector('lightning-button');
const getResultButtons = (element) => [...element.shadowRoot.querySelectorAll('.docgen-result')];
const getCompositeHelp = (element) => element.shadowRoot.querySelector('.composite-help');

describe('c-docgen-document-selector', () => {
  beforeEach(() => {
    searchActiveTemplates.mockResolvedValue([TEMPLATE_RESULT]);
    searchActiveCompositeDocuments.mockResolvedValue([COMPOSITE_RESULT]);
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  describe('interactive selection', () => {
    it('renders an editable template source by default', async () => {
      const element = createComponent();
      await flushPromises();

      expect(searchActiveTemplates).not.toHaveBeenCalled();
      expect(getRadioGroup(element).disabled).toBeFalsy();
      expect(getRadioGroup(element).value).toBe('template');
      expect(getSearchInput(element)).not.toBeNull();
      expect(getSelectedRecord(element)).toBeNull();
      expect(getGenerateButton(element).disabled).toBe(true);
    });

    it('labels the template lookup with the provided object label', async () => {
      const element = createComponent({ objectLabel: 'Quote' });
      await flushPromises();

      expect(getSearchInput(element).label).toBe('Quote template');
      expect(getSearchInput(element).placeholder).toBe('Search Quote templates...');
    });

    it('derives the object label from the API name when no label is provided', async () => {
      const element = createComponent();
      await flushPromises();

      expect(getSearchInput(element).label).toBe('Quote template');
    });

    it('searches and selects a template on focus and click', async () => {
      const element = createComponent();
      await flushPromises();

      getSearchInput(element).dispatchEvent(new CustomEvent('focus'));
      await flushPromises();

      expect(searchActiveTemplates).toHaveBeenCalledWith({
        objectApiName: OBJECT_API_NAME,
        searchTerm: '',
        limitSize: 10
      });
      const results = getResultButtons(element);
      expect(results).toHaveLength(1);

      results[0].click();
      await flushPromises();

      expect(getSelectedRecord(element).textContent).toContain('Quote Template A');
      expect(getGenerateButton(element).label).toBe('Generate PDF');
      expect(getGenerateButton(element).disabled).toBe(false);
      expect(element.shadowRoot.querySelector('c-docgen-progress-button')).not.toBeNull();
    });

    it('switches to composite source and selects a composite document', async () => {
      const element = createComponent();
      await flushPromises();

      getRadioGroup(element).dispatchEvent(
        new CustomEvent('change', { detail: { value: 'composite' } })
      );
      await flushPromises();

      expect(searchActiveCompositeDocuments).toHaveBeenCalledWith({
        objectApiName: OBJECT_API_NAME,
        searchTerm: '',
        limitSize: 10
      });

      getResultButtons(element)[0].click();
      await flushPromises();

      expect(getSelectedRecord(element).textContent).toContain('Draft Offer Composite');
      const generateButton = getGenerateButton(element);
      expect(generateButton.label).toBe('Generate PDF');
      expect(generateButton.disabled).toBe(false);
      expect(getCompositeHelp(element)).not.toBeNull();
      expect(element.shadowRoot.querySelector('c-composite-docgen-button')).not.toBeNull();
    });

    it('uses the output format for the template action label', async () => {
      const element = createComponent({ outputFormat: 'docx' });
      await flushPromises();

      getSearchInput(element).dispatchEvent(new CustomEvent('focus'));
      await flushPromises();
      getResultButtons(element)[0].click();
      await flushPromises();

      expect(getGenerateButton(element).label).toBe('Generate DOCX');
    });

    it('clears a selected template back to search', async () => {
      const element = createComponent();
      await flushPromises();

      getSearchInput(element).dispatchEvent(new CustomEvent('focus'));
      await flushPromises();
      getResultButtons(element)[0].click();
      await flushPromises();

      getClearButton(element).click();
      await flushPromises();

      expect(getSelectedRecord(element)).toBeNull();
      expect(getGenerateButton(element).disabled).toBe(true);
    });

    it('generates through the template progress button with configured options', async () => {
      const element = createComponent({ previewBeforeSave: true, outputFormat: 'PDF' });
      await flushPromises();

      getSearchInput(element).dispatchEvent(new CustomEvent('focus'));
      await flushPromises();
      getResultButtons(element)[0].click();
      await flushPromises();

      getGenerateButton(element).click();
      await flushPromises();

      expect(DocgenProgressButtonStub.generateMock).toHaveBeenCalledWith({
        recordId: QUOTE_ID,
        templateId: TEMPLATE_RESULT.id,
        outputFormat: 'PDF',
        previewBeforeSave: true
      });
    });

    it('locks selection and generation until a template preview is saved or canceled', async () => {
      const element = createComponent({ previewBeforeSave: true });
      const previewHandler = jest.fn();
      element.addEventListener('docgenpreview', previewHandler);
      await flushPromises();

      getSearchInput(element).dispatchEvent(new CustomEvent('focus'));
      await flushPromises();
      getResultButtons(element)[0].click();
      await flushPromises();

      const generator = element.shadowRoot.querySelector('c-docgen-progress-button');
      generator.dispatchEvent(
        new CustomEvent('docgenpreview', { bubbles: true, composed: true })
      );
      await flushPromises();

      expect(getRadioGroup(element).disabled).toBe(true);
      expect(getSearchInput(element).disabled).toBe(true);
      expect(getClearButton(element)).toBeNull();
      expect(getGenerateButton(element).disabled).toBe(true);
      expect(previewHandler).toHaveBeenCalledTimes(1);

      generator.dispatchEvent(new CustomEvent('docgensave', { bubbles: true, composed: true }));
      await flushPromises();

      expect(getRadioGroup(element).disabled).toBeFalsy();
      expect(getSearchInput(element).disabled).toBeFalsy();
      expect(getClearButton(element)).not.toBeNull();
      expect(getGenerateButton(element).disabled).toBe(false);

      generator.dispatchEvent(
        new CustomEvent('docgenpreview', { bubbles: true, composed: true })
      );
      generator.dispatchEvent(
        new CustomEvent('docgencancel', { bubbles: true, composed: true })
      );
      await flushPromises();

      expect(getRadioGroup(element).disabled).toBeFalsy();
      expect(getGenerateButton(element).disabled).toBe(false);
    });

    it('forwards file picker control props to the embedded generator', async () => {
      const contentVersionIds = ['068000000000001AAA'];
      const element = createComponent({
        hideFilePicker: 'true',
        additionalPdfContentVersionIds: contentVersionIds
      });
      await flushPromises();

      getSearchInput(element).dispatchEvent(new CustomEvent('focus'));
      await flushPromises();
      getResultButtons(element)[0].click();
      await flushPromises();

      const generator = element.shadowRoot.querySelector('c-docgen-progress-button');
      expect(generator.hideFilePicker).toBe(true);
      expect(generator.additionalPdfContentVersionIds).toEqual(contentVersionIds);
    });

    it('generates through the composite button with the record id field key', async () => {
      const element = createComponent({ recordIdField: 'quoteId' });
      await flushPromises();

      getRadioGroup(element).dispatchEvent(
        new CustomEvent('change', { detail: { value: 'composite' } })
      );
      await flushPromises();
      getResultButtons(element)[0].click();
      await flushPromises();

      getGenerateButton(element).click();
      await flushPromises();

      expect(CompositeDocgenButtonStub.generateMock).toHaveBeenCalledWith({
        compositeDocumentId: COMPOSITE_RESULT.id,
        recordIds: { quoteId: QUOTE_ID },
        outputFormat: 'PDF',
        previewBeforeSave: false
      });
    });

    it('locks selection and generation while a composite preview is pending', async () => {
      const element = createComponent({ previewBeforeSave: true });
      await flushPromises();

      getRadioGroup(element).dispatchEvent(
        new CustomEvent('change', { detail: { value: 'composite' } })
      );
      await flushPromises();
      getResultButtons(element)[0].click();
      await flushPromises();

      const generator = element.shadowRoot.querySelector('c-composite-docgen-button');
      generator.dispatchEvent(
        new CustomEvent('docgenpreview', { bubbles: true, composed: true })
      );
      await flushPromises();

      expect(getRadioGroup(element).disabled).toBe(true);
      expect(getGenerateButton(element).disabled).toBe(true);

      generator.dispatchEvent(
        new CustomEvent('docgencancel', { bubbles: true, composed: true })
      );
      await flushPromises();

      expect(getRadioGroup(element).disabled).toBeFalsy();
      expect(getGenerateButton(element).disabled).toBe(false);
    });
  });

  describe('preset selection lock', () => {
    it('locks the selection when a preset template name matches', async () => {
      const element = createComponent({ docgenType: 'template', docgenName: 'Quote Template A' });
      await flushPromises();

      expect(searchActiveTemplates).toHaveBeenCalledWith({
        objectApiName: OBJECT_API_NAME,
        searchTerm: 'Quote Template A',
        limitSize: 20
      });
      expect(getRadioGroup(element)).toBeNull();
      expect(getSearchInput(element)).toBeNull();
      expect(getClearButton(element)).toBeNull();
      expect(getSelectedRecord(element).textContent).toContain('Quote Template A');
      expect(getGenerateButton(element).label).toBe('Generate PDF');
      expect(getGenerateButton(element).disabled).toBe(false);
      expect(element.shadowRoot.querySelector('c-docgen-progress-button')).not.toBeNull();
    });

    it('locks the selection when a preset composite document matches', async () => {
      const element = createComponent({ docgenType: 'composite', docgenName: 'CD-00042' });
      await flushPromises();

      expect(searchActiveCompositeDocuments).toHaveBeenCalledWith({
        objectApiName: OBJECT_API_NAME,
        searchTerm: 'CD-00042',
        limitSize: 20
      });
      expect(getRadioGroup(element)).toBeNull();
      expect(getSearchInput(element)).toBeNull();
      expect(getSelectedRecord(element).textContent).toContain('Draft Offer Composite');
      expect(getCompositeHelp(element)).toBeNull();
      expect(getGenerateButton(element).label).toBe('Generate PDF');
      expect(getGenerateButton(element).disabled).toBe(false);
      expect(element.shadowRoot.querySelector('c-composite-docgen-button')).not.toBeNull();
    });

    it('matches the preset name case-insensitively', async () => {
      const element = createComponent({ docgenType: 'template', docgenName: 'quote template a' });
      await flushPromises();

      expect(getRadioGroup(element)).toBeNull();
      expect(getSelectedRecord(element)).not.toBeNull();
    });

    it('matches a composite preset by description', async () => {
      const element = createComponent({
        docgenType: 'composite',
        docgenName: 'Draft Offer Composite'
      });
      await flushPromises();

      expect(getRadioGroup(element)).toBeNull();
      expect(getSelectedRecord(element)).not.toBeNull();
    });

    it('falls back to the editable UI when the preset name has no match', async () => {
      const element = createComponent({ docgenType: 'template', docgenName: 'Missing Template' });
      await flushPromises();

      expect(searchActiveTemplates).toHaveBeenCalled();
      expect(getRadioGroup(element).disabled).toBeFalsy();
      expect(getSearchInput(element)).not.toBeNull();
      expect(getSelectedRecord(element)).toBeNull();
      expect(getGenerateButton(element).disabled).toBe(true);
    });

    it('ignores a preset with an unknown type', async () => {
      const element = createComponent({ docgenType: 'other', docgenName: 'Quote Template A' });
      await flushPromises();

      expect(searchActiveTemplates).not.toHaveBeenCalled();
      expect(searchActiveCompositeDocuments).not.toHaveBeenCalled();
      expect(getRadioGroup(element).disabled).toBeFalsy();
      expect(getSearchInput(element)).not.toBeNull();
    });

    it('ignores a preset type without a name', async () => {
      const element = createComponent({ docgenType: 'template' });
      await flushPromises();

      expect(searchActiveTemplates).not.toHaveBeenCalled();
      expect(getRadioGroup(element).disabled).toBeFalsy();
    });

    it('keeps the UI editable when the preset lookup fails', async () => {
      searchActiveTemplates.mockRejectedValue({ body: { message: 'boom' } });
      const element = createComponent({ docgenType: 'template', docgenName: 'Quote Template A' });
      await flushPromises();

      expect(getRadioGroup(element).disabled).toBeFalsy();
      expect(getSearchInput(element)).not.toBeNull();
      expect(getSelectedRecord(element)).toBeNull();
    });
  });
});
