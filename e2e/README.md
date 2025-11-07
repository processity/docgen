# Playwright E2E Tests for docgenButton Component

This directory contains end-to-end tests for the `docgenButton` Lightning Web Component using Playwright.

## Overview

The E2E tests verify UI behavior and Salesforce integration without requiring the Node.js document generation service to be running. Tests focus on:

- Component rendering and visibility
- User interactions (button clicks, spinner states)
- Salesforce record creation (Generated_Document__c)
- Toast notifications (success/error messages)
- Button state management (enabled/disabled)

## Prerequisites

### Local Development

1. **Salesforce CLI**: Install the Salesforce CLI (`sf`)
   ```bash
   npm install -g @salesforce/cli
   ```

2. **Dev Hub Access**: Authenticate to a Dev Hub org
   ```bash
   sf org login web --set-default-dev-hub --alias DevHub
   ```

3. **Node.js Dependencies**: Install project dependencies
   ```bash
   npm install
   ```

4. **Playwright Browsers**: Install Playwright browsers
   ```bash
   npx playwright install chromium
   ```

### CI/CD

The tests run automatically in GitHub Actions on pull requests. Ensure the following secret is configured:

- `SFDX_AUTH_URL`: Dev Hub authentication URL (get via `sf org display --verbose --json`)

## Running Tests Locally

### Step 1: Create Scratch Org

Create a scratch org and deploy all metadata:

```bash
npm run e2e:setup
```

This script:
- Creates a scratch org (alias: `docgen-e2e`, 7-day duration)
- Deploys main metadata (`force-app/main`)
- Deploys test metadata (`force-app/test`)
- Runs Apex tests
- Opens the org in a browser

### Step 2: Run E2E Tests

Run all Playwright tests:

```bash
npm run test:e2e
```

### Step 3: View Test Results

After tests complete, view the HTML report:

```bash
npm run test:e2e:report
```

### Step 4: Clean Up

Delete the scratch org when done:

```bash
npm run e2e:teardown
```

## Test Modes

### Headless Mode (Default)
```bash
npm run test:e2e
```

### Headed Mode (Watch Browser)
```bash
npm run test:e2e:headed
```

### UI Mode (Interactive)
```bash
npm run test:e2e:ui
```

### Debug Mode
```bash
npm run test:e2e:debug
```

## Test Structure

```
e2e/
├── playwright.config.ts          # Playwright configuration
├── tests/
│   └── docgen-button.spec.ts    # Main test file (12 tests)
├── fixtures/
│   └── salesforce.fixture.ts     # SF auth + test data setup/teardown
├── pages/
│   ├── AccountRecordPage.ts      # Page object for Account page
│   └── DocgenButtonComponent.ts  # Component object model
└── utils/
    └── scratch-org.ts             # Scratch org CLI utilities
```

## Test Cases

### Passing Tests (9)

1. ✅ Renders button on Account record page with correct label
2. ✅ Button is enabled initially
3. ✅ Clicking button shows spinner
4. ✅ Clicking button disables button
5. ✅ Successful generation shows success toast
6. ✅ Spinner disappears after completion
7. ✅ Button re-enables after completion
8. ✅ Creates Generated_Document__c record with Status=PROCESSING
9. ✅ Account page loads successfully

### Skipped Tests (3)

These tests are skipped because they require additional setup:

10. ⏭️ Handles missing template gracefully (requires invalid templateId config)
11. ⏭️ Handles server errors gracefully (requires HttpCalloutMock or test mode)
12. ⏭️ Clicking button twice reuses existing document (requires backend completion)

## Authentication

The tests use Salesforce access tokens for authentication:

1. Get org info from `sf org display --json`
2. Extract `instanceUrl` and `accessToken`
3. Set session cookies (`sid` and `inst`) in Playwright browser context
4. Navigate to Salesforce pages with authenticated session

## Test Data Management

### Setup (Before Each Test)

- Create test Account record
- Create test Docgen_Template__c record
- Set Salesforce session cookies

### Teardown (After Each Test)

- Delete Generated_Document__c records created during test
- Delete test Account record (cascade deletes)
- Delete test Docgen_Template__c record

## Troubleshooting

### Tests Fail with Authentication Error

**Problem**: `Failed to get scratch org info`

**Solution**: Ensure a scratch org is set as default:
```bash
sf org list
sf org set default --org docgen-e2e
```

### Component Not Visible

**Problem**: `docgenButton` component not found on page

**Solution**:
1. Check that test metadata deployed: `sf project deploy start --source-dir force-app/test`
2. Verify flexipage exists: `sf org open` and navigate to Account record page
3. Manually assign flexipage to Account record (Setup > Lightning App Builder)

### Tests Timeout

**Problem**: Tests timeout waiting for elements

**Solution**:
1. Increase timeout in `playwright.config.ts` (`timeout: 60000`)
2. Check Salesforce org performance (scratch orgs can be slow)
3. Run in headed mode to see what's happening: `npm run test:e2e:headed`

### Backend Service Required

**Problem**: Tests fail because backend service isn't running

**Solution**:
- Current tests assume the Node service is running or mock responses are configured
- To run UI-only tests, add test mode to `DocgenController.cls`:
  ```apex
  @TestVisible
  private static Boolean isTestMode = false;
  ```
- Enable test mode via Anonymous Apex before running tests

## CI/CD Integration

Tests run automatically in GitHub Actions (`.github/workflows/e2e-tests.yml`):

1. Create ephemeral scratch org
2. Deploy main + test metadata
3. Run Playwright tests
4. Upload test results and reports as artifacts
5. Delete scratch org
6. Comment on PR with test summary

## Next Steps

To add more tests:

1. Create new test file in `e2e/tests/`
2. Import fixtures: `import { test, expect } from '../fixtures/salesforce.fixture';`
3. Use page objects for interaction
4. Run tests: `npm run test:e2e`

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Salesforce CLI Command Reference](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/)
- [Lightning Web Components Testing](https://developer.salesforce.com/docs/component-library/documentation/en/lwc/lwc.testing)
