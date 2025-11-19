/**
 * Worker Status Utilities for E2E Tests
 *
 * Provides helper functions to check worker poller status.
 *
 * Note: The worker poller is now always-on (auto-starts with application).
 * Start/stop functionality has been removed as the poller runs automatically
 * on all backend replicas.
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

