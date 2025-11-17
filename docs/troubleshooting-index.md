# Docgen Troubleshooting Index

Quick reference guide to troubleshooting resources across all documentation. Use this index to quickly find solutions to common problems.

## Table of Contents

- [Quick Issue Lookup](#quick-issue-lookup)
- [By Category](#by-category)
- [By Symptom](#by-symptom)
- [By Component](#by-component)
- [Escalation Path](#escalation-path)
- [Documentation Map](#documentation-map)

---

## Quick Issue Lookup

| Issue | Quick Fix | Documentation |
|-------|-----------|---------------|
| **Deployment failed** | Check GitHub Actions logs, verify Bicep syntax | [DEPLOY.md](./DEPLOY.md#common-deployment-issues) |
| **Container won't start** | Check Key Vault secrets, verify RBAC roles | [DEPLOY.md](./DEPLOY.md#issue-container-wont-start), [PROVISIONING.md](./PROVISIONING.md#troubleshooting) |
| **Health check failing** | Check `/readyz` response, review container logs | [DEPLOY.md](./DEPLOY.md#health-checks--validation) |
| **High failure rate** | Review Application Insights, check recent deployments | [dashboards.md](./dashboards.md#runbook-1-high-failure-rate) |
| **Queue backing up** | Check poller status, review processing rate | [dashboards.md](./dashboards.md#runbook-2-high-queue-depth) |
| **Slow performance** | Check dependency latency, review cache hit rate | [dashboards.md](./dashboards.md#runbook-3-slow-performance-p95-duration-exceeds-slo) |
| **Conversion timeouts** | Check LibreOffice pool, review document complexity | [dashboards.md](./dashboards.md#runbook-4-conversion-timeouts) |
| **Salesforce auth failed** | Verify JWT key, check Connected App | [RUNBOOKS.md](./RUNBOOKS.md#runbook-7-database-and-salesforce-maintenance), [PROVISIONING.md](./PROVISIONING.md#troubleshooting) |
| **Azure AD auth 403 error** | Update Named Credential to use v2.0 token endpoint | [named-credential-setup.md](./named-credential-setup.md#troubleshooting) |
| **Key Vault access denied** | Assign Key Vault Secrets Officer role | [PROVISIONING.md](./PROVISIONING.md#issue-key-vault-access-denied) |
| **Rollback needed** | Use automated rollback or manual procedure | [DEPLOY.md](./DEPLOY.md#rollback-procedures), [RUNBOOKS.md](./RUNBOOKS.md#runbook-1-manual-rollback-procedure) |

---

## By Category

### Deployment Issues

| Issue | Symptoms | Solution | Reference |
|-------|----------|----------|-----------|
| **Docker build fails** | `build-image` job fails, "failed to solve" error | Fix Dockerfile syntax, check dependencies | [DEPLOY.md](./DEPLOY.md#issue-docker-build-fails) |
| **Bicep deployment fails** | `deploy-infrastructure` job fails, ValidationFailed | Validate Bicep, check permissions | [DEPLOY.md](./DEPLOY.md#issue-bicep-deployment-fails) |
| **Smoke tests fail** | `smoke-tests` job fails, endpoints return errors | Check app health, verify credentials | [DEPLOY.md](./DEPLOY.md#issue-smoke-tests-fail) |
| **Rollback fails** | `rollback` job fails, no previous revision | Manual rollback procedure | [DEPLOY.md](./DEPLOY.md#issue-rollback-fails), [RUNBOOKS.md](./RUNBOOKS.md#runbook-1-manual-rollback-procedure) |
| **Image push fails** | ACR authentication error, manifest invalid | Login to ACR, verify image platform | [PROVISIONING.md](./PROVISIONING.md#issue-docker-platform-mismatch) |
| **Azure policy violation** | Resource creation fails, missing tags | Add required tags (Owner, Project) | [PROVISIONING.md](./PROVISIONING.md#issue-azure-policy-violations) |

---

### Application Issues

| Issue | Symptoms | Solution | Reference |
|-------|----------|----------|-----------|
| **High failure rate** | >5% errors, exception spike in App Insights | Review recent deployments, check dependencies | [dashboards.md](./dashboards.md#runbook-1-high-failure-rate) |
| **Slow performance** | P95 duration >10s, users report delays | Check dependency latency, optimize queries | [dashboards.md](./dashboards.md#runbook-3-slow-performance-p95-duration-exceeds-slo) |
| **Memory leak** | Replica memory increasing, OOM errors | Restart replicas, investigate with profiler | [RUNBOOKS.md](./RUNBOOKS.md#runbook-6-handling-stuck-containers) |
| **High CPU usage** | CPU >80% sustained, slow responses | Scale up replicas, optimize conversion | [RUNBOOKS.md](./RUNBOOKS.md#runbook-2-scale-up-and-scale-down) |
| **Stuck requests** | Requests timing out, no response | Check LibreOffice pool, review logs | [RUNBOOKS.md](./RUNBOOKS.md#runbook-6-handling-stuck-containers) |
| **Cache thrashing** | Low cache hit rate (<80%), high evictions | Increase cache size, review eviction policy | [dashboards.md](./dashboards.md#runbook-5-low-cache-hit-rate) |

---

### Infrastructure Issues

| Issue | Symptoms | Solution | Reference |
|-------|----------|----------|-----------|
| **Container won't start** | Revision ProvisioningFailed, startup timeout | Check secrets, verify RBAC, review logs | [DEPLOY.md](./DEPLOY.md#issue-container-wont-start), [PROVISIONING.md](./PROVISIONING.md#issue-container-wont-start) |
| **Key Vault access denied** | "403 Forbidden" in logs, secrets not loading | Assign Key Vault Secrets Officer/User role | [PROVISIONING.md](./PROVISIONING.md#issue-key-vault-access-denied) |
| **ACR pull failed** | Image not found, authentication error | Assign AcrPull role to Managed Identity | [PROVISIONING.md](./PROVISIONING.md#issue-role-assignment-propagation) |
| **Autoscaling not working** | Replicas not scaling, stuck at min/max | Review scale rules, check CPU metrics | [RUNBOOKS.md](./RUNBOOKS.md#step-4-tune-autoscaling-thresholds) |
| **Network connectivity** | Timeouts, DNS resolution failures | Check VNet config, verify firewall rules | [PROVISIONING.md](./PROVISIONING.md) |
| **Cost spike** | Unexpected Azure bill, high resource usage | Review replica count, check autoscaling | [PROVISIONING.md](./PROVISIONING.md#cost-estimates), [RUNBOOKS.md](./RUNBOOKS.md#cost-impact) |

---

### Integration Issues

| Issue | Symptoms | Solution | Reference |
|-------|----------|----------|-----------|
| **Salesforce auth failed** | "salesforce": false in `/readyz`, 401 errors | Verify JWT key, check Connected App | [RUNBOOKS.md](./RUNBOOKS.md#runbook-3-key-and-certificate-rotation), [RUNBOOKS.md](./RUNBOOKS.md#issue-salesforce-authentication-failures) |
| **Azure AD auth failed** | 401/403 on `/generate`, "jwks": false | Verify tenant/client ID, check JWKS endpoint | [DEPLOY.md](./DEPLOY.md#health-checks--validation) |
| **Queue not processing** | Documents stuck in QUEUED status | Check poller enabled, verify Salesforce connectivity | [dashboards.md](./dashboards.md#runbook-2-high-queue-depth) |
| **File upload failed** | ContentVersion creation error, 502 from API | Check Salesforce API limits, verify permissions | [dashboards.md](./dashboards.md#runbook-6-salesforce-api-degradation) |
| **Template not found** | 404 from `/generate`, template download fails | Verify template ContentVersionId, check cache | [dashboards.md](./dashboards.md#runbook-1-high-failure-rate) |

---

### Operational Issues

| Issue | Symptoms | Solution | Reference |
|-------|----------|----------|-----------|
| **Queue depth high** | >100 documents queued, processing slow | Scale up replicas, check conversion timeouts | [dashboards.md](./dashboards.md#runbook-2-high-queue-depth) |
| **Conversion timeouts** | >10 timeouts in 5min, LibreOffice hangs | Increase timeout, restart replicas, optimize templates | [dashboards.md](./dashboards.md#runbook-4-conversion-timeouts) |
| **Stuck locks** | Documents in PROCESSING, LockedUntil expired | Poller will reclaim after TTL (2 minutes) | [README.md](../README.md), [development-context.md](./development-context.md) |
| **Disk space full** | /tmp full, conversion failures | Clean /tmp directory, restart replicas | [RUNBOOKS.md](./RUNBOOKS.md#runbook-6-handling-stuck-containers) |
| **Certificate expiring** | Warning in Azure Portal, TLS errors | Rotate certificate, update Key Vault | [RUNBOOKS.md](./RUNBOOKS.md#runbook-3-key-and-certificate-rotation) |
| **Secret expired** | Authentication failures, app crashes on startup | Rotate secrets, update GitHub/Key Vault | [RUNBOOKS.md](./RUNBOOKS.md#runbook-3-key-and-certificate-rotation) |

---

## By Symptom

### "Service is down / Not responding"

**Diagnosis steps:**
1. Check health endpoint: `curl https://docgen-staging.../healthz`
2. Check Azure Portal: Container App status
3. View container logs: `az containerapp logs show ...`
4. Check Application Insights: Live Metrics

**Common causes:**
- Container startup failure → [DEPLOY.md](./DEPLOY.md#issue-container-wont-start)
- All replicas unhealthy → [RUNBOOKS.md](./RUNBOOKS.md#runbook-6-handling-stuck-containers)
- Deployment in progress → [DEPLOY.md](./DEPLOY.md#monitoring-deployments)
- Azure outage → Check [Azure Status](https://status.azure.com)

**Quick fix:**
```bash
# Restart Container App
az containerapp revision restart \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --revision <active-revision-name>
```

---

### "Requests are slow"

**Diagnosis steps:**
1. Check P95 duration in Application Insights
2. Review dependency performance (Salesforce, LibreOffice)
3. Check cache hit rate
4. Verify replica count and CPU usage

**Common causes:**
- Salesforce API slow → [dashboards.md](./dashboards.md#runbook-6-salesforce-api-degradation)
- LibreOffice conversion slow → [dashboards.md](./dashboards.md#runbook-4-conversion-timeouts)
- Low cache hit rate → [dashboards.md](./dashboards.md#runbook-5-low-cache-hit-rate)
- Insufficient replicas → [RUNBOOKS.md](./RUNBOOKS.md#runbook-2-scale-up-and-scale-down)

**Quick fix:**
```bash
# Scale up manually
az containerapp update \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --min-replicas 3 \
  --max-replicas 10
```

---

### "Errors / Failures"

**Diagnosis steps:**
1. Check Application Insights: Failures blade
2. Review container logs for exceptions
3. Check recent deployments (was there a recent change?)
4. Test health and readiness endpoints

**Common causes:**
- Recent bad deployment → [RUNBOOKS.md](./RUNBOOKS.md#runbook-1-manual-rollback-procedure)
- Salesforce authentication failure → [RUNBOOKS.md](./RUNBOOKS.md#issue-salesforce-authentication-failures)
- Template not found → [dashboards.md](./dashboards.md#runbook-1-high-failure-rate)
- Configuration error → [DEPLOY.md](./DEPLOY.md#environment-management)

**Quick fix:**
```bash
# Rollback to previous revision
az containerapp revision activate \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --revision <previous-good-revision>
```

---

### "Deployment failed"

**Diagnosis steps:**
1. Check GitHub Actions workflow logs
2. Review failed job details
3. Test Bicep locally: `az bicep build --file infra/main.bicep`
4. Verify Azure permissions and quotas

**Common causes:**
- Docker build error → [DEPLOY.md](./DEPLOY.md#issue-docker-build-fails)
- Bicep validation error → [DEPLOY.md](./DEPLOY.md#issue-bicep-deployment-fails)
- Missing secrets → [DEPLOY.md](./DEPLOY.md#issue-container-wont-start)
- Permission denied → [PROVISIONING.md](./PROVISIONING.md#prerequisites)

**Quick fix:**
- Fix issue locally, push new commit to trigger new deployment
- For manual override: [DEPLOY.md](./DEPLOY.md#method-2-manual-deployment)

---

### "Queue backing up"

**Diagnosis steps:**
1. Check queue depth: Application Insights → Custom Metrics → `queue_depth`
2. Check poller status: `curl https://docgen-staging.../worker/status`
3. Review processing rate and failures
4. Check conversion timeouts

**Common causes:**
- Poller disabled → Enable POLLER_ENABLED
- High conversion timeouts → [dashboards.md](./dashboards.md#runbook-4-conversion-timeouts)
- Insufficient replicas → [RUNBOOKS.md](./RUNBOOKS.md#runbook-2-scale-up-and-scale-down)
- Salesforce slow → [dashboards.md](./dashboards.md#runbook-6-salesforce-api-degradation)

**Quick fix:**
```bash
# Scale up to process queue faster
az containerapp update \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --min-replicas 5 \
  --max-replicas 10
```

**Detailed diagnosis:** [dashboards.md](./dashboards.md#runbook-2-high-queue-depth)

---

## By Component

### Container App

| Issue | Reference |
|-------|-----------|
| Container won't start | [DEPLOY.md](./DEPLOY.md#issue-container-wont-start) |
| Health checks failing | [DEPLOY.md](./DEPLOY.md#health-checks--validation) |
| Replica stuck/unhealthy | [RUNBOOKS.md](./RUNBOOKS.md#runbook-6-handling-stuck-containers) |
| Scaling issues | [RUNBOOKS.md](./RUNBOOKS.md#runbook-2-scale-up-and-scale-down) |
| Memory/CPU issues | [RUNBOOKS.md](./RUNBOOKS.md#runbook-6-handling-stuck-containers) |

### Key Vault

| Issue | Reference |
|-------|-----------|
| Access denied | [PROVISIONING.md](./PROVISIONING.md#issue-key-vault-access-denied) |
| Secrets not loading | [DEPLOY.md](./DEPLOY.md#issue-container-wont-start) |
| Secret rotation | [RUNBOOKS.md](./RUNBOOKS.md#runbook-3-key-and-certificate-rotation) |
| Missing secrets | [PROVISIONING.md](./PROVISIONING.md#step-7-populate-key-vault-secrets) |

### Container Registry

| Issue | Reference |
|-------|-----------|
| Image pull failed | [PROVISIONING.md](./PROVISIONING.md#issue-role-assignment-propagation) |
| Platform mismatch | [PROVISIONING.md](./PROVISIONING.md#issue-docker-platform-mismatch) |
| Authentication error | [DEPLOY.md](./DEPLOY.md#issue-container-wont-start) |
| Build failures | [DEPLOY.md](./DEPLOY.md#issue-docker-build-fails) |

### Salesforce

| Issue | Reference |
|-------|-----------|
| Authentication failures | [RUNBOOKS.md](./RUNBOOKS.md#issue-salesforce-authentication-failures) |
| API degradation | [dashboards.md](./dashboards.md#runbook-6-salesforce-api-degradation) |
| JWT key rotation | [RUNBOOKS.md](./RUNBOOKS.md#procedure-1-rotate-salesforce-jwt-private-key) |
| Maintenance window | [RUNBOOKS.md](./RUNBOOKS.md#runbook-7-database-and-salesforce-maintenance) |

### LibreOffice Conversion

| Issue | Reference |
|-------|-----------|
| Conversion timeouts | [dashboards.md](./dashboards.md#runbook-4-conversion-timeouts) |
| Pool exhaustion | [dashboards.md](./dashboards.md#runbook-2-high-queue-depth) |
| Memory leaks | [RUNBOOKS.md](./RUNBOOKS.md#runbook-6-handling-stuck-containers) |
| Process hangs | [dashboards.md](./dashboards.md#runbook-4-conversion-timeouts) |

### Application Insights

| Issue | Reference |
|-------|-----------|
| Telemetry not appearing | [dashboards.md](./dashboards.md) |
| Connection string invalid | [PROVISIONING.md](./PROVISIONING.md#step-5-capture-deployment-outputs) |
| High ingestion costs | [PROVISIONING.md](./PROVISIONING.md#cost-estimates) |
| Alerts not firing | [dashboards.md](./dashboards.md#alert-rules) |

---

## Escalation Path

### Level 1: Self-Service (0-30 minutes)

1. **Check this troubleshooting index** for quick fixes
2. **Review health endpoints**:
   ```bash
   curl https://docgen-staging.../healthz
   curl https://docgen-staging.../readyz
   ```
3. **Check container logs**:
   ```bash
   az containerapp logs show --name docgen-staging --resource-group docgen-staging-rg --tail 100
   ```
4. **Review Application Insights** for errors and performance

### Level 2: Documentation Review (30-60 minutes)

1. **Detailed troubleshooting guides**:
   - [DEPLOY.md](./DEPLOY.md#common-deployment-issues) for deployment issues
   - [dashboards.md](./dashboards.md) for operational incidents (6 runbooks)
   - [PROVISIONING.md](./PROVISIONING.md#troubleshooting) for infrastructure issues
   - [RUNBOOKS.md](./RUNBOOKS.md) for operational procedures

2. **Check recent changes**:
   ```bash
   git log --oneline --decorate --graph -10
   git diff HEAD~1 HEAD  # Review last commit
   ```

3. **Review deployment history**:
   - GitHub Actions: Recent workflow runs
   - Azure Portal: Container App → Revisions

### Level 3: Manual Intervention (1-2 hours)

1. **Restart services**:
   ```bash
   # Restart replica
   az containerapp replica restart ...

   # Restart entire app
   az containerapp revision restart ...
   ```

2. **Rollback deployment**:
   - Automatic: Triggered by CI/CD on failure
   - Manual: [RUNBOOKS.md](./RUNBOOKS.md#runbook-1-manual-rollback-procedure)

3. **Scale resources**:
   ```bash
   # Increase capacity
   az containerapp update --min-replicas 3 --max-replicas 10 ...
   ```

### Level 4: Emergency Procedures (2+ hours)

1. **Disaster recovery**: [RUNBOOKS.md](./RUNBOOKS.md#runbook-4-disaster-recovery)
2. **Environment rebuild**: [PROVISIONING.md](./PROVISIONING.md)
3. **Contact Azure Support**: For platform issues
4. **Contact Salesforce Support**: For Salesforce API issues

---

## Documentation Map

### Quick Start
- **[README.md](../README.md)** - Application overview and features
- **[DEPLOY.md](./DEPLOY.md)** - Day-to-day deployment guide

### Setup & Configuration
- **[PROVISIONING.md](./PROVISIONING.md)** - One-time environment setup (543 lines)
- **[infra/](../infra/)** - Bicep templates (infrastructure as code)
- **[.github/workflows/](../.github/workflows/)** - CI/CD workflows

### Operations
- **[RUNBOOKS.md](./RUNBOOKS.md)** - Operational procedures (7 runbooks, 894 lines)
- **[dashboards.md](./dashboards.md)** - Monitoring and incident response (6 runbooks, 857 lines)
- **[DEPLOY.md](./DEPLOY.md)** - Deployment troubleshooting

### Features
- **[template-authoring.md](./template-authoring.md)** - Template authoring guide (docx-templates)
- **[idempotency.md](./idempotency.md)** - Idempotency strategy (RequestHash)
- **[contentdocumentlink.md](./contentdocumentlink.md)** - File linking strategy

### Development
- **[development-context.md](./development-context.md)** - Developer onboarding (506 lines)
- **[development-tasks.md](./development-tasks.md)** - Task breakdown and progress

---

## Common Commands Reference

### Diagnosis Commands

```bash
# Health check
curl https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io/healthz

# Readiness check
curl https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io/readyz

# Container logs
az containerapp logs show \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --tail 100 \
  --follow

# List revisions
az containerapp revision list \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" \
  -o table

# List replicas
az containerapp replica list \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --revision <revision-name>

# Check GitHub workflow status
gh run list --workflow=deploy-staging.yml --limit 5
```

### Recovery Commands

```bash
# Restart replica
az containerapp replica restart \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --replica <replica-name>

# Restart revision
az containerapp revision restart \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --revision <revision-name>

# Activate previous revision (rollback)
az containerapp revision activate \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --revision <previous-revision-name>

# Scale up
az containerapp update \
  --name docgen-staging \
  --resource-group docgen-staging-rg \
  --min-replicas 3 \
  --max-replicas 10
```

---

## Getting Help

**For operational issues:**
1. Check this index for quick fixes
2. Review relevant runbooks in [dashboards.md](./dashboards.md)
3. Follow escalation path above

**For deployment issues:**
1. Review [DEPLOY.md](./DEPLOY.md#common-deployment-issues)
2. Check GitHub Actions logs
3. Validate Bicep locally

**For infrastructure issues:**
1. Review [PROVISIONING.md](./PROVISIONING.md#troubleshooting)
2. Check Azure Portal for resource status
3. Verify RBAC roles and permissions

**For development questions:**
1. Read [development-context.md](./development-context.md)
2. Review feature-specific docs
3. Check inline code comments

---

**Last Updated**: 2025-11-11
**Version**: 1.0
**Maintainer**: Docgen Team
