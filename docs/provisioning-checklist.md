# Environment Provisioning Checklist

Quick reference checklist for provisioning a new docgen environment.

## Pre-Provisioning Checklist

- [ ] Azure CLI installed and authenticated
- [ ] Docker Desktop installed and running
- [ ] Correct Azure subscription selected
- [ ] Service Principal created (for CI/CD)
- [ ] Salesforce Connected App configured
- [ ] Private key file available (`keys/server.key`)
- [ ] `.env` file with Salesforce credentials
- [ ] Bicep parameter file reviewed (`infra/parameters/staging.bicepparam` or `production.bicepparam`)
- [ ] Required Azure policy tags identified (Owner, Project, etc.)

## Automated Provisioning (Recommended)

```bash
# Run the automated script
./scripts/provision-environment.sh <staging|production>
```

**Time:** 25-35 minutes

## Manual Provisioning Steps

If using manual provisioning, follow these steps:

### 1. Azure Login & Configuration
- [ ] Login to Azure CLI: `az login`
- [ ] Set subscription: `az account set --subscription "..."`
- [ ] Export environment variables
- [ ] Verify access and permissions

### 2. Resource Group Creation
- [ ] Get user email for Owner tag
- [ ] Create resource group with tags:
  ```bash
  az group create --name docgen-<env>-rg --location eastus \
    --tags Owner="email@domain.com" Project="Personal Sandbox"
  ```
- [ ] Verify resource group created

### 3. Infrastructure Deployment (10-15 min)
- [ ] Deploy Bicep templates:
  ```bash
  az deployment group create \
    --resource-group docgen-<env>-rg \
    --template-file infra/main.bicep \
    --parameters infra/parameters/<env>.bicepparam
  ```
- [ ] Wait for deployment completion
- [ ] Verify all 7 resources created
- [ ] Capture deployment outputs (Key Vault URI, App Insights connection string, Managed Identity ID)

### 4. RBAC Role Assignments
- [ ] Wait 30 seconds for managed identity propagation
- [ ] Assign AcrPull role to Managed Identity
- [ ] Assign Key Vault Secrets User role to Managed Identity
- [ ] Assign Key Vault Secrets Officer role to yourself
- [ ] Wait 30 seconds for role propagation

### 5. Key Vault Secret Population
- [ ] Set `SF-PRIVATE-KEY` (from keys/server.key)
- [ ] Set `SF-CLIENT-ID` (from .env)
- [ ] Set `SF-USERNAME` (from .env)
- [ ] Set `SF-DOMAIN` (from .env)
- [ ] Set `AZURE-MONITOR-CONNECTION-STRING` (from deployment output)
- [ ] Verify all 5 secrets exist

### 6. Docker Image Build & Push (5-10 min)
- [ ] Login to ACR: `az acr login --name docgen<env>`
- [ ] Build image with `--platform linux/amd64`:
  ```bash
  docker build --platform linux/amd64 \
    -t docgen<env>.azurecr.io/docgen-api:initial \
    -t docgen<env>.azurecr.io/docgen-api:latest .
  ```
- [ ] Push both tags to ACR
- [ ] Verify image in ACR

### 7. Container App Update
- [ ] Update Container App with initial image:
  ```bash
  az containerapp update \
    --name docgen-<env> \
    --resource-group docgen-<env>-rg \
    --image docgen<env>.azurecr.io/docgen-api:initial
  ```
- [ ] Wait for revision activation
- [ ] Verify active revision status

### 8. Validation Tests
- [ ] Get app URL
- [ ] Test `/healthz` endpoint (expect HTTP 200)
- [ ] Test `/readyz` endpoint (expect `{"ready":true,"checks":{...}}`)
- [ ] Check container logs for errors
- [ ] Verify Key Vault connection in logs
- [ ] Verify Salesforce authentication in logs
- [ ] Wait 5 minutes and test again for stability

