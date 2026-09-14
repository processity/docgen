import axios from 'axios';
import jwt from 'jsonwebtoken';
import { AppConfig } from '../types';
import { SalesforceAuth, getSalesforceAuth } from './auth';

export class ReconnectError extends Error {}
export interface ReconnectSettings {
  publicUrl: string;
  salesforceOrigin: string;
  username: string;
  clientId: string;
  privateKey: string;
  aadClientId: string;
  aadClientSecret: string;
  aadTokenEndpoint: string;
  aadScope: string;
}
export interface ReconnectRequest {
  orgId: string;
  userId: string;
  namedCredential: string;
}
export interface ConnectionResult {
  connected: true;
  salesforceToAzure: true;
  azureToSalesforce: true;
  orgId: string;
  integrationUsername: string;
}
interface SalesforceIdentity { organization_id: string; user_id: string; preferred_username: string }
interface SetupInfo extends ReconnectRequest {
  externalCredential: string;
  principalName: string;
  backendUrl: string;
  salesforceOrigin: string;
  isSandbox: boolean;
  tokenEndpoint: string;
  scope: string;
}

export function normalizeBackendUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ReconnectError('The backend must have an HTTPS URL without credentials, a query, or a fragment.');
  }
  return url.toString().replace(/\/$/, '');
}

export function reconnectSettings(config: AppConfig): ReconnectSettings {
  if (!config.reconnectPublicUrl || !config.reconnectAadClientSecret || !config.sfDomain
      || !config.sfUsername || !config.sfClientId || !config.sfPrivateKey || !config.clientId || !config.azureTenantId) {
    throw new ReconnectError('Backend reconnect setup is incomplete. Configure its public URL and Entra client secret, and the Salesforce JWT integration.');
  }
  if (config.sfAccessToken || config.sfdxAuthUrl) {
    throw new ReconnectError('Reconnect requires the backend to use its configured JWT integration user.');
  }
  const sf = new URL(config.sfDomain.startsWith('https://') ? config.sfDomain : `https://${config.sfDomain}`);
  if (!sf.hostname.endsWith('.my.salesforce.com') || sf.pathname !== '/' || sf.port || sf.search || sf.hash || sf.username || sf.password) {
    throw new ReconnectError('Configure the backend with the intended Salesforce My Domain.');
  }
  return {
    publicUrl: normalizeBackendUrl(config.reconnectPublicUrl), salesforceOrigin: sf.origin,
    username: config.sfUsername, clientId: config.sfClientId, privateKey: config.sfPrivateKey,
    aadClientId: config.clientId, aadClientSecret: config.reconnectAadClientSecret,
    aadTokenEndpoint: `https://login.microsoftonline.com/${config.azureTenantId}/oauth2/v2.0/token`,
    aadScope: `api://${config.clientId}/.default`,
  };
}

export function sameId(left: string, right: string): boolean {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(left || '')
    && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(right || '') && left.slice(0, 15) === right.slice(0, 15);
}
const requestOptions = { timeout: 25000, maxRedirects: 0 };
function authorized(token: string) {
  return { ...requestOptions, headers: { Authorization: `Bearer ${token}` } };
}

export async function verifyIntegration(settings: ReconnectSettings, expectedOrgId: string) {
  const auth = new SalesforceAuth({
    sfDomain: new URL(settings.salesforceOrigin).hostname, sfUsername: settings.username,
    sfClientId: settings.clientId, sfPrivateKey: settings.privateKey,
  });
  try {
    const token = await auth.getAccessToken();
    const identity = (await axios.get<SalesforceIdentity>(`${settings.salesforceOrigin}/services/oauth2/userinfo`, authorized(token))).data;
    const org = (await axios.get<{ records: { Id: string; IsSandbox: boolean }[] }>(`${settings.salesforceOrigin}/services/data/v60.0/query`, {
      ...authorized(token), params: { q: 'SELECT Id, IsSandbox FROM Organization LIMIT 1' },
    })).data.records?.[0];
    if (!org || !sameId(org.Id, expectedOrgId) || !sameId(identity.organization_id, expectedOrgId)
        || String(identity.preferred_username || '').toLowerCase() !== settings.username.toLowerCase()) {
      throw new ReconnectError('The backend integration user is connected to a different Salesforce org.');
    }
    return { orgId: org.Id as string, isSandbox: org.IsSandbox as boolean, integrationUsername: settings.username };
  } catch (error) {
    if (error instanceof ReconnectError) throw error;
    throw new ReconnectError('The configured integration user could not authenticate. Check its active status, Connected App authorization, and JWT certificate.');
  }
}

