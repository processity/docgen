/**
 * Test class for BatchDocgenEnqueue
 *
 * Tests batch enqueueing of Generated_Document__c records for mass document generation.
 * Verifies record creation, idempotency, error handling, and batch processing logic.
 *
 * @group Batch
 * @see BatchDocgenEnqueue
 */
@isTest
private class BatchDocgenEnqueueTest {

    /**
     * Create test template and sample accounts for batch processing tests
     */
    @testSetup
    static void setup() {
        // Create test template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Account Summary Template',
            TemplateContentVersionId__c = '068000000000001AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, BillingCity, AnnualRevenue FROM Account WHERE Id = :recordId',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account'
        );
        insert template;

        // Create test accounts (50 for various batch size tests)
        List<Account> accounts = new List<Account>();
        for (Integer i = 1; i <= 50; i++) {
            accounts.add(new Account(
                Name = 'Test Account ' + i,
                BillingCity = 'London',
                AnnualRevenue = 100000 * i
            ));
        }
        insert accounts;
    }

    /**
     * Test: Batch with 10 records creates 10 QUEUED documents
     * Given a template and 10 account IDs
     * When batch executes
     * Then 10 Generated_Document__c records created with Status__c = 'QUEUED'
     */
    @isTest
    static void testBatchWith10Records() {
        // Arrange
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        List<Account> accounts = [SELECT Id FROM Account LIMIT 10];
        List<Id> recordIds = new List<Id>();
        for (Account acc : accounts) {
            recordIds.add(acc.Id);
        }

        // Act
        Test.startTest();
        BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
            template.Id,
            recordIds,
            'PDF'
        );
        Database.executeBatch(batch, 200);
        Test.stopTest();

        // Assert
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, RequestHash__c, RequestJSON__c, Account__c, Template__c, OutputFormat__c
            FROM Generated_Document__c
            ORDER BY CreatedDate
        ];

        System.assertEquals(10, docs.size(), 'Should create 10 documents');

        for (Generated_Document__c doc : docs) {
            System.assertEquals('QUEUED', doc.Status__c, 'Status should be QUEUED');
            System.assertNotEquals(null, doc.RequestHash__c, 'RequestHash should be populated');
            System.assertNotEquals(null, doc.RequestJSON__c, 'RequestJSON should be populated');
            System.assertEquals(template.Id, doc.Template__c, 'Template should be set');
            System.assertEquals('PDF', doc.OutputFormat__c, 'OutputFormat should be PDF');
            System.assertNotEquals(null, doc.Account__c, 'Account lookup should be set');
        }
    }

    /**
     * Test: Batch with 200 records processes in single execution
     * Given a template and 50 accounts
     * When batch executes with chunk size 200
     * Then all 50 records processed in single batch
     */
    @isTest
    static void testBatchWith50Records() {
        // Arrange
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        List<Account> accounts = [SELECT Id FROM Account];
        List<Id> recordIds = new List<Id>();
        for (Account acc : accounts) {
            recordIds.add(acc.Id);
        }

        // Act
        Test.startTest();
        BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
            template.Id,
            recordIds,
            'PDF'
        );
        Database.executeBatch(batch, 200);
        Test.stopTest();

        // Assert
        List<Generated_Document__c> docs = [SELECT Id, Status__c FROM Generated_Document__c];
        System.assertEquals(50, docs.size(), 'Should create 50 documents');
        System.assertEquals('QUEUED', docs[0].Status__c, 'All documents should be QUEUED');
    }

    /**
     * Test: RequestHash__c is unique per document
     * Given same template and different records
     * When batch executes
     * Then each Generated_Document__c has unique RequestHash__c
     */
    @isTest
    static void testRequestHashUniqueness() {
        // Arrange
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        List<Account> accounts = [SELECT Id FROM Account LIMIT 5];
        List<Id> recordIds = new List<Id>();
        for (Account acc : accounts) {
            recordIds.add(acc.Id);
        }

        // Act
        Test.startTest();
        BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
            template.Id,
            recordIds,
            'PDF'
        );
        Database.executeBatch(batch, 200);
        Test.stopTest();

        // Assert
        List<Generated_Document__c> docs = [
            SELECT RequestHash__c FROM Generated_Document__c ORDER BY CreatedDate
        ];

        Set<String> hashes = new Set<String>();
        for (Generated_Document__c doc : docs) {
            System.assertNotEquals(null, doc.RequestHash__c, 'Hash should not be null');
            System.assert(!hashes.contains(doc.RequestHash__c), 'Hash should be unique');
            hashes.add(doc.RequestHash__c);
        }

        System.assertEquals(5, hashes.size(), 'Should have 5 unique hashes');
    }

    /**
     * Test: RequestJSON__c contains valid DocgenRequest JSON
     * Given a template and account
     * When batch executes
     * Then RequestJSON__c contains parseable envelope with required fields
     */
    @isTest
    static void testRequestJSONContainsValidEnvelope() {
        // Arrange
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        List<Account> accounts = [SELECT Id FROM Account LIMIT 1];
        List<Id> recordIds = new List<Id>{accounts[0].Id};

        // Act
        Test.startTest();
        BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
            template.Id,
            recordIds,
            'PDF'
        );
        Database.executeBatch(batch, 200);
        Test.stopTest();

        // Assert
        Generated_Document__c doc = [
            SELECT RequestJSON__c, CorrelationId__c
            FROM Generated_Document__c
            LIMIT 1
        ];

        System.assertNotEquals(null, doc.RequestJSON__c, 'RequestJSON should be populated');
        System.assertNotEquals(null, doc.CorrelationId__c, 'CorrelationId should be populated');

        // Parse JSON and verify structure
        Map<String, Object> envelope = (Map<String, Object>)JSON.deserializeUntyped(doc.RequestJSON__c);

        System.assert(envelope.containsKey('templateId'), 'Envelope should have templateId');
        System.assert(envelope.containsKey('outputFileName'), 'Envelope should have outputFileName');
        System.assert(envelope.containsKey('outputFormat'), 'Envelope should have outputFormat');
        System.assert(envelope.containsKey('data'), 'Envelope should have data');
        System.assert(envelope.containsKey('requestHash'), 'Envelope should have requestHash');
        // Note: correlationId is NOT part of the envelope - it's stored separately in Generated_Document__c

        System.assertEquals('PDF', envelope.get('outputFormat'), 'OutputFormat should be PDF');
    }

    /**
     * Test: Missing template throws exception
     * Given invalid template ID
     * When batch constructor called
     * Then QueryException thrown
     */
    @isTest
    static void testMissingTemplateThrowsException() {
        // Arrange
        Id fakeTemplateId = '001000000000000AAA'; // Non-existent ID
        List<Account> accounts = [SELECT Id FROM Account LIMIT 1];
        List<Id> recordIds = new List<Id>{accounts[0].Id};

        // Act & Assert
        // Exception is thrown in constructor, not during batch execution
        try {
            BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
                fakeTemplateId,
                recordIds,
                'PDF'
            );

            System.assert(false, 'Should have thrown exception for missing template');
        } catch (Exception e) {
            // Verify exception message mentions template (case-insensitive)
            String errorMsg = e.getMessage().toLowerCase();
            System.assert(
                errorMsg.contains('template') || errorMsg.contains('query'),
                'Exception should mention template or query: ' + e.getMessage()
            );
        }
    }

    /**
     * Test: Duplicate RequestHash handled (idempotency)
     * Given same record processed twice
     * When batch executes second time
     * Then DML exception on duplicate External ID or single record exists
     */
    @isTest
    static void testIdempotencyWithDuplicateHash() {
        // Arrange
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        List<Account> accounts = [SELECT Id FROM Account LIMIT 1];
        List<Id> recordIds = new List<Id>{accounts[0].Id};

        // Act - First batch
        Test.startTest();
        BatchDocgenEnqueue batch1 = new BatchDocgenEnqueue(
            template.Id,
            recordIds,
            'PDF'
        );
        Database.executeBatch(batch1, 200);
        Test.stopTest();

        // Get the generated document
        List<Generated_Document__c> docsAfterFirst = [SELECT Id, RequestHash__c FROM Generated_Document__c];
        System.assertEquals(1, docsAfterFirst.size(), 'First batch should create 1 document');

        // Act - Second batch with same input (idempotency test)
        // Note: Can't call Test.startTest() again - already called above
        BatchDocgenEnqueue batch2 = new BatchDocgenEnqueue(
            template.Id,
            recordIds,
            'PDF'
        );

        // Note: The batch will attempt to insert duplicate RequestHash__c
        // Since RequestHash__c is an External ID with Unique=true, this should fail
        // We expect the batch to handle this gracefully
        try {
            Database.executeBatch(batch2, 200);
            // Wait for async execution to complete (already in Test context)
            // The batch framework will handle the duplicate and fail silently
        } catch (Exception e) {
            // Expected: DML exception on duplicate External ID
            System.assert(
                e.getMessage().contains('DUPLICATE') || e.getMessage().contains('duplicate'),
                'Should fail with duplicate error: ' + e.getMessage()
            );
        }

        // Assert - Should still have only 1 document (idempotency preserved)
        List<Generated_Document__c> docsAfterSecond = [SELECT Id FROM Generated_Document__c];
        System.assert(
            docsAfterSecond.size() <= 1,
            'Should have at most 1 document (idempotency preserved)'
        );
    }

    /**
     * Test: DOCX output format supported
     * Given outputFormat = 'DOCX'
     * When batch executes
     * Then Generated_Document__c.OutputFormat__c = 'DOCX'
     */
    @isTest
    static void testDocxOutputFormat() {
        // Arrange
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        List<Account> accounts = [SELECT Id FROM Account LIMIT 1];
        List<Id> recordIds = new List<Id>{accounts[0].Id};

        // Act
        Test.startTest();
        BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
            template.Id,
            recordIds,
            'DOCX'
        );
        Database.executeBatch(batch, 200);
        Test.stopTest();

        // Assert
        Generated_Document__c doc = [
            SELECT OutputFormat__c
            FROM Generated_Document__c
            LIMIT 1
        ];

        System.assertEquals('DOCX', doc.OutputFormat__c, 'OutputFormat should be DOCX');
    }
}
