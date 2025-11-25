# Repointing Staging Environment to a New Salesforce Org

This document describes how to repoint the staging environment to a new Salesforce org, which is commonly needed when staging sandboxes are refreshed.

## Prerequisites

Before running the repointing script, ensure you have:

### 1. Azure Access
- Azure CLI installed (`az --version`)
- Authenticated to Azure (`az login`)
- Key Vault Secrets Officer role on `docgen-staging-kv`
- Contributor access to the `docgen-staging` container app

### 2. Salesforce Setup
In the new Salesforce org, you need:

1. **Connected App** configured with:
   - JWT Bearer Flow enabled
   - Digital certificate uploaded (public key)
   - OAuth scopes: `api`, `refresh_token`, `offline_access`
   - Permitted Users: "Admin approved users are pre-authorized"

2. **Integration User** with:
   - System Administrator profile (or custom profile with appropriate permissions)
   - Pre-authorized on the Connected App
   - Permissions for:
     - Files: Create, Read, Update
     - Custom Objects: Read/Write on DocGen objects
     - Apex REST services access

3. **Private Key File**:
   - The RSA private key matching the public certificate in the Connected App
   - Usually located at `./keys/server.key`

## Using the Repointing Script

The `repoint-staging-to-salesforce.sh` script automates the process of updating all necessary Key Vault secrets and restarting the application.

### Interactive Mode
Simply run the script and it will prompt for required values:
```bash
./scripts/repoint-staging-to-salesforce.sh
```

### Command Line Mode
Provide all values directly:
```bash
./scripts/repoint-staging-to-salesforce.sh \
  -d mycompany.my.salesforce.com \
  -u integration@mycompany.com \
  -c 3MVG9DREgiBqN9Wlj... \
  -k ./keys/server.key
```

### Dry Run Mode
Test what would be changed without making actual updates:
```bash
./scripts/repoint-staging-to-salesforce.sh --dry-run \
  -d mycompany.my.salesforce.com \
  -u integration@mycompany.com \
  -c 3MVG9DREgiBqN9Wlj...
```

### With Backup
Create a backup of current values before updating:
```bash
./scripts/repoint-staging-to-salesforce.sh --backup \
  -d mycompany.my.salesforce.com \
  -u integration@mycompany.com \
  -c 3MVG9DREgiBqN9Wlj...
```

## Script Options

| Option | Description | Example |
|--------|-------------|---------|
| `-d, --domain` | Salesforce domain | `company.my.salesforce.com` |
| `-u, --username` | Integration user username | `integration@company.com` |
| `-c, --client-id` | Connected App Client ID | `3MVG9xxx...` |
| `-k, --key-file` | Path to private key | `./keys/server.key` |
| `-b, --backup` | Backup current values | (flag, no value) |
| `--dry-run` | Preview changes only | (flag, no value) |
| `-h, --help` | Show help | (flag, no value) |

## What the Script Does

1. **Validates Prerequisites**:
   - Checks Azure CLI authentication
   - Verifies Key Vault access
   - Validates all inputs
   - Checks private key file exists

2. **Updates Key Vault Secrets**:
   - `SF-DOMAIN`: The Salesforce org domain
   - `SF-USERNAME`: Integration user username
   - `SF-CLIENT-ID`: Connected App Client ID
   - `SF-PRIVATE-KEY`: RSA private key for JWT authentication

3. **Restarts Container App**:
   - Identifies the current active revision
   - Restarts it to pick up new secrets

4. **Validates Connection**:
   - Checks `/healthz` endpoint for app health
   - Checks `/readyz` endpoint for Salesforce connectivity

## Verification Steps

After running the script:

1. **Check Application Health**:
   ```bash
   curl https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io/healthz
   ```
   Should return: `{"status":"healthy"}`

2. **Check Salesforce Connectivity**:
   ```bash
   curl https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io/readyz
   ```
   Should return: `{"status":"ready","salesforce":"connected"}`

3. **Test Document Generation**:
   - Log into the new Salesforce org
   - Navigate to a record with DocGen button
   - Generate a test document

4. **Monitor Logs**:
   - Check Application Insights for any authentication errors
   - Look for successful JWT token exchanges

## Troubleshooting

### Authentication Failures
If you see authentication errors after repointing:

1. **Verify Connected App Settings**:
   - JWT Bearer Flow is enabled
   - Certificate matches the private key
   - Client ID is correct

2. **Check Integration User**:
   - User exists and is active
   - Pre-authorized on Connected App
   - Has necessary permissions

3. **Validate Private Key**:
   - File exists at specified path
   - Format is PEM (begins with `-----BEGIN RSA PRIVATE KEY-----`)
   - Matches the public certificate in Salesforce

### Container App Not Restarting
If the automatic restart fails:

1. Manual restart via Azure Portal:
   - Navigate to the Container App
   - Go to "Revisions and replicas"
   - Restart the active revision

2. Manual restart via CLI:
   ```bash
   az containerapp revision restart \
     --name docgen-staging \
     --resource-group docgen-staging-rg \
     --revision [revision-name]
   ```

### Rollback Process
If you need to revert to previous settings:

1. If you used `--backup`, check the backup file created
2. Run the script again with the previous values
3. Or manually update each secret:
   ```bash
   az keyvault secret set --vault-name docgen-staging-kv \
     --name SF-DOMAIN --value "old-domain.my.salesforce.com"
   ```

## Security Considerations

- The private key file should be kept secure and not committed to version control
- Use Azure Key Vault RBAC to limit who can update staging secrets
- Rotate private keys periodically
- Monitor Application Insights for unauthorized access attempts

## Related Documentation

- [Provision Environment Script](./provision-environment.sh) - Full environment setup
- [Development Context](../development-context.md) - Project overview
- [Azure Key Vault Docs](https://docs.microsoft.com/en-us/azure/key-vault/)
- [Salesforce JWT Bearer Flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm)