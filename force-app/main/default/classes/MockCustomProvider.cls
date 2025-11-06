/**
 * Mock custom data provider for testing
 * Demonstrates custom provider implementation pattern
 */
@isTest
public class MockCustomProvider implements DocgenDataProvider {

    /**
     * Returns mock data for testing custom provider flow
     */
    public Map<String, Object> buildData(
        Id recordId,
        Docgen_Template__c template,
        String locale,
        String timezone
    ) {
        // Return mock hierarchical data structure
        Map<String, Object> data = new Map<String, Object>();

        // Get object type from recordId
        String objectType = recordId.getSObjectType().getDescribe().getName();

        // Create mock data based on object type
        Map<String, Object> mockRecord = new Map<String, Object>{
            'Id' => recordId,
            'Name' => 'Mock ' + objectType,
            'MockField__formatted' => 'Formatted Mock Value'
        };

        data.put(objectType, mockRecord);

        return data;
    }
}
