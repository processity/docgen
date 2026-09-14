# Named Credential Setup Guide

This guide walks through configuring the Salesforce Named Credential for the Docgen Node API, enabling secure OAuth 2.0 client credentials authentication via Azure AD.

## Prerequisites

- Azure AD app registration completed (see `azure-ad-config.md`)
- Salesforce org with API access
- System Administrator or equivalent permissions

## Overview

The Named Credential setup consists of two components:

1. **External Credential**: Stores Azure AD OAuth 2.0 configuration
2. **Named Credential**: Defines the Node API endpoint and links to the External Credential

For the admin Status-page **Connect / Reconnect** flow, including one-time backend
and OAuth callback configuration, see [Backend reconnect](backend-reconnect.md).

## Defaults and migration

When `Docgen_Settings__c.Named_Credential_Name__c` is blank (or no setting exists),
Docgen reads `Organization.IsSandbox` and uses:

| Org type | Named Credential | Packaged endpoint |
| --- | --- | --- |
| Sandbox | `Docgen_Node_API_Sandbox` | `https://docgen-uat.mangostone-78031136.eastus.azurecontainerapps.io` |
| Non-sandbox | `Docgen_Node_API` | Existing production endpoint |

A nonblank hierarchy setting (user, profile, or org) continues to override the default.
Generation, worker wake-up, status calls, and diagnostic scripts use the same resolver.
Both Named Credentials link to `Docgen_AAD_Credential`, named principal `Main`.

`Docgen_Node_API_CI` and its separate External Credential are retired from source.
After installing/deploying this change:

1. Configure `Docgen_AAD_Credential` / `Main` with the Entra client ID and secret for
   the org, and assign `Docgen_User` to users who make callouts.
2. Clear old CI overrides at the org/profile/user levels in sandbox orgs, or set
   them to `Docgen_Node_API_Sandbox`. An explicit `Docgen_Node_API` setting in UAT
   must also be cleared/changed to use the new default. Nonblank values are never
   silently redirected.
3. Scratch/CI tests explicitly select `Docgen_Node_API_Sandbox` and replace its URL
   with their own backend URL. Do not generate scratch-org documents against UAT.
4. Verify connectivity before removing legacy credentials from existing orgs.
   Removing source metadata does not itself delete an installed org's components.

