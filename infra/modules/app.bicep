// ============================================================================
// Module: Container App
// ============================================================================
// Creates Azure Container App for the Salesforce PDF Generation service
//
// Dependencies:
//   - Container Apps Environment
//   - Azure Container Registry
//   - Azure Key Vault
// Resources Created:
//   - Container App (2 vCPU, 4 GB, auto-scaling 1-5 replicas)
//   - System-assigned Managed Identity
//   - RBAC role assignments (Key Vault Secrets User, AcrPull)
// ============================================================================

@description('Application name')
param appName string

@description('Azure region for resources')
param location string = resourceGroup().location

@description('Container Apps Environment resource ID')
param environmentId string

@description('Container Registry login server')
param acrLoginServer string

@description('Container image tag')
param imageTag string = 'latest'

@description('Key Vault URI')
param keyVaultUri string

@description('Key Vault resource ID')
param keyVaultId string

@description('Azure Container Registry resource ID')
param acrId string

@description('Azure AD tenant ID')
param tenantId string

@description('Azure AD client ID (application ID)')
param clientId string

@description('Image allowlist (comma-separated domains)')
param imageAllowlist string = ''

@description('Common tags for all resources')
param tags object = {}

// ============================================================================
// Variables
// ============================================================================

var containerAppName = appName
var containerImage = '${acrLoginServer}/docgen-api:${imageTag}'

// Azure AD OAuth2 configuration
var issuer = '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
var audience = 'api://${clientId}'
var jwksUri = '${environment().authentication.loginEndpoint}${tenantId}/discovery/v2.0/keys'

// Built-in role definition IDs (Azure RBAC)
// Reference: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// ============================================================================
// Container App
// ============================================================================

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      revisionSuffix: ''
      containers: [
        {
          name: 'docgen-api'
          image: containerImage
          resources: {
            cpu: json('2.0')
            memory: '4Gi'
          }
          env: [
            // Node.js environment
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '8080'
            }
            // Azure AD OAuth2 configuration (inbound auth from Salesforce)
            {
              name: 'AZURE_TENANT_ID'
              value: tenantId
            }
            {
              name: 'CLIENT_ID'
              value: clientId
            }
            {
              name: 'ISSUER'
              value: issuer
            }
            {
              name: 'AUDIENCE'
              value: audience
            }
            {
              name: 'JWKS_URI'
              value: jwksUri
            }
            // Key Vault configuration
            {
              name: 'KEY_VAULT_URI'
              value: keyVaultUri
            }
            // LibreOffice configuration
            {
              name: 'LIBREOFFICE_CONCURRENCY'
              value: '8'
            }
            {
              name: 'CONVERSION_TIMEOUT'
              value: '60000'
            }
            {
              name: 'CONVERSION_WORKDIR'
              value: '/tmp'
            }
            {
              name: 'CONVERSION_MAX_CONCURRENT'
              value: '8'
            }
            // Poller configuration (batch worker)
            {
              name: 'POLLER_ENABLED'
              value: 'true'
            }
            {
              name: 'POLLER_INTERVAL_MS'
              value: '15000'
            }
            {
              name: 'POLLER_IDLE_INTERVAL_MS'
              value: '60000'
            }
            {
              name: 'POLLER_BATCH_SIZE'
              value: '20'
            }
            {
              name: 'POLLER_LOCK_TTL_MS'
              value: '120000'
            }
            {
              name: 'POLLER_MAX_ATTEMPTS'
              value: '3'
            }
            // Observability
            {
              name: 'ENABLE_TELEMETRY'
              value: 'true'
            }
            // Image allowlist (if provided)
            {
              name: 'IMAGE_ALLOWLIST'
              value: imageAllowlist
            }
          ]
          probes: [
            // Startup probe: Check readiness before marking container as started
            {
              type: 'Startup'
              httpGet: {
                path: '/readyz'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 5
              timeoutSeconds: 30
              failureThreshold: 10
              successThreshold: 1
            }
            // Liveness probe: Restart container if unhealthy
            {
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 30
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
            }
            // Readiness probe: Remove from load balancer if not ready
            {
              type: 'Readiness'
              httpGet: {
                path: '/readyz'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'cpu-scaling'
            custom: {
              type: 'cpu'
              metadata: {
                type: 'Utilization'
                value: '70'
              }
            }
          }
        ]
      }
    }
  }
}

// ============================================================================
// RBAC Role Assignments
// ============================================================================
// Note: Role assignments are created as child resources of the target resources.
// They will be created after the Container App (and its Managed Identity) is ready.

// Reference to existing Key Vault (to create role assignment on it)
resource existingKeyVault 'Microsoft.KeyVault/vaults@2023-02-01' existing = {
  name: split(keyVaultId, '/')[8]  // Extract Key Vault name from resource ID
}

// Grant Container App Managed Identity the "Key Vault Secrets User" role on Key Vault
// TEMPORARILY COMMENTED OUT - Role assignment already exists and was created manually
// resource keyVaultSecretsUserRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
//   name: guid(keyVaultId, containerApp.id, keyVaultSecretsUserRoleId)
//   scope: existingKeyVault
//   properties: {
//     roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
//     principalId: containerApp.identity.principalId
//     principalType: 'ServicePrincipal'
//   }
// }

// Reference to existing Container Registry (to create role assignment on it)
resource existingAcr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' existing = {
  name: split(acrId, '/')[8]  // Extract ACR name from resource ID
}

// Grant Container App Managed Identity the "AcrPull" role on Container Registry
// TEMPORARILY COMMENTED OUT - Role assignment already exists and was created manually
// resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
//   name: guid(acrId, containerApp.id, acrPullRoleId)
//   scope: existingAcr
//   properties: {
//     roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
//     principalId: containerApp.identity.principalId
//     principalType: 'ServicePrincipal'
//   }
// }

// ============================================================================
// Outputs
// ============================================================================

@description('Container App resource ID')
output appId string = containerApp.id

@description('Container App name')
output appName string = containerApp.name

@description('Container App FQDN')
output appFqdn string = containerApp.properties.configuration.ingress.fqdn

@description('Container App Managed Identity principal ID')
output appIdentityPrincipalId string = containerApp.identity.principalId

@description('Container App default URL')
output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
