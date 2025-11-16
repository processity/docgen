/**
 * Service class for managing and querying Salesforce object configurations for document generation.
 *
 * This service provides a central point for:
 * - Querying Custom Metadata (Supported_Object__mdt) for active object configurations
 * - Validating that objects are supported for document generation
 * - Caching configuration data to minimize SOQL queries
 *
 * Usage:
 *   // Get configuration for specific object
 *   Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject('Account');
 *   String lookupField = config.Lookup_Field_API_Name__c; // 'Account__c'
 *
 *   // Check if object is supported
 *   if (DocgenObjectConfigService.isObjectSupported('Contact')) {
 *       // Process Contact record
 *   }
 *
 *   // Validate and throw exception if not supported
 *   DocgenObjectConfigService.validateObjectSupported(objectApiName);
 */
public with sharing class DocgenObjectConfigService {

    /**
     * Static cache for configuration data (transaction-scoped)
     * Key: Object API Name (e.g., 'Account', 'Contact')
     * Value: Supported_Object__mdt configuration record
     */
    @TestVisible
    private static Map<String, Supported_Object__mdt> configCache;

    /**
     * Custom exception for object configuration errors
     */
    public class DocgenObjectConfigException extends Exception {}

    /**
     * Get configuration for a specific Salesforce object.
     *
     * @param objectApiName The API name of the object (e.g., 'Account', 'Contact', 'Custom__c')
     * @return Supported_Object__mdt configuration record
     * @throws DocgenObjectConfigException if object is not configured or not active
     */
    public static Supported_Object__mdt getConfigForObject(String objectApiName) {
        // Validate input
        if (String.isBlank(objectApiName)) {
            throw new DocgenObjectConfigException('Object API name cannot be null or empty');
        }

        // Get all active configs (uses cache)
        Map<String, Supported_Object__mdt> allConfigs = getAllActiveConfigs();

        // Lookup config (case-insensitive)
        String normalizedName = objectApiName.toLowerCase();
        Supported_Object__mdt config = null;

        for (String key : allConfigs.keySet()) {
            if (key.toLowerCase() == normalizedName) {
                config = allConfigs.get(key);
                break;
            }
        }

        // Throw exception if not found
        if (config == null) {
            throw new DocgenObjectConfigException(
                'Object type \'' + objectApiName + '\' is not configured for document generation. ' +
                'Contact your administrator to enable this object type.'
            );
        }

        return config;
    }

    /**
     * Get all active object configurations.
     * Results are cached in a static variable for the duration of the transaction.
     *
     * @return Map of object API names to configuration records
     */
    public static Map<String, Supported_Object__mdt> getAllActiveConfigs() {
        // Return from cache if already loaded
        if (configCache != null) {
            return configCache;
        }

        // Query all active configurations
        List<Supported_Object__mdt> activeConfigs = [
            SELECT
                Object_API_Name__c,
                Lookup_Field_API_Name__c,
                Is_Active__c,
                Display_Order__c,
                Description__c,
                Label,
                DeveloperName
            FROM Supported_Object__mdt
            WHERE Is_Active__c = true
            ORDER BY Display_Order__c ASC NULLS LAST, Object_API_Name__c ASC
        ];

        // Build cache map (keyed by Object_API_Name__c)
        configCache = new Map<String, Supported_Object__mdt>();
        for (Supported_Object__mdt config : activeConfigs) {
            configCache.put(config.Object_API_Name__c, config);
        }

        return configCache;
    }

    /**
     * Check if an object is supported for document generation.
     *
     * @param objectApiName The API name of the object to check
     * @return true if object is configured and active, false otherwise
     */
    public static Boolean isObjectSupported(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            return false;
        }

        try {
            getConfigForObject(objectApiName);
            return true;
        } catch (DocgenObjectConfigException e) {
            return false;
        }
    }

    /**
     * Validate that an object is supported for document generation.
     * Throws a clear exception if object is not configured.
     *
     * @param objectApiName The API name of the object to validate
     * @throws DocgenObjectConfigException if object is not supported
     */
    public static void validateObjectSupported(String objectApiName) {
        // This will throw DocgenObjectConfigException if not supported
        getConfigForObject(objectApiName);
    }

    /**
     * Clear the configuration cache.
     * Primarily used for testing to reset state between test methods.
     *
     * @TestVisible to allow test classes to reset cache
     */
    @TestVisible
    private static void clearCache() {
        configCache = null;
    }
}
