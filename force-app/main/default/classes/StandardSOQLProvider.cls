/**
 * Default SOQL-based data provider
 * Executes template.SOQL__c with :recordId binding and preformats all fields
 */
public with sharing class StandardSOQLProvider implements DocgenDataProvider {

    /**
     * Builds data map by executing SOQL query and adding formatted fields
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

        // Execute query with bound recordId
        List<SObject> results = Database.query(template.SOQL__c);

        if (results.isEmpty()) {
            throw new IllegalArgumentException('No records found for recordId: ' + recordId);
        }

        SObject record = results[0];

        // Build hierarchical data structure
        Map<String, Object> data = new Map<String, Object>();

        // Get object type from recordId
        String objectType = recordId.getSObjectType().getDescribe().getName();

        // Process the record and add formatted fields
        Map<String, Object> processedRecord = processRecord(record, locale, timezone);

        data.put(objectType, processedRecord);

        return data;
    }

    /**
     * Process a single SObject record and add formatted fields
     */
    @TestVisible
    private Map<String, Object> processRecord(SObject record, String locale, String timezone) {
        Map<String, Object> result = new Map<String, Object>();

        // Get ALL fields from the SObject, including nulls
        // We need to extract field names from getPopulatedFieldsAsMap() and check for nulls separately
        Map<String, Object> populatedFields = record.getPopulatedFieldsAsMap();

        // Get the SObject type to fetch all field names
        Schema.SObjectType sObjectType = record.getSObjectType();
        Map<String, Schema.SObjectField> fieldMap = sObjectType.getDescribe().fields.getMap();

        // Process each field that was queried (appears in populated or is explicitly set to null)
        Set<String> processedFields = new Set<String>();

        // First, process all populated (non-null) fields
        for (String fieldName : populatedFields.keySet()) {
            processedFields.add(fieldName.toLowerCase());

            Object fieldValue = null;
            Boolean isChildRelationship = false;

            // Try to get as child relationship first (List<SObject>)
            try {
                List<SObject> childRecords = record.getSObjects(fieldName);
                if (childRecords != null) {
                    // This is a child relationship
                    isChildRelationship = true;
                    List<Object> processedChildren = new List<Object>();

                    for (SObject childRecord : childRecords) {
                        processedChildren.add(processRecord(childRecord, locale, timezone));
                    }

                    result.put(fieldName, processedChildren);
                    continue;
                }
            } catch (Exception e) {
                // Not a child relationship, continue to try as regular field
            }

            // If not a child relationship, get as regular field or parent relationship
            if (!isChildRelationship) {
                fieldValue = record.get(fieldName);
            }

            // Check if this is a parent relationship (returns SObject)
            if (fieldValue instanceof SObject) {
                result.put(fieldName, processRecord((SObject) fieldValue, locale, timezone));
                continue;
            }

            // Regular field - add raw value
            result.put(fieldName, fieldValue);

            // Add formatted value if applicable
            if (fieldValue != null) {
                String formattedValue = formatFieldValue(fieldValue, fieldName, locale, timezone);
                if (formattedValue != null) {
                    result.put(fieldName + '__formatted', formattedValue);
                }
            }
        }

        // Then, check for null fields that should have __formatted versions
        // We determine this by field naming conventions
        for (String fieldName : fieldMap.keySet()) {
            String lowerFieldName = fieldName.toLowerCase();

            // Skip if already processed
            if (processedFields.contains(lowerFieldName)) {
                continue;
            }

            // Check if this field was queried (try to get it, will be null if not queried)
            try {
                Object fieldValue = record.get(fieldName);

                // If we got here, field was queried but is null
                // Add null value and empty formatted string for appropriate field types
                if (lowerFieldName.contains('revenue') || lowerFieldName.contains('amount') ||
                    lowerFieldName.contains('price') || lowerFieldName.contains('total') ||
                    lowerFieldName.contains('percent') || lowerFieldName.contains('probability') ||
                    lowerFieldName.contains('date') || lowerFieldName.contains('quantity')) {
                    result.put(fieldName, null);
                    result.put(fieldName + '__formatted', '');
                }
            } catch (Exception e) {
                // Field was not queried, skip it
                continue;
            }
        }

        return result;
    }

    /**
     * Format field value based on type
     */
    @TestVisible
    private String formatFieldValue(Object value, String fieldName, String locale, String timezone) {
        if (value == null) {
            return '';
        }

        // Determine field type and format accordingly
        if (value instanceof Decimal) {
            // Check if it's a currency or percent field by naming convention
            String lowerFieldName = fieldName.toLowerCase();
            if (lowerFieldName.contains('revenue') || lowerFieldName.contains('amount') ||
                lowerFieldName.contains('price') || lowerFieldName.contains('total')) {
                return formatCurrency((Decimal) value, locale);
            } else if (lowerFieldName.contains('percent') || lowerFieldName.contains('probability')) {
                return formatPercent((Decimal) value, locale);
            } else {
                return formatNumber((Decimal) value, locale);
            }
        } else if (value instanceof Date) {
            return formatDate((Date) value, locale);
        } else if (value instanceof Datetime) {
            return formatDatetime((Datetime) value, locale, timezone);
        }

        return null; // No formatting needed for this type
    }

    /**
     * Format currency with locale-specific symbol and separators
     */
    @TestVisible
    public static String formatCurrency(Decimal value, String locale) {
        if (value == null) {
            return '';
        }

        String currencySymbol = getCurrencySymbol(locale);
        String formattedNumber = formatNumber(value, locale);

        return currencySymbol + formattedNumber;
    }

    /**
     * Format number with thousands separators
     */
    @TestVisible
    public static String formatNumber(Decimal value, String locale) {
        if (value == null) {
            return '';
        }

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
        if (value == null) {
            return '';
        }

        // Format as number and append %
        String formattedNumber = formatNumber(value, locale);
        return formattedNumber + '%';
    }

    /**
     * Format date based on locale
     */
    @TestVisible
    public static String formatDate(Date value, String locale) {
        if (value == null) {
            return '';
        }

        Datetime dt = Datetime.newInstance(value, Time.newInstance(0, 0, 0, 0));

        if (locale == 'en-GB' || locale.startsWith('en-')) {
            // DD MMM YYYY (31 Dec 2025)
            return dt.format('dd MMM yyyy');
        } else if (locale == 'en-US') {
            // MM/DD/YYYY (12/31/2025)
            return dt.format('MM/dd/yyyy');
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
        if (value == null) {
            return '';
        }

        // Convert to specified timezone
        String formattedDatetime;

        if (locale == 'en-GB' || locale.startsWith('en-')) {
            // DD MMM YYYY HH:mm (31 Oct 2025 14:30)
            formattedDatetime = value.format('dd MMM yyyy HH:mm', timezone);
        } else if (locale == 'en-US') {
            // MM/DD/YYYY hh:mm a (10/31/2025 02:30 PM)
            formattedDatetime = value.format('MM/dd/yyyy hh:mm a', timezone);
        } else {
            // ISO format with timezone
            formattedDatetime = value.format('yyyy-MM-dd HH:mm', timezone);
        }

        return formattedDatetime;
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
        Boolean isNegative = integerStr.startsWith('-');
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
