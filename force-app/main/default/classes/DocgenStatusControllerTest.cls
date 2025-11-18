/**
 * Test class for DocgenStatusController
 */
@isTest
private class DocgenStatusControllerTest {

    /**
     * Mock class for successful API responses
     */
    private class SuccessMock implements HttpCalloutMock {
        private String endpoint;

        public SuccessMock(String endpoint) {
            this.endpoint = endpoint;
        }

        public HTTPResponse respond(HTTPRequest req) {
            HTTPResponse res = new HTTPResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(200);

            if (endpoint.endsWith('/readyz')) {
                res.setBody('{"ready":true,"checks":{"jwks":true,"salesforce":true,"keyVault":true}}');
            } else if (endpoint.endsWith('/worker/status')) {
                res.setBody('{"isRunning":true,"currentQueueDepth":5,"lastPollTime":"2025-01-17T10:30:00Z"}');
            } else if (endpoint.endsWith('/worker/stats')) {
                res.setBody('{"totalProcessed":100,"totalSucceeded":95,"totalFailed":5,"totalRetries":3,"uptimeSeconds":3600}');
            } else if (endpoint.endsWith('/worker/start')) {
                res.setBody('{"success":true,"message":"Worker started"}');
            } else if (endpoint.endsWith('/worker/stop')) {
                res.setBody('{"success":true,"message":"Worker stopped"}');
            }

            return res;
        }
    }

    /**
     * Mock class for 409 Conflict response (worker already running)
     */
    private class ConflictMock implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HTTPResponse res = new HTTPResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(409);
            res.setBody('{"error":"Poller is already running","correlationId":"test-correlation-id"}');
            return res;
        }
    }

    @testSetup
    static void setup() {
        // Create test data
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '068000000000001AAA'
        );
        insert template;

        List<Generated_Document__c> docs = new List<Generated_Document__c>();

        // Create documents with various statuses
        for (Integer i = 0; i < 10; i++) {
            docs.add(new Generated_Document__c(
                Template__c = template.Id,
                Status__c = 'SUCCEEDED',
                OutputFormat__c = 'PDF',
                Attempts__c = 1,
                RequestHash__c = 'test_hash_success_' + i
            ));
        }

        for (Integer i = 0; i < 3; i++) {
            docs.add(new Generated_Document__c(
                Template__c = template.Id,
                Status__c = 'FAILED',
                OutputFormat__c = 'PDF',
                Attempts__c = 3,
                Error__c = 'Test error message',
                RequestHash__c = 'test_hash_failed_' + i
            ));
        }

        for (Integer i = 0; i < 2; i++) {
            docs.add(new Generated_Document__c(
                Template__c = template.Id,
                Status__c = 'QUEUED',
                OutputFormat__c = 'PDF',
                Attempts__c = 0,
                RequestHash__c = 'test_hash_queued_' + i
            ));
        }

        docs.add(new Generated_Document__c(
            Template__c = template.Id,
            Status__c = 'PROCESSING',
            OutputFormat__c = 'PDF',
            Attempts__c = 1,
            RequestHash__c = 'test_hash_processing'
        ));

        insert docs;
    }

    @isTest
    static void testGetSystemStatus_Success() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/readyz'));

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getSystemStatus();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(true, result.get('ready'), 'System should be ready');

        Map<String, Object> checks = (Map<String, Object>) result.get('checks');
        System.assertEquals(true, checks.get('jwks'), 'JWKS check should pass');
        System.assertEquals(true, checks.get('salesforce'), 'Salesforce check should pass');
        System.assertEquals(true, checks.get('keyVault'), 'Key Vault check should pass');
    }

    @isTest
    static void testGetWorkerStatus_Success() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/worker/status'));

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getWorkerStatus();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(true, result.get('isRunning'), 'Worker should be running');
        System.assertEquals(5, result.get('currentQueueDepth'), 'Queue depth should be 5');
    }

    @isTest
    static void testGetWorkerStats_Success() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/worker/stats'));

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getWorkerStats();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(100, result.get('totalProcessed'), 'Total processed should be 100');
        System.assertEquals(95, result.get('totalSucceeded'), 'Total succeeded should be 95');
        System.assertEquals(5, result.get('totalFailed'), 'Total failed should be 5');
    }

    @isTest
    static void testStartWorker_Success() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/worker/start'));

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.startWorker();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(true, result.get('success'), 'Start should succeed');
    }

    @isTest
    static void testStartWorker_AlreadyRunning() {
        // Test that 409 response is treated as success (idempotent operation)
        Test.setMock(HttpCalloutMock.class, new ConflictMock());

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.startWorker();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(true, result.get('isRunning'), 'Worker should be running');
        System.assertEquals(true, result.get('alreadyRunning'), 'Should indicate worker was already running');
        System.assertEquals('Poller is already running', result.get('message'), 'Should return the error message as info');
    }

    @isTest
    static void testStopWorker_Success() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/worker/stop'));

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.stopWorker();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(true, result.get('success'), 'Stop should succeed');
    }

    @isTest
    static void testGetQueueMetrics() {
        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getQueueMetrics();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(16, result.get('total'), 'Total should be 16');
        System.assertEquals(10, result.get('succeeded'), 'Succeeded should be 10');
        System.assertEquals(3, result.get('failed'), 'Failed should be 3');
        System.assertEquals(2, result.get('queued'), 'Queued should be 2');
        System.assertEquals(1, result.get('processing'), 'Processing should be 1');

        // Success rate = 10 / (10 + 3) * 100 = 76.9%
        Decimal successRate = (Decimal) result.get('successRate');
        System.assertEquals(76.9, successRate, 'Success rate should be 76.9%');

        // Queue depth = QUEUED + PROCESSING = 2 + 1 = 3
        System.assertEquals(3, result.get('queueDepth'), 'Queue depth should be 3');
    }

    @isTest
    static void testGetRecentDocuments() {
        Test.startTest();
        List<DocgenStatusController.GeneratedDocumentInfo> result = DocgenStatusController.getRecentDocuments();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assertEquals(16, result.size(), 'Should return 16 documents');

        // Verify first document has expected fields
        DocgenStatusController.GeneratedDocumentInfo firstDoc = result[0];
        System.assertNotEquals(null, firstDoc.id, 'ID should not be null');
        System.assertNotEquals(null, firstDoc.name, 'Name should not be null');
        System.assertNotEquals(null, firstDoc.templateName, 'Template name should not be null');
        System.assertNotEquals(null, firstDoc.status, 'Status should not be null');
        System.assertEquals('PDF', firstDoc.outputFormat, 'Output format should be PDF');
    }

    @isTest
    static void testGetRecentDocuments_WithError() {
        Test.startTest();
        List<DocgenStatusController.GeneratedDocumentInfo> result = DocgenStatusController.getRecentDocuments();
        Test.stopTest();

        // Find a failed document
        DocgenStatusController.GeneratedDocumentInfo failedDoc = null;
        for (DocgenStatusController.GeneratedDocumentInfo doc : result) {
            if (doc.status == 'FAILED') {
                failedDoc = doc;
                break;
            }
        }

        System.assertNotEquals(null, failedDoc, 'Should find a failed document');
        System.assertNotEquals(null, failedDoc.error, 'Failed document should have error message');
        System.assertEquals(3, failedDoc.attempts, 'Failed document should have 3 attempts');
    }
}
