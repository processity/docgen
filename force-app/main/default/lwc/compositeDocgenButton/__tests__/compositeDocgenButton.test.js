import { createElement } from 'lwc';
import CompositeDocgenButton from 'c/compositeDocgenButton';
import generateComposite from '@salesforce/apex/DocgenController.generateComposite';

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

// Mock window.open
global.window.open = jest.fn();

// Utility to flush all promises
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

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

  it('disables button and shows spinner during processing', () => {
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

    // Assert - button disabled and spinner shown
    return Promise.resolve().then(() => {
      expect(button.disabled).toBe(true);
      const spinner = element.shadowRoot.querySelector('lightning-spinner');
      expect(spinner).not.toBeNull();
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

  it('validates required outputFormat property', async () => {
    // Arrange
    const element = createElement('c-composite-docgen-button', {
      is: CompositeDocgenButton
    });
    element.compositeDocumentId = 'a0Y1234567890ABC';
    element.recordId = '0011234567890ABC';
    element.recordIdField = 'accountId';
    // Missing outputFormat

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
    expect(toastEvent.detail.message).toContain('Output Format');
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
});
