/**
 * Test class for DocgenTemplateFileController
 * Tests functionality for both Docgen_Template__c and Composite_Document__c
 */
@isTest
private class DocgenTemplateFileControllerTest {

    @testSetup
    static void setupTestData() {
        // Create a dummy ContentVersion first (required for templates)
        ContentVersion dummyCv = new ContentVersion(
            Title = 'Dummy Template',
            PathOnClient = 'DummyTemplate.docx',
            VersionData = Blob.valueOf('Dummy content')
        );
        insert dummyCv;

        // Create test template with the required TemplateContentVersionId__c
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = dummyCv.Id
        );
        insert template;

        // Create test composite document with Own Template strategy
        Composite_Document__c compositeDoc = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            Description__c = 'Test Composite Document',
            IsActive__c = true,
            TemplateContentVersionId__c = dummyCv.Id
        );
        insert compositeDoc;

        // Create another composite document with concatenate strategy
        Composite_Document__c compositeConcatDoc = new Composite_Document__c(
            Template_Strategy__c = 'Concatenate Templates',
            Description__c = 'Test Concat Composite',
            IsActive__c = true
        );
        insert compositeConcatDoc;
    }

    /**
     * Test getRecordMetadata for Docgen_Template__c
     */
    @isTest
    static void testGetRecordMetadataForTemplate() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        Test.startTest();
        Map<String, Object> metadata = DocgenTemplateFileController.getRecordMetadata(template.Id);
        Test.stopTest();

        System.assertEquals('Docgen_Template__c', metadata.get('objectType'), 'Object type should be Docgen_Template__c');
        System.assertEquals('Test Template', metadata.get('recordName'), 'Record name should match');
        System.assertEquals(null, metadata.get('templateStrategy'), 'Template strategy should not exist for templates');
    }

    /**
     * Test getRecordMetadata for Composite_Document__c with Own Template strategy
     */
    @isTest
    static void testGetRecordMetadataForCompositeOwnTemplate() {
        Composite_Document__c compositeDoc = [SELECT Id FROM Composite_Document__c WHERE Template_Strategy__c = 'Own Template' LIMIT 1];

        Test.startTest();
        Map<String, Object> metadata = DocgenTemplateFileController.getRecordMetadata(compositeDoc.Id);
        Test.stopTest();

        System.assertEquals('Composite_Document__c', metadata.get('objectType'), 'Object type should be Composite_Document__c');
        // Note: Composite_Document__c uses auto-number for Name field, so we can't predict the exact name
        System.assertNotEquals(null, metadata.get('recordName'), 'Record name should not be null');
        System.assertEquals('Own Template', metadata.get('templateStrategy'), 'Template strategy should be Own Template');
    }

    /**
     * Test getRecordMetadata for Composite_Document__c with Concatenate Templates strategy
     */
    @isTest
    static void testGetRecordMetadataForCompositeConcatenate() {
        Composite_Document__c compositeDoc = [SELECT Id FROM Composite_Document__c WHERE Template_Strategy__c = 'Concatenate Templates' LIMIT 1];

        Test.startTest();
        Map<String, Object> metadata = DocgenTemplateFileController.getRecordMetadata(compositeDoc.Id);
        Test.stopTest();

        System.assertEquals('Composite_Document__c', metadata.get('objectType'), 'Object type should be Composite_Document__c');
        // Note: Composite_Document__c uses auto-number for Name field, so we can't predict the exact name
        System.assertNotEquals(null, metadata.get('recordName'), 'Record name should not be null');
        System.assertEquals('Concatenate Templates', metadata.get('templateStrategy'), 'Template strategy should be Concatenate Templates');
    }

    /**
     * Test getTemplateFiles with no files attached
     */
    @isTest
    static void testGetTemplateFilesNoFiles() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        Test.startTest();
        List<ContentVersion> files = DocgenTemplateFileController.getTemplateFiles(template.Id);
        Test.stopTest();

        System.assertEquals(0, files.size(), 'Should return empty list when no files attached');
    }

    /**
     * Test getTemplateFiles with attached DOCX file
     */
    @isTest
    static void testGetTemplateFilesWithDocxFile() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        // Create a ContentVersion (DOCX file)
        ContentVersion cv = new ContentVersion(
            Title = 'Test Template',
            PathOnClient = 'TestTemplate.docx',
            VersionData = Blob.valueOf('Test template content')
        );
        insert cv;

        // Get the ContentDocument ID
        ContentVersion insertedCV = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];

        // Create ContentDocumentLink
        ContentDocumentLink cdl = new ContentDocumentLink(
            LinkedEntityId = template.Id,
            ContentDocumentId = insertedCV.ContentDocumentId,
            ShareType = 'V',
            Visibility = 'AllUsers'
        );
        insert cdl;

        Test.startTest();
        List<ContentVersion> files = DocgenTemplateFileController.getTemplateFiles(template.Id);
        Test.stopTest();

        System.assertEquals(1, files.size(), 'Should return one DOCX file');
        System.assertEquals('docx', files[0].FileExtension, 'File extension should be docx');
    }

    /**
     * Test getTemplateFiles filters out non-DOCX files
     */
    @isTest
    static void testGetTemplateFilesFiltersNonDocx() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        // Create a ContentVersion (PDF file)
        ContentVersion cvPdf = new ContentVersion(
            Title = 'Test PDF',
            PathOnClient = 'TestPdf.pdf',
            VersionData = Blob.valueOf('Test pdf content')
        );
        insert cvPdf;

        // Create a ContentVersion (DOCX file)
        ContentVersion cvDocx = new ContentVersion(
            Title = 'Test Template',
            PathOnClient = 'TestTemplate.docx',
            VersionData = Blob.valueOf('Test template content')
        );
        insert cvDocx;

        // Get the ContentDocument IDs
        List<ContentVersion> insertedCVs = [SELECT ContentDocumentId FROM ContentVersion WHERE Id IN :new Set<Id>{cvPdf.Id, cvDocx.Id}];

        // Create ContentDocumentLinks
        List<ContentDocumentLink> cdls = new List<ContentDocumentLink>();
        for (ContentVersion cv : insertedCVs) {
            cdls.add(new ContentDocumentLink(
                LinkedEntityId = template.Id,
                ContentDocumentId = cv.ContentDocumentId,
                ShareType = 'V',
                Visibility = 'AllUsers'
            ));
        }
        insert cdls;

        Test.startTest();
        List<ContentVersion> files = DocgenTemplateFileController.getTemplateFiles(template.Id);
        Test.stopTest();

        System.assertEquals(1, files.size(), 'Should return only DOCX file');
        System.assertEquals('docx', files[0].FileExtension, 'File extension should be docx');
    }

    /**
     * Test updateTemplateContentVersionId for Docgen_Template__c
     */
    @isTest
    static void testUpdateTemplateContentVersionIdForTemplate() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        // Create a ContentVersion
        ContentVersion cv = new ContentVersion(
            Title = 'Test Template',
            PathOnClient = 'TestTemplate.docx',
            VersionData = Blob.valueOf('Test template content')
        );
        insert cv;

        Test.startTest();
        DocgenTemplateFileController.updateTemplateContentVersionId(template.Id, cv.Id);
        Test.stopTest();

        Docgen_Template__c updatedTemplate = [SELECT TemplateContentVersionId__c FROM Docgen_Template__c WHERE Id = :template.Id];
        System.assertEquals(cv.Id, updatedTemplate.TemplateContentVersionId__c, 'Template ContentVersionId should be updated');
    }

    /**
     * Test updateTemplateContentVersionId for Composite_Document__c
     */
    @isTest
    static void testUpdateTemplateContentVersionIdForComposite() {
        Composite_Document__c compositeDoc = [SELECT Id FROM Composite_Document__c WHERE Template_Strategy__c = 'Own Template' LIMIT 1];

        // Create a ContentVersion
        ContentVersion cv = new ContentVersion(
            Title = 'Test Template',
            PathOnClient = 'TestTemplate.docx',
            VersionData = Blob.valueOf('Test template content')
        );
        insert cv;

        Test.startTest();
        DocgenTemplateFileController.updateTemplateContentVersionId(compositeDoc.Id, cv.Id);
        Test.stopTest();

        Composite_Document__c updatedDoc = [SELECT TemplateContentVersionId__c FROM Composite_Document__c WHERE Id = :compositeDoc.Id];
        System.assertEquals(cv.Id, updatedDoc.TemplateContentVersionId__c, 'Composite Document ContentVersionId should be updated');
    }

    /**
     * Test error handling for invalid record ID
     */
    @isTest
    static void testGetRecordMetadataInvalidId() {
        // Create an invalid ID (Account ID instead of template/composite)
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Test.startTest();
        Map<String, Object> metadata = DocgenTemplateFileController.getRecordMetadata(acc.Id);
        Test.stopTest();

        System.assertEquals('Account', metadata.get('objectType'), 'Should return object type even for unsupported objects');
        System.assertEquals(null, metadata.get('recordName'), 'Should not have record name for unsupported objects');
    }

    /**
     * Test error handling for updateTemplateContentVersionId with unsupported object
     */
    @isTest
    static void testUpdateTemplateContentVersionIdUnsupportedObject() {
        // Create an Account (unsupported object)
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        // Create a ContentVersion
        ContentVersion cv = new ContentVersion(
            Title = 'Test File',
            PathOnClient = 'TestFile.docx',
            VersionData = Blob.valueOf('Test content')
        );
        insert cv;

        Boolean exceptionThrown = false;
        Test.startTest();
        try {
            DocgenTemplateFileController.updateTemplateContentVersionId(acc.Id, cv.Id);
        } catch (Exception e) {
            exceptionThrown = true;
            // The exception message should indicate it's an unsupported object type
            // It could be either "Unsupported object type" or "Script-thrown exception" depending on the error
            System.assert(
                e.getMessage().contains('Unsupported object type') ||
                e.getMessage().contains('Script-thrown exception'),
                'Should throw error for unsupported object. Actual message: ' + e.getMessage()
            );
        }
        Test.stopTest();

        System.assert(exceptionThrown, 'Should throw exception for unsupported object type');
    }

    /**
     * Test getTemplateFiles works for Composite_Document__c
     */
    @isTest
    static void testGetTemplateFilesForComposite() {
        Composite_Document__c compositeDoc = [SELECT Id FROM Composite_Document__c WHERE Template_Strategy__c = 'Own Template' LIMIT 1];

        // Create a ContentVersion (DOCX file)
        ContentVersion cv = new ContentVersion(
            Title = 'Composite Template',
            PathOnClient = 'CompositeTemplate.docx',
            VersionData = Blob.valueOf('Composite template content')
        );
        insert cv;

        // Get the ContentDocument ID
        ContentVersion insertedCV = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];

        // Create ContentDocumentLink
        ContentDocumentLink cdl = new ContentDocumentLink(
            LinkedEntityId = compositeDoc.Id,
            ContentDocumentId = insertedCV.ContentDocumentId,
            ShareType = 'V',
            Visibility = 'AllUsers'
        );
        insert cdl;

        Test.startTest();
        List<ContentVersion> files = DocgenTemplateFileController.getTemplateFiles(compositeDoc.Id);
        Test.stopTest();

        System.assertEquals(1, files.size(), 'Should return one DOCX file for composite document');
        System.assertEquals('docx', files[0].FileExtension, 'File extension should be docx');
        System.assertEquals('Composite Template', files[0].Title, 'File title should match');
    }
}