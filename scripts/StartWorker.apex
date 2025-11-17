/**
 * Start Worker Poller via Anonymous Apex
 *
 * Simple helper script to start the worker poller from the command line.
 * Useful for E2E tests and local development.
 *
 * Usage:
 *   sf apex run --file scripts/StartWorker.apex
 *
 * Exit Codes:
 *   - SUCCESS: Worker started successfully
 *   - ERROR: Failed to start worker (exception thrown)
 */

try {
    System.debug(LoggingLevel.INFO, 'Starting worker poller via DocgenStatusController...');

    Map<String, Object> result = DocgenStatusController.startWorker();

    if (result == null) {
        throw new CalloutException('Worker start returned null response');
    }

    String message = result.containsKey('message') ? (String) result.get('message') : 'No message provided';
    Boolean isRunning = result.containsKey('isRunning') ? (Boolean) result.get('isRunning') : false;

    System.debug(LoggingLevel.INFO, 'Response: ' + JSON.serialize(result));

    if (isRunning) {
        System.debug(LoggingLevel.INFO, '✅ Worker started successfully');
        System.debug(LoggingLevel.INFO, 'Message: ' + message);
    } else {
        System.debug(LoggingLevel.ERROR, '❌ Worker start returned isRunning=false');
        System.debug(LoggingLevel.ERROR, 'Message: ' + message);
        throw new CalloutException('Worker start failed: ' + message);
    }

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Failed to start worker: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    throw e;
}
