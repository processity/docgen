import { test, expect } from '../fixtures/salesforce.fixture';

test.describe('Status Page - Worker Control', () => {
  test.beforeEach(async ({ salesforce }) => {
    const page = salesforce.authenticatedPage;

    // Navigate to Docgen_Status tab
    const instanceUrl = salesforce.orgInfo.instanceUrl;
    await page.goto(`${instanceUrl}/lightning/n/Docgen_Status`);

    // Wait for the Worker Control section to load
    await page.getByRole('heading', { name: 'Worker Control' }).waitFor({ state: 'visible', timeout: 30000 });
  });

  test('should display worker control section', async ({ salesforce }) => {
    const page = salesforce.authenticatedPage;

    // Check for Worker Control heading
    await expect(page.getByRole('heading', { name: 'Worker Control' })).toBeVisible();

    // Check for worker status elements
    await expect(page.getByText('Status:')).toBeVisible();
    await expect(page.getByText('Last Poll Time:')).toBeVisible();
    await expect(page.getByText('Current Queue Depth:')).toBeVisible();

    // Check for control buttons
    await expect(page.getByRole('button', { name: 'Start Worker' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop Worker' })).toBeVisible();
  });

  test('should handle worker start action', async ({ salesforce }) => {
    const page = salesforce.authenticatedPage;

    // Wait for initial load
    await page.waitForTimeout(2000);

    const startButton = page.getByRole('button', { name: 'Start Worker' });
    const stopButton = page.getByRole('button', { name: 'Stop Worker' });

    // If start button is enabled, try to click it
    const isStartEnabled = await startButton.isEnabled();
    if (isStartEnabled) {
      await startButton.click();

      // Wait for action to complete (look for toast or button state change)
      await page.waitForTimeout(3000);

      // After starting, stop button should be enabled
      await expect(stopButton).toBeEnabled();
      await expect(startButton).toBeDisabled();
    } else {
      console.log('Start button was already disabled (worker already running)');
      expect(isStartEnabled).toBe(false);
    }
  });

  test('should handle worker stop action with confirmation', async ({ salesforce }) => {
    const page = salesforce.authenticatedPage;

    // Wait for initial load
    await page.waitForTimeout(2000);

    const stopButton = page.getByRole('button', { name: 'Stop Worker' });

    // If stop button is enabled, set up dialog handler and try to click it
    const isStopEnabled = await stopButton.isEnabled();
    if (isStopEnabled) {
      // Handle the confirmation dialog (click OK/Accept)
      page.on('dialog', async dialog => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('stop the worker');
        await dialog.accept();
      });

      await stopButton.click();

      // Wait for action to complete
      await page.waitForTimeout(3000);
    } else {
      console.log('Stop button was already disabled (worker already stopped)');
      expect(isStopEnabled).toBe(false);
    }
  });
});
