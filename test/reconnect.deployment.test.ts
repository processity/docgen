// Deployment must preserve custom endpoints and never substitute UAT credentials in production.
const { resolveReconnectParameters } = jest.requireActual('../scripts/reconnect-deployment-config');

it('retains the configured UAT URL and secret reference', () => {
  expect(resolveReconnectParameters({ fqdn: 'uat.azurecontainerapps.io', publicUrl: 'https://uat.example.com',
    secretRef: 'uat-entra', secretNames: ['uat-entra'] }).parameters).toEqual({
    reconnectPublicUrl: { value: 'https://uat.example.com' }, reconnectAadSecretRef: { value: 'uat-entra' }, reconnectSfSecretRef: { value: '' }, reconnectCredentialEditing: { value: false }, reconnectStoragePath: { value: '' }, reconnectStorageName: { value: '' },
  });
});

it('uses the production app FQDN and leaves secret sourcing to its own Key Vault when no app secret exists', () => {
  expect(resolveReconnectParameters({ fqdn: 'production.azurecontainerapps.io', secretNames: null }).parameters).toEqual({
    reconnectPublicUrl: { value: 'https://production.azurecontainerapps.io' }, reconnectAadSecretRef: { value: '' }, reconnectSfSecretRef: { value: '' }, reconnectCredentialEditing: { value: false }, reconnectStoragePath: { value: '' }, reconnectStorageName: { value: '' },
  });
});

it('wires the standard secret only when it exists on the selected app', () => {
  expect(resolveReconnectParameters({ fqdn: 'production.azurecontainerapps.io',
    secretNames: ['docgen-reconnect-aad'] }).parameters.reconnectAadSecretRef.value).toBe('docgen-reconnect-aad');
});

it('allows an explicit custom endpoint without replacing the selected app secret', () => {
  const result = resolveReconnectParameters({ publicUrl: 'https://old.example.com',
    secretRef: 'prod-entra', secretNames: ['prod-entra'] }, 'https://custom.example.com/');
  expect(result.parameters.reconnectPublicUrl.value).toBe('https://custom.example.com');
  expect(result.parameters.reconnectAadSecretRef.value).toBe('prod-entra');
});

it('rejects a dangling reference instead of silently selecting another secret', () => {
  expect(() => resolveReconnectParameters({ fqdn: 'uat.azurecontainerapps.io', secretRef: 'missing',
    secretNames: ['docgen-reconnect-aad'] })).toThrow('does not exist');
});

it('refuses to carry an inline credential into a parameter file', () => {
  expect(() => resolveReconnectParameters({ fqdn: 'uat.azurecontainerapps.io', inlineSecret: true }))
    .toThrow('Container App secret reference');
});

it.each(['http://insecure.example.com', 'https://user:password@example.com',
  'https://example.com?token=secret', 'https://example.com#fragment'])('rejects an unsafe reconnect URL (%s)', (publicUrl) => {
  expect(() => resolveReconnectParameters({ publicUrl })).toThrow('must be HTTPS');
});

it('fails when Azure provides no endpoint', () => {
  expect(() => resolveReconnectParameters({})).toThrow('ingress FQDN');
});

it('preserves distinct Salesforce and Entra secret references for the selected app', () => {
  const result = resolveReconnectParameters({ fqdn: 'production.azurecontainerapps.io',
    secretRef: 'entra-prod', sfSecretRef: 'salesforce-prod', secretNames: ['entra-prod', 'salesforce-prod'] });
  expect(result.parameters.reconnectAadSecretRef.value).toBe('entra-prod');
  expect(result.parameters.reconnectSfSecretRef.value).toBe('salesforce-prod');
});

it('uses the standard Salesforce secret only when present and rejects unsafe or dangling settings', () => {
  const app = { fqdn: 'production.azurecontainerapps.io', secretNames: ['docgen-reconnect-sf'] };
  expect(resolveReconnectParameters(app).parameters.reconnectSfSecretRef.value).toBe('docgen-reconnect-sf');
  expect(() => resolveReconnectParameters({ ...app, sfSecretRef: 'missing' })).toThrow('Salesforce reconnect secret reference');
  expect(() => resolveReconnectParameters({ ...app, sfInlineSecret: true })).toThrow('DOCGEN_RECONNECT_SF_CLIENT_SECRET');
});

it('preserves the enabled credential-editing flag for infrastructure redeployment', () => {
  expect(resolveReconnectParameters({ fqdn: 'uat.azurecontainerapps.io', credentialEditing: 'true' })
    .parameters.reconnectCredentialEditing.value).toBe(true);
});

it('preserves the Azure Files mount and refuses an ephemeral replacement', () => {
  const app = { fqdn: 'uat.azurecontainerapps.io', storagePath: '/mnt/docgen-connection',
    mounts: [{ volumeName: 'docgen-connection', mountPath: '/mnt/docgen-connection' }],
    volumes: [{ name: 'docgen-connection', storageType: 'AzureFile', storageName: 'docgen-connection' }] };
  expect(resolveReconnectParameters(app).parameters.reconnectStorageName.value).toBe('docgen-connection');
  expect(() => resolveReconnectParameters({ ...app, volumes: [] })).toThrow('mounted Azure Files');
});

it.each(['uat', 'production'])('preserves %s storage, endpoint and separate credential references without cross-environment defaults', (environment) => {
  const app = { fqdn: `${environment}.azurecontainerapps.io`, storagePath: '/mnt/docgen-connection', credentialEditing: 'true',
    secretRef: `${environment}-entra`, sfSecretRef: `${environment}-salesforce`,
    secretNames: [`${environment}-entra`, `${environment}-salesforce`],
    mounts: [{ volumeName: 'docgen-connection', mountPath: '/mnt/docgen-connection' }],
    volumes: [{ name: 'docgen-connection', storageType: 'AzureFile', storageName: `${environment}-connection` }] };
  const parameters = resolveReconnectParameters(app).parameters;
  expect(parameters.reconnectPublicUrl.value).toBe(`https://${environment}.azurecontainerapps.io`);
  expect(parameters.reconnectSfSecretRef.value).toBe(`${environment}-salesforce`);
  expect(parameters.reconnectAadSecretRef.value).toBe(`${environment}-entra`);
  expect(parameters.reconnectStorageName.value).toBe(`${environment}-connection`);
  expect(parameters.reconnectCredentialEditing.value).toBe(true);
});
