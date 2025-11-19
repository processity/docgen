# Scripts Reference

This document provides detailed information about all helper scripts in the `scripts/` directory.

## Prerequisites

All scripts require the Salesforce CLI (`sf`) to be installed and a Dev Hub to be authenticated.

### Environment Variables

Several scripts require environment variables to be set:

| Variable | Required By | Description |
|----------|-------------|-------------|
| `AAD_CLIENT_ID` | `setup-scratch-org.sh`<br/>`configure-external-credential.sh` | Azure AD Application (client) ID for backend authentication |
| `AAD_CLIENT_SECRET` | `setup-scratch-org.sh`<br/>`configure-external-credential.sh` | Azure AD Client Secret value |
| `BACKEND_URL` | `configure-named-credential.sh` | Backend API URL (e.g., `https://docgen-ci.bravemeadow-58840dba.eastus.azurecontainerapps.io`) |

You can find Azure AD credentials in `azure-ad-config.md`.

## Scratch Org Management

### setup-scratch-org.sh

**Purpose:** Complete automated scratch org setup with full configuration

**Usage:**
```bash
export AAD_CLIENT_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"
export AAD_CLIENT_SECRET="your-secret-here"
./scripts/setup-scratch-org.sh [org-alias]
```

**What it does:**
1. ✅ Validates `AAD_CLIENT_ID` and `AAD_CLIENT_SECRET` are set (fails early if not)
2. ✅ Creates scratch org (default: 7 days, alias: docgen-dev)
3. ✅ Deploys main metadata (custom objects, Apex classes, LWC components)
4. ✅ Deploys test metadata
5. ✅ Creates and uploads test DOCX template
6. ✅ Assigns Docgen_User permission set
7. ✅ Configures External Credential with AAD credentials
8. ✅ Configures Custom Settings to use CI Named Credential
9. ✅ Tests Named Credential connectivity with backend
10. ✅ Runs Apex tests to verify deployment

**Duration:** ~5-7 minutes

**Exit codes:**
- `0` - Success
- `1` - Missing environment variables or other errors

---

### delete-scratch-org.sh

**Purpose:** Delete a scratch org

**Usage:**
```bash
./scripts/delete-scratch-org.sh [org-alias]
```

**Example:**
```bash
./scripts/delete-scratch-org.sh docgen-dev
```

---

## Credential Configuration

### configure-external-credential.sh

**Purpose:** Configure AAD External Credential for backend authentication

**Usage:**
```bash
export AAD_CLIENT_ID="your-client-id"
export AAD_CLIENT_SECRET="your-client-secret"
./scripts/configure-external-credential.sh [org-alias] [client-id] [secret]
```

**Parameters:**
- `org-alias` (optional) - Salesforce org alias (default: `docgen-dev`)
- `client-id` (optional) - Azure AD Client ID (falls back to `AAD_CLIENT_ID` env var)
- `secret` (optional) - Azure AD Client Secret (falls back to `AAD_CLIENT_SECRET` env var)

**What it does:**
1. Validates inputs
2. Prepares Apex script from template (`ConfigureExternalCredential.apex`)
3. Creates/updates External Credential `Docgen_AAD_Credential_CI` with principal `CI`
4. Sets Client ID (unencrypted) and Client Secret (encrypted)
5. Configures Custom Settings to use `Docgen_Node_API_CI`

**Example:**
```bash
# Using environment variables
export AAD_CLIENT_ID="your-client-id-here"
export AAD_CLIENT_SECRET="your-client-secret-here"
./scripts/configure-external-credential.sh docgen-dev

# Using arguments
./scripts/configure-external-credential.sh docgen-dev "your-client-id" "your-client-secret"
```

---

### configure-named-credential.sh

**Purpose:** Configure Named Credential URL for backend API

**Usage:**
```bash
export BACKEND_URL="https://your-backend.azurecontainerapps.io"
./scripts/configure-named-credential.sh [org-alias] [backend-url]
```

**Parameters:**
- `org-alias` (optional) - Salesforce org alias (default: `docgen-dev`)
- `backend-url` (optional) - Backend URL (falls back to `BACKEND_URL` env var)

**What it does:**
1. Validates backend URL (must start with `https://`)
2. Prepares Apex script from template (`ConfigureNamedCredential.apex`)
3. Updates Named Credential `Docgen_Node_API_CI` with the backend URL

**Example:**
```bash
./scripts/configure-named-credential.sh docgen-dev "https://docgen-ci.bravemeadow-58840dba.eastus.azurecontainerapps.io"
```

---

### configure-ci-backend-for-scratch-org.sh

**Purpose:** Configure CI backend to authenticate against a scratch org

**Usage:**
```bash
./scripts/configure-ci-backend-for-scratch-org.sh [org-alias]
```

**What it does:**
1. Extracts SFDX Auth URL from scratch org
2. Updates Azure Key Vault secret `SFDX-AUTH-URL`
3. Restarts Container App to pick up new credentials
4. Waits for backend health check to pass

**Prerequisites:**
- Azure CLI installed and authenticated
- CI backend deployed (resource group: `docgen-ci-rg`)

**Example:**
```bash
./scripts/configure-ci-backend-for-scratch-org.sh docgen-dev
```

---

## Testing & Verification

### TestNamedCredentialCallout.apex

**Purpose:** Test Named Credential connectivity with backend (authenticated endpoint)

**Usage:**
```bash
sf apex run --file scripts/TestNamedCredentialCallout.apex --target-org docgen-dev
```

