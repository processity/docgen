import { createElement } from 'lwc';
import DocgenConfigurationNew from 'c/docgenConfigurationNew';
import createConfiguration from '@salesforce/apex/DocgenTemplateFileController.createConfiguration';
import getPrimaryParentOptions from '@salesforce/apex/DocgenTemplateFileController.getPrimaryParentOptions';
import getUploadedTemplateInfo from '@salesforce/apex/DocgenTemplateFileController.getUploadedTemplateInfo';
import { deleteRecord } from 'lightning/uiRecordApi';

const mockNavigate = jest.fn();

jest.mock(
  'lightning/navigation',
  () => {
    const navigate = Symbol('Navigate');
    const NavigationMixin = (Base) =>
      class extends Base {
        [navigate](pageReference) {
          return mockNavigate(pageReference);
        }
      };
    NavigationMixin.Navigate = navigate;
    return { NavigationMixin };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenTemplateFileController.createConfiguration',
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@salesforce/apex/DocgenTemplateFileController.getPrimaryParentOptions',
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@salesforce/apex/DocgenTemplateFileController.getUploadedTemplateInfo',
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock('lightning/uiRecordApi', () => ({ deleteRecord: jest.fn() }), { virtual: true });

const TEMPLATE_OBJECT = 'Docgen_Template__c';
const COMPOSITE_OBJECT = 'Composite_Document__c';
const CONTENT_DOCUMENT_ID = '069000000000001AAA';
const CREATED_RECORD_ID = 'aGS000000000001AAA';
const PRIMARY_PARENT_OPTIONS = [
  { label: 'Opportunity — Opportunity', value: 'Opportunity', displayOrder: 40 },
  { label: 'Account — Account', value: 'Account', displayOrder: 10 },
];

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const createComponent = async (objectApiName) => {
  const element = createElement('c-docgen-configuration-new', {
    is: DocgenConfigurationNew,
  });
  element.objectApiName = objectApiName;
  document.body.appendChild(element);
  await flushPromises();
  await flushPromises();
  return element;
};

const findInput = (element, fieldName) =>
  [...element.shadowRoot.querySelectorAll('lightning-input-field')].find(
    (input) => input.fieldName === fieldName || input.getAttribute('field-name') === fieldName
  );

const stageTemplateFile = async (element) => {
  getUploadedTemplateInfo.mockResolvedValue({
    contentDocumentId: CONTENT_DOCUMENT_ID,
    title: 'Offer Template',
    fileExtension: 'docx',
    contentSize: 2048,
  });
  const uploader = element.shadowRoot.querySelector('lightning-file-upload');
  uploader.dispatchEvent(
    new CustomEvent('uploadfinished', {
      detail: {
        files: [{ name: 'Offer Template.docx', documentId: CONTENT_DOCUMENT_ID }],
      },
    })
  );
  await flushPromises();
  await flushPromises();
};

describe('c-docgen-configuration-new', () => {
  beforeEach(() => {
    createConfiguration.mockResolvedValue(CREATED_RECORD_ID);
    getPrimaryParentOptions.mockResolvedValue(PRIMARY_PARENT_OPTIONS);
    deleteRecord.mockResolvedValue();
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('renders the guided template fields without exposing the internal version ID', async () => {
    const element = await createComponent(TEMPLATE_OBJECT);
    const text = element.shadowRoot.textContent;

    expect(element.shadowRoot.querySelector('h1').textContent).toBe('Create a Docgen Template');
    expect(element.shadowRoot.querySelector('lightning-file-upload')).not.toBeNull();
    [
      'Name',
      'DataSource__c',
      'ReturnMultipleRecords__c',
      'SOQL__c',
      'Default_Output_Format__c',
      'Locale_Field__c',
      'Output_File_Name_Field__c',
      'StoreMergedDocx__c',
      'Watermark_Text__c',
      'Watermark_Condition_Field__c',
      'Watermark_Style__c',
    ].forEach((fieldName) => expect(findInput(element, fieldName)).toBeDefined());
    ['ClassName__c', 'TemplateContentVersionId__c', 'OwnerId', 'ReturnDocxToBrowser__c'].forEach(
      (fieldName) => expect(findInput(element, fieldName)).toBeUndefined()
    );

    const primaryParent = element.shadowRoot.querySelector('lightning-combobox');
    expect(getPrimaryParentOptions).toHaveBeenCalledTimes(1);
    expect(primaryParent.options).toEqual([
      { label: '— No primary parent —', value: '' },
      { label: 'Account — Account', value: 'Account' },
      { label: 'Opportunity — Opportunity', value: 'Opportunity' },
    ]);
    expect(text).not.toContain('Administration');
    expect(text).toContain('TBD');
    expect(text).toContain('FOR item IN records');
    expect(text).toContain('Account.Document_Name__c');
  });

  it('explains concatenate composites and requests a file only for Own Template', async () => {
    const element = await createComponent(COMPOSITE_OBJECT);

    expect(element.shadowRoot.querySelector('lightning-file-upload')).toBeNull();
    expect(element.shadowRoot.textContent).toContain('No master file is needed');
    expect(element.shadowRoot.textContent).toContain('Quote.Conga_Offer_FileName__c');
    [
      'Description__c',
      'Template_Strategy__c',
      'Default_Output_Format__c',
      'Locale_Field__c',
      'Output_File_Name_Field__c',
      'StoreMergedDocx__c',
      'Watermark_Text__c',
      'Watermark_Condition_Field__c',
      'Watermark_Style__c',
    ].forEach((fieldName) => expect(findInput(element, fieldName)).toBeDefined());
    [
      'Name',
      'TemplateContentVersionId__c',
      'IsActive__c',
      'OwnerId',
      'ReturnDocxToBrowser__c',
    ].forEach((fieldName) => expect(findInput(element, fieldName)).toBeUndefined());
    expect(element.shadowRoot.textContent).not.toContain('Administration');

    const strategyInput = findInput(element, 'Template_Strategy__c');
    strategyInput.dispatchEvent(new CustomEvent('change', { detail: { value: 'Own Template' } }));
    await flushPromises();

    expect(element.shadowRoot.querySelector('lightning-file-upload')).not.toBeNull();
    expect(element.shadowRoot.textContent).not.toContain('No master file is needed');
  });

  it('shows the custom provider field only for the Custom data source', async () => {
    const element = await createComponent(TEMPLATE_OBJECT);
    const dataSourceInput = findInput(element, 'DataSource__c');

    dataSourceInput.dispatchEvent(new CustomEvent('change', { detail: { value: 'Custom' } }));
    await flushPromises();

    expect(findInput(element, 'ClassName__c')).toBeDefined();
    expect(findInput(element, 'SOQL__c')).toBeUndefined();
    expect(findInput(element, 'ReturnMultipleRecords__c')).toBeUndefined();
  });

  it('stages the upload and creates the configuration with the ContentDocument ID', async () => {
    const element = await createComponent(TEMPLATE_OBJECT);
    await stageTemplateFile(element);

    expect(getUploadedTemplateInfo).toHaveBeenCalledWith({
      contentDocumentId: CONTENT_DOCUMENT_ID,
    });
    expect(element.shadowRoot.textContent).toContain('Offer Template.docx');
    expect(element.shadowRoot.textContent).toContain('DOCX · 2 KB · Ready');

    const fields = {
      Name: 'Offer Template',
      DataSource__c: 'SOQL',
      SOQL__c: 'SELECT Id FROM Account WHERE Id = :recordId',
    };
    const form = element.shadowRoot.querySelector('lightning-record-edit-form');
    form.dispatchEvent(
      new CustomEvent('submit', {
        cancelable: true,
        detail: { fields },
      })
    );
    await flushPromises();
    await flushPromises();

    expect(createConfiguration).toHaveBeenCalledWith({
      objectApiName: TEMPLATE_OBJECT,
      fieldValues: fields,
      contentDocumentId: CONTENT_DOCUMENT_ID,
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      type: 'standard__recordPage',
      attributes: {
        recordId: CREATED_RECORD_ID,
        objectApiName: TEMPLATE_OBJECT,
        actionName: 'view',
      },
    });
  });

  it('creates a template with a deferred source and a metadata-backed primary parent', async () => {
    const element = await createComponent(TEMPLATE_OBJECT);
    const form = element.shadowRoot.querySelector('lightning-record-edit-form');
    const primaryParent = element.shadowRoot.querySelector('lightning-combobox');
    const fields = {
      Name: 'Deferred Upload',
      DataSource__c: 'SOQL',
      SOQL__c: 'SELECT Id FROM Account WHERE Id = :recordId',
    };

    primaryParent.dispatchEvent(new CustomEvent('change', { detail: { value: 'Account' } }));

    form.dispatchEvent(
      new CustomEvent('submit', {
        cancelable: true,
        detail: { fields },
      })
    );
    await flushPromises();
    await flushPromises();

    expect(createConfiguration).toHaveBeenCalledWith({
      objectApiName: TEMPLATE_OBJECT,
      fieldValues: { ...fields, PrimaryParent__c: 'Account' },
      contentDocumentId: null,
    });
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('creates a concatenate composite without uploading a master file', async () => {
    const element = await createComponent(COMPOSITE_OBJECT);
    const fields = {
      Description__c: 'Customer proposal',
      Template_Strategy__c: 'Concatenate Templates',
    };
    const form = element.shadowRoot.querySelector('lightning-record-edit-form');

    form.dispatchEvent(
      new CustomEvent('submit', {
        cancelable: true,
        detail: { fields },
      })
    );
    await flushPromises();
    await flushPromises();

    expect(createConfiguration).toHaveBeenCalledWith({
      objectApiName: COMPOSITE_OBJECT,
      fieldValues: fields,
      contentDocumentId: null,
    });
  });

  it('deletes a private staged upload when the user cancels', async () => {
    const element = await createComponent(TEMPLATE_OBJECT);
    await stageTemplateFile(element);
    const cancelButton = [...element.shadowRoot.querySelectorAll('lightning-button')].find(
      (button) => button.label === 'Cancel'
    );

    cancelButton.click();
    await flushPromises();
    await flushPromises();

    expect(deleteRecord).toHaveBeenCalledWith(CONTENT_DOCUMENT_ID);
    expect(mockNavigate).toHaveBeenCalledWith({
      type: 'standard__objectPage',
      attributes: {
        objectApiName: TEMPLATE_OBJECT,
        actionName: 'list',
      },
      state: { filterName: 'Recent' },
    });
  });
});
