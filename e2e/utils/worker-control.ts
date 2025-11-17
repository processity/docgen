/**
 * Worker Control Utilities for E2E Tests
 *
 * Provides helper functions to start/stop/check worker poller status
 * via Anonymous Apex scripts.
 */

import { execSync } from 'child_process';
import * as path from 'path';

const SCRIPTS_DIR = path.join(__dirname, '../../scripts');

export interface WorkerStatus {
  isRunning: boolean;
  currentQueueDepth: number;
  lastPollTime: string;
}

/**
 * Start the worker poller
 * @throws Error if worker fails to start
 */
export async function startWorker(): Promise<void> {
  try {
    const scriptPath = path.join(SCRIPTS_DIR, 'StartWorker.apex');
    console.log('Starting worker poller...');

    execSync(`sf apex run --file "${scriptPath}"`, {
      encoding: 'utf-8',
      stdio: 'inherit',
    });

    console.log('✅ Worker started successfully');
  } catch (error) {
    throw new Error(`Failed to start worker: ${error}`);
  }
}

/**
 * Stop the worker poller
 * @throws Error if worker fails to stop
 */
export async function stopWorker(): Promise<void> {
  try {
    const scriptPath = path.join(SCRIPTS_DIR, 'StopWorker.apex');
    console.log('Stopping worker poller...');

    execSync(`sf apex run --file "${scriptPath}"`, {
      encoding: 'utf-8',
      stdio: 'inherit',
    });

    console.log('✅ Worker stopped successfully');
  } catch (error) {
    throw new Error(`Failed to stop worker: ${error}`);
  }
}

/**
 * Get worker poller status
 * @returns Worker status information
 * @throws Error if status check fails
 */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  try {
    const scriptPath = path.join(SCRIPTS_DIR, 'CheckWorkerStatus.apex');
    console.log('Checking worker status...');

    const output = execSync(`sf apex run --file "${scriptPath}"`, {
      encoding: 'utf-8',
    });

    // Parse the debug log output to extract status
    // Note: This is a simple parser - in production you'd want more robust parsing
    const isRunning = output.includes('Is Running: true');
    const queueDepthMatch = output.match(/Current Queue Depth: (\d+)/);
    const lastPollTimeMatch = output.match(/Last Poll Time: (.+)/);

    return {
      isRunning,
      currentQueueDepth: queueDepthMatch ? parseInt(queueDepthMatch[1]) : 0,
      lastPollTime: lastPollTimeMatch ? lastPollTimeMatch[1].trim() : '',
    };
  } catch (error) {
    throw new Error(`Failed to get worker status: ${error}`);
  }
}

/**
 * Wait for worker to be running
 * @param timeoutMs Maximum time to wait in milliseconds (default: 10000)
 * @param pollIntervalMs How often to check status (default: 1000)
 * @throws Error if worker doesn't start within timeout
 */
export async function waitForWorkerRunning(
  timeoutMs: number = 10000,
  pollIntervalMs: number = 1000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const status = await getWorkerStatus();
      if (status.isRunning) {
        console.log('✅ Worker is running');
        return;
      }
    } catch (error) {
      // Ignore errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Worker did not start within ${timeoutMs}ms`);
}

/**
 * Ensure worker is stopped (best effort)
 * Useful for test cleanup - doesn't throw if already stopped
 */
export async function ensureWorkerStopped(): Promise<void> {
  try {
    await stopWorker();
  } catch (error) {
    console.log('Worker may already be stopped (ignoring error)');
  }
}
