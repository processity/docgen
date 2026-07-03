import { createElement } from 'lwc';
import DocgenAdditionalPdfSelector from 'c/docgenAdditionalPdfSelector';
import getAttachmentContext from '@salesforce/apex/DocgenAttachmentService.getAttachmentContext';

jest.mock(
  '@salesforce/apex/DocgenAttachmentService.getAttachmentContext',
  () => {
    const { createApexTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const FILE_1 = {
  contentVersionId: '068000000000001AAA',
  title: 'Terms',
  contentSize: 1024,
  lastModifiedDate: '2026-07-01T10:00:00.000Z'
};
const FILE_2 = {
  contentVersionId: '068000000000002AAA',
  title: 'Appendix',
  contentSize: 2048,
  lastModifiedDate: '2026-07-02T10:00:00.000Z'
};

describe('c-docgen-additional-pdf-selector', () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('shows related PDFs and preserves selection order', async () => {
    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    element.recordId = '001000000000001AAA';
    element.outputFormat = 'PDF';
    document.body.appendChild(element);

    getAttachmentContext.emit({
      effectiveOutputFormat: 'PDF',
      files: [FILE_1, FILE_2]
    });
    await flushPromises();

    const changes = [];
    element.addEventListener('selectionchange', (event) => changes.push(event.detail));
    const checkboxes = element.shadowRoot.querySelectorAll('lightning-input');
    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new CustomEvent('change'));
    await flushPromises();
    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new CustomEvent('change'));
    await flushPromises();

    expect(changes.at(-1).contentVersionIds).toEqual([
      FILE_2.contentVersionId,
      FILE_1.contentVersionId
    ]);
    expect(element.getSelectedContentVersionIds()).toEqual([
      FILE_2.contentVersionId,
      FILE_1.contentVersionId
    ]);
    expect(element.shadowRoot.querySelectorAll('.selected-list__item')).toHaveLength(2);
  });

  it('does not render the selector for non-PDF output', async () => {
    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    element.recordId = '001000000000001AAA';
    element.outputFormat = 'DOCX';
    document.body.appendChild(element);

    getAttachmentContext.emit({ effectiveOutputFormat: 'DOCX', files: [] });
    await flushPromises();

    expect(element.shadowRoot.querySelector('.selector')).toBeNull();
  });

  it('deduplicates programmatically supplied IDs', async () => {
    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    document.body.appendChild(element);

    element.setSelectedContentVersionIds([
      FILE_1.contentVersionId,
      FILE_1.contentVersionId,
      FILE_2.contentVersionId
    ]);

    expect(element.getSelectedContentVersionIds()).toEqual([
      FILE_1.contentVersionId,
      FILE_2.contentVersionId
    ]);
  });

  it('rejects malformed programmatic JSON without throwing', () => {
    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    document.body.appendChild(element);
    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    expect(() => element.setSelectedContentVersionIds('{invalid')).not.toThrow();
    expect(element.getSelectedContentVersionIds()).toEqual([]);
    expect(toastHandler.mock.calls[0][0].detail).toEqual(expect.objectContaining({
      title: 'Invalid PDF Selection',
      variant: 'error'
    }));
  });
});
