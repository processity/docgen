@IsTest
private class DocgenConnectionControllerTest {
    private class FakeCredentials implements DocgenConnectionController.CredentialAccess {
        public String lastName;
        public Integer saves = 0;
        public String clientId;
        public String secret;
        public String backendUrl = 'https://docgen.example.com/';
        public DocgenConnectionController.ConnectionInfo describeCredential(String name) {
            lastName = name;
            DocgenConnectionController.ConnectionInfo info = new DocgenConnectionController.ConnectionInfo();
            info.namedCredential = name;
            info.backendUrl = backendUrl;
            info.externalCredential = 'Custom_Entra';
            info.principalName = 'Custom_Principal';
            info.tokenEndpoint = 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token';
            info.scope = 'api://client/.default';
            info.credentialConfigured = false;
            return info;
        }
        public void saveCredential(DocgenConnectionController.ConnectionInfo info, String id, String value) {
            Assert.areEqual('Custom_Entra', info.externalCredential);
            Assert.areEqual('Custom_Principal', info.principalName);
            saves++;
            clientId = id;
            secret = value;
        }
    }
    private static FakeCredentials setupConnection() {
        FakeCredentials store = new FakeCredentials();
        DocgenConnectionController.credentials = store;
        DocgenConnectionController.permissionOverride = true;
        RestContext.request = new RestRequest();
        RestContext.response = new RestResponse();
        return store;
    }
    private static Map<String, Object> restoreBody() {
        DocgenConnectionController.ConnectionInfo info = DocgenConnectionController.getReconnectInfo();
        return new Map<String, Object>{'orgId' => info.orgId, 'userId' => info.userId,
            'namedCredential' => info.namedCredential, 'backendUrl' => info.backendUrl,
            'externalCredential' => info.externalCredential, 'principalName' => info.principalName,
            'tokenEndpoint' => info.tokenEndpoint, 'scope' => info.scope,
            'clientId' => 'client', 'clientSecret' => 'test-secret'};
    }
    private class VerifyMock implements HttpCalloutMock {
        private String expectedName;
        private Boolean succeeds;
        public VerifyMock(String name, Boolean success) { expectedName = name; succeeds = success; }
        public HttpResponse respond(HttpRequest req) {
            Assert.areEqual('callout:' + expectedName + '/connect/verify', req.getEndpoint());
            Assert.areEqual('POST', req.getMethod());
            Assert.isTrue(req.getBody().contains(UserInfo.getOrganizationId()));
            HttpResponse response = new HttpResponse();
            response.setStatusCode(succeeds ? 200 : 503);
            response.setBody(JSON.serialize(new Map<String, Object>{'connected' => succeeds,
                'orgId' => UserInfo.getOrganizationId(), 'integrationUsername' => 'integration@example.com'}));
            return response;
        }
    }
    @IsTest static void usesOverrideAndCurrentOrgIdentity() {
        FakeCredentials store = setupConnection();
        insert new Docgen_Settings__c(SetupOwnerId = UserInfo.getOrganizationId(), Named_Credential_Name__c = 'Custom_Backend');
        DocgenConnectionController.ConnectionInfo info = DocgenConnectionController.getReconnectInfo();
        Assert.areEqual('Custom_Backend', store.lastName);
        Assert.areEqual('https://docgen.example.com', info.backendUrl);
        Assert.areEqual(UserInfo.getOrganizationId(), info.orgId);
        Assert.areEqual(UserInfo.getUserId(), info.userId);
        Assert.areEqual(URL.getOrgDomainUrl().toExternalForm(), info.salesforceOrigin);
    }
    @IsTest static void usesExistingDefaultResolver() {
        FakeCredentials store = setupConnection();
        DocgenConnectionController.getReconnectInfo();
        Assert.areEqual(DocgenConnectionConfig.getNamedCredentialName(), store.lastName);
    }
    @IsTest static void requiresConnectionAdminPermission() {
        FakeCredentials store = setupConnection();
        DocgenConnectionController.permissionOverride = false;
        DocgenConnectionController.connectionInfo();
        Assert.areEqual(403, RestContext.response.statusCode);
        Assert.isNull(store.lastName);
        DocgenConnectionController.restoreCredential();
        Assert.areEqual(0, store.saves);
    }
    @IsTest static void restoresOnlyTheSelectedPrincipal() {
        FakeCredentials store = setupConnection();
        RestContext.request.requestBody = Blob.valueOf(JSON.serialize(restoreBody()));
        DocgenConnectionController.restoreCredential();
        Assert.areEqual(200, RestContext.response.statusCode);
        Assert.areEqual(1, store.saves);
        Assert.areEqual('client', store.clientId);
        Assert.areEqual('test-secret', store.secret);
        Assert.isFalse(RestContext.response.responseBody.toString().contains('test-secret'));
    }
    @IsTest static void rejectsChangedSettingsBeforeWritingSecrets() {
        FakeCredentials store = setupConnection();
        Map<String, Object> body = restoreBody();
        body.put('namedCredential', 'Another_Backend');
        RestContext.request.requestBody = Blob.valueOf(JSON.serialize(body));
        DocgenConnectionController.restoreCredential();
        Assert.areEqual(409, RestContext.response.statusCode);
        Assert.areEqual(0, store.saves);
    }
    @IsTest static void rejectsMissingSecrets() {
        FakeCredentials store = setupConnection();
        Map<String, Object> body = restoreBody();
        body.put('clientSecret', '');
        RestContext.request.requestBody = Blob.valueOf(JSON.serialize(body));
        DocgenConnectionController.restoreCredential();
        Assert.areEqual(400, RestContext.response.statusCode);
        Assert.areEqual(0, store.saves);
    }
    @IsTest static void verifiesThroughResolvedNamedCredential() {
        setupConnection();
        String name = DocgenConnectionConfig.getNamedCredentialName();
        Test.setMock(HttpCalloutMock.class, new VerifyMock(name, true));
        DocgenConnectionController.verifyConnection();
        Assert.areEqual(200, RestContext.response.statusCode);
        Assert.isTrue(RestContext.response.responseBody.toString().contains('"connected":true'));
    }
    @IsTest static void doesNotReportSuccessForFailedReturnCallout() {
        setupConnection();
        Test.setMock(HttpCalloutMock.class, new VerifyMock(DocgenConnectionConfig.getNamedCredentialName(), false));
        DocgenConnectionController.verifyConnection();
        Assert.areEqual(503, RestContext.response.statusCode);
    }
    @IsTest static void rejectsUnsafeBackendUrl() {
        FakeCredentials store = setupConnection();
        store.backendUrl = 'https://username:password@backend.example.com';
        DocgenConnectionController.connectionInfo();
        Assert.areEqual(403, RestContext.response.statusCode);
        Assert.isFalse(RestContext.response.responseBody.toString().contains('password'));
    }

