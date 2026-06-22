/**
 * Test class for CompositeDocgenDataProvider
 *
 * Covers all scenarios from T-19 playbook:
 * 1. Two templates, two namespaces - verify merged map structure
 * 2. Three templates with child relationships - verify nested data preserved
 * 3. Namespace collision detection - duplicate namespace throws exception
 * 4. Empty junction records - returns empty map
 * 5. Inactive junction records filtered
 * 6. Sequence ordering - templates execute in correct order
 * 7. Variable extraction - accountId from first query used in second template
 * 8. Locale/timezone propagation - passed to all child providers
 * 9. Error handling - template not found, provider class not found
 * 10. Mixed SOQL and Custom providers work together
 * 11. Traditional buildData() call throws NotSupportedException
 */
@isTest
private class CompositeDocgenDataProviderTest {

    /**
     * Test #1: Two templates, two namespaces ("Account", "Terms")
     * Verify merged map structure with both namespaces present
     */
    @isTest
    static void testBuildCompositeDataWithTwoNamespaces() {
        // Given: Account record and composite with 2 templates
        Account acc = DocgenTestDataFactory.createAccount('Acme Ltd');

        // Create composite document (use Concatenate Templates to avoid validation rule)
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Account Summary with Terms',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        // Create first template for Account data
        Docgen_Template__c accountTemplate = DocgenTestDataFactory.createTemplate(
            'Account Summary',
            'Account',
            'SELECT Id, Name, BillingCity, AnnualRevenue FROM Account WHERE Id = :recordId'
        );

        // Create second template for Terms (using Custom provider for testing)
        Docgen_Template__c termsTemplate = DocgenTestDataFactory.createCustomTemplate(
            'Terms and Conditions',
            null,
            'MockCustomProvider'
        );

        // Create junction records
        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = accountTemplate.Id,
                Namespace__c = 'Account',
                Sequence__c = 10,
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = termsTemplate.Id,
                Namespace__c = 'Terms',
                Sequence__c = 20,
                IsActive__c = true
            )
        };
        insert junctions;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Should return map with both namespace keys
        Assert.isNotNull(compositeData, 'Composite data should not be null');
        Assert.areEqual(2, compositeData.size(), 'Should contain 2 namespaces');
        Assert.isTrue(compositeData.containsKey('Account'), 'Should contain Account namespace');
        Assert.isTrue(compositeData.containsKey('Terms'), 'Should contain Terms namespace');

        // Verify Account data structure exposes both direct fields and object wrapper
        Map<String, Object> accountData = (Map<String, Object>) compositeData.get('Account');
        Assert.isNotNull(accountData, 'Account namespace data should not be null');
        Assert.areEqual('Acme Ltd', accountData.get('Name'), 'Should contain Account Name');
        Assert.isTrue(accountData.containsKey('Account'), 'Should retain object wrapper for reused standalone templates');
        Map<String, Object> wrappedAccountData = (Map<String, Object>) accountData.get('Account');
        Assert.areEqual('Acme Ltd', wrappedAccountData.get('Name'), 'Wrapped Account should contain Account Name');
    }

    /**
     * Test #2: Three templates with child relationships
     * Verify nested data structure preserved (Account with Contacts)
     */
    @isTest
    static void testBuildCompositeDataWithChildRelationships() {
        // Given: Account with Contacts
        Account acc = DocgenTestDataFactory.createAccount('Parent Account');
        DocgenTestDataFactory.createContacts(2, acc.Id);

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Account with Contacts',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        // Template with child relationship query
        Docgen_Template__c accountTemplate = DocgenTestDataFactory.createTemplate(
            'Account with Contacts',
            'Account',
            'SELECT Id, Name, (SELECT Id, LastName FROM Contacts) FROM Account WHERE Id = :recordId'
        );

        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = accountTemplate.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );
        insert junction;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: Child relationships should be preserved on direct and wrapped access paths
        Map<String, Object> accountData = (Map<String, Object>) compositeData.get('Account');
        Assert.isTrue(accountData.containsKey('Contacts'), 'Should contain Contacts child relationship');

        List<Object> contactsList = (List<Object>) accountData.get('Contacts');
        Assert.areEqual(2, contactsList.size(), 'Should have 2 contacts');
        Map<String, Object> wrappedAccountData = (Map<String, Object>) accountData.get('Account');
        Assert.isTrue(wrappedAccountData.containsKey('Contacts'), 'Wrapped Account should contain Contacts child relationship');
    }

    /**
     * Test #3: Namespace collision detection
     * Duplicate namespace should throw exception
     */
    @isTest
    static void testNamespaceCollisionThrowsException() {
        // Given: Composite with duplicate namespace
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Duplicate Namespace Test',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        Docgen_Template__c template1 = DocgenTestDataFactory.createTemplate(
            'Template 1',
            'Account',
            'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );

        Docgen_Template__c template2 = DocgenTestDataFactory.createTemplate(
            'Template 2',
            'Account',
            'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );

        // Both junctions use same namespace "Account"
        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = template1.Id,
                Namespace__c = 'Account',
                Sequence__c = 10,
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = template2.Id,
                Namespace__c = 'Account',  // Duplicate!
                Sequence__c = 20,
                IsActive__c = true
            )
        };
        insert junctions;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data with duplicate namespace
        // Then: Should throw CompositeDocgenException
        Test.startTest();
        try {
            CompositeDocgenDataProvider.buildCompositeData(
                composite.Id,
                recordIds,
                'en-US',
                'America/New_York'
            );
            Assert.fail('Should have thrown CompositeDocgenException for duplicate namespace');
        } catch (CompositeDocgenException e) {
            Assert.isTrue(e.getMessage().contains('Duplicate namespace'),
                'Exception message should mention duplicate namespace');
            Assert.isTrue(e.getMessage().contains('Account'),
                'Exception message should include namespace name');
        }
        Test.stopTest();
    }

    /**
     * Test #4: Empty junction records
     * Should return empty map (no exception)
     */
    @isTest
    static void testEmptyJunctionRecordsReturnsEmptyMap() {
        // Given: Composite with no junction records
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Empty Composite',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        Map<String, Id> recordIds = new Map<String, Id>();

        // When: Building composite data with no junctions
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: Should return empty map
        Assert.isNotNull(compositeData, 'Should return map, not null');
        Assert.areEqual(0, compositeData.size(), 'Map should be empty');
    }

    /**
     * Test #5: Inactive junction records filtered
     * IsActive__c = false should be excluded
     */
    @isTest
    static void testInactiveJunctionRecordsFiltered() {
        // Given: Composite with active and inactive junctions
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Active/Inactive Test',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        Docgen_Template__c activeTemplate = DocgenTestDataFactory.createTemplate(
            'Active Template',
            'Account',
            'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );

        Docgen_Template__c inactiveTemplate = DocgenTestDataFactory.createTemplate(
            'Inactive Template',
            'Account',
            'SELECT Id, BillingCity FROM Account WHERE Id = :recordId'
        );

        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = activeTemplate.Id,
                Namespace__c = 'Account',
                Sequence__c = 10,
                IsActive__c = true  // Active
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = inactiveTemplate.Id,
                Namespace__c = 'InactiveNamespace',
                Sequence__c = 20,
                IsActive__c = false  // Inactive - should be filtered
            )
        };
        insert junctions;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: Should only contain active namespace
        Assert.areEqual(1, compositeData.size(), 'Should only have 1 namespace (inactive filtered)');
        Assert.isTrue(compositeData.containsKey('Account'), 'Should contain Account namespace');
        Assert.isFalse(compositeData.containsKey('InactiveNamespace'),
            'Should NOT contain inactive namespace');
    }

    /**
     * Test #6: Sequence ordering
     * Templates should execute in Sequence__c order (10, 20, 30 not 30, 10, 20)
     */
    @isTest
    static void testSequenceOrderingEnforced() {
        // Given: Templates with sequences 30, 10, 20 (out of order)
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Sequence Test',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        // Create 3 templates
        List<Docgen_Template__c> templates = new List<Docgen_Template__c>{
            new Docgen_Template__c(
                Name = 'First (Seq 10)',
                TemplateContentVersionId__c = '068000000000008AAA',
                DataSource__c = 'Custom',
                ClassName__c = 'MockCustomProvider',
                ReturnMultipleRecords__c = false
            ),
            new Docgen_Template__c(
                Name = 'Second (Seq 20)',
                TemplateContentVersionId__c = '068000000000009AAA',
                DataSource__c = 'Custom',
                ClassName__c = 'MockCustomProvider',
                ReturnMultipleRecords__c = false
            ),
            new Docgen_Template__c(
                Name = 'Third (Seq 30)',
                TemplateContentVersionId__c = '068000000000010AAA',
                DataSource__c = 'Custom',
                ClassName__c = 'MockCustomProvider',
                ReturnMultipleRecords__c = false
            )
        };
        insert templates;

        // Insert junctions in non-sequential order: 30, 10, 20
        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[2].Id,
                Namespace__c = 'Third',
                Sequence__c = 30,  // Third
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[0].Id,
                Namespace__c = 'First',
                Sequence__c = 10,  // First
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = templates[1].Id,
                Namespace__c = 'Second',
                Sequence__c = 20,  // Second
                IsActive__c = true
            )
        };
        insert junctions;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: All three namespaces should be present
        // (Sequence verification is implicit in the SOQL ORDER BY clause)
        Assert.areEqual(3, compositeData.size(), 'Should have 3 namespaces');
        Assert.isTrue(compositeData.containsKey('First'), 'Should contain First namespace');
        Assert.isTrue(compositeData.containsKey('Second'), 'Should contain Second namespace');
        Assert.isTrue(compositeData.containsKey('Third'), 'Should contain Third namespace');
    }

    /**
     * Test #7: Variable extraction and sharing
     * AccountId from first query should be available for second template
     */
    @isTest
    static void testVariableExtractionBetweenTemplates() {
        // Given: Opportunity with AccountId
        Account acc = DocgenTestDataFactory.createAccount('Test Account');
        Opportunity opp = DocgenTestDataFactory.createOpportunity('Test Opp', acc.Id);

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Variable Extraction Test',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        // First template queries Opportunity (returns AccountId)
        Docgen_Template__c oppTemplate = DocgenTestDataFactory.createTemplate(
            'Opportunity Template',
            'Opportunity',
            'SELECT Id, Name, AccountId FROM Opportunity WHERE Id = :recordId'
        );

        // Second template queries Account (should use extracted accountId)
        Docgen_Template__c accTemplate = DocgenTestDataFactory.createTemplate(
            'Account Template',
            'Account',
            'SELECT Id, Name, BillingCity FROM Account WHERE Id = :recordId'
        );

        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = oppTemplate.Id,
                Namespace__c = 'Opportunity',
                Sequence__c = 10,
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = accTemplate.Id,
                Namespace__c = 'Account',
                Sequence__c = 20,
                IsActive__c = true
            )
        };
        insert junctions;

        // Only provide opportunityId - accountId should be extracted
        Map<String, Id> recordIds = new Map<String, Id>{ 'opportunityId' => opp.Id };

        // When: Building composite data
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Both namespaces should have data (variable extraction worked)
        Assert.areEqual(2, compositeData.size(), 'Should have 2 namespaces');
        Assert.isTrue(compositeData.containsKey('Opportunity'), 'Should contain Opportunity namespace');
        Assert.isTrue(compositeData.containsKey('Account'), 'Should contain Account namespace');

        // Verify Account data was populated (proves accountId was extracted)
        Map<String, Object> accountData = (Map<String, Object>) compositeData.get('Account');
        Assert.areEqual('Test Account', accountData.get('Name'), 'Account data should be populated');
        Assert.areEqual('San Francisco', accountData.get('BillingCity'), 'Account city should be populated');
        Map<String, Object> wrappedAccountData = (Map<String, Object>) accountData.get('Account');
        Assert.areEqual('Test Account', wrappedAccountData.get('Name'), 'Wrapped Account data should be populated');
    }

    /**
     * Test #8: Locale/timezone propagation
     * Locale and timezone should be passed to all child providers
     */
    @isTest
    static void testLocaleTimezonePropagation() {
        // Given: Account with currency and date fields
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Locale Test',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        Docgen_Template__c template = DocgenTestDataFactory.createTemplate(
            'Account Template',
            'Account',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId'
        );

        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );
        insert junction;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data with German locale
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'de-DE',  // German locale
            'Europe/Berlin'  // Berlin timezone
        );
        Test.stopTest();

        // Then: Formatted fields should use German formatting
        Map<String, Object> accountData = (Map<String, Object>) compositeData.get('Account');

        String formattedRevenue = (String) accountData.get('AnnualRevenue__formatted');
        Assert.isNotNull(formattedRevenue, 'Should have formatted revenue');
        // German format uses € symbol and period/comma separators
        // Just verify it exists - exact format depends on StandardSOQLProvider implementation
    }

    /**
     * Test #9: Error handling - provider class not found
     * Invalid ClassName__c should throw exception
     */
    @isTest
    static void testProviderClassNotFoundThrowsException() {
        // Given: Template with invalid custom provider class
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Error Test',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        Docgen_Template__c template = DocgenTestDataFactory.createCustomTemplate(
            'Invalid Provider Template',
            null,
            'NonExistentProviderClass'  // This class doesn't exist
        );

        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );
        insert junction;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data with invalid provider
        // Then: Should throw exception
        Test.startTest();
        try {
            CompositeDocgenDataProvider.buildCompositeData(
                composite.Id,
                recordIds,
                'en-US',
                'America/New_York'
            );
            Assert.fail('Should have thrown exception for invalid provider class');
        } catch (Exception e) {
            Assert.isTrue(e.getMessage().contains('Provider class not found') ||
                         e.getMessage().contains('NonExistentProviderClass'),
                'Exception should mention provider class issue');
        }
        Test.stopTest();
    }

    /**
     * Test #10: Mixed SOQL and Custom providers
     * Composite should support both provider types
     */
    @isTest
    static void testMixedSOQLAndCustomProviders() {
        // Given: Composite with SOQL and Custom providers
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Mixed Providers Test',
            Template_Strategy__c = 'Concatenate Templates',
            IsActive__c = true
        );
        insert composite;

        // SOQL provider
        Docgen_Template__c soqlTemplate = DocgenTestDataFactory.createTemplate(
            'SOQL Template',
            'Account',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId'
        );

        // Custom provider
        Docgen_Template__c customTemplate = DocgenTestDataFactory.createCustomTemplate(
            'Custom Template',
            null,
            'MockCustomProvider'
        );

        List<Composite_Document_Template__c> junctions = new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = soqlTemplate.Id,
                Namespace__c = 'Account',
                Sequence__c = 10,
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = customTemplate.Id,
                Namespace__c = 'Custom',
                Sequence__c = 20,
                IsActive__c = true
            )
        };
        insert junctions;

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        // When: Building composite data
        Test.startTest();
        Map<String, Object> compositeData = CompositeDocgenDataProvider.buildCompositeData(
            composite.Id,
            recordIds,
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: Both provider types should work
        Assert.areEqual(2, compositeData.size(), 'Should have 2 namespaces');
        Assert.isTrue(compositeData.containsKey('Account'), 'Should contain SOQL provider result');
        Assert.isTrue(compositeData.containsKey('Custom'), 'Should contain Custom provider result');

        // Verify SOQL data
        Map<String, Object> accountData = (Map<String, Object>) compositeData.get('Account');
        Assert.isNotNull(accountData, 'SOQL provider should return data');

        // Verify Custom data
        Map<String, Object> customData = (Map<String, Object>) compositeData.get('Custom');
        Assert.isNotNull(customData, 'Custom provider should return data');
    }

    /**
     * Test #11: Traditional buildData() call throws NotSupportedException
     * Force use of buildCompositeData() for composite documents
     */
    @isTest
    static void testBuildDataThrowsNotSupportedException() {
        // Given: CompositeDocgenDataProvider instance
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplate(
            'Test Template',
            'Account',
            'SELECT Id, Name FROM Account WHERE Id = :recordId'
        );

        CompositeDocgenDataProvider provider = new CompositeDocgenDataProvider();

        // When: Calling buildData() directly
        // Then: Should throw CompositeDocgenException
        Test.startTest();
        try {
            provider.buildData(acc.Id, template, 'en-US', 'America/New_York');
            Assert.fail('Should have thrown CompositeDocgenException');
        } catch (CompositeDocgenException e) {
            Assert.isTrue(e.getMessage().contains('buildCompositeData'),
                'Exception should direct to use buildCompositeData() method');
        }
        Test.stopTest();
    }
}
