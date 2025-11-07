import { createElement } from 'lwc';
import DocgenButton from 'c/docgenButton';
import generate from '@salesforce/apex/DocgenController.generate';

// Mock the Apex method
jest.mock(
  '@salesforce/apex/DocgenController.generate',
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

describe('c-docgen-button', () => {
  afterEach(() => {
    // Clear DOM after each test
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    // Clear all mocks
    jest.clearAllMocks();
  });

  it('renders button with configured label', () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.buttonLabel = 'Generate Contract PDF';
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';

    // Act
    document.body.appendChild(element);

    // Assert
    const button = element.shadowRoot.querySelector('lightning-button');
    expect(button).not.toBeNull();
    expect(button.label).toBe('Generate Contract PDF');
  });

  it('button is enabled initially', () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';

    // Act
    document.body.appendChild(element);

    // Assert
    const button = element.shadowRoot.querySelector('lightning-button');
    expect(button.disabled).toBe(false);
  });

  it('shows spinner and disables button when clicked', () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    // Mock Apex method to return a promise that doesn't resolve immediately
    generate.mockImplementation(() => new Promise(() => {}));

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Assert - need to wait for next tick
    return Promise.resolve().then(() => {
      const spinner = element.shadowRoot.querySelector('lightning-spinner');
      expect(spinner).not.toBeNull();
      expect(button.disabled).toBe(true);
    });
  });

  it('calls Apex method with correct parameters on button click', () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generate.mockResolvedValue(mockDownloadUrl);

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Assert
    return Promise.resolve().then(() => {
      expect(generate).toHaveBeenCalledWith({
        templateId: 'a0X1234567890ABC',
        recordId: '0011234567890ABC',
        outputFormat: 'PDF'
      });
    });
  });

  it('opens download URL in new tab on success', () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generate.mockResolvedValue(mockDownloadUrl);

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Assert
    return Promise.resolve().then(() => {
      expect(window.open).toHaveBeenCalledWith(mockDownloadUrl, '_blank');
    });
  });

  it('shows success toast with custom message on success', async () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';
    element.successMessage = 'PDF generated successfully!';

    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generate.mockResolvedValue(mockDownloadUrl);

    document.body.appendChild(element);

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for all promises to flush
    await flushPromises();

    // Assert
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.title).toBe('Success');
    expect(toastEvent.detail.message).toBe('PDF generated successfully!');
    expect(toastEvent.detail.variant).toBe('success');
  });

  it('re-enables button after successful generation', async () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    const mockDownloadUrl = '/sfc/servlet.shepherd/version/download/0681234567890ABC';
    generate.mockResolvedValue(mockDownloadUrl);

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for all promises to flush
    await flushPromises();

    // Assert
    expect(button.disabled).toBe(false);
    const spinner = element.shadowRoot.querySelector('lightning-spinner');
    expect(spinner).toBeNull();
  });

  it('shows error toast with exception message on failure', async () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    const mockError = {
      body: { message: 'Template not found' }
    };
    generate.mockRejectedValue(mockError);

    document.body.appendChild(element);

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for all promises to flush
    await flushPromises();

    // Assert
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.title).toBe('Error Generating Document');
    expect(toastEvent.detail.message).toBe('Template not found');
    expect(toastEvent.detail.variant).toBe('error');
  });

  it('re-enables button after generation error', async () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    const mockError = {
      body: { message: 'Network error' }
    };
    generate.mockRejectedValue(mockError);

    document.body.appendChild(element);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for all promises to flush
    await flushPromises();

    // Assert
    expect(button.disabled).toBe(false);
    const spinner = element.shadowRoot.querySelector('lightning-spinner');
    expect(spinner).toBeNull();
  });

  it('handles error without message body gracefully', async () => {
    // Arrange
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    const mockError = new Error('Unknown error');
    generate.mockRejectedValue(mockError);

    document.body.appendChild(element);

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    // Act
    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for all promises to flush
    await flushPromises();

    // Assert
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.title).toBe('Error Generating Document');
    expect(toastEvent.detail.message).toBe('Unknown error');
    expect(toastEvent.detail.variant).toBe('error');
  });

  it('requires templateId property', async () => {
    // Arrange & Act
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.outputFormat = 'PDF';
    element.recordId = '0011234567890ABC';

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for event to propagate
    await flushPromises();

    // Assert
    expect(generate).not.toHaveBeenCalled();
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.variant).toBe('error');
    expect(toastEvent.detail.message).toContain('Template ID');
  });

  it('requires outputFormat property', async () => {
    // Arrange & Act
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.templateId = 'a0X1234567890ABC';
    element.recordId = '0011234567890ABC';

    const toastHandler = jest.fn();
    element.addEventListener('lightning__showtoast', toastHandler);

    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    button.click();

    // Wait for event to propagate
    await flushPromises();

    // Assert
    expect(generate).not.toHaveBeenCalled();
    expect(toastHandler).toHaveBeenCalledTimes(1);
    const toastEvent = toastHandler.mock.calls[0][0];
    expect(toastEvent.detail.variant).toBe('error');
    expect(toastEvent.detail.message).toContain('Output Format');
  });
});
