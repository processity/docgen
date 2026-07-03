@isTest
private class DocgenAttachmentServiceTest {
    private static ContentVersion createFile(String title, String extension, Id publishLocationId) {
        ContentVersion version = new ContentVersion(
            Title = title,
            PathOnClient = title + '.' + extension,
            VersionData = Blob.valueOf('test file'),
            FirstPublishLocationId = publishLocationId
        );
        insert version;
        return [
            SELECT Id, ContentDocumentId, Title, FileExtension, FileType, ContentSize
            FROM ContentVersion
            WHERE Id = :version.Id
        ];
    }

    @isTest
    static void validatesPdfFilesInCallerOrderAndRemovesDuplicates() {
        Account account = new Account(Name = 'Attachment Account');
        insert account;
        ContentVersion first = createFile('First PDF', 'pdf', account.Id);
        ContentVersion second = createFile('Second PDF', 'pdf', account.Id);

        DocgenAttachmentService.ValidationResult result =
            DocgenAttachmentService.validateForGeneration(
                new List<Id>{ second.Id, first.Id, second.Id },
                'PDF'
            );

        Assert.areEqual(
            new List<Id>{ second.Id, first.Id },
            result.contentVersionIds,
            'PDF IDs should preserve first-seen order'
        );
        Assert.areEqual(0, result.warnings.size(), 'Valid PDFs should not produce warnings');
    }

    @isTest
    static void skipsNonPdfAndIgnoresAttachmentsForOtherOutputFormats() {
        Account account = new Account(Name = 'Non PDF Account');
        insert account;
        ContentVersion wordFile = createFile('Word File', 'docx', account.Id);

        DocgenAttachmentService.ValidationResult pdfResult =
            DocgenAttachmentService.validateForGeneration(
                new List<Id>{ wordFile.Id },
                'PDF'
            );
        Assert.areEqual(0, pdfResult.contentVersionIds.size(), 'DOCX should not be appended');
        Assert.areEqual('NOT_A_PDF', pdfResult.warnings[0].code, 'A warning should identify the type');

        DocgenAttachmentService.ValidationResult docxResult =
            DocgenAttachmentService.validateForGeneration(
                new List<Id>{ wordFile.Id },
                'DOCX'
            );
        Assert.areEqual(0, docxResult.contentVersionIds.size(), 'Non-PDF output should ignore IDs');
        Assert.areEqual(0, docxResult.warnings.size(), 'Ignored IDs should not produce warnings');
    }

    @isTest
    static void returnsLatestRelatedPdfFilesOnly() {
        Account account = new Account(Name = 'Related Files Account');
        insert account;
        ContentVersion pdf = createFile('Related PDF', 'pdf', account.Id);
        createFile('Related Word File', 'docx', account.Id);

        List<DocgenAttachmentService.RelatedPdfFile> files =
            DocgenAttachmentService.getRelatedPdfFiles(account.Id);

        Assert.areEqual(1, files.size(), 'Only related PDFs should be returned');
        Assert.areEqual(pdf.Id, files[0].contentVersionId, 'The PDF ContentVersion should be returned');
    }

    @isTest
    static void resolvesOutputFormatBeforeLoadingRelatedFiles() {
        Account account = new Account(Name = 'Context Account');
        insert account;
        createFile('Context PDF', 'pdf', account.Id);

        DocgenAttachmentService.AttachmentContext pdfContext =
            DocgenAttachmentService.getAttachmentContext(account.Id, null, null, null, 'PDF');
        Assert.areEqual('PDF', pdfContext.effectiveOutputFormat, 'PDF should be resolved');
        Assert.areEqual(1, pdfContext.files.size(), 'PDF context should include related files');

        DocgenAttachmentService.AttachmentContext docxContext =
            DocgenAttachmentService.getAttachmentContext(account.Id, null, null, null, 'DOCX');
        Assert.areEqual('DOCX', docxContext.effectiveOutputFormat, 'DOCX should be resolved');
        Assert.areEqual(0, docxContext.files.size(), 'DOCX context should not query or return files');
    }

    @isTest
    static void sortsSetInputsDeterministically() {
        Id first = (Id) '068000000000001';
        Id second = (Id) '068000000000002';
        List<Id> sorted = DocgenAttachmentService.sortSet(new Set<Id>{ second, first });
        Assert.areEqual(new List<Id>{ first, second }, sorted, 'Set helper should sort IDs');
    }
}
