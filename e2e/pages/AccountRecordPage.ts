import { Page, Locator } from '@playwright/test';
import { getScratchOrgInfo } from '../utils/scratch-org';

/**
 * Page Object Model for Salesforce Account record page
 */
export class AccountRecordPage {
  readonly page: Page;
  readonly recordDetailPanel: Locator;
  readonly pageHeader: Locator;
  private baseUrl: string | null = null;

  constructor(page: Page) {
    this.page = page;
    // Look for either the standard detail panel or the flexipage container
    this.recordDetailPanel = page.locator('records-lwc-detail-panel, .slds-page-header, article.slds-card');
    this.pageHeader = page.locator('h1.slds-page-header__title, h1 span');
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
   * Navigate to Account record page
   */
  async goto(accountId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    // Use the test flexipage since standard page doesn't have our component
    await this.page.goto(
      `${baseUrl}/lightning/r/Account/${accountId}/view?flexipageName=Account_Docgen_Test`
    );
  }

  /**
   * Navigate to Account record page with test flexipage
   */
  async gotoWithTestFlexipage(accountId: string): Promise<void> {
    // Navigate with flexipageName parameter to force our custom flexipage
    const baseUrl = await this.getBaseUrl();
    await this.page.goto(
      `${baseUrl}/lightning/r/Account/${accountId}/view?flexipageName=Account_Docgen_Test`
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