## Post-Provisioning: GitHub CI/CD Setup

### GitHub Environment Configuration
- [ ] Create GitHub environment (`staging` or `production`)
- [ ] Add environment protection rules (for production)
- [ ] Configure required reviewers (for production)

### GitHub Secrets Configuration
Add these secrets to the GitHub environment:

**Salesforce:**
- [ ] `SF_DOMAIN`
- [ ] `SF_USERNAME`
- [ ] `SF_CLIENT_ID`
- [ ] `SF_PRIVATE_KEY`

**Azure Authentication:**
- [ ] `AZURE_TENANT_ID`
- [ ] `AZURE_SUBSCRIPTION_ID`
- [ ] `AZURE_CREDENTIALS` (Service Principal JSON)

**Azure Resources:**
- [ ] `ACR_NAME`
- [ ] `RESOURCE_GROUP`
- [ ] `KEY_VAULT_NAME`
- [ ] `APP_NAME`

### Test CI/CD Pipeline
- [ ] For staging: Create PR → merge to main → verify workflow
- [ ] For production: Create GitHub release → verify workflow
- [ ] Monitor workflow execution in GitHub Actions
- [ ] Verify successful deployment
- [ ] Test rollback procedure

## Final Verification

- [ ] Application health check passing
- [ ] Application readiness check passing
- [ ] No errors in container logs
- [ ] Key Vault integration working
- [ ] Salesforce authentication working
- [ ] Application Insights receiving telemetry
- [ ] Logs flowing to Log Analytics
- [ ] Autoscaling configured correctly (1-5 replicas)
- [ ] Health probes configured correctly
- [ ] CI/CD pipeline working end-to-end

## Documentation Updates

- [ ] Update environment-specific documentation
- [ ] Document any custom configuration
- [ ] Document environment URL
- [ ] Update team wiki/knowledge base
- [ ] Create monitoring dashboard
- [ ] Configure alerts in Application Insights
- [ ] Document troubleshooting procedures
- [ ] Train team on deployment process

## Cost Optimization

- [ ] Review resource SKUs (Basic vs Standard)
- [ ] Configure log retention policies
- [ ] Set up cost alerts
- [ ] Review autoscaling configuration
- [ ] Monitor Application Insights sampling
- [ ] Disable staging environment when not in use (optional)

## Completion Sign-Off

| Task | Status | Date | Notes |
|------|--------|------|-------|
| Pre-provisioning checklist | [ ] | | |
| Infrastructure deployed | [ ] | | |
| Application deployed | [ ] | | |
| Validation passed | [ ] | | |
| GitHub CI/CD configured | [ ] | | |
| Team trained | [ ] | | |
| Documentation updated | [ ] | | |

**Environment URL:** _____________________

**Provisioned By:** _____________________

**Date:** _____________________

**Approved By:** _____________________

---

## Quick Commands Reference

```bash
# View logs
az containerapp logs show --name docgen-<env> --resource-group docgen-<env>-rg --follow

# Get app URL
az containerapp show --name docgen-<env> --resource-group docgen-<env>-rg \
  --query properties.configuration.ingress.fqdn -o tsv

# List revisions
az containerapp revision list --name docgen-<env> --resource-group docgen-<env>-rg \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" -o table

# Scale app
az containerapp update --name docgen-<env> --resource-group docgen-<env>-rg \
  --min-replicas 2 --max-replicas 10

# Restart app (create new revision)
az containerapp update --name docgen-<env> --resource-group docgen-<env>-rg \
  --image docgen<env>.azurecr.io/docgen-api:latest

# Delete environment
az group delete --name docgen-<env>-rg --yes --no-wait
```

---

## Support Contacts

- **Azure Support:** [Azure Portal Support](https://portal.azure.com/#blade/Microsoft_Azure_Support/HelpAndSupportBlade)
- **Internal Team:** _____________________
- **Escalation:** _____________________
