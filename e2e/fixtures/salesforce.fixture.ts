import { test as base, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  getScratchOrgInfo,
  createRecord,
  updateRecord,
  deleteRecords,
  querySalesforce,
  ScratchOrgInfo,
} from '../utils/scratch-org';

export interface TestData {
  accountId: string;
  templateId: string;
  generatedDocIds: string[];
  contentVersionId?: string; // Track uploaded template for cleanup
}

export interface SalesforceFixture {
  orgInfo: ScratchOrgInfo;
  scratchOrgConfig: ScratchOrgInfo; // Alias for consistency with test helpers
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

    // Log one-click login URL in CI for debugging
    if (process.env.CI) {
      await logOneClickLoginUrl();
    }

    // Set Salesforce session cookies for authentication
    await authenticateWithAccessToken(page, orgInfo);

    // Create test data
    const testData = await createTestData(orgInfo);

    // Configure Named Credential for backend tests
    console.log('Configuring Named Credential for backend tests...');
    await configureNamedCredentialForRealBackend();

    // Provide fixture to test
    await use({
      orgInfo,
      scratchOrgConfig: orgInfo, // Alias for consistency with test helpers
      testData,
      authenticatedPage: page,
    });

    // Cleanup: Delete Generated_Document__c records created during test
    const generatedDocs = await querySalesforce(
      `SELECT Id FROM Generated_Document__c WHERE Account__c = '${testData.accountId}'`
    );
    const generatedDocIds = generatedDocs.map((doc) => doc.Id);
    if (generatedDocIds.length > 0) {
      console.log(`Cleaning up ${generatedDocIds.length} Generated_Document__c record(s)...`);
      await deleteRecords('Generated_Document__c', generatedDocIds);
    }

    // Cleanup: Delete uploaded ContentVersion
    if (testData.contentVersionId) {
      try {
        console.log(`Cleaning up ContentVersion: ${testData.contentVersionId}...`);
        await deleteRecords('ContentVersion', [testData.contentVersionId]);
        console.log('✓ ContentVersion deleted');

        // Also delete the template record created for this test
        console.log(`Cleaning up Template: ${testData.templateId}...`);
        await deleteRecords('Docgen_Template__c', [testData.templateId]);
        console.log('✓ Template deleted');
      } catch (error) {
        console.warn('⚠️  Failed to delete ContentVersion or Template:', error);
        // Non-fatal - ContentVersions auto-delete after 30 days in scratch orgs
      }
    }

    // Cleanup: Delete test Account (cascade deletes related records)
    console.log(`Cleaning up Account: ${testData.accountId}...`);
    await deleteRecords('Account', [testData.accountId]);
    console.log('✓ Account deleted');
  },
});

export { expect } from '@playwright/test';

/**
 * Generate and log a one-click login URL for debugging in CI
 */
async function logOneClickLoginUrl(): Promise<void> {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    // Get the target org from environment or use default
    const targetOrg = process.env.SF_USERNAME;
    const targetOrgFlag = targetOrg ? ` --target-org ${targetOrg}` : '';

    // Generate the login URL
    const { stdout } = await execAsync(
      `sf org open --url-only${targetOrgFlag}`,
      { env: { ...process.env, SF_FORMAT_JSON: 'false' } }
    );

    const loginUrl = stdout.trim();

    // Log the URL prominently so it's easy to find in CI logs
    console.log('\n' + '='.repeat(80));
    console.log('🔐 ONE-CLICK LOGIN URL FOR DEBUGGING');
    console.log('='.repeat(80));
    console.log('Copy and paste this URL into your browser to access the scratch org:');
    console.log('\n' + loginUrl + '\n');
    console.log('This URL will expire in a few minutes for security reasons.');
    console.log('Use it to manually inspect the org state and debug the test failure.');
    console.log('='.repeat(80) + '\n');

    // Also log current org info
    const { stdout: orgInfo } = await execAsync(
      `sf org display${targetOrgFlag} --json`,
      { env: { ...process.env, SF_FORMAT_JSON: 'true' } }
    );

    const orgData = JSON.parse(orgInfo.replace(/\x1B\[[0-9;]*[mGKHF]/g, ''));
    if (orgData.result) {
      console.log('Scratch Org Details:');
      console.log(`  Username: ${orgData.result.username}`);
      console.log(`  Instance: ${orgData.result.instanceUrl}`);
      console.log(`  Org ID: ${orgData.result.id}`);
      console.log(`  Status: ${orgData.result.status || 'Active'}`);
      console.log('');
    }
  } catch (error) {
    console.log('⚠️  Could not generate one-click login URL:', error);
  }
}

