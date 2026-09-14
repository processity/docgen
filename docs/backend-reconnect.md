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
   exchange uses a signed `client_assertion`; no extra Salesforce client secret
   or admin refresh token is needed.
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

The OAuth app must remain usable after a sandbox refresh. An app that exists only
in the disposable sandbox can lose its credentials on refresh. Establish its
persistent definition and refresh-source authorization beforehand. Reconnect cannot
recreate an unavailable OAuth app or silently grant the integration user privileges.

## Monthly sandbox refresh

1. Open the Status page in the refreshed org and click **Connect / Reconnect**.
2. The browser opens the selected backend directly, so missing Named Credential
   secrets cannot prevent setup from starting.
3. Complete Salesforce authorization as the admin who started the action. The
   backend verifies the admin identity, connection-admin permission, current org,
   selected endpoint, and compatible External Credential configuration.
4. The backend verifies the configured integration user's JWT login and the Entra
   client secret before writing anything. It restores the selected principal
   through the authenticated Salesforce setup API. Credentials travel server to
   server, never through browser JavaScript or query strings.
5. Salesforce makes an authenticated call through that Named Credential to
   `/connect/verify`. The backend checks an actual Salesforce identity/API response
   against the requesting org. Success requires both directions to work.
6. The Status page performs its own final check and shows the integration username.
   If the browser blocks popup communication, close the completed window; the page
   checks the connection when it detects the closed popup.

The backend attempts to revoke the admin's temporary OAuth token after setup and
never stores it as worker authentication. The configured integration username, app, certificate,
backend URL, and Key Vault secrets are not repointed. A backend is dedicated to its
configured Salesforce My Domain; a DEV org cannot use this button to replace UAT's
connection. Existing replicas renew invalid Salesforce tokens through their normal
401 retry path.

## Troubleshooting and limits

- **Backend reconnect setup is incomplete:** finish the one-time URL, secret, or JWT setup.
- **OAuth callback rejected:** register the exact callback URL on the correct app.
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
