import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Salesforce E2E tests
 *
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',

  /* Output test results relative to this config file (e2e directory) */
  outputDir: './test-results',

  /* Run tests sequentially to avoid race conditions in scratch org */
  fullyParallel: false,
  workers: 1,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,

  /* Reporter to use */
  reporter: [
    ['html', { outputFolder: './playwright-report' }],
    ['list'],
    ...(process.env.CI ? [['github' as const]] : []),
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL is set dynamically from scratch org in fixture */
    baseURL: process.env.SF_INSTANCE_URL,

    /* Collect trace on first retry */
    trace: 'on-first-retry',

    /* Screenshot only on failure */
    screenshot: 'only-on-failure',

    /* Increase timeout for Salesforce (can be slow) */
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  /* Global timeout for each test (increased for CI where document generation can be slower) */
  timeout: 120000,

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: undefined, // We use Salesforce scratch org, not a local server
});
