/**
 * Test Named Credential Callout
 *
 * This script makes a test callout to the backend health endpoint
 * to verify the Named Credential is working correctly.
 */

try {
    System.debug(LoggingLevel.INFO, '=== Testing Named Credential Callout ===');
    System.debug(LoggingLevel.INFO, 'Named Credential: Docgen_Node_API_CI');
    System.debug(LoggingLevel.INFO, 'Endpoint: callout:Docgen_Node_API_CI/worker/status');
    System.debug(LoggingLevel.INFO, 'Note: This endpoint requires authentication');
    System.debug(LoggingLevel.INFO, '');

    // Make HTTP callout using Named Credential
    HttpRequest req = new HttpRequest();
    req.setEndpoint('callout:Docgen_Node_API_CI/worker/status');
    req.setMethod('GET');
    req.setTimeout(10000); // 10 seconds

    Http http = new Http();
    HttpResponse res = http.send(req);

    System.debug(LoggingLevel.INFO, 'Response Status Code: ' + res.getStatusCode());
    System.debug(LoggingLevel.INFO, 'Response Status: ' + res.getStatus());
    System.debug(LoggingLevel.INFO, 'Response Body: ' + res.getBody());

    if (res.getStatusCode() == 200) {
        System.debug(LoggingLevel.INFO, '✅ Named Credential is working correctly!');
        System.debug(LoggingLevel.INFO, '✅ Backend is reachable and healthy');
    } else {
        System.debug(LoggingLevel.WARN, '⚠️  Unexpected status code: ' + res.getStatusCode());
    }

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Callout failed: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Error Type: ' + e.getTypeName());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    System.debug(LoggingLevel.ERROR, '');
    System.debug(LoggingLevel.ERROR, 'Common causes:');
    System.debug(LoggingLevel.ERROR, '1. External Credential not fully configured (missing client ID/secret)');
    System.debug(LoggingLevel.ERROR, '2. Named Credential URL not set correctly');
    System.debug(LoggingLevel.ERROR, '3. Remote site settings need to be configured');
    System.debug(LoggingLevel.ERROR, '4. Backend is not accessible');
}