    private static ConnectApi.NamedCredential namedCredentialFixture() {
        ConnectApi.NamedCredential nc = new ConnectApi.NamedCredential();
        nc.calloutUrl = 'https://custom.example.com';
        ConnectApi.ExternalCredential ec = new ConnectApi.ExternalCredential();
        ec.developerName = 'Custom_Entra';
        nc.externalCredentials = new List<ConnectApi.ExternalCredential>{ec};
        return nc;
    }
    private static ConnectApi.ExternalCredential externalCredentialFixture(String principalType, String variant) {
        ConnectApi.ExternalCredential ec = new ConnectApi.ExternalCredential();
        ec.developerName = 'Custom_Entra';
        ec.authenticationProtocolVariant = ConnectApi.CredentialAuthenticationProtocolVariant.valueOf(variant);
        ConnectApi.ExternalCredentialPrincipal principal = new ConnectApi.ExternalCredentialPrincipal();
        principal.principalName = 'Custom_Principal';
        principal.principalType = ConnectApi.CredentialPrincipalType.valueOf(principalType);
        principal.authenticationStatus = ConnectApi.CredentialAuthenticationStatus.Configured;
        ec.principals = new List<ConnectApi.ExternalCredentialPrincipal>{principal};
        ConnectApi.ExternalCredentialParameter scope = new ConnectApi.ExternalCredentialParameter();
        scope.parameterName = 'Scope';
        scope.parameterValue = 'api://client/.default';
        ConnectApi.ExternalCredentialParameter endpoint = new ConnectApi.ExternalCredentialParameter();
        endpoint.parameterName = 'AuthProviderUrl';
        endpoint.parameterValue = 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token';
        ec.parameters = new List<ConnectApi.ExternalCredentialParameter>{scope, endpoint};
        return ec;
    }
    @IsTest static void readsNativeCredentialMetadataAndEncryptsTheSecret() {
        DocgenConnectionController.ConnectionInfo info = DocgenConnectionController.describeMetadata(
            'Custom_Backend', namedCredentialFixture(), externalCredentialFixture('NamedPrincipal', 'ClientCredentialsClientSecretBasic'));
        Assert.areEqual('https://custom.example.com', info.backendUrl);
        Assert.areEqual('Custom_Entra', info.externalCredential);
        Assert.areEqual('Custom_Principal', info.principalName);
        Assert.areEqual('api://client/.default', info.scope);
        Assert.areEqual('https://login.microsoftonline.com/tenant/oauth2/v2.0/token', info.tokenEndpoint);
        Assert.isTrue(info.credentialConfigured);
        ConnectApi.CredentialInput input = DocgenConnectionController.credentialInput(info, 'client', 'test-secret');
        Assert.areEqual('Custom_Entra', input.externalCredential);
        Assert.areEqual('Custom_Principal', input.principalName);
        Assert.areEqual('test-secret', input.credentials.get('clientSecret').value);
        Assert.isTrue(input.credentials.get('clientSecret').encrypted);
        Assert.isFalse(input.credentials.get('clientId').encrypted);
    }
    @IsTest static void refusesPerUserCredentials() {
        try {
            DocgenConnectionController.describeMetadata('Custom_Backend', namedCredentialFixture(),
                externalCredentialFixture('PerUserPrincipal', 'ClientCredentialsClientSecretBasic'));
            Assert.fail('Per-user credentials must not be overwritten by org reconnect');
        } catch (DocgenConnectionController.ConnectionException e) {
            Assert.isTrue(e.getMessage().contains('one named principal'));
        }
    }
    @IsTest static void refusesMissingExternalCredential() {
        try {
            DocgenConnectionController.describeMetadata('Custom_Backend', namedCredentialFixture(), null);
            Assert.fail('Missing External Credential must be reported');
        } catch (DocgenConnectionController.ConnectionException e) {
            Assert.isTrue(e.getMessage().contains('one External Credential'));
        }
    }
}