/**
 * Configure Named Credential for backend tests via Custom Settings
 * Sets Named_Credential_Name__c to 'Docgen_Node_API_CI' for CI/test environments
 */
async function configureNamedCredentialForRealBackend(): Promise<void> {
  // Check if Custom Setting record already exists
  const existing = await querySalesforce(
    `SELECT Id, Named_Credential_Name__c FROM Docgen_Settings__c LIMIT 1`
  );

  if (existing.length === 0) {
    // Create new record with CI Named Credential
    await createRecord('Docgen_Settings__c', {
      Named_Credential_Name__c: 'Docgen_Node_API_CI'
    });
    console.log('✓ Created Docgen_Settings__c with Named Credential: Docgen_Node_API_CI');
  } else {
    // Update existing record - set Named Credential
    await updateRecord('Docgen_Settings__c', existing[0].Id, {
      Named_Credential_Name__c: 'Docgen_Node_API_CI'
    });
    console.log('✓ Updated Docgen_Settings__c - Named Credential: Docgen_Node_API_CI');
  }

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
  const accountName = `TestAccount_${uniqueId}`;

  console.log(`Creating test Account: ${accountName}`);
  const accountId = await createRecord('Account', {
    Name: accountName,
    BillingCity: 'London',
    BillingCountry: 'United Kingdom',
  });
  console.log(`✓ Created Account with ID: ${accountId}`);

  let templateId: string;
  let contentVersionId: string | undefined;

  console.log('📄 Uploading template for backend testing...');

  // Read test-template.docx file
  const templatePath = path.join(__dirname, 'test-template.docx');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }

  const templateBuffer = fs.readFileSync(templatePath);
  const templateBase64 = templateBuffer.toString('base64');
  console.log(`  Template file size: ${templateBuffer.length} bytes`);

  // Upload to ContentVersion
  // Use unique title to avoid collisions, but template Name will be static
  contentVersionId = await createRecord('ContentVersion', {
    Title: `E2E_Test_Template_${uniqueId}`, // Unique title for ContentVersion
    PathOnClient: 'test-template.docx',
    VersionData: templateBase64,
    FirstPublishLocationId: accountId,
  });
  console.log(`✓ Uploaded ContentVersion: ${contentVersionId}`);

  // Wait for ContentDocument creation (Salesforce async process)
  console.log('  Waiting for ContentDocument creation...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Retry logic for ContentVersion query
  let cvResult = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      cvResult = await querySalesforce(
        `SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${contentVersionId}'`
      );
      if (cvResult.length > 0 && cvResult[0].ContentDocumentId) {
        console.log(`✓ ContentDocument created: ${cvResult[0].ContentDocumentId}`);
        break;
      }
    } catch (error) {
      console.log(`  Attempt ${attempt}/3 failed, retrying...`);
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (!cvResult || cvResult.length === 0) {
    throw new Error('Failed to retrieve ContentVersion after upload');
  }

  // Create Docgen_Template__c with ContentVersionId
  // Use unique name to avoid conflicts between parallel tests
  // Template ID is passed to the test page via URL parameter
  const templateName = `E2E_Test_Template_${uniqueId}`;
  console.log(`Creating test Template: ${templateName}`);
  templateId = await createRecord('Docgen_Template__c', {
    Name: templateName,
    DataSource__c: 'SOQL',
    TemplateContentVersionId__c: contentVersionId,
    SOQL__c: `SELECT Id, Name, BillingCity, CreatedDate FROM Account WHERE Id = :recordId`,
    StoreMergedDocx__c: false,
    ReturnDocxToBrowser__c: false,
  });
  console.log(`✓ Created Template with ID: ${templateId}`);

  // In CI, log the record URLs for manual inspection
  if (process.env.CI) {
    console.log(`\nDirect URLs to test records:`);
    console.log(`  Account: ${orgInfo.instanceUrl}/lightning/r/Account/${accountId}/view`);
    console.log(`  Template: ${orgInfo.instanceUrl}/lightning/r/Docgen_Template__c/${templateId}/view`);
    if (contentVersionId) {
      console.log(`  ContentVersion: ${orgInfo.instanceUrl}/lightning/r/ContentVersion/${contentVersionId}/view`);
    }
    console.log('');
  }

  return {
    accountId,
    templateId,
    generatedDocIds: [],
    contentVersionId,
  };
}
