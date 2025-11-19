/**
 * Configure Named Credential URL for CI environment
 *
 * Template file for setting the backend URL on Named Credential.
 * Placeholder {{BACKEND_URL}} must be replaced via shell substitution.
 *
 * Usage:
 *   sed -e "s|{{BACKEND_URL}}|$BACKEND_URL|g" \
 *       scripts/ConfigureNamedCredential.apex > /tmp/configure-nc.apex
 *   sf apex run --file /tmp/configure-nc.apex
 */

// TEMPLATE PLACEHOLDER - Replace via shell string substitution
String backendUrl = '{{BACKEND_URL}}';

try {
    System.debug(LoggingLevel.INFO, 'Configuring Named Credential URL');
    System.debug(LoggingLevel.INFO, 'Named Credential: Docgen_Node_API_CI');
    System.debug(LoggingLevel.INFO, 'Backend URL: ' + backendUrl);

    // Validate URL format
    if (!backendUrl.startsWith('https://')) {
        throw new IllegalArgumentException('Backend URL must start with https://');
    }

    // Create named credential input
    ConnectApi.NamedCredentialInput ncInput = new ConnectApi.NamedCredentialInput();
    ncInput.namedCredential = 'Docgen_Node_API_CI';

    // Set URL parameter
    List<ConnectApi.NamedCredentialParameterInput> parameters = new List<ConnectApi.NamedCredentialParameterInput>();

    ConnectApi.NamedCredentialParameterInput urlParam = new ConnectApi.NamedCredentialParameterInput();
    urlParam.parameterName = 'Url';
    urlParam.parameterType = ConnectApi.NamedCredentialParameterType.Url;
    urlParam.parameterValue = backendUrl;
    parameters.add(urlParam);

    // Set External Credential parameter
    ConnectApi.NamedCredentialParameterInput authParam = new ConnectApi.NamedCredentialParameterInput();
    authParam.parameterName = 'ExternalCredential';
    authParam.parameterType = ConnectApi.NamedCredentialParameterType.Authentication;
    authParam.externalCredential = 'Docgen_AAD_Credential_CI';
    parameters.add(authParam);

    ncInput.parameters = parameters;

    // Check if Named Credential exists
    Boolean exists = namedCredentialExists('Docgen_Node_API_CI');

    if (exists) {
        System.debug(LoggingLevel.INFO, 'Named Credential exists - updating URL');
        ConnectApi.NamedCredentials.updateNamedCredential(ncInput);
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
