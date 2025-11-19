/**
 * Configure Docgen Custom Settings
 *
 * Sets the Named Credential name to use for the current environment.
 * Template placeholder {{NAMED_CREDENTIAL}} will be replaced via shell substitution.
 *
 * Usage:
 *   sed -e "s|{{NAMED_CREDENTIAL}}|Docgen_Node_API_CI|g" \
 *       scripts/ConfigureCustomSettings.apex > /tmp/configure-settings.apex
 *   sf apex run --file /tmp/configure-settings.apex
 */

String namedCredentialName = '{{NAMED_CREDENTIAL}}';

try {
    System.debug(LoggingLevel.INFO, '=== Configuring Docgen Custom Settings ===');
    System.debug(LoggingLevel.INFO, 'Named Credential: ' + namedCredentialName);

    // Get or create the organization-wide custom setting
    Docgen_Settings__c settings = Docgen_Settings__c.getOrgDefaults();

    if (settings.Id == null) {
        System.debug(LoggingLevel.INFO, 'Creating new custom settings record');
        settings = new Docgen_Settings__c();
        settings.SetupOwnerId = UserInfo.getOrganizationId();
    } else {
        System.debug(LoggingLevel.INFO, 'Updating existing custom settings record');
    }

    settings.Named_Credential_Name__c = namedCredentialName;

    upsert settings;

    System.debug(LoggingLevel.INFO, '✅ Custom settings configured successfully');
    System.debug(LoggingLevel.INFO, '✅ Named Credential set to: ' + namedCredentialName);

    // Verify the setting
    Docgen_Settings__c verify = Docgen_Settings__c.getInstance();
    System.debug(LoggingLevel.INFO, '✅ Verification: ' + verify.Named_Credential_Name__c);

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Failed to configure custom settings: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    throw e;
}
