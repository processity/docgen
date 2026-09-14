/** Resolves the Named Credential used by all Docgen callouts. */
public with sharing class DocgenConnectionConfig {
    @TestVisible
    private static Boolean isSandbox;

    public static String getNamedCredentialName() {
        Docgen_Settings__c settings = Docgen_Settings__c.getInstance();
        if (settings != null && String.isNotBlank(settings.Named_Credential_Name__c)) {
            return settings.Named_Credential_Name__c;
        }

        if (isSandbox == null) {
            isSandbox = [SELECT IsSandbox FROM Organization LIMIT 1].IsSandbox;
        }
        return isSandbox ? 'Docgen_Node_API_Sandbox' : 'Docgen_Node_API';
    }
}
