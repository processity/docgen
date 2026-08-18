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

    @isTest
    static void testGetTemplateFilesWithXlsxFile() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        ContentVersion cv = new ContentVersion(
            Title = 'Excel Template',
            PathOnClient = 'QuoteTemplate.xlsx',
            VersionData = Blob.valueOf('Test workbook content')
        );
        insert cv;
        ContentVersion insertedVersion = [
            SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id
        ];
        insert new ContentDocumentLink(
            LinkedEntityId = template.Id,
            ContentDocumentId = insertedVersion.ContentDocumentId,
            ShareType = 'V',
            Visibility = 'AllUsers'
        );

        Test.startTest();
        List<ContentVersion> files = DocgenTemplateFileController.getTemplateFiles(template.Id);
        Test.stopTest();

        System.assertEquals(1, files.size(), 'Should return one XLSX file');
        System.assertEquals('xlsx', files[0].FileExtension, 'File extension should be xlsx');
    }

    @isTest
    static void testGetTemplateFilesOrdersByLastModifiedDateDescending() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        List<ContentVersion> versions = new List<ContentVersion>{
            new ContentVersion(
                Title = 'Older Template',
                PathOnClient = 'OlderTemplate.docx',
                VersionData = Blob.valueOf('Older template content')
            ),
            new ContentVersion(
                Title = 'Newer Template',
                PathOnClient = 'NewerTemplate.docx',
                VersionData = Blob.valueOf('Newer template content')
            )
        };
        insert versions;

        Set<Id> insertedVersionIds = new Map<Id, ContentVersion>(versions).keySet();
        versions = [
            SELECT Id, ContentDocumentId, LastModifiedDate
            FROM ContentVersion
            WHERE Id IN :insertedVersionIds
        ];
        List<ContentDocumentLink> links = new List<ContentDocumentLink>();
        Set<Id> versionIds = new Set<Id>();
        for (ContentVersion version : versions) {
            versionIds.add(version.Id);
            links.add(new ContentDocumentLink(
                LinkedEntityId = template.Id,
                ContentDocumentId = version.ContentDocumentId,
                ShareType = 'V',
                Visibility = 'AllUsers'
            ));
        }
        insert links;

        List<ContentVersion> expected = [
            SELECT Id
            FROM ContentVersion
            WHERE Id IN :versionIds
            ORDER BY LastModifiedDate DESC, Id DESC
        ];

        Test.startTest();
        List<ContentVersion> files = DocgenTemplateFileController.getTemplateFiles(template.Id);
        Test.stopTest();

        Assert.areEqual(2, files.size(), 'Both linked templates should be returned');
        Assert.areEqual(expected[0].Id, files[0].Id, 'The most recently modified file should be first');
        Assert.areEqual(expected[1].Id, files[1].Id, 'The older file should be second');
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
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

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
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

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

    @isTest
    static void testGetUploadedTemplateInfo() {
        ContentVersion uploadedVersion = createTemplateFile('Guided Template', 'docx');
        ContentVersion storedVersion = [
            SELECT Id, ContentDocumentId, ContentSize
            FROM ContentVersion
            WHERE Id = :uploadedVersion.Id
        ];

        Test.startTest();
        DocgenTemplateFileController.UploadedTemplateInfo info =
            DocgenTemplateFileController.getUploadedTemplateInfo(storedVersion.ContentDocumentId);
        Test.stopTest();

        Assert.areEqual(storedVersion.ContentDocumentId, info.contentDocumentId, 'The document should match');
        Assert.areEqual('Guided Template', info.title, 'The title should be available to the wizard');
        Assert.areEqual('docx', info.fileExtension, 'The supported extension should be returned');
        Assert.areEqual(storedVersion.ContentSize, info.contentSize, 'The uploaded size should be returned');
    }

    @isTest
    static void testGetPrimaryParentOptions() {
        Test.startTest();
        List<DocgenTemplateFileController.PrimaryParentOption> options =
            DocgenTemplateFileController.getPrimaryParentOptions();
        Test.stopTest();

        Map<String, DocgenTemplateFileController.PrimaryParentOption> optionsByValue =
            new Map<String, DocgenTemplateFileController.PrimaryParentOption>();
        for (DocgenTemplateFileController.PrimaryParentOption option : options) {
            optionsByValue.put(option.value, option);
        }

        Assert.isTrue(optionsByValue.containsKey('Account'),
            'Active supported object metadata should supply Account');
        Assert.areEqual('Account — Account', optionsByValue.get('Account').label,
            'The selector should identify both the object label and API name');
        Assert.areEqual(10, optionsByValue.get('Account').displayOrder,
            'The configured display order should be exposed to the UI');
    }

    @isTest
    static void testCreateTemplateConfigurationWithUploadedFile() {
        assignDocgenUserPermissionSet();
        ContentVersion uploadedVersion = createTemplateFile('New Account Template', 'docx');
        ContentVersion storedVersion = [
            SELECT Id, ContentDocumentId
            FROM ContentVersion
            WHERE Id = :uploadedVersion.Id
        ];
        Map<String, Object> fields = new Map<String, Object>{
            'Name' => 'Wizard-created Template',
            'DataSource__c' => 'SOQL',
            'SOQL__c' => 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            'ReturnMultipleRecords__c' => true,
            'PrimaryParent__c' => 'Account',
            'Default_Output_Format__c' => 'PDF',
            'Output_File_Name_Field__c' => 'Account.Name',
            'StoreMergedDocx__c' => true
        };

        Id configurationId;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            configurationId = DocgenTemplateFileController.createConfiguration(
                'Docgen_Template__c',
                fields,
                storedVersion.ContentDocumentId
            );
            Test.stopTest();
        }

        Docgen_Template__c createdTemplate = [
            SELECT Name, DataSource__c, SOQL__c, ReturnMultipleRecords__c,
                   PrimaryParent__c, Default_Output_Format__c,
                   Output_File_Name_Field__c, StoreMergedDocx__c,
                   TemplateContentVersionId__c, ReturnDocxToBrowser__c
            FROM Docgen_Template__c
            WHERE Id = :configurationId
        ];
        Assert.areEqual('Wizard-created Template', createdTemplate.Name, 'The form fields should be saved');
        Assert.areEqual(storedVersion.Id, createdTemplate.TemplateContentVersionId__c,
            'The internal version ID should come from the upload');
        Assert.isTrue(createdTemplate.ReturnDocxToBrowser__c,
            'The hidden template delivery setting should use its server default');
        Assert.isTrue(createdTemplate.ReturnMultipleRecords__c, 'Advanced SOQL behavior should be saved');
        Assert.isTrue(createdTemplate.StoreMergedDocx__c, 'Output settings should be saved');

        ContentDocumentLink link = [
            SELECT ContentDocumentId, ShareType
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :configurationId
            AND ContentDocumentId = :storedVersion.ContentDocumentId
            LIMIT 1
        ];
        Assert.areEqual(storedVersion.ContentDocumentId, link.ContentDocumentId,
            'The staged file should be linked to the new template');
        Assert.areEqual('V', link.ShareType, 'The configuration should receive viewer access');
    }

    @isTest
    static void testCreateTemplateConfigurationWithDeferredUpload() {
        assignDocgenUserPermissionSet();
        Map<String, Object> fields = new Map<String, Object>{
            'Name' => 'Deferred Template',
            'DataSource__c' => 'SOQL',
            'SOQL__c' => 'SELECT Id FROM Account WHERE Id = :recordId',
            'PrimaryParent__c' => 'Account'
        };

        Id configurationId;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            configurationId = DocgenTemplateFileController.createConfiguration(
                'Docgen_Template__c',
                fields,
                null
            );
            Test.stopTest();
        }

        Docgen_Template__c createdTemplate = [
            SELECT TemplateContentVersionId__c, ReturnDocxToBrowser__c
            FROM Docgen_Template__c
            WHERE Id = :configurationId
        ];
        Assert.areEqual('TBD', createdTemplate.TemplateContentVersionId__c,
            'A deferred source should use the editable TBD marker');
        Assert.isTrue(createdTemplate.ReturnDocxToBrowser__c,
            'The hidden template delivery setting should use its server default');
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :configurationId
        ], 'A deferred template should not have a linked source file yet');
    }

    @isTest
    static void testCreateConcatenateCompositeWithoutMasterFile() {
        assignDocgenUserPermissionSet();
        Map<String, Object> fields = new Map<String, Object>{
            'Template_Strategy__c' => 'Concatenate Templates',
            'Default_Output_Format__c' => 'PDF'
        };

        Id configurationId;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            configurationId = DocgenTemplateFileController.createConfiguration(
                'Composite_Document__c',
                fields,
                null
            );
            Test.stopTest();
        }

        Composite_Document__c createdComposite = [
            SELECT Description__c, Template_Strategy__c, PrimaryParent__c,
                   IsActive__c, TemplateContentVersionId__c, ReturnDocxToBrowser__c
            FROM Composite_Document__c
            WHERE Id = :configurationId
        ];
        Assert.areEqual('Concatenate Templates', createdComposite.Template_Strategy__c,
            'The selected strategy should be saved');
        Assert.areEqual(null, createdComposite.TemplateContentVersionId__c,
            'Concatenate composites should not have a master file ID');
        Assert.isTrue(createdComposite.IsActive__c, 'New composites should be active by default');
        Assert.isFalse(createdComposite.ReturnDocxToBrowser__c,
            'The hidden composite delivery setting should use its server default');
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :configurationId
        ], 'No master file should be linked for concatenate strategy');
    }

    @isTest
    static void testCreateOwnTemplateCompositeWithUploadedFile() {
        assignDocgenUserPermissionSet();
        ContentVersion uploadedVersion = createTemplateFile('Composite Master', 'pptx');
        ContentVersion storedVersion = [
            SELECT Id, ContentDocumentId
            FROM ContentVersion
            WHERE Id = :uploadedVersion.Id
        ];
        Map<String, Object> fields = new Map<String, Object>{
            'Template_Strategy__c' => 'Own Template',
            'Default_Output_Format__c' => 'PPTX'
        };

        Id configurationId;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            configurationId = DocgenTemplateFileController.createConfiguration(
                'Composite_Document__c',
                fields,
                storedVersion.ContentDocumentId
            );
            Test.stopTest();
        }

        Composite_Document__c createdComposite = [
            SELECT Template_Strategy__c, TemplateContentVersionId__c,
                   IsActive__c, ReturnDocxToBrowser__c
            FROM Composite_Document__c
            WHERE Id = :configurationId
        ];
        Assert.areEqual(storedVersion.Id, createdComposite.TemplateContentVersionId__c,
            'Own-template composites should use the uploaded version');
        Assert.isTrue(createdComposite.IsActive__c, 'New composites should be active by default');
        Assert.isFalse(createdComposite.ReturnDocxToBrowser__c,
            'The hidden composite delivery setting should use its server default');
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :configurationId
            AND ContentDocumentId = :storedVersion.ContentDocumentId
        ], 'The uploaded master file should be linked');
    }

    @isTest
    static void testCreateOwnTemplateCompositeWithDeferredUpload() {
        assignDocgenUserPermissionSet();
        Map<String, Object> fields = new Map<String, Object>{
            'Template_Strategy__c' => 'Own Template',
            'Default_Output_Format__c' => 'PDF',
            'PrimaryParent__c' => 'Account'
        };

        Id configurationId;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            configurationId = DocgenTemplateFileController.createConfiguration(
                'Composite_Document__c',
                fields,
                null
            );
            Test.stopTest();
        }

        Composite_Document__c createdComposite = [
            SELECT TemplateContentVersionId__c, IsActive__c, ReturnDocxToBrowser__c
            FROM Composite_Document__c
            WHERE Id = :configurationId
        ];
        Assert.areEqual('TBD', createdComposite.TemplateContentVersionId__c,
            'A deferred own-template source should use the editable TBD marker');
        Assert.isTrue(createdComposite.IsActive__c, 'New composites should be active by default');
        Assert.isFalse(createdComposite.ReturnDocxToBrowser__c,
            'The hidden composite delivery setting should use its server default');
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :configurationId
        ], 'A deferred composite should not have a linked source file yet');
    }

    @isTest
    static void testCreateConfigurationValidatesFileAndFields() {
        assignDocgenUserPermissionSet();
        ContentVersion pdfVersion = createTemplateFile('Not A Template', 'pdf');
        Id pdfDocumentId = [
            SELECT ContentDocumentId
            FROM ContentVersion
            WHERE Id = :pdfVersion.Id
        ].ContentDocumentId;

        assertAuraHandledException(
            'Unsupported file formats should be rejected',
            'Docgen_Template__c',
            new Map<String, Object>{
                'Name' => 'PDF File',
                'DataSource__c' => 'SOQL',
                'SOQL__c' => 'SELECT Id FROM Account WHERE Id = :recordId'
            },
            pdfDocumentId
        );
        assertAuraHandledException(
            'Internal fields should not be accepted from the form',
            'Composite_Document__c',
            new Map<String, Object>{
                'Template_Strategy__c' => 'Concatenate Templates',
                'TemplateContentVersionId__c' => '068000000000001AAA'
            },
            null
        );
        assertAuraHandledException(
            'Hidden administration fields should not be accepted from the form',
            'Composite_Document__c',
            new Map<String, Object>{
                'Template_Strategy__c' => 'Concatenate Templates',
                'IsActive__c' => false
            },
            null
        );
        assertAuraHandledException(
            'Primary Parent should be limited to active supported object metadata',
            'Docgen_Template__c',
            new Map<String, Object>{
                'Name' => 'Unsupported Parent',
                'DataSource__c' => 'SOQL',
                'SOQL__c' => 'SELECT Id FROM Account WHERE Id = :recordId',
                'PrimaryParent__c' => 'Not_Configured__c'
            },
            null
        );
    }

    private static ContentVersion createTemplateFile(String title, String extension) {
        ContentVersion version = new ContentVersion(
            Title = title,
            PathOnClient = title.replace(' ', '_') + '.' + extension,
            VersionData = Blob.valueOf(title + ' content')
        );
        insert version;
        return version;
    }

    private static void assignDocgenUserPermissionSet() {
        PermissionSet docgenUser = [
            SELECT Id
            FROM PermissionSet
            WHERE Name = 'Docgen_User'
            LIMIT 1
        ];
        if ([
            SELECT COUNT()
            FROM PermissionSetAssignment
            WHERE AssigneeId = :UserInfo.getUserId()
            AND PermissionSetId = :docgenUser.Id
        ] == 0) {
            System.runAs(new User(Id = UserInfo.getUserId())) {
                insert new PermissionSetAssignment(
                    AssigneeId = UserInfo.getUserId(),
                    PermissionSetId = docgenUser.Id
                );
            }
        }
    }

    private static void assertAuraHandledException(
        String assertionMessage,
        String objectApiName,
        Map<String, Object> fields,
        Id contentDocumentId
    ) {
        Boolean exceptionThrown = false;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            try {
                DocgenTemplateFileController.createConfiguration(
                    objectApiName,
                    fields,
                    contentDocumentId
                );
            } catch (AuraHandledException e) {
                exceptionThrown = true;
            }
        }
        Assert.isTrue(exceptionThrown, assertionMessage);
    }
}