/** The admin token is short-lived setup authority; it never becomes worker authentication. */
export async function completeReconnect(settings: ReconnectSettings, request: ReconnectRequest, code: string, verifier: string): Promise<ConnectionResult> {
  const tokenUrl = `${settings.salesforceOrigin}/services/oauth2/token`;
  let adminToken: string | undefined;
  let stage = 'Salesforce authorization';
  try {
    const assertion = jwt.sign({ iss: settings.clientId, sub: settings.clientId, aud: tokenUrl }, settings.privateKey,
      { algorithm: 'RS256', expiresIn: 300 });
    const tokenResponse = (await axios.post<{ access_token?: string }>(tokenUrl, new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: settings.clientId,
      redirect_uri: `${settings.publicUrl}/connect/callback`,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion,
    }).toString(), { ...requestOptions, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).data;
    adminToken = tokenResponse.access_token;
    if (!adminToken) throw new ReconnectError('Salesforce did not return setup authorization.');
    const identity = (await axios.get<SalesforceIdentity>(`${settings.salesforceOrigin}/services/oauth2/userinfo`, authorized(adminToken))).data;
    if (!sameId(identity.organization_id, request.orgId) || !sameId(identity.user_id, request.userId)) {
      throw new ReconnectError('Sign in as the admin who started reconnect, in the same Salesforce org.');
    }

    stage = 'Administrator and endpoint verification';
    const setupUrl = `${settings.salesforceOrigin}/services/apexrest/docgen/connection/setup`;
    const info = (await axios.get<SetupInfo>(setupUrl, authorized(adminToken))).data;
    if (!sameId(info.orgId, request.orgId) || !sameId(info.userId, request.userId)
        || info.namedCredential !== request.namedCredential || normalizeBackendUrl(info.backendUrl) !== settings.publicUrl
        || info.salesforceOrigin !== settings.salesforceOrigin) {
      throw new ReconnectError('The selected backend or Salesforce connection settings changed. Start reconnect again.');
    }
    if (info.tokenEndpoint !== settings.aadTokenEndpoint || info.scope?.trim() !== settings.aadScope) {
      throw new ReconnectError('The selected External Credential does not match this backend’s Entra configuration.');
    }
    const service = await verifyIntegration(settings, request.orgId);
    if (service.isSandbox !== info.isSandbox) throw new ReconnectError('The Salesforce org type does not match the backend connection.');

    stage = 'Entra credential verification';
    const entra = (await axios.post<{ access_token?: string }>(settings.aadTokenEndpoint, new URLSearchParams({
      grant_type: 'client_credentials', scope: settings.aadScope,
    }).toString(), { ...requestOptions, auth: { username: settings.aadClientId, password: settings.aadClientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).data;
    if (!entra.access_token) throw new ReconnectError('Entra did not authorize the backend’s configured client credentials.');

    stage = 'External Credential restoration';
    const saved = (await axios.put<{ restored: boolean }>(setupUrl, {
      orgId: info.orgId, userId: info.userId, namedCredential: info.namedCredential, backendUrl: info.backendUrl,
      externalCredential: info.externalCredential, principalName: info.principalName,
      tokenEndpoint: info.tokenEndpoint, scope: info.scope,
      clientId: settings.aadClientId, clientSecret: settings.aadClientSecret,
    }, authorized(adminToken))).data;
    if (saved.restored !== true) throw new ReconnectError('Salesforce did not confirm External Credential restoration.');

    stage = 'Salesforce-to-backend verification';
    const check = (await axios.post<{ connected: boolean; orgId: string; integrationUsername: string }>(setupUrl, {}, authorized(adminToken))).data;
    if (check.connected !== true || !sameId(check.orgId, request.orgId)
        || check.integrationUsername !== settings.username) {
      throw new ReconnectError('The credential was restored, but both connection directions could not be verified.');
    }
    getSalesforceAuth()?.invalidateToken();
    return { connected: true, salesforceToAzure: true, azureToSalesforce: true,
      orgId: service.orgId, integrationUsername: settings.username };
  } catch (error) {
    if (error instanceof ReconnectError) throw error;
    // Axios errors may contain tokens and credential bodies. Never forward or log them.
    throw new ReconnectError(`${stage} failed. Check the backend setup and administrator permissions, then retry.`);
  } finally {
    if (adminToken) {
      await axios.post(`${settings.salesforceOrigin}/services/oauth2/revoke`, new URLSearchParams({ token: adminToken }).toString(),
        { ...requestOptions, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => undefined);
    }
  }
}
