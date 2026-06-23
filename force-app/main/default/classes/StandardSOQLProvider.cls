/**
 * Default SOQL-based data provider
 * Executes template.SOQL__c with :recordId binding (when present) and preformats all fields
 *
 * When ReturnMultipleRecords__c is enabled, returns ALL query results in a records array.
 * Otherwise, returns only the first record in object wrapper format (legacy behavior).
 */
public with sharing class StandardSOQLProvider implements DocgenDataProvider {

    /**
     * Builds data map by executing SOQL query and adding formatted fields
     *
     * @param recordId Record ID to bind to :recordId in SOQL
     * @param template Template containing SOQL__c query and ReturnMultipleRecords__c flag
     * @param locale User locale for formatting (e.g., "en-GB", "de-DE")
     * @param timezone User timezone for datetime conversion (e.g., "Europe/London")
     * @return Map with either single object or records array based on ReturnMultipleRecords__c
     */
    public Map<String, Object> buildData(
        Id recordId,
        Docgen_Template__c template,
        String locale,
        String timezone
    ) {
        // Validate template has SOQL
        if (String.isBlank(template.SOQL__c)) {
            throw new IllegalArgumentException('Template SOQL__c is required for StandardSOQLProvider');
        }

        // Safely bind :recordId if author used it in the template
        String soql = removeDuplicateTopLevelSelectItems(bindRecordId(template.SOQL__c, recordId));

        // Execute query
        List<SObject> results;
        try {
            results = Database.query(soql);
        } catch (Exception e) {
            // Surface template mistakes clearly
            throw new IllegalArgumentException('Invalid SOQL on template: ' + e.getMessage());
        }

        // Check if template wants multiple records returned
        Boolean returnMultiple = template.ReturnMultipleRecords__c != null && template.ReturnMultipleRecords__c;

        // Extract subquery relationship names from SOQL, organized by nesting level
        Map<String, Set<String>> nestedRelationshipMap = extractSubqueryRelationshipsNested(template.SOQL__c);
        // Top-level relationships are the keys of the map
        Set<String> topLevelRelationships = nestedRelationshipMap.keySet();
        Set<String> topLevelFields = extractTopLevelSelectedFields(template.SOQL__c);

        if (returnMultiple) {
            // Return ALL records in a records array (for composite documents)
            return buildMultiRecordData(results, locale, timezone, topLevelRelationships, nestedRelationshipMap, topLevelFields);
        } else {
            // Legacy behavior: return only first record
            return buildSingleRecordData(results, recordId, locale, timezone, topLevelRelationships, nestedRelationshipMap, topLevelFields);
        }
    }

    /**
     * Build data for single record (legacy behavior)
     * Throws exception if no records found
     */
    private Map<String, Object> buildSingleRecordData(
        List<SObject> results,
        Id recordId,
        String locale,
        String timezone,
        Set<String> queriedChildRelationships,
        Map<String, Set<String>> nestedRelationshipMap,
        Set<String> queriedScalarFields
    ) {
        if (results.isEmpty()) {
            throw new IllegalArgumentException('No records found for recordId: ' + recordId);
        }

        SObject record = results[0];

        // Build hierarchical data structure
        Map<String, Object> data = new Map<String, Object>();

        // Use actual record type (not the template's target)
        String objectType = record.getSObjectType().getDescribe().getName();

        // Process the record (scalars, parents, and child subqueries)
        Map<String, Object> processedRecord = processRecord(record, locale, timezone, queriedChildRelationships, nestedRelationshipMap, queriedScalarFields);

        data.put(objectType, processedRecord);
        return data;
    }

    /**
     * Extract subquery relationship names from SOQL string, organized by nesting level.
     * Returns a Map where:
     *   - Key: child relationship name (e.g., "Opportunities")
     *   - Value: set of ITS nested child relationship names (e.g., {"OpportunityLineItems"})
     *
     * For example, SOQL with (SELECT ... (SELECT ... FROM OpportunityLineItems) FROM Opportunities)
     * returns: {"Opportunities" => {"OpportunityLineItems"}, "OpportunityLineItems" => {}, ...}
     *
     * Note: In SOQL, nested FROMs appear BEFORE their parent FROMs textually, so we use a
     * two-pass approach to correctly determine parent-child relationships.
     */
    @TestVisible
    private static Map<String, Set<String>> extractSubqueryRelationshipsNested(String soql) {
        Map<String, Set<String>> relationshipMap = new Map<String, Set<String>>();
        if (String.isBlank(soql)) return relationshipMap;

        // First pass: collect all (relName, depth, position) tuples
        List<RelationshipInfo> relInfos = new List<RelationshipInfo>();
        Integer depth = 0;
        String soqlLower = soql.toLowerCase();

        for (Integer pos = 0; pos < soql.length(); pos++) {
            String ch = soql.substring(pos, pos + 1);
            if (ch == '(') {
                depth++;
            } else if (ch == ')') {
                depth--;
            } else if (pos + 4 <= soql.length() && soqlLower.substring(pos, pos + 4) == 'from') {
                // Check it's a word boundary (not part of "transform" etc)
                Boolean isWordStart = (pos == 0 || !soql.substring(pos - 1, pos).isAlpha());
                Boolean isWordEnd = (pos + 4 >= soql.length() || !soql.substring(pos + 4, pos + 5).isAlpha());

                if (isWordStart && isWordEnd && depth > 0) {
                    // Skip whitespace/newlines after FROM
                    Integer start = pos + 4;
                    while (start < soql.length()) {
                        String c = soql.substring(start, start + 1);
                        if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
                            start++;
                        } else {
                            break;
                        }
                    }
                    // Find end of relationship name (alphanumeric + underscore)
                    Integer endPos = start;
                    while (endPos < soql.length()) {
                        String c = soql.substring(endPos, endPos + 1);
                        if (c.isAlpha() || c.isNumeric() || c == '_') {
                            endPos++;
                        } else {
                            break;
                        }
                    }
                    if (endPos > start) {
                        String relName = soql.substring(start, endPos);
                        relInfos.add(new RelationshipInfo(relName, depth, pos));
                    }
                }
            }
        }

        // Second pass: determine parent-child relationships
        // For each relationship at depth N, find the closest relationship at depth N-1
        // that has a position AFTER it (that's the parent in SOQL syntax)
        for (RelationshipInfo info : relInfos) {
            relationshipMap.put(info.name, new Set<String>());
        }

        for (RelationshipInfo childInfo : relInfos) {
            if (childInfo.depth > 1) {
                // Find parent: relationship at depth-1 with position > child's position
                RelationshipInfo parentInfo = null;
                for (RelationshipInfo candidate : relInfos) {
                    if (candidate.depth == childInfo.depth - 1 && candidate.position > childInfo.position) {
                        if (parentInfo == null || candidate.position < parentInfo.position) {
                            parentInfo = candidate;
                        }
                    }
                }
                if (parentInfo != null) {
                    relationshipMap.get(parentInfo.name).add(childInfo.name);
                }
            }
        }

        return relationshipMap;
    }

    /**
     * Helper class to store relationship extraction info
     */
    private class RelationshipInfo {
        public String name;
        public Integer depth;
        public Integer position;

        public RelationshipInfo(String name, Integer depth, Integer position) {
            this.name = name;
            this.depth = depth;
            this.position = position;
        }
    }

    /**
     * Extract subquery relationship names from SOQL string (flat set for backward compatibility)
     */
    @TestVisible
    private static Set<String> extractSubqueryRelationships(String soql) {
        return extractSubqueryRelationshipsNested(soql).keySet();
    }

    @TestVisible
    private static Set<String> extractTopLevelSelectedFields(String soql) {
        Set<String> fields = new Set<String>();
        if (String.isBlank(soql)) return fields;

        String lower = soql.toLowerCase();
        Integer selectIndex = lower.indexOf('select');
        if (selectIndex < 0) return fields;

        Integer selectStart = selectIndex + 6;
        Integer fromIndex = findTopLevelFromIndex(soql, selectStart);
        if (fromIndex < 0) return fields;

        for (String item : splitTopLevelSelectItems(soql.substring(selectStart, fromIndex))) {
            String fieldName = item == null ? null : item.trim();
            if (String.isBlank(fieldName)) continue;
            String fieldLower = fieldName.toLowerCase();
            if (fieldName.startsWith('(') || fieldName.contains('(') || fieldName.contains('.') || fieldLower.startsWith('typeof ')) {
                continue;
            }

            List<String> parts = fieldName.split('\\s+');
            if (!parts.isEmpty() && !String.isBlank(parts[0])) {
                fields.add(parts[0]);
            }
        }

        return fields;
    }

    private static Integer findTopLevelFromIndex(String soql, Integer startIndex) {
        String lower = soql.toLowerCase();
        Integer depth = 0;

        for (Integer i = startIndex; i + 4 <= soql.length(); i++) {
            String ch = soql.substring(i, i + 1);
            if (ch == '(') {
                depth++;
            } else if (ch == ')') {
                depth--;
            } else if (depth == 0 && lower.substring(i, i + 4) == 'from') {
                Boolean isWordStart = (i == 0 || !soql.substring(i - 1, i).isAlpha());
                Boolean isWordEnd = (i + 4 >= soql.length() || !soql.substring(i + 4, i + 5).isAlpha());
                if (isWordStart && isWordEnd) {
                    return i;
                }
            }
        }

        return -1;
    }

    private static List<String> splitTopLevelSelectItems(String selectClause) {
        List<String> items = new List<String>();
        if (selectClause == null) return items;

        Integer depth = 0;
        Integer itemStart = 0;
        for (Integer i = 0; i < selectClause.length(); i++) {
            String ch = selectClause.substring(i, i + 1);
            if (ch == '(') {
                depth++;
            } else if (ch == ')') {
                depth--;
            } else if (ch == ',' && depth == 0) {
                items.add(selectClause.substring(itemStart, i));
                itemStart = i + 1;
            }
        }

        items.add(selectClause.substring(itemStart));
        return items;
    }

    @TestVisible
    private static String removeDuplicateTopLevelSelectItems(String soql) {
        if (String.isBlank(soql)) return soql;

        String lower = soql.toLowerCase();
        Integer selectIndex = lower.indexOf('select');
        if (selectIndex < 0) return soql;

        Integer selectStart = selectIndex + 6;
        Integer fromIndex = findTopLevelFromIndex(soql, selectStart);
        if (fromIndex < 0) return soql;

        List<String> selectedItems = splitTopLevelSelectItems(soql.substring(selectStart, fromIndex));
        Set<String> seenDedupeKeys = new Set<String>();
        List<String> uniqueItems = new List<String>();
        Boolean changed = false;

        for (String item : selectedItems) {
            String trimmedItem = item == null ? null : item.trim();
            if (String.isBlank(trimmedItem)) {
                continue;
            }

            String dedupeKey = getDedupeKeyForSelectItem(trimmedItem);
            if (dedupeKey != null) {
                if (seenDedupeKeys.contains(dedupeKey)) {
                    changed = true;
                    continue;
                }
                seenDedupeKeys.add(dedupeKey);
            }

            uniqueItems.add(trimmedItem);
        }

        if (!changed || uniqueItems.isEmpty()) {
            return soql;
        }

        return soql.substring(0, selectStart) + ' ' + String.join(uniqueItems, ', ') + ' ' + soql.substring(fromIndex);
    }

    private static String getDedupeKeyForSelectItem(String selectItem) {
        if (String.isBlank(selectItem)) return null;

        String lower = selectItem.toLowerCase();
        if (selectItem.startsWith('(') || selectItem.contains('(') || lower.startsWith('typeof ')) {
            return null;
        }

        return lower.replaceAll('\\s+', '');
    }

    /**
     * Build data for multiple records
     * Returns {"records": [...]} structure for template iteration
     */
    private Map<String, Object> buildMultiRecordData(
        List<SObject> results,
        String locale,
        String timezone,
        Set<String> queriedChildRelationships,
        Map<String, Set<String>> nestedRelationshipMap,
        Set<String> queriedScalarFields
    ) {
        // Process ALL records (not just the first one)
        List<Object> processedRecords = new List<Object>();
        for (SObject record : results) {
            Map<String, Object> processedRecord = processRecord(record, locale, timezone, queriedChildRelationships, nestedRelationshipMap, queriedScalarFields);
            processedRecords.add(processedRecord);
        }

        // Return array structure for template iteration
        Map<String, Object> data = new Map<String, Object>();
        data.put('records', processedRecords);
        return data;
    }

    /**
     * Process a single SObject record:
     *  - scalar fields (with __formatted when applicable)
     *  - parent relationships (SObject -> recurse)
     *  - child relationships (subqueries -> list of maps)
     *
     * @param queriedChildRelationships Set of child relationship names that were queried at THIS level
     * @param nestedRelationshipMap Map of relationship name to its nested child relationships
     */
    @TestVisible
    private Map<String, Object> processRecord(
        SObject record,
        String locale,
        String timezone,
        Set<String> queriedChildRelationships,
        Map<String, Set<String>> nestedRelationshipMap,
        Set<String> queriedScalarFields
    ) {
        Map<String, Object> out = new Map<String, Object>();
        if (record == null) return out;

        // Metadata + what's actually populated in this row
        Schema.DescribeSObjectResult d = record.getSObjectType().getDescribe();
        Map<String, Schema.SObjectField> fieldMap = d.fields.getMap();
        Map<String, Object> populated = record.getPopulatedFieldsAsMap();

        // Collect child relationship names (e.g., Contacts, Opportunities, CustomChildren__r)
        Set<String> childRelNames = new Set<String>();
        for (Schema.ChildRelationship cr : d.getChildRelationships()) {
            String relName = cr.getRelationshipName();
            if (!String.isBlank(relName)) childRelNames.add(relName);
        }

        Set<String> parentRelNames = new Set<String>();
        for (String fieldName : fieldMap.keySet()) {
            Schema.DescribeFieldResult fieldDescribe = fieldMap.get(fieldName).getDescribe();
            if (fieldDescribe.getType() == Schema.DisplayType.Reference) {
                String relName = fieldDescribe.getRelationshipName();
                if (!String.isBlank(relName)) parentRelNames.add(relName);
            }
        }

        // 1) Scalars & parent relationships that were actually queried.
        //    IMPORTANT: skip child relationship names here; they are not fields and record.get(<child>) throws.
        for (String key : populated.keySet()) {
            if (childRelNames.contains(key)) continue; // defer to child section

            Object val = populated.get(key); // use populated map; don't call record.get(key)

            // Parent relationship present (value is an SObject)
            if (val instanceof SObject) {
                // Parent relationships don't have child subqueries in SOQL, so pass empty set
                out.put(key, processRecord((SObject) val, locale, timezone, new Set<String>(), nestedRelationshipMap, new Set<String>()));
                continue;
            }

            // Scalar value
            out.put(key, val);
            if (val != null) {
                String formatted = formatFieldValue(val, key, locale, timezone);
                if (formatted != null) out.put(key + '__formatted', formatted);
            }
        }

        // 2) Queried parent relationships that are null do not appear in populated fields.
        for (String relName : parentRelNames) {
            if (out.containsKey(relName)) continue;

            try {
                SObject parentRecord = record.getSObject(relName);
                if (parentRecord == null) {
                    out.put(relName, new Map<String, Object>());
                } else {
                    out.put(relName, processRecord(parentRecord, locale, timezone, new Set<String>(), nestedRelationshipMap, new Set<String>()));
                }
            } catch (Exception e) {
                // Relationship was not queried.
            }
        }

        // 3) Child relationships (only when sub-queried in SOQL at THIS level)
        for (String relName : childRelNames) {
            // Check if this child relationship was queried at THIS level of the hierarchy
            Boolean wasQueried = queriedChildRelationships != null && queriedChildRelationships.contains(relName);
            Boolean hasData = populated.containsKey(relName);

            // Skip if relationship wasn't queried at this level AND has no data
            if (!wasQueried && !hasData) {
                continue;
            }

            // Get child records - try populated map first, then getSObjects as fallback
            List<SObject> children = null;
            if (hasData) {
                // Get directly from populated map - this is more reliable than getSObjects
                Object populatedValue = populated.get(relName);
                if (populatedValue instanceof List<SObject>) {
                    children = (List<SObject>) populatedValue;
                }
            }
            // Fallback to getSObjects if populated map didn't have it
            if (children == null) {
                try {
                    children = record.getSObjects(relName);
                } catch (Exception e) {
                    children = null;
                }
            }

            // Get the nested relationships for this child type (if any)
            Set<String> nestedRels = nestedRelationshipMap != null && nestedRelationshipMap.containsKey(relName)
                ? nestedRelationshipMap.get(relName)
                : new Set<String>();

            // Always output an array for queried relationships (empty if no children)
            List<Object> processed = new List<Object>();
            if (children != null) {
                for (SObject child : children) {
                    // Recursive call - pass ONLY the nested relationships for this child type
                    processed.add(processRecord(child, locale, timezone, nestedRels, nestedRelationshipMap, new Set<String>()));
                }
            }
            out.put(relName, processed);
        }

        // 4) Include top-level queried-but-null scalar fields.
        //    Use the SELECT list so unqueried fields are not emitted.
        Set<String> scalarFields = queriedScalarFields == null ? new Set<String>() : queriedScalarFields;
        for (String fieldName : scalarFields) {
            if (out.containsKey(fieldName)) continue;
            if (!fieldMap.containsKey(fieldName)) continue;
            Object v;
            try {
                v = record.get(fieldName);
            } catch (Exception e) {
                continue;
            }
            if (v == null) {
                Schema.DisplayType t = fieldMap.get(fieldName).getDescribe().getType();
                out.put(fieldName, null);
                if (t == Schema.DisplayType.Date || t == Schema.DisplayType.DateTime ||
                    t == Schema.DisplayType.Currency || t == Schema.DisplayType.Percent ||
                    t == Schema.DisplayType.Double || t == Schema.DisplayType.Integer) {
                    out.put(fieldName + '__formatted', '');
                }
            }
        }

        return out;
    }

    /**
     * Overload for backward compatibility with tests and internal calls
     */
    @TestVisible
    private Map<String, Object> processRecord(SObject record, String locale, String timezone) {
        return processRecord(record, locale, timezone, new Set<String>(), new Map<String, Set<String>>(), new Set<String>());
    }

    /**
     * Overload for backward compatibility - accepts flat set, uses empty nested map
     */
    @TestVisible
    private Map<String, Object> processRecord(SObject record, String locale, String timezone, Set<String> queriedChildRelationships) {
        return processRecord(record, locale, timezone, queriedChildRelationships, new Map<String, Set<String>>(), new Set<String>());
    }
    


    /**
     * Format field value based on type (adds currency/percent/date/datetime formatting)
     */
    @TestVisible
    private String formatFieldValue(Object value, String fieldName, String locale, String timezone) {
        if (value == null) {
            return '';
        }

        if (value instanceof Decimal) {
            String lower = fieldName == null ? '' : fieldName.toLowerCase();
            if (lower.contains('revenue') || lower.contains('amount') ||
                lower.contains('price')   || lower.contains('total')) {
                return formatCurrency((Decimal) value, locale);
            } else if (lower.contains('percent') || lower.contains('probability')) {
                return formatPercent((Decimal) value, locale);
            } else {
                return formatNumber((Decimal) value, locale);
            }
        } else if (value instanceof Date) {
            return formatDate((Date) value, locale);
        } else if (value instanceof Datetime) {
            return formatDatetime((Datetime) value, locale, timezone);
        }
        return null; // No formatting for other types
    }

    /**
     * Helper: add __formatted alongside scalar when applicable
     */
    private void putFormatted(
        Map<String, Object> target,
        String fieldName,
        Object rawValue,
        String locale,
        String timezone
    ) {
        if (rawValue == null) return;
        String formatted = formatFieldValue(rawValue, fieldName, locale, timezone);
        if (formatted != null) {
            target.put(fieldName + '__formatted', formatted);
        }
    }

    /**
     * Safely bind :recordId inside dynamic SOQL (if present).
     * We replace case-insensitively occurrences of ":recordId" with a quoted, escaped literal.
     */
    private static String bindRecordId(String soql, Id recordId) {
        if (String.isBlank(soql)) return soql;
        if (recordId == null)     return soql;

        // Escape and wrap as SOQL string literal
        String lit = '\'' + String.escapeSingleQuotes(String.valueOf(recordId)) + '\'';

        // Case-insensitive replacement of :recordId tokens
        // Use a regex with a word boundary so ":recordIdXYZ" is not replaced
        return soql.replaceAll('(?i):\\s*recordId\\b', lit);
    }

    /**
     * Format currency with locale-specific symbol and separators
     */
    @TestVisible
    public static String formatCurrency(Decimal value, String locale) {
        if (value == null) return '';
        String currencySymbol = getCurrencySymbol(locale);
        String formattedNumber = formatNumber(value, locale);
        return currencySymbol + formattedNumber;
    }

    /**
     * Format number with thousands separators
     */
    @TestVisible
    public static String formatNumber(Decimal value, String locale) {
        if (value == null) return '';

        // Round to 2 decimal places
        Decimal rounded = value.setScale(2, RoundingMode.HALF_UP);

        // Split into integer and decimal parts
        String valueStr = String.valueOf(rounded);
        List<String> parts = valueStr.split('\\.');
        String integerPart = parts[0];
        String decimalPart = parts.size() > 1 ? parts[1] : '00';

        // Add thousands separators
        String formattedInteger = addThousandsSeparators(integerPart, locale);

        // Get decimal separator based on locale
        String decimalSeparator = getDecimalSeparator(locale);

        // Remove trailing zeros for cleaner display
        if (decimalPart == '00') {
            return formattedInteger;
        }
        return formattedInteger + decimalSeparator + decimalPart;
    }

    /**
     * Format percentage
     */
    @TestVisible
    public static String formatPercent(Decimal value, String locale) {
        if (value == null) return '';
        String formattedNumber = formatNumber(value, locale);
        return formattedNumber + '%';
    }

    /**
     * Format date based on locale
     */
    @TestVisible
    public static String formatDate(Date value, String locale) {
        if (value == null) return '';

        Datetime dt = Datetime.newInstance(value, Time.newInstance(0, 0, 0, 0));

        // IMPORTANT: check en-US before generic en-*
        if (locale == 'en-US') {
            // MM/DD/YYYY (12/31/2025)
            return dt.format('MM/dd/yyyy');
        } else if (locale == 'en-GB' || (locale != null && locale.startsWith('en-'))) {
            // DD MMM YYYY (31 Dec 2025)
            return dt.format('dd MMM yyyy');
        } else {
            // Default ISO format
            return dt.format('yyyy-MM-dd');
        }
    }

    /**
     * Format datetime with timezone
     */
    @TestVisible
    public static String formatDatetime(Datetime value, String locale, String timezone) {
        if (value == null) return '';

        // IMPORTANT: check en-US before generic en-*
        if (locale == 'en-US') {
            // MM/DD/YYYY hh:mm a (10/31/2025 02:30 PM)
            return value.format('MM/dd/yyyy hh:mm a', timezone);
        } else if (locale == 'en-GB' || (locale != null && locale.startsWith('en-'))) {
            // DD MMM YYYY HH:mm (31 Oct 2025 14:30)
            return value.format('dd MMM yyyy HH:mm', timezone);
        } else {
            // ISO-like format with timezone
            return value.format('yyyy-MM-dd HH:mm', timezone);
        }
    }

    /**
     * Get currency symbol based on locale
     */
    private static String getCurrencySymbol(String locale) {
        if (locale == 'en-GB') {
            return '£';
        } else if (locale == 'en-US') {
            return '$';
        } else if (locale == 'de-DE' || locale == 'fr-FR') {
            return '€';
        } else {
            return '$'; // Default to USD
        }
    }

    /**
     * Get decimal separator based on locale
     */
    private static String getDecimalSeparator(String locale) {
        if (locale == 'de-DE' || locale == 'fr-FR') {
            return ','; // Continental Europe uses comma
        } else {
            return '.'; // English locales use period
        }
    }

    /**
     * Add thousands separators to integer string
     */
    private static String addThousandsSeparators(String integerStr, String locale) {
        String separator = getThousandsSeparator(locale);

        // Handle negative numbers
        Boolean isNegative = integerStr != null && integerStr.startsWith('-');
        if (isNegative) {
            integerStr = integerStr.substring(1);
        }

        String result = '';
        Integer length = integerStr.length();

        for (Integer i = 0; i < length; i++) {
            if (i > 0 && Math.mod(length - i, 3) == 0) {
                result += separator;
            }
            result += integerStr.substring(i, i + 1);
        }

        return isNegative ? '-' + result : result;
    }

    /**
     * Get thousands separator based on locale
     */
    private static String getThousandsSeparator(String locale) {
        if (locale == 'de-DE' || locale == 'fr-FR') {
            return '.'; // Continental Europe uses period
        } else {
            return ','; // English locales use comma
        }
    }
}