The default fixes endpoint selection after refresh. Salesforce still requires the
External Credential principal secrets to be populated again after refresh; backend
Salesforce authentication must also match the refreshed org.
[Salesforce sandbox credential considerations](https://help.salesforce.com/s/articleView?id=sf.nc_considerations.htm&language=en_US&type=5).

Example UAT configuration using credentials supplied through environment variables:

```bash
./scripts/configure-external-credential.sh UipathUatfull SANDBOX
./scripts/configure-named-credential.sh UipathUatfull \
  https://docgen-uat.mangostone-78031136.eastus.azurecontainerapps.io
sf apex run --file scripts/TestNamedCredentialCallout.apex --target-org UipathUatfull
```

The credential helper sets an explicit override. In an actual sandbox, clear that
setting afterward if you prefer automatic org-type selection. For production, use
`PRODUCTION` with the credential helper and pass `Docgen_Node_API` as the URL helper's
third argument. Keep secrets out of source control.

## Part 1: Configure External Credential

### Step 1: Navigate to External Credentials

1. Log in to Salesforce
2. Go to **Setup** → Search for "Named Credentials"
3. Click **Named Credentials** (under "Security")
4. Click the **External Credentials** tab
5. Click **New** (or edit existing `Docgen_AAD_Credential`)

### Step 2: Configure OAuth Settings

**Basic Information**:
- **Label**: `Docgen AAD Credential`
- **Name**: `Docgen_AAD_Credential` (auto-populated)
- **Authentication Protocol**: `OAuth 2.0`

**Authentication Settings**:
- **OAuth Flow**: `Client Credentials`
- **Token Endpoint URL**:
  ```
  https://login.microsoftonline.com/d8353d2a-b153-4d17-8827-902c51f72357/oauth2/v2.0/token
  ```
  *(From azure-ad-config.md - do not change)*

**Scope Configuration**:
- **Scope**:
  ```
  api://f42d24be-0a17-4a87-bfc5-d6cd84339302/.default
  ```
  *(This matches the Application ID URI in Azure AD)*

**Custom Headers** (Optional - already in metadata):
- Header 1: `Content-Type` = `application/json`
- Header 2: `Accept` = `application/json`

### Step 3: Save External Credential

Click **Save**. You'll be taken to the External Credential detail page.

### Step 4: Create Principal

1. Scroll to **Principals** related list
2. Click **New**
3. Configure:
   - **Principal Name**: `Main`
   - **Sequence Number**: `1`
4. Click **Save**

### Step 5: Add Authentication Parameters

After saving the principal, you'll see **Authentication Parameters** section:

1. Click **New** to add Client ID parameter:
   - **Parameter Name**: `ClientId`
   - **Value**:
     ```
     f42d24be-0a17-4a87-bfc5-d6cd84339302
     ```
     *(From azure-ad-config.md)*
   - Click **Save**

2. Click **New** to add Client Secret parameter:
   - **Parameter Name**: `ClientSecret`
   - **Value**: Paste your Azure AD application client secret here
     ```
     [REDACTED - Use your actual Azure AD Client Secret]
     ```
     ⚠️ **WARNING**: Client secrets expire. Note the expiration date and add a calendar reminder!
   - Click **Save**

**Security Note**: The client secret is encrypted at rest by Salesforce. It will never appear in metadata exports or API calls.

---

## Part 2: Configure Named Credential

### Step 1: Navigate to Named Credentials

1. From **Setup** → **Named Credentials**
2. Click the **Named Credentials** tab
3. Edit `Docgen_Node_API_Sandbox` for a sandbox, or `Docgen_Node_API` for a non-sandbox org

### Step 2: Configure Named Credential

**Basic Information**:
- **Label**: `Docgen Node API (Sandbox)` or `Docgen Node API`
- **Name**: `Docgen_Node_API_Sandbox` or `Docgen_Node_API`

**URL Configuration**:
- **URL**: Choose based on environment:
  - **Local Development**: `http://localhost:8080`
    - ⚠️ Salesforce **cannot** call localhost from the cloud. Use this only for local Apex test execution.
  - **Sandbox / UAT**: `https://docgen-uat.mangostone-78031136.eastus.azurecontainerapps.io`
  - **Scratch Org / CI**: Explicitly repoint `Docgen_Node_API_Sandbox` to the backend connected to that scratch org
  - **Production**: Azure Container Apps endpoint (configured in T-16):
    ```
    https://docgen-api-<unique>.ukwest.azurecontainerapps.io
    ```

**Authentication**:
- **External Credential**: `Docgen_AAD_Credential`
- **Authentication Protocol**: `OAuth 2.0` (auto-selected based on External Credential)
- **Principal**: `Main`

**Callout Options**:
- **Generate Authorization Header**: ✅ Checked
- **Allow Merge Fields in HTTP Header**: ✅ Checked (optional)
- **Allow Merge Fields in HTTP Body**: ✅ Checked (optional)
- **Callout Status**: `Enabled`

### Step 3: Save Named Credential

Click **Save**.

---

## Part 3: Verify Configuration

### Test 1: Check Token Acquisition

From Salesforce Developer Console:

```apex
// Test callout (will fail if Node API not running, but proves auth works)
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:' + DocgenConnectionConfig.getNamedCredentialName() + '/healthz');
req.setMethod('GET');

Http http = new Http();
HTTPResponse res = http.send(req);

System.debug('Status: ' + res.getStatusCode());
System.debug('Body: ' + res.getBody());
```

**Expected Results**:
- If Node API is running: `200 OK` with `{"status":"ok"}`
- If Node API is not running: `Connection refused` or timeout (auth still worked)
- If auth fails: `401 Unauthorized` (check client ID/secret)

### Test 2: Verify Authorization Header

Enable **Setup → Debug Logs** with `Callout` level set to `FINEST`:

1. Run the test code above
2. Download the debug log
3. Search for `Authorization` header
4. You should see: `Authorization: Bearer eyJ0eXAiOi...` (JWT token)

### Test 3: Full Integration Test

Once Node API is deployed (T-08 onwards), run:

```apex
Account acc = new Account(Name = 'Test Account', AnnualRevenue = 1000000);
insert acc;

Docgen_Template__c tmpl = new Docgen_Template__c(
    Name = 'Test Template',
    TemplateContentVersionId__c = '068xxxxxxxxxxxx', // Use a real template ID
    DataSource__c = 'SOQL',
    SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId'
);
insert tmpl;

String downloadUrl = DocgenController.generate(tmpl.Id, acc.Id, 'PDF');
System.debug('Download URL: ' + downloadUrl);
```

**Expected**: Download URL returned, Generated_Document__c created with `SUCCEEDED` status.

---

## Troubleshooting

### Issue: "Unauthorized endpoint" error

**Cause**: Named Credential endpoint not added to Remote Site Settings.

**Solution**:
1. Go to **Setup → Remote Site Settings**
2. Add the Node API URL:
   - **Remote Site Name**: `Docgen_Node_API`
   - **Remote Site URL**: Your Node API base URL
   - **Active**: ✅ Checked

### Issue: 403 Forbidden / Token Version Mismatch

**Symptoms**:
- 403 errors when calling Node API from Salesforce
- Authentication fails despite correct client ID and secret
- Token validation errors in Node API logs

**Cause**: Named Credential configured with Azure AD v1.0 endpoint instead of v2.0

**Solution**:
1. Update External Credential Token Endpoint URL from:
   ```
   https://login.microsoftonline.com/<tenant-id>/oauth2/token
   ```
   to:
   ```
   https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
   ```
2. Verify the metadata reflects v2.0:
   - Check `force-app/main/default/externalCredentials/Docgen_AAD_Credential.externalCredential-meta.xml`
   - Line 20 should contain `/oauth2/v2.0/token`
3. Redeploy the External Credential metadata to production

**Why this matters**: Azure AD v1.0 tokens use issuer `https://sts.windows.net/<tenant-id>/` while v2.0 tokens use `https://login.microsoftonline.com/<tenant-id>/v2.0`. The Node API validates v2.0 tokens, so using v1.0 endpoint causes authentication failures.

### Issue: "Invalid client" error from Azure AD

**Causes**:
- Client ID mismatch
- Client secret incorrect or expired
- Scope incorrect

**Solution**:
1. Verify Client ID matches: `f42d24be-0a17-4a87-bfc5-d6cd84339302`
2. Verify Client Secret is correct (from Azure Portal or `azure-ad-config.md`)
3. Check secret expiration: **2027-11-06**
4. Verify scope format: `api://<client-id>/.default`

### Issue: 401 Unauthorized from Node API

**Cause**: JWT validation failing in Node API (T-08).

**Debugging**:
1. Copy the access token from debug logs
2. Paste into https://jwt.io/
3. Check the `aud` claim matches: `api://f42d24be-0a17-4a87-bfc5-d6cd84339302`
4. Check the `iss` claim matches: `https://login.microsoftonline.com/d8353d2a-b153-4d17-8827-902c51f72357/v2.0`
5. Check `exp` (expiration) hasn't passed

**Fix**: Ensure Node API's `AZURE_TENANT_ID`, `CLIENT_ID`, and `ISSUER` env vars match values in `azure-ad-config.md`.

### Issue: "Remote endpoint is not accessible"

**Causes**:
- Node API not running
- URL misconfigured
- Network/firewall blocking

**Solutions**:
- **Local dev**: Cannot call `localhost` from Salesforce cloud. Use ngrok or deploy to Azure.
- **Sandbox**: Verify URL is publicly accessible
- **Production**: Check Azure Container Apps ingress configuration

---

## Environment-Specific Configuration

### Local Development

Named Credential URL: `http://localhost:8080`

**Limitation**: Salesforce cloud cannot reach localhost. Options:
1. Use **Execute Anonymous** in Developer Console (runs server-side but still can't reach localhost)
2. Use **ngrok**:
   ```bash
   ngrok http 8080
   # Update Named Credential URL to: https://xxxx.ngrok.io
   ```
3. Deploy to Azure for testing

### Scratch Org / Sandbox

Named Credential URL: Temporary Azure deployment or ngrok tunnel

**Recommendation**: Use a dedicated dev Azure Container Apps instance with auto-deploy from `develop` branch.

### Production

Named Credential URL: `https://docgen-api-<unique>.ukwest.azurecontainerapps.io`

**Setup in T-16**: Infrastructure deployment includes:
- Azure Container Apps with HTTPS ingress
- Managed Identity for Key Vault access
- Auto-scaling configuration

---

## Security Best Practices

### Secret Rotation

Client secret expires: **2027-11-06**

**Rotation Process** (before expiration):

1. **Create new secret in Azure AD**:
   ```bash
   az ad app credential reset --id f42d24be-0a17-4a87-bfc5-d6cd84339302 \
     --append \
     --display-name "Salesforce-NC-Secret-2" \
     --years 2
   ```
   *(Note the new secret value)*

2. **Update Salesforce External Credential**:
   - Go to External Credential → Principal → Authentication Parameters
   - Edit `ClientSecret` parameter
   - Paste new secret value
   - Save

3. **Test authentication** with new secret

4. **Delete old secret** from Azure AD:
   ```bash
   az ad app credential delete --id f42d24be-0a17-4a87-bfc5-d6cd84339302 \
     --key-id <old-key-id>
   ```

### Audit & Monitoring

**Salesforce Side**:
- Monitor: **Setup → Security Center → Event Monitoring**
- Event type: `API` (filter by Named Credential)
- Track failed authentication attempts

**Azure AD Side**:
- Monitor: **Azure Portal → Azure AD → Sign-ins**
- Filter by Application ID: `f42d24be-0a17-4a87-bfc5-d6cd84339302`
- Alert on failed sign-ins

**Node API Side** (T-15):
- Application Insights logs JWT validation failures
- Alert on 401 spikes

---

## Metadata Deployment

The External Credential and Named Credential are partially defined in metadata:

**Included in source control**:
- `force-app/main/default/externalCredentials/Docgen_AAD_Credential.externalCredential-meta.xml`
- `force-app/main/default/namedCredentials/Docgen_Node_API.namedCredential-meta.xml`
- `force-app/main/default/namedCredentials/Docgen_Node_API_Sandbox.namedCredential-meta.xml`

**NOT included** (configured via UI):
- Client Secret (security best practice)
- Principal authentication parameters

**Deployment Steps**:
1. Deploy metadata: `sfdx force:source:deploy -p force-app/main/default/externalCredentials,force-app/main/default/namedCredentials`
2. Manually configure Principal and add Client ID + Client Secret via UI
3. Update Named Credential URL to match environment

**Alternative** (Salesforce DX scratch orgs):
Create a post-install script that uses Metadata API to set authentication parameters (if deploying to many scratch orgs frequently).

---

## Next Steps

After completing Named Credential setup:

1. ✅ Test authentication (see Part 3)
2. ⏭️ **T-07**: Implement LWC button UI
3. ⏭️ **T-08**: Add AAD JWT validation in Node API
4. ⏭️ **T-09**: Implement Node → Salesforce auth (JWT Bearer Flow)

---

## Quick Reference

| Configuration | Value |
|---------------|-------|
| **Tenant ID** | `d8353d2a-b153-4d17-8827-902c51f72357` |
| **Client ID** | `f42d24be-0a17-4a87-bfc5-d6cd84339302` |
| **Token Endpoint** | `https://login.microsoftonline.com/d8353d2a-b153-4d17-8827-902c51f72357/oauth2/v2.0/token` |
| **Scope** | `api://f42d24be-0a17-4a87-bfc5-d6cd84339302/.default` |
| **Secret Expires** | 2027-11-06 |
| **Default Named Credential** | Sandbox: `Docgen_Node_API_Sandbox`; non-sandbox: `Docgen_Node_API` |
| **Callout Syntax** | `callout:<resolved Named Credential>/generate` |

---

**Document Version**: 1.0
**Last Updated**: 2025-11-06
**Related**: `azure-ad-config.md`, `development-context.md`, ADR 0002 (Authentication)
