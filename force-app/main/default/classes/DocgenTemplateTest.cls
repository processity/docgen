/**
 * Test class for Docgen_Template__c custom object.
 *
 * Tests verify behavior-focused scenarios:
 * - Template configuration for different data sources
 * - Default value behavior
 * - Option combinations and their effects
 * - Template versioning (ContentVersionId changes)
 */
@isTest
private class DocgenTemplateTest {

    /**
     * Test: SOQL-based template configuration
     * Given: Template configured with SOQL data source
     * When: Template is used for document generation
     * Then: Template provides correct configuration for SOQL provider
     */
    @isTest
    static void testSOQLTemplateConfiguration() {
        // Given: Template configured with SOQL data source

        // When: Insert SOQL-based template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Account Summary SOQL',
            TemplateContentVersionId__c = '0681e000000000AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );

        Test.startTest();
        insert template;
        Test.stopTest();

        // Then: Template configuration should be complete for SOQL usage
        Docgen_Template__c inserted = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c, PrimaryParent__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.areEqual('SOQL', inserted.DataSource__c, 'Should use SOQL data source');
        Assert.isNotNull(inserted.SOQL__c, 'SOQL query should be populated');
        Assert.isTrue(inserted.SOQL__c.contains(':recordId'),
            'SOQL should use :recordId binding variable');
        Assert.areEqual('Account', inserted.PrimaryParent__c,
            'PrimaryParent should indicate target object type');
    }

    /**
     * Test: Custom provider template configuration
     * Given: Template configured with Custom data source
     * When: Template specifies a custom provider class
     * Then: Template provides correct configuration for custom provider
     */
    @isTest
    static void testCustomProviderConfiguration() {
        // Given: Template configured with custom provider

        // When: Insert custom provider template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Custom Provider Template',
            TemplateContentVersionId__c = '0681e000000000BBB',
            DataSource__c = 'Custom',
            ClassName__c = 'MockCustomProvider',
            StoreMergedDocx__c = true,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account'
        );

        Test.startTest();
        insert template;
        Test.stopTest();

        // Then: Template configuration should be complete for custom provider usage
        Docgen_Template__c inserted = [
            SELECT Id, DataSource__c, ClassName__c, SOQL__c,
                   StoreMergedDocx__c, ReturnDocxToBrowser__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.areEqual('Custom', inserted.DataSource__c, 'Should use Custom data source');
        Assert.areEqual('MockCustomProvider', inserted.ClassName__c,
            'ClassName should specify custom provider');
        Assert.isNull(inserted.SOQL__c,
            'SOQL should be null for custom provider (not used)');
        Assert.isTrue(inserted.StoreMergedDocx__c,
            'StoreMergedDocx should be enabled');
        Assert.isFalse(inserted.ReturnDocxToBrowser__c,
            'ReturnDocxToBrowser should be disabled');
    }

    /**
     * Test: Default option behavior for interactive generation
     * Given: Template created without explicit option values
     * When: Template is used for interactive document generation
     * Then: Default options optimize for browser delivery (not storage)
     */
    @isTest
    static void testDefaultOptionsForInteractiveGeneration() {
        // Given: Template without explicit option values

        // When: Insert template with defaults
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Interactive Template',
            TemplateContentVersionId__c = '0681e000000000CCC',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId'
            // Omit StoreMergedDocx__c and ReturnDocxToBrowser__c to test defaults
        );

        Test.startTest();
        insert template;
        Test.stopTest();

        // Then: Default options should favor interactive usage
        Docgen_Template__c inserted = [
            SELECT StoreMergedDocx__c, ReturnDocxToBrowser__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        // Behavior: StoreMergedDocx defaults to false (don't store intermediate DOCX)
        Assert.isFalse(inserted.StoreMergedDocx__c,
            'StoreMergedDocx should default to false (storage optimization)');

        // Behavior: ReturnDocxToBrowser defaults to true (enable browser download)
        Assert.isTrue(inserted.ReturnDocxToBrowser__c,
            'ReturnDocxToBrowser should default to true (interactive UX)');
    }

    /**
     * Test: Template versioning behavior (ContentVersionId change)
     * Given: Existing template with ContentVersionId
     * When: Template file is updated (new ContentVersionId)
     * Then: Template references new version for generation
     */
    @isTest
    static void testTemplateVersioning() {
        // Given: Existing template with original ContentVersionId
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Versioned Template',
            TemplateContentVersionId__c = '0681e000000000DDD',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );
        insert template;

        // When: Template file is updated (simulated by changing ContentVersionId)
        String originalVersionId = template.TemplateContentVersionId__c;
        template.TemplateContentVersionId__c = '0681e000000000EEE'; // New version

        Test.startTest();
        update template;
        Test.stopTest();

