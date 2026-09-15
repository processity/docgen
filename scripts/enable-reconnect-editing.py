#!/usr/bin/env python3
"""One-time Azure owner setup. Salesforce admins do not need Azure access afterward."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def az(args, label):
    result = subprocess.run(['az', *args], text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(f'{label} failed. Check Azure permissions and the selected resources. No credential values were printed.')
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--resource-group', required=True)
    parser.add_argument('--app', required=True)
    parser.add_argument('--vault', help='Required only for Key Vault storage')
    options = parser.parse_args()
    subscription = ['--subscription', options.subscription]
    app = az(['containerapp', 'show', *subscription, '--resource-group', options.resource_group,
              '--name', options.app, '-o', 'json'], 'Read Container App')
    containers = app['properties']['template']['containers']
    for container in containers:
        container.pop('imageType', None)
    if len(containers) != 1:
        raise SystemExit('This script requires one container.')
    env = containers[0].get('env', [])
    if not any(item['name'] == 'DOCGEN_RECONNECT_PUBLIC_URL' and item.get('value', '').startswith('https://') for item in env):
        raise SystemExit('Configure the backend public URL before enabling credential editing.')
    path = next((item.get('value') for item in env if item['name'] == 'DOCGEN_RECONNECT_STORAGE_PATH'), '')
    if path:
        mounts = containers[0].get('volumeMounts') or []
        mount = next((item for item in mounts if item['mountPath'] == path), None)
        volumes = app['properties']['template'].get('volumes') or []
        if not mount or not any(item['name'] == mount['volumeName'] and item.get('storageType') == 'AzureFile' for item in volumes):
            raise SystemExit('The configured connection storage path is not an Azure Files mount.')
        # Account-key mounting needs no Key Vault write role for the backend identity.
    else:
        if not options.vault:
            raise SystemExit('Provide --vault for Key Vault storage, or mount Azure Files first.')
        vault = az(['keyvault', 'show', *subscription, '--resource-group', options.resource_group,
                    '--name', options.vault, '-o', 'json'], 'Read Key Vault')
        principal = app.get('identity', {}).get('principalId')
        if not principal or not vault['properties'].get('enableRbacAuthorization'):
            raise SystemExit('Key Vault mode requires a system-assigned identity and an RBAC-enabled vault.')
        configured_vault = next((item.get('value') for item in env if item['name'] == 'KEY_VAULT_URI'), '')
        if configured_vault.rstrip('/') != vault['properties']['vaultUri'].rstrip('/'):
            raise SystemExit('The selected vault does not match the backend KEY_VAULT_URI.')
        assignments = az(['role', 'assignment', 'list', *subscription, '--scope', vault['id'],
                          '--include-inherited', '--query', "[?principalId=='" + principal + "']", '-o', 'json'], 'Read vault roles')
        if not any(item.get('roleDefinitionName') in ['Key Vault Secrets Officer', 'Key Vault Administrator'] for item in assignments):
            az(['role', 'assignment', 'create', *subscription, '--assignee-object-id', principal,
                '--assignee-principal-type', 'ServicePrincipal', '--role', 'Key Vault Secrets Officer',
                '--scope', vault['id'], '-o', 'none'], 'Grant backend identity vault secret access')
    env = [item for item in env if item['name'] != 'DOCGEN_RECONNECT_CREDENTIAL_EDITING']
    env.append({'name': 'DOCGEN_RECONNECT_CREDENTIAL_EDITING', 'value': 'true'})
    containers[0]['env'] = env
    for probe in containers[0].get('probes', []):
        if probe.get('type') in ['Startup', 'Readiness'] and 'httpGet' in probe:
            probe['httpGet']['path'] = '/healthz'
    # PATCH only the container template. Keep image, other env values, scale and app secrets.
    body = {'properties': {'template': {'containers': containers}}}
    with tempfile.TemporaryDirectory(prefix='docgen-reconnect-setup-') as directory:
        payload = Path(directory) / 'template.json'
        payload.write_text(json.dumps(body))
        payload.chmod(0o600)
        az(['rest', *subscription, '--method', 'patch', '--uri',
            'https://management.azure.com' + app['id'] + '?api-version=2023-05-01',
            '--body', '@' + str(payload), '-o', 'none'], 'Enable recovery UI and recovery-safe probes')
    print('Credential editing enabled for ' + options.resource_group + '/' + options.app)
    if path:
        print('Azure Files mode: no Key Vault role assignment was needed.')
    else:
        print('Key Vault role changes can take several minutes to propagate.')
    print('Verify recovery before the next sandbox refresh.')


if __name__ == '__main__':
    main()
