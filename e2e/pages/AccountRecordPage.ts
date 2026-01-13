import { Page, Locator } from '@playwright/test';
import { getScratchOrgInfo } from '../utils/scratch-org';

/**
 * Page Object Model for Docgen Test Page with Account context
 */
export class AccountRecordPage {
  readonly page: Page;
  readonly recordDetailPanel: Locator;
  readonly pageHeader: Locator;
  private baseUrl: string | null = null;

  constructor(page: Page) {
    this.page = page;
    // Look for the Docgen test page root
    this.recordDetailPanel = page.locator('c-docgen-test-page, lightning-card[title="Docgen E2E Test Page"]');
    this.pageHeader = page.locator('lightning-card[title="Docgen E2E Test Page"] h2, h1 span');
  }

  /**
   * Get base URL from scratch org info
   */
  private async getBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      const orgInfo = await getScratchOrgInfo();
      this.baseUrl = orgInfo.instanceUrl;
    }
    return this.baseUrl;
  }

  /**
   * Navigate to Docgen Test Page for an Account record
   */
  async goto(accountId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await this.page.goto(
      `${baseUrl}/lightning/n/Docgen_Test_Page?c__recordId=${accountId}`
    );
  }

  /**
   * Navigate to Docgen Test Page for an Account record
   */
  async gotoWithTestFlexipage(accountId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await this.page.goto(
      `${baseUrl}/lightning/n/Docgen_Test_Page?c__recordId=${accountId}`
    );
  }

  /**
   * Wait for page to fully load
   * Checks for presence of record detail panel or page header
   */
  async waitForLoad(): Promise<void> {
    // Wait for the page header to be visible (works for both standard and custom pages)
    await this.pageHeader.first().waitFor({ state: 'visible', timeout: 30000 });
  }

  /**
   * Get the Account name from page header
   */
  async getAccountName(): Promise<string> {
    return (await this.pageHeader.textContent()) || '';
  }

  /**
   * Check if page has loaded successfully
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.waitForLoad();
      return true;
    } catch {
      return false;
    }
  }
}
