// ============================================================================
// Bicep Parameters File: Production Environment
// ============================================================================
// Parameter values for deploying to the production environment (future subscription)
//
// Usage:
//   az deployment group create \
//     --resource-group docgen-production-rg \
//     --template-file infra/main.bicep \
//     --parameters infra/parameters/production.bicepparam
// ============================================================================

using '../main.bicep'

// ============================================================================
// Environment Configuration
// ============================================================================

param environment = 'production'
param location = 'eastus'
param appName = 'docgen-production'

// ============================================================================
// Azure Resource Names
// ============================================================================

param acrName = 'docgenproduction'
param keyVaultName = 'docgen-prod-kv-gl'

// ============================================================================
// Azure AD Configuration
// ============================================================================

// Replace with your actual tenant ID and client ID
param tenantId = 'd8353d2a-b153-4d17-8827-902c51f72357'
param clientId = 'f42d24be-0a17-4a87-bfc5-d6cd84339302'

// ============================================================================
// SKU Configuration
// ============================================================================

// Consider upgrading SKUs for production
param acrSku = 'Standard'  // Upgrade from Basic for better performance
param keyVaultSku = 'standard'

// ============================================================================
// Application Configuration
// ============================================================================

param imageTag = 'latest'
param imageAllowlist = ''

// ============================================================================
// Tags
// ============================================================================

param tags = {
  Environment: 'production'
  Project: 'Salesforce-Docgen'
  ManagedBy: 'Bicep'
  CostCenter: 'TBD'  // Update when production subscription is configured
}
