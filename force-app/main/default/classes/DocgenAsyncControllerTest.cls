@IsTest
private class DocgenAsyncControllerTest {
    private class PdfPreviewCalloutMock implements HttpCalloutMock {
        private Integer statusCode;
        private String responseBody;
        private Id expectedGeneratedDocumentId;
        private Integer expectedPageNumber;
        private String expectedNamedCredential;

        PdfPreviewCalloutMock(
            Integer statusCode,
            String responseBody,
            Id expectedGeneratedDocumentId,
            Integer expectedPageNumber,
            String expectedNamedCredential
        ) {
            this.statusCode = statusCode;
            this.responseBody = responseBody;
            this.expectedGeneratedDocumentId = expectedGeneratedDocumentId;
            this.expectedPageNumber = expectedPageNumber;
            this.expectedNamedCredential = expectedNamedCredential;
        }

        public HttpResponse respond(HttpRequest request) {
            Assert.areEqual('POST', request.getMethod(), 'Preview pages should use POST');
            Assert.areEqual(
                'callout:' + expectedNamedCredential + '/preview/pdf-page',
                request.getEndpoint(),
                'Preview pages should use the configured DocGen Named Credential'
            );
            Assert.areEqual('application/json', request.getHeader('Content-Type'), 'Request should contain JSON');
            Assert.areEqual('application/json', request.getHeader('Accept'), 'Response should request JSON');

            Map<String, Object> requestBody = (Map<String, Object>) JSON.deserializeUntyped(request.getBody());
            Assert.areEqual(
                String.valueOf(expectedGeneratedDocumentId),
                String.valueOf(requestBody.get('generatedDocumentId')),
                'Backend should receive only the generated document identity'
            );
            Assert.areEqual(
                String.valueOf(UserInfo.getUserId()),
                String.valueOf(requestBody.get('requestingUserId')),
                'Backend should independently validate the requesting user'
            );
            Assert.areEqual(
                expectedPageNumber,
                Integer.valueOf(String.valueOf(requestBody.get('pageNumber'))),
                'Backend should receive the requested page'
            );
            Assert.areEqual(
                20,
                Integer.valueOf(String.valueOf(requestBody.get('maxPreviewPages'))),
                'Backend should enforce the same preview page limit'
            );
            Assert.isFalse(requestBody.containsKey('outputFileId'), 'Pending ContentVersion IDs must not cross the client contract');
            Assert.isFalse(requestBody.containsKey('contentVersionId'), 'Pending ContentVersion IDs must not cross the client contract');

            HttpResponse response = new HttpResponse();
            response.setStatusCode(statusCode);
            response.setHeader('Content-Type', 'application/json');
            response.setBody(responseBody);
            return response;
        }
    }

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

    private static Generated_Document__c createPendingPreviewDocument(
        String status,
        String outputFormat,
        String outputFileId
    ) {
        Docgen_Template__c template = [
            SELECT Id
            FROM Docgen_Template__c
            WHERE Name = 'Async Account Template'
            LIMIT 1
        ];
        Account account = [SELECT Id FROM Account LIMIT 1];
        Generated_Document__c doc = DocgenTestDataFactory.createGeneratedDocumentWithConfig(
            template.Id,
            null,
            account.Id,
            null,
            null,
            null,
            null,
            status,
            outputFormat
        );
        doc.PendingPreview__c = true;
        doc.RequestedBy__c = UserInfo.getUserId();
        doc.OutputFileId__c = outputFileId;
        update doc;
        return doc;
    }

    private static User createOtherUser() {
        String uniqueValue = String.valueOf(DateTime.now().getTime()) + String.valueOf(Crypto.getRandomInteger()).replace('-', '');
        User userRecord = new User(
            Alias = 'othusr',
            Email = 'other-user-' + uniqueValue + '@example.com',
            EmailEncodingKey = 'UTF-8',
            LastName = 'Other User',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_GB',
            ProfileId = UserInfo.getProfileId(),
            TimeZoneSidKey = 'Europe/London',
            Username = 'other-user-' + uniqueValue + '@example.com'
        );
        insert userRecord;
        return userRecord;
    }

