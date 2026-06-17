import { createElement } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import DocgenTestPage from 'c/docgenTestPage';
import getSupportedObjects from '@salesforce/apex/DocgenTestPageController.getSupportedObjects';
import getObjectTypeFromRecordId from '@salesforce/apex/DocgenTestPageController.getObjectTypeFromRecordId';
import getGeneratedDocuments from '@salesforce/apex/DocgenTestPageController.getGeneratedDocuments';

jest.mock(
  '@salesforce/apex/DocgenTestPageController.getSupportedObjects',
  () => {
    const { createApexTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    return {
      default: createApexTestWireAdapter(jest.fn())
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenTestPageController.getObjectTypeFromRecordId',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenTestPageController.getGeneratedDocuments',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const SUPPORTED_OBJECTS = [
  {
    Label: 'Account',
    Object_API_Name__c: 'Account',
    Lookup_Field_API_Name__c: 'Account__c'
  }
];

function createTestPage() {
  const element = createElement('c-docgen-test-page', {
    is: DocgenTestPage
  });
  return element;
}

async function renderConfiguredPage(outputFormat) {
  getObjectTypeFromRecordId.mockResolvedValue('Account');
  getGeneratedDocuments.mockResolvedValue([]);

  const element = createTestPage();
  document.body.appendChild(element);

  getSupportedObjects.emit(SUPPORTED_OBJECTS);
  CurrentPageReference.emit({
    attributes: {
      apiName: 'Docgen_Test_Page'
    },
    state: {
      c__objectType: 'Account',
      c__recordId: '001000000000001AAA',
      c__templateId: 'a0G000000000001AAA',
      ...(outputFormat ? { c__outputFormat: outputFormat } : {})
    }
  });

  await flushPromises();
  await flushPromises();

  return element;
}

describe('c-docgen-test-page', () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('passes the selected output format override to the generation button', async () => {
    const element = await renderConfiguredPage();

    const outputFormatCombobox = [...element.shadowRoot.querySelectorAll('lightning-combobox')]
      .find((combobox) => combobox.label === 'Output Format');
    expect(outputFormatCombobox).not.toBeUndefined();
    expect(outputFormatCombobox.value).toBe('');
    expect(outputFormatCombobox.options).toEqual([
      { label: 'Template Default', value: '' },
      { label: 'PDF', value: 'PDF' },
      { label: 'DOCX', value: 'DOCX' },
      { label: 'PPTX', value: 'PPTX' }
    ]);

    outputFormatCombobox.dispatchEvent(new CustomEvent('change', {
      detail: {
        value: 'PPTX'
      }
    }));
    await flushPromises();

    const docgenButton = element.shadowRoot.querySelector('c-docgen-button');
    expect(docgenButton.outputFormat).toBe('PPTX');
  });

  it('restores PPT URL shorthand as PPTX', async () => {
    const element = await renderConfiguredPage('PPT');

    const outputFormatCombobox = [...element.shadowRoot.querySelectorAll('lightning-combobox')]
      .find((combobox) => combobox.label === 'Output Format');
    expect(outputFormatCombobox.value).toBe('PPTX');
  });
});
