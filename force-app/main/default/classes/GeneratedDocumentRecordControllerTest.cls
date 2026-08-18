@isTest
private class GeneratedDocumentRecordControllerTest {
    @isTest
    static void returnsFilesLookupsAndCollapsedPayloadData() {
        assignDocgenUserPermissionSet();

        Docgen_Template__c template = DocgenTestDataFactory.createTemplate(
            'Record View Template',
            'Account',
            'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );
        Account account = DocgenTestDataFactory.createAccount('Record View Account');
        ContentVersion output = createFile('Generated Offer', 'pdf', account.Id);
        ContentVersion mergedDocx = createFile('Merged Offer', 'docx', account.Id);

        Generated_Document__c document = new Generated_Document__c(
            Template__c = template.Id,
            Account__c = account.Id,
            RequestHash__c = 'sha256:record-view',
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            OutputFileId__c = output.Id,
            MergedDocxFileId__c = mergedDocx.Id,
            Error__c = '{"code":"TEST_ERROR","message":"Example"}',
            Attachment_Warnings__c = '[{"code":"SKIPPED"}]'
        );
        DocgenEnvelopeService.setRequestJSONSegments(
            document,
            '{"parents":{"AccountId":"' + account.Id + '"},"outputFormat":"PDF"}'
        );
        insert document;

        GeneratedDocumentRecordController.RecordView view;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            view = GeneratedDocumentRecordController.getRecordView(document.Id);
            Test.stopTest();
        }

        Assert.areEqual(2, view.files.size(), 'Both generated files should be available');
        Assert.areEqual('Generated output', view.files[0].role, 'The primary file role should be clear');
        Assert.areEqual(
            output.ContentDocumentId,
            view.files[0].contentDocumentId,
            'The tile should link to the ContentDocument'
        );
        Assert.areEqual(
            'Generated Offer.pdf',
            view.files[0].displayName,
            'The extension should be included in the displayed file name'
        );
        Assert.areEqual('Merged DOCX', view.files[1].role, 'The secondary file should be identified');

        Assert.areEqual(1, view.lookupFields.size(), 'Only the populated source lookup should display');
        Assert.areEqual(
            Generated_Document__c.Account__c.getDescribe().getName(),
            view.lookupFields[0].fieldApiName,
            'The dynamic lookup API name should be returned'
        );

        Assert.areEqual(4, view.payloads.size(), 'Request, response, error, and warnings should display');
        Assert.areEqual('Request JSON', view.payloads[0].label, 'The request should be the first payload');
        Assert.isTrue(view.payloads[0].value.contains('\n'), 'JSON should be formatted for readability');
        Assert.areEqual('Response', view.payloads[1].label, 'The generated result should follow the request');
        Assert.isTrue(
            view.payloads[1].value.contains(output.Id),
            'The response should identify the generated output file'
        );
        Assert.isTrue(
            view.summaryFieldApiNames.contains(Generated_Document__c.Status__c.getDescribe().getName()),
            'Status should be part of the summary'
        );
    }

    @isTest
    static void handlesARecordWithoutFilesOrPayloads() {
        Docgen_Template__c template = DocgenTestDataFactory.createTemplate(
            'Empty Record View Template',
            'Account',
            'SELECT Id FROM Account WHERE Id = :recordId'
        );
        Generated_Document__c document = new Generated_Document__c(
            Template__c = template.Id,
            RequestHash__c = 'sha256:empty-record-view',
            Status__c = 'QUEUED',
            OutputFormat__c = 'PDF'
        );
        insert document;

        Test.startTest();
        GeneratedDocumentRecordController.RecordView view =
            GeneratedDocumentRecordController.getRecordView(document.Id);
        Test.stopTest();

        Assert.areEqual(0, view.files.size(), 'No file tiles should be returned');
        Assert.areEqual(0, view.lookupFields.size(), 'Blank lookups should be omitted');
        Assert.areEqual(1, view.payloads.size(), 'A response summary should always be available');
        Assert.areEqual('Response', view.payloads[0].label, 'The response should identify the queued state');
        Assert.isTrue(view.payloads[0].value.contains('QUEUED'), 'The current status should be included');
    }

    @isTest
    static void rejectsARecordFromAnotherObject() {
        Account account = DocgenTestDataFactory.createAccount('Wrong Record Type');

        Test.startTest();
        try {
            GeneratedDocumentRecordController.getRecordView(account.Id);
            Assert.fail('An Account ID should not be accepted');
        } catch (AuraHandledException expected) {
            Assert.isNotNull(expected, 'The controller should reject another object type');
        }
        Test.stopTest();
    }

    private static ContentVersion createFile(String title, String extension, Id publishLocationId) {
        ContentVersion version = new ContentVersion(
            Title = title,
            PathOnClient = title + '.' + extension,
            VersionData = Blob.valueOf('test file content'),
            IsMajorVersion = true,
            FirstPublishLocationId = publishLocationId
        );
        insert version;
        return [
            SELECT Id, ContentDocumentId, Title, FileExtension, ContentSize, CreatedDate
            FROM ContentVersion
            WHERE Id = :version.Id
        ];
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
}
