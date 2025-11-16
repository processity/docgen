/**
 * Test class for DocgenObjectConfigService
 * Validates object configuration retrieval, caching, and validation logic
 */
@IsTest
private class DocgenObjectConfigServiceTest {

    /**
     * Test: Get configuration for Account - should return Account config
     */
    @IsTest
    static void testGetConfigForAccount_ReturnsAccountConfig() {
        // When: getConfigForObject('Account')
        Test.startTest();
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('Account');
        Test.stopTest();

        // Then: Returns Supported_Object__mdt with correct values
        System.assertNotEquals(null, config, 'Config should not be null for Account');
        System.assertEquals('Account', config.Object_API_Name__c, 'Object API Name should be Account');
        System.assertEquals('Account__c', config.Lookup_Field_API_Name__c, 'Lookup field should be Account__c');
        System.assertEquals(true, config.Is_Active__c, 'Account should be active');
    }

    /**
     * Test: Get configuration for Contact - should return Contact config
     */
    @IsTest
    static void testGetConfigForContact_ReturnsContactConfig() {
        // When: getConfigForObject('Contact')
        Test.startTest();
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('Contact');
        Test.stopTest();

        // Then: Returns Supported_Object__mdt with correct values
        System.assertNotEquals(null, config, 'Config should not be null for Contact');
        System.assertEquals('Contact', config.Object_API_Name__c, 'Object API Name should be Contact');
        System.assertEquals('Contact__c', config.Lookup_Field_API_Name__c, 'Lookup field should be Contact__c');
        System.assertEquals(true, config.Is_Active__c, 'Contact should be active');
    }

    /**
     * Test: Get configuration for Lead - should return Lead config
     */
    @IsTest
    static void testGetConfigForLead_ReturnsLeadConfig() {
        // When: getConfigForObject('Lead')
        Test.startTest();
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('Lead');
        Test.stopTest();

        // Then: Returns Supported_Object__mdt with correct values
        System.assertNotEquals(null, config, 'Config should not be null for Lead');
        System.assertEquals('Lead', config.Object_API_Name__c, 'Object API Name should be Lead');
        System.assertEquals('Lead__c', config.Lookup_Field_API_Name__c, 'Lookup field should be Lead__c');
        System.assertEquals(true, config.Is_Active__c, 'Lead should be active');
    }

    /**
     * Test: Get configuration for Opportunity - should return Opportunity config
     */
    @IsTest
    static void testGetConfigForOpportunity_ReturnsOpportunityConfig() {
        // When: getConfigForObject('Opportunity')
        Test.startTest();
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('Opportunity');
        Test.stopTest();

        // Then: Returns Supported_Object__mdt with correct values
        System.assertNotEquals(null, config, 'Config should not be null for Opportunity');
        System.assertEquals('Opportunity', config.Object_API_Name__c, 'Object API Name should be Opportunity');
        System.assertEquals('Opportunity__c', config.Lookup_Field_API_Name__c, 'Lookup field should be Opportunity__c');
    }

    /**
     * Test: Get configuration for Case - should return Case config
     */
    @IsTest
    static void testGetConfigForCase_ReturnsCaseConfig() {
        // When: getConfigForObject('Case')
        Test.startTest();
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('Case');
        Test.stopTest();

        // Then: Returns Supported_Object__mdt with correct values
        System.assertNotEquals(null, config, 'Config should not be null for Case');
        System.assertEquals('Case', config.Object_API_Name__c, 'Object API Name should be Case');
        System.assertEquals('Case__c', config.Lookup_Field_API_Name__c, 'Lookup field should be Case__c');
    }

    /**
     * Test: Get configuration for unsupported object - should throw exception
     */
    @IsTest
    static void testGetConfigForUnsupportedObject_ThrowsException() {
        // Given: 'Asset' has no metadata record
        Boolean exceptionThrown = false;
        String exceptionMessage = '';

        // When: getConfigForObject('Asset')
        Test.startTest();
        try {
            DocgenObjectConfigService.getConfigForObject('Asset');
        } catch (DocgenObjectConfigService.DocgenObjectConfigException e) {
            exceptionThrown = true;
            exceptionMessage = e.getMessage();
        }
        Test.stopTest();

        // Then: Throws DocgenObjectConfigException with clear message
        System.assertEquals(true, exceptionThrown, 'Exception should be thrown for unsupported object');
        System.assert(exceptionMessage.contains('Asset'), 'Exception message should mention the object name');
        System.assert(exceptionMessage.contains('not configured'), 'Exception should indicate object is not configured');
    }

    /**
     * Test: Get all active configurations - should return map of configs
     */
    @IsTest
    static void testGetAllActiveConfigs_ReturnsMapOfConfigs() {
        // When: getAllActiveConfigs()
        Test.startTest();
        Map<String, Supported_Object__mdt> configs = DocgenObjectConfigService.getAllActiveConfigs();
        Test.stopTest();

        // Then: Returns map with at least 5 objects (Account, Opportunity, Case, Contact, Lead)
        System.assertNotEquals(null, configs, 'Configs map should not be null');
        System.assert(configs.size() >= 5, 'Should have at least 5 active configurations');
        System.assert(configs.containsKey('Account'), 'Should contain Account');
        System.assert(configs.containsKey('Opportunity'), 'Should contain Opportunity');
        System.assert(configs.containsKey('Case'), 'Should contain Case');
        System.assert(configs.containsKey('Contact'), 'Should contain Contact');
        System.assert(configs.containsKey('Lead'), 'Should contain Lead');
    }

