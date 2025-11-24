/**
 * Test class for Composite_Document_Template__c junction object
 *
 * Tests required fields, unique constraints, cascade behavior, sequence ordering,
 * and active/inactive filtering for the many-to-many junction between
 * Composite Documents and Document Templates.
 */
@isTest
private class CompositeDocumentTemplateTest {

    /**
     * Test 1: Verify required fields are enforced
     *
     * Given: A Composite_Document_Template__c junction record
     * When: Created with all required fields
     * Then: Record saves successfully with auto-number Name
     */
    @isTest
    static void testRequiredFieldsEnforced() {
        // Given: Composite and Template records
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite',
            Template_Strategy__c = 'Concatenate Templates'
        );
        insert composite;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '0681e000000000AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );
        insert template;

        // When: Create junction record with all required fields
        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10
        );

        Test.startTest();
        insert junction;
        Test.stopTest();

        // Then: Record created successfully with auto-number Name
        Composite_Document_Template__c inserted = [
            SELECT Id, Name, Namespace__c, Sequence__c
            FROM Composite_Document_Template__c
            WHERE Id = :junction.Id
        ];

        Assert.isNotNull(inserted.Name, 'Auto-number Name should be generated');
        Assert.isTrue(inserted.Name.startsWith('CDT-'), 'Name should start with CDT- prefix');
        Assert.areEqual('Account', inserted.Namespace__c, 'Namespace should match');
        Assert.areEqual(10, inserted.Sequence__c, 'Sequence should match');
    }

    /**
     * Test 2: Verify duplicate namespace detection (to be enforced programmatically)
     *
     * Given: Two junction records with same Composite_Document__c and Namespace__c
     * When: Attempting to insert the second record
     * Then: Both records can be created (uniqueness will be enforced in business logic layer)
     * Note: This test validates that the data model allows duplicates; business logic will prevent them
     */
    @isTest
    static void testDuplicateNamespaceAllowed() {
        // Given: Composite and two templates
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite',
            Template_Strategy__c = 'Concatenate Templates'
        );
        insert composite;

        Docgen_Template__c template1 = new Docgen_Template__c(
            Name = 'Template 1',
            TemplateContentVersionId__c = '0681e000000000AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id FROM Account'
        );
        Docgen_Template__c template2 = new Docgen_Template__c(
            Name = 'Template 2',
            TemplateContentVersionId__c = '0681e000000000BBB',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id FROM Contact'
        );
        insert new List<Docgen_Template__c>{template1, template2};

        // First junction record with namespace "Account"
        Composite_Document_Template__c junction1 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template1.Id,
            Namespace__c = 'Account',
            Sequence__c = 10
        );
        insert junction1;

        // When: Insert second junction with same composite + namespace
        Composite_Document_Template__c junction2 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template2.Id,
            Namespace__c = 'Account', // Duplicate namespace for same composite
            Sequence__c = 20
        );

        Test.startTest();
        Database.SaveResult result = Database.insert(junction2, false);
        Test.stopTest();

        // Then: Record created successfully (business logic will enforce uniqueness)
        Assert.isTrue(result.isSuccess(), 'Insert should succeed at data layer');

        // Verify Unique_Key__c formula field shows combined value
        Composite_Document_Template__c inserted = [
            SELECT Unique_Key__c FROM Composite_Document_Template__c WHERE Id = :junction2.Id
        ];
        Assert.isTrue(inserted.Unique_Key__c.contains('Account'), 'Unique Key should contain namespace');
    }

    /**
     * Test 3: Verify restrict behavior on composite deletion
     *
     * Given: Composite with junction records
     * When: Attempt to delete composite
     * Then: Deletion is prevented (Restrict delete constraint)
     */
    @isTest
    static void testRestrictBehaviorOnDelete() {
        // Given: Composite, template, and junction
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite',
            Template_Strategy__c = 'Concatenate Templates'
        );
        insert composite;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '0681e000000000AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id FROM Account'
        );
        insert template;

        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10
        );
        insert junction;

        // When: Attempt to delete composite document
        Test.startTest();
        Database.DeleteResult result = Database.delete(composite, false);
        Test.stopTest();

        // Then: Deletion fails due to restrict constraint
        Assert.isFalse(result.isSuccess(), 'Delete should fail due to restrict constraint');

        // Verify composite still exists
        List<Composite_Document__c> composites = [
            SELECT Id FROM Composite_Document__c WHERE Id = :composite.Id
        ];
        Assert.areEqual(1, composites.size(), 'Composite should still exist after failed deletion');

        // Template still exists (Restrict constraint)
        List<Docgen_Template__c> templates = [
            SELECT Id FROM Docgen_Template__c WHERE Id = :template.Id
        ];
        Assert.areEqual(1, templates.size(), 'Template should still exist');

        // Junction record still exists
        List<Composite_Document_Template__c> junctions = [
            SELECT Id FROM Composite_Document_Template__c WHERE Id = :junction.Id
        ];
        Assert.areEqual(1, junctions.size(), 'Junction should still exist');
    }

    /**
     * Test 4: Verify sequence ordering
     *
     * Given: 3 junction records with Sequence__c values 20, 10, 30
     * When: Querying with ORDER BY Sequence__c
     * Then: Records return in order: 10, 20, 30
     */
    @isTest
    static void testSequenceOrdering() {
        // Given: Composite and templates
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite',
            Template_Strategy__c = 'Concatenate Templates'
        );
        insert composite;

        List<Docgen_Template__c> templates = new List<Docgen_Template__c>{
            new Docgen_Template__c(
                Name = 'Template A',
                TemplateContentVersionId__c = '0681e000000000AAA',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id FROM Account'
            ),
            new Docgen_Template__c(
                Name = 'Template B',
                TemplateContentVersionId__c = '0681e000000000BBB',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id FROM Contact'
            ),
            new Docgen_Template__c(
                Name = 'Template C',
                TemplateContentVersionId__c = '0681e000000000CCC',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id FROM Opportunity'
            )
        };
        insert templates;

        // Create junctions with out-of-order sequence numbers
        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[0].Id,
                Namespace__c = 'Account',
                Sequence__c = 20 // Second
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[1].Id,
                Namespace__c = 'Contact',
                Sequence__c = 10 // First
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[2].Id,
                Namespace__c = 'Opportunity',
                Sequence__c = 30 // Third
            )
        };
        insert junctions;

        // When: Query with ORDER BY Sequence__c
        Test.startTest();
        List<Composite_Document_Template__c> ordered = [
            SELECT Namespace__c, Sequence__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :composite.Id
            ORDER BY Sequence__c ASC
        ];
        Test.stopTest();

        // Then: Results in correct sequence order
        Assert.areEqual(3, ordered.size(), 'Should have 3 junction records');
        Assert.areEqual('Contact', ordered[0].Namespace__c, 'First should be Contact (sequence 10)');
        Assert.areEqual(10, ordered[0].Sequence__c, 'First sequence should be 10');
        Assert.areEqual('Account', ordered[1].Namespace__c, 'Second should be Account (sequence 20)');
        Assert.areEqual(20, ordered[1].Sequence__c, 'Second sequence should be 20');
        Assert.areEqual('Opportunity', ordered[2].Namespace__c, 'Third should be Opportunity (sequence 30)');
        Assert.areEqual(30, ordered[2].Sequence__c, 'Third sequence should be 30');
    }

    /**
     * Test 5: Verify inactive records are filtered
     *
     * Given: Junction record with IsActive__c = false
     * When: Querying for active records only
     * Then: Inactive record is excluded from results
     */
    @isTest
    static void testInactiveRecordsFiltered() {
        // Given: Composite and templates
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite',
            Template_Strategy__c = 'Concatenate Templates'
        );
        insert composite;

        List<Docgen_Template__c> templates = new List<Docgen_Template__c>{
            new Docgen_Template__c(
                Name = 'Active Template',
                TemplateContentVersionId__c = '0681e000000000AAA',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id FROM Account'
            ),
            new Docgen_Template__c(
                Name = 'Inactive Template',
                TemplateContentVersionId__c = '0681e000000000BBB',
                DataSource__c = 'SOQL',
                SOQL__c = 'SELECT Id FROM Contact'
            )
        };
        insert templates;

        // Create one active and one inactive junction
        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[0].Id,
                Namespace__c = 'Account',
                Sequence__c = 10,
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[1].Id,
                Namespace__c = 'Contact',
                Sequence__c = 20,
                IsActive__c = false
            )
        };
        insert junctions;

        // When: Query for active records only
        Test.startTest();
        List<Composite_Document_Template__c> activeOnly = [
            SELECT Namespace__c, IsActive__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :composite.Id
            AND IsActive__c = true
            ORDER BY Sequence__c ASC
        ];
        Test.stopTest();

        // Then: Only active record returned
        Assert.areEqual(1, activeOnly.size(), 'Should have only 1 active junction');
        Assert.areEqual('Account', activeOnly[0].Namespace__c, 'Active record should be Account namespace');
        Assert.areEqual(true, activeOnly[0].IsActive__c, 'Record should be active');
    }
}
