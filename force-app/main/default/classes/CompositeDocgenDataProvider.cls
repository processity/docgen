/**
 * Composite Document Data Provider
 *
 * Orchestrates multiple data sources with isolated namespaces for composite document generation.
 * Implements the DocgenDataProvider interface but forces use of static buildCompositeData() method.
 *
 * Key Features:
 * - Namespace isolation: Each template's data stored under its namespace key
 * - Sequence ordering: Templates execute in Sequence__c order
 * - Variable pool: Data sharing between templates (e.g., first template queries Account, second uses AccountId)
 * - Mixed providers: Supports both SOQL and Custom data providers
 * - Locale/timezone propagation: Passes formatting preferences to all child providers
 *
 * Usage:
 *   Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };
 *   Map<String, Object> data = CompositeDocgenDataProvider.buildCompositeData(
 *       compositeDocId, recordIds, 'en-GB', 'Europe/London'
 *   );
 *
 * @see CompositeDocgenDataProviderTest for comprehensive usage examples
 */
public class CompositeDocgenDataProvider implements DocgenDataProvider {

    /**
     * NOT SUPPORTED - Use buildCompositeData() instead
     *
     * The standard buildData() signature doesn't support composite context
     * (compositeDocId, multiple recordIds). This method throws an exception
     * directing callers to use the static buildCompositeData() method.
     */
    public Map<String, Object> buildData(
        Id recordId,
        Docgen_Template__c template,
        String locale,
        String timezone
    ) {
        throw new CompositeDocgenException(
            'Use buildCompositeData() for composite documents. ' +
            'The buildData() method signature does not support composite context.'
        );
    }

    /**
     * Build composite data from multiple templates with namespace isolation
     *
     * @param compositeDocId Composite_Document__c ID
     * @param recordIds Map of variable names to record IDs (e.g., {"accountId": "001xxx", "contactId": "003xxx"})
     * @param locale User locale for formatting (e.g., "en-GB", "de-DE")
     * @param timezone User timezone for datetime conversion (e.g., "Europe/London")
     * @return Map with namespace-isolated data (e.g., {"Account": {...}, "Terms": {...}})
     * @throws CompositeDocgenException for duplicate namespaces or provider errors
     */
    public static Map<String, Object> buildCompositeData(
        Id compositeDocId,
        Map<String, Id> recordIds,
        String locale,
        String timezone
    ) {
        // Load junction records ordered by Sequence__c
        List<Composite_Document_Template__c> junctions = queryJunctionRecords(compositeDocId);

        // Return empty map if no templates configured
        if (junctions.isEmpty()) {
            return new Map<String, Object>();
        }

        // Validate no namespace collisions
        validateNamespaceUniqueness(junctions);

        // Execute each template's data provider and merge results
        Map<String, Object> compositeData = new Map<String, Object>();
        Map<String, Id> variablePool = new Map<String, Id>(recordIds); // Shared variable pool

        for (Composite_Document_Template__c junction : junctions) {
            Docgen_Template__c tmpl = junction.Document_Template__r;

            // Determine record ID for this template
            Id templateRecordId = determineRecordId(tmpl, variablePool);

            // Get data provider (SOQL or Custom)
            DocgenDataProvider provider = getProvider(tmpl);

            // Execute provider
            Map<String, Object> namespaceData = provider.buildData(
                templateRecordId,
                tmpl,
                locale,
                timezone
            );

            // Store in namespace key
            compositeData.put(junction.Namespace__c, namespaceData);

            // Extract new variables for subsequent templates
            extractVariablesFromData(namespaceData, variablePool);
        }

        return compositeData;
    }

    /**
     * Query junction records with template relationship traversal
     *
     * @param compositeDocId Composite_Document__c ID
     * @return List of junction records ordered by Sequence__c, filtered by IsActive__c
     */
    private static List<Composite_Document_Template__c> queryJunctionRecords(Id compositeDocId) {
        return [
            SELECT Id, Namespace__c, Sequence__c, Document_Template__c,
                   Document_Template__r.TemplateContentVersionId__c,
                   Document_Template__r.DataSource__c,
                   Document_Template__r.SOQL__c,
                   Document_Template__r.ClassName__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :compositeDocId
              AND IsActive__c = true
            ORDER BY Sequence__c ASC
        ];
    }

    /**
     * Validate namespace uniqueness across junction records
     *
     * @param junctions List of junction records to validate
     * @throws CompositeDocgenException if duplicate namespace found
     */
    private static void validateNamespaceUniqueness(List<Composite_Document_Template__c> junctions) {
        Set<String> namespaces = new Set<String>();

        for (Composite_Document_Template__c junction : junctions) {
            if (namespaces.contains(junction.Namespace__c)) {
                throw new CompositeDocgenException(
                    'Duplicate namespace: ' + junction.Namespace__c + '. ' +
                    'Each template in a composite document must have a unique namespace.'
                );
            }
            namespaces.add(junction.Namespace__c);
        }
    }

