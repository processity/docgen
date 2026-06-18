@IsTest
private class DocgenAsyncControllerTest {
    @testSetup
    static void setup() {
        DocgenTestDataFactory.createTemplate(
            'Async Account Template',
            'Account',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId'
        );
        DocgenTestDataFactory.createAccount('Async Account Ltd');
    }

    private static ContentVersion createTestContentVersion(String title) {
        ContentVersion cv = new ContentVersion(
            Title = title,
            PathOnClient = title + '.pdf',
            VersionData = Blob.valueOf('Test PDF Content'),
            IsMajorVersion = true
        );
        insert cv;
        return [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];
    }

    @IsTest
    static void testStartGenerationCreatesQueuedDocument() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        DocgenAsyncController.StartResult result = DocgenAsyncController.startGeneration(
            template.Id,
            null,
            account.Id,
            'DOCX'
        );
        Test.stopTest();

        Assert.isNotNull(result.generatedDocumentId, 'Generated document ID should be returned');
        Assert.areEqual('QUEUED', result.status, 'Status should be queued for worker processing');
        Assert.areEqual(20, result.progressValue, 'Queued documents should show queued progress');
        Assert.isFalse(result.isTerminal, 'Queued status should not be terminal');

        Generated_Document__c doc = [
            SELECT Id, Status__c, Account__c, Template__c, OutputFormat__c, RequestJSON__c,
                   RequestedBy__c, Attempts__c, Priority__c
            FROM Generated_Document__c
            WHERE Id = :result.generatedDocumentId
        ];
        Assert.areEqual('QUEUED', doc.Status__c, 'Document should be queued');
        Assert.areEqual(account.Id, doc.Account__c, 'Parent lookup should be set');
        Assert.areEqual(template.Id, doc.Template__c, 'Template lookup should be set');
        Assert.areEqual('DOCX', doc.OutputFormat__c, 'Output format should be stored');
        Assert.isNotNull(doc.RequestJSON__c, 'Request JSON should be stored for the worker');
        Assert.areEqual(UserInfo.getUserId(), doc.RequestedBy__c, 'Requester should be tracked');
        Assert.areEqual(0, Integer.valueOf(doc.Attempts__c), 'Attempts should start at 0');
        Assert.areEqual(0, Integer.valueOf(doc.Priority__c), 'Priority should default to 0');
    }

    @IsTest
    static void testStartGenerationUsesTemplateDefaultOutputFormatWhenBlank() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        update new Docgen_Template__c(
            Id = template.Id,
            Default_Output_Format__c = 'PPTX'
        );
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        DocgenAsyncController.StartResult result = DocgenAsyncController.startGeneration(
            template.Id,
            null,
            account.Id,
            null
        );
        Test.stopTest();

        Assert.areEqual('PPTX', result.outputFormat, 'Blank request should use the template default output format');
        Generated_Document__c doc = [
            SELECT OutputFormat__c
            FROM Generated_Document__c
            WHERE Id = :result.generatedDocumentId
        ];
        Assert.areEqual('PPTX', doc.OutputFormat__c, 'Generated document should store resolved template default');
    }

    @IsTest
    static void testStartGenerationPreviewModeCreatesPendingPreviewDocument() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        DocgenAsyncController.StartResult result = DocgenAsyncController.startGeneration(
            template.Id,
            null,
            account.Id,
            'PDF',
            true
        );
        Test.stopTest();

        Assert.isNotNull(result.generatedDocumentId, 'Generated document ID should be returned');
        Assert.areEqual('QUEUED', result.status, 'Preview document should still start queued');
        Assert.isTrue(result.isPreviewPending, 'Preview mode should mark the document pending preview');

        Generated_Document__c doc = [
            SELECT PendingPreview__c, RequestHash__c
            FROM Generated_Document__c
            WHERE Id = :result.generatedDocumentId
        ];
        Assert.isTrue(doc.PendingPreview__c, 'Generated document should be marked pending preview');
        Assert.isTrue(doc.RequestHash__c.startsWith('sha256:'), 'Preview request hash should retain sha256 format');
        Assert.areEqual(71, doc.RequestHash__c.length(), 'Preview request hash should fit the unique field length');
    }

    @IsTest
    static void testPreviewModeDoesNotReuseSavedDocument() {
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        DocgenAsyncController.StartResult firstResult = DocgenAsyncController.startGeneration(
            null,
            'Async Account Template',
            account.Id,
            'PDF',
            true
        );
        DocgenAsyncController.StartResult secondResult = DocgenAsyncController.startGeneration(
            null,
            'Async Account Template',
            account.Id,
            'PDF',
            true
        );
        Test.stopTest();

        Assert.areNotEqual(firstResult.generatedDocumentId, secondResult.generatedDocumentId,
            'Preview generations should not reuse existing saved or pending documents');
        Assert.areEqual(2, [SELECT COUNT() FROM Generated_Document__c], 'Preview mode should create separate rows');
    }

    @IsTest
    static void testStartGenerationByTemplateNameReusesExistingQueuedDocument() {
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        DocgenAsyncController.StartResult firstResult = DocgenAsyncController.startGeneration(
            null,
            'Async Account Template',
            account.Id,
            'PDF'
        );
        DocgenAsyncController.StartResult secondResult = DocgenAsyncController.startGeneration(
            null,
            'Async Account Template',
            account.Id,
            'PDF'
        );
        Test.stopTest();

        Assert.areEqual(firstResult.generatedDocumentId, secondResult.generatedDocumentId, 'Duplicate request should reuse existing row');
        Assert.areEqual(1, [SELECT COUNT() FROM Generated_Document__c], 'Only one generated document should exist');
    }

    @IsTest
    static void testStartGenerationRequeuesFailedExistingDocument() {
        Account account = [SELECT Id FROM Account LIMIT 1];

        DocgenAsyncController.StartResult firstResult = DocgenAsyncController.startGeneration(
            null,
            'Async Account Template',
            account.Id,
            'PDF'
        );

        update new Generated_Document__c(
            Id = firstResult.generatedDocumentId,
            Status__c = 'FAILED',
            Error__c = 'Previous failure',
            OutputFileId__c = '068000000000000AAA',
            Attempts__c = 3
        );

        Test.startTest();
        DocgenAsyncController.StartResult retryResult = DocgenAsyncController.startGeneration(
            null,
            'Async Account Template',
            account.Id,
            'PDF'
        );
        Test.stopTest();

        Assert.areEqual(firstResult.generatedDocumentId, retryResult.generatedDocumentId, 'Retry should reuse the same row');
        Assert.areEqual('QUEUED', retryResult.status, 'Failed document should be queued again');

        Generated_Document__c doc = [
            SELECT Status__c, Error__c, OutputFileId__c, Attempts__c
            FROM Generated_Document__c
            WHERE Id = :retryResult.generatedDocumentId
        ];
        Assert.areEqual('QUEUED', doc.Status__c, 'Status should be reset to queued');
        Assert.isNull(doc.Error__c, 'Previous error should be cleared');
        Assert.isNull(doc.OutputFileId__c, 'Previous output file should be cleared');
        Assert.areEqual(0, Integer.valueOf(doc.Attempts__c), 'Attempts should reset for manual retry');
    }

    @IsTest
    static void testStartGenerationDoesNotRequireConfiguredLookupFieldToExist() {
        Supported_Object__mdt accountConfig = new Supported_Object__mdt();
        accountConfig.DeveloperName = 'Account';
        accountConfig.Label = 'Account';
        accountConfig.Object_API_Name__c = 'Account';
        accountConfig.Lookup_Field_API_Name__c = 'Missing_Lookup__c';
        accountConfig.Is_Active__c = true;
        DocgenObjectConfigService.configCache = new Map<String, Supported_Object__mdt>{
            'Account' => accountConfig
        };

        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        DocgenAsyncController.StartResult result = DocgenAsyncController.startGeneration(
            null,
            'Async Account Template',
            account.Id,
            'PDF'
        );
        Test.stopTest();

        Generated_Document__c doc = [
            SELECT Status__c, Account__c, RequestJSON__c
            FROM Generated_Document__c
            WHERE Id = :result.generatedDocumentId
        ];
        Assert.areEqual('QUEUED', doc.Status__c, 'Document should still be queued');
        Assert.isNull(doc.Account__c, 'Existing lookup field should not be populated when metadata points to a missing field');
        Assert.isTrue(doc.RequestJSON__c.contains(String.valueOf(account.Id)), 'Parent ID should still be stored for ContentDocumentLink creation');

        DocgenObjectConfigService.clearCache();
    }

    @IsTest
    static void testGetGenerationStatusReturnsDownloadUrlForSucceededDocument() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];
        Generated_Document__c doc = DocgenTestDataFactory.createGeneratedDocument(template.Id, account.Id, 'SUCCEEDED');
        doc.OutputFileId__c = '068000000000001AAA';
        update doc;

        Test.startTest();
        DocgenAsyncController.StatusResult result = DocgenAsyncController.getGenerationStatus(doc.Id);
        Test.stopTest();

        Assert.areEqual('SUCCEEDED', result.status, 'Status should be returned');
        Assert.areEqual(100, result.progressValue, 'Succeeded documents should show full progress');
        Assert.isTrue(result.isTerminal, 'Succeeded status should be terminal');
        Assert.areEqual('069000000000001AAA', result.contentDocumentId, 'ContentDocument ID should be returned for file card preview');
        Assert.areEqual('/sfc/servlet.shepherd/version/download/068000000000001AAA', result.downloadUrl,
            'Download URL should target the file download endpoint');
        Assert.areEqual('/lightning/r/ContentDocument/069000000000001AAA/view', result.previewUrl,
            'Preview URL should use the Salesforce file record instead of the download endpoint');
        Assert.isFalse(result.previewUrl.contains('/version/download/'), 'Inline preview must not use a download URL');
        Assert.isTrue(result.canInlinePreview, 'PDF output should be marked inline previewable');
    }

    @IsTest
    static void testGetPdfPreviewContentReturnsPdfBytes() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];
        ContentVersion cv = createTestContentVersion('Inline Preview Document');

        DocgenAsyncController.StartResult startResult = DocgenAsyncController.startGeneration(
            template.Id,
            null,
            account.Id,
            'PDF',
            true
        );
        update new Generated_Document__c(
            Id = startResult.generatedDocumentId,
            Status__c = 'SUCCEEDED',
            OutputFileId__c = cv.Id
        );

        Test.startTest();
        DocgenAsyncController.PreviewContent preview = DocgenAsyncController.getPdfPreviewContent(startResult.generatedDocumentId);
        Test.stopTest();

        Assert.areEqual('application/pdf', preview.contentType, 'Preview content should be served as PDF');
        Assert.areEqual('Inline Preview Document.pdf', preview.fileName, 'Preview file name should include extension');
        Assert.areEqual(
            EncodingUtil.base64Encode(Blob.valueOf('Test PDF Content')),
            preview.base64Data,
            'Preview payload should contain the generated PDF bytes'
        );
    }

    @IsTest
    static void testSaveGeneratedDocumentLinksPendingPreviewFile() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];
        ContentVersion cv = createTestContentVersion('Preview Save Document');

        DocgenAsyncController.StartResult startResult = DocgenAsyncController.startGeneration(
            template.Id,
            null,
            account.Id,
            'PDF',
            true
        );
        update new Generated_Document__c(
            Id = startResult.generatedDocumentId,
            Status__c = 'SUCCEEDED',
            OutputFileId__c = cv.Id
        );

        Assert.areEqual(0, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :account.Id
        ], 'Pending preview files should not be linked by the trigger');

        Test.startTest();
        DocgenAsyncController.StatusResult saveResult = DocgenAsyncController.saveGeneratedDocument(startResult.generatedDocumentId);
        Test.stopTest();

        Assert.areEqual('SUCCEEDED', saveResult.status, 'Saved preview should remain succeeded');
        Assert.isFalse(saveResult.isPreviewPending, 'Saved preview should no longer be pending');
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :account.Id
        ], 'Save should link the file to the parent record');
    }

    @IsTest
    static void testCancelGeneratedDocumentDeletesPendingPreviewFileAndRecord() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];
        ContentVersion cv = createTestContentVersion('Preview Cancel Document');
        Id contentDocumentId = cv.ContentDocumentId;

        DocgenAsyncController.StartResult startResult = DocgenAsyncController.startGeneration(
            template.Id,
            null,
            account.Id,
            'PDF',
            true
        );
        update new Generated_Document__c(
            Id = startResult.generatedDocumentId,
            Status__c = 'SUCCEEDED',
            OutputFileId__c = cv.Id
        );

        Test.startTest();
        DocgenAsyncController.cancelGeneratedDocument(startResult.generatedDocumentId);
        Test.stopTest();

        Assert.areEqual(0, [
            SELECT COUNT()
            FROM Generated_Document__c
            WHERE Id = :startResult.generatedDocumentId
        ], 'Cancel should delete the generated document row');
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM ContentDocument
            WHERE Id = :contentDocumentId
        ], 'Cancel should delete the generated Salesforce file');
    }

    @IsTest
    static void testStartGenerationRejectsInvalidOutputFormat() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        try {
            DocgenAsyncController.startGeneration(template.Id, null, account.Id, 'XLSX');
            Assert.fail('Invalid output format should throw an AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('Output Format must be PDF, DOCX, or PPTX'), 'Error should explain allowed formats');
        }
        Test.stopTest();
    }
}
