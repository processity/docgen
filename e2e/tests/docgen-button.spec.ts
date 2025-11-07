import { test, expect } from '../fixtures/salesforce.fixture';
import { AccountRecordPage } from '../pages/AccountRecordPage';
import { DocgenButtonComponent } from '../pages/DocgenButtonComponent';
import { querySalesforce, executeAnonymousApex, waitForSalesforceRecord } from '../utils/scratch-org';

test.describe('docgenButton Component - UI Only Tests (No Backend)', () => {
  // Note: Test mode is enabled automatically in the salesforce fixture
  // See salesforce.fixture.ts:enableTestMode()

  test('renders button on Account record page with correct label', async ({
    salesforce,
  }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    // Navigate to test Account
    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Verify component is visible
    const isVisible = await button.isVisible();
    expect(isVisible).toBe(true);

    // Verify button label
    const label = await button.getButtonLabel();
    expect(label).toBe('Generate Test Document');
  });

  test('button is enabled initially', async ({ salesforce }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Verify button is enabled
    const isEnabled = await button.isButtonEnabled();
    expect(isEnabled).toBe(true);
  });

  test('clicking button shows spinner', async ({ salesforce }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Click button
    await button.click();

    // Verify spinner appears
    const spinnerVisible = await button.isSpinnerVisible();
    expect(spinnerVisible).toBe(true);
  });

  test('clicking button disables button', async ({ salesforce }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Click button
    await button.click();

    // Verify button is disabled
    const isDisabled = await button.isButtonDisabled();
    expect(isDisabled).toBe(true);
  });


  test('spinner disappears after completion', async ({ salesforce }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Click button
    await button.click();

    // Wait for spinner to disappear
    await button.waitForSpinnerToDisappear(30000);

    // Verify spinner is gone
    const spinnerVisible = await button.isSpinnerVisible();
    expect(spinnerVisible).toBe(false);
  });

  test('button re-enables after completion', async ({ salesforce }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Click button
    await button.click();

    // Wait for completion (spinner disappears)
    await button.waitForSpinnerToDisappear(30000);

    // Verify button is re-enabled
    const isEnabled = await button.isButtonEnabled();
    expect(isEnabled).toBe(true);
  });

  test('creates Generated_Document__c record with Status=PROCESSING', async ({
    salesforce,
  }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    console.log(`\n${'='.repeat(60)}`);
    console.log('TEST: creates Generated_Document__c record');
    console.log(`${'='.repeat(60)}`);
    console.log(`Test Account ID: ${salesforce.testData.accountId}`);
    console.log(`Test Template ID: ${salesforce.testData.templateId}`);

    console.log('\nNavigating to Account page...');
    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();
    console.log('✓ Account page loaded');

    // Verify button is visible before clicking
    const isVisible = await button.isVisible();
    console.log(`Button visible: ${isVisible}`);
    expect(isVisible).toBe(true);

    // Click button
    console.log('Clicking docgen button...');
    await button.click();
    console.log('✓ Button clicked');

    // Wait for spinner to appear (confirms button was clicked and Apex is running)
    const spinnerVisible = await button.isSpinnerVisible();
    console.log(`Spinner visible after click: ${spinnerVisible}`);
    expect(spinnerVisible).toBe(true);

    // Wait for spinner to disappear (indicates Apex method has completed)
    // This is more reliable than a fixed timeout
    console.log('Waiting for spinner to disappear (Apex completion)...');
    await button.waitForSpinnerToDisappear(30000);
    console.log('✓ Spinner disappeared, Apex method completed');

    // Check button state after completion
    const isEnabled = await button.isButtonEnabled();
    console.log(`Button re-enabled: ${isEnabled}`);

    // First, check if ANY Generated_Document__c records exist in the org
    console.log('\nChecking for any Generated_Document__c records in the org...');
    const allDocs = await querySalesforce(
      `SELECT Id, Status__c, Account__c, CreatedDate FROM Generated_Document__c ORDER BY CreatedDate DESC LIMIT 10`
    );
    console.log(`Total Generated_Document__c records in org: ${allDocs.length}`);
    if (allDocs.length > 0) {
      console.log('Recent records:');
      allDocs.forEach(doc => {
        console.log(`  - ${doc.Id}: Status=${doc.Status__c}, Account=${doc.Account__c}, Created=${doc.CreatedDate}`);
      });
    }

    // Now poll for the Generated_Document__c record
    // The record should exist after the Apex method completes
    console.log('\nPolling for Generated_Document__c record...');
    console.log(`  Account__c = '${salesforce.testData.accountId}'`);

    const generatedDocs = await waitForSalesforceRecord(
      () => querySalesforce(
        `SELECT Id, Status__c, Account__c, Error__c FROM Generated_Document__c WHERE Account__c = '${salesforce.testData.accountId}' ORDER BY CreatedDate DESC LIMIT 1`
      ),
      {
        description: 'Generated_Document__c record',
        maxAttempts: process.env.CI ? 10 : 5,  // More attempts in CI
        delayMs: 2000
      }
    );

    expect(generatedDocs.length).toBeGreaterThan(0);
    const doc = generatedDocs[0];

    // Log the document details for debugging
    console.log('Generated Document found:', {
      Id: doc.Id,
      Status__c: doc.Status__c,
      Error__c: doc.Error__c,
      Account__c: doc.Account__c
    });

    expect(doc.Status__c).toMatch(/PROCESSING|SUCCEEDED/); // Could transition quickly
  });

  test.skip('handles missing template gracefully', async ({ salesforce }) => {
    // Skip: Requires modifying component config at runtime
    // or deploying a separate flexipage with invalid templateId
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Click button (template ID is invalid)
    await button.click();

    // Wait for error toast
    const errorMessage = await button.waitForErrorToast();
    expect(errorMessage).toContain('Template');
  });

  test.skip('handles server errors gracefully', async ({ salesforce }) => {
    // Skip: Requires mocking Node API to return 500 error
    // Could be implemented by:
    // 1. Adding HttpCalloutMock to Salesforce org
    // 2. Or setting up a mock endpoint
    // 3. Or modifying DocgenController with test mode flag
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // Click button
    await button.click();

    // Wait for error toast
    const errorMessage = await button.waitForErrorToast();
    expect(errorMessage).toContain('error');
  });

  test.skip('clicking button twice reuses existing document (idempotency)', async ({
    salesforce,
  }) => {
    // Skip: Requires backend to fully complete first request
    // This tests the idempotency check in DocgenController
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    // First click
    await button.click();
    await button.waitForSpinnerToDisappear(30000);

    // Query for first document
    const firstDocs = await querySalesforce(
      `SELECT Id FROM Generated_Document__c WHERE Account__c = '${salesforce.testData.accountId}'`
    );
    const firstDocCount = firstDocs.length;

    // Second click (should reuse cached document)
    await button.click();
    await button.waitForSpinnerToDisappear(30000);

    // Query again
    const secondDocs = await querySalesforce(
      `SELECT Id FROM Generated_Document__c WHERE Account__c = '${salesforce.testData.accountId}'`
    );

    // Should only have one document (idempotency)
    expect(secondDocs.length).toBe(firstDocCount);
  });

  test('Account page loads successfully', async ({ salesforce }) => {
    const accountPage = new AccountRecordPage(salesforce.authenticatedPage);

    await accountPage.goto(salesforce.testData.accountId);
    await accountPage.waitForLoad();

    const isLoaded = await accountPage.isLoaded();
    expect(isLoaded).toBe(true);

  });
});
