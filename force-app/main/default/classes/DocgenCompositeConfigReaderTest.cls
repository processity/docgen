@IsTest
private class DocgenCompositeConfigReaderTest {
    @IsTest
    static void resolvesOnlyMatchingActiveConfiguration() {
        Composite_Document__c expected = createComposite(
            'Quote Template English',
            'SBQQ__Quote__c',
            true
        );
        insert new List<Composite_Document__c>{
            expected,
            createComposite('Quote Template English', 'Account', true),
            createComposite('Quote Template Japanese', 'SBQQ__Quote__c', false)
        };

        expected = [
            SELECT Id, Name
            FROM Composite_Document__c
            WHERE Id = :expected.Id
        ];

        System.assertEquals(
            expected.Id,
            DocgenCompositeConfigReader.findActiveCompositeDocumentId(
                'SBQQ__Quote__c',
                'Quote Template English'
            )
        );
        System.assertEquals(
            expected.Id,
            DocgenCompositeConfigReader.findActiveCompositeDocumentId('SBQQ__Quote__c', expected.Name),
            'The generated record name must remain a supported exact identifier.'
        );
        System.assertEquals(
            null,
            DocgenCompositeConfigReader.findActiveCompositeDocumentId(
                'SBQQ__Quote__c',
                'Quote Template Japanese'
            ),
            'Inactive configuration must not be selected.'
        );
    }

    @IsTest
    static void loadsCompositeConfigurationAndHandlesBlankInput() {
        Composite_Document__c composite = createComposite(
            'Quote Template English',
            'SBQQ__Quote__c',
            true
        );
        composite.Default_Output_Format__c = 'PDF';
        insert composite;

        Composite_Document__c loaded = DocgenCompositeConfigReader.loadComposite(composite.Id);

        System.assertEquals(composite.Id, loaded.Id);
        System.assertEquals('SBQQ__Quote__c', DocgenCompositeConfigReader.getPrimaryParent(composite.Id));
        System.assertEquals('PDF', DocgenCompositeConfigReader.getDefaultOutputFormat(composite.Id));
        System.assertEquals(null, DocgenCompositeConfigReader.loadComposite(null));
        System.assertEquals(
            null,
            DocgenCompositeConfigReader.findActiveCompositeDocumentId(null, 'Quote Template English')
        );
    }

    private static Composite_Document__c createComposite(
        String description,
        String primaryParent,
        Boolean isActive
    ) {
        return new Composite_Document__c(
            Description__c = description,
            Template_Strategy__c = 'Concatenate Templates',
            PrimaryParent__c = primaryParent,
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = false,
            IsActive__c = isActive
        );
    }
}
