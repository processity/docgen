import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for docgenButton Lightning Web Component
 */
export class DocgenButtonComponent {
  readonly page: Page;
  readonly component: Locator;
  readonly button: Locator;
  readonly spinner: Locator;
  readonly toastContainer: Locator;

  constructor(page: Page) {
    this.page = page;

    // LWC component selector (Playwright uses CSS selectors, LWC uses custom elements)
    this.component = page.locator('c-docgen-button');
    this.button = this.component.locator('lightning-button button');
    this.spinner = this.component.locator('lightning-spinner');

    // Toast notifications appear at body level
    this.toastContainer = page.locator('.slds-notify-container');
  }

  /**
   * Check if the component is visible on the page
   */
  async isVisible(): Promise<boolean> {
    try {
      await this.component.waitFor({ state: 'visible', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click the docgen button
   */
  async click(): Promise<void> {
    await this.button.click();
  }

  /**
   * Get the button label text
   */
  async getButtonLabel(): Promise<string> {
    return (await this.button.textContent())?.trim() || '';
  }

  /**
   * Check if the button is currently disabled
   */
  async isButtonDisabled(): Promise<boolean> {
    return (await this.button.getAttribute('disabled')) !== null;
  }

  /**
   * Check if the button is currently enabled
   */
  async isButtonEnabled(): Promise<boolean> {
    return !(await this.isButtonDisabled());
  }

  /**
   * Check if the spinner is currently visible
   */
  async isSpinnerVisible(): Promise<boolean> {
    try {
      await this.spinner.waitFor({ state: 'visible', timeout: 1000 });
      return await this.spinner.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Wait for spinner to disappear (generation complete)
   */
  async waitForSpinnerToDisappear(timeout = 30000): Promise<void> {
    await this.spinner.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Wait for a toast notification to appear
   * Returns the toast message text
   */
  async waitForToast(timeout = 10000): Promise<string> {
    const toast = this.toastContainer.locator('.slds-notify');
    await toast.waitFor({ state: 'visible', timeout });

    const messageEl = toast.locator('.slds-notify__content');
    return (await messageEl.textContent())?.trim() || '';
  }

  /**
   * Wait for success toast
   * Uses multiple selectors to handle different Salesforce Lightning versions
   */
  async waitForSuccessToast(timeout = 10000): Promise<string> {
    // Try multiple selectors for success toast (SLDS classes can vary)
    const selectors = [
      '.slds-notify--success',
      '.slds-notify_success',
      '.forceToastMessage.success',
      '[role="alert"].success',
    ];

    // Wait for any toast to appear first
    await this.toastContainer.waitFor({ state: 'visible', timeout: 5000 });

    // Try each selector
    for (const selector of selectors) {
      const toast = this.toastContainer.locator(selector);
      const isVisible = await toast.isVisible().catch(() => false);
      if (isVisible) {
        const messageEl = toast.locator('.slds-notify__content, .toastMessage');
        const text = await messageEl.textContent().catch(() => '');
        return text?.trim() || '';
      }
    }

    throw new Error(`No success toast found with any known selector after ${timeout}ms`);
  }

  /**
   * Wait for error toast
   */
  async waitForErrorToast(timeout = 10000): Promise<string> {
    const errorToast = this.toastContainer.locator('.slds-notify--error');
    await errorToast.waitFor({ state: 'visible', timeout });

    const messageEl = errorToast.locator('.slds-notify__content');
    return (await messageEl.textContent())?.trim() || '';
  }

  /**
   * Check if a success toast is currently visible
   */
  async hasSuccessToast(): Promise<boolean> {
    try {
      const successToast = this.toastContainer.locator('.slds-notify--success');
      return await successToast.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Check if an error toast is currently visible
   */
  async hasErrorToast(): Promise<boolean> {
    try {
      const errorToast = this.toastContainer.locator('.slds-notify--error');
      return await errorToast.isVisible();
    } catch {
      return false;
    }
  }
}
