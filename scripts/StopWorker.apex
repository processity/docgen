/**
 * Stop Worker Poller via Anonymous Apex
 *
 * Simple helper script to stop the worker poller from the command line.
 * Useful for E2E tests and local development.
 *
 * Usage:
 *   sf apex run --file scripts/StopWorker.apex
 *
 * Exit Codes:
 *   - SUCCESS: Worker stopped successfully
 *   - ERROR: Failed to stop worker (exception thrown)
 */

try {
    System.debug(LoggingLevel.INFO, 'Stopping worker poller via DocgenStatusController...');

    Map<String, Object> result = DocgenStatusController.stopWorker();

    if (result == null) {
        throw new CalloutException('Worker stop returned null response');
    }

    String message = result.containsKey('message') ? (String) result.get('message') : 'No message provided';
    Boolean isRunning = result.containsKey('isRunning') ? (Boolean) result.get('isRunning') : true;

    System.debug(LoggingLevel.INFO, 'Response: ' + JSON.serialize(result));

    if (!isRunning) {
        System.debug(LoggingLevel.INFO, '✅ Worker stopped successfully');
        System.debug(LoggingLevel.INFO, 'Message: ' + message);
    } else {
        System.debug(LoggingLevel.ERROR, '❌ Worker stop returned isRunning=true');
        System.debug(LoggingLevel.ERROR, 'Message: ' + message);
        throw new CalloutException('Worker stop failed: ' + message);
    }

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Failed to stop worker: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    throw e;
}
