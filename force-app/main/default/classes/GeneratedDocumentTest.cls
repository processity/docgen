/**
 * Test class for Generated_Document__c custom object.
 *
 * Tests verify:
 * - Record CRUD operations
 * - RequestHash External ID uniqueness
 * - Default values (Attempts__c = 0)
 * - Status workflow
 * - Parent lookups
 * - Lock semantics
 */
@isTest
private class GeneratedDocumentTest {

    /**
     * Create a test template for use in tests
     * Required because validation rule requires either Template__c or Composite_Document__c
     */
    private static Id createTestTemplate() {
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '0681e000000000AAA',
            DataSource__c = 'SOQL',
            ReturnMultipleRecords__c = false
        );
        insert template;
        return template.Id;
    }

    /**
     * Test: Insert minimal valid Generated_Document__c record
     * Given: Generated_Document__c object definition
     * When: Insert minimal valid record
     * Then: Record persists with default values
     */
    @isTest
    static void testInsertMinimalDocument() {
        // Given: Generated_Document__c object definition
        Id templateId = createTestTemplate();

        // When: Insert minimal record
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:abc123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data"}'
        );

        Test.startTest();
        insert doc;
        Test.stopTest();

        // Then: Record persists with defaults
        Generated_Document__c inserted = [
            SELECT Id, RequestHash__c, Status__c, OutputFormat__c,
                   Attempts__c, RequestJSON__c
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];

        Assert.isNotNull(inserted.Id, 'Document ID should not be null');
        Assert.areEqual('sha256:abc123', inserted.RequestHash__c);
        Assert.areEqual('QUEUED', inserted.Status__c);
        Assert.areEqual('PDF', inserted.OutputFormat__c);
        Assert.areEqual(0, inserted.Attempts__c, 'Attempts should default to 0');
    }

    /**
     * Test: RequestHash External ID uniqueness via upsert
     * Given: Existing record with RequestHash
     * When: Upsert with same RequestHash
     * Then: Single record updated (not duplicated)
     */
    @isTest
    static void testRequestHashUniqueness() {
        // Given: Existing record
        Id templateId = createTestTemplate();
        String hash = 'sha256:unique123';
        Generated_Document__c doc1 = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = hash,
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data1"}'
        );
        insert doc1;

        // When: Upsert with same RequestHash
        Generated_Document__c doc2 = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = hash,
            Status__c = 'SUCCEEDED',
            OutputFileId__c = '0681e000000000AAA'
        );

        Test.startTest();
        Database.UpsertResult result = Database.upsert(doc2, Generated_Document__c.RequestHash__c);
        Test.stopTest();

        // Then: Single record updated
        Assert.isTrue(result.isSuccess(), 'Upsert should succeed');
        Assert.isFalse(result.isCreated(), 'Should be update, not insert');

        List<Generated_Document__c> docs = [
            SELECT Id, RequestHash__c, Status__c, OutputFileId__c
            FROM Generated_Document__c
            WHERE RequestHash__c = :hash
        ];

        Assert.areEqual(1, docs.size(), 'Should have exactly one record');
        Assert.areEqual('SUCCEEDED', docs[0].Status__c, 'Status should be updated');
        Assert.areEqual('0681e000000000AAA', docs[0].OutputFileId__c);
    }

    /**
     * Test: Insert document with all parent lookups
     * Given: Account, Opportunity, and Case records
     * When: Insert Generated_Document__c with all parent IDs
     * Then: All parent lookups persist correctly
     */
    @isTest
    static void testParentLookups() {
        // Given: Parent records
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Opportunity opp = new Opportunity(
            Name = 'Test Opportunity',
            AccountId = acc.Id,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30)
        );
        insert opp;

        Case c = new Case(
            Subject = 'Test Case',
            AccountId = acc.Id
        );
        insert c;

        // When: Insert document with all parents
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:parents123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data"}',
            Account__c = acc.Id,
            Opportunity__c = opp.Id,
            Case__c = c.Id
        );

        Test.startTest();
        insert doc;
        Test.stopTest();

        // Then: All parent lookups persist
        Generated_Document__c inserted = [
            SELECT Account__c, Opportunity__c, Case__c
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];

        Assert.areEqual(acc.Id, inserted.Account__c, 'Account__c should match');
        Assert.areEqual(opp.Id, inserted.Opportunity__c, 'Opportunity__c should match');
        Assert.areEqual(c.Id, inserted.Case__c, 'Case__c should match');
    }

    /**
     * Test: Status workflow transitions
     * Given: Document in QUEUED status
     * When: Update through status workflow
     * Then: Status transitions persist correctly
     */
    @isTest
    static void testStatusWorkflow() {
        // Given: Document in QUEUED status
        Id templateId = createTestTemplate();
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:workflow123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data"}'
        );
        insert doc;

        // When: Transition QUEUED -> PROCESSING -> SUCCEEDED
        doc.Status__c = 'PROCESSING';
        doc.LockedUntil__c = Datetime.now().addMinutes(2);
        update doc;

        Generated_Document__c processing = [
            SELECT Status__c, LockedUntil__c
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];
        Assert.areEqual('PROCESSING', processing.Status__c);
        Assert.isNotNull(processing.LockedUntil__c, 'LockedUntil should be set');

        doc.Status__c = 'SUCCEEDED';
        doc.OutputFileId__c = '0681e000000000BBB';
        update doc;

        Test.startTest();
        Generated_Document__c succeeded = [
            SELECT Status__c, OutputFileId__c
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];
        Test.stopTest();

        // Then: Final status persists
        Assert.areEqual('SUCCEEDED', succeeded.Status__c);
        Assert.areEqual('0681e000000000BBB', succeeded.OutputFileId__c);
    }

    /**
     * Test: Retry logic with Attempts counter
     * Given: Document that fails
     * When: Increment Attempts on each failure
     * Then: Attempts counter increments correctly
     */
    @isTest
    static void testRetryAttempts() {
        // Given: Failed document
        Id templateId = createTestTemplate();
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:retry123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data"}',
            Attempts__c = 0
        );
        insert doc;

        // When: Simulate retries
        for (Integer i = 1; i <= 3; i++) {
            doc.Attempts__c = i;
            doc.Error__c = 'Attempt ' + i + ' failed';
            update doc;

            Generated_Document__c current = [
                SELECT Attempts__c, Error__c
                FROM Generated_Document__c
                WHERE Id = :doc.Id
            ];
            Assert.areEqual(i, current.Attempts__c, 'Attempts should be ' + i);
        }

        Test.startTest();
        // Then: After 3 attempts, mark as FAILED
        doc.Status__c = 'FAILED';
        update doc;
        Test.stopTest();

        Generated_Document__c failed = [
            SELECT Status__c, Attempts__c
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];

        Assert.areEqual('FAILED', failed.Status__c);
        Assert.areEqual(3, failed.Attempts__c, 'Should have 3 attempts');
    }

    /**
     * Test: CorrelationId for tracing
     * Given: Document with CorrelationId
     * When: Insert and query
     * Then: CorrelationId persists for observability
     */
    @isTest
    static void testCorrelationId() {
        // Given: Document with CorrelationId (UUID format, 36 chars)
        Id templateId = createTestTemplate();
        String corrId = '123e4567-e89b-12d3-a456-426614174000';
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:corr123',
            Status__c = 'PROCESSING',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data"}',
            CorrelationId__c = corrId
        );

        Test.startTest();
        insert doc;
        Test.stopTest();

        // Then: CorrelationId persists
        Generated_Document__c inserted = [
            SELECT CorrelationId__c
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];

        Assert.areEqual(corrId, inserted.CorrelationId__c,
                       'CorrelationId should match for tracing');
    }

    /**
     * Test: Lock semantics with LockedUntil
     * Given: Document locked by poller
     * When: Check lock expiry
     * Then: LockedUntil datetime persists correctly
     */
    @isTest
    static void testLockSemantics() {
        // Given: Document to be locked
        Id templateId = createTestTemplate();
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:lock123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data"}'
        );
        insert doc;

        // When: Poller locks the document (2 minute TTL)
        Datetime lockExpiry = Datetime.now().addMinutes(2);
        doc.Status__c = 'PROCESSING';
        doc.LockedUntil__c = lockExpiry;

        Test.startTest();
        update doc;
        Test.stopTest();

        // Then: Lock timestamp persists
        Generated_Document__c locked = [
            SELECT Status__c, LockedUntil__c
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];

        Assert.areEqual('PROCESSING', locked.Status__c);
        Assert.isNotNull(locked.LockedUntil__c, 'LockedUntil should be set');
        Assert.isTrue(locked.LockedUntil__c > Datetime.now(),
                     'Lock should not be expired yet');
    }

    /**
     * Test: Query documents by Status for poller
     * Given: Multiple documents with different statuses
     * When: Query QUEUED documents
     * Then: Only QUEUED documents returned
     */
    @isTest
    static void testQueryByStatus() {
        // Given: Documents with different statuses
        Id templateId = createTestTemplate();
        List<Generated_Document__c> docs = new List<Generated_Document__c>();

        for (Integer i = 0; i < 10; i++) {
            String status = (i < 5) ? 'QUEUED' : 'PROCESSING';
            docs.add(new Generated_Document__c(
                Template__c = templateId,
                RequestHash__c = 'sha256:status' + i,
                Status__c = status,
                OutputFormat__c = 'PDF',
                RequestJSON__c = '{"test": "data' + i + '"}'
            ));
        }

        Test.startTest();
        insert docs;
        Test.stopTest();

        // When/Then: Query QUEUED documents
        List<Generated_Document__c> queued = [
            SELECT Id, Status__c
            FROM Generated_Document__c
            WHERE Status__c = 'QUEUED'
        ];

        Assert.areEqual(5, queued.size(), 'Should have 5 QUEUED documents');

        for (Generated_Document__c doc : queued) {
            Assert.areEqual('QUEUED', doc.Status__c);
        }
    }

    /**
     * Test: Template lookup relationship
     * Given: Docgen_Template__c record
     * When: Create Generated_Document__c with Template lookup
     * Then: Lookup persists correctly
     */
    @isTest
    static void testTemplateLookup() {
        // Given: Template record
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '0681e000000000AAA',
            DataSource__c = 'SOQL',
            ReturnMultipleRecords__c = false
        );
        insert template;

        // When: Create document with template lookup
        Generated_Document__c doc = new Generated_Document__c(
            RequestHash__c = 'sha256:template123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = '{"test": "data"}',
            Template__c = template.Id
        );

        Test.startTest();
        insert doc;
        Test.stopTest();

        // Then: Lookup persists
        Generated_Document__c inserted = [
            SELECT Template__c, Template__r.Name
            FROM Generated_Document__c
            WHERE Id = :doc.Id
        ];

        Assert.areEqual(template.Id, inserted.Template__c, 'Template lookup should match');
        Assert.areEqual('Test Template', inserted.Template__r.Name,
                       'Should traverse lookup relationship');
    }
}
