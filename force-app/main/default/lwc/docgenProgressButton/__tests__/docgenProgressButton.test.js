import { createElement } from 'lwc';
import DocgenProgressButton from 'c/docgenProgressButton';
import startGeneration from '@salesforce/apex/DocgenAsyncController.startGeneration';
import getGenerationStatus from '@salesforce/apex/DocgenAsyncController.getGenerationStatus';

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
});
