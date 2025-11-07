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

    // Cleanup: Delete test Template (each test creates its own unique template)
    await deleteRecords('Docgen_Template__c', [testData.templateId]);
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

  // Enable Apex debug logging in CI for better diagnostics
  if (process.env.CI) {
    await enableApexDebugLogging();
  }
}

/**
 * Enable Apex debug logging for the current user
 * Useful for debugging issues in CI where we can't see the Developer Console
 */
async function enableApexDebugLogging(): Promise<void> {
  try {
    console.log('Enabling Apex debug logging for CI...');

    // Get the current user ID
    const users = await querySalesforce(
      `SELECT Id, Username FROM User WHERE Username LIKE '%test-%.sfdx@example.com' LIMIT 1`
    );

    if (users.length === 0) {
      console.log('⚠️  Warning: Could not find test user for debug logging');
      return;
    }

    const userId = users[0].Id;
    const username = users[0].Username;
    console.log(`Setting up debug logging for user: ${username}`);

    // Check if a TraceFlag already exists for this user
    const existingTraceFlags = await querySalesforce(
      `SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG'`
    );

    // Calculate expiration (2 hours from now)
    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() + 2);
    const expirationDateStr = expirationDate.toISOString().replace('T', ' ').replace('.000Z', '');

    if (existingTraceFlags.length > 0) {
      console.log('Debug logging already enabled for user');
      // Could update expiration if needed
    } else {
      // Create a new debug log configuration
      // Note: This requires setting up via Tooling API or metadata API
      // For now, we'll log a message about manual setup
      console.log(`
⚠️  To enable Apex debug logging in CI, run this in Anonymous Apex:

// Enable debug logging for test user
User testUser = [SELECT Id FROM User WHERE Username LIKE '%test-%.sfdx@example.com' LIMIT 1];
Database.insert(new DebugLevel(
  DeveloperName = 'E2E_Debug',
  MasterLabel = 'E2E Debug Level',
  ApexCode = 'DEBUG',
  System_x = 'DEBUG',
  Database = 'DEBUG',
  ApexProfiling = 'DEBUG',
  Callout = 'DEBUG',
  Validation = 'DEBUG',
  Workflow = 'DEBUG'
));

DebugLevel debugLevel = [SELECT Id FROM DebugLevel WHERE DeveloperName = 'E2E_Debug' LIMIT 1];
Database.insert(new TraceFlag(
  TracedEntityId = testUser.Id,
  DebugLevelId = debugLevel.Id,
  LogType = 'USER_DEBUG',
  StartDate = DateTime.now(),
  ExpirationDate = DateTime.now().addHours(2)
));

Then check logs at: Setup > Debug Logs
      `);
    }

    // Also log current Apex logs if any exist
    const recentLogs = await querySalesforce(
      `SELECT Id, LogUser.Name, Application, DurationMilliseconds, Status, Operation, LogLength
       FROM ApexLog
       WHERE LogUser.Id = '${userId}'
       ORDER BY SystemModstamp DESC
       LIMIT 5`
    );

    if (recentLogs.length > 0) {
      console.log(`Found ${recentLogs.length} recent Apex logs:`);
      recentLogs.forEach(log => {
        console.log(`  - ${log.Operation} (${log.DurationMilliseconds}ms, ${log.Status})`);
      });
    }

  } catch (error) {
    console.log('⚠️  Could not enable Apex debug logging:', error);
  }
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
  // Create test Account with unique name to avoid duplicate detection rules
  // Use random string to ensure uniqueness across test runs
  const uniqueId = Math.random().toString(36).substring(2, 15);
  const accountId = await createRecord('Account', {
    Name: `TestAccount_${uniqueId}`,
    BillingCity: 'London',
    BillingCountry: 'United Kingdom',
  });

  // Create template with unique name to avoid duplicate detection rules
  // For UI-only tests, we mock the backend response, so template content doesn't matter
  const templateId = await createRecord('Docgen_Template__c', {
    Name: `TestTemplate_${uniqueId}`,
    DataSource__c: 'SOQL',
    TemplateContentVersionId__c: '068000000000000AAA', // Mock ContentVersion ID
    SOQL__c: 'SELECT Id, Name FROM Account WHERE Id = :recordId', // Minimal SOQL for test mode
  });

  return {
    accountId,
    templateId,
    generatedDocIds: [],
  };
}
