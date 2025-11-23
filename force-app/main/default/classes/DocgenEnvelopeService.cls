/**
 * Service for building complete document generation envelopes
 * Composes data from providers, computes RequestHash, and builds JSON payload
 */
public with sharing class DocgenEnvelopeService {

    /**
     * Envelope structure matching TypeScript DocgenRequest interface
     */
    public class Envelope {
        public String templateId;
        public String outputFileName;
        public String outputFormat;
        public String locale;
        public String timezone;
        public Map<String, Object> options;
        public Map<String, Object> data;
        public Map<String, String> parents;
        public String requestHash;
        public String generatedDocumentId; // T-12: For status tracking

        // T-20: Composite document fields
        public String compositeDocumentId;
        public String templateStrategy; // "Own Template" or "Concatenate Templates"
        public List<TemplateRef> templates; // For concatenation strategy
    }

    /**
     * T-20: Template reference for concatenation strategy
     */
    public class TemplateRef {
        public String templateId; // ContentVersionId
        public String namespace; // Data key
        public Integer sequence; // Ordering
    }

    /**
     * Build complete envelope for document generation
     *
     * @param recordId Source record ID
     * @param template Template configuration
     * @param outputFormat PDF or DOCX
     * @param locale Locale for formatting (e.g., 'en-GB')
     * @param timezone Timezone for datetime formatting
     * @return Complete envelope ready for Node API
     */
    public static Envelope build(
        Id recordId,
        Docgen_Template__c template,
        String outputFormat,
        String locale,
        String timezone
    ) {
        Envelope env = new Envelope();

        // Set basic fields
        env.templateId = template.TemplateContentVersionId__c;
        env.outputFormat = outputFormat;
        env.locale = locale;
        env.timezone = timezone;

        // Build options from template settings
        env.options = new Map<String, Object>{
            'storeMergedDocx' => template.StoreMergedDocx__c != null ? template.StoreMergedDocx__c : false,
            'returnDocxToBrowser' => template.ReturnDocxToBrowser__c != null ? template.ReturnDocxToBrowser__c : true
        };

        // Get data from appropriate provider
        DocgenDataProvider provider = getProvider(template);
        env.data = provider.buildData(recordId, template, locale, timezone);

        // Extract parent IDs
        env.parents = extractParentIds(recordId, env.data);

        // Generate output filename (can contain placeholders)
        env.outputFileName = generateOutputFileName(recordId, template, env.data, outputFormat);

        // Compute request hash for idempotency
        String dataJson = JSON.serialize(env.data);
        env.requestHash = computeHash(env.templateId, env.outputFormat, dataJson);

        return env;
    }

    /**
     * Compute SHA-256 hash for idempotency
     * Format: sha256:{templateId}|{outputFormat}|{dataChecksum}
     *
     * @param templateId ContentVersionId of template
     * @param outputFormat PDF or DOCX
     * @param dataJson Serialized data object
     * @return Hash string with sha256: prefix
     */
    public static String computeHash(String templateId, String outputFormat, String dataJson) {
        // Create deterministic input string
        String input = templateId + '|' + outputFormat + '|' + dataJson;

        // Generate SHA-256 hash
        Blob hash = Crypto.generateDigest('SHA-256', Blob.valueOf(input));

        // Convert to hex and prepend prefix
        return 'sha256:' + EncodingUtil.convertToHex(hash);
    }

    /**
     * Convert envelope to JSON string for storage
     *
     * @param env Envelope to serialize
     * @return JSON string
     */
    public static String toJSON(Envelope env) {
        return JSON.serialize(env);
    }

    /**
     * Factory method to get appropriate data provider
     */
    @TestVisible
    private static DocgenDataProvider getProvider(Docgen_Template__c template) {
        if (template.DataSource__c == 'SOQL') {
            return new StandardSOQLProvider();
        } else if (template.DataSource__c == 'Custom') {
            if (String.isBlank(template.ClassName__c)) {
                throw new IllegalArgumentException('ClassName__c is required for Custom data source');
            }

            // Dynamically instantiate custom provider
            Type providerType = Type.forName(template.ClassName__c);
            if (providerType == null) {
                throw new IllegalArgumentException('Provider class not found: ' + template.ClassName__c);
            }

            Object instance = providerType.newInstance();
            if (!(instance instanceof DocgenDataProvider)) {
                throw new IllegalArgumentException('Class must implement DocgenDataProvider: ' + template.ClassName__c);
            }

            return (DocgenDataProvider) instance;
        } else {
            throw new IllegalArgumentException('Invalid DataSource__c: ' + template.DataSource__c);
        }
    }

    /**
     * Extract parent IDs from record and data
     * Dynamically builds parents map for any object type using format "{ObjectType}Id"
     * Also extracts parent relationships from data (e.g., AccountId from Contact/Opportunity/Case)
     */
    @TestVisible
    private static Map<String, String> extractParentIds(Id recordId, Map<String, Object> data) {
        // Dynamic map structure - build based on actual parents, not hardcoded
        Map<String, String> parents = new Map<String, String>();

        // Get object type from recordId
        String objectApiName = recordId.getSObjectType().getDescribe().getName();

        // Set primary parent with dynamic key format: "{ObjectType}Id"
        String primaryParentKey = objectApiName + 'Id';
        parents.put(primaryParentKey, recordId);

        // Extract additional parent relationships from data map
        // Define potential parent fields to look for across all objects
        Set<String> potentialParentFields = new Set<String>{
            'AccountId',
            'ContactId',
            'OpportunityId',
            'CaseId',
            'LeadId'
        };

        // Get the data map for this object type
        Map<String, Object> objectData = (Map<String, Object>) data.get(objectApiName);

        // Extract parent IDs from the object's data
        if (objectData != null) {
            for (String parentField : potentialParentFields) {
                // Skip if this is the primary parent (already added)
                if (parentField == primaryParentKey) {
                    continue;
                }

                // Check if this parent field exists in the data
                if (objectData.containsKey(parentField)) {
                    String parentId = (String) objectData.get(parentField);
                    // Only add non-null parent IDs
                    if (parentId != null && parentId != '') {
                        parents.put(parentField, parentId);
                    }
                }
            }
        }

        return parents;
    }

    /**
     * Generate output filename (placeholder support for future enhancement)
     */
    @TestVisible
    private static String generateOutputFileName(
        Id recordId,
        Docgen_Template__c template,
        Map<String, Object> data,
        String outputFormat
    ) {
        // For now, generate simple filename
        // Future: Support placeholders like "Quote_{{Opportunity.Name}}.pdf"
        String objectType = recordId.getSObjectType().getDescribe().getName();
        String extension = outputFormat.toLowerCase();
        String timestamp = Datetime.now().format('yyyyMMdd_HHmmss');

        return objectType + '_' + template.Name.replaceAll('[^a-zA-Z0-9]', '_') + '_' + timestamp + '.' + extension;
    }

    // ========== T-20: Composite Document Support ==========

    /**
     * Build complete envelope for composite document generation
     *
     * @param compositeDocId Composite document ID
     * @param recordIds Map of variable names to record IDs (e.g., {"accountId": "001xxx", "contactId": "003xxx"})
     * @param outputFormat PDF or DOCX
     * @param locale Locale for formatting (e.g., 'en-GB')
     * @param timezone Timezone for datetime formatting
     * @return Complete envelope ready for Node API
     */
    public static Envelope buildForComposite(
        Id compositeDocId,
        Map<String, Id> recordIds,
        String outputFormat,
        String locale,
        String timezone
    ) {
        Envelope env = new Envelope();

        // Load composite configuration
        Composite_Document__c composite = loadCompositeConfig(compositeDocId);

        // Set basic fields
        env.compositeDocumentId = compositeDocId;
        env.outputFormat = outputFormat;
        env.locale = locale;
        env.timezone = timezone;
        env.templateStrategy = composite.Template_Strategy__c;

        // Build options from composite settings
        env.options = new Map<String, Object>{
            'storeMergedDocx' => composite.StoreMergedDocx__c != null ? composite.StoreMergedDocx__c : false,
            'returnDocxToBrowser' => composite.ReturnDocxToBrowser__c != null ? composite.ReturnDocxToBrowser__c : true
        };

        // Get composite data from CompositeDocgenDataProvider
        env.data = CompositeDocgenDataProvider.buildCompositeData(
            compositeDocId,
            recordIds,
            locale,
            timezone
        );

        // Handle template strategy
        if (composite.Template_Strategy__c == 'Own Template') {
            // Single template that merges with full composite data
            env.templateId = composite.TemplateContentVersionId__c;
            env.templates = null;
        } else if (composite.Template_Strategy__c == 'Concatenate Templates') {
            // Multiple templates to be merged individually then concatenated
            env.templateId = null;
            env.templates = loadTemplateSequence(compositeDocId);
        }

        // Extract parent IDs from all namespaces
        env.parents = extractParentIdsFromCompositeData(env.data);

        // Generate output filename
        env.outputFileName = generateCompositeFileName(composite, outputFormat);

        // Compute request hash for idempotency
        String dataJson = JSON.serialize(env.data);
        String recordIdsJson = JSON.serialize(recordIds);
        env.requestHash = computeCompositeHash(compositeDocId, outputFormat, recordIdsJson, dataJson);

        return env;
    }

    /**
     * Load composite document configuration
     */
    @TestVisible
    private static Composite_Document__c loadCompositeConfig(Id compositeDocId) {
        List<Composite_Document__c> composites = [
            SELECT Id, Name, Template_Strategy__c, TemplateContentVersionId__c,
                   StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c
            FROM Composite_Document__c
            WHERE Id = :compositeDocId
            LIMIT 1
        ];

        if (composites.isEmpty()) {
            throw new IllegalArgumentException('Composite document not found: ' + compositeDocId);
        }

        return composites[0];
    }

    /**
     * Load template sequence for concatenation strategy
     */
    @TestVisible
    private static List<TemplateRef> loadTemplateSequence(Id compositeDocId) {
        List<Composite_Document_Template__c> junctions = [
            SELECT Id, Namespace__c, Sequence__c,
                   Document_Template__r.TemplateContentVersionId__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :compositeDocId
              AND IsActive__c = true
            ORDER BY Sequence__c ASC
        ];

        List<TemplateRef> templates = new List<TemplateRef>();
        for (Composite_Document_Template__c junction : junctions) {
            TemplateRef ref = new TemplateRef();
            ref.templateId = junction.Document_Template__r.TemplateContentVersionId__c;
            ref.namespace = junction.Namespace__c;
            ref.sequence = Integer.valueOf(junction.Sequence__c);
            templates.add(ref);
        }

        return templates;
    }

    /**
     * Extract parent IDs from all namespaces in composite data
     * First namespace wins for duplicate parent types
     */
    @TestVisible
    private static Map<String, String> extractParentIdsFromCompositeData(Map<String, Object> compositeData) {
        Map<String, String> parents = new Map<String, String>();

        // Define potential parent fields to look for
        Set<String> potentialParentFields = new Set<String>{
            'AccountId',
            'ContactId',
            'OpportunityId',
            'CaseId',
            'LeadId'
        };

        // Iterate through all namespaces
        for (String namespace : compositeData.keySet()) {
            Object namespaceValue = compositeData.get(namespace);

            // Each namespace should contain an object map
            if (namespaceValue instanceof Map<String, Object>) {
                Map<String, Object> namespaceMap = (Map<String, Object>) namespaceValue;

                // Check if this is already unwrapped (has Id directly) or needs unwrapping
                if (namespaceMap.containsKey('Id')) {
                    // Already unwrapped - process directly
                    String objectId = (String) namespaceMap.get('Id');
                    if (objectId != null && objectId != '') {
                        String parentKey = namespace + 'Id';
                        if (!parents.containsKey(parentKey)) {
                            parents.put(parentKey, objectId);
                        }
                    }

                    // Extract parent relationship fields
                    for (String parentField : potentialParentFields) {
                        if (namespaceMap.containsKey(parentField)) {
                            String parentId = (String) namespaceMap.get(parentField);
                            if (parentId != null && parentId != '' && !parents.containsKey(parentField)) {
                                parents.put(parentField, parentId);
                            }
                        }
                    }
                } else {
                    // Not unwrapped - look for nested object data (legacy format)
                    for (String key : namespaceMap.keySet()) {
                        Object dataValue = namespaceMap.get(key);

                        if (dataValue instanceof Map<String, Object>) {
                            Map<String, Object> objectData = (Map<String, Object>) dataValue;

                            // Extract object ID (use object type as key)
                            String objectId = (String) objectData.get('Id');
                            if (objectId != null && objectId != '') {
                                String parentKey = key + 'Id';
                                if (!parents.containsKey(parentKey)) {
                                    parents.put(parentKey, objectId);
                                }
                            }

                            // Extract parent relationship fields
                            for (String parentField : potentialParentFields) {
                                if (objectData.containsKey(parentField)) {
                                    String parentId = (String) objectData.get(parentField);
                                    if (parentId != null && parentId != '' && !parents.containsKey(parentField)) {
                                        parents.put(parentField, parentId);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return parents;
    }

    /**
     * Compute SHA-256 hash for composite document idempotency
     * Format: sha256:{compositeDocId}|{outputFormat}|{recordIdsJson}|{dataChecksum}
     */
    @TestVisible
    private static String computeCompositeHash(
        String compositeDocId,
        String outputFormat,
        String recordIdsJson,
        String dataJson
    ) {
        // Create deterministic input string including recordIds for uniqueness
        String input = compositeDocId + '|' + outputFormat + '|' + recordIdsJson + '|' + dataJson;

        // Generate SHA-256 hash
        Blob hash = Crypto.generateDigest('SHA-256', Blob.valueOf(input));

        // Convert to hex and prepend prefix
        return 'sha256:' + EncodingUtil.convertToHex(hash);
    }

    /**
     * Generate output filename for composite document
     * Format: Composite_{Name}_{timestamp}.{ext}
     */
    @TestVisible
    private static String generateCompositeFileName(
        Composite_Document__c composite,
        String outputFormat
    ) {
        String extension = outputFormat.toLowerCase();
        String timestamp = Datetime.now().format('yyyyMMdd_HHmmss');
        String sanitizedName = composite.Name.replaceAll('[^a-zA-Z0-9]', '_');

        return 'Composite_' + sanitizedName + '_' + timestamp + '.' + extension;
    }
}
