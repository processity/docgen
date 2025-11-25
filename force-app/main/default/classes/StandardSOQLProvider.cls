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
        String soql = bindRecordId(template.SOQL__c, recordId);

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

        // Extract subquery relationship names from SOQL for empty array handling
        Set<String> queriedChildRelationships = extractSubqueryRelationships(template.SOQL__c);

        if (returnMultiple) {
            // Return ALL records in a records array (for composite documents)
            return buildMultiRecordData(results, locale, timezone, queriedChildRelationships);
        } else {
            // Legacy behavior: return only first record
            return buildSingleRecordData(results, recordId, locale, timezone, queriedChildRelationships);
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
        Set<String> queriedChildRelationships
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
        Map<String, Object> processedRecord = processRecord(record, locale, timezone, queriedChildRelationships);

        data.put(objectType, processedRecord);
        return data;
    }

    /**
     * Extract subquery relationship names from SOQL string
     * Pattern: (SELECT ... FROM RelationshipName) or (SELECT ... FROM RelationshipName WHERE ...)
     */
    @TestVisible
    private static Set<String> extractSubqueryRelationships(String soql) {
        Set<String> relationships = new Set<String>();
        if (String.isBlank(soql)) return relationships;

        // Pattern to match: FROM followed by relationship name inside parentheses
        // Matches: (SELECT ... FROM Contacts), (SELECT ... FROM Contacts WHERE ...), etc.
        // Using (?i) for case-insensitive matching since Apex Pattern doesn't support flags
        Pattern p = Pattern.compile('(?i)\\(\\s*SELECT\\s+[^)]+\\s+FROM\\s+(\\w+)');
        Matcher m = p.matcher(soql);
        while (m.find()) {
            relationships.add(m.group(1));
        }
        return relationships;
    }

    /**
     * Build data for multiple records
     * Returns {"records": [...]} structure for template iteration
     */
    private Map<String, Object> buildMultiRecordData(
        List<SObject> results,
        String locale,
        String timezone,
        Set<String> queriedChildRelationships
    ) {
        // Process ALL records (not just the first one)
        List<Object> processedRecords = new List<Object>();
        for (SObject record : results) {
            Map<String, Object> processedRecord = processRecord(record, locale, timezone, queriedChildRelationships);
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
     * @param queriedChildRelationships Set of child relationship names that were included in SOQL subqueries
     *        Used to ensure empty arrays are returned for queried relationships with no children
     */
    @TestVisible
    private Map<String, Object> processRecord(SObject record, String locale, String timezone, Set<String> queriedChildRelationships) {
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

        // 1) Scalars & parent relationships that were actually queried.
        //    IMPORTANT: skip child relationship names here; they are not fields and record.get(<child>) throws.
        for (String key : populated.keySet()) {
            if (childRelNames.contains(key)) continue; // defer to child section

            Object val = populated.get(key); // use populated map; don't call record.get(key)

            // Parent relationship present (value is an SObject)
            if (val instanceof SObject) {
                // Recursive call with empty set - nested records don't have their own subqueries
                out.put(key, processRecord((SObject) val, locale, timezone, new Set<String>()));
                continue;
            }

            // Scalar value
            out.put(key, val);
            if (val != null) {
                String formatted = formatFieldValue(val, key, locale, timezone);
                if (formatted != null) out.put(key + '__formatted', formatted);
            }
        }

        // 2) Child relationships (only when sub-queried in SOQL)
        for (String relName : childRelNames) {
            // Check if this child relationship was queried in the SOQL (either has data or was explicitly requested)
            Boolean wasQueried = queriedChildRelationships != null && queriedChildRelationships.contains(relName);
            Boolean hasData = populated.containsKey(relName);

            // Skip if relationship wasn't queried AND has no data
            if (!wasQueried && !hasData) {
                continue;
            }

            List<SObject> children;
            try {
                children = record.getSObjects(relName); // null if not subselected; may throw if unsupported -> catch
            } catch (Exception e) {
                children = null;
            }

            // Always output an array for queried relationships (empty if no children)
            List<Object> processed = new List<Object>();
            if (children != null) {
                for (SObject child : children) {
                    // Recursive call with empty set - child records don't have their own subqueries
                    processed.add(processRecord(child, locale, timezone, new Set<String>()));
                }
            }
            out.put(relName, processed);
        }

        // 3) (Optional) Add empty __formatted for queried-but-null scalars.
        //    Only consider true fields on this sObject to avoid relationship names.
        for (String fieldName : fieldMap.keySet()) {
            if (out.containsKey(fieldName)) continue;
            Object v;
            try {
                v = record.get(fieldName); // returns null if not queried or null; safe for real fields
            } catch (Exception e) {
                continue;
            }
            if (v == null) {
                Schema.DisplayType t = fieldMap.get(fieldName).getDescribe().getType();
                if (t == Schema.DisplayType.Date || t == Schema.DisplayType.DateTime ||
                    t == Schema.DisplayType.Currency || t == Schema.DisplayType.Percent ||
                    t == Schema.DisplayType.Double   || t == Schema.DisplayType.Integer) {
                    out.put(fieldName, null);
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
        return processRecord(record, locale, timezone, new Set<String>());
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
