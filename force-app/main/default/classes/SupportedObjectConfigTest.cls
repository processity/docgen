/**
 * Test class for Supported_Object__mdt configuration resolution.
 *
 * Tests verify that Supported_Object__mdt configurations are available via
 * DocgenObjectConfigService. When metadata records aren't present (e.g., during
 * package validation), the service provides default test configs.
 */
@isTest
private class SupportedObjectConfigTest {

    /**
     * Test: Query all active supported object configurations
     * Given: Supported object configurations are available via the service
     * When: Loading active configurations
     * Then: Returns at least 3 active objects (Account, Opportunity, Case)
     */
    @isTest
    static void testQueryAllActiveObjects() {
        // When: Load all active supported objects
        Test.startTest();
        Map<String, Supported_Object__mdt> activeObjects = DocgenObjectConfigService.getAllActiveConfigs();
        Test.stopTest();

        // Then: At least 3 active objects should exist
        Assert.isTrue(
            activeObjects.size() >= 3,
            'Expected at least 3 active supported objects, found: ' + activeObjects.size()
        );

        // Verify all returned objects are active
        for (Supported_Object__mdt obj : activeObjects.values()) {
            Assert.isTrue(
                obj.Is_Active__c,
                'All queried objects should have Is_Active__c = true'
            );
        }
    }

    /**
     * Test: Account configuration exists and is correct
     * Given: Account configuration is available via service
     * When: Fetching Account configuration
     * Then: Returns correct Object_API_Name__c and Lookup_Field_API_Name__c
     */
    @isTest
    static void testAccountConfiguration() {
        // When: Fetch Account configuration
        Test.startTest();
        Supported_Object__mdt accountConfig = DocgenObjectConfigService.getConfigForObject('Account');
        Test.stopTest();

        // Verify field mappings
        Assert.areEqual(
            'Account',
            accountConfig.Object_API_Name__c,
            'Object_API_Name__c should be Account'
        );

        Assert.areEqual(
            'Account__c',
            accountConfig.Lookup_Field_API_Name__c,
            'Lookup_Field_API_Name__c should be Account__c'
        );

        Assert.isTrue(
            accountConfig.Is_Active__c,
            'Account configuration should be active'
        );
    }

    /**
     * Test: Opportunity configuration exists and is correct
     * Given: Opportunity configuration is available via service
     * When: Fetching Opportunity configuration
     * Then: Returns correct Object_API_Name__c and Lookup_Field_API_Name__c
     */
    @isTest
    static void testOpportunityConfiguration() {
        // When: Fetch Opportunity configuration
        Test.startTest();
        Supported_Object__mdt oppConfig = DocgenObjectConfigService.getConfigForObject('Opportunity');
        Test.stopTest();

        // Verify field mappings
        Assert.areEqual(
            'Opportunity',
            oppConfig.Object_API_Name__c,
            'Object_API_Name__c should be Opportunity'
        );

        Assert.areEqual(
            'Opportunity__c',
            oppConfig.Lookup_Field_API_Name__c,
            'Lookup_Field_API_Name__c should be Opportunity__c'
        );

        Assert.isTrue(
            oppConfig.Is_Active__c,
            'Opportunity configuration should be active'
        );
    }

    /**
     * Test: Case configuration exists and is correct
     * Given: Case configuration is available via service
     * When: Fetching Case configuration
     * Then: Returns correct Object_API_Name__c and Lookup_Field_API_Name__c
     */
    @isTest
    static void testCaseConfiguration() {
        // When: Fetch Case configuration
        Test.startTest();
        Supported_Object__mdt caseConfig = DocgenObjectConfigService.getConfigForObject('Case');
        Test.stopTest();

        // Verify field mappings
        Assert.areEqual(
            'Case',
            caseConfig.Object_API_Name__c,
            'Object_API_Name__c should be Case'
        );

        Assert.areEqual(
            'Case__c',
            caseConfig.Lookup_Field_API_Name__c,
            'Lookup_Field_API_Name__c should be Case__c'
        );

        Assert.isTrue(
            caseConfig.Is_Active__c,
            'Case configuration should be active'
        );
    }

    /**
     * Test: Active filtering works correctly
     * Given: Supported object configurations are active
     * When: Loading configurations from the service
     * Then: All returned configs are active
     */
    @isTest
    static void testActiveFilteringWorks() {
        // When: Load all active configs
        Test.startTest();
        Map<String, Supported_Object__mdt> activeConfigs = DocgenObjectConfigService.getAllActiveConfigs();
        Test.stopTest();

        // Then: All results should have Is_Active__c = true
        for (Supported_Object__mdt config : activeConfigs.values()) {
            Assert.isTrue(
                config.Is_Active__c,
                'All filtered results should be active'
            );
        }
    }

    /**
     * Test: All custom fields are accessible and queryable
     * Given: Supported object configuration is available
     * When: Accessing standard and custom fields
     * Then: Field values are populated
     */
    @isTest
    static void testFieldsAreAccessible() {
        // When: Fetch Account configuration
        Test.startTest();
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('Account');
        Test.stopTest();

        // Verify standard fields are populated
        Assert.isNotNull(
            config.DeveloperName,
            'DeveloperName should not be null'
        );

        Assert.isNotNull(
            config.Label,
            'Label should not be null'
        );

        // Verify required custom fields are populated
        Assert.isNotNull(
            config.Object_API_Name__c,
            'Object_API_Name__c should not be null'
        );

        Assert.isNotNull(
            config.Lookup_Field_API_Name__c,
            'Lookup_Field_API_Name__c should not be null'
        );

        // Verify checkbox field has value (not null)
        Assert.isNotNull(
            config.Is_Active__c,
            'Is_Active__c should not be null (checkbox fields default to false if not set)'
        );

        // Note: Display_Order__c and Description__c can be null (optional fields)
    }
}
