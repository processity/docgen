import { createElement } from 'lwc';
import DocgenProgressButton from 'c/docgenProgressButton';
import startGeneration from '@salesforce/apex/DocgenAsyncController.startGeneration';
import wakePoller from '@salesforce/apex/DocgenAsyncController.wakePoller';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';
import saveGeneratedDocument from '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument';
import cancelGeneratedDocument from '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument';

const mockNavigate = jest.fn();
const mockGenerateUrl = jest.fn();

jest.mock(
  'lightning/navigation',
  () => {
    const navigate = Symbol('Navigate');
    const generateUrl = Symbol('GenerateUrl');
    const NavigationMixin = (Base) =>
      class extends Base {
        [navigate](pageReference) {
          mockNavigate(pageReference);
        }
        [generateUrl](pageReference) {
          return mockGenerateUrl(pageReference);
        }
      };
    NavigationMixin.Navigate = navigate;
    NavigationMixin.GenerateUrl = generateUrl;
    return { NavigationMixin };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.startGeneration',
  () => {
    return {
      default: jest.fn(),
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.wakePoller',
  () => {
    // Apex imports always resolve to a Promise; wakePoller is fire-and-forget.
    return {
      default: jest.fn(() => Promise.resolve()),
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.getGenerationStatus',
  () => {
    return {
      default: jest.fn(),
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument',
  () => {
    return {
      default: jest.fn(),
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument',
  () => {
    return {
      default: jest.fn(),
    };
  },
  { virtual: true }
);

global.window.open = jest.fn();

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
const createDeferred = () => {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
};
const pendingResult = (outputFormat, overrides = {}) => ({
  generatedDocumentId: 'a0G123',
  status: 'SUCCEEDED',
  progressValue: 100,
  isTerminal: true,
  outputFormat,
  isPreviewPending: true,
  ...overrides,
});

const getButton = (element, label) =>
  Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(
    (button) => button.label === label
  );

describe('c-docgen-progress-button', () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    window.history.replaceState({}, '', '/');
    jest.clearAllMocks();
  });

  it('renders the configured button label', () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.buttonLabel = 'Generate Account PDF';
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    expect(button).not.toBeNull();
    expect(button.label).toBe('Generate Account PDF');
  });

  it('shows the additional PDF picker by default and hides it with hideFilePicker', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';

    document.body.appendChild(element);
    expect(element.shadowRoot.querySelector('c-docgen-additional-pdf-selector')).not.toBeNull();

    element.hideFilePicker = 'true';
    await flushPromises();
    expect(element.shadowRoot.querySelector('c-docgen-additional-pdf-selector')).toBeNull();
  });

  it('starts generation with configured template and output format', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'DOCX';
    element.readOnlyWord = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/lightning/r/ContentDocument/069123/view',
    });

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();
    await flushPromises();

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: null,
      templateName: 'Account Template',
      recordId: '0011234567890ABC',
      outputFormat: 'DOCX',
      readOnlyWord: true,
      additionalPdfContentVersionIds: [],
    });
  });

  it('polls status and opens the generated file when configured', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateId = 'a0T1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'PDF';
    element.openOnSuccess = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'QUEUED',
      progressValue: 20,
      isTerminal: false,
    });
    getGenerationStatus.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/sfc/servlet.shepherd/version/download/068123',
    });

    document.body.appendChild(element);

    const successHandler = jest.fn();
    element.addEventListener('docgensuccess', successHandler);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();
    await flushPromises();
    await flushPromises();

    expect(getGenerationStatus).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123',
    });
    expect(window.open).toHaveBeenCalledWith(
      '/sfc/servlet.shepherd/version/download/068123',
      '_blank'
    );
    expect(successHandler).toHaveBeenCalledTimes(1);
  });

  it('wakes the poller after enqueueing a non-terminal generation', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateId = 'a0T1234567890ABC';
    element.recordId = '0011234567890ABC';

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'QUEUED',
      progressValue: 20,
      isTerminal: false,
    });
    getGenerationStatus.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
    });

    document.body.appendChild(element);
    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    expect(wakePoller).toHaveBeenCalledTimes(1);
  });

  it('does not wake the poller when generation is already terminal', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateId = 'a0T1234567890ABC';
    element.recordId = '0011234567890ABC';

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
    });

    document.body.appendChild(element);
    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    expect(wakePoller).not.toHaveBeenCalled();
  });

  it('still completes generation when the poller wake fails', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateId = 'a0T1234567890ABC';
    element.recordId = '0011234567890ABC';

    wakePoller.mockRejectedValueOnce(new Error('callout failed'));
    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'QUEUED',
      progressValue: 20,
      isTerminal: false,
    });
    getGenerationStatus.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
    });

    const successHandler = jest.fn();
    document.body.appendChild(element);
    element.addEventListener('docgensuccess', successHandler);
    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();
    await flushPromises();

    expect(successHandler).toHaveBeenCalledTimes(1);
  });

  it('shows progress state while the generated document is processing', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateId = 'a0T1234567890ABC';
    element.recordId = '0011234567890ABC';

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'QUEUED',
      progressValue: 20,
      isTerminal: false,
    });
    getGenerationStatus.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'PROCESSING',
      progressValue: 60,
      isTerminal: false,
    });

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();
    await flushPromises();
    await flushPromises();

    const progressBar = element.shadowRoot.querySelector('.docgen-progress__track');
    const progressFill = element.shadowRoot.querySelector('.docgen-progress__bar');
    expect(progressBar).not.toBeNull();
    expect(progressBar.getAttribute('role')).toBe('progressbar');
    expect(progressBar.getAttribute('aria-valuenow')).toBe('60');
    expect(progressFill.style.width).toBe('60%');
    expect(element.shadowRoot.querySelector('lightning-progress-bar')).toBeNull();
    expect(button.disabled).toBe(true);
  });

  it('can be called imperatively from a parent custom action', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.recordId = '0011234567890ABC';

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/lightning/r/ContentDocument/069123/view',
    });

    document.body.appendChild(element);

    await element.generate({
      templateId: 'a0T1234567890ABC',
      outputFormat: 'PPTX',
    });

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: 'a0T1234567890ABC',
      templateName: null,
      recordId: '0011234567890ABC',
      outputFormat: 'PPTX',
      readOnlyWord: false,
      additionalPdfContentVersionIds: [],
    });
  });

  it('can hide its own button for a quick action wrapper', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.recordId = '0011234567890ABC';
    element.hideButton = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/lightning/r/ContentDocument/069123/view',
    });

    document.body.appendChild(element);

    expect(element.shadowRoot.querySelector('lightning-button')).toBeNull();

    await element.generate({
      templateName: 'Account Template',
      outputFormat: 'PDF',
    });

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: null,
      templateName: 'Account Template',
      recordId: '0011234567890ABC',
      outputFormat: 'PDF',
      readOnlyWord: false,
      additionalPdfContentVersionIds: [],
    });
  });

  it('does not call Apex when required configuration is missing', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.recordId = '0011234567890ABC';

    document.body.appendChild(element);

    const errorHandler = jest.fn();
    element.addEventListener('docgenerror', errorHandler);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();
    await flushPromises();

    expect(startGeneration).not.toHaveBeenCalled();
    expect(errorHandler).toHaveBeenCalledTimes(1);
  });

  it('renders the secure PDF page-image preview without exposing pending file URLs', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'PDF';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue(
      pendingResult('PDF', {
        canInlinePreview: true,
        previewUrl: '/lightning/r/ContentDocument/069123/view',
        downloadUrl: '/sfc/servlet.shepherd/version/download/068123',
      })
    );

    document.body.appendChild(element);

    const previewHandler = jest.fn();
    element.addEventListener('docgenpreview', previewHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();
    await flushPromises();

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: null,
      templateName: 'Account Template',
      recordId: '0011234567890ABC',
      outputFormat: 'PDF',
      readOnlyWord: false,
      additionalPdfContentVersionIds: [],
      previewMode: true,
    });
    expect(window.open).not.toHaveBeenCalled();
    const preview = element.shadowRoot.querySelector('c-docgen-pdf-image-preview');
    expect(preview).not.toBeNull();
    expect(preview.generatedDocumentId).toBe('a0G123');
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(element.shadowRoot.querySelector('a')).toBeNull();
    expect(element.shadowRoot.querySelector('lightning-button-icon')).toBeNull();
    expect(element.shadowRoot.innerHTML).not.toContain('/lightning/r/ContentDocument/');
    expect(element.shadowRoot.innerHTML).not.toContain('/version/download/');
    expect(element.shadowRoot.querySelectorAll('lightning-button')).toHaveLength(3);
    expect(getButton(element, 'Cancel')).not.toBeNull();
    expect(getButton(element, 'Save')).not.toBeNull();
    expect(getButton(element, 'Download')).toBeUndefined();
    expect(previewHandler).toHaveBeenCalledTimes(1);
  });

  it('keeps Save and Cancel enabled when the child PDF preview reports an error', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'PDF';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue(pendingResult('PDF'));

    document.body.appendChild(element);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    const preview = element.shadowRoot.querySelector('c-docgen-pdf-image-preview');
    preview.dispatchEvent(
      new CustomEvent('previewerror', {
        detail: { message: 'Preview load failed' },
        bubbles: true,
        composed: true,
      })
    );
    await flushPromises();

    expect(preview).not.toBeNull();
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(getButton(element, 'Save').disabled).toBe(false);
    expect(getButton(element, 'Cancel').disabled).toBe(false);
  });

  it('prevents duplicate preview actions and shows the saved file card after Save', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue(
      pendingResult('PDF', {
        previewUrl: '/lightning/r/ContentDocument/069123/view',
        downloadUrl: '/sfc/servlet.shepherd/version/download/068123',
      })
    );
    const saveDeferred = createDeferred();
    saveGeneratedDocument.mockReturnValue(saveDeferred.promise);
    const saveResult = {
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: false,
      contentDocumentId: '069SAVED',
      previewUrl: '/lightning/r/ContentDocument/069123/view',
      downloadUrl: '/sfc/servlet.shepherd/version/download/068SAVED',
    };

    document.body.appendChild(element);

    const saveHandler = jest.fn();
    element.addEventListener('docgensave', saveHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();
    await flushPromises();

    const preview = element.shadowRoot.querySelector('c-docgen-pdf-image-preview');
    preview.dispatchEvent(
      new CustomEvent('previewthumbnail', {
        detail: {
          imageUrl: 'data:image/jpeg;base64,cGFnZTE=',
          pageNumber: 1,
          pageCount: 2,
        },
      })
    );
    const saveButton = getButton(element, 'Save');
    saveButton.click();
    saveButton.click();
    getButton(element, 'Cancel').click();
    await flushPromises();

    expect(element.shadowRoot.querySelector('.preview-action-status').textContent).toContain(
      'Saving document...'
    );
    const previewButtons = Array.from(
      element.shadowRoot.querySelectorAll('lightning-button')
    ).filter((button) => ['Cancel', 'Save'].includes(button.label));
    expect(previewButtons.every((button) => button.disabled)).toBe(true);
    expect(saveGeneratedDocument).toHaveBeenCalledTimes(1);
    expect(cancelGeneratedDocument).not.toHaveBeenCalled();
    expect(getButton(element, 'Download')).toBeUndefined();

    saveDeferred.resolve(saveResult);
    await flushPromises();
    await flushPromises();

    expect(saveGeneratedDocument).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123',
    });
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    const buttonLabels = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(
      (button) => button.label
    );
    expect(buttonLabels).toContain('Download');
    expect(buttonLabels).not.toContain('Cancel');
    expect(buttonLabels).not.toContain('Save');

    const savedCard = element.shadowRoot.querySelector('.saved-file-card');
    const savedThumbnail = savedCard.querySelector('.saved-file-card__image');
    const openPreviewButton = savedCard.querySelector('.saved-file-card__preview');
    expect(savedThumbnail.src).toBe('data:image/jpeg;base64,cGFnZTE=');
    expect(savedCard.querySelector('.saved-file-card__title').textContent).toBe('Generated PDF');
    expect(openPreviewButton.disabled).toBe(false);

    mockGenerateUrl.mockResolvedValueOnce('/lightning/r/ContentDocument/069SAVED/view');
    openPreviewButton.click();
    await flushPromises();
    expect(mockGenerateUrl).toHaveBeenCalledWith({
      type: 'standard__recordPage',
      attributes: {
        recordId: '069SAVED',
        objectApiName: 'ContentDocument',
        actionName: 'view',
      },
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      type: 'standard__namedPage',
      attributes: {
        pageName: 'filePreview',
      },
      state: {
        recordIds: '069SAVED',
        selectedRecordId: '069SAVED',
      },
    });

    mockGenerateUrl.mockResolvedValueOnce('/globalpartnerportal/s/contentdocument/069SAVED');
    openPreviewButton.click();
    await flushPromises();
    expect(window.open).toHaveBeenCalledWith(
      '/globalpartnerportal/s/contentdocument/069SAVED',
      '_blank'
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    const downloadButton = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(
      (button) => button.label === 'Download'
    );
    downloadButton.click();
    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}/sfc/servlet.shepherd/version/download/068SAVED`,
      '_blank'
    );

    window.history.pushState({}, '', '/academicportal/s/quote/001123');
    downloadButton.click();
    expect(window.open).toHaveBeenLastCalledWith(
      `${window.location.origin}/academicportal/sfc/servlet.shepherd/document/download/069SAVED?operationContext=S1`,
      '_blank'
    );
    expect(saveHandler).toHaveBeenCalledTimes(1);
  });

  it('does not show Download when Save returns no saved download URL', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'DOCX';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue(pendingResult('DOCX'));
    saveGeneratedDocument.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'DOCX',
      isPreviewPending: false,
    });

    document.body.appendChild(element);
    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    getButton(element, 'Save').click();
    await flushPromises();

    expect(saveGeneratedDocument).toHaveBeenCalledTimes(1);
    expect(getButton(element, 'Download')).toBeUndefined();
    expect(element.shadowRoot.querySelector('a')).toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });

  it.each(['DOCX', 'PPTX', 'XLSX'])(
    'shows a no-preview message for pending %s without exposing a file link',
    async (outputFormat) => {
      const element = createElement('c-docgen-progress-button', {
        is: DocgenProgressButton,
      });
      element.templateName = 'Account Template';
      element.recordId = '0011234567890ABC';
      element.outputFormat = outputFormat;
      element.previewBeforeSave = true;

      startGeneration.mockResolvedValue(
        pendingResult(outputFormat, {
          canInlinePreview: false,
          contentDocumentId: '069123',
          previewUrl: '/lightning/r/ContentDocument/069123/view',
          downloadUrl: '/sfc/servlet.shepherd/version/download/068123',
        })
      );

      document.body.appendChild(element);

      element.shadowRoot.querySelector('lightning-button').click();
      await flushPromises();

      expect(element.shadowRoot.querySelector('iframe')).toBeNull();
      expect(element.shadowRoot.querySelector('c-docgen-pdf-image-preview')).toBeNull();
      expect(element.shadowRoot.querySelector('a')).toBeNull();
      expect(element.shadowRoot.querySelector('lightning-button-icon')).toBeNull();
      expect(element.shadowRoot.querySelector('lightning-icon')).not.toBeNull();
      expect(element.shadowRoot.textContent).toContain(
        `${outputFormat} preview is not supported. Save the document to download and review it.`
      );
      expect(element.shadowRoot.innerHTML).not.toContain('/lightning/r/ContentDocument/');
      expect(element.shadowRoot.innerHTML).not.toContain('/version/download/');
      expect(window.open).not.toHaveBeenCalled();
      const buttonLabels = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(
        (button) => button.label
      );
      expect(buttonLabels).toContain('Cancel');
      expect(buttonLabels).toContain('Save');
      expect(buttonLabels).not.toContain('Download');
    }
  );

  it('prevents duplicate actions while canceling and dispatches the existing cancel event', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue(pendingResult('PDF'));
    const cancelDeferred = createDeferred();
    cancelGeneratedDocument.mockReturnValue(cancelDeferred.promise);

    document.body.appendChild(element);

    const cancelHandler = jest.fn();
    element.addEventListener('docgencancel', cancelHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();
    await flushPromises();

    const cancelButton = getButton(element, 'Cancel');
    cancelButton.click();
    cancelButton.click();
    getButton(element, 'Save').click();
    await flushPromises();

    expect(element.shadowRoot.querySelector('.preview-action-status').textContent).toContain(
      'Canceling preview...'
    );
    const previewButtons = Array.from(
      element.shadowRoot.querySelectorAll('lightning-button')
    ).filter((button) => ['Cancel', 'Save'].includes(button.label));
    expect(previewButtons.every((button) => button.disabled)).toBe(true);
    expect(cancelGeneratedDocument).toHaveBeenCalledTimes(1);
    expect(saveGeneratedDocument).not.toHaveBeenCalled();

    cancelDeferred.resolve(undefined);
    await flushPromises();
    await flushPromises();

    expect(cancelGeneratedDocument).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123',
    });
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(element.shadowRoot.querySelector('c-docgen-pdf-image-preview')).toBeNull();
    expect(cancelHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          generatedDocumentId: 'a0G123',
          status: 'CANCELED',
        }),
      })
    );
  });

  it('passes ordered additional PDF IDs to queued preview generation', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton,
    });
    element.recordId = '0011234567890ABC';
    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      downloadUrl: '/sfc/servlet.shepherd/version/download/068123',
    });
    document.body.appendChild(element);

    await element.generate({
      templateId: 'a0T1234567890ABC',
      outputFormat: 'PDF',
      previewBeforeSave: true,
      additionalPdfContentVersionIds: [
        '068000000000002AAA',
        '068000000000001AAA',
        '068000000000002AAA',
      ],
    });

    expect(startGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        previewMode: true,
        additionalPdfContentVersionIds: ['068000000000002AAA', '068000000000001AAA'],
      })
    );
  });
});
