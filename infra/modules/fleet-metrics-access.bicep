// Shared telemetry already resides in the Container Apps environment's workspace.
// Scope permissions to that workspace and this app, not the subscription.
param appName string
param workspaceName string
param principalId string

resource app 'Microsoft.App/containerApps@2023-05-01' existing = { name: appName }
resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = { name: workspaceName }

resource logsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workspace.id, principalId, 'docgen-fleet-logs-reader')
  scope: workspace
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
  }
}

resource inventoryReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(app.id, principalId, 'docgen-fleet-inventory-reader')
  scope: app
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  }
}
