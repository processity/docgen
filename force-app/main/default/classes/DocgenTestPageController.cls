/**
 * Controller for the docgenTestPage LWC component
 * Provides methods to fetch Generated_Document__c records for display in the test page
 * Supports multiple object types configured in Supported_Object__mdt
 */
public with sharing class DocgenTestPageController {

    // Allowed lookup field names to prevent SOQL injection
    private static final Set<String> ALLOWED_LOOKUP_FIELDS = new Set<String>{
        'Account__c', 'Opportunity__c', 'Case__c', 'Contact__c', 'Lead__c'
    };

    /**
     * Get all active supported objects from custom metadata
     * @return List of active Supported_Object__mdt records ordered by Display_Order__c
     */
    @AuraEnabled(cacheable=true)
    public static List<Supported_Object__mdt> getSupportedObjects() {
        Map<String, Supported_Object__mdt> configMap = DocgenObjectConfigService.getAllActiveConfigs();
        return configMap.values();
    }

    /**
     * Get the SObject type name from a record ID
     * @param recordId The record ID to analyze
     * @return The SObject API name (e.g., 'Account', 'Contact', 'Lead')
     */
    @AuraEnabled(cacheable=true)
    public static String getObjectTypeFromRecordId(Id recordId) {
        if (recordId == null) {
            return null;
        }
        return recordId.getSObjectType().getDescribe().getName();
    }

    /**
     * Get Generated_Document__c records for a given record using dynamic lookup field
     * @param recordId The record ID to filter by
     * @param lookupFieldName The lookup field API name (e.g., 'Account__c', 'Contact__c')
     * @return List of Generated_Document__c records with related Template data
     */
    @AuraEnabled(cacheable=true)
    public static List<Generated_Document__c> getGeneratedDocuments(Id recordId, String lookupFieldName) {
        if (recordId == null || String.isBlank(lookupFieldName)) {
            return new List<Generated_Document__c>();
        }

        // Validate lookup field to prevent SOQL injection
        if (!ALLOWED_LOOKUP_FIELDS.contains(lookupFieldName)) {
            throw new AuraHandledException('Invalid lookup field: ' + lookupFieldName);
        }

        // Build dynamic SOQL query
        String query =
            'SELECT Id, Name, Status__c, OutputFormat__c, CreatedDate, ' +
            '       Template__c, Template__r.Name, Error__c, ' +
            '       OutputFileId__c, CorrelationId__c ' +
            'FROM Generated_Document__c ' +
            'WHERE ' + lookupFieldName + ' = :recordId ' +
            'ORDER BY CreatedDate DESC ' +
            'LIMIT 50';

        return Database.query(query);
    }
}
