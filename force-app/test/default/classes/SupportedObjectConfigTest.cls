/**
 * Test class for Supported_Object__mdt Custom Metadata Type
 *
 * Tests verify that the Custom Metadata configuration is correctly deployed and queryable.
 * Note: Custom Metadata records are configuration (not data), so tests query existing metadata
 * rather than inserting test records.
 */
@isTest
private class SupportedObjectConfigTest {

    /**
     * Test: Query all active supported object configurations
     * Given: Custom Metadata records exist with Is_Active__c = true
     * When: Querying for active configurations
     * Then: Returns at least 3 active objects (Account, Opportunity, Case)
     */
    @isTest
    static void testQueryAllActiveObjects() {
        // When: Query all active supported objects
        Test.startTest();
        List<Supported_Object__mdt> activeObjects = [
            SELECT MasterLabel, Object_API_Name__c, Lookup_Field_API_Name__c,
                   Is_Active__c, Display_Order__c, Description__c
            FROM Supported_Object__mdt
            WHERE Is_Active__c = true
            ORDER BY Display_Order__c
        ];
        Test.stopTest();

        // Then: At least 3 active objects should exist
        Assert.isTrue(
            activeObjects.size() >= 3,
            'Expected at least 3 active supported objects, found: ' + activeObjects.size()
        );

        // Verify all returned objects are active
        for (Supported_Object__mdt obj : activeObjects) {
            Assert.isTrue(
                obj.Is_Active__c,
                'All queried objects should have Is_Active__c = true'
            );
        }
    }

    /**
     * Test: Account configuration exists and is correct
     * Given: Account Custom Metadata record is deployed
     * When: Querying for Account configuration
     * Then: Returns correct Object_API_Name__c and Lookup_Field_API_Name__c
     */
    @isTest
    static void testAccountConfiguration() {
        // When: Query Account configuration
        Test.startTest();
        List<Supported_Object__mdt> accountConfigs = [
            SELECT Object_API_Name__c, Lookup_Field_API_Name__c, Is_Active__c
            FROM Supported_Object__mdt
            WHERE Object_API_Name__c = 'Account'
            LIMIT 1
        ];
        Test.stopTest();

        // Then: Account configuration should exist
        Assert.areEqual(
            1,
            accountConfigs.size(),
            'Account configuration should exist'
        );

        Supported_Object__mdt accountConfig = accountConfigs[0];

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
     * Given: Opportunity Custom Metadata record is deployed
     * When: Querying for Opportunity configuration
     * Then: Returns correct Object_API_Name__c and Lookup_Field_API_Name__c
     */
    @isTest
    static void testOpportunityConfiguration() {
        // When: Query Opportunity configuration
        Test.startTest();
        List<Supported_Object__mdt> oppConfigs = [
            SELECT Object_API_Name__c, Lookup_Field_API_Name__c, Is_Active__c
            FROM Supported_Object__mdt
            WHERE Object_API_Name__c = 'Opportunity'
            LIMIT 1
        ];
        Test.stopTest();

        // Then: Opportunity configuration should exist
        Assert.areEqual(
            1,
            oppConfigs.size(),
            'Opportunity configuration should exist'
        );

        Supported_Object__mdt oppConfig = oppConfigs[0];

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
     * Given: Case Custom Metadata record is deployed
     * When: Querying for Case configuration
     * Then: Returns correct Object_API_Name__c and Lookup_Field_API_Name__c
     */
    @isTest
    static void testCaseConfiguration() {
        // When: Query Case configuration
        Test.startTest();
        List<Supported_Object__mdt> caseConfigs = [
            SELECT Object_API_Name__c, Lookup_Field_API_Name__c, Is_Active__c
            FROM Supported_Object__mdt
            WHERE Object_API_Name__c = 'Case'
            LIMIT 1
        ];
        Test.stopTest();

        // Then: Case configuration should exist
        Assert.areEqual(
            1,
            caseConfigs.size(),
            'Case configuration should exist'
        );

        Supported_Object__mdt caseConfig = caseConfigs[0];

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
     * Given: Custom Metadata has Is_Active__c field
     * When: Querying with Is_Active__c = true filter
     * Then: Only returns active configurations
     */
    @isTest
    static void testActiveFilteringWorks() {
        // When: Query with active filter
        Test.startTest();
        List<Supported_Object__mdt> activeConfigs = [
            SELECT Is_Active__c
            FROM Supported_Object__mdt
            WHERE Is_Active__c = true
        ];
        Test.stopTest();

        // Then: All results should have Is_Active__c = true
        for (Supported_Object__mdt config : activeConfigs) {
            Assert.isTrue(
                config.Is_Active__c,
                'All filtered results should be active'
            );
        }

        // Verify we can query all (including potentially inactive) records
        List<Supported_Object__mdt> allConfigs = [
            SELECT Is_Active__c
            FROM Supported_Object__mdt
        ];

        Assert.isTrue(
            allConfigs.size() >= activeConfigs.size(),
            'Total configurations should be >= active configurations'
        );
    }

    /**
     * Test: All custom fields are accessible and queryable
     * Given: Custom Metadata Type has 5 custom fields
     * When: Querying with all field names in SELECT clause
     * Then: Query succeeds and returns field values
     */
    @isTest
    static void testFieldsAreAccessible() {
        // When: Query with all custom fields
        Test.startTest();
        List<Supported_Object__mdt> configs = [
            SELECT
                MasterLabel,
                DeveloperName,
                Object_API_Name__c,
                Lookup_Field_API_Name__c,
                Is_Active__c,
                Display_Order__c,
                Description__c
            FROM Supported_Object__mdt
            WHERE Object_API_Name__c = 'Account'
            LIMIT 1
        ];
        Test.stopTest();

        // Then: Query should succeed and return data
        Assert.areEqual(
            1,
            configs.size(),
            'Should return one Account configuration'
        );

        Supported_Object__mdt config = configs[0];

        // Verify standard fields are populated
        Assert.isNotNull(
            config.MasterLabel,
            'MasterLabel should not be null'
        );

        Assert.isNotNull(
            config.DeveloperName,
            'DeveloperName should not be null'
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
