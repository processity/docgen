# GitHub Secrets Setup Instructions for Staging Deployment

## Overview

This document provides complete instructions for setting up GitHub secrets required for the staging deployment workflow. These secrets are essential for authenticating with Azure services and deploying the Docgen application to Azure Container Apps.

## Problem Resolved

**Issue**: The staging deployment was failing with the error:
```
Login failed with Error: Using auth-type: SERVICE_PRINCIPAL.
Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied.
```

**Root Cause**: The `AZURE_CREDENTIALS` secret was improperly formatted or missing required fields.

**Solution**: All secrets have been updated using the `scripts/update-github-secrets.sh` script with the correct format and values.

## Required GitHub Secrets

All secrets must be configured in the **staging** environment in GitHub repository settings.

### 1. Azure Authentication Secrets

| Secret Name | Value | Description |
|-------------|--------|-------------|
| `AZURE_CREDENTIALS` | JSON object (see below) | Azure service principal credentials for GitHub Actions authentication |
| `AZURE_SUBSCRIPTION_ID` | `e6890ad9-401e-4696-bee4-c50fe72aa287` | Azure subscription ID (POC-EA) |
| `AZURE_TENANT_ID` | `d8353d2a-b153-4d17-8827-902c51f72357` | Azure AD tenant ID |

**AZURE_CREDENTIALS Format** (must be valid JSON):
```json
{
  "clientId": "f42d24be-0a17-4a87-bfc5-d6cd84339302",
  "clientSecret": "<CLIENT_SECRET_FROM_AZURE_AD_CONFIG>",
  "subscriptionId": "e6890ad9-401e-4696-bee4-c50fe72aa287",
  "tenantId": "d8353d2a-b153-4d17-8827-902c51f72357"
}
```

### 2. Azure Resource Names

| Secret Name | Value | Description |
|-------------|--------|-------------|
| `ACR_NAME` | `docgenstaging` | Azure Container Registry name |
| `RESOURCE_GROUP` | `docgen-staging-rg` | Azure resource group name |
| `APP_NAME` | `docgen-staging` | Container app name |
| `KEY_VAULT_NAME` | `docgen-staging-kv` | Azure Key Vault name |

### 3. Salesforce Credentials

| Secret Name | Value | Description |
|-------------|--------|-------------|
| `SF_DOMAIN` | `bigmantra.my.salesforce.com` | Salesforce org domain |
| `SF_USERNAME` | `giri@bigmantra.com` | Salesforce integration user |
| `SF_CLIENT_ID` | `3MVG9DREgiBqN9WljXt5vxSKJbEFrNef6bySvvkrTi_c70O81l_2axMRAhy4u_KVAjxak6BUaUOmDGS0crZXT` | Salesforce connected app client ID |
| `SF_PRIVATE_KEY` | Contents of `keys/server.key` | Private key for JWT Bearer flow (PEM format) |

## Setup Methods

### Method 1: Automated Script (Recommended)

Use the provided script to automatically update all secrets:

```bash
# Make the script executable
chmod +x scripts/update-github-secrets.sh

# Run the script
./scripts/update-github-secrets.sh
```

The script will:
1. Verify GitHub CLI authentication
2. Update all 11 required secrets
3. Verify the secrets were set correctly
4. Optionally trigger the deployment workflow

### Method 2: GitHub CLI Manual Commands

If you prefer to set secrets individually:

```bash
# Set AZURE_CREDENTIALS (most important)
# Note: Replace <CLIENT_SECRET> with actual value from azure-ad-config.md
gh secret set AZURE_CREDENTIALS --env staging -R bigmantra/docgen --body '{
  "clientId": "f42d24be-0a17-4a87-bfc5-d6cd84339302",
  "clientSecret": "<CLIENT_SECRET>",
  "subscriptionId": "e6890ad9-401e-4696-bee4-c50fe72aa287",
  "tenantId": "d8353d2a-b153-4d17-8827-902c51f72357"
}'

# Set other secrets
gh secret set AZURE_SUBSCRIPTION_ID --env staging -R bigmantra/docgen --body "e6890ad9-401e-4696-bee4-c50fe72aa287"
gh secret set AZURE_TENANT_ID --env staging -R bigmantra/docgen --body "d8353d2a-b153-4d17-8827-902c51f72357"
gh secret set ACR_NAME --env staging -R bigmantra/docgen --body "docgenstaging"
gh secret set RESOURCE_GROUP --env staging -R bigmantra/docgen --body "docgen-staging-rg"
gh secret set APP_NAME --env staging -R bigmantra/docgen --body "docgen-staging"
gh secret set KEY_VAULT_NAME --env staging -R bigmantra/docgen --body "docgen-staging-kv"
gh secret set SF_DOMAIN --env staging -R bigmantra/docgen --body "bigmantra.my.salesforce.com"
gh secret set SF_USERNAME --env staging -R bigmantra/docgen --body "giri@bigmantra.com"
gh secret set SF_CLIENT_ID --env staging -R bigmantra/docgen --body "3MVG9DREgiBqN9WljXt5vxSKJbEFrNef6bySvvkrTi_c70O81l_2axMRAhy4u_KVAjxak6BUaUOmDGS0crZXT"

# Set SF_PRIVATE_KEY from file
gh secret set SF_PRIVATE_KEY --env staging -R bigmantra/docgen < keys/server.key
```

