/**
 * Service for building complete document generation envelopes
 * Composes data from providers, computes RequestHash, and builds JSON payload
 */
public with sharing class DocgenEnvelopeService {
    @TestVisible
    private static final Integer REQUEST_JSON_SEGMENT_LENGTH = 131072;
    private static final List<String> REQUEST_JSON_FIELD_NAMES = new List<String>{
        'RequestJSON__c',
        'RequestJSON02__c',
        'RequestJSON03__c',
        'RequestJSON04__c',
        'RequestJSON05__c',
        'RequestJSON06__c',
        'RequestJSON07__c',
        'RequestJSON08__c',
        'RequestJSON09__c',
        'RequestJSON10__c'
    };
    private static final Set<String> OUTPUT_FORMATS_WITH_EXTENSIONS = new Set<String>{'PDF', 'DOCX', 'PPTX'};

    public static String resolveOutputFormat(String requestedOutputFormat, String defaultOutputFormat) {
        String candidate = String.isBlank(requestedOutputFormat) ? defaultOutputFormat : requestedOutputFormat;
        String normalized = String.isBlank(candidate) ? 'PDF' : candidate.trim().toUpperCase();
        if (!OUTPUT_FORMATS_WITH_EXTENSIONS.contains(normalized)) {
            throw new IllegalArgumentException('Output Format must be PDF, DOCX, or PPTX');
        }
        return normalized;
    }

    private static String getDefaultOutputFormat(SObject record) {
        if (record == null) {
            return null;
        }
        Object value = record.getPopulatedFieldsAsMap().get('Default_Output_Format__c');
        return value == null ? null : String.valueOf(value);
    }

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
     * @param outputFormat PDF, DOCX, or PPTX
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
        String effectiveOutputFormat = resolveOutputFormat(outputFormat, getDefaultOutputFormat(template));

        // Set basic fields
        env.templateId = template.TemplateContentVersionId__c;
        env.outputFormat = effectiveOutputFormat;
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
        env.options.put('readOnlyWord', getReadOnlyWordOption(recordId, env.data));
        String objectType = recordId.getSObjectType().getDescribe().getName();
        String watermarkText = resolveWatermarkText(template, env.data, objectType);
        if (String.isNotBlank(watermarkText)) {
            env.options.put('watermarkText', watermarkText);
            String watermarkStyle = getOptionalString(template, 'Watermark_Style__c');
            if (String.isNotBlank(watermarkStyle)) {
                env.options.put('watermarkStyle', watermarkStyle.trim());
            }
        }

        // Extract parent IDs
        env.parents = extractParentIds(recordId, env.data);

        // Generate output filename (can contain placeholders)
        env.outputFileName = generateOutputFileName(recordId, template, env.data, effectiveOutputFormat);

        // Compute request hash for idempotency
        String dataJson = JSON.serialize(env.data);
        String optionsJson = JSON.serialize(env.options);
        env.requestHash = computeHash(
            env.templateId,
            env.outputFormat,
            dataJson,
            getOutputFileNameForHash(template, env.outputFileName),
            optionsJson
        );

        return env;
    }

    /**
     * Compute SHA-256 hash for idempotency
     * Format: sha256:{templateId}|{outputFormat}|{dataChecksum}
     *
     * @param templateId ContentVersionId of template
     * @param outputFormat PDF, DOCX, or PPTX
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
     * Compute SHA-256 hash for idempotency including output-affecting options.
     *
     * @param templateId ContentVersionId of template
     * @param outputFormat PDF, DOCX, or PPTX
     * @param dataJson Serialized data object
     * @param outputFileName Resolved output filename
     * @param optionsJson Serialized options object
     * @return Hash string with sha256: prefix
     */
    public static String computeHash(
        String templateId,
        String outputFormat,
        String dataJson,
        String outputFileName,
        String optionsJson
    ) {
        String input = templateId + '|' + outputFormat + '|' +
            String.valueOf(outputFileName) + '|' + String.valueOf(optionsJson) + '|' + dataJson;

        Blob hash = Crypto.generateDigest('SHA-256', Blob.valueOf(input));

        return 'sha256:' + EncodingUtil.convertToHex(hash);
    }

    /**
     * Convert envelope to JSON string for storage
     * Excludes null composite fields to maintain backward compatibility with backend schema
     *
     * @param env Envelope to serialize
     * @return JSON string
     */
    public static String toJSON(Envelope env) {
        Map<String, Object> jsonMap = new Map<String, Object>();

        // Always include these fields (even if null for some)
        jsonMap.put('outputFileName', env.outputFileName);
        jsonMap.put('outputFormat', env.outputFormat);
        jsonMap.put('locale', env.locale);
        jsonMap.put('timezone', env.timezone);
        jsonMap.put('options', env.options);
        jsonMap.put('data', env.data);

        // Include optional fields only if they have values
        if (env.templateId != null) {
            jsonMap.put('templateId', env.templateId);
        }
        if (env.parents != null && !env.parents.isEmpty()) {
            jsonMap.put('parents', env.parents);
        }
        if (env.requestHash != null) {
            jsonMap.put('requestHash', env.requestHash);
        }
        if (env.generatedDocumentId != null) {
            jsonMap.put('generatedDocumentId', env.generatedDocumentId);
        }

        // Include composite fields only if they have values (avoid null in JSON for enum validation)
        if (env.compositeDocumentId != null) {
            jsonMap.put('compositeDocumentId', env.compositeDocumentId);
        }
        if (env.templateStrategy != null) {
            jsonMap.put('templateStrategy', env.templateStrategy);
        }
        if (env.templates != null && !env.templates.isEmpty()) {
            jsonMap.put('templates', env.templates);
        }

        return JSON.serialize(jsonMap);
    }

    public static void setRequestJSONSegments(Generated_Document__c doc, String requestJSON) {
        if (doc == null) {
            throw new IllegalArgumentException('Generated document cannot be null');
        }

        for (String fieldName : REQUEST_JSON_FIELD_NAMES) {
            doc.put(fieldName, null);
        }

        if (requestJSON == null) {
            return;
        }

        Integer maxLength = REQUEST_JSON_SEGMENT_LENGTH * REQUEST_JSON_FIELD_NAMES.size();
        if (requestJSON.length() > maxLength) {
            throw new IllegalArgumentException('Request JSON exceeds segmented storage capacity');
        }

        Integer start = 0;
        Integer segmentIndex = 0;
        while (start < requestJSON.length()) {
            Integer endIndex = start + REQUEST_JSON_SEGMENT_LENGTH;
            if (endIndex > requestJSON.length()) {
                endIndex = requestJSON.length();
            }
            doc.put(REQUEST_JSON_FIELD_NAMES[segmentIndex], requestJSON.substring(start, endIndex));
            start = endIndex;
            segmentIndex++;
        }
    }

    public static String reconstructRequestJSON(Generated_Document__c doc) {
        if (doc == null) {
            return null;
        }

        List<String> segments = new List<String>();
        for (String fieldName : REQUEST_JSON_FIELD_NAMES) {
            String segment = getStringFieldValue(doc, fieldName);
            if (segment != null) {
                segments.add(segment);
            }
        }

        return segments.isEmpty() ? null : String.join(segments, '');
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
     * Generate output filename from configured data path, or fallback to timestamp naming.
     */
    @TestVisible
    private static String generateOutputFileName(
        Id recordId,
        Docgen_Template__c template,
        Map<String, Object> data,
        String outputFormat
    ) {
        String objectType = recordId.getSObjectType().getDescribe().getName();
        String configuredPath = template.Output_File_Name_Field__c;
        if (String.isNotBlank(configuredPath)) {
            Object configuredValue = resolveSimpleFieldPath(data, configuredPath, objectType);
            if (configuredValue != null) {
                String configuredFileName = sanitizeFileName(String.valueOf(configuredValue));
                if (String.isNotBlank(configuredFileName)) {
                    return enforceOutputExtension(configuredFileName, outputFormat);
                }
            }
        }

        return generateTimestampFileName(objectType, template.Name, outputFormat);
    }

    // ========== T-20: Composite Document Support ==========

    /**
     * Build complete envelope for composite document generation
     *
     * @param compositeDocId Composite document ID
     * @param recordIds Map of variable names to record IDs (e.g., {"accountId": "001xxx", "contactId": "003xxx"})
     * @param outputFormat PDF, DOCX, or PPTX
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
        String effectiveOutputFormat = resolveOutputFormat(outputFormat, getDefaultOutputFormat(composite));

        // Set basic fields
        env.compositeDocumentId = compositeDocId;
        env.outputFormat = effectiveOutputFormat;
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
        env.options.put('readOnlyWord', getReadOnlyWordOptionFromData(env.data));
        String watermarkText = resolveWatermarkText(composite, env.data, null);
        if (String.isNotBlank(watermarkText)) {
            env.options.put('watermarkText', watermarkText);
            String watermarkStyle = getOptionalString(composite, 'Watermark_Style__c');
            if (String.isNotBlank(watermarkStyle)) {
                env.options.put('watermarkStyle', watermarkStyle.trim());
            }
        }

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
        env.outputFileName = generateCompositeFileName(composite, env.data, effectiveOutputFormat);

        // Compute request hash for idempotency
        String dataJson = JSON.serialize(env.data);
        String recordIdsJson = JSON.serialize(recordIds);
        String optionsJson = JSON.serialize(env.options);
        env.requestHash = computeCompositeHash(
            compositeDocId,
            effectiveOutputFormat,
            recordIdsJson,
            dataJson,
            getCompositeOutputFileNameForHash(composite, env.outputFileName),
            optionsJson
        );

        return env;
    }

    /**
     * Load composite document configuration
     */
    @TestVisible
    private static Composite_Document__c loadCompositeConfig(Id compositeDocId) {
        List<Composite_Document__c> composites = [
            SELECT Id, Name, Template_Strategy__c, TemplateContentVersionId__c,
                   StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                   Default_Output_Format__c, Output_File_Name_Field__c, Watermark_Text__c,
                   Watermark_Condition_Field__c, Watermark_Style__c
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
     * Compute SHA-256 hash for composite document idempotency including output-affecting options.
     */
    @TestVisible
    private static String computeCompositeHash(
        String compositeDocId,
        String outputFormat,
        String recordIdsJson,
        String dataJson,
        String outputFileName,
        String optionsJson
    ) {
        String input = compositeDocId + '|' + outputFormat + '|' + recordIdsJson + '|' +
            String.valueOf(outputFileName) + '|' + String.valueOf(optionsJson) + '|' + dataJson;

        Blob hash = Crypto.generateDigest('SHA-256', Blob.valueOf(input));

        return 'sha256:' + EncodingUtil.convertToHex(hash);
    }

    /**
     * Generate output filename for composite document
     * Format: Composite_{Name}_{timestamp}.{ext}
     */
    @TestVisible
    private static String generateCompositeFileName(
        Composite_Document__c composite,
        Map<String, Object> data,
        String outputFormat
    ) {
        String configuredPath = getOptionalString(composite, 'Output_File_Name_Field__c');
        if (String.isNotBlank(configuredPath)) {
            Object configuredValue = resolveSimpleFieldPath(data, configuredPath, null);
            if (configuredValue != null) {
                String configuredFileName = sanitizeFileName(String.valueOf(configuredValue));
                if (String.isNotBlank(configuredFileName)) {
                    return enforceOutputExtension(configuredFileName, outputFormat);
                }
            }
        }

        String extension = getOutputExtension(outputFormat);
        String timestamp = Datetime.now().format('yyyyMMdd_HHmmss');
        String sanitizedName = composite.Name.replaceAll('[^a-zA-Z0-9]', '_');

        return 'Composite_' + sanitizedName + '_' + timestamp + '.' + extension;
    }

    private static String getCompositeOutputFileNameForHash(Composite_Document__c composite, String outputFileName) {
        if (composite != null && String.isNotBlank(getOptionalString(composite, 'Output_File_Name_Field__c'))) {
            return outputFileName;
        }
        return null;
    }

    private static String generateTimestampFileName(String objectType, String templateName, String outputFormat) {
        String extension = getOutputExtension(outputFormat);
        String timestamp = Datetime.now().format('yyyyMMdd_HHmmss');
        String sanitizedTemplateName = templateName == null ? 'Template' : templateName.replaceAll('[^a-zA-Z0-9]', '_');
        return objectType + '_' + sanitizedTemplateName + '_' + timestamp + '.' + extension;
    }

    private static String getOutputFileNameForHash(Docgen_Template__c template, String outputFileName) {
        if (template != null && String.isNotBlank(template.Output_File_Name_Field__c)) {
            return outputFileName;
        }
        return null;
    }

    @TestVisible
    private static Object resolveSimpleFieldPath(Map<String, Object> data, String fieldPath, String primaryObjectName) {
        if (data == null || String.isBlank(fieldPath)) {
            return null;
        }

        String trimmedPath = fieldPath.trim();
        if (!trimmedPath.contains('.')) {
            if (data.containsKey(trimmedPath)) {
                return data.get(trimmedPath);
            }

            if (String.isNotBlank(primaryObjectName) && data.get(primaryObjectName) instanceof Map<String, Object>) {
                Map<String, Object> primaryData = (Map<String, Object>) data.get(primaryObjectName);
                if (primaryData.containsKey(trimmedPath)) {
                    return primaryData.get(trimmedPath);
                }
            }

            if (data.size() == 1) {
                for (Object value : data.values()) {
                    if (value instanceof Map<String, Object>) {
                        Map<String, Object> nestedData = (Map<String, Object>) value;
                        if (nestedData.containsKey(trimmedPath)) {
                            return nestedData.get(trimmedPath);
                        }
                    }
                }
            }

            return null;
        }

        Object currentValue = data;
        for (String part : trimmedPath.split('\\.')) {
            if (String.isBlank(part)) {
                return null;
            }
            if (!(currentValue instanceof Map<String, Object>)) {
                return null;
            }

            Map<String, Object> currentMap = (Map<String, Object>) currentValue;
            if (!currentMap.containsKey(part)) {
                return null;
            }
            currentValue = currentMap.get(part);
        }

        return currentValue;
    }

    private static String sanitizeFileName(String fileName) {
        if (String.isBlank(fileName)) {
            return null;
        }

        String sanitized = fileName.trim();
        sanitized = sanitized.replaceAll('[\\\\/:*?"<>|]+', '_');
        sanitized = sanitized.replaceAll('[\\r\\n\\t]+', ' ');
        sanitized = sanitized.replaceAll('\\s+', ' ');
        sanitized = sanitized.replaceAll('^\\.+', '');
        sanitized = sanitized.replaceAll('\\.+$', '');
        return sanitized.trim();
    }

    private static String enforceOutputExtension(String fileName, String outputFormat) {
        String sanitized = sanitizeFileName(fileName);
        if (String.isBlank(sanitized)) {
            return null;
        }

        String lowerName = sanitized.toLowerCase();
        for (String format : OUTPUT_FORMATS_WITH_EXTENSIONS) {
            String existingExtension = '.' + format.toLowerCase();
            if (lowerName.endsWith(existingExtension)) {
                sanitized = sanitized.substring(0, sanitized.length() - existingExtension.length());
                break;
            }
        }

        if (String.isBlank(sanitized)) {
            return null;
        }
        return sanitized + '.' + getOutputExtension(outputFormat);
    }

    private static String getOutputExtension(String outputFormat) {
        if (String.isBlank(outputFormat)) {
            return 'pdf';
        }
        return outputFormat.trim().toLowerCase();
    }

    private static String resolveWatermarkText(SObject config, Map<String, Object> data, String primaryObjectName) {
        String watermarkText = getOptionalString(config, 'Watermark_Text__c');
        if (String.isBlank(watermarkText)) {
            return null;
        }

        String conditionPath = getOptionalString(config, 'Watermark_Condition_Field__c');
        if (String.isNotBlank(conditionPath)) {
            Object conditionValue = resolveSimpleFieldPath(data, conditionPath, primaryObjectName);
            if (!isTruthy(conditionValue)) {
                return null;
            }
        }

        return watermarkText.trim();
    }

    private static String getOptionalString(SObject record, String fieldApiName) {
        if (record == null || String.isBlank(fieldApiName)) {
            return null;
        }

        Map<String, Object> fields = record.getPopulatedFieldsAsMap();
        if (!fields.containsKey(fieldApiName)) {
            return null;
        }

        Object value = fields.get(fieldApiName);
        return value == null ? null : String.valueOf(value);
    }

    private static Boolean isTruthy(Object value) {
        Boolean booleanValue = toBoolean(value);
        if (booleanValue != null) {
            return booleanValue;
        }
        if (value instanceof String) {
            String stringValue = ((String) value).trim();
            return stringValue != '' && stringValue != '0';
        }
        return value != null;
    }

    private static Boolean getReadOnlyWordOption(Id recordId, Map<String, Object> data) {
        if (recordId == null || recordId.getSObjectType().getDescribe().getName() != 'Case') {
            return false;
        }

        Boolean dataValue = getReadOnlyWordOptionFromData(data);
        if (dataValue != null) {
            return dataValue;
        }

        Schema.SObjectType caseType = Schema.getGlobalDescribe().get('Case');
        if (caseType == null || !caseType.getDescribe().fields.getMap().containsKey('Standard_Template__c')) {
            return false;
        }

        List<SObject> cases = Database.query('SELECT Standard_Template__c FROM Case WHERE Id = :recordId LIMIT 1');
        if (cases.isEmpty()) {
            return false;
        }
        Object standardTemplate = cases[0].get('Standard_Template__c');
        return standardTemplate == null ? false : (Boolean) standardTemplate;
    }

    private static Boolean getReadOnlyWordOptionFromData(Map<String, Object> data) {
        Object value = resolveSimpleFieldPath(data, 'Case.Standard_Template__c', 'Case');
        return toBoolean(value);
    }

    private static Boolean toBoolean(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value instanceof String) {
            String stringValue = ((String) value).trim().toLowerCase();
            if (stringValue == 'true') return true;
            if (stringValue == 'false') return false;
        }
        return null;
    }

    private static String getStringFieldValue(SObject record, String fieldName) {
        try {
            Object value = record.get(fieldName);
            return value == null ? null : String.valueOf(value);
        } catch (Exception e) {
            return null;
        }
    }
}
