# Testing Guide

This document covers all testing procedures for the Docgen project, including Node.js tests, Salesforce Apex tests, Lightning Web Component (LWC) tests, and end-to-end (E2E) tests.

## Table of Contents

- [Node.js Tests](#nodejs-tests)
- [Salesforce Apex Tests](#salesforce-apex-tests)
- [Lightning Web Component Tests](#lightning-web-component-tests)
- [End-to-End Tests (Playwright)](#end-to-end-tests-playwright)
- [Continuous Integration](#continuous-integration)
- [Code Coverage](#code-coverage)
- [Best Practices](#best-practices)

---

## Node.js Tests

The Node.js tests use **Jest** with **ts-jest** for TypeScript support.

### Setting Up Salesforce Authentication for Tests

Most Node.js tests can run without Salesforce credentials (using mocks). However, some integration tests require real Salesforce authentication:

- `test/sf.auth.integration.test.ts` - Tests JWT auth flow (requires JWT credentials)
- `test/generate.integration.test.ts` - Tests `/generate` endpoint (requires JWT credentials)
- `test/worker/poller.integration.test.ts` - Tests poller (requires SFDX Auth URL)
- `test/routes/worker.test.ts` - Tests worker routes (requires SFDX Auth URL)
- `test/worker/poller.test.ts` - Tests poller logic (requires SFDX Auth URL)

**Recommended for local development**: Use SFDX Auth URL with a scratch org:

```bash
# Create a scratch org (if you haven't already)
sf org create scratch --definition-file config/project-scratch-def.json --set-default --duration-days 7

# Get the auth URL
sf org display --verbose --json | jq -r '.result.sfdxAuthUrl'

# Add to your .env file:
echo "SFDX_AUTH_URL=<paste-auth-url-here>" >> .env
```

**For testing JWT authentication**: If you need to test the JWT auth flow specifically, set up a Connected App and use:

```bash
# In .env file:
SF_DOMAIN=your-org.my.salesforce.com
SF_USERNAME=integration-user@example.com
SF_CLIENT_ID=3MVG9...your-client-id
SF_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Tests will automatically skip if credentials are not configured.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test -- test/templates/cache.test.ts

# Run tests matching a pattern
npm test -- --testNamePattern="should cache templates"
```

### Test Structure

```
test/
├── auth/               # Azure AD authentication tests
├── convert.test.ts     # LibreOffice conversion tests
├── helpers/            # Test utilities (JWT helpers, DOCX generation)
├── obs.test.ts         # Observability/metrics tests
├── routes/             # API endpoint tests
│   ├── generate.test.ts
│   ├── health.test.ts
│   └── worker.test.ts
├── sf/                 # Salesforce integration tests
│   ├── api.test.ts
│   └── files.test.ts
├── templates/          # Template caching and merging tests
│   ├── cache.test.ts
│   ├── merge.test.ts
│   └── service.test.ts
└── worker/             # Worker poller tests
    └── poller.test.ts
```

### Test Coverage

Current Node.js test coverage:
- **Statements**: 85%+
- **Branches**: 80%+
- **Functions**: 85%+
- **Lines**: 85%+

Coverage reports are generated in `coverage/` directory and uploaded to Codecov in CI.

### Writing Tests

Example test structure:

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('TemplateCache', () => {
  let cache: TemplateCache;

  beforeEach(() => {
    cache = new TemplateCache({ maxSize: 1024 * 1024 }); // 1 MB
  });

  afterEach(() => {
    cache.clear();
  });

  it('should cache template by ContentVersionId', () => {
    const buffer = Buffer.from('test data');
    cache.set('068xx000000abcdXXX', buffer);

    const cached = cache.get('068xx000000abcdXXX');
    expect(cached).toEqual(buffer);
  });

  it('should return undefined for cache miss', () => {
    const cached = cache.get('nonexistent');
    expect(cached).toBeUndefined();
  });
});
```

### Mocking External Dependencies

The test suite uses **Nock** for mocking HTTP requests to Salesforce:

```typescript
import nock from 'nock';

describe('SalesforceApi', () => {
  it('should download template from ContentVersion', async () => {
    nock('https://example.my.salesforce.com')
      .get('/services/data/v59.0/sobjects/ContentVersion/068xxx/VersionData')
      .reply(200, Buffer.from('docx content'));

    const buffer = await api.downloadTemplate('068xxx');
    expect(buffer).toBeInstanceOf(Buffer);
  });
});
```

---

## Salesforce Apex Tests

Apex tests verify the Salesforce-side logic including controllers, batch classes, and data providers.

### Running Apex Tests

```bash
# Run all Apex tests in scratch org
./scripts/run-apex-tests.sh

# Or manually
sf apex run test --test-level RunLocalTests --code-coverage --result-format human

# Run specific test class
sf apex run test \
  --class-names DocgenControllerTest \
  --code-coverage \
  --result-format human

# Run tests for multi-object support
sf apex run test \
  --class-names DocgenMultiObjectIntegrationTest \
  --code-coverage \
  --result-format human
```

### Test Classes

| Test Class | Purpose | Test Count |
|------------|---------|------------|
| `DocgenControllerTest` | Interactive generation via LWC | 15 tests |
| `DocgenEnvelopeServiceTest` | Request envelope building | 12 tests |
| `StandardSOQLProviderTest` | Data collection and formatting | 18 tests |
| `BatchDocgenEnqueueTest` | Batch processing | 7 tests |
| `DocgenMultiObjectIntegrationTest` | Multi-object support (Account, Opportunity, Case, Contact, Lead) | 25 tests |
| `DocgenTestDataFactoryTest` | Test data factory utilities | 8 tests |
| `SupportedObjectRegistryTest` | Custom metadata configuration | 12 tests |

**Total**: 112 Apex tests with **86% code coverage** (exceeds 75% requirement for deployment)

### Test Coverage

View Apex code coverage in Salesforce:

1. Go to **Setup → Apex Test Execution**
2. Click **View Test History**
3. Select the latest test run
4. Click **View Code Coverage**

Or via CLI:

```bash
sf apex get test \
  --test-run-id <test-run-id> \
  --code-coverage \
  --result-format human
```

### Test Data Factory

The project includes `DocgenTestDataFactory.cls` for creating test data:

```apex
// Create test scenario with Account, Template, and Generated Document
DocgenTestDataFactory.TestScenario scenario =
  DocgenTestDataFactory.createStandardScenario();

Account testAccount = scenario.account;
Docgen_Template__c template = scenario.template;
ContentVersion templateFile = scenario.templateContentVersion;
```

### Writing Apex Tests

Example test structure:

```apex
@IsTest
private class MyServiceTest {
  @TestSetup
  static void setup() {
    // Create test data
    DocgenTestDataFactory.TestScenario scenario =
      DocgenTestDataFactory.createStandardScenario();
  }

  @IsTest
  static void testSuccessfulGeneration() {
    // Arrange
    Test.setMock(HttpCalloutMock.class, new SuccessfulCalloutMock());

    // Act
    Test.startTest();
    DocgenController.GenerateResult result =
      DocgenController.generate(templateId, recordId, 'PDF');
    Test.stopTest();

    // Assert
    System.assertNotEquals(null, result.downloadUrl);
    System.assertNotEquals(null, result.contentVersionId);
  }
}
```

---

## Lightning Web Component Tests

LWC tests use **Jest** with **@salesforce/sfdx-lwc-jest**.

### Running LWC Tests

```bash
# Run all LWC tests
npm run test:lwc

# Run in watch mode
npm run test:lwc:watch

# Run with coverage
npm run test:lwc:coverage

# Run specific component tests
npm run test:lwc -- docgenButton
```

### Test Structure

```
force-app/main/default/lwc/
├── docgenButton/
│   ├── docgenButton.js
│   ├── docgenButton.html
│   ├── docgenButton.js-meta.xml
│   └── __tests__/
│       └── docgenButton.test.js
└── docgenTestPage/
    ├── docgenTestPage.js
    ├── docgenTestPage.html
    └── __tests__/
        └── docgenTestPage.test.js
```

### Writing LWC Tests

Example LWC test:

```javascript
import { createElement } from 'lwc';
import DocgenButton from 'c/docgenButton';

describe('c-docgen-button', () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('should render generate button', () => {
    const element = createElement('c-docgen-button', {
      is: DocgenButton
    });
    element.recordId = '001xx000000abcdXXX';
    document.body.appendChild(element);

    const button = element.shadowRoot.querySelector('lightning-button');
    expect(button).not.toBeNull();
    expect(button.label).toBe('Generate Document');
  });

  it('should show toast on successful generation', async () => {
    // Test toast notification logic
  });
});
```

---

## End-to-End Tests (Playwright)

E2E tests verify the complete document generation flow with a real backend and Salesforce scratch org.

### Prerequisites

- **Azure CLI** authenticated (`az login`)
- **Salesforce CLI** authenticated to Dev Hub
- **Scratch org** created and set as default
- **Playwright** installed (`npx playwright install`)

### Running E2E Tests Locally

#### Quick Start (Recommended)

```bash
# Step 1: Create scratch org and deploy metadata
npm run e2e:setup

# Step 2: Configure CI backend + run tests
npm run test:e2e:local

# Step 3: View test results
npm run test:e2e:report

# Step 4: Clean up scratch org
npm run e2e:teardown
```

**What `test:e2e:local` does**:
1. Extracts SFDX-AUTH-URL from your local scratch org
2. Updates the CI backend's Key Vault with your org's credentials
3. Restarts the CI backend to load new credentials
4. Waits for backend health check to pass
5. Runs Playwright e2e tests against the configured backend

#### Manual Configuration

```bash
# Configure CI backend separately
./scripts/configure-ci-backend-for-local.sh

# Then run tests
npm run test:e2e
```

### Available Test Modes

```bash
npm run test:e2e:local    # Configure backend + run (recommended for local)
npm run test:e2e          # Headless (backend must be configured first)
npm run test:e2e:headed   # Watch browser execute
npm run test:e2e:ui       # Interactive mode
npm run test:e2e:debug    # Debug with Playwright Inspector
```

### Test Structure

```
e2e/
├── tests/
│   ├── docgen-button.spec.ts       # Interactive generation tests
│   └── multi-object.spec.ts        # Multi-object support tests
├── fixtures/
│   └── test-template.docx          # Test DOCX templates
├── support/
│   └── salesforce-helpers.ts       # Salesforce test utilities
└── playwright.config.ts            # Playwright configuration
```

### What's Tested

E2E tests cover the complete flow:

- ✅ Complete PDF generation (LWC → Apex → Backend → Salesforce Files)
- ✅ Template download from ContentVersion
- ✅ DOCX template merging with data
- ✅ PDF conversion via LibreOffice
- ✅ File upload and ContentDocumentLink creation
- ✅ Generated_Document__c status tracking
- ✅ Error handling and toast notifications
- ✅ **Multi-object support**: Contact, Lead, Opportunity document generation
- ✅ **Dynamic lookup fields**: Contact__c, Lead__c, Opportunity__c field assignment
- ✅ **Parent relationship extraction**: Multi-parent scenarios (Opportunity → Account)

### Important Notes

- 🔄 **Shared Backend**: The CI backend (`docgen-ci`) is shared between local and CI testing
- ⚠️ **Reconfigure Per Org**: Run `test:e2e:local` each time you create a new scratch org
- ⏱️ **Backend Restart**: Configuration script waits ~2 minutes for backend to restart
- 🔐 **Azure Access**: You must have Contributor access to `docgen-ci-rg` resource group

### Debugging E2E Tests

```bash
# Run in debug mode (opens Playwright Inspector)
npm run test:e2e:debug

# Run in headed mode (see browser)
npm run test:e2e:headed

# View test report
npm run test:e2e:report

# Trace viewer (after test failure)
npx playwright show-trace test-results/<test-name>/trace.zip
```

### Writing E2E Tests

Example E2E test:

```typescript
import { test, expect } from '@playwright/test';

test('generates PDF successfully with real backend', async ({ page }) => {
  // Navigate to Docgen Test Page
  await page.goto(`${SF_INSTANCE_URL}/lightning/n/Docgen_Test_Page`);

  // Wait for component to load
  await page.waitForSelector('c-docgen-test-page');

  // Click generate button
  await page.click('button:has-text("Generate Document")');

  // Wait for success toast
  await expect(page.locator('.slds-notify--toast')).toContainText('Success');

  // Verify file was created in Salesforce
  const contentVersion = await queryContentVersion(generatedDocId);
  expect(contentVersion).toBeDefined();
});
```

### E2E Test Configuration

Environment variables for E2E tests:

```bash
# Salesforce configuration
SF_INSTANCE_URL=https://your-org.my.salesforce.com
SF_USERNAME=test-user@example.com
SF_PASSWORD=password123

# Backend configuration
BACKEND_URL=https://docgen-ci.bravemeadow-58840dba.eastus.azurecontainerapps.io
TEST_MODE_DISABLED=true  # Use real backend instead of mocks
```

### See Also

- [E2E Testing Architecture](./e2e-testing.md) - Design decisions and patterns
- [E2E README](../e2e/README.md) - Detailed setup and troubleshooting

---

## Continuous Integration

The project includes GitHub Actions workflows that automatically run all tests on every push and pull request.

### Node.js CI Workflow

**File**: `.github/workflows/ci.yml`

**Jobs**:
1. **Lint**: Runs ESLint on TypeScript code
2. **Type Check**: Validates TypeScript types
3. **Test**: Runs Jest tests with coverage
4. **Build**: Compiles TypeScript to JavaScript
5. **Upload Coverage**: Sends coverage reports to Codecov

**Trigger**: On push to any branch, on pull requests

```bash
# CI runs these commands:
npm run lint
npm run type-check
npm run test:coverage
npm run build
```

### Salesforce CI Workflow

**File**: `.github/workflows/ci.yml` (salesforce job)

**Steps**:
1. Authenticate to Dev Hub (using `SFDX_AUTH_URL` secret)
2. Create scratch org
3. Deploy all metadata
4. Assign permission sets
5. Run Apex tests
6. Clean up scratch org

**Trigger**: On push to any branch, on pull requests

### Setting Up CI

#### Enable Salesforce CI

```bash
# 1. Authenticate to your Dev Hub
sf org login web --set-default-dev-hub --alias DevHub

# 2. Get the auth URL
sf org display --verbose --target-org DevHub

# 3. Copy the "Sfdx Auth Url" value

# 4. Add it as a GitHub secret
# Go to: Settings → Secrets and variables → Actions → New repository secret
# Name: SFDX_AUTH_URL
# Value: <paste auth URL>
```

#### Enable Codecov

```bash
# 1. Sign up at https://codecov.io
# 2. Link your GitHub repository
# 3. Add CODECOV_TOKEN as GitHub secret (optional, public repos work without it)
```

### CI Status Badges

Add these to your README:

```markdown
[![CI](https://github.com/bigmantra/docgen/actions/workflows/ci.yml/badge.svg)](https://github.com/bigmantra/docgen/actions/workflows/ci.yml)
[![Node.js Coverage](https://img.shields.io/codecov/c/github/bigmantra/docgen/main?flag=nodejs&label=Node.js&logo=codecov)](https://codecov.io/gh/bigmantra/docgen?flags[0]=nodejs)
[![Salesforce Coverage](https://img.shields.io/codecov/c/github/bigmantra/docgen/main?flag=salesforce&label=Salesforce&logo=codecov)](https://codecov.io/gh/bigmantra/docgen?flags[0]=salesforce)
```

### Viewing CI Results

- **GitHub Actions**: [https://github.com/bigmantra/docgen/actions](https://github.com/bigmantra/docgen/actions)
- **Codecov Dashboard**: [https://codecov.io/gh/bigmantra/docgen](https://codecov.io/gh/bigmantra/docgen)

---

## Code Coverage

### Node.js Coverage

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

**Coverage Targets**:
- Statements: 80%+
- Branches: 75%+
- Functions: 80%+
- Lines: 80%+

### Apex Coverage

```bash
# Run tests with coverage
sf apex run test --test-level RunLocalTests --code-coverage --result-format human

# View coverage percentage
# Requirement: 75%+ for production deployment
```

**Current Coverage**: 86% (exceeds 75% requirement)

### LWC Coverage

```bash
# Run LWC tests with coverage
npm run test:lwc:coverage

# View HTML report
open coverage/lwc/lcov-report/index.html
```

---

## Best Practices

### Test Naming Conventions

```typescript
// Good
it('should cache template by ContentVersionId', ...)
it('should throw error when template not found', ...)
it('should retry on transient failure', ...)

// Avoid
it('test1', ...)
it('works', ...)
it('caching', ...)
```

### Test Organization

- **Arrange-Act-Assert** pattern
- One assertion per test (when possible)
- Use descriptive test names
- Group related tests with `describe` blocks

```typescript
describe('TemplateCache', () => {
  describe('get()', () => {
    it('should return cached template', ...)
    it('should return undefined for cache miss', ...)
  });

  describe('set()', () => {
    it('should cache template', ...)
    it('should evict LRU entry when cache full', ...)
  });
});
```

### Mocking Best Practices

- Mock external dependencies (HTTP, file system)
- Use test doubles for isolation
- Reset mocks between tests
- Verify mock interactions when needed

### Performance Testing

- Keep tests fast (< 5 seconds per test file)
- Use `beforeAll` for expensive setup when safe
- Parallelize tests (`jest --maxWorkers=4`)
- Avoid unnecessary waits/sleeps

### CI/CD Best Practices

- Run tests on every commit
- Block merges on test failures
- Track coverage trends over time
- Use matrix testing for multiple Node.js versions (if needed)

## Related Documentation

- [Quick Start Guide](./quick-start.md) - Setting up development environment
- [Architecture Guide](./architecture.md) - Technical implementation details
- [E2E Testing Architecture](./e2e-testing.md) - E2E testing design
- [Troubleshooting Index](./troubleshooting-index.md) - Common test issues