### Method 3: GitHub Web UI

1. Navigate to: https://github.com/bigmantra/docgen/settings/environments
2. Select the "staging" environment
3. Click "Add secret" or edit existing secrets
4. Add each secret with the values from the table above
5. For `AZURE_CREDENTIALS`, ensure the JSON is properly formatted (no extra spaces or line breaks)

## Verification

### Check Secrets Are Set

```bash
# List all secrets in staging environment
gh secret list --env staging -R bigmantra/docgen
```

Expected output should show all 11 secrets with recent update timestamps.

### Trigger Deployment

```bash
# Run the deployment workflow
gh workflow run deploy-staging.yml -R bigmantra/docgen

# Watch the deployment progress
gh run watch -R bigmantra/docgen

# Check deployment status
gh run list --workflow=deploy-staging.yml -R bigmantra/docgen
```

## Deployment Workflow Overview

The staging deployment workflow (`deploy-staging.yml`) performs the following jobs:

1. **build-image**: Build and push Docker image to Azure Container Registry
2. **deploy-infrastructure**: Deploy Azure resources using Bicep templates
3. **populate-secrets**: Store Salesforce credentials in Azure Key Vault
4. **update-app**: Deploy the container to Azure Container Apps
5. **smoke-tests**: Run health checks and verify endpoints
6. **rollback**: Rollback on failure (conditional)
7. **summary**: Post deployment summary

## Troubleshooting

### Common Issues and Solutions

1. **Azure login fails**
   - Ensure `AZURE_CREDENTIALS` is valid JSON
   - Verify all 4 required fields are present (clientId, clientSecret, subscriptionId, tenantId)
   - Check that the service principal has appropriate permissions

2. **Docker push fails**
   - Verify ACR_NAME is correct
   - Ensure the service principal has AcrPush permission on the registry

3. **Key Vault access denied**
   - Check that the Container App's managed identity has "Key Vault Secrets User" role
   - Verify KEY_VAULT_NAME is correct

4. **Salesforce authentication fails**
   - Ensure SF_PRIVATE_KEY contains the complete PEM-formatted private key
   - Verify SF_CLIENT_ID matches the connected app in Salesforce
   - Check that SF_USERNAME is the correct integration user

### Verify Azure Service Principal

```bash
# Check service principal exists and has correct permissions
az ad sp show --id ceb8c274-c103-40d3-a9bf-360afc23475f

# Check role assignments
az role assignment list --assignee f42d24be-0a17-4a87-bfc5-d6cd84339302

# Test Azure login locally
az login --service-principal \
  -u f42d24be-0a17-4a87-bfc5-d6cd84339302 \
  -p "<CLIENT_SECRET>" \
  --tenant d8353d2a-b153-4d17-8827-902c51f72357
```

## Security Notes

1. **Never commit secrets to source control**
   - All secrets are stored securely in GitHub's encrypted secret storage
   - The `azure-ad-config.md` file should be added to `.gitignore` in production

2. **Service Principal Security**
   - Client secret expires: 2027-11-06
   - Has Contributor role on resource group only (principle of least privilege)
   - Used only for deployment, not runtime (runtime uses Managed Identity)

3. **Salesforce Security**
   - Private key is stored securely in GitHub secrets and Azure Key Vault
   - JWT Bearer flow provides secure, token-based authentication
   - No passwords are stored or transmitted

## Related Documentation

- [Azure AD Configuration](azure-ad-config.md) - Detailed Azure AD setup information
- [Deployment Workflow](.github/workflows/deploy-staging.yml) - GitHub Actions workflow
- [Infrastructure as Code](infra/main.bicep) - Bicep templates for Azure resources
- [Staging Parameters](infra/parameters/staging.bicepparam) - Environment-specific configuration

## Support

If you encounter issues after following these instructions:

1. Check the GitHub Actions logs for specific error messages
2. Verify all secrets are set correctly using `gh secret list`
3. Ensure the Azure service principal has not expired
4. Review the deployment workflow output for detailed error information

---

**Last Updated**: November 12, 2025
**Status**: All secrets successfully configured and deployment fixed