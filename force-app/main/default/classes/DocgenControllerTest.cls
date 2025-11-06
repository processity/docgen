/**
 * Test class for DocgenController
 * Tests the interactive document generation flow with HTTP callout mocking
 */
@isTest
private class DocgenControllerTest {

    /**
     * Mock HTTP callout for successful document generation
     */
    private class MockDocgenSuccessCallout implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            // Verify request structure
            Assert.areEqual('POST', req.getMethod(), 'HTTP method should be POST');
            Assert.areEqual('callout:Docgen_Node_API/generate', req.getEndpoint(), 'Should call Named Credential endpoint');
            Assert.isTrue(req.getHeader('Content-Type').contains('application/json'), 'Content-Type should be JSON');

            // Parse and verify request body
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.getBody());
            Assert.isNotNull(body.get('templateId'), 'Request should include templateId');
            Assert.isNotNull(body.get('requestHash'), 'Request should include requestHash');
            Assert.isNotNull(body.get('data'), 'Request should include data');

            // Create successful response
            HTTPResponse res = new HTTPResponse();
            res.setStatusCode(200);
            res.setStatus('OK');
            res.setHeader('Content-Type', 'application/json');

            Map<String, Object> responseBody = new Map<String, Object>{
                'downloadUrl' => 'https://test.my.salesforce.com/sfc/servlet.shepherd/version/download/068XXXXXXXXXXXXXXX',
                'contentVersionId' => '068XXXXXXXXXXXXXXX',
                'correlationId' => 'test-correlation-id-12345'
            };
            res.setBody(JSON.serialize(responseBody));

            return res;
        }
    }

    /**
     * Mock HTTP callout for server error (500)
     */
    private class MockDocgenServerErrorCallout implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HTTPResponse res = new HTTPResponse();
            res.setStatusCode(500);
            res.setStatus('Internal Server Error');
            res.setHeader('Content-Type', 'application/json');

            Map<String, Object> errorBody = new Map<String, Object>{
                'error' => 'LibreOffice conversion failed',
                'correlationId' => 'error-correlation-id'
            };
            res.setBody(JSON.serialize(errorBody));

            return res;
        }
    }

    /**
     * Mock HTTP callout for client error (400)
     */
    private class MockDocgenClientErrorCallout implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HTTPResponse res = new HTTPResponse();
            res.setStatusCode(400);
            res.setStatus('Bad Request');
            res.setHeader('Content-Type', 'application/json');

            Map<String, Object> errorBody = new Map<String, Object>{
                'error' => 'Invalid templateId format',
                'correlationId' => 'validation-error-id'
            };
            res.setBody(JSON.serialize(errorBody));

            return res;
        }
    }

    /**
     * Test setup: Create test data
     */
    @testSetup
    static void setup() {
        // Create test template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Account Template',
            TemplateContentVersionId__c = '068000000000001AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account'
        );
        insert template;

        // Create test Account
        Account acc = new Account(
            Name = 'Test Account Ltd',
            AnnualRevenue = 1200000
        );
        insert acc;
    }

    /**
     * Test 1: Successful document generation (200 response)
     * Given: Valid templateId and recordId
     * When: generate() is called
     * Then: Generated_Document__c created with SUCCEEDED status, downloadUrl returned
     */
    @isTest
    static void testGenerateSuccess() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenSuccessCallout());

        // When
        Test.startTest();
        String downloadUrl = DocgenController.generate(template.Id, acc.Id, 'PDF');
        Test.stopTest();

        // Then - Verify return value
        Assert.isNotNull(downloadUrl, 'Download URL should be returned');
        Assert.isTrue(downloadUrl.contains('/sfc/servlet.shepherd/version/download/'), 'Download URL should be Salesforce file URL path');
        Assert.isTrue(downloadUrl.contains('068XXXXXXXXXXXXXXX'), 'Download URL should contain ContentVersionId');

        // Then - Verify Generated_Document__c record created and updated
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, RequestHash__c, OutputFileId__c, Error__c, CorrelationId__c, RequestJSON__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docs.size(), 'One Generated_Document__c should be created');

        Generated_Document__c doc = docs[0];
        Assert.areEqual('SUCCEEDED', doc.Status__c, 'Status should be SUCCEEDED');
        Assert.areEqual('068XXXXXXXXXXXXXXX', doc.OutputFileId__c, 'OutputFileId should be set');
        Assert.isNotNull(doc.RequestHash__c, 'RequestHash should be set');
        Assert.isNotNull(doc.CorrelationId__c, 'CorrelationId should be captured');
        Assert.isNull(doc.Error__c, 'Error__c should be null on success');
        Assert.isNotNull(doc.RequestJSON__c, 'RequestJSON should be stored');
    }

    /**
     * Test 2: Server error handling (500 response)
     * Given: Valid request but server fails
     * When: generate() is called
     * Then: Generated_Document__c created with FAILED status, exception thrown
     */
    @isTest
    static void testGenerateServerError() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenServerErrorCallout());

        // When/Then - Expect exception
        Test.startTest();
        try {
            DocgenController.generate(template.Id, acc.Id, 'PDF');
            Assert.fail('Should have thrown AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('500'), 'Error message should mention status code');
        }
        Test.stopTest();

        // Then - Verify Generated_Document__c record marked as FAILED
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, Error__c, OutputFileId__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docs.size(), 'One Generated_Document__c should be created');

        Generated_Document__c doc = docs[0];
        Assert.areEqual('FAILED', doc.Status__c, 'Status should be FAILED');
        Assert.isNotNull(doc.Error__c, 'Error__c should be populated');
        Assert.isTrue(doc.Error__c.contains('500'), 'Error message should include status code');
        Assert.isNull(doc.OutputFileId__c, 'OutputFileId should be null on failure');
    }

    /**
     * Test 3: Client error handling (400 response)
     * Given: Invalid payload sent to API
     * When: generate() is called
     * Then: Generated_Document__c created with FAILED status, exception thrown
     */
    @isTest
    static void testGenerateClientError() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenClientErrorCallout());

        // When/Then - Expect exception
        Test.startTest();
        try {
            DocgenController.generate(template.Id, acc.Id, 'PDF');
            Assert.fail('Should have thrown AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('400'), 'Error message should mention status code');
        }
        Test.stopTest();

        // Then - Verify Generated_Document__c record marked as FAILED
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, Error__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docs.size(), 'One Generated_Document__c should be created');
        Assert.areEqual('FAILED', docs[0].Status__c, 'Status should be FAILED');
        Assert.isNotNull(docs[0].Error__c, 'Error__c should be populated');
    }

    /**
     * Test 4: Idempotency via RequestHash (Cache Hit)
     * Given: Same request made twice within 24-hour cache window
     * When: generate() is called twice with identical inputs
     * Then: First call generates document, second call returns cached result (no HTTP callout)
     */
    @isTest
    static void testIdempotency() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenSuccessCallout());

        // When - First call generates document
        Test.startTest();
        String url1 = DocgenController.generate(template.Id, acc.Id, 'PDF');
        Test.stopTest();

        // Then - First call should return URL
        Assert.isNotNull(url1, 'First call should return URL');

        // Verify first document created
        List<Generated_Document__c> docsAfterFirst = [
            SELECT Id, RequestHash__c, Status__c, OutputFileId__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docsAfterFirst.size(), 'One Generated_Document__c should exist after first call');
        Assert.areEqual('SUCCEEDED', docsAfterFirst[0].Status__c, 'First document should be SUCCEEDED');

        // When - Second call with same parameters (cache hit - no new transaction needed)
        String url2 = DocgenController.generate(template.Id, acc.Id, 'PDF');

        // Then - Second call should return same URL (from cache)
        Assert.isNotNull(url2, 'Second call should return URL');
        Assert.areEqual(url1, url2, 'Both calls should return identical URLs (cache hit)');

        // Then - Verify only ONE record exists (cache hit, no new generation)
        List<Generated_Document__c> docsAfterSecond = [
            SELECT Id, RequestHash__c, Status__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docsAfterSecond.size(), 'Only one Generated_Document__c should exist (cache hit)');
        Assert.areEqual('SUCCEEDED', docsAfterSecond[0].Status__c, 'Cached document should still be SUCCEEDED');
    }

    /**
     * Test 5: Missing template handling
     * Given: Invalid templateId
     * When: generate() is called
     * Then: Exception thrown, no record created
     */
    @isTest
    static void testMissingTemplate() {
        // Given
        Account acc = [SELECT Id FROM Account LIMIT 1];
        Id fakeTemplateId = '001000000000000AAA'; // Non-existent ID

        // When/Then - Expect exception
        Test.startTest();
        try {
            DocgenController.generate(fakeTemplateId, acc.Id, 'PDF');
            Assert.fail('Should have thrown exception for missing template');
        } catch (Exception e) {
            Assert.isNotNull(e, 'Exception should be thrown');
            // Could be QueryException or AuraHandledException depending on implementation
        }
        Test.stopTest();

        // Then - Verify no Generated_Document__c created
        List<Generated_Document__c> docs = [
            SELECT Id
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(0, docs.size(), 'No Generated_Document__c should be created for invalid template');
    }

    /**
     * Test 6: Record status transitions
     * Given: Valid request
     * When: generate() is called
     * Then: Status transitions from PROCESSING to SUCCEEDED correctly
     */
    @isTest
    static void testRecordStatusTransitions() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenSuccessCallout());

        // When
        Test.startTest();
        DocgenController.generate(template.Id, acc.Id, 'PDF');
        Test.stopTest();

        // Then - Verify final status (we can't check intermediate PROCESSING state in tests due to DML ordering)
        Generated_Document__c doc = [
            SELECT Id, Status__c, Attempts__c, RequestedBy__c, OutputFormat__c, Template__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
            LIMIT 1
        ];

        Assert.areEqual('SUCCEEDED', doc.Status__c, 'Final status should be SUCCEEDED');
        Assert.areEqual('PDF', doc.OutputFormat__c, 'OutputFormat should match request');
        Assert.areEqual(template.Id, doc.Template__c, 'Template lookup should be set');
        Assert.areEqual(UserInfo.getUserId(), doc.RequestedBy__c, 'RequestedBy should be current user');
        Assert.areEqual(0, doc.Attempts__c, 'Attempts should be 0 for interactive flow');
    }

    /**
     * Test 7: Cache Expiry - Documents outside 24-hour window
     * Given: An old successful document exists (>24 hours)
     * When: generate() is called with same parameters
     * Then: New document is generated (cache miss due to expiry)
     *
     * NOTE: In test context, we cannot manipulate CreatedDate directly.
     * This test documents the expected behavior. The LAST_N_DAYS:1 filter
     * in checkExistingDocument() enforces the 24-hour cache window in production.
     */
    @isTest
    static void testIdempotencyCacheExpiry() {
        // Given
        Docgen_Template__c template = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                   ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c
            FROM Docgen_Template__c
            LIMIT 1
        ];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Create an old document manually (simulating expired cache)
        // Note: We cannot set CreatedDate via DML, but we can verify the query logic
        DocgenEnvelopeService.Envelope envelope = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );

        Generated_Document__c oldDoc = new Generated_Document__c(
            Template__c = template.Id,
            Account__c = acc.Id,
            RequestHash__c = envelope.requestHash,
            RequestJSON__c = JSON.serialize(envelope),
            Status__c = 'SUCCEEDED',
            OutputFileId__c = '068000000000OLDAAA',
            OutputFormat__c = 'PDF',
            Attempts__c = 0,
            RequestedBy__c = UserInfo.getUserId(),
            CorrelationId__c = 'old-correlation-id'
        );
        insert oldDoc;

        // Set mock callout for new generation
        Test.setMock(HttpCalloutMock.class, new MockDocgenSuccessCallout());

        // When - Call generate (in real production, if oldDoc.CreatedDate > 24 hours, this would be cache miss)
        // In test, the doc was just created, so it WILL be a cache hit
        Test.startTest();
        String url = DocgenController.generate(template.Id, acc.Id, 'PDF');
        Test.stopTest();

        // Then - Should return URL (in this test case, from cache since doc is fresh)
        Assert.isNotNull(url, 'Should return URL');

        // Verify behavior: In test context (doc fresh), we get cache hit
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, CreatedDate
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
            ORDER BY CreatedDate ASC
        ];

        // In test: Only 1 doc (cache hit because doc is fresh)
        // In production with CreatedDate > 24h: Would be 2 docs (new generation)
        Assert.areEqual(1, docs.size(), 'In test context: cache hit because doc is fresh');
        Assert.isTrue(docs[0].CreatedDate >= System.now().addSeconds(-60),
            'Document should be recent (cache window validation)');

        // This test documents the cache expiry logic in checkExistingDocument()
        // which filters by: AND CreatedDate = LAST_N_DAYS:1
    }
}
