#!/usr/bin/env python3
"""Prepare shared metrics during an ordinary Container App deployment."""
import argparse
import json
import re
import subprocess
from pathlib import Path

LOGS_READER = '73c42c96-874c-492b-b04d-ab87d138a893'
READER = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
GUID = re.compile(r'^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$')


def azure(*args):
    result = subprocess.run(
        ['az', *args, '--only-show-errors', '--output', 'json'],
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise RuntimeError(f'Azure fleet setup failed: {result.stderr.strip()}')
    return json.loads(result.stdout) if result.stdout.strip() else None


def configure(app_name, resource_group, subscription):
    app = azure('containerapp', 'show', '--name', app_name,
                '--resource-group', resource_group, '--subscription', subscription,
                '--query', '{id:id,principalId:identity.principalId,environmentId:properties.managedEnvironmentId}')
    if not app.get('principalId'):
        raise RuntimeError('The Container App needs its system-assigned managed identity before deployment.')
    environment_id = app.get('environmentId') or ''
    match = re.fullmatch(
        r'/subscriptions/([^/]+)/resourceGroups/([^/]+)/providers/Microsoft.App/managedEnvironments/([^/]+)',
        environment_id, re.IGNORECASE,
    )
    if not match:
        raise RuntimeError('Could not discover the Container App environment.')
    env_subscription, env_group, env_name = match.groups()
    environment = azure('containerapp', 'env', 'show', '--name', env_name,
                        '--resource-group', env_group, '--subscription', env_subscription,
                        '--query', '{destination:properties.appLogsConfiguration.destination,workspaceId:properties.appLogsConfiguration.logAnalyticsConfiguration.customerId}')
    workspace_id = environment.get('workspaceId') or ''
    if environment.get('destination') != 'log-analytics' or not GUID.fullmatch(workspace_id):
        raise RuntimeError('The Container App environment must send console logs to Log Analytics.')
    workspaces = azure('monitor', 'log-analytics', 'workspace', 'list',
                       '--resource-group', resource_group, '--subscription', env_subscription,
                       '--query', f"[?customerId=='{workspace_id}'].{{id:id}}")
    if len(workspaces) != 1:
        raise RuntimeError('Could not uniquely resolve the existing Log Analytics workspace.')
    workspace_scope = workspaces[0]['id']
    workspace_group = workspace_scope.split('/')[4]
    if workspace_group.lower() != resource_group.lower() or env_subscription.lower() != subscription.lower():
        raise RuntimeError('This deployment expects the logging workspace in the app resource group, as provisioned by infra/main.bicep.')
    principal = app['principalId']
    if not GUID.fullmatch(principal):
        raise RuntimeError('The Container App managed identity ID is invalid.')

    # Include inherited assignments. Repeated deployments must not create duplicates.
    missing = {}
    for setting, scope, role in [('assignLogsReader', workspace_scope, LOGS_READER),
                                  ('assignInventoryReader', app['id'], READER)]:
        assignments = azure('role', 'assignment', 'list', '--assignee-object-id', principal,
                            '--scope', scope, '--include-inherited', '--fill-principal-name', 'false',
                            '--subscription', subscription)
        assigned = any(
            assignment.get('principalId', '').lower() == principal.lower()
            and assignment.get('roleDefinitionId', '').lower().endswith('/' + role)
            and (scope.lower() == assignment.get('scope', '').lower()
                 or scope.lower().startswith(assignment.get('scope', '').lower() + '/'))
            for assignment in assignments
        )
        missing[setting] = not assigned
    if any(missing.values()):
        # Reuse the infrastructure module so assignment names match later full deployments.
        template = Path(__file__).resolve().parents[1] / 'infra/modules/fleet-metrics-access.bicep'
        try:
            azure('deployment', 'group', 'create', '--name', f'{app_name}-fleet-metrics',
                  '--resource-group', resource_group, '--subscription', subscription,
                  '--template-file', str(template), '--parameters',
                  f'appName={app_name}', f'workspaceName={workspace_scope.split("/")[-1]}',
                  f'principalId={principal}',
                  *[f'{key}={str(value).lower()}' for key, value in missing.items()])
        except RuntimeError as error:
            raise RuntimeError(
                'Deployment cannot grant the scoped fleet metrics read access. '
                'The deployment identity needs role-assignment permission on the '
                f'Container App and workspace. {error}'
            ) from error
    return {'app_resource_id': app['id'], 'workspace_id': workspace_id}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-name', required=True)
    parser.add_argument('--resource-group', required=True)
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--github-output', type=Path, required=True)
    args = parser.parse_args()
    try:
        settings = configure(args.app_name, args.resource_group, args.subscription)
        with args.github_output.open('a') as output:
            for key, value in settings.items():
                if '\n' in value or '\r' in value:
                    raise RuntimeError('Invalid multiline Azure resource metadata.')
                output.write(f'{key}={value}\n')
        print('Fleet metrics workspace discovered and scoped read access configured.')
    except RuntimeError as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
