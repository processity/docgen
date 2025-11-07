import { test as base, Page } from '@playwright/test';
import {
  getScratchOrgInfo,
  createRecord,
  deleteRecords,
  querySalesforce,
  ScratchOrgInfo,
} from '../utils/scratch-org';

export interface TestData {
  accountId: string;
  templateId: string;
  generatedDocIds: string[];
}

export interface SalesforceFixture {
  orgInfo: ScratchOrgInfo;
  testData: TestData;
  authenticatedPage: Page;
}

/**
 * Salesforce test fixture
 * - Authenticates to scratch org using access token
 * - Creates test Account and Docgen_Template__c records
 * - Provides authenticated page with session cookies
 * - Cleans up test data after each test
 */
export const test = base.extend<{ salesforce: SalesforceFixture }>({
  salesforce: async ({ page }, use) => {
    // Get scratch org credentials
    const orgInfo = await getScratchOrgInfo();

    // Set Salesforce session cookies for authentication
    await authenticateWithAccessToken(page, orgInfo);

    // Enable test mode in DocgenController (bypass HTTP callouts)
    await enableTestMode();

    // Create test data
    const testData = await createTestData(orgInfo);

    // Provide fixture to test
    await use({
      orgInfo,
      testData,
      authenticatedPage: page,
    });

    // Cleanup: Delete Generated_Document__c records created during test
    const generatedDocs = await querySalesforce(
      `SELECT Id FROM Generated_Document__c WHERE Account__c = '${testData.accountId}'`
    );
    const generatedDocIds = generatedDocs.map((doc) => doc.Id);
    if (generatedDocIds.length > 0) {
      await deleteRecords('Generated_Document__c', generatedDocIds);
    }

    // Cleanup: Delete test Account (cascade deletes related records)
    await deleteRecords('Account', [testData.accountId]);

    // Note: We intentionally do NOT delete the E2E Test Template
    // It's shared across all test runs with a fixed name and ID
    // This keeps the flexipage configuration stable
  },
});

export { expect } from '@playwright/test';

/**
 * Enable test mode in DocgenController via Custom Settings
 * This allows E2E tests to run without a real Node.js backend
 */
async function enableTestMode(): Promise<void> {
  // Check if Custom Setting record already exists
  const existing = await querySalesforce(
    `SELECT Id FROM Docgen_Settings__c LIMIT 1`
  );

  // Only create if it doesn't exist (once per org, persists across tests)
  if (existing.length === 0) {
    await createRecord('Docgen_Settings__c', { Test_Mode__c: true });
  }

  console.log('✓ Test mode enabled in DocgenController');
}

/**
 * Activate the test flexipage as org default for Account
 * This makes the docgenButton component visible on Account record pages
 */
async function activateTestFlexipage(): Promise<void> {
  try {
    // Query for the flexipage
    const flexipageQuery = `SELECT Id, DeveloperName FROM FlexiPage WHERE DeveloperName = 'Account_Docgen_Test' LIMIT 1`;
    const flexipages = await querySalesforce(flexipageQuery);

    if (flexipages.length === 0) {
      console.log('⚠️  Warning: Test flexipage not found, tests may fail');
      return;
    }

    const flexipageId = flexipages[0].Id;
    console.log(`✓ Found test flexipage: ${flexipageId}`);

    // Note: FlexiPage activation requires UI metadata API which is complex
    // For now, we'll document that tests need manual activation or use a different approach
    // Alternative: Use Lightning App Builder API or setup script with metadata deployment
  } catch (error) {
    console.log('⚠️  Could not activate flexipage:', error);
  }
}

/**
 * Authenticate to Salesforce by setting session cookies
 */
async function authenticateWithAccessToken(
  page: Page,
  orgInfo: ScratchOrgInfo
): Promise<void> {
  // Extract domain from instance URL
  const url = new URL(orgInfo.instanceUrl);
  const domain = url.hostname;

  // Set session cookies
  // Salesforce uses 'sid' cookie for session authentication
  await page.context().addCookies([
    {
      name: 'sid',
      value: orgInfo.accessToken,
      domain: domain,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
    // Also set the frontend session cookie
    {
      name: 'inst',
      value: domain.split('.')[0], // Extract instance name (e.g., 'cs1' from 'cs1.salesforce.com')
      domain: domain,
      path: '/',
      secure: true,
      sameSite: 'None',
    },
  ]);
}

/**
 * Create test data: Account and Docgen_Template__c
 * Returns IDs for use in tests and cleanup
 */
async function createTestData(orgInfo: ScratchOrgInfo): Promise<TestData> {
  // Create test Account with fixed name for test assertions
  const accountId = await createRecord('Account', {
    Name: 'E2E Test Account',
    BillingCity: 'London',
    BillingCountry: 'United Kingdom',
  });

  // Query for existing template or create one with a fixed name
  // For UI-only tests, we mock the backend response, so template content doesn't matter
  let templateId: string;
  const existingTemplates = await querySalesforce(
    "SELECT Id FROM Docgen_Template__c WHERE Name = 'E2E Test Template' LIMIT 1"
  );

  if (existingTemplates.length > 0) {
    templateId = existingTemplates[0].Id;
  } else {
    templateId = await createRecord('Docgen_Template__c', {
      Name: 'E2E Test Template',
      DataSource__c: 'SOQL',
      TemplateContentVersionId__c: '068000000000000AAA', // Mock ContentVersion ID
      SOQL__c: 'SELECT Id, Name FROM Account WHERE Id = :recordId', // Minimal SOQL for test mode
    });
  }

  return {
    accountId,
    templateId,
    generatedDocIds: [],
  };
}
