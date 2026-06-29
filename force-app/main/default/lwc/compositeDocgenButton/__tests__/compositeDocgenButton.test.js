import { createElement } from 'lwc';
import CompositeDocgenButton from 'c/compositeDocgenButton';
import generateComposite from '@salesforce/apex/DocgenController.generateComposite';
import startCompositeGeneration from '@salesforce/apex/DocgenAsyncController.startCompositeGeneration';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';
import getPdfPreviewContent from '@salesforce/apex/DocgenAsyncController.getPdfPreviewContent';
import saveGeneratedDocument from '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument';
import cancelGeneratedDocument from '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument';

// Mock the Apex method
jest.mock(
  '@salesforce/apex/DocgenController.generateComposite',
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
  '@salesforce/apex/DocgenAsyncController.getPdfPreviewContent',
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
global.window.URL.createObjectURL = jest.fn(() => 'blob:composite-pdf-preview');
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
const testPdfBase64 = window.btoa('%PDF-1.4 test pdf');

describe('c-composite-docgen-button', () => {
  afterEach(() => {
    // Clear DOM after each test
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
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
    generateComposite.mockResolvedValue(mockDownloadUrl);

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
    generateComposite.mockResolvedValue(mockDownloadUrl);

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
    generateComposite.mockResolvedValue(mockDownloadUrl);

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
    generateComposite.mockResolvedValue('/sfc/servlet.shepherd/version/download/0681234567890ABC');

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
      readOnlyWord: false
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
    generateComposite.mockResolvedValue(mockDownloadUrl);
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
      readOnlyWord: true
    });
  });

  it('renders an inline preview and waits for user save when preview mode is enabled', async () => {
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.outputFormat = 'PDF';
    element.previewBeforeSave = true;

    startCompositeGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: true,
      canInlinePreview: true,
      previewUrl: '/lightning/r/ContentDocument/069123/view',
      downloadUrl: '/sfc/servlet.shepherd/version/download/068123'
    });
    getPdfPreviewContent.mockResolvedValue({
      contentType: 'application/pdf',
      base64Data: testPdfBase64,
      fileName: 'preview.pdf'
    });

    document.body.appendChild(element);

    const previewHandler = jest.fn();
    element.addEventListener('docgenpreview', previewHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();
    await flushPromises();

    expect(generateComposite).not.toHaveBeenCalled();
    expect(startCompositeGeneration).toHaveBeenCalledWith({
      compositeDocumentId: 'a0Y1234567890ABC',
      recordIds: JSON.stringify({ accountId: '0011234567890ABC' }),
      outputFormat: 'PDF',
      previewMode: true,
      readOnlyWord: false
    });
    expect(window.open).not.toHaveBeenCalled();
    expect(getPdfPreviewContent).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123'
    });
    const iframeSrc = element.shadowRoot.querySelector('iframe').src;
    expect(iframeSrc).toContain('blob:composite-pdf-preview');
    expect(iframeSrc).toContain('#page=1&zoom=100&navpanes=0&pagemode=none');
    expect(iframeSrc).not.toContain('/lightning/r/ContentDocument/');
    expect(iframeSrc).not.toContain('/version/download/');
    expect(previewHandler).toHaveBeenCalledTimes(1);
  });

  it('saves a preview composite document from the preview panel', async () => {
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.previewBeforeSave = true;

    startCompositeGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: true,
      canInlinePreview: true,
      previewUrl: '/lightning/r/ContentDocument/069123/view',
      downloadUrl: '/sfc/servlet.shepherd/version/download/068123'
    });
    getPdfPreviewContent.mockResolvedValue({
      contentType: 'application/pdf',
      base64Data: testPdfBase64,
      fileName: 'preview.pdf'
    });
    const saveDeferred = createDeferred();
    saveGeneratedDocument.mockReturnValue(saveDeferred.promise);

    document.body.appendChild(element);

    const saveHandler = jest.fn();
    element.addEventListener('docgensave', saveHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();
    await flushPromises();

    const saveButton = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(
      button => button.label === 'Save'
    );
    saveButton.click();
    await flushPromises();

    expect(element.shadowRoot.querySelector('.preview-action-status').textContent).toContain(
      'Saving document...'
    );
    const previewButtons = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).filter(
      button => ['Cancel', 'Save'].includes(button.label)
    );
    expect(previewButtons.every(button => button.disabled)).toBe(true);

    saveDeferred.resolve({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: false,
      previewUrl: '/lightning/r/ContentDocument/069123/view',
      downloadUrl: '/sfc/servlet.shepherd/version/download/068123'
    });
    await flushPromises();
    await flushPromises();

    expect(saveGeneratedDocument).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123'
    });
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:composite-pdf-preview');
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();

    const buttonLabels = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(
      button => button.label
    );
    expect(buttonLabels).toContain('Download');
    expect(buttonLabels).not.toContain('Cancel');
    expect(buttonLabels).not.toContain('Save');

    const downloadButton = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(
      button => button.label === 'Download'
    );
    downloadButton.click();
    expect(window.open).toHaveBeenCalledWith('/sfc/servlet.shepherd/version/download/068123', '_blank');
    expect(saveHandler).toHaveBeenCalledTimes(1);
  });

  it('cancels and deletes a preview composite document from the preview panel', async () => {
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    element.previewBeforeSave = true;

    startCompositeGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: true,
      canInlinePreview: true,
      previewUrl: '/lightning/r/ContentDocument/069123/view',
      downloadUrl: '/sfc/servlet.shepherd/version/download/068123'
    });
    getPdfPreviewContent.mockResolvedValue({
      contentType: 'application/pdf',
      base64Data: testPdfBase64,
      fileName: 'preview.pdf'
    });
    const cancelDeferred = createDeferred();
    cancelGeneratedDocument.mockReturnValue(cancelDeferred.promise);

    document.body.appendChild(element);

    const cancelHandler = jest.fn();
    element.addEventListener('docgencancel', cancelHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();
    await flushPromises();

    const cancelButton = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(
      button => button.label === 'Cancel'
    );
    cancelButton.click();
    await flushPromises();

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
    generateComposite.mockResolvedValue('/sfc/servlet.shepherd/version/download/0681234567890ABC');
    document.body.appendChild(element);

    expect(element.shadowRoot.querySelector('lightning-button')).toBeNull();

    await element.generate({
      compositeDocumentId: 'a0Y1234567890ABC',
      recordIds: { quoteId: 'a551234567890ABC' },
      outputFormat: 'PDF'
    });

    expect(generateComposite).toHaveBeenCalledTimes(1);
  });
});
