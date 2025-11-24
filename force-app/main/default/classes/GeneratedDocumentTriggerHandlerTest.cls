/**
 * Test class for GeneratedDocumentTriggerHandler and GeneratedDocumentTrigger.
 * Tests that the trigger correctly identifies when to create ContentDocumentLinks.
 */
@isTest
private class GeneratedDocumentTriggerHandlerTest {

    /**
     * Create a test template for use in tests
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
     * Create test ContentVersion with ContentDocument
     */
    private static ContentVersion createTestContentVersion(String title) {
        ContentVersion cv = new ContentVersion();
        cv.Title = title;
        cv.PathOnClient = title + '.pdf';
        cv.VersionData = Blob.valueOf('Test PDF Content');
        cv.IsMajorVersion = true;
        insert cv;

        cv = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];
        return cv;
    }

    /**
     * Test: Trigger fires when Status changes to SUCCEEDED
     */
    @isTest
    static void testTriggerFiresOnStatusSucceeded() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Test Document');

        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:trigger123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = requestJSON
        );
        insert doc;

        // Update with file and status to SUCCEEDED
        Test.startTest();
        doc.Status__c = 'SUCCEEDED';
        doc.OutputFileId__c = cv.Id;
        update doc;
        Test.stopTest();

        // Verify: ContentDocumentLink created by trigger
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(1, links.size(), 'Trigger should create ContentDocumentLink');
    }

    /**
     * Test: Trigger does not fire when Status is not SUCCEEDED
     */
    @isTest
    static void testTriggerDoesNotFireForOtherStatuses() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Test Document');

        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:nostatus123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = requestJSON
        );
        insert doc;

        // Update to PROCESSING (not SUCCEEDED)
        Test.startTest();
        doc.Status__c = 'PROCESSING';
        doc.OutputFileId__c = cv.Id;
        update doc;
        Test.stopTest();

        // Verify: No ContentDocumentLink created for our test account
        List<ContentDocumentLink> links = [
            SELECT Id FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(0, links.size(), 'Trigger should not fire for PROCESSING status');
    }

    /**
     * Test: Trigger does not fire when OutputFileId is not populated
     */
    @isTest
    static void testTriggerDoesNotFireWithoutFile() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:nofile123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = requestJSON
        );
        insert doc;

        // Update status to SUCCEEDED without file
        Test.startTest();
        doc.Status__c = 'SUCCEEDED';
        update doc;
        Test.stopTest();

        // Verify: No ContentDocumentLink created (no file to link)
        // Query any links to the Account
        List<ContentDocumentLink> links = [
            SELECT Id FROM ContentDocumentLink
            WHERE LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(0, links.size(), 'Trigger should not create links without file');
    }

    /**
     * Test: Trigger handles bulk updates
     */
    @isTest
    static void testTriggerBulkUpdate() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        List<Account> accounts = new List<Account>();
        List<Generated_Document__c> docs = new List<Generated_Document__c>();

        for (Integer i = 0; i < 50; i++) {
            accounts.add(new Account(Name = 'Test Account ' + i));
        }
        insert accounts;

        for (Integer i = 0; i < 50; i++) {
            String requestJSON = '{"parents": {"AccountId": "' + accounts[i].Id + '"}}';

            Generated_Document__c doc = new Generated_Document__c(
                Template__c = templateId,
                RequestHash__c = 'sha256:bulk' + i,
                Status__c = 'QUEUED',
                OutputFormat__c = 'PDF',
                RequestJSON__c = requestJSON
            );
            docs.add(doc);
        }
        insert docs;

        // Create ContentVersions and update all documents at once
        List<ContentVersion> cvs = new List<ContentVersion>();
        for (Integer i = 0; i < 50; i++) {
            cvs.add(createTestContentVersion('Bulk Document ' + i));
        }

        Test.startTest();
        for (Integer i = 0; i < 50; i++) {
            docs[i].Status__c = 'SUCCEEDED';
            docs[i].OutputFileId__c = cvs[i].Id;
        }
        update docs;
        Test.stopTest();

        // Verify: All links created - need to query by ContentDocumentId due to restrictions
        // First get all ContentDocumentIds
        Set<Id> contentDocIds = new Set<Id>();
        for (ContentVersion cv : cvs) {
            contentDocIds.add(cv.ContentDocumentId);
        }

        // Now query links filtered by ContentDocumentIds
        List<ContentDocumentLink> allLinks = [
            SELECT Id, LinkedEntityId, ContentDocumentId FROM ContentDocumentLink
            WHERE ContentDocumentId IN :contentDocIds
        ];

        // Count unique accounts that have links (filter to only our test accounts)
        Set<Id> accountsWithLinks = new Set<Id>();
        Set<Id> accountIdSet = new Set<Id>();
        for (Account acc : accounts) {
            accountIdSet.add(acc.Id);
        }

        for (ContentDocumentLink link : allLinks) {
            if (accountIdSet.contains(link.LinkedEntityId)) {
                accountsWithLinks.add(link.LinkedEntityId);
            }
        }

        Assert.areEqual(50, accountsWithLinks.size(), 'Trigger should handle bulk updates');
    }

    /**
     * Test: Trigger only fires once per status change
     */
    @isTest
    static void testTriggerOnlyFiresOncePerStatusChange() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Test Document');

        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:once123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = requestJSON
        );
        insert doc;

        // First update to SUCCEEDED
        doc.Status__c = 'SUCCEEDED';
        doc.OutputFileId__c = cv.Id;
        update doc;

        // Count links after first update
        List<ContentDocumentLink> linksAfterFirst = [
            SELECT Id FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];
        Integer countAfterFirst = linksAfterFirst.size();

        Test.startTest();
        // Second update while already SUCCEEDED
        doc.Error__c = 'Some error that was cleared';
        update doc;
        Test.stopTest();

        // Verify: No additional links created
        List<ContentDocumentLink> linksAfterSecond = [
            SELECT Id FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(countAfterFirst, linksAfterSecond.size(),
                       'Should not create duplicate links on subsequent updates');
        Assert.areEqual(1, linksAfterSecond.size(), 'Should have exactly one link');
    }

    /**
     * Test: Trigger handles DOCX file links
     */
    @isTest
    static void testTriggerHandlesDocxFile() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion pdfVersion = createTestContentVersion('PDF Document');
        ContentVersion docxVersion = createTestContentVersion('DOCX Document');

        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:docx123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = requestJSON
        );
        insert doc;

        // Update with both PDF and DOCX files
        Test.startTest();
        doc.Status__c = 'SUCCEEDED';
        doc.OutputFileId__c = pdfVersion.Id;
        doc.MergedDocxFileId__c = docxVersion.Id;
        update doc;
        Test.stopTest();

        // Verify: Links created for both files
        List<ContentDocumentLink> pdfLinks = [
            SELECT Id FROM ContentDocumentLink
            WHERE ContentDocumentId = :pdfVersion.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        List<ContentDocumentLink> docxLinks = [
            SELECT Id FROM ContentDocumentLink
            WHERE ContentDocumentId = :docxVersion.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(1, pdfLinks.size(), 'Trigger should create link for PDF');
        Assert.areEqual(1, docxLinks.size(), 'Trigger should create link for DOCX');
    }

    /**
     * Test: Trigger handles multiple parent types
     */
    @isTest
    static void testTriggerHandlesMultipleParentTypes() {
        // Setup: Create test data
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

        ContentVersion cv = createTestContentVersion('Multi Parent Document');

        String requestJSON = '{"parents": {' +
            '"AccountId": "' + acc.Id + '",' +
            '"OpportunityId": "' + opp.Id + '",' +
            '"CaseId": "' + c.Id + '"' +
            '}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:multiparent123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = requestJSON
        );
        insert doc;

        Test.startTest();
        doc.Status__c = 'SUCCEEDED';
        doc.OutputFileId__c = cv.Id;
        update doc;
        Test.stopTest();

        // Verify: Links created for all parent types
        Set<Id> parentIds = new Set<Id>{acc.Id, opp.Id, c.Id};
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId IN :parentIds
            ORDER BY LinkedEntityId
        ];

        Assert.areEqual(3, links.size(), 'Should create links for all three parents');

        Set<Id> linkedIds = new Set<Id>();
        for (ContentDocumentLink link : links) {
            linkedIds.add(link.LinkedEntityId);
        }

        Assert.isTrue(linkedIds.contains(acc.Id), 'Should link to Account');
        Assert.isTrue(linkedIds.contains(opp.Id), 'Should link to Opportunity');
        Assert.isTrue(linkedIds.contains(c.Id), 'Should link to Case');
    }

    /**
     * Test: Trigger does not fire when RequestJSON is blank
     */
    @isTest
    static void testTriggerDoesNotFireWithoutRequestJSON() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        ContentVersion cv = createTestContentVersion('No JSON Document');

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:nojson123',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF'
            // No RequestJSON__c
        );
        insert doc;

        // Count existing links (ContentVersion creates one for the user)
        Integer linksBefore = [
            SELECT COUNT() FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
        ];

        Test.startTest();
        doc.Status__c = 'SUCCEEDED';
        doc.OutputFileId__c = cv.Id;
        update doc;
        Test.stopTest();

        // Verify: No new links created
        Integer linksAfter = [
            SELECT COUNT() FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
        ];

        Assert.areEqual(linksBefore, linksAfter, 'Should not create links without RequestJSON');
    }

    /**
     * Test: Trigger handles status change from FAILED to SUCCEEDED
     */
    @isTest
    static void testTriggerHandlesRetryFromFailed() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Retry Document');

        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:retry123',
            Status__c = 'FAILED',
            OutputFormat__c = 'PDF',
            RequestJSON__c = requestJSON,
            Error__c = 'Previous failure'
        );
        insert doc;

        Test.startTest();
        // Retry: Update from FAILED to SUCCEEDED
        doc.Status__c = 'SUCCEEDED';
        doc.OutputFileId__c = cv.Id;
        doc.Error__c = null;
        update doc;
        Test.stopTest();

        // Verify: ContentDocumentLink created on retry
        List<ContentDocumentLink> links = [
            SELECT Id FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(1, links.size(), 'Trigger should create link when retrying from FAILED');
    }
}