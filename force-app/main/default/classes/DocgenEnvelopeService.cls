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
}
