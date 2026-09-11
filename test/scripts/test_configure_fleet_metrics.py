import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/configure-fleet-metrics.py'
spec = importlib.util.spec_from_file_location('configure_fleet', SCRIPT)
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)
SUB = '11111111-1111-1111-1111-111111111111'
PRINCIPAL = '22222222-2222-2222-2222-222222222222'
WORKSPACE = '33333333-3333-3333-3333-333333333333'
GROUP = f'/subscriptions/{SUB}/resourceGroups/docgen-test-rg'
APP = GROUP + '/providers/Microsoft.App/containerApps/docgen-test'
ENV = GROUP + '/providers/Microsoft.App/managedEnvironments/docgen-test-env'
LOGS = GROUP + '/providers/Microsoft.OperationalInsights/workspaces/docgen-test-logs'


class ConfigureFleetTests(unittest.TestCase):
    def setUp(self):
        self.roles = []
        self.calls = []
        self.destination = 'log-analytics'
        self.principal = PRINCIPAL
        self.deny_deployment = False
        self.patch = patch.object(fleet, 'azure', side_effect=self.azure)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def azure(self, *args):
        self.calls.append(args)
        if args[:2] == ('containerapp', 'show'):
            return {'id': APP, 'principalId': self.principal, 'environmentId': ENV}
        if args[:3] == ('containerapp', 'env', 'show'):
            return {'destination': self.destination, 'workspaceId': WORKSPACE}
        if args[:3] == ('monitor', 'log-analytics', 'workspace'):
            return [{'id': LOGS}]
        if args[:3] == ('role', 'assignment', 'list'):
            return self.roles
        if args[:3] == ('deployment', 'group', 'create'):
            if self.deny_deployment:
                raise RuntimeError('AuthorizationFailed')
            return {}
        raise AssertionError(args)

    def configure(self):
        return fleet.configure('docgen-test', 'docgen-test-rg', SUB)

    def role(self, role, scope):
        return {'principalId': PRINCIPAL, 'roleDefinitionId': '/roles/' + role, 'scope': scope}

    def test_discovers_values_and_provisions_access_with_existing_infra_module(self):
        self.assertEqual(self.configure(), {'app_resource_id': APP, 'workspace_id': WORKSPACE})
        deployment = next(c for c in self.calls if c[:3] == ('deployment', 'group', 'create'))
        self.assertIn('assignLogsReader=true', deployment)
        self.assertIn('assignInventoryReader=true', deployment)
        self.assertIn('workspaceName=docgen-test-logs', deployment)
        self.assertTrue(any(str(c).endswith('fleet-metrics-access.bicep') for c in deployment))

    def test_existing_inherited_roles_do_not_create_duplicate_assignments(self):
        self.roles = [self.role(fleet.LOGS_READER, GROUP), self.role(fleet.READER, GROUP)]
        self.configure()
        self.assertFalse(any(c[0] == 'deployment' for c in self.calls))

    def test_only_missing_access_is_provisioned(self):
        self.roles = [self.role(fleet.LOGS_READER, LOGS)]
        self.configure()
        deployment = next(c for c in self.calls if c[0] == 'deployment')
        self.assertIn('assignLogsReader=false', deployment)
        self.assertIn('assignInventoryReader=true', deployment)

    def test_missing_identity_or_console_logging_fails_before_changes(self):
        self.principal = None
        with self.assertRaisesRegex(RuntimeError, 'managed identity'):
            self.configure()
        self.principal = PRINCIPAL
        self.destination = 'none'
        with self.assertRaisesRegex(RuntimeError, 'console logs'):
            self.configure()
        self.assertFalse(any(c[0] == 'deployment' for c in self.calls))

    def test_missing_deployment_permission_is_actionable_and_fatal(self):
        self.deny_deployment = True
        with self.assertRaisesRegex(RuntimeError, 'deployment identity needs role-assignment permission'):
            self.configure()


if __name__ == '__main__':
    unittest.main()
