@isTest
private class DocgenAdditionalPdfEnvelopeTest {
    private static ContentVersion createPdf(String title) {
        ContentVersion version = new ContentVersion(
            Title = title,
            PathOnClient = title + '.pdf',
            VersionData = Blob.valueOf('pdf')
        );
        insert version;
        return version;
    }

    @isTest
    static void singleTemplateIncludesAttachmentsInJsonAndHashForPdfOnly() {
        Account account = DocgenTestDataFactory.createAccount('Attachment Envelope Account');
        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Attachment Envelope Template',
            'Account',
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000101AAA',
            false,
            false,
            false
        );
        ContentVersion attachment = createPdf('Attachment');

        DocgenEnvelopeService.Envelope basePdf = DocgenEnvelopeService.build(
            account.Id, template, 'PDF', 'en-GB', 'Europe/London', false, (List<Id>) null
        );
        DocgenEnvelopeService.Envelope attachedPdf = DocgenEnvelopeService.build(
            account.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London',
            false,
            new List<Id>{ attachment.Id, attachment.Id }
        );

        Assert.areEqual(
            new List<String>{ String.valueOf(attachment.Id) },
            attachedPdf.additionalPdfContentVersionIds,
            'Attachments should be deduplicated while preserving order'
        );
        Assert.areNotEqual(basePdf.requestHash, attachedPdf.requestHash, 'PDF hash must include attachments');
        Assert.isTrue(
            DocgenEnvelopeService.toJSON(attachedPdf).contains('additionalPdfContentVersionIds'),
            'Request JSON should contain attachment IDs'
        );

        DocgenEnvelopeService.Envelope baseDocx = DocgenEnvelopeService.build(
            account.Id, template, 'DOCX', 'en-GB', 'Europe/London', false, (List<Id>) null
        );
        DocgenEnvelopeService.Envelope ignoredDocx = DocgenEnvelopeService.build(
            account.Id,
            template,
            'DOCX',
            'en-GB',
            'Europe/London',
            false,
            new List<Id>{ attachment.Id }
        );
        Assert.areEqual(baseDocx.requestHash, ignoredDocx.requestHash, 'DOCX hash must ignore attachments');
        Assert.isFalse(
            DocgenEnvelopeService.toJSON(ignoredDocx).contains('additionalPdfContentVersionIds'),
            'DOCX request JSON should omit attachment IDs'
        );

        DocgenEnvelopeService.Envelope basePptx = DocgenEnvelopeService.build(
            account.Id, template, 'PPTX', 'en-GB', 'Europe/London', false, (List<Id>) null
        );
        DocgenEnvelopeService.Envelope ignoredPptx = DocgenEnvelopeService.build(
            account.Id,
            template,
            'PPTX',
            'en-GB',
            'Europe/London',
            false,
            new List<Id>{ attachment.Id }
        );
        Assert.areEqual(basePptx.requestHash, ignoredPptx.requestHash, 'PPTX hash must ignore attachments');
        Assert.isFalse(
            DocgenEnvelopeService.toJSON(ignoredPptx).contains('additionalPdfContentVersionIds'),
            'PPTX request JSON should omit attachment IDs'
        );

        DocgenEnvelopeService.Envelope baseXlsx = DocgenEnvelopeService.build(
            account.Id, template, 'XLSX', 'en-GB', 'Europe/London', false, (List<Id>) null
        );
        DocgenEnvelopeService.Envelope ignoredXlsx = DocgenEnvelopeService.build(
            account.Id,
            template,
            'XLSX',
            'en-GB',
            'Europe/London',
            false,
            new List<Id>{ attachment.Id }
        );
        Assert.areEqual(baseXlsx.requestHash, ignoredXlsx.requestHash, 'XLSX hash must ignore attachments');
        Assert.isFalse(
            DocgenEnvelopeService.toJSON(ignoredXlsx).contains('additionalPdfContentVersionIds'),
            'XLSX request JSON should omit attachment IDs'
        );
    }

    @isTest
    static void compositeEnvelopeIncludesAttachments() {
        Account account = DocgenTestDataFactory.createAccount('Composite Attachment Account');
        Docgen_Template__c dataTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Composite Attachment Data',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000102AAA',
            false,
            false,
            false
        );
        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '068000000000103AAA',
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert composite;
        insert new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = dataTemplate.Id,
            Namespace__c = 'Account',
            Sequence__c = 1,
            IsActive__c = true
        );
        ContentVersion attachment = createPdf('Composite Attachment');

        DocgenEnvelopeService.Envelope envelope = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            new Map<String, Id>{ 'accountId' => account.Id },
            'PDF',
            'en-GB',
            'Europe/London',
            false,
            new List<Id>{ attachment.Id }
        );

        Assert.areEqual(
            new List<String>{ String.valueOf(attachment.Id) },
            envelope.additionalPdfContentVersionIds,
            'Composite envelope should include attachment IDs'
        );
    }
}
