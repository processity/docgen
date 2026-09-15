#!/usr/bin/env node
// Resolve nonsecret deployment parameters from the target app, never another environment.
const { execFileSync } = require('node:child_process');

function resolveReconnectParameters(app, publicUrlOverride = '') {
  if (app.inlineSecret) {
    throw new Error('Move DOCGEN_RECONNECT_AAD_CLIENT_SECRET into a Container App secret reference before deploying.');
  }
  if (app.sfInlineSecret) {
    throw new Error('Move DOCGEN_RECONNECT_SF_CLIENT_SECRET into a Container App secret reference before deploying.');
  }
  const candidate = publicUrlOverride.trim() || app.publicUrl?.trim()
    || (app.fqdn ? `https://${app.fqdn}` : '');
  let url;
  try { url = new URL(candidate); } catch {
    throw new Error('The target app needs an ingress FQDN or DOCGEN_RECONNECT_PUBLIC_URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('DOCGEN_RECONNECT_PUBLIC_URL must be HTTPS without credentials, a query, or a fragment.');
  }
  const names = app.secretNames || [];
  const secretRef = app.secretRef || (names.includes('docgen-reconnect-aad') ? 'docgen-reconnect-aad' : '');
  if (secretRef && !names.includes(secretRef)) {
    throw new Error('The configured reconnect secret reference does not exist on the target Container App.');
  }
  const sfSecretRef = app.sfSecretRef || (names.includes('docgen-reconnect-sf') ? 'docgen-reconnect-sf' : '');
  if (sfSecretRef && !names.includes(sfSecretRef)) {
    throw new Error('The configured Salesforce reconnect secret reference does not exist on the target Container App.');
  }
  const storagePath = app.storagePath || '';
  let storageName = '';
  if (storagePath) {
    if (!/^\/[a-zA-Z0-9/_-]{1,127}$/.test(storagePath)) throw new Error('Invalid connection storage mount path.');
    const mount = (app.mounts || []).find(item => item.mountPath === storagePath);
    const volume = (app.volumes || []).find(item => item.name === mount?.volumeName && item.storageType === 'AzureFile');
    if (!volume?.storageName) throw new Error('Connection storage must reference a mounted Azure Files share.');
    storageName = volume.storageName;
  }
  return { parameters: {
    reconnectPublicUrl: { value: url.toString().replace(/\/$/, '') },
    reconnectAadSecretRef: { value: secretRef },
    reconnectSfSecretRef: { value: sfSecretRef },
    reconnectCredentialEditing: { value: app.credentialEditing === 'true' },
    reconnectStoragePath: { value: storagePath },
    reconnectStorageName: { value: storageName },
  } };
}

if (require.main === module) {
  try {
    const [resourceGroup, appName] = process.argv.slice(2);
    if (!resourceGroup || !appName) throw new Error('Usage: node scripts/reconnect-deployment-config.js <resource-group> <app-name>');
    // Only the public URL, reference names, and an inline-secret boolean leave Azure CLI.
    const env = 'properties.template.containers[0].env';
    const query = `{fqdn:properties.configuration.ingress.fqdn, publicUrl:(${env}[?name=='DOCGEN_RECONNECT_PUBLIC_URL'].value | [0]), secretRef:(${env}[?name=='DOCGEN_RECONNECT_AAD_CLIENT_SECRET'].secretRef | [0]), inlineSecret:length(${env}[?name=='DOCGEN_RECONNECT_AAD_CLIENT_SECRET' && value!=null && value!='']) > \`0\`, sfSecretRef:(${env}[?name=='DOCGEN_RECONNECT_SF_CLIENT_SECRET'].secretRef | [0]), sfInlineSecret:length(${env}[?name=='DOCGEN_RECONNECT_SF_CLIENT_SECRET' && value!=null && value!='']) > \`0\`, credentialEditing:(${env}[?name=='DOCGEN_RECONNECT_CREDENTIAL_EDITING'].value | [0]), storagePath:(${env}[?name=='DOCGEN_RECONNECT_STORAGE_PATH'].value | [0]), volumes:properties.template.volumes[].{name:name,storageType:storageType,storageName:storageName}, mounts:properties.template.containers[0].volumeMounts, secretNames:properties.configuration.secrets[].name}`;
    const app = JSON.parse(execFileSync('az', ['containerapp', 'show', '--resource-group', resourceGroup,
      '--name', appName, '--query', query, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    process.stdout.write(`${JSON.stringify(resolveReconnectParameters(app, process.env.DOCGEN_RECONNECT_PUBLIC_URL), null, 2)}\n`);
  } catch (error) {
    // Do not dump Azure responses or subprocess objects into Actions logs.
    console.error(error.status === undefined ? error.message : 'Could not read the target Container App. Check Azure access and deployment target.');
    process.exitCode = 1;
  }
}

module.exports = { resolveReconnectParameters };
