# Connect and reconnect a Docgen backend

The Status page's **Connect / Reconnect** button restores the Salesforce-to-Azure
External Credential and verifies a fresh Azure-to-Salesforce JWT login. It uses
`DocgenConnectionConfig`: a nonblank `Docgen_Settings__c.Named_Credential_Name__c`
override wins; otherwise sandbox orgs use `Docgen_Node_API_Sandbox` and non-sandbox
orgs use `Docgen_Node_API`. The override is a hierarchy Custom Setting, not Custom
Metadata. The button reads the selected Named Credential's actual URL and linked
External Credential; it does not overwrite either endpoint or the setting.

## One-time setup

Deploy the backend code and install/deploy the Salesforce components before enabling
reconnect. These instructions do not imply that deployment or configuration has occurred.

1. Assign **Docgen_User** and **Docgen_Admin** to the administrators who
   will reconnect the org. They also need the Salesforce permissions required to
   manage Named Credentials and API access. The button is hidden from other users;
   the server enforces the same custom permission.
2. Keep the existing backend Salesforce JWT configuration: `SF_DOMAIN`,
   `SF_CLIENT_ID`, `SF_PRIVATE_KEY`, and the integration username. UAT uses
   `integration@uipath.com.uatfull`; production uses `integration@uipath.com` when
   its updated deployment configuration is applied. The integration user must be
   active, have the necessary API/object access, and be preauthorized for the app.
3. On the Salesforce OAuth app identified by the backend's `SF_CLIENT_ID`, allow
   the web-server authorization flow with PKCE and `api` / `openid` scopes. Authorize
   the reconnect administrators to use that app as well as the integration user. Add
   `<backend-base-url>/connect/callback` to the app's allowed callback URLs. Keep
   the certificate matching the backend's existing private key. The admin token
   exchange uses the app's consumer secret when `DOCGEN_RECONNECT_SF_CLIENT_SECRET`
   is configured. Store it in Key Vault as `DOCGEN-RECONNECT-SF-CLIENT-SECRET` or
   supply it through a Container App secret reference (standard name:
   `docgen-reconnect-sf`). This is the **Salesforce** consumer secret, separate
   from the **Entra** secret in step 5. If omitted, the backend retains certificate
   `client_assertion` authentication for installations that support it. UAT currently
   rejects that certificate client-authentication path, even though the integration
   user's JWT bearer login works; use the consumer secret for its admin exchange.
   No admin refresh token is stored, and the integration user still uses its JWT key.
4. Set backend environment variable `DOCGEN_RECONNECT_PUBLIC_URL` to the selected
   Named Credential's exact HTTPS base URL. For UAT:
   `https://docgen-uat.mangostone-78031136.eastus.azurecontainerapps.io`.
   This is the stable public URL, not a revision-specific Container App URL.
5. Store the Entra client secret corresponding to the backend's `CLIENT_ID` in
   Key Vault as **`DOCGEN-RECONNECT-AAD-CLIENT-SECRET`**, readable by the backend's
   managed identity. Alternatively supply `DOCGEN_RECONNECT_AAD_CLIENT_SECRET`
   through a Container App secret reference. Never commit the secret to the repo.
   Key Vault takes precedence when its value exists. The secret lookup is enabled
   only when `DOCGEN_RECONNECT_PUBLIC_URL` is configured.
6. The selected Named Credential must have one External Credential using
   `ClientCredentialsClientSecretBasic`, with one named principal. Its Entra token
   URL and scope must match the backend's tenant and application. The existing
   `Docgen_AAD_Credential` / `Main` meets that structure. A custom Named Credential
   can use a different External Credential/principal name with the same compatible
   authentication configuration.

After a refresh, the OAuth app must either remain available or be restored/recreated
by a Salesforce administrator. The Status-page modal accepts the new consumer key
and secret, so an Azure operator no longer has to repoint them every month. This
requires the one-time backend setup below. Reconnect cannot create an OAuth app,
upload its certificate, or silently grant the integration user privileges.