    private static Map<String, Object> getRequestOptions(Id generatedDocumentId) {
        Generated_Document__c doc = [
            SELECT RequestJSON__c, RequestJSON02__c, RequestJSON03__c, RequestJSON04__c,
                   RequestJSON05__c, RequestJSON06__c, RequestJSON07__c, RequestJSON08__c,
                   RequestJSON09__c, RequestJSON10__c
            FROM Generated_Document__c
            WHERE Id = :generatedDocumentId
        ];
        Map<String, Object> request = (Map<String, Object>) JSON.deserializeUntyped(
            DocgenEnvelopeService.reconstructRequestJSON(doc)
        );
        return (Map<String, Object>) request.get('options');
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
    static void testStartGenerationPassesReadOnlyWordOption() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        DocgenAsyncController.StartResult result = DocgenAsyncController.startGeneration(
            template.Id,
            null,
            account.Id,
            'DOCX',
            false,
            true
        );
        Test.stopTest();

        Assert.areEqual(true, getRequestOptions(result.generatedDocumentId).get('readOnlyWord'),
            'Queued direct generation should pass the read-only Word option');
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
        Assert.isNull(result.contentVersionId, 'Pending start responses must not expose a ContentVersion ID');
        Assert.isNull(result.contentDocumentId, 'Pending start responses must not expose a ContentDocument ID');
        Assert.isNull(result.downloadUrl, 'Pending start responses must not expose a download URL');
        Assert.isNull(result.previewUrl, 'Pending start responses must not expose a file preview URL');

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
    static void testStartCompositeGenerationCreatesQueuedDocument() {
        DocgenTestDataFactory.CompositeScenario scenario =
            DocgenTestDataFactory.createCompositeScenario('Account', 2, 'Concatenate Templates');
        String recordIds = JSON.serialize(new Map<String, String>{
            'accountId' => String.valueOf(scenario.testRecordId)
        });

        Test.startTest();
        DocgenAsyncController.StartResult result = DocgenAsyncController.startCompositeGeneration(
            scenario.compositeDoc.Id,
            recordIds,
            'PDF',
            false
        );
        Test.stopTest();

        Assert.isNotNull(result.generatedDocumentId, 'Generated document ID should be returned');
        Assert.areEqual('QUEUED', result.status, 'Composite document should be queued for worker processing');
        Assert.areEqual('PDF', result.outputFormat, 'Requested output format should be returned');
        Assert.isFalse(result.isPreviewPending, 'Normal composite generation should not be pending preview');

        Generated_Document__c doc = [
            SELECT Id, Status__c, Account__c, Template__c, Composite_Document__c,
                   OutputFormat__c, RequestJSON__c, RequestedBy__c, Attempts__c, Priority__c
            FROM Generated_Document__c
            WHERE Id = :result.generatedDocumentId
        ];
        Assert.areEqual('QUEUED', doc.Status__c, 'Document should be queued');
        Assert.areEqual(scenario.testRecordId, doc.Account__c, 'Primary parent lookup should be set');
        Assert.isNull(doc.Template__c, 'Template lookup should not be set for composite generation');
        Assert.areEqual(scenario.compositeDoc.Id, doc.Composite_Document__c, 'Composite lookup should be set');
        Assert.areEqual('PDF', doc.OutputFormat__c, 'Output format should be stored');
        Assert.isNotNull(doc.RequestJSON__c, 'Request JSON should be stored for the worker');
        Assert.areEqual(UserInfo.getUserId(), doc.RequestedBy__c, 'Requester should be tracked');
        Assert.areEqual(0, Integer.valueOf(doc.Attempts__c), 'Attempts should start at 0');
        Assert.areEqual(0, Integer.valueOf(doc.Priority__c), 'Priority should default to 0');
    }

    @IsTest
    static void testStartCompositeGenerationPassesReadOnlyWordOption() {
        DocgenTestDataFactory.CompositeScenario scenario =
            DocgenTestDataFactory.createCompositeScenario('Account', 1, 'Concatenate Templates');
        String recordIds = JSON.serialize(new Map<String, String>{
            'accountId' => String.valueOf(scenario.testRecordId)
        });

        Test.startTest();
        DocgenAsyncController.StartResult result = DocgenAsyncController.startCompositeGeneration(
            scenario.compositeDoc.Id,
            recordIds,
            'DOCX',
            false,
            true
        );
        Test.stopTest();

        Assert.areEqual(true, getRequestOptions(result.generatedDocumentId).get('readOnlyWord'),
            'Queued composite generation should pass the read-only Word option');
    }

    @IsTest
    static void testStartCompositeGenerationPreviewModeCreatesPendingPreviewDocument() {
        DocgenTestDataFactory.CompositeScenario scenario =
            DocgenTestDataFactory.createCompositeScenario('Account', 2, 'Concatenate Templates');
        String recordIds = JSON.serialize(new Map<String, String>{
            'accountId' => String.valueOf(scenario.testRecordId)
        });

        Test.startTest();
        DocgenAsyncController.StartResult firstResult = DocgenAsyncController.startCompositeGeneration(
            scenario.compositeDoc.Id,
            recordIds,
            'PDF',
            true
        );
        DocgenAsyncController.StartResult secondResult = DocgenAsyncController.startCompositeGeneration(
            scenario.compositeDoc.Id,
            recordIds,
            'PDF',
            true
        );
        Test.stopTest();

        Assert.areNotEqual(firstResult.generatedDocumentId, secondResult.generatedDocumentId,
            'Preview composite generations should create separate rows');
        Assert.isTrue(firstResult.isPreviewPending, 'Preview mode should mark the document pending preview');

        Generated_Document__c doc = [
            SELECT PendingPreview__c, RequestHash__c, Composite_Document__c
            FROM Generated_Document__c
            WHERE Id = :firstResult.generatedDocumentId
        ];
        Assert.isTrue(doc.PendingPreview__c, 'Generated document should be marked pending preview');
        Assert.areEqual(scenario.compositeDoc.Id, doc.Composite_Document__c, 'Composite lookup should be set');
        Assert.isTrue(doc.RequestHash__c.startsWith('sha256:'), 'Preview request hash should retain sha256 format');
        Assert.areEqual(71, doc.RequestHash__c.length(), 'Preview request hash should fit the unique field length');
    }

    @IsTest
    static void testSaveGeneratedDocumentLinksPendingCompositePreviewFile() {
        DocgenTestDataFactory.CompositeScenario scenario =
            DocgenTestDataFactory.createCompositeScenario('Account', 2, 'Concatenate Templates');
        ContentVersion cv = createTestContentVersion('Composite Preview Save Document');
        String recordIds = JSON.serialize(new Map<String, String>{
            'accountId' => String.valueOf(scenario.testRecordId)
        });

        DocgenAsyncController.StartResult startResult = DocgenAsyncController.startCompositeGeneration(
            scenario.compositeDoc.Id,
            recordIds,
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
            AND LinkedEntityId = :scenario.testRecordId
        ], 'Pending composite preview files should not be linked by the trigger');

        Test.startTest();
        DocgenAsyncController.StatusResult saveResult = DocgenAsyncController.saveGeneratedDocument(startResult.generatedDocumentId);
        Test.stopTest();

        Assert.areEqual('SUCCEEDED', saveResult.status, 'Saved preview should remain succeeded');
        Assert.isFalse(saveResult.isPreviewPending, 'Saved preview should no longer be pending');
        Assert.areEqual(cv.Id, saveResult.contentVersionId, 'Save should expose the ContentVersion only after pending state clears');
        Assert.areEqual(
            '/sfc/servlet.shepherd/version/download/' + cv.Id,
            saveResult.downloadUrl,
            'Save should expose the download URL only after pending state clears'
        );
        Assert.isNotNull(saveResult.previewUrl, 'Save should expose the Salesforce file URL after pending state clears');
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE ContentDocumentId = :cv.ContentDocumentId
            AND LinkedEntityId = :scenario.testRecordId
        ], 'Save should link the composite file to the primary parent record');
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
    static void testGetGenerationStatusRedactsPendingFileReferences() {
        Generated_Document__c doc = createPendingPreviewDocument(
            'SUCCEEDED',
            'PDF',
            '068000000000002AAA'
        );

        Test.startTest();
        DocgenAsyncController.StatusResult result = DocgenAsyncController.getGenerationStatus(doc.Id);
        Test.stopTest();

        Assert.areEqual('SUCCEEDED', result.status, 'Pending generated document status should still be returned');
        Assert.isTrue(result.isPreviewPending, 'Pending state should be returned without exposing the file');
        Assert.isNull(result.contentVersionId, 'Pending status must not expose a ContentVersion ID');
        Assert.isNull(result.contentDocumentId, 'Pending status must not expose a ContentDocument ID');
        Assert.isNull(result.downloadUrl, 'Pending status must not expose a download URL');
        Assert.isNull(result.previewUrl, 'Pending status must not expose a Salesforce file URL');
    }

    @IsTest
    static void testGetPdfPreviewPageUsesConfiguredBackendContract() {
        Generated_Document__c doc = createPendingPreviewDocument(
            'SUCCEEDED',
            'PDF',
            '068000000000003AAA'
        );
        insert new Docgen_Settings__c(
            SetupOwnerId = UserInfo.getOrganizationId(),
            Named_Credential_Name__c = 'Docgen_Node_API_CI'
        );
        String responseBody = JSON.serialize(new Map<String, Object>{
            'contentType' => 'image/jpeg',
            'base64Data' => EncodingUtil.base64Encode(Blob.valueOf('Rendered page two')),
            'pageNumber' => 2,
            'pageCount' => 24,
            'previewPageCount' => 20,
            'previewTruncated' => true
        });
        Test.setMock(
            HttpCalloutMock.class,
            new PdfPreviewCalloutMock(200, responseBody, doc.Id, 2, 'Docgen_Node_API_CI')
        );

        Test.startTest();
        DocgenAsyncController.PdfPreviewPage result = DocgenAsyncController.getPdfPreviewPage(doc.Id, 2);
        Test.stopTest();

        Assert.areEqual('image/jpeg', result.contentType, 'Rendered page should retain its safe image content type');
        Assert.areEqual(2, result.pageNumber, 'Requested page should be returned');
        Assert.areEqual(24, result.pageCount, 'Actual PDF page count should be returned');
        Assert.areEqual(20, result.previewPageCount, 'Preview navigation should be capped at 20 pages');
        Assert.isTrue(result.previewTruncated, 'PDFs longer than 20 pages should be marked truncated');
        Assert.areEqual(
            EncodingUtil.base64Encode(Blob.valueOf('Rendered page two')),
            result.base64Data,
            'Only the rendered page image should be returned'
        );
    }

    @IsTest
    static void testGetPdfPreviewPageRejectsInvalidIdentifiersAndPageNumbers() {
        Generated_Document__c doc = createPendingPreviewDocument(
            'SUCCEEDED',
            'PDF',
            '068000000000004AAA'
        );
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        try {
            DocgenAsyncController.getPdfPreviewPage(null, 1);
            Assert.fail('A generated document ID should be required');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('Generated Document ID is required'), 'Null ID should fail clearly');
        }
        try {
            DocgenAsyncController.getPdfPreviewPage(account.Id, 1);
            Assert.fail('An ID for another object should be rejected');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('valid Generated Document ID'), 'Wrong object ID should fail clearly');
        }
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, null);
            Assert.fail('A preview page number should be required');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('positive integer'), 'Null page should fail clearly');
        }
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 0);
            Assert.fail('Page zero should be rejected');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('positive integer'), 'Page zero should fail clearly');
        }
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, -1);
            Assert.fail('Negative pages should be rejected');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('positive integer'), 'Negative page should fail clearly');
        }
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 21);
            Assert.fail('Pages after the preview cap should be rejected');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('first 20 pages'), 'Preview cap should fail clearly');
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetPdfPreviewPageRejectsInvalidDocumentStates() {
        Generated_Document__c doc = createPendingPreviewDocument(
            'QUEUED',
            'PDF',
            '068000000000005AAA'
        );

        Test.startTest();
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 1);
            Assert.fail('Queued documents should not be previewed');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('successfully generated'), 'Queued state should fail clearly');
        }

        update new Generated_Document__c(Id = doc.Id, Status__c = 'SUCCEEDED', PendingPreview__c = false);
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 1);
            Assert.fail('Saved documents should not use the pending page endpoint');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('pending preview'), 'Saved state should fail clearly');
        }

        update new Generated_Document__c(Id = doc.Id, PendingPreview__c = true, OutputFormat__c = 'DOCX');
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 1);
            Assert.fail('DOCX documents should not use PDF page preview');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('Only PDF documents'), 'Non-PDF state should fail clearly');
        }

        update new Generated_Document__c(Id = doc.Id, OutputFormat__c = 'PDF', OutputFileId__c = null);
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 1);
            Assert.fail('A pending PDF without an output file should not be previewed');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('does not have a PDF file'), 'Missing output should fail clearly');
        }
        Test.stopTest();
    }

    @IsTest
    static void testPendingPreviewOperationsRequireRequestingUser() {
        User otherUser = createOtherUser();
        Generated_Document__c doc;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            doc = createPendingPreviewDocument(
                'SUCCEEDED',
                'PDF',
                '068000000000006AAA'
            );
            update new Generated_Document__c(Id = doc.Id, RequestedBy__c = otherUser.Id);
        }

        Test.startTest();
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 1);
            Assert.fail('A non-requesting user should not render a pending preview page');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('requesting user'), 'Page authorization should fail clearly');
        }
        try {
            DocgenAsyncController.saveGeneratedDocument(doc.Id);
            Assert.fail('A non-requesting user should not save a pending preview');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('requesting user'), 'Save authorization should fail clearly');
        }
        try {
            DocgenAsyncController.cancelGeneratedDocument(doc.Id);
            Assert.fail('A non-requesting user should not cancel a pending preview');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('requesting user'), 'Cancel authorization should fail clearly');
        }
        Test.stopTest();

        Assert.areEqual(1, [SELECT COUNT() FROM Generated_Document__c WHERE Id = :doc.Id], 'Unauthorized cancel must not delete the row');
    }

    @IsTest
    static void testGetPdfPreviewPageSanitizesBackendErrors() {
        Generated_Document__c doc = createPendingPreviewDocument(
            'SUCCEEDED',
            'PDF',
            '068000000000007AAA'
        );
        Test.setMock(
            HttpCalloutMock.class,
            new PdfPreviewCalloutMock(
                500,
                '{"message":"ENOENT /tmp/private.pdf","stack":"secret-stack","correlationId":"preview-ref-123"}',
                doc.Id,
                1,
                'Docgen_Node_API'
            )
        );

        Test.startTest();
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 1);
            Assert.fail('Backend failure should be surfaced as a safe preview error');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('temporarily unavailable'), 'Backend failures should be actionable');
            Assert.isTrue(e.getMessage().contains('preview-ref-123'), 'Safe backend reference should be retained');
            Assert.isFalse(e.getMessage().contains('ENOENT'), 'Raw backend details must not be exposed');
            Assert.isFalse(e.getMessage().contains('/tmp/'), 'Backend file paths must not be exposed');
            Assert.isFalse(e.getMessage().contains('secret-stack'), 'Backend stack traces must not be exposed');
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetPdfPreviewPageRejectsMalformedSuccessResponse() {
        Generated_Document__c doc = createPendingPreviewDocument(
            'SUCCEEDED',
            'PDF',
            '068000000000008AAA'
        );
        Test.setMock(
            HttpCalloutMock.class,
            new PdfPreviewCalloutMock(
                200,
                '{"contentType":"application/pdf","base64Data":"complete-pdf"}',
                doc.Id,
                1,
                'Docgen_Node_API'
            )
        );

        Test.startTest();
        try {
            DocgenAsyncController.getPdfPreviewPage(doc.Id, 1);
            Assert.fail('A malformed or full-PDF response should be rejected');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('invalid response'), 'Malformed responses should fail safely');
            Assert.isFalse(e.getMessage().contains('complete-pdf'), 'Response content must not leak through the error');
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetPdfPreviewContentReturnsPdfBytes() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Async Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];
        ContentVersion cv = createTestContentVersion('Inline Preview Document');
        Generated_Document__c doc = DocgenTestDataFactory.createGeneratedDocument(template.Id, account.Id, 'SUCCEEDED');
        update new Generated_Document__c(Id = doc.Id, OutputFileId__c = cv.Id, PendingPreview__c = false);

        Test.startTest();
        DocgenAsyncController.PreviewContent preview = DocgenAsyncController.getPdfPreviewContent(doc.Id);
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
    static void testGetPdfPreviewContentRejectsPendingPreview() {
        ContentVersion cv = createTestContentVersion('Pending Full PDF');
        Generated_Document__c doc = createPendingPreviewDocument('SUCCEEDED', 'PDF', cv.Id);

        Test.startTest();
        try {
            DocgenAsyncController.getPdfPreviewContent(doc.Id);
            Assert.fail('Pending previews must not return complete PDF bytes');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('complete PDF is unavailable'), 'Pending full-PDF access should fail clearly');
        }
        Test.stopTest();
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
        Assert.areEqual(cv.Id, saveResult.contentVersionId, 'Save should expose the ContentVersion only after pending state clears');
        Assert.areEqual(
            '/sfc/servlet.shepherd/version/download/' + cv.Id,
            saveResult.downloadUrl,
            'Save should expose the download URL only after pending state clears'
        );
        Assert.isNotNull(saveResult.previewUrl, 'Save should expose the Salesforce file URL after pending state clears');
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
