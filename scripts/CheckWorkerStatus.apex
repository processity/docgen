/**
 * Check Worker Poller Status via Anonymous Apex
 *
 * Simple helper script to check the worker poller status from the command line.
 * Useful for E2E tests and local development.
 *
 * Usage:
 *   sf apex run --file scripts/CheckWorkerStatus.apex
 *
 * Exit Codes:
 *   - SUCCESS: Status retrieved successfully
 *   - ERROR: Failed to get status (exception thrown)
 */

try {
    System.debug(LoggingLevel.INFO, 'Checking worker status via DocgenStatusController...');

    Map<String, Object> status = DocgenStatusController.getWorkerStatus();

    Boolean isRunning = (Boolean) status.get('isRunning');
    Integer currentQueueDepth = (Integer) status.get('currentQueueDepth');
    String lastPollTime = (String) status.get('lastPollTime');

    System.debug(LoggingLevel.INFO, '=== Worker Status ===');
    System.debug(LoggingLevel.INFO, 'Is Running: ' + isRunning);
    System.debug(LoggingLevel.INFO, 'Current Queue Depth: ' + currentQueueDepth);
    System.debug(LoggingLevel.INFO, 'Last Poll Time: ' + lastPollTime);

    if (isRunning) {
        System.debug(LoggingLevel.INFO, '✅ Worker is RUNNING');
    } else {
        System.debug(LoggingLevel.WARN, '⚠️  Worker is STOPPED');
    }

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Failed to check worker status: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    throw e;
}