## Shared environment contract

UAT and production use the same backend, Status component, authorization checks and
storage interfaces. Environment differences are configuration, not separate runtime
implementations. A nonblank Named Credential override remains authoritative.

| Configuration | UAT | Production |
| --- | --- | --- |
| Container App / resource group | `docgen-uat` / `docgen-uat-rg` | `docgen-production` / `docgen-production-rg` |
| Integration username | `integration@uipath.com.uatfull` | `integration@uipath.com` |
| OAuth app, private key, Entra credential | UAT-specific configuration | Production-specific configuration |
| Durable storage | Its own account/share or vault | Its own account/share or vault |
| Public certificate download | Verified UAT certificate in the asset map | Add a certificate only after verifying it against the production key |

`docgenConnectionAssets` contains public certificate mappings; the dashboard itself
does not select an environment or assume that every sandbox uses the UAT certificate.
Unknown/custom endpoints get certificate instructions instead of an unrelated asset.
Both deployment workflows use `reconnect-deployment-config.js`; production Bicep
receives the resolved settings and mounts. The mounting/enabling scripts require
explicit environment targets and do not fall back from production to UAT resources.

**Storage setup verified September 15, 2026:** UAT and production now have separate
Azure Files accounts/shares mounted at `/mnt/docgen-connection`. Provisioning
preserved each running backend image and existing credentials. The new
credential-editing backend/UI still require deployment; production credential
editing has not been enabled by storage provisioning.

## Azure Files storage

Storage is isolated by environment:

| Environment | Storage account | Share | Mount |
| --- | --- | --- | --- |
| UAT | `docgenuatcfg78031136` | `connection-settings` | `/mnt/docgen-connection` |
| Production | `docgenprodcfg78031136` | `connection-settings` | `/mnt/docgen-connection` |

Both use dedicated authenticated SMB shares. The share requires a storage account key and secure
SMB transfer. Anonymous blob access is disabled. UAT currently has no customer VNet,
so this is an authenticated storage endpoint, not private-endpoint-only networking.
A private endpoint would require a separate network change.

`DOCGEN_RECONNECT_STORAGE_PATH` selects `FileConnectionStore` instead of Key Vault
for both temporary and active connection credentials. Every record is encrypted
with AES-256-GCM before writing, using a domain-separated key derived from the
backend's canonical JWT private key and Salesforce origin. Storage account keys
are configured in the Container Apps environment and never passed to Salesforce.
No Key Vault write role is needed for this mode; existing read access still loads
JWT/Entra configuration as before.

Complete pairs are published by atomic rename. Pending sessions are claimed by
atomic rename across replicas and expire after ten minutes. Later submissions
clean expired pending/test-temporary files. The active record is `active.enc`.
The backend refuses to create a missing mount directory as an ephemeral fallback.
Replicas share the mount, and credential refresh/restart behavior is the same as
for Key Vault storage. Keep the JWT private key stable; if it rotates, migrate the
encrypted records beforehand or re-enter credentials through the setup UI.

To attach an existing, appropriately secured storage account/share:

```bash
python3 scripts/mount-reconnect-files.py \
  --subscription e17586a0-be7a-491e-b35e-20cc104a103a \
  --resource-group docgen-uat-rg --app docgen-uat \
  --storage-account docgenuatcfg78031136 --share connection-settings
```

The same script provisions storage when `--create-storage` is supplied. For a new
production setup, select a globally unique production storage-account name explicitly.
For the provisioned production environment, use `PROD_CONNECTION_STORAGE_ACCOUNT=docgenprodcfg78031136`:

```bash
python3 scripts/mount-reconnect-files.py \
  --subscription "$PROD_SUBSCRIPTION_ID" \
  --resource-group docgen-production-rg --app docgen-production \
  --storage-account "$PROD_CONNECTION_STORAGE_ACCOUNT" \
  --share connection-settings --create-storage
python3 scripts/enable-reconnect-editing.py \
  --subscription "$PROD_SUBSCRIPTION_ID" \
  --resource-group docgen-production-rg --app docgen-production
```

