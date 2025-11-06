/**
 * Interface for data providers that build template merge data
 * Enables pluggable data collection strategies (SOQL, custom logic, etc.)
 */
public interface DocgenDataProvider {
    /**
     * Builds hierarchical data map for template merging
     *
     * @param recordId The source record ID (Account, Opportunity, Case, etc.)
     * @param template The template configuration with provider settings
     * @param locale Locale for formatting (e.g., 'en-GB', 'en-US', 'de-DE')
     * @param timezone Timezone for datetime formatting (e.g., 'Europe/London')
     * @return Map of data with preformatted fields (e.g., Amount + Amount__formatted)
     *
     * Implementation requirements:
     * - Return hierarchical data structure matching Salesforce API field paths
     * - Add __formatted suffix fields for all numeric, currency, date, datetime fields
     * - Use locale for currency symbol (£, $, €), number separators, date format
     * - Apply timezone for datetime conversions
     * - Handle null values gracefully (return empty string for formatted nulls)
     * - Support nested objects (e.g., Opportunity.Owner.Name)
     * - Support child arrays (e.g., Opportunity.LineItems)
     */
    Map<String, Object> buildData(
        Id recordId,
        Docgen_Template__c template,
        String locale,
        String timezone
    );
}
