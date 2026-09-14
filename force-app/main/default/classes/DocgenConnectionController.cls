/** Admin setup and verification for the backend selected by Docgen settings. */
@RestResource(urlMapping='/docgen/connection/*')
global with sharing class DocgenConnectionController {
    public class ConnectionInfo {
        @AuraEnabled public String namedCredential;
        @AuraEnabled public String backendUrl;
        @AuraEnabled public String externalCredential;
        @AuraEnabled public String principalName;
        @AuraEnabled public String tokenEndpoint;
        @AuraEnabled public String scope;
        @AuraEnabled public Boolean credentialConfigured;
        @AuraEnabled public String orgId;
        @AuraEnabled public String userId;
        @AuraEnabled public String salesforceOrigin;
        @AuraEnabled public Boolean isSandbox;
    }

    public interface CredentialAccess {
        ConnectionInfo describeCredential(String name);
        void saveCredential(ConnectionInfo info, String clientId, String clientSecret);
    }

    @TestVisible private static CredentialAccess credentials = new SalesforceCredentialAccess();
    @TestVisible private static Boolean permissionOverride;

    private static void requirePermission() {
        Boolean permitted = permissionOverride == null
            ? FeatureManagement.checkPermission('Docgen_Manage_Connection') : permissionOverride;
        if (!permitted) {
            throw new ConnectionException('Docgen Admin permission is required.');
        }
    }

    @AuraEnabled
    public static ConnectionInfo getReconnectInfo() {
        requirePermission();
        ConnectionInfo info = credentials.describeCredential(DocgenConnectionConfig.getNamedCredentialName());
        if (String.isBlank(info.backendUrl) || !info.backendUrl.startsWith('https://')) {
            throw new ConnectionException('The selected Named Credential must use an HTTPS backend URL.');
        }
        Url endpoint = new Url(info.backendUrl);
        if (endpoint.getQuery() != null || endpoint.getRef() != null || endpoint.getAuthority().contains('@')) {
            throw new ConnectionException('The selected backend URL must not contain credentials, a query, or a fragment.');
        }
        info.backendUrl = info.backendUrl.removeEnd('/');
        info.orgId = UserInfo.getOrganizationId();
        info.userId = UserInfo.getUserId();
        info.salesforceOrigin = URL.getOrgDomainUrl().toExternalForm();
        info.isSandbox = [SELECT IsSandbox FROM Organization LIMIT 1].IsSandbox;
        return info;
    }

    @AuraEnabled
    public static Map<String, Object> checkConnection() {
        requirePermission();
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:' + DocgenConnectionConfig.getNamedCredentialName() + '/connect/verify');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(new Map<String, Object>{'orgId' => UserInfo.getOrganizationId()}));
        req.setTimeout(30000);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new ConnectionException('Connection verification failed. Check the backend connection setup and integration user access.');
        }
        Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        if (result.get('connected') != true || (String) result.get('orgId') != UserInfo.getOrganizationId()) {
            throw new ConnectionException('The backend could not verify a connection to this Salesforce org.');
        }
        return result;
    }

    @HttpGet
    global static void connectionInfo() {
        try {
            respond(200, getReconnectInfo());
        } catch (Exception e) {
            respond(403, new Map<String, Object>{'error' => 'Unable to inspect the connection. Check Docgen Admin and Named Credential permissions.'});
        }
    }

    @HttpPut
    global static void restoreCredential() {
        try {
            ConnectionInfo info = getReconnectInfo();
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.request.requestBody.toString());
            if ((String) body.get('orgId') != info.orgId || (String) body.get('userId') != info.userId
                || (String) body.get('namedCredential') != info.namedCredential
                || (String) body.get('externalCredential') != info.externalCredential
                || (String) body.get('principalName') != info.principalName
                || (String) body.get('backendUrl') != info.backendUrl
                || (String) body.get('tokenEndpoint') != info.tokenEndpoint
                || (String) body.get('scope') != info.scope) {
                respond(409, new Map<String, Object>{'error' => 'Connection settings changed. Start reconnect again.'});
                return;
            }
            String clientId = (String) body.get('clientId');
            String clientSecret = (String) body.get('clientSecret');
            if (String.isBlank(clientId) || String.isBlank(clientSecret)) {
                respond(400, new Map<String, Object>{'error' => 'Client credentials are required.'});
                return;
            }
            credentials.saveCredential(info, clientId, clientSecret);
            respond(200, new Map<String, Object>{'restored' => true});
        } catch (Exception e) {
            // Credential values and platform exception bodies must not reach logs or the browser.
            respond(403, new Map<String, Object>{'error' => 'Unable to restore the External Credential. Check administrator permissions and principal configuration.'});
        }
    }

    @HttpPost
    global static void verifyConnection() {
        try {
            respond(200, checkConnection());
        } catch (Exception e) {
            respond(503, new Map<String, Object>{'error' => 'The authenticated Salesforce-to-backend connection check failed.'});
        }
    }

    private static void respond(Integer status, Object body) {
        RestContext.response.statusCode = status;
        RestContext.response.addHeader('Content-Type', 'application/json');
        RestContext.response.addHeader('Cache-Control', 'no-store');
        RestContext.response.responseBody = Blob.valueOf(JSON.serialize(body));
    }

    @TestVisible
    private static ConnectionInfo describeMetadata(String name, ConnectApi.NamedCredential nc, ConnectApi.ExternalCredential ec) {
        if (nc.externalCredentials == null || nc.externalCredentials.size() != 1 || ec == null) {
            throw new ConnectionException('Reconnect requires one External Credential on the selected Named Credential.');
        }
        if (String.valueOf(ec.authenticationProtocolVariant) != 'ClientCredentialsClientSecretBasic') {
            throw new ConnectionException('Reconnect supports OAuth client credentials with a client secret in the authorization header.');
        }
        if (ec.principals == null || ec.principals.size() != 1
            || String.valueOf(ec.principals[0].principalType) != 'NamedPrincipal') {
            throw new ConnectionException('Reconnect requires one named principal on the External Credential.');
        }
        ConnectionInfo info = new ConnectionInfo();
        info.namedCredential = name;
        info.backendUrl = nc.calloutUrl;
        info.externalCredential = ec.developerName;
        info.principalName = ec.principals[0].principalName;
        info.credentialConfigured = ec.principals[0].authenticationStatus == ConnectApi.CredentialAuthenticationStatus.Configured;
        for (ConnectApi.ExternalCredentialParameter parameter : ec.parameters) {
            if (parameter.parameterName == 'AuthProviderUrl') info.tokenEndpoint = parameter.parameterValue;
            if (parameter.parameterName == 'Scope') info.scope = parameter.parameterValue;
        }
        return info;
    }

    @TestVisible
    private static ConnectApi.CredentialInput credentialInput(ConnectionInfo info, String clientId, String clientSecret) {
        ConnectApi.CredentialInput input = new ConnectApi.CredentialInput();
        input.externalCredential = info.externalCredential;
        input.principalName = info.principalName;
        input.principalType = ConnectApi.CredentialPrincipalType.NamedPrincipal;
        ConnectApi.CredentialValueInput idValue = new ConnectApi.CredentialValueInput();
        idValue.value = clientId;
        idValue.encrypted = false;
        ConnectApi.CredentialValueInput secretValue = new ConnectApi.CredentialValueInput();
        secretValue.value = clientSecret;
        secretValue.encrypted = true;
        input.credentials = new Map<String, ConnectApi.CredentialValueInput>{'clientId' => idValue, 'clientSecret' => secretValue};
        return input;
    }

    private class SalesforceCredentialAccess implements CredentialAccess {
        public ConnectionInfo describeCredential(String name) {
            ConnectApi.NamedCredential nc = ConnectApi.NamedCredentials.getNamedCredential(name);
            ConnectApi.ExternalCredential ec;
            if (nc.externalCredentials != null && nc.externalCredentials.size() == 1) {
                ec = ConnectApi.NamedCredentials.getExternalCredential(nc.externalCredentials[0].developerName);
            }
            return describeMetadata(name, nc, ec);
        }

        public void saveCredential(ConnectionInfo info, String clientId, String clientSecret) {
            ConnectApi.CredentialInput input = credentialInput(info, clientId, clientSecret);
            if (info.credentialConfigured) ConnectApi.NamedCredentials.updateCredential(input);
            else ConnectApi.NamedCredentials.createCredential(input);
        }
    }

    public class ConnectionException extends Exception {}
}
