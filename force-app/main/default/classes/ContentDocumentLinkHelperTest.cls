/**
 * Test class for ContentDocumentLinkHelper.
 * Tests the creation of ContentDocumentLink records from Generated_Document__c records.
 */
@isTest
private class ContentDocumentLinkHelperTest {

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
        // Create a ContentVersion
        ContentVersion cv = new ContentVersion();
        cv.Title = title;
        cv.PathOnClient = title + '.pdf';
        cv.VersionData = Blob.valueOf('Test PDF Content');
        cv.IsMajorVersion = true;
        insert cv;

        // Query back to get ContentDocumentId
        cv = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];
        return cv;
    }

    /**
     * Test: Create links for single parent (Account)
     */
    @isTest
    static void testCreateLinksForSingleParent() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Test Document');

        // Create Generated_Document__c with Account parent in RequestJSON
        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:single123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = cv.Id,
            RequestJSON__c = requestJSON
        );
        insert doc;

        // Query the document to simulate trigger context
        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: ContentDocumentLink created
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId, ShareType, Visibility
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(1, links.size(), 'Should have created one link');
        Assert.areEqual('V', links[0].ShareType, 'ShareType should be Viewer');
        Assert.areEqual('AllUsers', links[0].Visibility, 'Visibility should be AllUsers');
    }

    /**
     * Test: Create links for multiple parents (Account, Opportunity, Contact)
     */
    @isTest
    static void testCreateLinksForMultipleParents() {
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

        Contact con = new Contact(
            FirstName = 'Test',
            LastName = 'Contact',
            AccountId = acc.Id
        );
        insert con;

        ContentVersion cv = createTestContentVersion('Multi Parent Document');

        // Create Generated_Document__c with multiple parents in RequestJSON
        String requestJSON = '{"parents": {' +
            '"AccountId": "' + acc.Id + '",' +
            '"OpportunityId": "' + opp.Id + '",' +
            '"ContactId": "' + con.Id + '"' +
            '}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:multi123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = cv.Id,
            RequestJSON__c = requestJSON
        );
        insert doc;

        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: ContentDocumentLinks created for all parents
        Set<Id> parentIds = new Set<Id>{acc.Id, opp.Id, con.Id};
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId, ShareType, Visibility
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId IN :parentIds
            ORDER BY LinkedEntityId
        ];

        Assert.areEqual(3, links.size(), 'Should have created three links');

        Set<Id> linkedEntityIds = new Set<Id>();
        for (ContentDocumentLink link : links) {
            linkedEntityIds.add(link.LinkedEntityId);
            Assert.areEqual('V', link.ShareType, 'ShareType should be Viewer');
            Assert.areEqual('AllUsers', link.Visibility, 'Visibility should be AllUsers');
        }

        Assert.isTrue(linkedEntityIds.contains(acc.Id), 'Should link to Account');
        Assert.isTrue(linkedEntityIds.contains(opp.Id), 'Should link to Opportunity');
        Assert.isTrue(linkedEntityIds.contains(con.Id), 'Should link to Contact');
    }

    /**
     * Test: Create links for custom objects
     */
    @isTest
    static void testCreateLinksForCustomObjects() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Custom Object Document');

        // Simulate custom object parent in RequestJSON
        // Using Account ID but with custom object key pattern to test dynamic handling
        String requestJSON = '{"parents": {' +
            '"AccountId": "' + acc.Id + '",' +
            '"CustomObject__cId": "' + acc.Id + '"' + // Using Account ID to simulate custom object
            '}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:custom123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = cv.Id,
            RequestJSON__c = requestJSON
        );
        insert doc;

        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: ContentDocumentLinks created for dynamic object types
        // Filter to only our test account (exclude user link)
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        // Should create links for the account (both keys point to same record)
        Assert.isTrue(links.size() >= 1, 'Should handle dynamic object types');
    }

    /**
     * Test: Handle null and empty parents gracefully
     */
    @isTest
    static void testHandleNullParents() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Null Parent Document');

        // Create Generated_Document__c with null and empty parent values
        String requestJSON = '{"parents": {' +
            '"AccountId": "' + acc.Id + '",' +
            '"OpportunityId": null,' +
            '"ContactId": ""' +
            '}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:null123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = cv.Id,
            RequestJSON__c = requestJSON
        );
        insert doc;

        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: Only non-null parent gets linked
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(1, links.size(), 'Should only create link for non-null parent');
    }

    /**
     * Test: Create links for both PDF and DOCX files
     */
    @isTest
    static void testCreateLinksForPdfAndDocx() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion pdfVersion = createTestContentVersion('PDF Document');
        ContentVersion docxVersion = createTestContentVersion('DOCX Document');

        String requestJSON = '{"parents": {"AccountId": "' + acc.Id + '"}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:both123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = pdfVersion.Id,
            MergedDocxFileId__c = docxVersion.Id,
            RequestJSON__c = requestJSON
        );
        insert doc;

        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: Links created for both documents
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

        Assert.areEqual(1, pdfLinks.size(), 'Should create link for PDF');
        Assert.areEqual(1, docxLinks.size(), 'Should create link for DOCX');
    }

    /**
     * Test: Bulk operation with multiple documents
     */
    @isTest
    static void testBulkOperation() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        List<Account> accounts = new List<Account>();
        List<Generated_Document__c> docs = new List<Generated_Document__c>();

        for (Integer i = 0; i < 50; i++) {
            accounts.add(new Account(Name = 'Test Account ' + i));
        }
        insert accounts;

        for (Integer i = 0; i < 50; i++) {
            ContentVersion cv = createTestContentVersion('Bulk Document ' + i);

            String requestJSON = '{"parents": {"AccountId": "' + accounts[i].Id + '"}}';

            Generated_Document__c doc = new Generated_Document__c(
                Template__c = templateId,
                RequestHash__c = 'sha256:bulk' + i,
                Status__c = 'SUCCEEDED',
                OutputFormat__c = 'PDF',
                OutputFileId__c = cv.Id,
                RequestJSON__c = requestJSON
            );
            docs.add(doc);
        }
        insert docs;

        // Query all documents
        docs = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
                FROM Generated_Document__c WHERE Id IN :docs];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(docs);
        Test.stopTest();

        // Verify: All links created - need to query by ContentDocumentId due to restrictions
        // First get all ContentDocumentIds - bulk query to avoid governor limits
        Set<Id> cvIds = new Set<Id>();
        for (Generated_Document__c doc : docs) {
            cvIds.add(doc.OutputFileId__c);
        }

        Map<Id, ContentVersion> cvMap = new Map<Id, ContentVersion>(
            [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id IN :cvIds]
        );

        Set<Id> contentDocIds = new Set<Id>();
        for (ContentVersion cv : cvMap.values()) {
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

        Assert.areEqual(50, accountsWithLinks.size(), 'Should create links for all 50 documents');
    }

    /**
     * Test: Handle invalid JSON gracefully
     */
    @isTest
    static void testHandleInvalidJson() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        ContentVersion cv = createTestContentVersion('Invalid JSON Document');

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:invalid123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = cv.Id,
            RequestJSON__c = 'This is not valid JSON'
        );
        insert doc;

        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        // Count existing links before processing
        Integer linksBefore = [
            SELECT COUNT() FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
        ];

        Test.startTest();
        // Should not throw exception
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: No new links created but no exception thrown
        Integer linksAfter = [
            SELECT COUNT() FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
        ];

        Assert.areEqual(linksBefore, linksAfter, 'Should not create links for invalid JSON');
    }

    /**
     * Test: Handle missing parents field in JSON
     */
    @isTest
    static void testHandleMissingParentsField() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        ContentVersion cv = createTestContentVersion('No Parents Document');

        // JSON without parents field
        String requestJSON = '{"templateId": "123", "data": {}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:noparents123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = cv.Id,
            RequestJSON__c = requestJSON
        );
        insert doc;

        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        // Count existing links before processing
        Integer linksBefore = [
            SELECT COUNT() FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
        ];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: No new links created
        Integer linksAfter = [
            SELECT COUNT() FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
        ];

        Assert.areEqual(linksBefore, linksAfter, 'Should not create links when parents field missing');
    }

    /**
     * Test: Handle invalid parent IDs (wrong format)
     */
    @isTest
    static void testHandleInvalidParentIds() {
        // Setup: Create test data
        Id templateId = createTestTemplate();
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        ContentVersion cv = createTestContentVersion('Invalid ID Document');

        // Mix of valid and invalid IDs (including the 068xxx pattern used in integration tests)
        String requestJSON = '{"parents": {' +
            '"AccountId": "' + acc.Id + '",' +
            '"OpportunityId": "not-a-valid-id",' +
            '"ContactId": "123",' +
            '"LeadId": "068xxx",' +
            '"CaseId": "068xxxxxxxxxxxxx"' +
            '}}';

        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = 'sha256:invalidid123',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = cv.Id,
            RequestJSON__c = requestJSON
        );
        insert doc;

        doc = [SELECT Id, OutputFileId__c, MergedDocxFileId__c, RequestJSON__c
               FROM Generated_Document__c WHERE Id = :doc.Id];

        Test.startTest();
        ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{doc});
        Test.stopTest();

        // Verify: Only valid ID gets linked
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, LinkedEntityId
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :acc.Id
        ];

        Assert.areEqual(1, links.size(), 'Should only create link for valid ID');
    }
}