    /**
     * Get data provider instance (SOQL or Custom)
     *
     * Follows the same provider factory pattern as DocgenEnvelopeService.
     *
     * @param template Template with DataSource__c and optional ClassName__c
     * @return DocgenDataProvider instance
     * @throws IllegalArgumentException if provider class not found or invalid
     */
    private static DocgenDataProvider getProvider(Docgen_Template__c template) {
        if (template.DataSource__c == 'Custom' && String.isNotBlank(template.ClassName__c)) {
            Type providerType = Type.forName(template.ClassName__c);

            if (providerType == null) {
                throw new IllegalArgumentException(
                    'Provider class not found: ' + template.ClassName__c
                );
            }

            Object instance = providerType.newInstance();

            if (!(instance instanceof DocgenDataProvider)) {
                throw new IllegalArgumentException(
                    'Class must implement DocgenDataProvider: ' + template.ClassName__c
                );
            }

            return (DocgenDataProvider) instance;
        } else {
            // Default to SOQL provider
            return new StandardSOQLProvider();
        }
    }

    /**
     * Determine record ID for template execution
     *
     * Tries to intelligently select the correct record ID from the variable pool
     * by attempting to match the object type from the SOQL query.
     *
     * Strategy:
     * 1. Parse FROM clause in SOQL to detect object type (e.g., "FROM Account")
     * 2. Look for matching variable key (e.g., "accountId" for Account object)
     * 3. Fall back to first available ID if no match found
     *
     * @param template Template with SOQL query (for SOQL providers)
     * @param variablePool Map of variable names to record IDs
     * @return Appropriate record ID, or null if pool is empty
     */
    private static Id determineRecordId(Docgen_Template__c template, Map<String, Id> variablePool) {
        if (variablePool == null || variablePool.isEmpty()) {
            return null;
        }

        // For SOQL providers, try to detect object type from query
        if (template.DataSource__c == 'SOQL' && String.isNotBlank(template.SOQL__c)) {
            String soql = template.SOQL__c.toLowerCase();

            // Extract object name from FROM clause (simple pattern matching)
            // Handles: "FROM Account", "FROM Opportunity", etc.
            Pattern fromPattern = Pattern.compile('from\\s+(\\w+)');
            Matcher fromMatcher = fromPattern.matcher(soql);

            if (fromMatcher.find()) {
                String objectType = fromMatcher.group(1);
                // Try to find matching variable (e.g., "account" -> "accountId")
                // Note: objectType is lowercase from the regex match, so we need "accountId" format
                String variableKey = objectType + 'Id';

                if (variablePool.containsKey(variableKey)) {
                    return variablePool.get(variableKey);
                }
            }
        }

        // Fall back to first available ID
        return variablePool.values()[0];
    }

    /**
     * Extract common ID fields from namespace data for subsequent queries
     *
     * Scans the data structure for standard relationship fields (AccountId, ContactId, etc.)
     * and adds them to the variable pool for use by subsequent templates.
     *
     * Example: First template queries Opportunity (returns AccountId), second template
     * can use the extracted accountId to query Account data.
     *
     * @param namespaceData Data returned from provider
     * @param variablePool Variable pool to populate (modified in place)
     */
    private static void extractVariablesFromData(
        Map<String, Object> namespaceData,
        Map<String, Id> variablePool
    ) {
        if (namespaceData == null || variablePool == null) {
            return;
        }

        // Common parent relationship field names
        Set<String> parentFields = new Set<String>{
            'AccountId',
            'ContactId',
            'OpportunityId',
            'CaseId',
            'LeadId'
        };

        // Scan all values in namespace data (handles both single object and nested structures)
        for (Object value : namespaceData.values()) {
            if (value instanceof Map<String, Object>) {
                Map<String, Object> record = (Map<String, Object>) value;

                // Extract parent relationship IDs
                for (String parentField : parentFields) {
                    if (record.containsKey(parentField)) {
                        Object fieldValue = record.get(parentField);

                        if (fieldValue instanceof Id) {
                            // Store with lowercase key (e.g., 'AccountId' -> 'accountId')
                            String variableKey = parentField.substring(0, 1).toLowerCase() +
                                               parentField.substring(1);
                            variablePool.put(variableKey, (Id) fieldValue);
                        }
                    }
                }
            }
        }
    }
}