These are operator commands, not steps for Salesforce admins after a refresh.
They target only the supplied subscription/resource group and never reuse UAT's
storage account for production. Existing accounts must already meet the secure
transfer/no-anonymous-access requirements; the script does not weaken their settings.

After deploying the backend and Status-page changes, enable editing without a vault
argument. When the Azure Files mount is present, this script skips all Key Vault
role assignments:

```bash
python3 scripts/enable-reconnect-editing.py \
  --subscription e17586a0-be7a-491e-b35e-20cc104a103a \
  --resource-group docgen-uat-rg --app docgen-uat
```

Both scripts preserve the app image and existing secrets. The mount script preserves
other mounts and refuses to replace an environment storage link belonging to another
share. Normal deployments preserve the file mount using the deployment helper and
Bicep parameters. Use separate storage for production; these UAT resources are not
production storage. Do not switch an already active Key Vault-backed connection to
an empty share without migrating/re-entering its verified credential pair.

## Alternative: Key Vault storage setup

Deploy this backend version and the updated Salesforce Status component/static
resource. For Key Vault storage, an Azure owner must enable durable credential storage for each
backend. Salesforce administrators need **no Azure permissions** for subsequent
refresh recovery.

```bash
python3 scripts/enable-reconnect-editing.py \
  --subscription e17586a0-be7a-491e-b35e-20cc104a103a \
  --resource-group docgen-uat-rg --app docgen-uat --vault docgen-uat-kv-gl
```

For production, use its subscription and `docgen-production-rg`,
`docgen-production`, and `docgen-prod-kv-gl`. Run this separately for each environment;
the script does not alter other environments or deploy an image.

The script verifies the app and vault match, then grants **Key Vault Secrets Officer**
to the app's system-assigned managed identity at that vault's scope. The operator
needs permission to create that role assignment (Owner, User Access Administrator,
or an equivalent scoped grant); Contributor alone cannot grant it. No Azure role is
assigned to Salesforce users. It sets `DOCGEN_RECONNECT_CREDENTIAL_EDITING=true`
and changes the app's startup/readiness probes to `/healthz`. `/readyz` continues
reporting Salesforce, Entra and vault failures, but broken Salesforce authentication
must not prevent the recovery page from receiving traffic. Bicep preserves this
behavior when the editing flag is enabled; CI defaults remain unchanged.

Temporary credential submissions are stored server-side as expiring Key Vault
secrets. They are not active configuration, are never returned to the browser,
and are deleted after the callback. Abandoned submissions expire after ten minutes;
expiry prevents their use but does not physically delete the vault record. Apply
the vault owner's retention/cleanup policy to expired `docgen-reconnect-pending-*`
entries. The endpoint limits staging writes per replica to bound anonymous storage.

Only after verifying the administrator through Salesforce, `Docgen_Manage_Connection`,
the selected Named Credential, the fixed integration user's JWT login, the org and
the Entra credential does the backend save the active pair. In Key Vault mode, the pair is one JSON
secret, **`DOCGEN-SALESFORCE-CONNECTION`**, so replicas never read a new key with an
old secret. This record overrides the legacy `SF-CLIENT-ID` and reconnect consumer
secret in the running backend. Startup loads it; worker authentication refreshes it
at most every 30 seconds, and reconnect's return check refreshes it immediately.
No Azure restart or per-refresh environment-variable change is required.

The admin cannot change the backend's Salesforce My Domain, integration username,
private key, Entra app, or endpoint through this modal. Those remain backend-owner
configuration. If the final principal restoration or return check fails after the
verified pair is saved, the new pair remains active and the UI reports failure;
retry with saved credentials after resolving the reported problem.

### Public UAT certificate

