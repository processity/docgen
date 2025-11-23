/**
 * Test class for Composite_Document__c custom object
 *
 * Tests required fields, validation rules, default values, and field behavior
 * for the Composite Document configuration object.
 */
@isTest
private class CompositeDocumentTest {

    /**
     * Test 1: Verify required fields are enforced
     *
     * Given: A Composite_Document__c record
     * When: Created with required fields
     * Then: Name (auto-number) is generated and record saves successfully
     */
    @isTest
    static void testRequiredFieldsEnforced() {
        // Given: Required fields for composite document
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite document for Account summary with Terms',
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '0681e000000000AAA',
            PrimaryParent__c = 'Account'
        );

        // When: Insert composite document
        Test.startTest();
        insert composite;
        Test.stopTest();

        // Then: Record created successfully with auto-number Name
        Composite_Document__c inserted = [
            SELECT Id, Name, Description__c, Template_Strategy__c
            FROM Composite_Document__c
            WHERE Id = :composite.Id
        ];

        Assert.isNotNull(inserted.Name, 'Auto-number Name should be generated');
        Assert.isTrue(inserted.Name.startsWith('CD-'), 'Name should start with CD- prefix');
        Assert.areEqual('Own Template', inserted.Template_Strategy__c, 'Strategy should match');
    }

    /**
     * Test 2: Verify validation rule for Own Template strategy
     *
     * Given: Template_Strategy__c = "Own Template"
     * When: TemplateContentVersionId__c is blank
     * Then: Validation rule fires and save fails
     */
    @isTest
    static void testTemplateRequiredForOwnStrategy() {
        // Given: Composite with "Own Template" strategy but no template ID
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite without template ID',
            Template_Strategy__c = 'Own Template',
            IsActive__c = true
            // TemplateContentVersionId__c is intentionally blank
        );

        // When: Attempt to insert
        Test.startTest();
        Database.SaveResult result = Database.insert(composite, false);
        Test.stopTest();

        // Then: Validation error occurs
        Assert.isFalse(result.isSuccess(), 'Insert should fail due to validation rule');
        Assert.isTrue(
            result.getErrors()[0].getMessage().containsIgnoreCase('required'),
            'Error message should mention "required"'
        );
    }

    /**
     * Test 3: Verify validation rule for Concatenate Templates strategy
     *
     * Given: Template_Strategy__c = "Concatenate Templates"
     * When: TemplateContentVersionId__c is populated
     * Then: Validation rule fires and save fails
     */
    @isTest
    static void testTemplateForbiddenForConcatenate() {
        // Given: Composite with "Concatenate Templates" strategy but has template ID
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite with forbidden template ID',
            Template_Strategy__c = 'Concatenate Templates',
            TemplateContentVersionId__c = '0681e000000000AAA', // Should be blank
            IsActive__c = true
        );

        // When: Attempt to insert
        Test.startTest();
        Database.SaveResult result = Database.insert(composite, false);
        Test.stopTest();

        // Then: Validation error occurs
        Assert.isFalse(result.isSuccess(), 'Insert should fail due to validation rule');
        Assert.isTrue(
            result.getErrors()[0].getMessage().containsIgnoreCase('blank'),
            'Error message should mention template must be "blank"'
        );
    }

    /**
     * Test 4: Verify default field values
     *
     * Given: A new Composite_Document__c record
     * When: Created without specifying checkbox fields
     * Then: IsActive__c defaults to true, StoreMergedDocx__c defaults to false
     */
    @isTest
    static void testDefaultFieldValues() {
        // Given: Composite without explicit checkbox values
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite for defaults',
            Template_Strategy__c = 'Concatenate Templates'
            // IsActive__c not specified (should default to true)
            // StoreMergedDocx__c not specified (should default to false)
            // ReturnDocxToBrowser__c not specified (should default to false)
        );

        // When: Insert composite
        Test.startTest();
        insert composite;
        Test.stopTest();

        // Then: Default values applied
        Composite_Document__c inserted = [
            SELECT IsActive__c, StoreMergedDocx__c, ReturnDocxToBrowser__c
            FROM Composite_Document__c
            WHERE Id = :composite.Id
        ];

        Assert.areEqual(true, inserted.IsActive__c, 'IsActive__c should default to true');
        Assert.areEqual(false, inserted.StoreMergedDocx__c, 'StoreMergedDocx__c should default to false');
        Assert.areEqual(false, inserted.ReturnDocxToBrowser__c, 'ReturnDocxToBrowser__c should default to false');
    }

    /**
     * Test 5: Verify PrimaryParent__c unrestricted picklist allows custom values
     *
     * Given: A Composite_Document__c record
     * When: PrimaryParent__c is set to a custom value not in standard picklist
     * Then: Record saves successfully (unrestricted picklist)
     */
    @isTest
    static void testPrimaryParentUnrestrictedPicklist() {
        // Given: Composite with custom parent object value
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite with custom parent',
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '0681e000000000AAA',
            PrimaryParent__c = 'CustomObject__c' // Custom value not in standard picklist
        );

        // When: Insert composite
        Test.startTest();
        insert composite;
        Test.stopTest();

        // Then: Record created successfully with custom value
        Composite_Document__c inserted = [
            SELECT PrimaryParent__c
            FROM Composite_Document__c
            WHERE Id = :composite.Id
        ];

        Assert.areEqual('CustomObject__c', inserted.PrimaryParent__c, 'Custom parent value should be preserved');
    }
}
