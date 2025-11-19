// ============================================================================
// Bicep Parameters File: CI/Test Environment
// ============================================================================
// Parameter values for deploying to the CI/test environment for e2e testing
//
// Purpose:
//   - Dedicated backend for ephemeral scratch org e2e tests in GitHub Actions
//   - Standard sizing (2 vCPU, 4GB RAM) with autoscaling up to 5 replicas
//   - Reduced LibreOffice concurrency (4 vs 8) for more memory per conversion
//   - Uses test Salesforce credentials and AAD app registration
//
// Usage:
//   az deployment group create \
//     --resource-group docgen-ci-rg \
//     --template-file infra/main.bicep \
//     --parameters infra/parameters/ci.bicepparam
//
// Estimated Cost: ~$80-150/month when running (scale to 0 when inactive)
// ============================================================================

using '../main.bicep'

// ============================================================================
// Environment Configuration
// ============================================================================

param environment = 'ci'
param location = 'eastus'
param appName = 'docgen-ci'

// ============================================================================
// Azure Resource Names
// ============================================================================

// Reuse existing ACR from staging (no need for separate CI registry)
// Note: This assumes staging ACR exists and CI has access
param acrName = 'docgenstaging'

param keyVaultName = 'docgen-ci-kv'

// ============================================================================
// Azure AD Configuration
// ============================================================================

// Using same AAD tenant and client as staging
// (CI will use same AAD app registration for authentication)
param tenantId = 'd8353d2a-b153-4d17-8827-902c51f72357'
param clientId = 'f42d24be-0a17-4a87-bfc5-d6cd84339302'

// ============================================================================
// SKU Configuration (Cost-Optimized for CI)
// ============================================================================

// Reusing staging ACR, but specifying Basic for documentation
param acrSku = 'Basic'

// Standard Key Vault for CI secrets
param keyVaultSku = 'standard'

// ============================================================================
// Application Configuration
// ============================================================================

// CI will use same image as staging but may tag differently
param imageTag = 'ci-latest'

// Empty allowlist for CI (tests should use base64 images)
param imageAllowlist = ''

// ============================================================================
// Tags
// ============================================================================

param tags = {
  Environment: 'ci'
  Project: 'Salesforce-Docgen'
  ManagedBy: 'Bicep'
  Purpose: 'E2E-Testing'
  CostCenter: 'POC-EA'
  AutoDelete: 'false'  // Keep running for CI tests
}

// ============================================================================
// CI-Specific Notes
// ============================================================================

// Container App Sizing (configured in main.bicep):
//   - CPU: 2.0 vCPU (standard Azure Container Apps limit)
//   - Memory: 4 GB
//   - Min Replicas: 3 (always-on for reliability during tests)
//   - Max Replicas: 5 (autoscaling enabled on HTTP requests)
//   - LibreOffice Concurrency: 5 (vs 8 in staging/prod)
//
// Rationale:
//   - LibreOffice requires significant CPU/memory per conversion
//   - Moderate concurrency (5) provides ~800MB RAM per conversion
//   - Unique temp dirs and user profiles prevent file conflicts during concurrent runs
//   - 3 min replicas ensures 3×5=15 concurrent conversions always available
//   - Autoscaling to 5 replicas allows handling 5×5=25 concurrent conversions under peak load
//   - Cost is managed by only running CI backend during active development
//
// Secrets in CI Key Vault (Two Authentication Options):
//
// Option 1: JWT Bearer Flow (Traditional)
//   - SF-PRIVATE-KEY (test/CI Integration User private key)
//   - SF-CLIENT-ID (Connected App for CI)
//   - SF-USERNAME (CI Integration User, e.g., ci-integration@yourorg.com)
//   - SF-DOMAIN (scratch org domain - needs dynamic update per test)
//
// Option 2: SFDX Auth URL (Recommended for Scratch Orgs)
//   - SFDX-AUTH-URL (Complete auth URL from sf CLI)
//     Get via: sf org display --verbose --json | jq -r '.result.sfdxAuthUrl'
//     Format: force://<clientId>:<clientSecret>:<refreshToken>@<instanceUrl>
//     Benefits: Single secret, no Connected App needed, simpler setup
//
// Common:
//   - AZURE-MONITOR-CONNECTION-STRING (App Insights for CI environment)