    /**
     * Test: Get all active configs uses cache - should not query twice
     */
    @IsTest
    static void testGetAllActiveConfigs_UsesCache() {
        // Given: Clear any existing cache
        DocgenObjectConfigService.clearCache();

        // When: First call to getAllActiveConfigs
        Test.startTest();
        Map<String, Supported_Object__mdt> firstCall = DocgenObjectConfigService.getAllActiveConfigs();
        Test.stopTest();

        // Then: Cache should be populated
        System.assertNotEquals(null, DocgenObjectConfigService.configCache, 'Cache should be populated after first call');
        System.assertEquals(firstCall.size(), DocgenObjectConfigService.configCache.size(), 'Cache size should match returned size');

        // When: Second call to getAllActiveConfigs (cache should be used)
        Map<String, Supported_Object__mdt> secondCall = DocgenObjectConfigService.getAllActiveConfigs();

        // Then: Should return same cached instance
        System.assertEquals(firstCall.size(), secondCall.size(), 'Both calls should return same number of configs');
    }

    /**
     * Test: isObjectSupported returns true for Account
     */
    @IsTest
    static void testIsObjectSupported_ReturnsTrue() {
        // When: isObjectSupported('Account')
        Test.startTest();
        Boolean isSupported = DocgenObjectConfigService.isObjectSupported('Account');
        Test.stopTest();

        // Then: Returns true
        System.assertEquals(true, isSupported, 'Account should be supported');
    }

    /**
     * Test: isObjectSupported returns false for unsupported object
     */
    @IsTest
    static void testIsObjectSupported_ReturnsFalse() {
        // When: isObjectSupported('Asset')
        Test.startTest();
        Boolean isSupported = DocgenObjectConfigService.isObjectSupported('Asset');
        Test.stopTest();

        // Then: Returns false
        System.assertEquals(false, isSupported, 'Asset should not be supported');
    }

    /**
     * Test: validateObjectSupported succeeds for Contact
     */
    @IsTest
    static void testValidateObjectSupported_Success() {
        // When: validateObjectSupported('Contact')
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            DocgenObjectConfigService.validateObjectSupported('Contact');
        } catch (Exception e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        // Then: No exception thrown
        System.assertEquals(false, exceptionThrown, 'Should not throw exception for supported object');
    }

    /**
     * Test: validateObjectSupported throws clear exception for unsupported object
     */
    @IsTest
    static void testValidateObjectSupported_ThrowsClearException() {
        // Given: 'Product2' is not configured
        Boolean exceptionThrown = false;
        String exceptionMessage = '';

        // When: validateObjectSupported('Product2')
        Test.startTest();
        try {
            DocgenObjectConfigService.validateObjectSupported('Product2');
        } catch (DocgenObjectConfigService.DocgenObjectConfigException e) {
            exceptionThrown = true;
            exceptionMessage = e.getMessage();
        }
        Test.stopTest();

        // Then: Throws exception with clear, user-friendly message
        System.assertEquals(true, exceptionThrown, 'Exception should be thrown');
        System.assert(exceptionMessage.contains('Product2'), 'Exception should mention object name');
        System.assert(exceptionMessage.contains('not configured') ||
                     exceptionMessage.contains('not supported'),
                     'Exception should indicate object is not configured');
    }

    /**
     * Test: Case sensitivity - handles 'account' vs 'Account' correctly
     */
    @IsTest
    static void testCaseSensitivity_HandlesCorrectly() {
        // When: getConfigForObject('account') with lowercase
        Test.startTest();
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('account');
        Test.stopTest();

        // Then: Should still find Account (case-insensitive)
        System.assertNotEquals(null, config, 'Should handle case-insensitive lookup');
        System.assertEquals('Account', config.Object_API_Name__c, 'Should return Account config');
    }

    /**
     * Test: Null input handling
     */
    @IsTest
    static void testNullInput_ThrowsException() {
        // When: getConfigForObject(null)
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            DocgenObjectConfigService.getConfigForObject(null);
        } catch (Exception e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        // Then: Should throw exception
        System.assertEquals(true, exceptionThrown, 'Should throw exception for null input');
    }

    /**
     * Test: Empty string input handling
     */
    @IsTest
    static void testEmptyStringInput_ThrowsException() {
        // When: getConfigForObject('')
        Boolean exceptionThrown = false;

        Test.startTest();
        try {
            DocgenObjectConfigService.getConfigForObject('');
        } catch (Exception e) {
            exceptionThrown = true;
        }
        Test.stopTest();

        // Then: Should throw exception
        System.assertEquals(true, exceptionThrown, 'Should throw exception for empty string');
    }
}
