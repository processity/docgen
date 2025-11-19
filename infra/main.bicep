// ============================================================================
// Main Bicep Template: Salesforce PDF Generation Service
// ============================================================================
// Deploys complete infrastructure for the Salesforce PDF Generation service
// on Azure Container Apps (East US) with monitoring, registry, and secrets.
//
// Resources Created:
//   - Log Analytics Workspace + Application Insights
//   - Azure Container Registry
//   - Azure Key Vault (RBAC-enabled)
//   - Container Apps Environment
//   - Container App (2 vCPU / 4 GB, auto-scaling replicas)
//     - CI: 3-5 replicas, LibreOffice concurrency: 5 (~800MB per conversion)
//     - Staging/Prod: 1-5 replicas, LibreOffice concurrency: 8
//
// Usage:
//   az deployment group create \
//     --resource-group docgen-staging-rg \
//     --template-file infra/main.bicep \
//     --parameters infra/parameters/staging.bicepparam
// ============================================================================

targetScope = 'resourceGroup'

// ============================================================================
// Parameters
// ============================================================================

@description('Environment name (e.g., ci, staging, production)')
@allowed([
  'ci'
  'staging'
  'production'
])
param environment string

@description('Azure region for all resources')
param location string = 'eastus'

@description('Application name')
param appName string

@description('Azure Container Registry name (globally unique, alphanumeric only)')
@minLength(5)
@maxLength(50)
param acrName string

@description('Azure Key Vault name (globally unique, 3-24 chars, alphanumeric and hyphens)')
@minLength(3)
@maxLength(24)
param keyVaultName string

@description('Azure AD tenant ID')
param tenantId string

@description('Azure AD client ID (application ID for OAuth2)')
param clientId string

@description('Container Registry SKU')
@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param acrSku string = 'Basic'

@description('Key Vault SKU')
@allowed([
  'standard'
  'premium'
])
param keyVaultSku string = 'standard'

@description('Container image tag')
param imageTag string = 'latest'

@description('Image allowlist (comma-separated domains for external image validation)')
param imageAllowlist string = ''

@description('Common tags for all resources')
param tags object = {
  Environment: environment
  Project: 'Salesforce-Docgen'
  ManagedBy: 'Bicep'
}

// ============================================================================
// Module 1: Monitoring (Log Analytics + Application Insights)
// ============================================================================

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring-deployment'
  params: {
    environment: environment
    location: location
    tags: tags
  }
}

// ============================================================================
// Module 2: Azure Container Registry
// ============================================================================

// For CI environment, reference existing staging ACR instead of creating new one
module registry './modules/registry.bicep' = if (environment != 'ci') {
  name: 'registry-deployment'
  params: {
    acrName: acrName
    location: location
    sku: acrSku
    tags: tags
  }
}

// Reference existing ACR for CI environment
resource existingAcr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = if (environment == 'ci') {
  name: acrName
  scope: resourceGroup('docgen-staging-rg')
}

// ============================================================================
// Module 3: Azure Key Vault
// ============================================================================

module keyVault './modules/keyvault.bicep' = {
  name: 'keyvault-deployment'
  params: {
    keyVaultName: keyVaultName
    location: location
    tenantId: tenantId
    sku: keyVaultSku
    tags: tags
  }
}

// ============================================================================
// Module 4: Container Apps Environment
// ============================================================================

module containerEnv './modules/environment.bicep' = {
  name: 'environment-deployment'
  params: {
    environment: environment
    location: location
    workspaceId: monitoring.outputs.workspaceId
    workspaceCustomerId: monitoring.outputs.workspaceCustomerId
    tags: tags
  }
}

// ============================================================================
// Module 5: Container App
// ============================================================================

module containerApp './modules/app.bicep' = {
  name: 'app-deployment'
  params: {
    appName: appName
    location: location
    environmentId: containerEnv.outputs.environmentId
    acrLoginServer: environment == 'ci' ? existingAcr.properties.loginServer : registry.outputs.acrLoginServer
    acrId: environment == 'ci' ? existingAcr.id : registry.outputs.acrId
    imageTag: imageTag
    keyVaultUri: keyVault.outputs.keyVaultUri
    keyVaultId: keyVault.outputs.keyVaultId
    tenantId: tenantId
    clientId: clientId
    imageAllowlist: imageAllowlist
    tags: tags
    // Environment-specific resource allocation
    cpuCores: '2.0'
    memorySize: '4Gi'
    minReplicas: environment == 'ci' ? 3 : 1
    maxReplicas: environment == 'ci' ? 5 : 5
    // Reduce LibreOffice concurrency to give more memory per conversion
    libreOfficeMaxConcurrent: environment == 'ci' ? '5' : '8'
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Container App FQDN')
output appFqdn string = containerApp.outputs.appFqdn

@description('Container App URL')
output appUrl string = containerApp.outputs.appUrl

@description('Container App Managed Identity principal ID')
output appIdentityPrincipalId string = containerApp.outputs.appIdentityPrincipalId

@description('Key Vault URI')
output keyVaultUri string = keyVault.outputs.keyVaultUri

@description('Key Vault name')
output keyVaultName string = keyVault.outputs.keyVaultName

@description('Container Registry login server')
output acrLoginServer string = environment == 'ci' ? existingAcr.properties.loginServer : registry.outputs.acrLoginServer

@description('Container Registry name')
output acrName string = environment == 'ci' ? existingAcr.name : registry.outputs.acrName

@description('Application Insights connection string')
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString

@description('Application Insights instrumentation key')
output appInsightsInstrumentationKey string = monitoring.outputs.appInsightsInstrumentationKey

@description('Log Analytics Workspace resource ID')
output workspaceId string = monitoring.outputs.workspaceId

@description('Log Analytics Workspace name')
output workspaceName string = monitoring.outputs.workspaceName