`uat_server.crt` is a public certificate and can be shared in the UiPath repository.
The same certificate is packaged as `DocgenUatJwtCertificate`, and the modal offers
its download only when the selected backend is the known UiPath UAT endpoint.
Its SHA-256 certificate fingerprint is
`4B:20:45:AA:23:E5:91:F0:31:AE:5C:C7:AC:5A:EE:5E:3A:72:0C:0E:3C:9B:EE:55:74:BF:F8:BD:72:EB:3E:32`.
It is valid until April 25, 2036. The matching `uat_server.key` is private and must
never be published or entered into the modal. Other backends need their own matching
public certificate. Update the downloadable certificate if the UAT signing key rotates.

## UAT and production deployments

Both environments run the same reconnect code. Their deployment workflows set these
nonsecret integration usernames and resolve the reconnect URL from the target app:

| Environment | Azure resource group / app | Integration username |
| --- | --- | --- |
| UAT | `docgen-uat-rg` / `docgen-uat` | `integration@uipath.com.uatfull` |
| Production | `docgen-production-rg` / `docgen-production` | `integration@uipath.com` |

`scripts/reconnect-deployment-config.js` uses the GitHub environment variable
`DOCGEN_RECONNECT_PUBLIC_URL` when supplied, otherwise preserves the app's current
value, otherwise uses its stable ingress FQDN. For a custom Named Credential URL,
set that GitHub variable to the same URL and register its `/connect/callback` URL
in Salesforce before deployment. A sandbox's selected Named Credential still comes
from `DocgenConnectionConfig`; deployment does not change Salesforce endpoints.

The helper preserves the app's current reconnect secret references. If none are set,
it uses `docgen-reconnect-aad` and `docgen-reconnect-sf` only when each secret already
exists on that app. The former is the Entra credential; the latter is the Salesforce
OAuth consumer secret for administrator authorization.
Otherwise the backend uses its own Key Vault lookup described above. The helper
does not read secret values or create secrets, and refuses inline credential values
or references to nonexistent secrets. UAT's image update retains its other settings.
Production passes the resolved parameters into Bicep and uses `preserveAppSecrets=true`
to retain existing Container App secrets through a secure ARM module parameter.
Secrets are not returned in deployment outputs or written to workflow files.

For a manual Bicep update of an **existing** app, resolve and pass the same settings:

```bash
# Set the intended Azure subscription first. These commands update the selected app.
node scripts/reconnect-deployment-config.js "$RESOURCE_GROUP" "$APP_NAME" > /tmp/docgen-reconnect.parameters.json
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters infra/parameters/production.bicepparam \
  --parameters @/tmp/docgen-reconnect.parameters.json \
  --parameters preserveAppSecrets=true sfUsername="$SF_USERNAME" imageTag="$IMAGE_TAG"
```

This production example requires the existing production resources and appropriate
production variable values. Leave `preserveAppSecrets=false` for first-time provisioning;
configure reconnect after the app and its secret exist. A successful image deployment
alone does not mean the OAuth app or Entra secret has been configured.

Current standard callback URLs are:

- UAT: `https://docgen-uat.mangostone-78031136.eastus.azurecontainerapps.io/connect/callback`
- Production: `https://docgen-production.calmrock-a5bc6708.eastus.azurecontainerapps.io/connect/callback`

Each backend needs its own valid Entra secret and Salesforce JWT configuration.
Register the callback on the OAuth app identified by **that backend's** `SF_CLIENT_ID`;
do not assume configuring UAT also configures production. Keep the UAT callback and
app authorization in the sandbox refresh source so a monthly refresh does not remove
them. These workflow changes do not deploy Salesforce app metadata or enable live production.

## Monthly sandbox refresh

1. Open the Status page in the refreshed org and click **Connect / Reconnect**.
2. If the app/key changed, restore or recreate the OAuth app using the modal's
   instructions. Upload the matching public certificate, register the displayed
   callback URL, and authorize the admin and `integration@uipath.com.uatfull` in UAT.
   Enter its consumer key and secret, then choose **Save credentials and connect**.
   If the app credentials remain valid, choose **Reconnect with saved credentials**.
