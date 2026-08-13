import { createElement } from 'lwc';
import CompositeDocgenButton from 'c/compositeDocgenButton';
import generateComposite from '@salesforce/apex/DocgenController.generateCompositeWithAttachments';
import startCompositeGeneration from '@salesforce/apex/DocgenAsyncController.startCompositeGeneration';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';
import getPdfPreviewPage from '@salesforce/apex/DocgenAsyncController.getPdfPreviewPage';
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

// Mock the Apex method
jest.mock(
  '@salesforce/apex/DocgenController.generateCompositeWithAttachments',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.startCompositeGeneration',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.getGenerationStatus',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.getPdfPreviewPage',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

jest.mock(
  '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument',
  () => {
    return {
      default: jest.fn()
    };
  },
  { virtual: true }
);

// Mock window.open
global.window.open = jest.fn();
global.window.URL.createObjectURL = jest.fn();
global.window.URL.revokeObjectURL = jest.fn();

// Utility to flush all promises
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));
const createDeferred = () => {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
};

const buildPendingStatus = (outputFormat = 'PDF', overrides = {}) => ({
  generatedDocumentId: 'a0G123',
  status: 'SUCCEEDED',
  progressValue: 100,
  isTerminal: true,
  outputFormat,
  isPreviewPending: true,
  ...overrides
});
const buildSavedStatus = (outputFormat = 'PDF', overrides = {}) => ({
  generatedDocumentId: 'a0G123',
  status: 'SUCCEEDED',
  progressValue: 100,
  isTerminal: true,
  outputFormat,
  isPreviewPending: false,
  ...overrides
});

const createPreviewElement = (outputFormat = 'PDF') => {
  const element = createElement('c-composite-docgen-button', {
    is: CompositeDocgenButton
  });
  element.compositeDocumentId = 'a0Y1234567890ABC';
  element.recordId = '0011234567890ABC';
  element.recordIdField = 'accountId';
  element.outputFormat = outputFormat;
  element.previewBeforeSave = true;
  return element;
};

const findButton = (element, label) =>
  Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(
    button => button.label === label
  );

const startPendingPreview = async (element, statusResult) => {
  startCompositeGeneration.mockResolvedValue(statusResult);
  document.body.appendChild(element);
  findButton(element, 'Generate Composite Document').click();
  await flushPromises();
  await flushPromises();
};

describe('c-composite-docgen-button', () => {
  beforeEach(() => {
    getPdfPreviewPage.mockResolvedValue({
      contentType: 'image/jpeg',
      base64Data: 'aW1hZ2U=',
      pageNumber: 1,
      pageCount: 1,
      previewPageCount: 1,
      previewTruncated: false
    });
  });

  afterEach(() => {
    // Clear DOM after each test
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    window.history.replaceState({}, '', '/');
    // Clear all mocks
    jest.clearAllMocks();
  });

  it('calls generateComposite with correct parameters on button click', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.outputFormat = 'PDF';

    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generateComposite.mockResolvedValue({ success: true, downloadUrl: mockDownloadUrl });

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for promises
    await flushPromises();

    // Assert
    expect(generateComposite).toHaveBeenCalledTimes(1);
    const callArgs = generateComposite.mock.calls[0][0];
    expect(callArgs.compositeDocId).toBe('a0Y1234567890ABC');
    expect(callArgs.outputFormat).toBe('PDF');

    // Verify recordIds JSON structure
    const recordIdsMap = JSON.parse(callArgs.recordIds);
    expect(recordIdsMap.accountId).toBe('0011234567890ABC');
  });

  it('shows the additional PDF picker by default and hides it with hideFilePicker', async () => {
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';

    document.body.appendChild(element);
    expect(element.shadowRoot.querySelector('c-docgen-additional-pdf-selector')).not.toBeNull();

    element.hideFilePicker = 'true';
    await flushPromises();
    expect(element.shadowRoot.querySelector('c-docgen-additional-pdf-selector')).toBeNull();
  });

  it('constructs recordIds map from component properties correctly', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.additionalRecordIds = '{"contactId":"0031234567890DEF","opportunityId":"0061234567890GHI"}';
    element.outputFormat = 'PDF';

    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generateComposite.mockResolvedValue({ success: true, downloadUrl: mockDownloadUrl });

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for promises
    await flushPromises();

    // Assert
    expect(generateComposite).toHaveBeenCalledTimes(1);
    const callArgs = generateComposite.mock.calls[0][0];

    // Verify recordIds JSON includes all IDs
    const recordIdsMap = JSON.parse(callArgs.recordIds);
    expect(recordIdsMap.accountId).toBe('0011234567890ABC');
    expect(recordIdsMap.contactId).toBe('0031234567890DEF');
    expect(recordIdsMap.opportunityId).toBe('0061234567890GHI');
    expect(Object.keys(recordIdsMap).length).toBe(3);
  });

  it('opens download URL in new tab and shows success toast', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.outputFormat = 'PDF';
    element.successMessage = 'Composite document generated!';

    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generateComposite.mockResolvedValue({ success: true, downloadUrl: mockDownloadUrl });

    document.body.appendChild(element);

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for promises
    await flushPromises();

    // Assert - download URL opened
    expect(window.open).toHaveBeenCalledWith(mockDownloadUrl, '_blank');

    // Assert - success toast shown
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.title).toBe('Success');
    expect(toastEvent.detail.message).toBe('Composite document generated!');
    expect(toastEvent.detail.variant).toBe('success');
  });

  it('shows error toast and re-enables button on failure', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.outputFormat = 'PDF';

    const mockError = {
      body: { message: 'Composite document not found' }
    };
    generateComposite.mockRejectedValue(mockError);

    document.body.appendChild(element);

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for promises
    await flushPromises();

    // Assert - error toast shown
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.title).toBe('Error Generating Document');
    expect(toastEvent.detail.message).toBe('Composite document not found');
    expect(toastEvent.detail.variant).toBe('error');

    // Assert - button re-enabled
    expect(button.disabled).toBe(false);
    const spinner = element.shadowRoot.querySelector('lightning-spinner');
    expect(spinner).toBeNull();
  });

  it('disables button and shows progress without blocking spinner during processing', () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.outputFormat = 'PDF';

    // Mock Apex method to return a promise that doesn't resolve immediately
    generateComposite.mockImplementation(() => new Promise(() => {}));

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Assert - button disabled and progress shown without the blocking processing spinner
    return Promise.resolve().then(() => {
      expect(button.disabled).toBe(true);
      expect(element.shadowRoot.querySelector('.docgen-progress__track')).not.toBeNull();
      expect(element.shadowRoot.querySelector('.docgen-progress__bar').style.width).toBe('10%');
      const spinner = element.shadowRoot.querySelector('lightning-spinner');
      expect(spinner).toBeNull();
    });
  });

  it('validates required compositeDocumentId property', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    // Missing compositeDocumentId
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.outputFormat = 'PDF';

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for event to propagate
    await flushPromises();

    // Assert
    expect(generateComposite).not.toHaveBeenCalled();
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.variant).toBe('error');
    expect(toastEvent.detail.title).toBe('Configuration Error');
    expect(toastEvent.detail.message).toContain('Composite Document ID');
  });

  it('validates at least one record ID is provided', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    // No recordId or additionalRecordIds provided
    element.outputFormat = 'PDF';

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for event to propagate
    await flushPromises();

    // Assert
    expect(generateComposite).not.toHaveBeenCalled();
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.variant).toBe('error');
    expect(toastEvent.detail.title).toBe('Configuration Error');
    expect(toastEvent.detail.message).toContain('record ID');
  });

  it('allows outputFormat to be omitted so Apex can use the composite default', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    generateComposite.mockResolvedValue({
      success: true,
      downloadUrl: '/sfc/servlet.shepherd/version/download/0681234567890ABC'
    });

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for event to propagate
    await flushPromises();

    // Assert
    expect(generateComposite).toHaveBeenCalledWith({
      compositeDocId: 'a0Y1234567890ABC',
      recordIds: JSON.stringify({ accountId: '0011234567890ABC' }),
      outputFormat: null,
      readOnlyWord: false,
      additionalPdfContentVersionIds: []
    });
  });

  it('renders button with configurable label', () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.buttonLabel = 'Generate Composite Report';
    element.outputFormat = 'PDF';

    // Act
    document.body.appendChild(element);

    // Assert
    const button = element.shadowRoot.querySelector('lightning-button');
    expect(button).not.toBeNull();
    expect(button.label).toBe('Generate Composite Report');
  });

  it('can be called imperatively with a direct recordIds map', async () => {
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generateComposite.mockResolvedValue({ success: true, downloadUrl: mockDownloadUrl });
    document.body.appendChild(element);

    const result = await element.generate({
      compositeDocumentId: 'a0Y1234567890ABC',
      recordIds: { quoteId: 'a551234567890ABC' },
      outputFormat: 'DOCX',
      readOnlyWord: true
    });

    expect(result).toBe(mockDownloadUrl);
    expect(generateComposite).toHaveBeenCalledWith({
      compositeDocId: 'a0Y1234567890ABC',
      recordIds: JSON.stringify({ quoteId: 'a551234567890ABC' }),
      outputFormat: 'DOCX',
      readOnlyWord: true,
      additionalPdfContentVersionIds: []
    });
  });

  it('matches the direct-template image-only PDF contract and preserves composite events', async () => {
    const element = createPreviewElement('PDF');
    const previewHandler = jest.fn();
    element.addEventListener('docgenpreview', previewHandler);

    await startPendingPreview(
      element,
      buildPendingStatus('PDF', {
        contentVersionId: '068SHOULDNOTRENDER',
        contentDocumentId: '069SHOULDNOTRENDER',
        previewUrl: '/lightning/r/ContentDocument/069SHOULDNOTRENDER/view',
        downloadUrl: '/sfc/servlet.shepherd/version/download/068SHOULDNOTRENDER'
      })
    );

    expect(generateComposite).not.toHaveBeenCalled();
    expect(startCompositeGeneration).toHaveBeenCalledWith({
      compositeDocumentId: 'a0Y1234567890ABC',
      recordIds: JSON.stringify({ accountId: '0011234567890ABC' }),
      outputFormat: 'PDF',
      previewMode: true,
      readOnlyWord: false,
      additionalPdfContentVersionIds: []
    });

    const viewer = element.shadowRoot.querySelector('c-docgen-pdf-image-preview');
    expect(viewer).not.toBeNull();
    expect(viewer.generatedDocumentId).toBe('a0G123');
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(element.shadowRoot.querySelector('a')).toBeNull();
    expect(element.shadowRoot.querySelector('lightning-button-icon')).toBeNull();
    expect(element.shadowRoot.innerHTML).not.toContain('068SHOULDNOTRENDER');
    expect(element.shadowRoot.innerHTML).not.toContain('069SHOULDNOTRENDER');
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(findButton(element, 'Save')).not.toBeNull();
    expect(findButton(element, 'Cancel')).not.toBeNull();
    expect(findButton(element, 'Download')).toBeUndefined();
    expect(previewHandler).toHaveBeenCalledTimes(1);
  });

  it.each(['DOCX', 'PPTX', 'XLSX'])(
    'shows preview-not-supported without exposing a file link for pending %s',
    async outputFormat => {
      const element = createPreviewElement(outputFormat);

      await startPendingPreview(
        element,
        buildPendingStatus(outputFormat, {
          previewUrl: '/lightning/r/ContentDocument/069SHOULDNOTRENDER/view',
          downloadUrl: '/sfc/servlet.shepherd/version/download/068SHOULDNOTRENDER'
        })
      );

      expect(element.shadowRoot.querySelector('c-docgen-pdf-image-preview')).toBeNull();
      expect(element.shadowRoot.querySelector('.preview-fallback').textContent).toContain(
        `${outputFormat} preview is not supported.`
      );
      expect(element.shadowRoot.querySelector('.preview-fallback').textContent).toContain(
        'Save the document to download and review it.'
      );
      expect(element.shadowRoot.querySelector('iframe')).toBeNull();
      expect(element.shadowRoot.querySelector('a')).toBeNull();
      expect(element.shadowRoot.innerHTML).not.toContain('/version/download/');
      expect(findButton(element, 'Save')).not.toBeNull();
      expect(findButton(element, 'Cancel')).not.toBeNull();
      expect(findButton(element, 'Download')).toBeUndefined();
      expect(window.open).not.toHaveBeenCalled();
    }
  );

  it('saves once, blocks repeated actions, and shows the saved file card', async () => {
    const element = createPreviewElement('PDF');
    const saveDeferred = createDeferred();
    saveGeneratedDocument.mockReturnValue(saveDeferred.promise);

    const saveHandler = jest.fn();
    element.addEventListener('docgensave', saveHandler);

    await startPendingPreview(element, buildPendingStatus('PDF'));
    const viewer = element.shadowRoot.querySelector('c-docgen-pdf-image-preview');
    viewer.dispatchEvent(
      new CustomEvent('previewthumbnail', {
        detail: {
          imageUrl: 'data:image/jpeg;base64,cGFnZTE=',
          pageNumber: 1,
          pageCount: 2
        }
      })
    );
    const saveButton = findButton(element, 'Save');
    const cancelButton = findButton(element, 'Cancel');
    saveButton.click();
    saveButton.click();
    cancelButton.click();
    await flushPromises();

    expect(saveGeneratedDocument).toHaveBeenCalledTimes(1);
    expect(cancelGeneratedDocument).not.toHaveBeenCalled();
    expect(findButton(element, 'Download')).toBeUndefined();
    expect(element.shadowRoot.querySelector('.preview-action-status').textContent).toContain(
      'Saving document...'
    );
    const previewButtons = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).filter(
      button => ['Cancel', 'Save'].includes(button.label)
    );
    expect(previewButtons.every(button => button.disabled)).toBe(true);

    saveDeferred.resolve(
      buildSavedStatus('PDF', {
        contentDocumentId: '069SAVED',
        downloadUrl: '/sfc/servlet.shepherd/version/download/068123'
      })
    );
    await flushPromises();
    await flushPromises();

    expect(saveGeneratedDocument).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123'
    });
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(element.shadowRoot.querySelector('c-docgen-pdf-image-preview')).toBeNull();

    const buttonLabels = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(
      button => button.label
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
        actionName: 'view'
      }
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      type: 'standard__namedPage',
      attributes: {
        pageName: 'filePreview'
      },
      state: {
        recordIds: '069SAVED',
        selectedRecordId: '069SAVED'
      }
    });

    mockGenerateUrl.mockResolvedValueOnce('/globalpartnerportal/s/contentdocument/069SAVED');
    openPreviewButton.click();
    await flushPromises();
    expect(window.open).toHaveBeenCalledWith(
      '/globalpartnerportal/s/contentdocument/069SAVED',
      '_blank'
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    const downloadButton = findButton(element, 'Download');
    downloadButton.click();
    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}/sfc/servlet.shepherd/version/download/068123`,
      '_blank'
    );

    window.history.pushState({}, '', '/globalpartnerportal/s/quote/001123');
    downloadButton.click();
    expect(window.open).toHaveBeenLastCalledWith(
      `${window.location.origin}/globalpartnerportal/sfc/servlet.shepherd/document/download/069SAVED?operationContext=S1`,
      '_blank'
    );
    expect(saveHandler).toHaveBeenCalledTimes(1);
  });

  it('does not show Download when Save returns no saved download URL', async () => {
    const element = createPreviewElement('DOCX');
    saveGeneratedDocument.mockResolvedValue(buildSavedStatus('DOCX'));

    await startPendingPreview(element, buildPendingStatus('DOCX'));
    findButton(element, 'Save').click();
    await flushPromises();
    await flushPromises();

    expect(findButton(element, 'Download')).toBeUndefined();
    expect(element.shadowRoot.querySelector('a')).toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('keeps Save and Cancel enabled when the child PDF preview reports an error', async () => {
    const element = createPreviewElement('PDF');
    getPdfPreviewPage.mockRejectedValueOnce({
      body: { message: 'Preview page could not be rendered.' }
    });
    saveGeneratedDocument.mockResolvedValue(
      buildSavedStatus('PDF', {
        downloadUrl: '/sfc/servlet.shepherd/version/download/068123'
      })
    );

    await startPendingPreview(element, buildPendingStatus('PDF'));
    const viewer = element.shadowRoot.querySelector('c-docgen-pdf-image-preview');
    await flushPromises();

    expect(viewer.shadowRoot.querySelector('.preview__error').textContent).toContain(
      'Preview page could not be rendered.'
    );
    expect(findButton(element, 'Save').disabled).toBe(false);
    expect(findButton(element, 'Cancel').disabled).toBe(false);
    findButton(element, 'Save').click();
    await flushPromises();
    expect(saveGeneratedDocument).toHaveBeenCalledTimes(1);
  });

  it('cancels once and blocks repeated or competing preview actions', async () => {
    const element = createPreviewElement('PDF');
    const cancelDeferred = createDeferred();
    cancelGeneratedDocument.mockReturnValue(cancelDeferred.promise);

    const cancelHandler = jest.fn();
    element.addEventListener('docgencancel', cancelHandler);

    await startPendingPreview(element, buildPendingStatus('PDF'));

    const cancelButton = findButton(element, 'Cancel');
    const saveButton = findButton(element, 'Save');
    cancelButton.click();
    cancelButton.click();
    saveButton.click();
    await flushPromises();

    expect(cancelGeneratedDocument).toHaveBeenCalledTimes(1);
    expect(saveGeneratedDocument).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('.preview-action-status').textContent).toContain(
      'Canceling preview...'
    );
    const previewButtons = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).filter(
      button => ['Cancel', 'Save'].includes(button.label)
    );
    expect(previewButtons.every(button => button.disabled)).toBe(true);

    cancelDeferred.resolve(undefined);
    await flushPromises();
    await flushPromises();

    expect(cancelGeneratedDocument).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123'
    });
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(element.shadowRoot.querySelector('c-docgen-pdf-image-preview')).toBeNull();
    expect(findButton(element, 'Save')).toBeUndefined();
    expect(findButton(element, 'Cancel')).toBeUndefined();
    expect(findButton(element, 'Download')).toBeUndefined();
    expect(cancelHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          generatedDocumentId: 'a0G123',
          status: 'CANCELED'
        })
      })
    );
  });

  it('can hide its own button for a quick action wrapper', async () => {
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.hideButton = true;
    generateComposite.mockResolvedValue({
      success: true,
      downloadUrl: '/sfc/servlet.shepherd/version/download/0681234567890ABC'
    });
    document.body.appendChild(element);

    expect(element.shadowRoot.querySelector('lightning-button')).toBeNull();

    await element.generate({
      compositeDocumentId: 'a0Y1234567890ABC',
      recordIds: { quoteId: 'a551234567890ABC' },
      outputFormat: 'PDF'
    });

    expect(generateComposite).toHaveBeenCalledTimes(1);
  });

  it('passes ordered additional PDF IDs to composite preview generation', async () => {
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    startCompositeGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      downloadUrl: '/sfc/servlet.shepherd/version/download/068123'
    });
    document.body.appendChild(element);

    await element.generate({
      compositeDocumentId: 'a0Y1234567890ABC',
      recordIds: { quoteId: 'a551234567890ABC' },
      outputFormat: 'PDF',
      previewBeforeSave: true,
      additionalPdfContentVersionIds: [
        '068000000000002AAA',
        '068000000000001AAA',
        '068000000000002AAA'
      ]
    });

    expect(startCompositeGeneration).toHaveBeenCalledWith(expect.objectContaining({
      previewMode: true,
      additionalPdfContentVersionIds: [
        '068000000000002AAA',
        '068000000000001AAA'
      ]
    }));
  });
});
