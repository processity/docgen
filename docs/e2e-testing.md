# E2E Testing Architecture and Strategy

This document describes the end-to-end testing strategy for the docgen project, focusing on the `docgenButton` Lightning Web Component.

## Overview

The E2E testing suite uses Playwright to test the `docgenButton` LWC component in a real Salesforce environment (scratch org). Tests verify UI behavior, user interactions, and Salesforce record creation **without requiring the Node.js document generation service to be running**.

## Architecture

### Test Stack

- **Framework**: Playwright Test (`@playwright/test`)
- **Language**: TypeScript
- **Browser**: Chromium
- **Salesforce**: Ephemeral scratch orgs (local) or CI-created orgs
- **Authentication**: Access token-based (session cookies)
- **Test Data**: Created/deleted per test via Salesforce CLI

### Directory Structure

```
e2e/
├── playwright.config.ts          # Playwright configuration
├── tsconfig.json                 # TypeScript config (extends root)
├── tests/
│   └── docgen-button.spec.ts    # Test specifications
├── fixtures/
│   └── salesforce.fixture.ts     # Test fixtures (setup/teardown)
├── pages/
│   ├── AccountRecordPage.ts      # Page Object Model for Account
│   └── DocgenButtonComponent.ts  # Component Object Model
└── utils/
    └── scratch-org.ts             # Scratch org CLI utilities
```

## Design Decisions

### 1. UI-Only Tests (No Backend Required)

**Decision**: Focus on UI behavior and Salesforce integration; skip end-to-end document generation.

**Rationale**:
- Node.js service may not be running during local development
- Backend testing covered by separate integration tests
- UI tests can run faster without HTTP callouts
- Easier to test error scenarios (mock responses)

**Trade-offs**:
- Don't verify actual PDF generation
- Don't test Node API integration
- Don't verify ContentVersion upload

**Future**: Add backend integration tests separately with proper service mocking.

### 2. Access Token Authentication

**Decision**: Use Salesforce access tokens from `sf org display` to authenticate Playwright.

**Rationale**:
- No interactive login required (headless mode)
- Works in CI/CD pipelines
- Fast and reliable
- Reuses existing SF CLI authentication

**Implementation**:
```typescript
await page.context().addCookies([{
  name: 'sid',
  value: orgInfo.accessToken,
  domain: domain,
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'None',
}]);
```

### 3. Test Data Lifecycle

**Decision**: Create test data before each test, delete after each test.

**Rationale**:
- Ensures clean state for each test
- Avoids test pollution and flakiness
- Allows tests to run in any order
- Scratch orgs are ephemeral (no long-term data concerns)

**Implementation**:
- **Setup**: Create Account + Template via `sf data create record`
- **Teardown**: Delete Generated_Document__c, Account, Template via `sf data delete record`

### 4. Page Object Model Pattern

**Decision**: Use Page Object Model (POM) to encapsulate page interactions.

**Rationale**:
- Improves test maintainability
- Reduces code duplication
- Makes tests more readable
- Isolates locator changes to page objects

**Example**:
```typescript
const accountPage = new AccountRecordPage(page);
await accountPage.goto(accountId);

const button = new DocgenButtonComponent(page);
await button.click();
```

### 5. Scratch Org Strategy

**Local Development**:
- Developer creates scratch org once: `npm run e2e:setup`
- Runs tests multiple times: `npm run test:e2e`
- Deletes org when done: `npm run e2e:teardown`
- Scratch org lasts 7 days

**CI/CD**:
- GitHub Actions creates ephemeral scratch org
- Runs tests once
- Deletes org immediately after
- Scratch org lasts 1 day (minimum)

### 6. Sequential Test Execution

**Decision**: Run tests sequentially (`workers: 1`) instead of parallel.

**Rationale**:
- Avoid race conditions in scratch org (single database)
- Prevent test data conflicts
- Salesforce API rate limits
- More predictable test behavior

**Trade-off**: Slower test execution, but more reliable.

## Test Coverage

### In Scope (Current Tests)

✅ Component rendering and visibility
✅ Button label and initial state
✅ Spinner appearance during processing
✅ Button disabled state during processing
✅ Success toast after completion
✅ Spinner disappearance after completion
✅ Button re-enabling after completion
✅ Generated_Document__c record creation
✅ Account page loading

### Out of Scope (Future Tests)

❌ Actual PDF/DOCX generation (requires Node service)
❌ ContentVersion file upload verification
❌ ContentDocumentLink creation
❌ Download URL validity
❌ Node API error responses (requires mocking)
❌ Template validation errors
❌ Idempotency (RequestHash caching)

### Skipped Tests (Requires Setup)

⏭️ Missing template error handling (needs invalid templateId config)
⏭️ Server error handling (needs HttpCalloutMock or test mode)
⏭️ Idempotency verification (needs backend to complete first request)

## Fixtures and Test Utilities

### Salesforce Fixture

**Purpose**: Authenticate to Salesforce and manage test data lifecycle.

**Responsibilities**:
- Get scratch org credentials via `sf org display`
- Set Salesforce session cookies in Playwright
- Create test Account and Template records
- Clean up Generated_Document__c records after test
- Delete test data after test

