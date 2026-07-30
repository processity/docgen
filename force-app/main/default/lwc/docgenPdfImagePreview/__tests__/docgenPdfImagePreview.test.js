import { createElement } from 'lwc';
import DocgenPdfImagePreview from 'c/docgenPdfImagePreview';
import getPdfPreviewPage from '@salesforce/apex/DocgenAsyncController.getPdfPreviewPage';

jest.mock(
  '@salesforce/apex/DocgenAsyncController.getPdfPreviewPage',
  () => {
    return {
      default: jest.fn(),
    };
  },
  { virtual: true }
);

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
const createDeferred = () => {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
};

const buildPage = (pageNumber, overrides = {}) => ({
  contentType: 'image/jpeg',
  base64Data: `cGFnZ${pageNumber}==`,
  pageNumber,
  pageCount: 3,
  previewPageCount: 3,
  previewTruncated: false,
  ...overrides,
});

const createComponent = (generatedDocumentId = 'aGT000000000001AAA') => {
  const element = createElement('c-docgen-pdf-image-preview', {
    is: DocgenPdfImagePreview,
  });
  if (generatedDocumentId) {
    element.generatedDocumentId = generatedDocumentId;
  }
  document.body.appendChild(element);
  return element;
};

const findButton = (element, label) =>
  [...element.shadowRoot.querySelectorAll('lightning-button')].find(
    (button) => button.label === label
  );

