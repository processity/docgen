import { createElement } from 'lwc';
import AddTemplateToComposite from 'c/addTemplateToComposite';
import getActiveTemplates from '@salesforce/apex/CompositeDocumentController.getActiveTemplates';
import addTemplateToComposite from '@salesforce/apex/CompositeDocumentController.addTemplateToComposite';

jest.mock(
  '@salesforce/apex/CompositeDocumentController.getActiveTemplates',
  () => {
    const { createApexTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    return {
      default: createApexTestWireAdapter(jest.fn())
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/CompositeDocumentController.addTemplateToComposite',
  () => ({ default: jest.fn() }),
  { virtual: true }
);

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('c-add-template-to-composite', () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('passes the optional inclusion formula when creating a junction', async () => {
    const element = createElement('c-add-template-to-composite', {
      is: AddTemplateToComposite
    });
    element.recordId = 'a0Y000000000001AAA';
    addTemplateToComposite.mockResolvedValue('a0Z000000000001AAA');
    document.body.appendChild(element);

    getActiveTemplates.emit([
      {
        Id: 'a0G000000000001AAA',
        Name: 'Quote Clauses',
        PrimaryParent__c: 'SBQQ__Quote__c',
        DataSource__c: 'SOQL'
      }
    ]);
    await flushPromises();

    const templateCombobox = element.shadowRoot.querySelector('lightning-combobox');
    templateCombobox.dispatchEvent(new CustomEvent('change', {
      detail: { value: 'a0G000000000001AAA' }
    }));

    const namespaceInput = [...element.shadowRoot.querySelectorAll('lightning-input')]
      .find(input => input.label === 'Namespace');
    namespaceInput.dispatchEvent(new CustomEvent('change', {
      detail: { value: 'Clauses' }
    }));

    const formulaInput = element.shadowRoot.querySelector('lightning-textarea');
    formulaInput.dispatchEvent(new CustomEvent('change', {
      detail: { value: 'CONTAINS(Additional_Templates__c, "ABC")' }
    }));
    await flushPromises();

    const addButton = [...element.shadowRoot.querySelectorAll('lightning-button')]
      .find(button => button.label === 'Add Template');
    addButton.click();
    await flushPromises();

    expect(addTemplateToComposite).toHaveBeenCalledWith({
      compositeDocId: 'a0Y000000000001AAA',
      templateId: 'a0G000000000001AAA',
      namespace: 'Clauses',
      sequence: 10,
      isActive: true,
      inclusionFormula: 'CONTAINS(Additional_Templates__c, "ABC")'
    });
  });
});