**Usage**:
```typescript
test('test name', async ({ salesforce }) => {
  // salesforce.orgInfo: Instance URL, access token, username
  // salesforce.testData: Account ID, Template ID
  // salesforce.authenticatedPage: Page with SF session cookies
});
```

### Scratch Org Utilities

**Purpose**: Interact with Salesforce via CLI commands.

**Functions**:
- `getScratchOrgInfo()`: Get instance URL and access token
- `createRecord()`: Create Salesforce record via CLI
- `deleteRecords()`: Delete records via CLI
- `querySalesforce()`: Execute SOQL query
- `executeAnonymousApex()`: Run Apex code (for test mode setup)

## CI/CD Pipeline

### GitHub Actions Workflow

**File**: `.github/workflows/e2e-tests.yml`

**Steps**:
1. Checkout code
2. Setup Node.js + cache dependencies
3. Install npm dependencies
4. Install Salesforce CLI
5. Install Playwright browsers
6. Authenticate to Dev Hub (using `SFDX_AUTH_URL` secret)
7. Create scratch org (1-day duration)
8. Deploy main metadata
9. Deploy test metadata
10. Get org credentials (instance URL, access token)
11. Run Playwright tests
12. Upload test results and reports as artifacts
13. Delete scratch org (cleanup)
14. Comment on PR with test summary

**Triggers**:
- Pull requests to `main`
- Manual workflow dispatch

**Secrets Required**:
- `SFDX_AUTH_URL`: Dev Hub authentication URL

## Error Handling and Debugging

### Common Errors

#### Authentication Failure
**Symptom**: `Failed to get scratch org info`

**Causes**:
- No default org set
- Scratch org expired
- SF CLI not installed

**Fix**:
```bash
sf org list
sf org set default --org docgen-e2e
```

#### Component Not Found
**Symptom**: `Locator 'c-docgen-button' not found`

**Causes**:
- Test metadata not deployed
- Flexipage not assigned to Account record
- Component not on page

**Fix**:
```bash
sf project deploy start --source-dir force-app/test
sf org open  # Manually verify component is visible
```

#### Test Timeout
**Symptom**: `Test timeout of 60000ms exceeded`

**Causes**:
- Salesforce org is slow
- Element selector incorrect
- Component not loading

**Fix**:
- Increase timeout in `playwright.config.ts`
- Run in headed mode: `npm run test:e2e:headed`
- Check browser console for errors

### Debugging Strategies

**1. Headed Mode**:
```bash
npm run test:e2e:headed
```
- Watch browser execute tests
- See UI state changes
- Inspect network requests

**2. UI Mode**:
```bash
npm run test:e2e:ui
```
- Interactive test runner
- Step through tests
- Time travel debugging

**3. Debug Mode**:
```bash
npm run test:e2e:debug
```
- Opens Playwright Inspector
- Pause on failures
- Inspect element locators

**4. Screenshots and Traces**:
- Automatic on failure: `screenshot: 'only-on-failure'`
- View in HTML report: `npm run test:e2e:report`
- Download from CI artifacts

## Future Enhancements

### 1. Backend Integration Tests

Add tests that verify full end-to-end flow:
- Deploy Node service to test environment
- Configure Named Credential to point to test service
- Verify PDF generation, upload, and download

### 2. Test Mode in DocgenController

Add mock mode to skip HTTP callouts:
```apex
@TestVisible
private static Boolean isTestMode = false;

@AuraEnabled
public static String generate(...) {
  if (isTestMode) {
    // Return mock response
    return 'https://mock.salesforce.com/download/MOCK_CV_ID';
  }
  // Real implementation...
}
```

Enable via Anonymous Apex before tests:
```javascript
await executeAnonymousApex(`DocgenController.isTestMode = true;`);
```

### 3. Visual Regression Testing

Add screenshot comparison tests:
- Capture component baseline screenshots
- Compare against baselines on each run
- Detect unintended UI changes

### 4. Performance Testing

Add performance metrics:
- Measure time from click to completion
- Track spinner duration
- Verify toast appears within SLA

### 5. Cross-Browser Testing

Expand browser coverage:
- Firefox
- WebKit (Safari)
- Mobile viewports

## Best Practices

### Writing Tests

1. **Use Page Objects**: Encapsulate selectors and interactions
2. **Clear Test Names**: Describe expected behavior
3. **One Assertion Per Test**: Focus on single behavior
4. **Independent Tests**: No dependencies between tests
5. **Clean Test Data**: Create/delete data per test

### Maintenance

1. **Update Selectors**: Keep page objects in sync with component changes
2. **Review Skipped Tests**: Periodically revisit and enable
3. **Monitor Flakiness**: Investigate and fix flaky tests
4. **Update Documentation**: Keep README and this doc current

### CI/CD

1. **Fast Feedback**: Run tests on every PR
2. **Artifact Preservation**: Upload screenshots and reports
3. **Fail Fast**: Stop on first failure in CI
4. **Notification**: Comment on PR with results

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Salesforce CLI Reference](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/)
- [LWC Testing Guide](https://developer.salesforce.com/docs/component-library/documentation/en/lwc/lwc.testing)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)
