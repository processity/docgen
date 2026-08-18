import { createElement } from 'lwc';
import DocgenTemplateFileManager from 'c/docgenTemplateFileManager';
import getTemplateFiles from '@salesforce/apex/DocgenTemplateFileController.getTemplateFiles';
import getRecordMetadata from '@salesforce/apex/DocgenTemplateFileController.getRecordMetadata';
import updateTemplateContentVersionId from '@salesforce/apex/DocgenTemplateFileController.updateTemplateContentVersionId';
import { deleteRecord } from 'lightning/uiRecordApi';

jest.mock(
  '@salesforce/apex/DocgenTemplateFileController.getTemplateFiles',
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@salesforce/apex/DocgenTemplateFileController.getRecordMetadata',
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@salesforce/apex/DocgenTemplateFileController.updateTemplateContentVersionId',
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock('lightning/uiRecordApi', () => ({ deleteRecord: jest.fn() }), { virtual: true });

const RECORD_ID = 'aGS000000000001AAA';
const CURRENT_VERSION_ID = '068000000000002AAA';
const NEWEST_VERSION_ID = '068000000000003AAA';
const OLDEST_VERSION_ID = '068000000000001AAA';

const FILES = [
  {
    Id: OLDEST_VERSION_ID,
    Title: 'Old Template With A Very Long File Name',
    FileExtension: 'docx',
    VersionNumber: '1',
    ContentDocumentId: '069000000000001AAA',
    LastModifiedDate: '2026-06-23T15:16:09.000Z',
    IsLatest: true,
  },
  {
    Id: NEWEST_VERSION_ID,
    Title: 'Newest Template',
    FileExtension: 'docx',
    VersionNumber: '3',
    ContentDocumentId: '069000000000003AAA',
    LastModifiedDate: '2026-08-13T13:36:30.000Z',
    IsLatest: true,
  },
  {
    Id: CURRENT_VERSION_ID,
    Title: 'Current Template',
    FileExtension: 'docx',
    VersionNumber: '2',
    ContentDocumentId: '069000000000002AAA',
    LastModifiedDate: '2026-08-12T17:58:39.000Z',
    IsLatest: true,
  },
];

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const createComponent = async () => {
  const element = createElement('c-docgen-template-file-manager', {
    is: DocgenTemplateFileManager,
  });
  element.recordId = RECORD_ID;
  document.body.appendChild(element);
  await flushPromises();
  await flushPromises();
  return element;
};

describe('c-docgen-template-file-manager', () => {
  beforeEach(() => {
    getRecordMetadata.mockResolvedValue({
      objectType: 'Docgen_Template__c',
      templateContentVersionId: CURRENT_VERSION_ID,
    });
    getTemplateFiles.mockResolvedValue(FILES);
    updateTemplateContentVersionId.mockResolvedValue();
    deleteRecord.mockResolvedValue();
    window.open = jest.fn();
    global.confirm = jest.fn(() => true);
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('renders a datatable sorted by last modified date descending', async () => {
    const element = await createComponent();
    const datatable = element.shadowRoot.querySelector('lightning-datatable');

    expect(datatable).not.toBeNull();
    expect(element.shadowRoot.querySelector('table')).toBeNull();
    expect(datatable.sortedBy).toBe('LastModifiedDate');
    expect(datatable.sortedDirection).toBe('desc');
    expect(datatable.data.map((file) => file.Id)).toEqual([
      NEWEST_VERSION_ID,
      CURRENT_VERSION_ID,
      OLDEST_VERSION_ID,
    ]);
    expect(datatable.data[1].statusLabel).toBe('Current');
  });

  it('allows a deferred TBD source to be uploaded from the record page', async () => {
    getRecordMetadata.mockResolvedValue({
      objectType: 'Docgen_Template__c',
      templateContentVersionId: 'TBD',
    });
    getTemplateFiles.mockResolvedValue([]);

    const element = await createComponent();

    expect(element.shadowRoot.querySelector('lightning-file-upload')).not.toBeNull();
    expect(element.shadowRoot.querySelector('lightning-datatable')).toBeNull();
    expect(element.shadowRoot.textContent).toContain('No template files uploaded yet');
  });

  it('supports ascending date sorting from the datatable header', async () => {
    const element = await createComponent();
    const datatable = element.shadowRoot.querySelector('lightning-datatable');

    datatable.dispatchEvent(
      new CustomEvent('sort', {
        detail: { fieldName: 'LastModifiedDate', sortDirection: 'asc' },
      })
    );
    await flushPromises();

    expect(datatable.data.map((file) => file.Id)).toEqual([
      OLDEST_VERSION_ID,
      CURRENT_VERSION_ID,
      NEWEST_VERSION_ID,
    ]);
  });

  it('disables activate and delete actions for the current version', async () => {
    const element = await createComponent();
    const datatable = element.shadowRoot.querySelector('lightning-datatable');
    const actionColumn = datatable.columns.find((column) => column.type === 'action');
    const currentRow = datatable.data.find((file) => file.isCurrent);
    let actions;

    actionColumn.typeAttributes.rowActions(currentRow, (availableActions) => {
      actions = availableActions;
    });

    expect(actions.find((action) => action.name === 'use').disabled).toBe(true);
    expect(actions.find((action) => action.name === 'download').disabled).toBeUndefined();
    expect(actions.find((action) => action.name === 'delete').disabled).toBe(true);
  });

  it('activates the selected version from a row action', async () => {
    const element = await createComponent();
    const datatable = element.shadowRoot.querySelector('lightning-datatable');
    const selectedRow = datatable.data.find((file) => file.Id === NEWEST_VERSION_ID);

    datatable.dispatchEvent(
      new CustomEvent('rowaction', {
        detail: { action: { name: 'use' }, row: selectedRow },
      })
    );
    await flushPromises();
    await flushPromises();

    expect(updateTemplateContentVersionId).toHaveBeenCalledWith({
      recordId: RECORD_ID,
      contentVersionId: NEWEST_VERSION_ID,
    });
  });

  it('downloads and deletes files from row actions', async () => {
    const element = await createComponent();
    const datatable = element.shadowRoot.querySelector('lightning-datatable');
    const selectedRow = datatable.data.find((file) => file.Id === NEWEST_VERSION_ID);

    datatable.dispatchEvent(
      new CustomEvent('rowaction', {
        detail: { action: { name: 'download' }, row: selectedRow },
      })
    );
    expect(window.open).toHaveBeenCalledWith(selectedRow.downloadUrl, '_blank');

    datatable.dispatchEvent(
      new CustomEvent('rowaction', {
        detail: { action: { name: 'delete' }, row: selectedRow },
      })
    );
    await flushPromises();
    await flushPromises();

    expect(deleteRecord).toHaveBeenCalledWith(selectedRow.ContentDocumentId);
  });
});
