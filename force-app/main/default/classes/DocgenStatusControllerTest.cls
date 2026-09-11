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
            } else if (endpoint.endsWith('/metrics/fleet')) {
                res.setBody('{"scope":"fleet","coverage":{"activeReplicas":2,"reportingReplicas":1,"complete":false},"replicas":[{"replicaId":"a"},{"replicaId":"b"}],"resources":{"cpuPercent":null}}');
            } else if (endpoint.endsWith('/metrics/performance')) {
                res.setBody(
                    '{"replicaId":"replica-1","windowSeconds":3600,"observedSeconds":1800,' +
                    '"processUptimeSeconds":7200,"documents":{"count":12,"succeeded":11,"failed":1,' +
                    '"successRatePercent":91.7,"perMinute":0.4,"perHour":24,' +
                    '"latency":{"p50Ms":4200,"p95Ms":9100,"p99Ms":12000,"avgMs":5100,"maxMs":12000},' +
                    '"byOutputFormat":[{"key":"PDF","count":12,"avgMs":5100,"p95Ms":9100}],' +
                    '"byMode":[{"key":"batch","count":12,"avgMs":5100,"p95Ms":9100}]},' +
                    '"stages":[{"stage":"pdfConvert","count":12,"errorCount":0,"totalMs":36000,' +
                    '"avgMs":3000,"p50Ms":2900,"p95Ms":4100,"maxMs":4300}],' +
                    '"slowestStageByTotalTime":"pdfConvert"}'
                );
            } else if (endpoint.endsWith('/metrics/resources')) {
                res.setBody(
                    '{"replicaId":"replica-1","pid":42,"processUptimeSeconds":7200,' +
                    '"cpu":{"percent":37.5,"cores":2,"source":"cgroup-v2","sampleSeconds":60},' +
                    '"memory":{"source":"cgroup-v2","usedMb":1024,"limitMb":4096,"percentOfLimit":25,' +
                    '"node":{"rssMb":320,"heapUsedMb":120,"heapTotalMb":180,"externalMb":12}},' +
                    '"eventLoopDelayMs":{"p50":1.2,"p99":18.4,"max":210},' +
                    '"libreOfficePool":{"activeJobs":2,"queuedJobs":1,"maxConcurrent":8,' +
                    '"utilizationPercent":25,"completedJobs":100,"failedJobs":2,"totalConversions":102},' +
                    '"templateCache":{"hits":90,"misses":10,"hitRatePercent":90,"lookups":100,' +
                    '"entryCount":4,"evictions":0,"sizeMb":12.5,"maxSizeMb":500,"utilizationPercent":2.5}}'
                );
            }

            return res;
        }
    }

    /**
     * Mock class returning a server error for every endpoint
     */
    private class ErrorMock implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HTTPResponse res = new HTTPResponse();
            res.setStatusCode(500);
            res.setBody('{"error":"boom"}');
            return res;
        }
    }

    @testSetup
    static void setup() {
        // Create test data
        Docgen_Template__c template = DocgenTestDataFactory.createTemplate(
            'Test Template',
            'Account',
            'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );

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

    @isTest
    static void testGetPerformanceMetrics() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/metrics/performance'));

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getPerformanceMetrics();
        Test.stopTest();

        System.assertEquals('replica-1', result.get('replicaId'), 'Replica must be identified');
        System.assertEquals('pdfConvert', result.get('slowestStageByTotalTime'), 'Slowest stage should pass through');

        Map<String, Object> documents = (Map<String, Object>) result.get('documents');
        System.assertEquals(12, documents.get('count'), 'Sample count should pass through');

        Map<String, Object> latency = (Map<String, Object>) documents.get('latency');
        System.assertEquals(4200, latency.get('p50Ms'), 'Median latency should pass through');

        List<Object> stages = (List<Object>) result.get('stages');
        System.assertEquals(1, stages.size(), 'Stage list should pass through');
    }

    @isTest
    static void testGetPerformanceMetrics_Error() {
        Test.setMock(HttpCalloutMock.class, new ErrorMock());

        Boolean threw = false;

        Test.startTest();
        try {
            DocgenStatusController.getPerformanceMetrics();
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A non-200 backend response should surface as AuraHandledException');
    }

    @isTest
    static void testGetResourceMetrics() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/metrics/resources'));

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getResourceMetrics();
        Test.stopTest();

        System.assertEquals('replica-1', result.get('replicaId'), 'Replica must be identified');

        Map<String, Object> cpu = (Map<String, Object>) result.get('cpu');
        System.assertEquals('cgroup-v2', cpu.get('source'), 'CPU source should pass through');

        Map<String, Object> pool = (Map<String, Object>) result.get('libreOfficePool');
        System.assertEquals(8, pool.get('maxConcurrent'), 'Pool capacity should pass through');

        Map<String, Object> cache = (Map<String, Object>) result.get('templateCache');
        System.assertEquals(90, cache.get('hitRatePercent'), 'Cache hit rate should pass through');
    }

    @isTest
    static void testGetResourceMetrics_Error() {
        Test.setMock(HttpCalloutMock.class, new ErrorMock());

        Boolean threw = false;

        Test.startTest();
        try {
            DocgenStatusController.getResourceMetrics();
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A non-200 backend response should surface as AuraHandledException');
    }

    @isTest
    static void testGetUsageMetrics() {
        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getUsageMetrics();
        Test.stopTest();

        // 16 documents are created in @testSetup, all within the last 24 hours
        System.assertEquals(16, result.get('last24Hours'), 'Should count all documents from the last 24 hours');
        System.assertEquals(16, result.get('last7Days'), 'Should count all documents from the last 7 days');

        List<Object> hourly = (List<Object>) result.get('hourly');
        System.assertEquals(25, hourly.size(), 'Rolling 24 hours includes both partial clock-hour edges');

        Integer bucketTotal = 0;
        for (Object bucket : hourly) {
            bucketTotal += (Integer) ((Map<String, Object>) bucket).get('count');
        }
        System.assertEquals(16, bucketTotal, 'Hourly buckets should account for every document');

        System.assertNotEquals(null, result.get('peakHourLabel'), 'Peak hour should be identified');
        System.assertEquals(16, result.get('peakHourCount'), 'All test documents land in the same hour');

        List<Object> byFormat = (List<Object>) result.get('byFormat');
        System.assertEquals(1, byFormat.size(), 'Test data uses a single output format');
        System.assertEquals('PDF', ((Map<String, Object>) byFormat[0]).get('format'), 'Format should be PDF');
        System.assertEquals(16, ((Map<String, Object>) byFormat[0]).get('count'), 'All 16 documents are PDFs');

        List<Object> topTemplates = (List<Object>) result.get('topTemplates');
        System.assertEquals(1, topTemplates.size(), 'Test data uses a single template');
        System.assertEquals(16, ((Map<String, Object>) topTemplates[0]).get('count'), 'Template should account for all documents');
    }

    @isTest
    static void testGetUsageMetrics_NoDocuments() {
        delete [SELECT Id FROM Generated_Document__c];

        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getUsageMetrics();
        Test.stopTest();

        System.assertEquals(0, result.get('last24Hours'), 'Volume should be zero with no documents');
        System.assertEquals(0, result.get('peakHourCount'), 'Peak count should be zero with no documents');
        System.assertEquals(null, result.get('peakHourLabel'), 'Peak hour should be null with no documents');
        System.assertEquals(25, ((List<Object>) result.get('hourly')).size(), 'Buckets should include partial edge hours');
        System.assertEquals(0, ((List<Object>) result.get('byFormat')).size(), 'Format breakdown should be empty');
    }

    @isTest
    static void testCurrentBacklogIncludesOlderRequests() {
        List<Generated_Document__c> backlog = [
            SELECT Id FROM Generated_Document__c WHERE Status__c IN ('QUEUED', 'PROCESSING')
        ];
        for (Generated_Document__c doc : backlog) {
            Test.setCreatedDate(doc.Id, Datetime.now().addDays(-3));
        }
        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getQueueMetrics();
        Test.stopTest();
        System.assertEquals(13, result.get('total'), 'Window excludes old requests');
        System.assertEquals(0, result.get('queued'), 'Windowed queued count stays separate');
        System.assertEquals(3, result.get('queueDepth'), 'Live backlog includes old requests');
        System.assertEquals(2, result.get('currentQueued'));
        System.assertEquals(1, result.get('currentProcessing'));
    }

    @isTest
    static void testSuccessRateUnavailableWithoutCompletedDocuments() {
        delete [SELECT Id FROM Generated_Document__c WHERE Status__c IN ('SUCCEEDED', 'FAILED')];
        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getQueueMetrics();
        Test.stopTest();
        System.assertEquals(null, result.get('successRate'), 'No completed documents is not a zero success rate');
    }

    @isTest
    static void testUsageIncludesOldestPartialHour() {
        Generated_Document__c doc = [SELECT Id FROM Generated_Document__c LIMIT 1];
        Test.setCreatedDate(doc.Id, Datetime.now().addHours(-24).addMinutes(1));
        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getUsageMetrics();
        Test.stopTest();
        System.assertEquals(16, result.get('last24Hours'), 'Include the oldest partial hour');
        Integer bucketTotal = 0;
        for (Object bucket : (List<Object>) result.get('hourly')) {
            bucketTotal += (Integer) ((Map<String, Object>) bucket).get('count');
        }
        System.assertEquals(16, bucketTotal, 'Chart accounts for the whole window');
        Integer formatTotal = 0;
        for (Object entry : (List<Object>) result.get('byFormat')) {
            formatTotal += (Integer) ((Map<String, Object>) entry).get('count');
        }
        System.assertEquals(bucketTotal, formatTotal, 'Volume and format charts agree');
    }

    @isTest
    static void testGetFleetMetricsPreservesCoverage() {
        Test.setMock(HttpCalloutMock.class, new SuccessMock('/metrics/fleet'));
        Test.startTest();
        Map<String, Object> result = DocgenStatusController.getFleetMetrics();
        Test.stopTest();
        System.assertEquals('fleet', result.get('scope'));
        System.assertEquals(2, ((List<Object>) result.get('replicas')).size());
        System.assertEquals(false, ((Map<String, Object>) result.get('coverage')).get('complete'));
        System.assertEquals(null, ((Map<String, Object>) result.get('resources')).get('cpuPercent'));
    }

    @isTest
    static void testGetFleetMetricsError() {
        Test.setMock(HttpCalloutMock.class, new ErrorMock());
        Boolean threw = false;
        Test.startTest();
        try { DocgenStatusController.getFleetMetrics(); }
        catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assert(threw, 'Shared query failure must reach the UI instead of returning local metrics');
    }
}
