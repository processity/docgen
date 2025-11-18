/**
 * Verify External Credential and Named Credential status
 *
 * This script checks the configuration status of the External Credential
 * and Named Credential to help diagnose authentication issues.
 */

try {
    System.debug(LoggingLevel.INFO, '=== Checking External Credential Status ===');

    // Check External Credential
    ConnectApi.ExternalCredential extCred = ConnectApi.NamedCredentials.getExternalCredential('Docgen_AAD_Credential_CI');

    System.debug(LoggingLevel.INFO, 'External Credential: ' + extCred.developerName);

    if (extCred.principals != null && extCred.principals.size() > 0) {
        System.debug(LoggingLevel.INFO, 'Principals found: ' + extCred.principals.size());

        for (Integer i = 0; i < extCred.principals.size(); i++) {
            ConnectApi.ExternalCredentialPrincipal principal = extCred.principals[i];
            System.debug(LoggingLevel.INFO, '  Principal: ' + principal.principalName);
            System.debug(LoggingLevel.INFO, '  Type: ' + principal.principalType);
            System.debug(LoggingLevel.INFO, '  Auth Status: ' + principal.authenticationStatus);
            System.debug(LoggingLevel.INFO, '  Sequence: ' + principal.sequenceNumber);
        }
    } else {
        System.debug(LoggingLevel.WARN, 'No principals found!');
    }

    System.debug(LoggingLevel.INFO, '');
    System.debug(LoggingLevel.INFO, '=== Checking Named Credential Status ===');

    // Check Named Credential
    ConnectApi.NamedCredential namedCred = ConnectApi.NamedCredentials.getNamedCredential('Docgen_Node_API_CI');

    System.debug(LoggingLevel.INFO, 'Named Credential: ' + namedCred.developerName);

    if (namedCred.parameters != null && namedCred.parameters.size() > 0) {
        System.debug(LoggingLevel.INFO, 'Parameters found: ' + namedCred.parameters.size());

        for (Integer i = 0; i < namedCred.parameters.size(); i++) {
            ConnectApi.NamedCredentialParameter param = namedCred.parameters[i];
            System.debug(LoggingLevel.INFO, '  Parameter: ' + param.parameterName);
            System.debug(LoggingLevel.INFO, '  Type: ' + param.parameterType);
            if (param.parameterType == ConnectApi.NamedCredentialParameterType.Url) {
                System.debug(LoggingLevel.INFO, '  Value: ' + param.parameterValue);
            } else if (param.parameterType == ConnectApi.NamedCredentialParameterType.Authentication) {
                System.debug(LoggingLevel.INFO, '  External Credential: ' + param.externalCredential);
            }
        }
    } else {
        System.debug(LoggingLevel.WARN, 'No parameters found!');
    }

    System.debug(LoggingLevel.INFO, '');
    System.debug(LoggingLevel.INFO, '=== Summary ===');
    System.debug(LoggingLevel.INFO, 'If authentication status is "Configured", the credential is ready');
    System.debug(LoggingLevel.INFO, 'If authentication status is "NotConfigured", credentials need to be set');

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Error checking credential status: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
}
