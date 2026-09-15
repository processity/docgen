#!/usr/bin/env python3
"""Provision or mount isolated Azure Files storage for an explicitly selected Docgen environment."""
import argparse
import json
import re
from pathlib import Path
import subprocess
import tempfile

def az(args, label):
    result = subprocess.run(['az', *args], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f'{label} failed (exit {result.returncode}); sensitive command output was suppressed.')
    return json.loads(result.stdout) if result.stdout.strip() else None

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['subscription', 'resource-group', 'app', 'storage-account', 'share']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--create-storage', action='store_true', help='Create the account/share in the selected resource group if absent')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9]{3,24}', args.storage_account) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', args.share):
        raise SystemExit('Provide valid Azure storage account and share names.')
    subscription = ['--subscription', args.subscription]
    app = az(['containerapp', 'show', *subscription, '-g', args.resource_group, '-n', args.app, '-o', 'json'], 'Read app')
    environment_id = app['properties']['managedEnvironmentId']
    if environment_id.split('/')[4].lower() != args.resource_group.lower():
        raise SystemExit('This script requires the app environment in the selected resource group.')
    template = app['properties']['template']
    if len(template['containers']) != 1:
        raise SystemExit('Select a single-container Docgen app.')
    container = template['containers'][0]
    # Newer CLI responses contain this field, which the stable 2023 API rejects.
    container.pop('imageType', None)
    mount_path = '/mnt/docgen-connection'
    volume_name = 'docgen-connection'
    volumes = template.get('volumes') or []
    mounts = container.get('volumeMounts') or []
    if any(v['name'] == volume_name and v.get('storageName') != volume_name for v in volumes):
        raise SystemExit('The connection volume name is already used by different storage.')
    if any(m['mountPath'] == mount_path and m['volumeName'] != volume_name for m in mounts):
        raise SystemExit('The connection path is already mounted from different storage.')
    links = az(['containerapp', 'env', 'storage', 'list', *subscription, '-g', args.resource_group,
                '-n', environment_id.split('/')[-1], '--query',
                '[].{name:name,account:properties.azureFile.accountName,share:properties.azureFile.shareName}', '-o', 'json'], 'Read existing storage links')
    for link in links:
        if link['name'] == volume_name and (link['account'] != args.storage_account or link['share'] != args.share):
            raise SystemExit('The environment storage name already belongs to another share.')
    accounts = az(['storage', 'account', 'list', *subscription, '-g', args.resource_group,
                   '--query', "[?name=='" + args.storage_account + "']", '-o', 'json'], 'Verify storage ownership')
    if not accounts:
        if not args.create_storage:
            raise SystemExit('Storage account not found in the selected resource group. Use --create-storage to provision it.')
        account = az(['storage', 'account', 'create', *subscription, '-g', args.resource_group,
                      '-n', args.storage_account, '--location', app['location'], '--kind', 'StorageV2',
                      '--sku', 'Standard_LRS', '--https-only', 'true', '--min-tls-version', 'TLS1_2',
                      '--allow-blob-public-access', 'false', '--allow-shared-key-access', 'true', '-o', 'json'], 'Create isolated storage account')
    else:
        account = accounts[0]
    if account.get('allowBlobPublicAccess') is not False or not account.get('enableHttpsTrafficOnly') or account.get('allowSharedKeyAccess') is False:
        raise SystemExit('Storage must disable anonymous blob access, require secure transfer, and permit authenticated SMB account-key access.')
    shares = az(['storage', 'share-rm', 'list', *subscription, '-g', args.resource_group,
                 '--storage-account', args.storage_account, '--query', "[?name=='" + args.share + "']", '-o', 'json'], 'Read file share')
    if not shares:
        if not args.create_storage:
            raise SystemExit('File share not found. Use --create-storage to provision it.')
        az(['storage', 'share-rm', 'create', *subscription, '-g', args.resource_group,
            '--storage-account', args.storage_account, '--name', args.share, '--quota', '1',
            '--enabled-protocols', 'SMB', '-o', 'none'], 'Create connection file share')
    elif shares[0].get('enabledProtocols', 'SMB') != 'SMB':
        raise SystemExit('Connection storage requires an SMB file share.')
    keys = az(['storage', 'account', 'keys', 'list', *subscription, '-g', args.resource_group,
               '-n', args.storage_account, '-o', 'json'], 'Read storage mounting key')
    az(['containerapp', 'env', 'storage', 'set', *subscription, '-g', args.resource_group,
        '-n', environment_id.split('/')[-1], '--storage-name', volume_name, '--access-mode', 'ReadWrite',
        '--azure-file-account-name', args.storage_account, '--azure-file-account-key', keys[0]['value'],
        '--azure-file-share-name', args.share, '-o', 'none'], 'Configure authenticated environment mount')
    volumes = [v for v in volumes if v['name'] != volume_name]
    volumes.append({'name': volume_name, 'storageType': 'AzureFile', 'storageName': volume_name,
                    'mountOptions': 'uid=1000,gid=1000,dir_mode=0700,file_mode=0600,cache=strict'})
    container['volumeMounts'] = [m for m in mounts if m['volumeName'] != volume_name] + [
        {'volumeName': volume_name, 'mountPath': mount_path}]
    container['env'] = [e for e in container.get('env', []) if e['name'] != 'DOCGEN_RECONNECT_STORAGE_PATH'] + [
        {'name': 'DOCGEN_RECONNECT_STORAGE_PATH', 'value': mount_path}]
    current_revision = az(['containerapp', 'show', *subscription, '-g', args.resource_group, '-n', args.app,
                           '--query', 'properties.latestRevisionName', '-o', 'json'], 'Check concurrent deployment')
    if current_revision != app['properties'].get('latestRevisionName'):
        raise SystemExit('The app changed while storage was being prepared. Rerun to preserve the latest deployment.')
    with tempfile.TemporaryDirectory(prefix='docgen-files-mount-') as folder:
        payload = Path(folder) / 'patch.json'
        payload.write_text(json.dumps({'properties': {'template': {
            'containers': template['containers'], 'volumes': volumes}}}))
        payload.chmod(0o600)
        az(['rest', *subscription, '--method', 'patch', '--uri',
            'https://management.azure.com' + app['id'] + '?api-version=2023-05-01',
            '--body', '@' + str(payload), '-o', 'none'], 'Mount persistent connection storage')
    print(json.dumps({'app': args.app, 'account': args.storage_account, 'share': args.share,
                      'mountPath': mount_path, 'imageChanged': False}))

if __name__ == '__main__':
    main()
