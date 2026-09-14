/**
 * Configure the selected Named Credential URL
 *
 * Template file for setting the backend URL on Named Credential.
 * Placeholders {{BACKEND_URL}} and {{NAMED_CREDENTIAL}} are replaced by the shell helper.
 *
 * Usage:
 *   ./scripts/configure-named-credential.sh <org> <backend-url> [named-credential]
 */

// TEMPLATE PLACEHOLDER - Replace via shell string substitution
String backendUrl = '{{BACKEND_URL}}';
String namedCredentialName = '{{NAMED_CREDENTIAL}}';

try {
    System.debug(LoggingLevel.INFO, 'Configuring Named Credential URL');
    System.debug(LoggingLevel.INFO, 'Named Credential: ' + namedCredentialName);
    System.debug(LoggingLevel.INFO, 'Backend URL: ' + backendUrl);

    // Validate URL format
    if (!backendUrl.startsWith('https://')) {
        throw new IllegalArgumentException('Backend URL must start with https://');
    }

    // Create named credential input.
    // ConnectApi.NamedCredentials.updateNamedCredential takes the developer name
    // as the method argument; NamedCredentialInput carries the replacement config.
    ConnectApi.NamedCredentialInput ncInput = new ConnectApi.NamedCredentialInput();
    ncInput.developerName = namedCredentialName;
    ncInput.masterLabel = namedCredentialName == 'Docgen_Node_API_Sandbox'
        ? 'Docgen Node API (Sandbox)' : 'Docgen Node API';
    ncInput.type = ConnectApi.NamedCredentialType.SecuredEndpoint;
    ncInput.calloutUrl = backendUrl;

    ConnectApi.NamedCredentialCalloutOptionsInput calloutOptions = new ConnectApi.NamedCredentialCalloutOptionsInput();
    calloutOptions.allowMergeFieldsInBody = false;
    calloutOptions.allowMergeFieldsInHeader = false;
    calloutOptions.generateAuthorizationHeader = true;
    ncInput.calloutOptions = calloutOptions;

    ConnectApi.ExternalCredentialInput externalCredential = new ConnectApi.ExternalCredentialInput();
    externalCredential.developerName = 'Docgen_AAD_Credential';
    ncInput.externalCredentials = new List<ConnectApi.ExternalCredentialInput>{ externalCredential };

    // Check if Named Credential exists
    Boolean exists = namedCredentialExists(namedCredentialName);

    if (exists) {
        System.debug(LoggingLevel.INFO, 'Named Credential exists - updating URL');
        ConnectApi.NamedCredentials.updateNamedCredential(namedCredentialName, ncInput);
    } else {
        System.debug(LoggingLevel.INFO, 'Named Credential does not exist - creating with URL');
        ConnectApi.NamedCredentials.createNamedCredential(ncInput);
    }

    System.debug(LoggingLevel.INFO, '✅ Named Credential configured successfully');
    System.debug(LoggingLevel.INFO, '✅ Backend URL set to: ' + backendUrl);

} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, '❌ Failed to configure Named Credential: ' + e.getMessage());
    System.debug(LoggingLevel.ERROR, 'Stack trace: ' + e.getStackTraceString());
    throw e;
}

Boolean namedCredentialExists(String namedCredentialName) {
    try {
        ConnectApi.NamedCredential nc = ConnectApi.NamedCredentials.getNamedCredential(namedCredentialName);
        return nc != null;
    } catch (Exception e) {
        System.debug(LoggingLevel.WARN, 'Named Credential does not exist: ' + e.getMessage());
        return false;
    }
}
