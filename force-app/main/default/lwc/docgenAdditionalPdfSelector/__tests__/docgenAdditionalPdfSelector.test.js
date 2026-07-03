import { createElement } from 'lwc';
import DocgenAdditionalPdfSelector from 'c/docgenAdditionalPdfSelector';
import getAttachmentContext from '@salesforce/apex/DocgenAttachmentService.getAttachmentContext';

jest.mock(
  '@salesforce/apex/DocgenAttachmentService.getAttachmentContext',
  () => ({ default: jest.fn() }),
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
  beforeEach(() => {
    getAttachmentContext.mockResolvedValue({
      effectiveOutputFormat: 'PDF',
      files: []
    });
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('renders immediately while explicit PDF context is loading', () => {
    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    element.recordId = '001000000000001AAA';
    element.outputFormat = 'PDF';
    document.body.appendChild(element);

    expect(element.shadowRoot.querySelector('.selector')).not.toBeNull();
  });

  it('shows related PDFs and preserves selection order', async () => {
    getAttachmentContext.mockResolvedValue({
      effectiveOutputFormat: 'PDF',
      files: [FILE_1, FILE_2]
    });
    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    element.recordId = '001000000000001AAA';
    element.outputFormat = 'PDF';
    document.body.appendChild(element);

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
    getAttachmentContext.mockResolvedValue({ effectiveOutputFormat: 'DOCX', files: [] });
    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    element.recordId = '001000000000001AAA';
    element.outputFormat = 'DOCX';
    document.body.appendChild(element);

    await flushPromises();

    expect(element.shadowRoot.querySelector('.selector')).toBeNull();
  });

  it('reloads related PDFs when a quick action supplies recordId after connection', async () => {
    getAttachmentContext
      .mockResolvedValueOnce({ effectiveOutputFormat: 'PDF', files: [] })
      .mockResolvedValueOnce({ effectiveOutputFormat: 'PDF', files: [FILE_1, FILE_2] });

    const element = createElement('c-docgen-additional-pdf-selector', {
      is: DocgenAdditionalPdfSelector
    });
    element.outputFormat = 'PDF';
    document.body.appendChild(element);
    await flushPromises();

    element.recordId = '001000000000001AAA';
    await flushPromises();

    expect(getAttachmentContext).toHaveBeenLastCalledWith(expect.objectContaining({
      recordId: '001000000000001AAA',
      requestedOutputFormat: 'PDF'
    }));
    expect(element.shadowRoot.querySelectorAll('lightning-input')).toHaveLength(2);
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
