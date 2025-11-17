# Docgen Operational Runbooks

This document provides detailed operational procedures for managing the docgen application in production and staging environments.

## Table of Contents

- [Overview](#overview)
- [Runbook Index](#runbook-index)
- [Runbook 1: Manual Rollback Procedure](#runbook-1-manual-rollback-procedure)
- [Runbook 2: Scale-Up and Scale-Down](#runbook-2-scale-up-and-scale-down)
- [Runbook 3: Key and Certificate Rotation](#runbook-3-key-and-certificate-rotation)
- [Runbook 4: Disaster Recovery](#runbook-4-disaster-recovery)
- [Runbook 5: Environment Cloning and Promotion](#runbook-5-environment-cloning-and-promotion)
- [Runbook 6: Handling Stuck Containers](#runbook-6-handling-stuck-containers)
- [Runbook 7: Database and Salesforce Maintenance](#runbook-7-database-and-salesforce-maintenance)
- [Incident Response Runbooks](#incident-response-runbooks)
- [Related Documentation](#related-documentation)

---

## Overview

These runbooks provide step-by-step procedures for operational tasks that may be required outside of normal CI/CD deployments. Each runbook includes:

- **Purpose**: When to use this runbook
- **Prerequisites**: What you need before starting
- **Estimated Duration**: How long the procedure typically takes
- **Impact**: Effect on running services
- **Rollback Plan**: How to undo if something goes wrong
- **Step-by-Step Instructions**: Detailed commands and validation

**For incident response runbooks** (High Failure Rate, Queue Depth, Performance Issues, etc.), see [dashboards.md](./dashboards.md) which contains 6 comprehensive operational runbooks.

---

## Runbook Index

| Runbook | Purpose | When to Use | Impact |
|---------|---------|-------------|--------|
| [1. Manual Rollback](#runbook-1-manual-rollback-procedure) | Roll back to previous revision | Automated rollback failed, issue after deployment | Low (traffic switches to previous version) |
| [2. Scale-Up/Down](#runbook-2-scale-up-and-scale-down) | Adjust replica count | High load, cost optimization | Medium (may cause brief interruptions) |
| [3. Key Rotation](#runbook-3-key-and-certificate-rotation) | Rotate secrets and keys | Security policy, expiration | Low (seamless with proper procedure) |
| [4. Disaster Recovery](#runbook-4-disaster-recovery) | Rebuild environment from scratch | Environment deleted, corruption | High (service unavailable during recovery) |
| [5. Environment Cloning](#runbook-5-environment-cloning-and-promotion) | Create new environment or promote staging to prod | New environment needed, major release | Medium (production only if promoting) |
| [6. Stuck Containers](#runbook-6-handling-stuck-containers) | Restart unhealthy containers | Container not responding, memory leak | Low (replica restart) |
| [7. Salesforce Maintenance](#runbook-7-database-and-salesforce-maintenance) | Handle Salesforce connectivity issues | Salesforce maintenance, auth failures | Medium (depends on Salesforce availability) |

**For application-level incidents**, see [dashboards.md](./dashboards.md):
- High Failure Rate
- High Queue Depth
- Slow Performance (P95 Duration)
- Conversion Timeouts
- Low Cache Hit Rate
- Salesforce API Degradation

---

## Runbook 1: Manual Rollback Procedure

### Purpose
Roll back to a previous working revision when:
- Automated CI/CD rollback failed
- Issue discovered after deployment completes
- Need to roll back to a specific revision (not just previous)
- Post-deployment validation fails

### Prerequisites
- Azure CLI installed and authenticated
- Access to Container App (`Reader` or `Contributor` role)
- Knowledge of which revision is known-good

### Estimated Duration
- **5-10 minutes** (including validation)

### Impact
- **Low**: Traffic switches to previous revision
- Brief interruption (~5-10 seconds) as traffic reroutes
- In-flight requests may fail (clients should retry)

### Rollback Plan
If rollback itself fails:
- Activate any working revision from history
- Worst case: Perform manual deployment from last known-good git commit

---

### Step-by-Step Instructions

#### Step 1: Identify Current State

```bash
# Set environment variables
export ENVIRONMENT="staging"  # or "production"
export RESOURCE_GROUP="docgen-${ENVIRONMENT}-rg"
export APP_NAME="docgen-${ENVIRONMENT}"

# List all revisions (including inactive)
az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].{name:name, active:properties.active, created:properties.createdTime, traffic:properties.trafficWeight, state:properties.provisioningState}" \
  -o table
```

**Expected output:**
```
Name                          Active    Created                       Traffic    State
----------------------------- --------- ----------------------------- ---------- -----------
docgen-staging--xyz789        True      2025-01-11T15:30:00           100        Succeeded
docgen-staging--abc123        False     2025-01-11T14:00:00           0          Succeeded
docgen-staging--def456        False     2025-01-11T12:00:00           0          Succeeded
```

**Identify:**
- **Current (problematic) revision**: Active=True (e.g., `xyz789`)
- **Previous (target) revision**: Most recent with Active=False and State=Succeeded (e.g., `abc123`)

---

#### Step 2: Capture Current State (for rollback of rollback)

```bash
# Save current active revision
CURRENT_REVISION=$(az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?properties.active].name" -o tsv)

echo "Current active revision: $CURRENT_REVISION"

# Optionally: Tag in git for traceability
git tag -a rollback-from-${CURRENT_REVISION} -m "Rolling back from ${CURRENT_REVISION} at $(date)"
```

---

#### Step 3: Test Previous Revision (if still active)

If the previous revision is still running (even with 0% traffic), you can test it first:

```bash
# Get previous revision name
PREVIOUS_REVISION="docgen-staging--abc123"  # Replace with actual

# Get revision hostname (if available)
az containerapp revision show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision "$PREVIOUS_REVISION" \
  --query properties.fqdn -o tsv

# If revision has a test URL, verify it works
# (Usually only available if revision is still active)
```

---

#### Step 4: Deactivate Current (Failed) Revision

```bash
# Deactivate problematic revision
az containerapp revision deactivate \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision "$CURRENT_REVISION"

echo "Deactivated revision: $CURRENT_REVISION"
```

**⚠️ Warning**: Deactivating the only active revision will cause downtime until the next revision is activated.

---

#### Step 5: Activate Previous (Good) Revision

```bash
# Activate previous working revision
az containerapp revision activate \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision "$PREVIOUS_REVISION"

echo "Activated revision: $PREVIOUS_REVISION"
```

**Expected duration**: 30-60 seconds for traffic to fully switch

---

#### Step 6: Verify Rollback Success

```bash
# Get app URL
APP_FQDN=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo "App URL: https://$APP_FQDN"

# Test health endpoint
curl https://$APP_FQDN/healthz
# Expected: {"status":"ok"}

# Test readiness endpoint
curl https://$APP_FQDN/readyz
# Expected: {"ready":true,"checks":{"jwks":true,"salesforce":true,"keyVault":true}}

# Verify active revision
az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?properties.active].{name:name, traffic:properties.trafficWeight}" \
  -o table

# Expected: $PREVIOUS_REVISION with traffic=100
```

---

#### Step 7: Monitor Application Logs

```bash
# Watch container logs for errors
az containerapp logs show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --tail 50 \
  --follow

# Look for:
# - Successful requests (HTTP 200)
# - No exceptions or errors
# - Healthy Salesforce connections
# - Key Vault access successful
```

**Monitor for 5-10 minutes** to ensure stability.

---

#### Step 8: Verify in Application Insights

1. Navigate to Azure Portal → Application Insights → `docgen-${ENVIRONMENT}-insights`
2. **Live Metrics**: Check request rate and failure rate (should be normal)
3. **Failures**: Check for new exceptions (should be minimal)
4. **Performance**: Verify response times are normal

---

#### Step 9: Clean Up Failed Revision (Optional)

After confirming rollback success, you can delete the failed revision:

```bash
# Wait at least 1 hour to ensure no issues
sleep 3600

# Delete failed revision
az containerapp revision delete \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision "$CURRENT_REVISION"

echo "Deleted failed revision: $CURRENT_REVISION"
```

**Note**: Azure Container Apps automatically cleans up old revisions after retention period.

---

#### Step 10: Document and Investigate

1. **Create incident report**:
   - What failed (symptoms, errors)
   - When it was detected
   - Rollback actions taken
   - Root cause (if known)

2. **Review deployment changes**:
   ```bash
   # Compare git commits
   git log --oneline --decorate --graph

   # View code diff
   git diff <previous-good-commit> <failed-commit>

   # View Bicep diff (if infrastructure changed)
   git diff <previous-good-commit> <failed-commit> -- infra/
   ```

3. **Analyze Application Insights**:
   - Exception details
   - Failed request traces
   - Performance degradation timeline

4. **Fix root cause** before attempting redeployment

---

### Troubleshooting

**Issue**: No previous working revision available

**Solution**:
- Deploy manually from last known-good git commit
- See [DEPLOY.md](./DEPLOY.md#method-2-manual-deployment) for manual deployment steps
- Worst case: Use disaster recovery runbook to rebuild environment

**Issue**: Rollback doesn't fix the issue

**Possible causes**:
- Issue is in infrastructure (Bicep), not application code
- Issue is in Key Vault secrets or configuration
- External dependency failure (Salesforce, Azure AD)

**Solution**:
- Review infrastructure changes
- Check external service status
- See [TROUBLESHOOTING-INDEX.md](./TROUBLESHOOTING-INDEX.md)

---

## Runbook 2: Scale-Up and Scale-Down

### Purpose
Manually adjust Container App replica count to:
- Handle expected high load (scale-up)
- Reduce costs during low usage periods (scale-down)
- Test scaling behavior
- Tune autoscaling thresholds

**Note**: Container Apps have built-in autoscaling (CPU > 70%). This runbook is for manual overrides.

### Prerequisites
- Azure CLI installed and authenticated
- Access to Container App (`Contributor` role)
- Understanding of current load and scaling needs

### Estimated Duration
- **5-10 minutes** (scale-up) or **10-15 minutes** (scale-down with graceful shutdown)

### Impact
- **Scale-up**: Low (adds capacity, no interruptions)
- **Scale-down**: Medium (may terminate in-flight requests if not graceful)

### Rollback Plan
- Adjust replica count back to original value
- Re-enable autoscaling

---

### Step-by-Step Instructions

#### Step 1: Check Current Replica Count

```bash
# Set environment variables
export ENVIRONMENT="staging"  # or "production"
export RESOURCE_GROUP="docgen-${ENVIRONMENT}-rg"
export APP_NAME="docgen-${ENVIRONMENT}"

# Get current scale configuration
az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "{minReplicas:properties.template.scale.minReplicas, maxReplicas:properties.template.scale.maxReplicas}" \
  -o table

# Get current active replicas
az containerapp replica list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision <active-revision-name> \
  --query "[].{name:name, state:properties.runningState, created:properties.createdTime}" \
  -o table
```

**Expected output:**
```
MinReplicas    MaxReplicas
-------------  -------------
1              5

Name                                   State      Created
-------------------------------------- ---------- -------------------------
docgen-staging--abc123-xyz-1          Running    2025-01-11T14:00:00
```

---

#### Step 2: Scale-Up (Increase Capacity)

**Scenario**: Expecting high load, need more capacity immediately.

```bash
# Increase max replicas temporarily
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --min-replicas 3 \
  --max-replicas 10

echo "Scaled up: min=3, max=10 replicas"
```

**Verification:**

```bash
# Wait 1-2 minutes for new replicas to start
sleep 120

# Check replica count
az containerapp replica list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision <active-revision-name> \
  --query "length(@)" \
  -o tsv

# Should show 3 replicas (or more if under load)
```

**Monitor:**

```bash
# Watch Application Insights Live Metrics
# - Servers: Should increase from 1 to 3
# - Request rate: Should distribute across replicas
# - Response time: Should improve under load

# Or use Azure CLI to watch metrics
az monitor metrics list \
  --resource <container-app-resource-id> \
  --metric "Requests" \
  --aggregation count \
  --interval PT1M
```

---

#### Step 3: Scale-Down (Reduce Capacity)

**Scenario**: Low usage period, reduce costs.

**⚠️ Important**: Scale-down terminates replicas, which may interrupt in-flight requests.

```bash
# Check current load first
az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.scale" \
  -o json

# Verify low request rate in Application Insights
# before scaling down

# Scale down gradually
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --min-replicas 1 \
  --max-replicas 3

echo "Scaled down: min=1, max=3 replicas"
```

**Graceful scale-down** (recommended for production):

1. **Enable worker drain** (if supported):
   - Set POLLER_ENABLED=false temporarily
   - Wait for queue to drain
   - Then scale down

2. **Monitor queue depth** before scaling:
   ```bash
   # Check Application Insights for queue_depth metric
   # Ensure queue is empty or near-empty
   ```

3. **Scale down during low-traffic period**:
   - Check request rate in Application Insights
   - Scale during off-peak hours

---

#### Step 4: Tune Autoscaling Thresholds

**Scenario**: Default autoscaling (CPU > 70%) is too aggressive or too conservative.

```bash
# View current autoscaling rules
az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.scale.rules" \
  -o json

# Update CPU threshold via Bicep
# Edit infra/modules/app.bicep:
#
# scale: {
#   minReplicas: 1
#   maxReplicas: 5
#   rules: [
#     {
#       name: 'cpu-scaling'
#       custom: {
#         type: 'cpu'
#         metadata: {
#           type: 'Utilization'
#           value: '60'  # Changed from 70 to 60 (scale earlier)
#         }
#       }
#     }
#   ]
# }

# Commit and deploy via CI/CD
git add infra/modules/app.bicep
git commit -m "tune: adjust autoscaling CPU threshold to 60%"
git push
```

---

#### Step 5: Disable Autoscaling (Manual Control Only)

**⚠️ Not recommended for production**

```bash
# Remove autoscaling rules, set fixed replica count
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --min-replicas 2 \
  --max-replicas 2

echo "Autoscaling disabled: fixed at 2 replicas"
```

**When to use:**
- Load testing with fixed capacity
- Debugging scaling issues
- Temporary override during incident

**Remember to re-enable after testing!**

---

#### Step 6: Re-enable Autoscaling

```bash
# Restore default scaling configuration
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --min-replicas 1 \
  --max-replicas 5

# Scaling rules are preserved from Bicep deployment
echo "Autoscaling re-enabled: 1-5 replicas, CPU-based"
```

---

### Monitoring Scaling Behavior

**Azure Portal:**
1. Navigate to Container App → Metrics
2. Add metric: "Replica Count"
3. Add metric: "CPU Usage"
4. Add metric: "Requests"
5. View correlation between CPU and replica count

**Application Insights:**
```kusto
// View replica count over time
traces
| where timestamp > ago(1h)
| where message contains "replica"
| summarize count() by bin(timestamp, 1m)
| render timechart
```

**Azure CLI:**
```bash
# Monitor replica count in real-time
watch -n 30 'az containerapp replica list \
  --name '"$APP_NAME"' \
  --resource-group '"$RESOURCE_GROUP"' \
  --revision <active-revision-name> \
  --query "length(@)" \
  -o tsv'
```

---

### Cost Impact

**Approximate costs** (per month, per replica):
- 2 vCPU / 4 GB RAM: ~$50-80/month
- 1 replica: $50-80
- 3 replicas: $150-240
- 5 replicas: $250-400

**Cost optimization strategies:**
- Use autoscaling (scale down during low usage)
- Set aggressive scale-down thresholds
- Consider reserved instances for baseline capacity
- Monitor `queue_depth` metric to right-size capacity

---

## Runbook 3: Key and Certificate Rotation

### Purpose
Rotate secrets and keys for security compliance and expiration:
- Salesforce JWT private key
- Azure Service Principal client secret
- Azure AD application client secret (if applicable)
- TLS/SSL certificates (if custom domain)

### Prerequisites
- Access to Azure Portal (for Service Principal management)
- Access to Salesforce (for Connected App configuration)
- Access to GitHub (for updating secrets)
- `openssl` installed (for key generation)

### Estimated Duration
- **Salesforce JWT key**: 20-30 minutes
- **Azure Service Principal secret**: 15-20 minutes
- **TLS certificate**: 30-45 minutes (if applicable)

### Impact
- **Low** (if procedure followed correctly - zero downtime)
- Requires deployment to pick up new secrets

### Rollback Plan
- Revert to previous key/secret
- Update GitHub secrets with old values
- Redeploy

---

### Procedure 1: Rotate Salesforce JWT Private Key

**When to rotate:**
- Security policy requires annual rotation
- Key suspected compromised
- Before major security audit

---

#### Step 1: Generate New Key Pair

```bash
# Create keys directory if it doesn't exist
mkdir -p keys

# Generate new 4096-bit RSA private key
openssl genrsa -out keys/server-new.key 4096

# Extract public key
openssl rsa -pubout -in keys/server-new.key -out keys/server-new.pub

# Verify key generated correctly
openssl rsa -text -in keys/server-new.key -noout | head -n 5

# Set proper permissions
chmod 600 keys/server-new.key
chmod 644 keys/server-new.pub

echo "New key pair generated: keys/server-new.key, keys/server-new.pub"
```

---

#### Step 2: Update Salesforce Connected App

1. **Login to Salesforce** (use production org for production rotation)

2. **Navigate to Connected App**:
   - Setup → App Manager → Find "Docgen API" → Manage

3. **Upload new certificate**:
   - Edit → Digital Certificate section
   - Click "Choose File"
   - Select `keys/server-new.pub`
   - Save

4. **Verify**:
   - Certificate should show uploaded date
   - Note: Old certificate still works until replaced

---

#### Step 3: Update GitHub Secrets

```bash
# Update staging environment
gh secret set SF_PRIVATE_KEY --env staging < keys/server-new.key

# Update production environment
gh secret set SF_PRIVATE_KEY --env production < keys/server-new.key

# Verify secrets updated
gh secret list --env staging | grep SF_PRIVATE_KEY
gh secret list --env production | grep SF_PRIVATE_KEY
```

---

#### Step 4: Deploy to Staging

```bash
# Merge any commit to main to trigger deployment
# (Or make a dummy commit)
git commit --allow-empty -m "chore: rotate Salesforce JWT key"
git push origin main

# Monitor deployment
gh run list --workflow=deploy-staging.yml
gh run watch <run-id>
```

**Deployment will:**
1. Update Key Vault with new private key (from GitHub secret)
2. Restart Container App to load new key
3. Run smoke tests (validates new key works)

---

#### Step 5: Verify Staging Connectivity

```bash
# Test Salesforce authentication
curl https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io/readyz

# Expected response:
# {"ready":true,"checks":{"jwks":true,"salesforce":true,"keyVault":true}}
#
# "salesforce": true confirms JWT auth working with new key
```

**If verification fails:**
- Check Salesforce Connected App certificate upload
- Verify GitHub secret updated correctly
- Review container logs for Salesforce auth errors

---

#### Step 6: Deploy to Production

```bash
# Create release to trigger production deployment
git tag -a v1.1.0 -m "Release v1.1.0: Rotate Salesforce JWT key"
git push origin v1.1.0

# Create GitHub release
gh release create v1.1.0 \
  --title "Release v1.1.0: Security Update" \
  --notes "## Changes
- Rotate Salesforce JWT private key per security policy

## Validation
- Staging tested and verified: ✅
- Zero-downtime rotation: ✅"

# Approve deployment when prompted
# Monitor deployment
gh run watch <run-id>
```

---

#### Step 7: Remove Old Key

**After confirming both staging and production work with new key:**

```bash
# Backup old key (just in case)
mv keys/server.key keys/server-old-$(date +%Y%m%d).key.bak
mv keys/server.pub keys/server-old-$(date +%Y%m%d).pub.bak

# Rename new key to active
mv keys/server-new.key keys/server.key
mv keys/server-new.pub keys/server.pub

# Commit updated keys (public key only, private key stays local)
git add keys/server.pub
git commit -m "docs: update Salesforce public key after rotation"
git push

# Securely delete backup after 30 days
# (Keep backup in case emergency rollback needed)
```

---

### Procedure 2: Rotate Azure Service Principal Client Secret

**When to rotate:**
- Secret expiring (check expiration date)
- Security policy requires rotation
- Secret suspected compromised

---

#### Step 1: Get Service Principal Details

```bash
# Find Service Principal
az ad sp list --display-name "Salesforce-Docgen-API" \
  --query "[].{name:displayName, appId:appId, objectId:id}" \
  -o table

# Note the appId (Client ID)
export SP_APP_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"  # Replace with actual
```

---

#### Step 2: Generate New Client Secret

```bash
# Create new secret (valid for 2 years)
NEW_SECRET=$(az ad sp credential reset \
  --id "$SP_APP_ID" \
  --append \
  --years 2 \
  --query password -o tsv)

echo "New client secret generated (save this securely):"
echo "$NEW_SECRET"

# IMPORTANT: Save this secret immediately!
# It will not be shown again.
```

**⚠️ Security**: Store `NEW_SECRET` in password manager immediately.

---

#### Step 3: Update AZURE_CREDENTIALS JSON

```bash
# Get current subscription and tenant details
TENANT_ID=$(az account show --query tenantId -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

# Build new AZURE_CREDENTIALS JSON
cat > azure-credentials-new.json <<EOF
{
  "clientId": "$SP_APP_ID",
  "clientSecret": "$NEW_SECRET",
  "subscriptionId": "$SUBSCRIPTION_ID",
  "tenantId": "$TENANT_ID"
}
EOF

echo "New AZURE_CREDENTIALS JSON created: azure-credentials-new.json"
```

---

#### Step 4: Update GitHub Secrets

```bash
# Update staging environment
gh secret set AZURE_CREDENTIALS --env staging < azure-credentials-new.json

# Update production environment
gh secret set AZURE_CREDENTIALS --env production < azure-credentials-new.json

# Verify secrets updated
gh secret list --env staging | grep AZURE_CREDENTIALS
gh secret list --env production | grep AZURE_CREDENTIALS

# Securely delete JSON file
shred -u azure-credentials-new.json
```

---

#### Step 5: Test with Staging Deployment

```bash
# Trigger staging deployment to test new credentials
git commit --allow-empty -m "chore: rotate Azure Service Principal secret"
git push origin main

# Monitor deployment
gh run watch <run-id>

# Verify Azure login succeeds in GitHub Actions
# (Check workflow logs for successful Azure login)
```

**If deployment fails:**
- Verify AZURE_CREDENTIALS JSON format is correct
- Check Service Principal has Contributor role on subscription
- Review GitHub Actions logs for specific auth error

---

#### Step 6: Delete Old Secret (After Verification)

```bash
# List all credentials for Service Principal
az ad sp credential list --id "$SP_APP_ID" \
  --query "[].{keyId:keyId, startDate:startDateTime, endDate:endDateTime}" \
  -o table

# Identify old secret (earlier start date)
OLD_KEY_ID="<key-id-from-above>"  # Replace with actual

# Delete old secret
az ad sp credential delete \
  --id "$SP_APP_ID" \
  --key-id "$OLD_KEY_ID"

echo "Old Service Principal secret deleted"
```

**Wait at least 24 hours** after creating new secret before deleting old one (allows time to verify).

---

### Procedure 3: Rotate TLS/SSL Certificate (Custom Domain)

**Note**: Azure Container Apps provides automatic TLS for `*.azurecontainerapps.io` domains. This procedure is only needed if using a custom domain.

**If using custom domain:**

1. **Obtain new certificate** (from Certificate Authority or Let's Encrypt)
2. **Upload to Azure Container Apps**:
   ```bash
   az containerapp env certificate upload \
     --name docgen-${ENVIRONMENT}-env \
     --resource-group docgen-${ENVIRONMENT}-rg \
     --certificate-file /path/to/certificate.pfx \
     --certificate-password <password>
   ```
3. **Bind certificate to app**:
   ```bash
   az containerapp hostname bind \
     --name docgen-${ENVIRONMENT} \
     --resource-group docgen-${ENVIRONMENT}-rg \
     --hostname yourdomain.com \
     --certificate <certificate-id>
   ```

**See Azure Container Apps documentation** for detailed custom domain setup.

---

## Runbook 4: Disaster Recovery

### Purpose
Rebuild environment from scratch when:
- Environment accidentally deleted
- Resource group corruption or irrecoverable state
- Need to recreate in different subscription
- Major infrastructure migration

### Prerequisites
- Azure CLI installed and authenticated
- Access to new/target Azure subscription (`Contributor` role)
- GitHub repository access (with secrets)
- `.env` file and `keys/server.key` from local backup
- Service Principal credentials (or ability to create new one)
- Bicep templates from git repository

### Estimated Duration
- **45-60 minutes** (full environment rebuild)

### Impact
- **High**: Service unavailable during rebuild (30-45 minutes)
- **Data**: No data loss (Salesforce is source of truth for documents)
- **Configuration**: Secrets must be reconfigured from backup

### Rollback Plan
- If in different subscription: Old environment may still exist as fallback
- If in same subscription: Requires rebuilding again from scratch

---

### Step-by-Step Instructions

#### Step 1: Assess Situation and Prepare

**Confirm disaster recovery is needed:**
- [✓] Environment is deleted or unrecoverable
- [✓] Standard rollback/repair procedures won't work
- [✓] Have approval for downtime (if production)

**Gather required information:**

```bash
# Document current state (if environment still exists)
az group list --query "[?contains(name,'docgen')]" -o table

# Clone repository (if not already local)
git clone https://github.com/<owner>/docgen.git
cd docgen

# Verify you have local backups
ls -la .env keys/server.key
# Both files should exist

# Verify Bicep templates
ls -la infra/main.bicep infra/modules/ infra/parameters/
```

---

#### Step 2: Set Environment Variables

```bash
# Set target environment
export ENVIRONMENT="staging"  # or "production"
export RESOURCE_GROUP="docgen-${ENVIRONMENT}-rg"
export LOCATION="eastus"
export ACR_NAME="docgen${ENVIRONMENT}"
export KEY_VAULT_NAME="docgen-${ENVIRONMENT}-kv"
export APP_NAME="docgen-${ENVIRONMENT}"

# Get Azure details
export TENANT_ID=$(az account show --query tenantId -o tsv)
export SUBSCRIPTION_ID=$(az account show --query id -o tsv)
export USER_EMAIL=$(az account show --query user.name -o tsv)

echo "Disaster recovery for $ENVIRONMENT environment"
echo "Subscription: $SUBSCRIPTION_ID"
echo "User: $USER_EMAIL"
```

---

#### Step 3: Create Resource Group

```bash
# Delete old resource group if it exists (corrupted state)
az group show --name "$RESOURCE_GROUP" 2>/dev/null
if [ $? -eq 0 ]; then
  echo "Old resource group exists, deleting..."
  az group delete --name "$RESOURCE_GROUP" --yes --no-wait
  sleep 60  # Wait for deletion to propagate
fi

# Create new resource group with required tags
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags Owner="$USER_EMAIL" Project="Personal Sandbox"

# Verify creation
az group show --name "$RESOURCE_GROUP"
```

---

#### Step 4: Deploy Infrastructure via Bicep

```bash
# Deploy all infrastructure (10-15 minutes)
az deployment group create \
  --name "disaster-recovery-$(date +%Y%m%d-%H%M%S)" \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters infra/parameters/${ENVIRONMENT}.bicepparam

# Monitor deployment
az deployment group list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[0].{name:name, state:properties.provisioningState, duration:properties.duration}" \
  -o table
```

**Expected resources created:**
- Log Analytics Workspace
- Application Insights
- Azure Container Registry
- Azure Key Vault
- Container Apps Environment
- Container App (with Managed Identity)

---

#### Step 5: Capture Deployment Outputs

```bash
# Get Application Insights connection string
APP_INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
  --app "docgen-${ENVIRONMENT}-insights" \
  --resource-group "$RESOURCE_GROUP" \
  --query connectionString -o tsv)

echo "App Insights Connection String: ${APP_INSIGHTS_CONNECTION_STRING:0:50}..."

# Get Managed Identity Principal ID
MANAGED_IDENTITY_ID=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query identity.principalId -o tsv)

echo "Managed Identity: $MANAGED_IDENTITY_ID"

# Get Key Vault URI
KEY_VAULT_URI=$(az keyvault show \
  --name "$KEY_VAULT_NAME" \
  --query properties.vaultUri -o tsv)

echo "Key Vault URI: $KEY_VAULT_URI"
```

---

#### Step 6: Assign RBAC Roles (Workaround for Bicep Propagation)

```bash
# Wait for Managed Identity to propagate
sleep 60

# Assign AcrPull role (Container App → Container Registry)
az role assignment create \
  --role "AcrPull" \
  --assignee "$MANAGED_IDENTITY_ID" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

# Assign Key Vault Secrets User role (Container App → Key Vault)
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee "$MANAGED_IDENTITY_ID" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEY_VAULT_NAME"

# Assign Key Vault Secrets Officer role (Your user → Key Vault, for populating secrets)
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee "$USER_EMAIL" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEY_VAULT_NAME"

# Wait for role assignments to propagate
sleep 60

echo "RBAC roles assigned"
```

---

#### Step 7: Populate Key Vault Secrets

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

# Verify all secrets created
az keyvault secret list --vault-name "$KEY_VAULT_NAME" --query "[].name" -o table

# Expected: 5 secrets
```

---

#### Step 8: Build and Push Docker Image

```bash
# Login to ACR
az acr login --name "$ACR_NAME"

# Build image for linux/amd64 (important for Azure Container Apps!)
docker build --platform linux/amd64 \
  -t "$ACR_NAME.azurecr.io/docgen-api:disaster-recovery" \
  -t "$ACR_NAME.azurecr.io/docgen-api:latest" \
  .

# Push images
docker push "$ACR_NAME.azurecr.io/docgen-api:disaster-recovery"
docker push "$ACR_NAME.azurecr.io/docgen-api:latest"

# Verify images in ACR
az acr repository list --name "$ACR_NAME"
az acr repository show-tags --name "$ACR_NAME" --repository docgen-api
```

---

#### Step 9: Update Container App with Image

```bash
# Update Container App
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$ACR_NAME.azurecr.io/docgen-api:disaster-recovery"

# Wait for revision activation (1-2 minutes)
az containerapp revision list \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" \
  -o table
```

---

#### Step 10: Validate Environment

```bash
# Get app URL
APP_FQDN=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo "App URL: https://$APP_FQDN"

# Test health endpoint
curl https://$APP_FQDN/healthz
# Expected: {"status":"ok"}

# Test readiness endpoint
curl https://$APP_FQDN/readyz
# Expected: {"ready":true,"checks":{"jwks":true,"salesforce":true,"keyVault":true}}

# View container logs
az containerapp logs show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --tail 50

# Look for:
# - No errors during startup
# - Key Vault connected
# - Salesforce authenticated
# - LibreOffice initialized
```

---

#### Step 11: Restore CI/CD (GitHub Secrets)

If disaster recovery was needed due to subscription change or new Service Principal:

1. **Create new Service Principal** (if needed):
   ```bash
   az ad sp create-for-rbac \
     --name "github-docgen-deploy-${ENVIRONMENT}" \
     --role Contributor \
     --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP" \
     --sdk-auth
   ```

2. **Update GitHub environment secrets**:
   ```bash
   # Update all environment secrets
   gh secret set AZURE_TENANT_ID --env "$ENVIRONMENT" --body "$TENANT_ID"
   gh secret set AZURE_SUBSCRIPTION_ID --env "$ENVIRONMENT" --body "$SUBSCRIPTION_ID"
   gh secret set AZURE_CREDENTIALS --env "$ENVIRONMENT" < azure-credentials.json
   gh secret set ACR_NAME --env "$ENVIRONMENT" --body "$ACR_NAME"
   gh secret set RESOURCE_GROUP --env "$ENVIRONMENT" --body "$RESOURCE_GROUP"
   gh secret set KEY_VAULT_NAME --env "$ENVIRONMENT" --body "$KEY_VAULT_NAME"
   gh secret set APP_NAME --env "$ENVIRONMENT" --body "$APP_NAME"
   ```

3. **Test CI/CD**:
   ```bash
   # For staging
   git commit --allow-empty -m "test: verify CI/CD after disaster recovery"
   git push origin main

   # For production
   git tag -a dr-test-v1.0.0 -m "Disaster recovery test"
   git push origin dr-test-v1.0.0
   gh release create dr-test-v1.0.0 --notes "Disaster recovery validation"
   ```

---

#### Step 12: Monitor and Document

1. **Monitor for 24 hours**:
   - Application Insights for errors
   - Container logs for issues
   - Health checks every hour

2. **Document disaster recovery**:
   - Cause of disaster
   - Steps taken
   - Lessons learned
   - Process improvements

3. **Update disaster recovery plan** based on experience

---

### Post-Recovery Checklist

- [✓] All Azure resources deployed
- [✓] Key Vault secrets populated
- [✓] Container App running with active revision
- [✓] Health and readiness checks passing
- [✓] Salesforce authentication working
- [✓] Document generation tested end-to-end
- [✓] Application Insights receiving telemetry
- [✓] GitHub CI/CD tested and working
- [✓] Team notified of recovery completion
- [✓] Post-mortem documented

---

## Runbook 5: Environment Cloning and Promotion

### Purpose
- Create a new environment (e.g., new staging, UAT environment)
- Promote staging configuration to production
- Clone environment to different subscription

### Prerequisites
- Azure CLI installed and authenticated
- Access to source and target subscriptions
- GitHub repository access
- Bicep templates from repository

### Estimated Duration
- **30-45 minutes** (new environment)

### Impact
- **Low** (creates new resources, doesn't affect existing environments)

---

### Procedure 1: Create New Environment

Follow **Runbook 4: Disaster Recovery** steps, but:
- Use different environment name (e.g., `uat`, `demo`)
- Create new parameter file: `infra/parameters/uat.bicepparam`
- Create new GitHub environment with secrets

---

### Procedure 2: Promote Staging to Production

**When to use:**
- Major production release
- Staging has been validated thoroughly
- Want identical configuration in production

**Steps:**

1. **Validate staging**:
   ```bash
   # Run full test suite in staging
   # Review Application Insights for issues
   # Check queue processing, document generation
   ```

2. **Copy staging parameter file**:
   ```bash
   cp infra/parameters/staging.bicepparam infra/parameters/production.bicepparam

   # Edit production parameters (resource names)
   vi infra/parameters/production.bicepparam
   # Update: resourceGroup, acrName, keyVaultName, appName
   ```

3. **Create production environment** (if doesn't exist):
   - See disaster recovery runbook
   - Use production parameter file

4. **Deploy configuration**:
   ```bash
   # Create release to trigger production deployment
   git tag -a v2.0.0 -m "Release v2.0.0: Promote staging config to production"
   git push origin v2.0.0
   gh release create v2.0.0 --notes "Promote staging configuration"
   ```

5. **Validate production matches staging**:
   - Test all features
   - Compare Application Insights metrics
   - Verify scaling configuration

---

## Runbook 6: Handling Stuck Containers

### Purpose
Restart or recover containers that are:
- Not responding to requests
- Stuck in unhealthy state
- Experiencing memory leaks
- Showing high CPU without processing requests

### Estimated Duration
- **2-5 minutes**

### Impact
- **Low**: Single replica restart (other replicas handle traffic)
- **Medium**: All replicas restart (brief service interruption)

---

### Procedure: Restart Stuck Replica

```bash
# List replicas
az containerapp replica list \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --revision <active-revision-name>

# Restart specific replica
az containerapp replica restart \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --replica <replica-name>

# Restart entire revision (all replicas)
az containerapp revision restart \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --revision <active-revision-name>
```

---

## Runbook 7: Database and Salesforce Maintenance

### Purpose
Handle Salesforce connectivity issues, maintenance windows, authentication failures.

### Common Issues

**Issue: Salesforce maintenance window**

**Preparation:**
- Notify users of potential downtime
- Monitor queue depth before maintenance
- Disable poller if needed

**During maintenance:**
```bash
# Disable poller to prevent failed retries
# (Update environment variable via Azure Portal or Bicep)
POLLER_ENABLED=false
```

**After maintenance:**
- Re-enable poller
- Monitor queue processing
- Check for failed documents and retry

---

**Issue: Salesforce authentication failures**

**Diagnosis:**
```bash
# Test readiness endpoint
curl https://docgen-staging.../readyz
# Check "salesforce": false

# View container logs
az containerapp logs show \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --tail 100 | grep -i salesforce
```

**Common causes:**
- JWT private key expired or rotated
- Salesforce Connected App changed
- Integration User permissions changed
- Salesforce IP restrictions

**Resolution:**
- See Runbook 3: Key Rotation (Salesforce JWT key)
- Verify Connected App configuration in Salesforce
- Check Integration User permissions
- Review Salesforce login history

---

## Incident Response Runbooks

For application-level incidents, see [dashboards.md](./dashboards.md) which contains detailed runbooks for:

1. **High Failure Rate** (>5% errors)
   - Diagnosis: Exception analysis, recent deployments, dependency health
   - Remediation: Rollback, scale resources, fix bugs

2. **High Queue Depth** (>100 documents queued)
   - Diagnosis: Processing rate, poller status, conversion timeouts
   - Remediation: Scale up replicas, optimize conversion, investigate bottlenecks

3. **Slow Performance** (P95 duration >10s)
   - Diagnosis: Dependency breakdown, cache performance, resource utilization
   - Remediation: Optimize dependencies, tune caching, scale resources

4. **Conversion Timeouts** (>10 timeouts in 5min)
   - Diagnosis: LibreOffice hangs, large documents, resource constraints
   - Remediation: Increase timeout, add resources, optimize templates

5. **Low Cache Hit Rate** (<80%)
   - Diagnosis: Cache eviction, template changes, cache configuration
   - Remediation: Increase cache size, optimize eviction policy

6. **Salesforce API Degradation** (P95 >5s)
   - Diagnosis: Salesforce status, API limits, network latency
   - Remediation: Contact Salesforce support, implement backoff, cache more

---

## Related Documentation

- **[DEPLOY.md](./DEPLOY.md)** - Day-to-day deployment guide
- **[PROVISIONING.md](./PROVISIONING.md)** - One-time environment setup
- **[dashboards.md](./dashboards.md)** - Monitoring and incident response runbooks
- **[TROUBLESHOOTING-INDEX.md](./TROUBLESHOOTING-INDEX.md)** - Troubleshooting navigation
- **[README.md](../README.md)** - Application overview

---

**Last Updated**: 2025-11-11
**Version**: 1.0
**Maintainer**: Docgen Team