        // Then: Template should reference new version
        Docgen_Template__c updated = [
            SELECT TemplateContentVersionId__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.areNotEqual(originalVersionId, updated.TemplateContentVersionId__c,
            'ContentVersionId should change to new version');
        Assert.areEqual('0681e000000000EEE', updated.TemplateContentVersionId__c,
            'Should reference new template version');
    }

    /**
     * Test: Switching from SOQL to Custom provider
     * Given: Template initially configured with SOQL
     * When: Admin switches to Custom provider
     * Then: Configuration updates correctly for new data source
     */
    @isTest
    static void testDataSourceMigration() {
        // Given: Template initially configured with SOQL
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Migrating Template',
            TemplateContentVersionId__c = '0681e000000000FFF',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );
        insert template;

        // When: Admin switches to Custom provider
        template.DataSource__c = 'Custom';
        template.ClassName__c = 'CustomDataProvider';
        // Note: SOQL__c remains (not nulled out) but won't be used

        Test.startTest();
        update template;
        Test.stopTest();

        // Then: Configuration should reflect new data source
        Docgen_Template__c updated = [
            SELECT DataSource__c, ClassName__c, SOQL__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.areEqual('Custom', updated.DataSource__c,
            'DataSource should be updated to Custom');
        Assert.areEqual('CustomDataProvider', updated.ClassName__c,
            'ClassName should specify custom provider');
        Assert.isNotNull(updated.SOQL__c,
            'SOQL__c persists but is not used when DataSource=Custom');
    }

    /**
     * Test: Multiple templates for different objects
     * Given: Organization needs templates for Account, Opportunity, and Case
     * When: Multiple templates configured for different primary parents
     * Then: Each template can be queried by its primary parent type
     */
    @isTest
    static void testMultipleTemplatesForDifferentObjects() {
        // Given: Templates for different object types
        List<Docgen_Template__c> templates = new List<Docgen_Template__c>{
            new Docgen_Template__c(
                Name = 'Account Invoice',
                TemplateContentVersionId__c = '0681e000000000GGG',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
                PrimaryParent__c = 'Account'
            ),
            new Docgen_Template__c(
                Name = 'Opportunity Quote',
                TemplateContentVersionId__c = '0681e000000000HHH',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id, Name FROM Opportunity WHERE Id = :recordId',
                PrimaryParent__c = 'Opportunity'
            ),
            new Docgen_Template__c(
                Name = 'Case Report',
                TemplateContentVersionId__c = '0681e000000000III',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id, Subject FROM Case WHERE Id = :recordId',
                PrimaryParent__c = 'Case'
            )
        };

        Test.startTest();
        insert templates;
        Test.stopTest();

        // Then: Templates can be queried by primary parent type
        List<Docgen_Template__c> accountTemplates = [
            SELECT Id, Name
            FROM Docgen_Template__c
            WHERE PrimaryParent__c = 'Account'
        ];

        List<Docgen_Template__c> oppTemplates = [
            SELECT Id, Name
            FROM Docgen_Template__c
            WHERE PrimaryParent__c = 'Opportunity'
        ];

        List<Docgen_Template__c> caseTemplates = [
            SELECT Id, Name
            FROM Docgen_Template__c
            WHERE PrimaryParent__c = 'Case'
        ];

        Assert.areEqual(1, accountTemplates.size(),
            'Should have 1 Account template');
        Assert.areEqual('Account Invoice', accountTemplates[0].Name);

        Assert.areEqual(1, oppTemplates.size(),
            'Should have 1 Opportunity template');
        Assert.areEqual('Opportunity Quote', oppTemplates[0].Name);

        Assert.areEqual(1, caseTemplates.size(),
            'Should have 1 Case template');
        Assert.areEqual('Case Report', caseTemplates[0].Name);
    }

    /**
     * Test: Batch-optimized template configuration
     * Given: Template configured for batch generation
     * When: Template specifies options for storage optimization
     * Then: Options favor storage over browser delivery
     */
    @isTest
    static void testBatchOptimizedTemplateConfiguration() {
        // Given: Template configured for batch generation

        // When: Insert template with batch-optimized options
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Batch Template',
            TemplateContentVersionId__c = '0681e000000000JJJ',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            StoreMergedDocx__c = true, // Store intermediate DOCX for audit
            ReturnDocxToBrowser__c = false, // Not used in batch (no browser)
            PrimaryParent__c = 'Account'
        );

        Test.startTest();
        insert template;
        Test.stopTest();

        // Then: Options should reflect batch optimization
        Docgen_Template__c inserted = [
            SELECT StoreMergedDocx__c, ReturnDocxToBrowser__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.isTrue(inserted.StoreMergedDocx__c,
            'Batch templates store merged DOCX for audit trail');
        Assert.isFalse(inserted.ReturnDocxToBrowser__c,
            'Batch templates do not return to browser');
    }
}
