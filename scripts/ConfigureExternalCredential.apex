/**
 * Configure External Credential for Salesforce org
 *
 * Template file for setting AAD Client ID and Client Secret on External Credential.
 * Placeholders must be replaced via shell substitution:
 *   {{CLIENT_ID}} - Azure AD Client ID
 *   {{CLIENT_SECRET}} - Azure AD Client Secret
 *   {{EXTERNAL_CREDENTIAL}} - External Credential name (Docgen_AAD_Credential or Docgen_AAD_Credential_CI)
 *   {{PRINCIPAL_NAME}} - Principal name (PRODUCTION or CI)
 *
 * Usage via script:
 *   ./scripts/configure-external-credential.sh [org] [environment] [client-id] [secret]
 */

// TEMPLATE PLACEHOLDERS - Replace via shell string substitution
String clientId = '{{CLIENT_ID}}';
String clientSecret = '{{CLIENT_SECRET}}';

try {
    ConnectApi.CredentialInput credentialInput = new ConnectApi.CredentialInput();

    credentialInput.externalCredential = '{{EXTERNAL_CREDENTIAL}}';
    credentialInput.principalType = ConnectApi.CredentialPrincipalType.NamedPrincipal;
    credentialInput.principalName = '{{PRINCIPAL_NAME}}';

    Map<String, ConnectApi.CredentialValueInput> credentials = new Map<String, ConnectApi.CredentialValueInput>();

    ConnectApi.CredentialValueInput clientIdInput = new ConnectApi.CredentialValueInput();
    clientIdInput.value = clientId;
    clientIdInput.encrypted = false;
    credentials.put('clientId', clientIdInput);

    ConnectApi.CredentialValueInput clientSecretInput = new ConnectApi.CredentialValueInput();
    clientSecretInput.value = clientSecret;
    clientSecretInput.encrypted = true;
    credentials.put('clientSecret', clientSecretInput);

    credentialInput.credentials = credentials;

    System.debug(LoggingLevel.INFO, 'Configuring External Credential: {{EXTERNAL_CREDENTIAL}}');
    System.debug(LoggingLevel.INFO, 'Principal: {{PRINCIPAL_NAME}}');
    System.debug(LoggingLevel.INFO, 'Client ID: ' + clientId.substring(0, 8) + '...');

    ConnectApi.CredentialAuthenticationStatus principalStatus = getExistingPrincipalAuthenticationStatus('{{EXTERNAL_CREDENTIAL}}', '{{PRINCIPAL_NAME}}');

    if (principalStatus == ConnectApi.CredentialAuthenticationStatus.Configured) {
        System.debug(LoggingLevel.INFO, 'Principal exists and is configured - updating credentials');
        ConnectApi.NamedCredentials.updateCredential(credentialInput);
    } else {
        System.debug(LoggingLevel.INFO, 'Principal does not exist or not configured - creating credentials');
        ConnectApi.NamedCredentials.createCredential(credentialInput);
    }

    System.debug(LoggingLevel.INFO, '✅ External Credential configured successfully');
    System.debug(LoggingLevel.INFO, '✅ Principal "{{PRINCIPAL_NAME}}" now has ClientId and ClientSecret set');

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Failed to configure External Credential: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    throw e;
}

ConnectApi.CredentialAuthenticationStatus getExistingPrincipalAuthenticationStatus(String externalCredentialName, String principalName) {
    try {
        ConnectApi.ExternalCredential existingCredential = ConnectApi.NamedCredentials.getExternalCredential(externalCredentialName);

        if (existingCredential != null && existingCredential.principals != null) {
            for (Integer i = 0; i < existingCredential.principals.size(); i++) {
                ConnectApi.ExternalCredentialPrincipal thisPrincipal = existingCredential.principals[i];
                if (thisPrincipal.principalName == principalName) {
                    return thisPrincipal.authenticationStatus;
                }
            }
        }
    } catch (Exception e) {
        System.debug(LoggingLevel.WARN, 'Could not retrieve existing credential: ' + e.getMessage());
    }

    return null;
}
