# Docgen Environment Provisioning Guide

This guide covers the **one-time manual setup** required to provision a new docgen environment (staging or production) in Azure.

## Overview

The docgen application uses an automated CI/CD pipeline (GitHub Actions) for routine deployments. However, the **initial setup** of a new environment requires manual provisioning steps. This guide documents those steps.

## When to Use This Guide

Use this guide when:
- ✅ Setting up the **production environment** for the first time (new Azure subscription)
- ✅ Creating a new staging environment in a different subscription
- ✅ Recovering from a complete environment deletion
- ✅ Setting up a disaster recovery environment

**Do NOT use this for**:
- ❌ Routine application deployments (use GitHub Actions workflows)
- ❌ Updating application code (automatic via CI/CD)
- ❌ Updating infrastructure configuration (use Bicep parameter files + CI/CD)

---

## Prerequisites

Before starting, ensure you have:

### 1. Azure Access
- **Azure CLI** installed ([Install Guide](https://docs.microsoft.com/cli/azure/install-azure-cli))
- **Azure subscription** with appropriate permissions:
  - `Contributor` role on the subscription
  - Ability to create resource groups
  - Ability to create Service Principals (for CI/CD)
  - Ability to assign RBAC roles

### 2. Local Tools
- **Docker Desktop** installed ([Install Guide](https://docs.docker.com/get-docker/))
- **Git** installed
- **Node.js 20+** (for local testing only)

### 3. Salesforce Configuration
- Salesforce org with Connected App configured
- Private key file (`keys/server.key`)
- `.env` file with Salesforce credentials:
  ```bash
  SF_DOMAIN=your-domain.my.salesforce.com
  SF_USERNAME=your-username@domain.com
  SF_CLIENT_ID=3MVG9...your-client-id
  ```

### 4. GitHub Configuration (for CI/CD automation)
- GitHub repository access
- GitHub CLI installed (optional, for secrets management)
- Service Principal credentials for Azure authentication

---

## Provisioning Methods

There are two ways to provision a new environment:

### Method 1: Automated Script (Recommended)

Use the `provision-environment.sh` script for a guided, automated setup:

```bash
# Make script executable
chmod +x scripts/provision-environment.sh

# Run for staging
./scripts/provision-environment.sh staging

# Run for production
./scripts/provision-environment.sh production
```

**What the script does:**
1. ✅ Validates prerequisites (Azure CLI, Docker, files)
2. ✅ Creates resource group with required tags
3. ✅ Deploys infrastructure via Bicep (10-15 min)
4. ✅ Assigns RBAC roles to Managed Identity
5. ✅ Populates Key Vault with secrets
6. ✅ Builds and pushes Docker image to ACR
7. ✅ Updates Container App with initial image
8. ✅ Runs validation tests

**Time estimate:** 25-35 minutes

### Method 2: Manual Step-by-Step

Follow the manual steps below if you need more control or if the script fails.

---

## Manual Provisioning Steps

### Step 1: Login to Azure CLI

```bash
# Login
az login

# List subscriptions
az account list --output table

# Set the correct subscription
az account set --subscription "Your-Subscription-Name"

# Verify
az account show
```

### Step 2: Set Environment Variables

```bash
# For staging
export ENVIRONMENT="staging"
export RESOURCE_GROUP="docgen-staging-rg"
export LOCATION="eastus"
export ACR_NAME="docgenstaging"
export KEY_VAULT_NAME="docgen-staging-kv"
export APP_NAME="docgen-staging"
export BICEP_PARAMS="infra/parameters/staging.bicepparam"

# For production
export ENVIRONMENT="production"
export RESOURCE_GROUP="docgen-production-rg"
export LOCATION="eastus"
export ACR_NAME="docgenproduction"
export KEY_VAULT_NAME="docgen-production-kv"
export APP_NAME="docgen-production"
export BICEP_PARAMS="infra/parameters/production.bicepparam"
```

### Step 3: Create Resource Group

```bash
# Get your email for Owner tag
USER_EMAIL=$(az account show --query user.name -o tsv)

# Create resource group with required tags
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags Owner="$USER_EMAIL" Project="Personal Sandbox"

# Verify
az group show --name "$RESOURCE_GROUP"
```

**Important:** Azure policies may require specific tags (Owner, Project). Adjust as needed for your organization.

### Step 4: Deploy Infrastructure via Bicep

```bash
# Deploy infrastructure (takes 10-15 minutes)
az deployment group create \
  --name "initial-deployment-$(date +%Y%m%d-%H%M%S)" \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters "$BICEP_PARAMS"

# Check deployment status
az deployment group list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[0].{name:name, state:properties.provisioningState, duration:properties.duration}"
```

**Resources created:**
- Log Analytics Workspace
- Application Insights
- Azure Container Registry (ACR)
- Azure Key Vault
- Container Apps Environment
- Container App
- System-assigned Managed Identity

### Step 5: Capture Deployment Outputs

```bash
# Get Key Vault URI
KEY_VAULT_URI=$(az keyvault show \
  --name "$KEY_VAULT_NAME" \
  --query properties.vaultUri -o tsv)
echo "Key Vault URI: $KEY_VAULT_URI"

# Get Application Insights connection string
APP_INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
  --app "docgen-${ENVIRONMENT}-insights" \
  --resource-group "$RESOURCE_GROUP" \
  --query connectionString -o tsv)
echo "App Insights: ${APP_INSIGHTS_CONNECTION_STRING:0:50}..."

# Get Managed Identity Principal ID
MANAGED_IDENTITY_ID=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query identity.principalId -o tsv)
echo "Managed Identity: $MANAGED_IDENTITY_ID"
```

### Step 6: Assign RBAC Roles (Workaround)

**Note:** Bicep templates should handle this automatically, but role propagation can be delayed. We assign roles manually to ensure immediate access.

```bash
# Wait for managed identity to propagate
sleep 30

# Assign AcrPull role (for pulling Docker images)
az role assignment create \
  --role "AcrPull" \
  --assignee "$MANAGED_IDENTITY_ID" \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

# Assign Key Vault Secrets User role (for reading secrets)
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee "$MANAGED_IDENTITY_ID" \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEY_VAULT_NAME"

# Assign Key Vault Secrets Officer role to yourself (for writing secrets)
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee "$(az account show --query user.name -o tsv)" \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEY_VAULT_NAME"

# Wait for role assignments to propagate
sleep 30
```

### Step 7: Populate Key Vault Secrets

```bash
# Load Salesforce credentials from .env
source .env

# Set SF-PRIVATE-KEY (from file)
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name SF-PRIVATE-KEY \
  --file keys/server.key

# Set SF-CLIENT-ID
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name SF-CLIENT-ID \
  --value "$SF_CLIENT_ID"

# Set SF-USERNAME
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name SF-USERNAME \
  --value "$SF_USERNAME"

# Set SF-DOMAIN
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name SF-DOMAIN \
  --value "$SF_DOMAIN"

# Set AZURE-MONITOR-CONNECTION-STRING
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name AZURE-MONITOR-CONNECTION-STRING \
  --value "$APP_INSIGHTS_CONNECTION_STRING"

# Verify all secrets
az keyvault secret list --vault-name "$KEY_VAULT_NAME" --query "[].name" -o table
```

### Step 8: Build and Push Docker Image

```bash
# Login to ACR
az acr login --name "$ACR_NAME"

# Build image for linux/amd64 platform (important!)
docker build --platform linux/amd64 \
  -t "$ACR_NAME.azurecr.io/docgen-api:initial" \
  -t "$ACR_NAME.azurecr.io/docgen-api:latest" \
  .

# Push images
docker push "$ACR_NAME.azurecr.io/docgen-api:initial"
docker push "$ACR_NAME.azurecr.io/docgen-api:latest"

# Verify in ACR
az acr repository list --name "$ACR_NAME"
az acr repository show-tags --name "$ACR_NAME" --repository docgen-api
```

**Note:** Building for `linux/amd64` is critical for Azure Container Apps compatibility. On Apple Silicon Macs, Docker will use emulation.

### Step 9: Update Container App

```bash
# Update Container App with initial image
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$ACR_NAME.azurecr.io/docgen-api:initial"

# Check revision status
az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].{name:name, active:properties.active, createdTime:properties.createdTime}" \
  -o table
```

### Step 10: Validation

```bash
# Get app URL
APP_FQDN=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo "Application URL: https://$APP_FQDN"

# Test health endpoint
curl https://$APP_FQDN/healthz

# Test readiness endpoint
curl https://$APP_FQDN/readyz

# View container logs
az containerapp logs show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --tail 50 \
  --follow
```

**Expected results:**
- ✅ `/healthz` returns HTTP 200
- ✅ `/readyz` returns `{"ready":true,"checks":{"jwks":true,"salesforce":true,"keyVault":true}}`
- ✅ Container logs show no errors
- ✅ Application starts within 30 seconds

---

## Post-Provisioning: GitHub CI/CD Setup

After manual provisioning, configure GitHub for automated deployments:

### 1. Create GitHub Environment

```bash
# Using GitHub CLI
gh auth login

# Create environment (staging or production)
gh api repos/OWNER/REPO/environments/$ENVIRONMENT -X PUT
```

### 2. Configure GitHub Secrets

For each environment, add these secrets:

```bash
# Azure credentials
SF_DOMAIN=your-domain.my.salesforce.com
SF_USERNAME=your-username@domain.com
SF_CLIENT_ID=3MVG9...
SF_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...

# Azure authentication
AZURE_TENANT_ID=d8353d2a-...
AZURE_SUBSCRIPTION_ID=e6890ad9-...
AZURE_CREDENTIALS={"clientId":"...","clientSecret":"...","subscriptionId":"...","tenantId":"..."}

# Azure resources
ACR_NAME=docgenstaging
RESOURCE_GROUP=docgen-staging-rg
KEY_VAULT_NAME=docgen-staging-kv
APP_NAME=docgen-staging
```

### 3. Test Automated Deployment

```bash
# For staging: merge to main branch
git checkout main
git pull
git merge feature/your-feature
git push

# For production: create GitHub release
gh release create v1.0.0 --title "Release 1.0.0" --notes "Initial production release"
```

Monitor the workflow in GitHub Actions.

---

## Troubleshooting

### Issue: Role Assignment Propagation

**Problem:** Container App can't pull from ACR or access Key Vault immediately after deployment.

**Solution:**
```bash
# Wait 60 seconds and manually assign roles
sleep 60
az role assignment create --role "AcrPull" --assignee "$MANAGED_IDENTITY_ID" --scope "$ACR_ID"
az role assignment create --role "Key Vault Secrets User" --assignee "$MANAGED_IDENTITY_ID" --scope "$KEY_VAULT_ID"
```

### Issue: Docker Platform Mismatch

**Problem:** Container App fails with "no matching manifest for platform" error.

**Solution:**
Always build for `linux/amd64`:
```bash
docker build --platform linux/amd64 -t ...
```

### Issue: Azure Policy Violations

**Problem:** Resource group creation fails due to missing tags.

**Solution:**
Check required tags for your organization:
```bash
# Common tags
--tags Owner="user@email.com" Project="ProjectName" CostCenter="12345" Environment="Production"
```

### Issue: Key Vault Access Denied

**Problem:** Can't set secrets in Key Vault.

**Solution:**
Assign yourself the "Key Vault Secrets Officer" role:
```bash
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee "$(az account show --query user.name -o tsv)" \
  --scope "/subscriptions/.../resourceGroups/.../providers/Microsoft.KeyVault/vaults/$KEY_VAULT_NAME"
```

### Issue: Container Won't Start

**Problem:** Container App shows "ProvisioningFailed" or revision won't activate.

**Diagnosis:**
```bash
# Check container logs
az containerapp logs show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --tail 100

# Check revision details
az containerapp revision list --name "$APP_NAME" --resource-group "$RESOURCE_GROUP"

# Check system logs
az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query properties
```

**Common causes:**
- Missing Key Vault secrets
- Incorrect RBAC roles
- Image not found in ACR
- Health probe failing

---

## Cost Estimates

### Monthly Cost Breakdown

Approximate costs for a **single environment** (staging or production):

| Resource | SKU/Size | Unit Cost | Staging | Production | Notes |
|----------|----------|-----------|---------|------------|-------|
| **Container Apps** | 2 vCPU, 4 GB RAM | ~$0.000024/vCPU-sec | $50-80 | $100-200 | Varies by replica count and runtime |
| **Container Registry** | Basic/Standard | Fixed | $5 | $10 | Basic for staging, Standard for production |
| **Key Vault** | Standard | Operations-based | $1 | $1 | ~1,000 operations/month |
| **Application Insights** | Pay-as-you-go | GB ingested | $10-30 | $20-50 | Depends on telemetry volume |
| **Log Analytics** | Pay-as-you-go | GB ingested | $5-15 | $10-25 | Depends on log volume |
| **Egress (Data Transfer)** | Pay-as-you-go | GB transferred | $5-10 | $10-20 | Salesforce API calls, file downloads |
| **Total (1 replica)** | | | **$76-141** | **$151-306** | At minimum scale |
| **Total (avg 3 replicas)** | | | **$150-240** | **$250-400** | During moderate load |
| **Total (max 5 replicas)** | | | **$250-400** | **$400-600** | During peak load |

### Cost by Environment

#### Staging Environment
- **Expected usage**: Low to moderate (development, testing, demos)
- **Typical replica count**: 1-2 replicas (80% of time)
- **Peak replica count**: 3-4 replicas (20% of time, during testing)
- **Estimated monthly cost**: **$80-150/month**

#### Production Environment
- **Expected usage**: Moderate to high (live user traffic)
- **Typical replica count**: 2-3 replicas (70% of time)
- **Peak replica count**: 4-5 replicas (30% of time, during business hours)
- **Estimated monthly cost**: **$150-300/month** (can reach $400-600 during sustained high load)

### Scaling Cost Impact

Container Apps costs scale **linearly** with replica count and runtime:

| Replica Count | vCPU-seconds/month | Approximate Cost | Use Case |
|---------------|-------------------|------------------|----------|
| **1 replica** | 5,184,000 | $50-80/month | Baseline, off-peak hours |
| **2 replicas** | 10,368,000 | $100-160/month | Moderate load |
| **3 replicas** | 15,552,000 | $150-240/month | High load, business hours |
| **4 replicas** | 20,736,000 | $200-320/month | Peak load |
| **5 replicas** | 25,920,000 | $250-400/month | Maximum scale |

**Formula**: Monthly cost ≈ (vCPU-seconds × $0.000024) + (GB-seconds × $0.000003)

**Example calculation** for 3 replicas running 24/7:
- vCPU-seconds: 2 vCPU × 3 replicas × 2,592,000 seconds/month = 15,552,000
- Cost: 15,552,000 × $0.000024 = **$373.25/month** (Container Apps only)

### Cost Optimization Strategies

#### 1. Autoscaling Configuration

**Default**: 1-5 replicas, CPU >70% threshold
```bicep
scale: {
  minReplicas: 1  // Low baseline cost
  maxReplicas: 5  // Handle peak load
  rules: [
    {
      name: 'cpu-scaling'
      custom: {
        type: 'cpu'
        metadata: {
          type: 'Utilization'
          value: '70'  // Scale at 70% CPU
        }
      }
    }
  ]
}
```

**Optimized for cost** (staging):
```bicep
scale: {
  minReplicas: 1  // Single replica during off-peak
  maxReplicas: 3  // Lower max to control costs
  rules: [
    {
      name: 'cpu-scaling'
      custom: {
        type: 'cpu'
        metadata: {
          type: 'Utilization'
          value: '75'  // Higher threshold = less aggressive scaling
        }
      }
    }
  ]
}
```

**Savings**: ~30-40% reduction in compute costs by limiting max replicas

#### 2. Container Registry Optimization

**SKU Comparison**:
- **Basic**: $5/month, 10 GB storage, 10 webhooks
- **Standard**: $20/month, 100 GB storage, 100 webhooks
- **Premium**: $500/month, 500 GB storage, 500 webhooks, geo-replication

**Recommendation**:
- **Staging**: Basic SKU ($5/month) - sufficient for development
- **Production**: Standard SKU ($20/month) - better performance and reliability

**Savings**: Use Basic for non-production = **$15/month saved** per environment

#### 3. Log Retention & Sampling

**Default**: 30-day retention, 100% sampling
```bicep
retentionInDays: 30  // Default
```

**Optimized** (staging):
```bicep
retentionInDays: 7   // 1 week for staging (reduce by 75%)
```

**Application Insights sampling** (reduce telemetry volume):
```typescript
// In src/obs/insights.ts
export const initializeAppInsights = async (config: AppConfig) => {
  const azureMonitorOptions = {
    samplingRatio: 0.5,  // 50% sampling = 50% cost reduction
    // OR adaptive sampling
    enableAutoCollectDependencies: true,
    enableAutoCollectExceptions: true,
  };
};
```

**Savings**: 7-day retention + 50% sampling = **$15-30/month saved** on telemetry

#### 4. Scheduled Scaling (Production Only)

For production with predictable load patterns:

**Scale down during off-hours** (requires Azure Logic App or Function):
- **Business hours** (8 AM - 6 PM): 2-5 replicas
- **Off-hours** (6 PM - 8 AM): 1-2 replicas
- **Weekends**: 1 replica

**Savings**: ~40% reduction in compute costs = **$60-100/month saved**

#### 5. Resource Sizing Optimization

**Current**: 2 vCPU / 4 GB RAM per replica
**Alternative for staging**: 1 vCPU / 2 GB RAM

**Trade-offs**:
- **Pro**: 50% cost reduction (~$25-40/month saved)
- **Con**: Lower throughput, longer conversion times, may not handle peaks

**Recommendation**: Keep current sizing (2 vCPU / 4 GB) for predictable performance

#### 6. Egress Cost Reduction

**Minimize data transfer**:
- Use Application Insights sampling (reduces telemetry upload)
- Cache Salesforce responses aggressively (template cache already implemented)
- Compress logs before shipping (configure in Log Analytics)

**Estimated savings**: $5-10/month

### Cost Monitoring & Alerts

#### Azure Cost Management

**Set up budget alerts**:
```bash
# Create budget (via Azure Portal or CLI)
az consumption budget create \
  --budget-name "docgen-staging-budget" \
  --resource-group "docgen-staging-rg" \
  --amount 150 \
  --time-grain Monthly \
  --time-period 2025-01-01/2026-12-31

# Configure alert at 80% of budget
# (Alert via email when spending reaches $120)
```

**Monitor cost trends**:
1. Azure Portal → Cost Management → Cost Analysis
2. Group by: Resource (identify expensive resources)
3. Filter by: Resource Group (`docgen-staging-rg`)
4. Review monthly trends and anomalies

#### KQL Query for Cost Attribution

```kusto
// Application Insights ingestion cost tracking
union withsource=SourceTable *
| where TimeGenerated > ago(30d)
| summarize DataVolumeMB = sum(_BilledSize) / 1024 / 1024 by SourceTable
| extend EstimatedCostUSD = DataVolumeMB * 2.30 / 1000  // $2.30/GB
| order by DataVolumeMB desc
| project SourceTable, DataVolumeMB, EstimatedCostUSD
```

#### Cost Anomaly Detection

**Alert on unexpected cost spikes**:
- Replica count stuck at max (autoscaling issue)
- High telemetry ingestion (logging too verbose)
- Egress spike (large file downloads)

**Remediation**:
- Check autoscaling configuration
- Review logging levels
- Investigate traffic patterns

### Annual Cost Projection

Based on typical usage patterns:

| Scenario | Monthly Cost | Annual Cost | Notes |
|----------|-------------|-------------|-------|
| **Staging (optimized)** | $80-120 | $960-1,440 | 1-2 replicas avg, Basic ACR, 7-day retention |
| **Staging (unoptimized)** | $150-250 | $1,800-3,000 | 3-4 replicas avg, Standard ACR, 30-day retention |
| **Production (optimized)** | $150-250 | $1,800-3,000 | 2-3 replicas avg, scheduled scaling |
| **Production (unoptimized)** | $300-500 | $3,600-6,000 | 4-5 replicas avg, no optimization |
| **Both Environments (optimized)** | $230-370 | $2,760-4,440 | Best case with all optimizations |
| **Both Environments (unoptimized)** | $450-750 | $5,400-9,000 | Worst case without optimization |

**Recommendation**: Implement optimization strategies to stay in **$230-370/month** range (**$2,760-4,440/year**) for both staging and production.

### Reserved Instances & Commitments

Azure Container Apps does not currently support reserved instances. For long-term cost savings:
- **Monitor Azure announcements** for reserved capacity options
- **Consider Azure Hybrid Benefit** if applicable (Windows Server licenses)
- **Evaluate Azure Dev/Test pricing** for non-production environments (if eligible)

### Cost Comparison with Alternatives

| Platform | Monthly Cost (2 vCPU, 4 GB) | Notes |
|----------|---------------------------|-------|
| **Azure Container Apps** | $50-80/instance | Current choice, serverless |
| **Azure Container Instances** | $30-50/instance | Lower cost, but no autoscaling |
| **Azure App Service (Linux)** | $55-75/instance | Similar cost, different features |
| **Azure Kubernetes Service** | $70-100/node + $73/cluster | Higher baseline, more complexity |
| **Azure Functions Premium** | $80-120/plan | Serverless, higher cold start |

**Conclusion**: Azure Container Apps offers the best balance of cost, scalability, and operational simplicity for this workload.

---

## Cost Optimization Checklist

- [✓] **Staging**: Use Basic ACR SKU ($5 vs $20)
- [✓] **Autoscaling**: Configure 1-5 replicas with CPU >70% threshold
- [ ] **Staging**: Reduce log retention to 7 days (from 30 days)
- [ ] **Both**: Enable Application Insights sampling (50%)
- [ ] **Production**: Implement scheduled scaling (off-hours scale-down)
- [ ] **Both**: Set up budget alerts ($150 staging, $300 production)
- [ ] **Monitor**: Review monthly cost trends in Azure Cost Management
- [ ] **Review**: Quarterly cost review and optimization assessment

**Estimated total savings**: **$60-120/month** (30-40% reduction)

---

## Cleanup

To completely remove an environment:

```bash
# Delete resource group (deletes all resources)
az group delete --name "$RESOURCE_GROUP" --yes --no-wait

# Verify deletion
az group list --query "[?name=='$RESOURCE_GROUP']"
```

**Warning:** This is irreversible. All data, logs, and configuration will be lost.

---

## Next Steps

After successful provisioning:

1. ✅ Test health and readiness endpoints
2. ✅ Deploy Lightning Web Component to Salesforce
3. ✅ Test end-to-end PDF generation
4. ✅ Test batch processing
5. ✅ Configure Application Insights alerts
6. ✅ Set up monitoring dashboard
7. ✅ Test CI/CD pipeline
8. ✅ Document environment-specific configuration
9. ✅ Create runbook for common operations
10. ✅ Train team on deployment process

---

## References

- [Azure Container Apps Documentation](https://learn.microsoft.com/azure/container-apps/)
- [Azure Bicep Documentation](https://learn.microsoft.com/azure/azure-resource-manager/bicep/)
- [Azure Key Vault RBAC](https://learn.microsoft.com/azure/key-vault/general/rbac-guide)
- [Docker Multi-platform Builds](https://docs.docker.com/build/building/multi-platform/)
- [GitHub Actions for Azure](https://github.com/Azure/actions)

---

## Support

For issues or questions:
- Check troubleshooting section above
- Review container logs: `az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow`
- Review Application Insights in Azure Portal
- Check GitHub Actions workflow logs
- Contact: [Your contact information]
