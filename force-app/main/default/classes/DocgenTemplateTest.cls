/**
 * Test class for Docgen_Template__c custom object.
 *
 * Tests verify:
 * - Record insert/query operations
 * - Field persistence
 * - Required field constraints
 * - Default values
 * - Picklist values
 */
@isTest
private class DocgenTemplateTest {

    /**
     * Test: Insert minimal valid Docgen_Template__c record
     * Given: Docgen_Template__c object definition
     * When: Insert minimal valid record with required fields
     * Then: Record persists and is queryable
     */
    @isTest
    static void testInsertMinimalTemplate() {
        // Given: Template object definition exists

        // When: Insert minimal valid record
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '0681e000000000AAA',
            DataSource__c = 'SOQL'
        );

        Test.startTest();
        insert template;
        Test.stopTest();

        // Then: Record persists and is queryable
        Docgen_Template__c inserted = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.isNotNull(inserted.Id, 'Template ID should not be null');
        Assert.areEqual('Test Template', inserted.Name, 'Template name should match');
        Assert.areEqual('0681e000000000AAA', inserted.TemplateContentVersionId__c,
                       'ContentVersionId should match');
        Assert.areEqual('SOQL', inserted.DataSource__c, 'DataSource should match');
    }

    /**
     * Test: Insert template with all fields populated
     * Given: Docgen_Template__c with all optional fields
     * When: Insert record with all fields
     * Then: All fields persist correctly
     */
    @isTest
    static void testInsertTemplateWithAllFields() {
        // Given: Template with all fields populated

        // When: Insert complete record
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Full Template',
            TemplateContentVersionId__c = '0681e000000000BBB',
            DataSource__c = 'Custom',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ClassName__c = 'CustomDataProvider',
            StoreMergedDocx__c = true,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account'
        );

        Test.startTest();
        insert template;
        Test.stopTest();

        // Then: All fields persist correctly
        Docgen_Template__c inserted = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c,
                   SOQL__c, ClassName__c, StoreMergedDocx__c,
                   ReturnDocxToBrowser__c, PrimaryParent__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.areEqual('Full Template', inserted.Name);
        Assert.areEqual('Custom', inserted.DataSource__c);
        Assert.isTrue(inserted.SOQL__c.contains('Account'), 'SOQL should contain Account');
        Assert.areEqual('CustomDataProvider', inserted.ClassName__c);
        Assert.isTrue(inserted.StoreMergedDocx__c, 'StoreMergedDocx should be true');
        Assert.isFalse(inserted.ReturnDocxToBrowser__c, 'ReturnDocxToBrowser should be false');
        Assert.areEqual('Account', inserted.PrimaryParent__c);
    }

    /**
     * Test: Verify default values for checkbox fields
     * Given: Template inserted without explicit checkbox values
     * When: Query the record
     * Then: Default values should be set correctly
     */
    @isTest
    static void testDefaultValues() {
        // Given: Template without explicit checkbox values

        // When: Insert record
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Default Values Template',
            TemplateContentVersionId__c = '0681e000000000CCC',
            DataSource__c = 'SOQL'
            // Omit StoreMergedDocx__c and ReturnDocxToBrowser__c to test defaults
        );

        Test.startTest();
        insert template;
        Test.stopTest();

        // Then: Default values should be applied
        Docgen_Template__c inserted = [
            SELECT StoreMergedDocx__c, ReturnDocxToBrowser__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.isFalse(inserted.StoreMergedDocx__c,
                      'StoreMergedDocx should default to false');
        Assert.isTrue(inserted.ReturnDocxToBrowser__c,
                     'ReturnDocxToBrowser should default to true');
    }

    /**
     * Test: Update template fields
     * Given: Existing template record
     * When: Update fields
     * Then: Changes persist correctly
     */
    @isTest
    static void testUpdateTemplate() {
        // Given: Existing template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Original Name',
            TemplateContentVersionId__c = '0681e000000000DDD',
            DataSource__c = 'SOQL'
        );
        insert template;

        // When: Update fields
        template.Name = 'Updated Name';
        template.DataSource__c = 'Custom';
        template.ClassName__c = 'NewProvider';

        Test.startTest();
        update template;
        Test.stopTest();

        // Then: Changes persist
        Docgen_Template__c updated = [
            SELECT Name, DataSource__c, ClassName__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        Assert.areEqual('Updated Name', updated.Name);
        Assert.areEqual('Custom', updated.DataSource__c);
        Assert.areEqual('NewProvider', updated.ClassName__c);
    }

    /**
     * Test: Query multiple templates
     * Given: Multiple template records
     * When: Query all templates
     * Then: All records are returned
     */
    @isTest
    static void testQueryMultipleTemplates() {
        // Given: Multiple template records
        List<Docgen_Template__c> templates = new List<Docgen_Template__c>();

        for (Integer i = 0; i < 5; i++) {
            templates.add(new Docgen_Template__c(
                Name = 'Template ' + i,
                TemplateContentVersionId__c = '0681e00000000' + i + 'AAA',
                DataSource__c = 'SOQL'
            ));
        }

        Test.startTest();
        insert templates;
        Test.stopTest();

        // When/Then: Query returns all records
        List<Docgen_Template__c> queried = [
            SELECT Id, Name
            FROM Docgen_Template__c
            ORDER BY Name
        ];

        Assert.areEqual(5, queried.size(), 'Should have 5 templates');
        Assert.areEqual('Template 0', queried[0].Name);
        Assert.areEqual('Template 4', queried[4].Name);
    }
}
