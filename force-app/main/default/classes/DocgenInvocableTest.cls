@IsTest
private class DocgenInvocableTest {
    @testSetup
    static void setup() {
        DocgenTestDataFactory.createTemplate(
            'Invocable Account Template',
            'Account',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId'
        );
        DocgenTestDataFactory.createAccount('Invocable Account Ltd');
    }

    private static DocgenInvocable.GenerateRequest buildRequest(String templateId, String templateName, String recordId, String outputFormat) {
        DocgenInvocable.GenerateRequest request = new DocgenInvocable.GenerateRequest();
        request.templateId = templateId;
        request.templateName = templateName;
        request.recordId = recordId;
        request.outputFormat = outputFormat;
        return request;
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
    static void testGenerateByTemplateIdQueuesDocument() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(template.Id, null, account.Id, 'PDF')
            }
        );
        Test.stopTest();

        Assert.areEqual(1, results.size(), 'One result should be returned per request');
        DocgenInvocable.GenerateResult result = results[0];
        Assert.isTrue(result.success, 'Generation should be queued successfully');
        Assert.isNull(result.errorMessage, 'No error message expected on success');
        Assert.areEqual('QUEUED', result.status, 'Document should be queued for worker processing');
        Assert.isNotNull(result.generatedDocumentId, 'Generated document ID should be returned');

        Generated_Document__c doc = [
            SELECT Status__c, Template__c, Account__c, OutputFormat__c, RequestJSON__c, PendingPreview__c
            FROM Generated_Document__c
            WHERE Id = :result.generatedDocumentId
        ];
        Assert.areEqual('QUEUED', doc.Status__c, 'Document should be queued');
        Assert.areEqual(template.Id, doc.Template__c, 'Template lookup should be set');
        Assert.areEqual(account.Id, doc.Account__c, 'Parent lookup should be set');
        Assert.areEqual('PDF', doc.OutputFormat__c, 'Output format should be stored');
        Assert.isNotNull(doc.RequestJSON__c, 'Request JSON should be stored for the worker');
        Assert.isFalse(doc.PendingPreview__c, 'Flow generation should not use preview mode');
    }

    @IsTest
    static void testGenerateByTemplateNameQueuesDocument() {
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(null, 'Invocable Account Template', account.Id, 'DOCX')
            }
        );
        Test.stopTest();

        Assert.isTrue(results[0].success, 'Generation should be queued by template name');
        Generated_Document__c doc = [
            SELECT Status__c, OutputFormat__c
            FROM Generated_Document__c
            WHERE Id = :results[0].generatedDocumentId
        ];
        Assert.areEqual('QUEUED', doc.Status__c, 'Document should be queued');
        Assert.areEqual('DOCX', doc.OutputFormat__c, 'Requested output format should be stored');
    }

    @IsTest
    static void testGenerateQueuesXlsxDocument() {
        Docgen_Template__c template = [
            SELECT Id
            FROM Docgen_Template__c
            WHERE Name = 'Invocable Account Template'
            LIMIT 1
        ];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(template.Id, null, account.Id, 'XLSX')
            }
        );
        Test.stopTest();

        Assert.isTrue(results[0].success, 'XLSX generation should be queued');
        Generated_Document__c doc = [
            SELECT Status__c, OutputFormat__c, RequestJSON__c
            FROM Generated_Document__c
            WHERE Id = :results[0].generatedDocumentId
        ];
        Assert.areEqual('QUEUED', doc.Status__c, 'XLSX document should be queued');
        Assert.areEqual('XLSX', doc.OutputFormat__c, 'XLSX output format should be stored');
        Assert.isTrue(
            doc.RequestJSON__c.contains('"outputFormat":"XLSX"'),
            'Worker request should include XLSX output format'
        );
    }

    @IsTest
    static void testGeneratePassesReadOnlyWordOption() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        DocgenInvocable.GenerateRequest request = buildRequest(template.Id, null, account.Id, 'DOCX');
        request.readOnlyWord = true;

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{ request }
        );
        Test.stopTest();

        Assert.isTrue(results[0].success, 'Generation should be queued successfully');
        Assert.areEqual(true, getRequestOptions(results[0].generatedDocumentId).get('readOnlyWord'),
            'Flow generation should pass the read-only Word option');
    }

    @IsTest
    static void testGenerateDefaultsReadOnlyWordToFalseWhenNull() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(template.Id, null, account.Id, 'DOCX')
            }
        );
        Test.stopTest();

        Assert.isTrue(results[0].success, 'Generation should be queued successfully');
        Assert.areEqual(false, getRequestOptions(results[0].generatedDocumentId).get('readOnlyWord'),
            'Omitted read-only Word option should default to false');
    }

    @IsTest
    static void testGenerateUsesTemplateDefaultOutputFormatWhenBlank() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];
        update new Docgen_Template__c(Id = template.Id, Default_Output_Format__c = 'PPTX');
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(template.Id, null, account.Id, null)
            }
        );
        Test.stopTest();

        Assert.isTrue(results[0].success, 'Generation should succeed with blank output format');
        Generated_Document__c doc = [
            SELECT OutputFormat__c
            FROM Generated_Document__c
            WHERE Id = :results[0].generatedDocumentId
        ];
        Assert.areEqual('PPTX', doc.OutputFormat__c, 'Blank request should use the template default output format');
    }

    @IsTest
    static void testGenerateBulkRequests() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];
        List<Account> accounts = DocgenTestDataFactory.createAccounts(3);

        List<DocgenInvocable.GenerateRequest> requests = new List<DocgenInvocable.GenerateRequest>();
        for (Account account : accounts) {
            requests.add(buildRequest(template.Id, null, account.Id, 'PDF'));
        }

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(requests);
        Test.stopTest();

        Assert.areEqual(3, results.size(), 'One result should be returned per request');
        Set<Id> docIds = new Set<Id>();
        for (DocgenInvocable.GenerateResult result : results) {
            Assert.isTrue(result.success, 'All requests should queue successfully');
            docIds.add(result.generatedDocumentId);
        }
        Assert.areEqual(3, docIds.size(), 'Each request should create its own document');
        Assert.areEqual(
            3,
            [SELECT COUNT() FROM Generated_Document__c WHERE Status__c = 'QUEUED'],
            'All documents should be queued'
        );
    }

    @IsTest
    static void testGenerateReturnsErrorForMissingTemplate() {
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(null, 'Nonexistent Template', account.Id, 'PDF')
            }
        );
        Test.stopTest();

        Assert.isFalse(results[0].success, 'Missing template should fail the request');
        Assert.isNotNull(results[0].errorMessage, 'Error message should be populated');
        Assert.isNull(results[0].generatedDocumentId, 'No document should be created');
    }

    @IsTest
    static void testGenerateReturnsErrorForBlankTemplateReference() {
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(null, null, account.Id, 'PDF')
            }
        );
        Test.stopTest();

        Assert.isFalse(results[0].success, 'Blank template reference should fail the request');
        Assert.isNotNull(results[0].errorMessage, 'Error message should be populated');
    }

    @IsTest
    static void testGenerateReturnsErrorForInvalidRecordId() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(template.Id, null, 'not-an-id', 'PDF')
            }
        );
        Test.stopTest();

        Assert.isFalse(results[0].success, 'Invalid record ID should fail the request');
        Assert.isTrue(results[0].errorMessage.contains('Record ID'), 'Error should identify the invalid parameter');
    }

    @IsTest
    static void testGenerateOneFailureDoesNotAffectOtherRequests() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> results = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(null, 'Nonexistent Template', account.Id, 'PDF'),
                buildRequest(template.Id, null, account.Id, 'PDF')
            }
        );
        Test.stopTest();

        Assert.isFalse(results[0].success, 'First request should fail');
        Assert.isTrue(results[1].success, 'Second request should still succeed');
        Assert.areEqual('QUEUED', results[1].status, 'Second request should be queued');
    }

    @IsTest
    static void testGenerateReusesExistingQueuedDocument() {
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Invocable Account Template' LIMIT 1];
        Account account = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<DocgenInvocable.GenerateResult> firstResults = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(template.Id, null, account.Id, 'PDF')
            }
        );
        List<DocgenInvocable.GenerateResult> secondResults = DocgenInvocable.generate(
            new List<DocgenInvocable.GenerateRequest>{
                buildRequest(template.Id, null, account.Id, 'PDF')
            }
        );
        Test.stopTest();

        Assert.isTrue(secondResults[0].success, 'Duplicate request should succeed');
        Assert.areEqual(
            firstResults[0].generatedDocumentId,
            secondResults[0].generatedDocumentId,
            'Duplicate request should reuse the existing queued document'
        );
    }
}
