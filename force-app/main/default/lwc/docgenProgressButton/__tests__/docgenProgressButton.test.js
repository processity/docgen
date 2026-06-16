import { createElement } from 'lwc';
import DocgenProgressButton from 'c/docgenProgressButton';
import startGeneration from '@salesforce/apex/DocgenAsyncController.startGeneration';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';
import saveGeneratedDocument from '@salesforce/apex/DocgenAsyncController.saveGeneratedDocument';
import cancelGeneratedDocument from '@salesforce/apex/DocgenAsyncController.cancelGeneratedDocument';

jest.mock(
  '@salesforce/apex/DocgenAsyncController.startGeneration',
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

global.window.open = jest.fn();

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('c-docgen-progress-button', () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it('renders the configured button label', () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.buttonLabel = 'Generate Account PDF';
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    expect(button).not.toBeNull();
    expect(button.label).toBe('Generate Account PDF');
  });

  it('starts generation with configured template and output format', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'DOCX';

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();
    await flushPromises();

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: null,
      templateName: 'Account Template',
      recordId: '0011234567890ABC',
      outputFormat: 'DOCX'
    });
  });

  it('polls status and opens the generated file when configured', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.templateId = 'a0T1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'PDF';
    element.openOnSuccess = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'QUEUED',
      progressValue: 20,
      isTerminal: false
    });
    getGenerationStatus.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });

    document.body.appendChild(element);

    const successHandler = jest.fn();
    element.addEventListener('docgensuccess', successHandler);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();
    await flushPromises();
    await flushPromises();

    expect(getGenerationStatus).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123'
    });
    expect(window.open).toHaveBeenCalledWith('/lightning/r/ContentDocument/069123/view', '_blank');
    expect(successHandler).toHaveBeenCalledTimes(1);
  });

  it('shows progress state while the generated document is processing', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.templateId = 'a0T1234567890ABC';
    element.recordId = '0011234567890ABC';

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'QUEUED',
      progressValue: 20,
      isTerminal: false
    });
    getGenerationStatus.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'PROCESSING',
      progressValue: 60,
      isTerminal: false
    });

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();
    await flushPromises();
    await flushPromises();

    const progressBar = element.shadowRoot.querySelector('lightning-progress-bar');
    expect(progressBar).not.toBeNull();
    expect(progressBar.value).toBe(60);
    expect(button.disabled).toBe(true);
  });

  it('can be called imperatively from a parent custom action', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.recordId = '0011234567890ABC';

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });

    document.body.appendChild(element);

    await element.generate({
      templateId: 'a0T1234567890ABC',
      outputFormat: 'PPTX'
    });

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: 'a0T1234567890ABC',
      templateName: null,
      recordId: '0011234567890ABC',
      outputFormat: 'PPTX'
    });
  });

  it('can hide its own button for a quick action wrapper', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.recordId = '0011234567890ABC';
    element.hideButton = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });

    document.body.appendChild(element);

    expect(element.shadowRoot.querySelector('lightning-button')).toBeNull();

    await element.generate({
      templateName: 'Account Template',
      outputFormat: 'PDF'
    });

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: null,
      templateName: 'Account Template',
      recordId: '0011234567890ABC',
      outputFormat: 'PDF'
    });
  });

  it('does not call Apex when required configuration is missing', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
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

  it('renders an inline preview and waits for user save when preview mode is enabled', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'PDF';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: true,
      canInlinePreview: true,
      previewUrl: '/sfc/servlet.shepherd/version/download/068123',
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });

    document.body.appendChild(element);

    const previewHandler = jest.fn();
    element.addEventListener('docgenpreview', previewHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    expect(startGeneration).toHaveBeenCalledWith({
      templateId: null,
      templateName: 'Account Template',
      recordId: '0011234567890ABC',
      outputFormat: 'PDF',
      previewMode: true
    });
    expect(window.open).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector('iframe').src).toContain('/sfc/servlet.shepherd/version/download/068123');
    expect(element.shadowRoot.querySelectorAll('lightning-button')).toHaveLength(3);
    expect(previewHandler).toHaveBeenCalledTimes(1);
  });

  it('saves a preview document from the preview panel', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: true,
      canInlinePreview: true,
      previewUrl: '/sfc/servlet.shepherd/version/download/068123',
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });
    saveGeneratedDocument.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: false,
      previewUrl: '/sfc/servlet.shepherd/version/download/068123',
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });

    document.body.appendChild(element);

    const saveHandler = jest.fn();
    element.addEventListener('docgensave', saveHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    const buttons = element.shadowRoot.querySelectorAll('lightning-button');
    buttons[2].click();
    await flushPromises();

    expect(saveGeneratedDocument).toHaveBeenCalledWith({
      generatedDocumentId: 'a0G123'
    });
    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    const buttonLabels = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(
      (button) => button.label
    );
    expect(buttonLabels).toContain('Download');
    expect(buttonLabels).not.toContain('Cancel');
    expect(buttonLabels).not.toContain('Save');

    const downloadButton = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).find(
      (button) => button.label === 'Download'
    );
    downloadButton.click();
    expect(window.open).toHaveBeenCalledWith('/sfc/servlet.shepherd/version/download/068123', '_blank');
    expect(saveHandler).toHaveBeenCalledTimes(1);
  });

  it('shows a same-panel fallback when inline preview is not available', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.outputFormat = 'DOCX';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'DOCX',
      isPreviewPending: true,
      canInlinePreview: false,
      contentDocumentId: '069123',
      previewUrl: '/sfc/servlet.shepherd/version/download/068123',
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });

    document.body.appendChild(element);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    expect(element.shadowRoot.querySelector('iframe')).toBeNull();
    expect(element.shadowRoot.querySelector('lightning-icon')).not.toBeNull();
    expect(element.shadowRoot.textContent).toContain('DOCX files cannot be previewed inline');
    const recordLink = element.shadowRoot.querySelector('a.preview-record-link');
    expect(recordLink).not.toBeNull();
    expect(recordLink.href).toContain('/lightning/r/ContentDocument/069123/view');
    expect(recordLink.target).toBe('_blank');
    const buttonLabels = Array.from(element.shadowRoot.querySelectorAll('lightning-button')).map(
      (button) => button.label
    );
    expect(buttonLabels).toContain('Cancel');
    expect(buttonLabels).toContain('Save');
  });

  it('cancels and deletes a preview document from the preview panel', async () => {
    const element = createElement('c-docgen-progress-button', {
      is: DocgenProgressButton
    });
    element.templateName = 'Account Template';
    element.recordId = '0011234567890ABC';
    element.previewBeforeSave = true;

    startGeneration.mockResolvedValue({
      generatedDocumentId: 'a0G123',
      status: 'SUCCEEDED',
      progressValue: 100,
      isTerminal: true,
      outputFormat: 'PDF',
      isPreviewPending: true,
      canInlinePreview: true,
      previewUrl: '/sfc/servlet.shepherd/version/download/068123',
      downloadUrl: '/lightning/r/ContentDocument/069123/view'
    });
    cancelGeneratedDocument.mockResolvedValue(undefined);

    document.body.appendChild(element);

    const cancelHandler = jest.fn();
    element.addEventListener('docgencancel', cancelHandler);

    element.shadowRoot.querySelector('lightning-button').click();
    await flushPromises();

    const buttons = element.shadowRoot.querySelectorAll('lightning-button');
    buttons[1].click();
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
});
