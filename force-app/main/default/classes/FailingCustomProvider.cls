/**
 * Failing Custom Provider for testing error handling
 * Used in tests to verify custom provider exception handling
 *
 * @group Test Helpers
 */
public class FailingCustomProvider implements DocgenDataProvider {

    /**
     * Intentionally throws exception to test error handling
     *
     * @param recordId The record ID (unused)
     * @param template The template (unused)
     * @param locale The locale (unused)
     * @param timezone The timezone (unused)
     * @return Never returns, always throws
     * @throws IllegalArgumentException Always thrown to simulate provider failure
     */
    public Map<String, Object> buildData(
        Id recordId,
        Docgen_Template__c template,
        String locale,
        String timezone
    ) {
        // Intentionally throw exception to test error handling
        throw new IllegalArgumentException('Provider intentionally failed for testing');
    }
}