3. The popup receives the credentials only from its originating Salesforce page,
   over a message bound to the exact popup and backend origin, then submits them
   over HTTPS. The old Named Credential and old Salesforce app key are not needed
   for this setup path. Complete Salesforce authorization as the admin who started
   the action. The
   backend verifies the admin identity, connection-admin permission, current org,
   selected endpoint, and compatible External Credential configuration.
4. The backend verifies the configured integration user's JWT login with the new
   app and the existing Entra secret before activating the new pair. It restores
   the selected External Credential principal through the authenticated Salesforce
   setup API. Entra credentials travel server to server. The user-entered Salesforce
   secret is never put in a URL, cookie, local storage, returned response or log;
   it is cleared from the modal after handoff, cancellation, failure or detachment.
5. Salesforce makes an authenticated call through that Named Credential to
   `/connect/verify`. The backend checks an actual Salesforce identity/API response
   against the requesting org. Success requires both directions to work.
6. The Status page performs its own final check and shows the integration username.
   If the credential-editing popup closes without a confirmed result, the page
   reports that completion was not confirmed. Use **Reconnect with saved credentials**
   to verify; it will not claim the newly entered values were saved merely because
   the old connection still works.

The backend attempts to revoke the admin's temporary OAuth token after setup and
never stores it as worker authentication. Credential editing updates the verified
Salesforce app's consumer key/secret pair; the integration username, certificate,
backend URL and Salesforce domain remain fixed. A backend is dedicated to its
configured Salesforce My Domain; a DEV org cannot use this button to replace UAT's
connection. Existing replicas renew invalid Salesforce tokens through their normal
401 retry path and reload the active client id before acquiring tokens.

## Troubleshooting and limits

- **Backend reconnect setup is incomplete:** finish the one-time URL, secret, or JWT setup.
- **Credential editing is not enabled / settings cannot be stored:** complete the
  one-time backend setup and allow the vault role assignment to propagate. A Salesforce
  admin does not need an Azure role; the backend managed identity needs vault access.
- **OAuth callback rejected:** register the exact callback URL on the correct app.
- **Token exchange rejected with `invalid_grant; JWT assertion`:** configure the
  Salesforce OAuth app's consumer secret through `DOCGEN_RECONNECT_SF_CLIENT_SECRET`.
  Find the existing value in Salesforce Setup → App Manager → Docgen JWT Bearer →
  View → Manage Consumer Details, completing Salesforce identity verification if
  requested. Keep the secret out of source control, chat, browser URLs and logs.
  This setting selects standard OAuth client-secret authentication for the admin
  exchange; it does not change the integration username or JWT certificate.
- **Different org/admin:** use the same org and administrator that opened the Status page.
- **Integration user cannot authenticate:** restore the user's app authorization or
  matching certificate; the flow will not substitute the clicking admin.
- **Credential restoration denied:** check the admin's permission to manage Named
  Credentials and the principal's configuration.
- **Return callout failed:** the principal may already have been restored. Check
  External Credential principal access and backend connectivity, then retry.
- **Unsupported credential flow:** browser-flow, per-user, multiple-principal, and
  unrelated identity-provider credentials require their own setup process.

Regular `/readyz` checks are unchanged. A green readiness response alone does not
establish that this reconnect flow completed or that the backend targets this org.

## Implementation references

- [Salesforce web-server OAuth flow and certificate-based client assertions](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_web_server_flow_ca.htm&language=en_US&type=5)
- [Populating External Credential principals](https://developer.salesforce.com/docs/platform/named-credentials/guide/nc-populate-external-credentials.html)

OAuth state and the PKCE verifier are kept in an encrypted, Secure, HttpOnly,
SameSite cookie with a ten-minute lifetime. Replicas sharing the backend's JWT key
can complete the flow without retaining admin tokens in a session database. Callback
URLs/codes and upstream credential-bearing error objects are excluded from logs.