describe('c-docgen-pdf-image-preview', () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('waits for a generated document ID and then requests page 1', async () => {
    getPdfPreviewPage.mockResolvedValue(buildPage(1));
    const element = createComponent(null);

    expect(getPdfPreviewPage).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('section')).toBeNull();

    element.generatedDocumentId = 'aGT000000000002AAA';
    await flushPromises();

    expect(getPdfPreviewPage).toHaveBeenCalledWith({
      generatedDocumentId: 'aGT000000000002AAA',
      pageNumber: 1,
    });
    expect(element.shadowRoot.querySelector('img')).not.toBeNull();
  });

  it('does not reload when the generated document ID is unchanged', async () => {
    getPdfPreviewPage.mockResolvedValue(buildPage(1));
    const element = createComponent();
    await flushPromises();

    element.generatedDocumentId = 'aGT000000000001AAA';
    await flushPromises();

    expect(getPdfPreviewPage).toHaveBeenCalledTimes(1);
  });

  it('renders only a JPEG data image with accessible navigation', async () => {
    getPdfPreviewPage.mockResolvedValue(buildPage(1));
    const element = createComponent();
    await flushPromises();

    const section = element.shadowRoot.querySelector('section');
    const image = element.shadowRoot.querySelector('img');
    const status = element.shadowRoot.querySelector('.preview__page-status');
    const previous = findButton(element, 'Previous');
    const next = findButton(element, 'Next');

    expect(section.getAttribute('aria-label')).toBe('PDF document preview');
    expect(image.src).toBe('data:image/jpeg;base64,cGFnZ1==');
    expect(image.alt).toBe('PDF preview page 1 of 3');
    expect(status.textContent).toBe('Page 1 of 3');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(previous.title).toBe('Previous PDF page');
    expect(previous.disabled).toBe(true);
    expect(next.title).toBe('Next PDF page');
    expect(next.disabled).toBe(false);
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(element.shadowRoot.querySelector('object')).toBeNull();
    expect(element.shadowRoot.querySelector('embed')).toBeNull();
    expect(element.shadowRoot.querySelector('a')).toBeNull();
    expect(findButton(element, 'Save')).toBeUndefined();
    expect(findButton(element, 'Cancel')).toBeUndefined();
  });

  it('provides page 1 as a thumbnail without emitting later pages', async () => {
    getPdfPreviewPage.mockImplementation(({ pageNumber }) =>
      Promise.resolve(buildPage(pageNumber))
    );
    const element = createComponent();
    const thumbnailHandler = jest.fn();
    element.addEventListener('previewthumbnail', thumbnailHandler);
    await flushPromises();

    expect(thumbnailHandler).toHaveBeenCalledTimes(1);
    expect(thumbnailHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          imageUrl: 'data:image/jpeg;base64,cGFnZ1==',
          pageNumber: 1,
          pageCount: 3,
        },
      })
    );

    findButton(element, 'Next').click();
    await flushPromises();

    expect(thumbnailHandler).toHaveBeenCalledTimes(1);
  });

  it('navigates with correct first and last page boundaries', async () => {
    getPdfPreviewPage.mockImplementation(({ pageNumber }) =>
      Promise.resolve(
        buildPage(pageNumber, {
          pageCount: 2,
          previewPageCount: 2,
        })
      )
    );
    const element = createComponent();
    await flushPromises();

    findButton(element, 'Next').click();
    await flushPromises();

    expect(element.shadowRoot.querySelector('.preview__page-status').textContent).toBe(
      'Page 2 of 2'
    );
    expect(findButton(element, 'Previous').disabled).toBe(false);
    expect(findButton(element, 'Next').disabled).toBe(true);

    findButton(element, 'Previous').click();
    await flushPromises();

    expect(element.shadowRoot.querySelector('.preview__page-status').textContent).toBe(
      'Page 1 of 2'
    );
    expect(findButton(element, 'Previous').disabled).toBe(true);
    expect(getPdfPreviewPage.mock.calls).toEqual([
      [{ generatedDocumentId: 'aGT000000000001AAA', pageNumber: 1 }],
      [{ generatedDocumentId: 'aGT000000000001AAA', pageNumber: 2 }],
      [{ generatedDocumentId: 'aGT000000000001AAA', pageNumber: 1 }],
    ]);
  });

  it('shows a stable loading state with a useful page label', async () => {
    const deferred = createDeferred();
    getPdfPreviewPage.mockReturnValue(deferred.promise);
    const element = createComponent();
    await flushPromises();

    const frame = element.shadowRoot.querySelector('.preview__frame');
    const viewport = element.shadowRoot.querySelector('.preview__viewport');
    const loadingOverlay = element.shadowRoot.querySelector('.preview__loading');
    const spinner = element.shadowRoot.querySelector('lightning-spinner');
    expect(viewport.getAttribute('aria-busy')).toBe('true');
    expect(loadingOverlay.parentElement).toBe(frame);
    expect(viewport.contains(loadingOverlay)).toBe(false);
    expect(spinner.alternativeText).toBe('Loading PDF preview page 1');

    deferred.resolve(buildPage(1));
    await flushPromises();

    expect(element.shadowRoot.querySelector('lightning-spinner')).toBeNull();
    expect(viewport.getAttribute('aria-busy')).toBe('false');
  });

  it('shows the first-20-pages notice while reporting the full page count', async () => {
    getPdfPreviewPage.mockResolvedValue(
      buildPage(1, {
        pageCount: 27,
        previewPageCount: 20,
        previewTruncated: true,
      })
    );
    const element = createComponent();
    await flushPromises();

    expect(element.shadowRoot.querySelector('.preview__page-status').textContent).toBe(
      'Page 1 of 27'
    );
    expect(element.shadowRoot.querySelector('.preview__notice').textContent).toBe(
      'Preview is limited to the first 20 of 27 pages.'
    );
  });

  it('enforces the 20-page client boundary on inconsistent service metadata', async () => {
    getPdfPreviewPage.mockResolvedValue(
      buildPage(1, {
        pageCount: 30,
        previewPageCount: 30,
        previewTruncated: false,
      })
    );
    const element = createComponent();
    await flushPromises();

    expect(element.shadowRoot.querySelector('.preview__notice').textContent).toBe(
      'Preview is limited to the first 20 of 30 pages.'
    );
  });

  it('offers an actionable retry after a page error', async () => {
    getPdfPreviewPage
      .mockRejectedValueOnce({ body: { message: 'The page render timed out.' } })
      .mockResolvedValueOnce(buildPage(1));
    const element = createComponent();
    await flushPromises();

    const error = element.shadowRoot.querySelector('.preview__error');
    const retry = findButton(element, 'Retry page 1');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain(
      'Unable to load preview page 1. The page render timed out.'
    );
    expect(retry).not.toBeUndefined();
    expect(element.shadowRoot.querySelector('img')).toBeNull();

    retry.click();
    await flushPromises();

    expect(getPdfPreviewPage).toHaveBeenCalledTimes(2);
    expect(element.shadowRoot.querySelector('.preview__error')).toBeNull();
    expect(element.shadowRoot.querySelector('img')).not.toBeNull();
  });

  it('ignores stale page responses during rapid navigation', async () => {
    const pageTwo = createDeferred();
    const pageThree = createDeferred();
    getPdfPreviewPage.mockImplementation(({ pageNumber }) => {
      if (pageNumber === 2) {
        return pageTwo.promise;
      }
      if (pageNumber === 3) {
        return pageThree.promise;
      }
      return Promise.resolve(buildPage(1));
    });
    const element = createComponent();
    await flushPromises();

    findButton(element, 'Next').click();
    await flushPromises();
    findButton(element, 'Next').click();
    await flushPromises();

    pageThree.resolve(buildPage(3, { base64Data: 'cGFnZTM=' }));
    await flushPromises();
    expect(element.shadowRoot.querySelector('img').src).toBe('data:image/jpeg;base64,cGFnZTM=');
    expect(element.shadowRoot.querySelector('.preview__page-status').textContent).toBe(
      'Page 3 of 3'
    );

    pageTwo.resolve(buildPage(2, { base64Data: 'cGFnZTI=' }));
    await flushPromises();
    expect(element.shadowRoot.querySelector('img').src).toBe('data:image/jpeg;base64,cGFnZTM=');
    expect(element.shadowRoot.querySelector('.preview__page-status').textContent).toBe(
      'Page 3 of 3'
    );
  });

  it('ignores a stale response after the generated document changes', async () => {
    const firstDocument = createDeferred();
    getPdfPreviewPage.mockImplementation(({ generatedDocumentId }) => {
      if (generatedDocumentId === 'aGT000000000001AAA') {
        return firstDocument.promise;
      }
      return Promise.resolve(buildPage(1, { base64Data: 'bmV3RG9jdW1lbnQ=' }));
    });
    const element = createComponent();
    await flushPromises();

    element.generatedDocumentId = 'aGT000000000002AAA';
    await flushPromises();
    expect(element.shadowRoot.querySelector('img').src).toBe(
      'data:image/jpeg;base64,bmV3RG9jdW1lbnQ='
    );

    firstDocument.resolve(buildPage(1, { base64Data: 'b2xkRG9jdW1lbnQ=' }));
    await flushPromises();
    expect(element.shadowRoot.querySelector('img').src).toBe(
      'data:image/jpeg;base64,bmV3RG9jdW1lbnQ='
    );
  });

  it('rejects non-JPEG responses instead of rendering their content type', async () => {
    getPdfPreviewPage.mockResolvedValue(
      buildPage(1, {
        contentType: 'application/pdf',
        base64Data: 'JVBERi0xLjQ=',
      })
    );
    const element = createComponent();
    await flushPromises();

    expect(element.shadowRoot.querySelector('img')).toBeNull();
    expect(element.shadowRoot.querySelector('.preview__error').textContent).toContain(
      'The preview service returned an unsupported image format.'
    );
  });

  it.each([
    [
      'invalid image data',
      { base64Data: 'not valid base64!' },
      'The preview service returned invalid image data.',
    ],
    ['the wrong page', { pageNumber: 2 }, 'The preview service returned the wrong page.'],
    [
      'an invalid page count',
      { pageCount: 0 },
      'The preview service returned an invalid page count.',
    ],
    [
      'an invalid preview page count',
      { previewPageCount: 0 },
      'The preview service returned an invalid preview page count.',
    ],
  ])('shows Retry when the service returns %s', async (_label, overrides, message) => {
    getPdfPreviewPage.mockResolvedValue(buildPage(1, overrides));
    const element = createComponent();
    await flushPromises();

    expect(element.shadowRoot.querySelector('img')).toBeNull();
    expect(element.shadowRoot.querySelector('.preview__error').textContent).toContain(message);
    expect(findButton(element, 'Retry page 1')).not.toBeUndefined();
  });

  it('rejects a navigation response outside its reported preview range', async () => {
    getPdfPreviewPage.mockResolvedValueOnce(buildPage(1)).mockResolvedValueOnce(
      buildPage(2, {
        previewPageCount: 1,
      })
    );
    const element = createComponent();
    await flushPromises();

    findButton(element, 'Next').click();
    await flushPromises();

    expect(element.shadowRoot.querySelector('img').src).toBe('data:image/jpeg;base64,cGFnZ1==');
    expect(element.shadowRoot.querySelector('.preview__error').textContent).toContain(
      'The preview service returned a page outside the preview range.'
    );
    expect(findButton(element, 'Retry page 2')).not.toBeUndefined();
  });

  it('prevents the image context menu and dragging', async () => {
    getPdfPreviewPage.mockResolvedValue(buildPage(1));
    const element = createComponent();
    await flushPromises();

    const image = element.shadowRoot.querySelector('img');
    const contextMenuEvent = new Event('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    const dragStartEvent = new Event('dragstart', {
      bubbles: true,
      cancelable: true,
    });

    expect(image.draggable).toBe(false);
    expect(image.dispatchEvent(contextMenuEvent)).toBe(false);
    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(image.dispatchEvent(dragStartEvent)).toBe(false);
    expect(dragStartEvent.defaultPrevented).toBe(true);
  });
});