**What it tests:**
- Makes callout to `/worker/status` endpoint (requires authentication)
- Verifies AAD OAuth2 authentication is working
- Confirms backend is reachable
- Returns worker status (isRunning, currentQueueDepth, lastPollTime)

**Expected output:**
```
✅ Named Credential is working correctly!
✅ Backend is reachable and healthy
Response Body: {"isRunning":true,"currentQueueDepth":0,"lastPollTime":"..."}
```

---

### VerifyCredentialStatus.apex

**Purpose:** Check configuration status of External Credential and Named Credential

**Usage:**
```bash
sf apex run --file scripts/VerifyCredentialStatus.apex --target-org docgen-dev
```

**What it checks:**
- External Credential `Docgen_AAD_Credential_CI` exists
- Principal `CI` is configured
- Authentication status (Configured/NotConfigured)
- Named Credential `Docgen_Node_API_CI` parameters

---

## Deployment Scripts

### deploy-to-org.sh

**Purpose:** Deploy metadata to an existing org

**Usage:**
```bash
./scripts/deploy-to-org.sh [org-alias]
```

---

### run-apex-tests.sh

**Purpose:** Run Apex tests in an org

**Usage:**
```bash
./scripts/run-apex-tests.sh [org-alias]
```

---

## Apex Templates

These are template files used by the shell scripts. They contain placeholders that are replaced via `sed` substitution:

### ConfigureExternalCredential.apex

Template for configuring External Credential with AAD credentials.

**Placeholders:**
- `{{CLIENT_ID}}` - Replaced with Azure AD Client ID
- `{{CLIENT_SECRET}}` - Replaced with Azure AD Client Secret

---

### ConfigureCustomSettings.apex

Template for configuring Docgen Custom Settings.

**Placeholders:**
- `{{NAMED_CREDENTIAL}}` - Replaced with Named Credential name (e.g., `Docgen_Node_API_CI`)

---

### ConfigureNamedCredential.apex

Template for configuring Named Credential URL.

**Placeholders:**
- `{{BACKEND_URL}}` - Replaced with backend URL

---

## Common Workflows

### Setting up a new scratch org for development

```bash
# 1. Set credentials
export AAD_CLIENT_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"
export AAD_CLIENT_SECRET="your-secret-from-azure-ad-config"

# 2. Run setup script
./scripts/setup-scratch-org.sh

# 3. Open org
sf org open --target-org docgen-dev

# 4. Run E2E tests
npm run test:e2e
```

### Reconfiguring credentials in an existing org

```bash
# Update AAD credentials
export AAD_CLIENT_ID="new-client-id"
export AAD_CLIENT_SECRET="new-secret"
./scripts/configure-external-credential.sh docgen-dev

# Update backend URL
./scripts/configure-named-credential.sh docgen-dev "https://new-backend-url.com"

# Test connectivity
sf apex run --file scripts/TestNamedCredentialCallout.apex --target-org docgen-dev
```

### Connecting CI backend to a new scratch org

```bash
# 1. Create scratch org
./scripts/setup-scratch-org.sh temp-test-org

# 2. Configure CI backend to use it
./scripts/configure-ci-backend-for-scratch-org.sh temp-test-org

# 3. Run E2E tests
npm run test:e2e
```

---

## Troubleshooting

### "AAD_CLIENT_ID environment variable is not set"

**Solution:** Set the environment variables before running the script:
```bash
export AAD_CLIENT_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"
export AAD_CLIENT_SECRET="your-secret"
```

Find these values in `azure-ad-config.md`.

---

### "Named Credential is not fully configured"

**Cause:** External Credential principal is missing or credentials are incorrect.

**Solution:** Run the configuration script:
```bash
./scripts/configure-external-credential.sh docgen-dev
```

---

### "Callout failed" when testing Named Credential

**Possible causes:**
1. Backend is not running or not accessible
2. External Credential not configured
3. Named Credential URL is incorrect

**Solution:**
```bash
# 1. Check backend health
curl https://docgen-ci.bravemeadow-58840dba.eastus.azurecontainerapps.io/healthz

# 2. Reconfigure credentials
./scripts/configure-external-credential.sh docgen-dev

# 3. Test again
sf apex run --file scripts/TestNamedCredentialCallout.apex --target-org docgen-dev
```

---

## Script Dependencies

```
setup-scratch-org.sh
├── ConfigureExternalCredential.apex
├── ConfigureCustomSettings.apex
└── TestNamedCredentialCallout.apex

configure-external-credential.sh
├── ConfigureExternalCredential.apex
└── ConfigureCustomSettings.apex

configure-named-credential.sh
└── ConfigureNamedCredential.apex

configure-ci-backend-for-scratch-org.sh
└── (Azure CLI + jq)
```

---

## Best Practices

1. **Always set environment variables** before running scripts that require them
2. **Use version control** for your `.env` files locally (but never commit them)
3. **Test connectivity** after configuration changes using `TestNamedCredentialCallout.apex`
4. **Use meaningful org aliases** when creating multiple scratch orgs
5. **Clean up old scratch orgs** regularly to avoid hitting limits

---

## See Also

- [Quick Start Guide](quick-start.md) - Complete setup walkthrough
- [Admin Guide](admin-guide.md) - Production org configuration
- [Testing Guide](testing.md) - Running tests
- [Troubleshooting](troubleshooting-index.md) - Common issues and solutions
