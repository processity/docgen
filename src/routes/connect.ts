import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { AppConfig } from '../types';
import { completeReconnect, ReconnectError, ReconnectRequest, reconnectSettings, ReconnectSettings, verifyIntegration } from '../sf/reconnect';
import { ConnectionManager } from '../sf/connection-manager';
import { ConnectionStorageError, validClientCredentials } from '../sf/connection-store';

const COOKIE = '__Host-docgen-reconnect';
const MAX_AGE_SECONDS = 600;
interface Flow extends ReconnectRequest {
  state: string;
  verifier: string;
  sourceOrigin: string;
  publicUrl: string;
  expires: number;
  credentialUpdate?: boolean;
  staged?: boolean;
}
const connectionQuerySchema = { type: 'object', additionalProperties: false,
  required: ['orgId', 'userId', 'namedCredential', 'sourceOrigin'], properties: {
    orgId: { type: 'string', pattern: '^00D[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$' },
    userId: { type: 'string', pattern: '^005[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$' },
    namedCredential: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,79}$' },
    sourceOrigin: { type: 'string', maxLength: 255 },
  } };
function authorizationUrl(settings: ReconnectSettings, flow: Flow): string {
  const params = new URLSearchParams({ response_type: 'code', client_id: settings.clientId,
    redirect_uri: `${settings.publicUrl}/connect/callback`, scope: 'api openid', prompt: 'consent', display: 'popup',
    state: flow.state, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256' });
  return `${settings.salesforceOrigin}/services/oauth2/authorize?${params}`;
}
function flowCookie(flow: Flow, settings: ReconnectSettings): string {
  return `${COOKIE}=${seal(flow, settings)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}
function safeMessage(error: unknown, fallback: string): string {
  return error instanceof ReconnectError || error instanceof ConnectionStorageError ? error.message : fallback;
}
function cookieKey(settings: ReconnectSettings): Buffer {
  return createHash('sha256').update('docgen-reconnect-cookie-v1\0').update(settings.privateKey).digest();
}
function seal(flow: Flow, settings: ReconnectSettings): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cookieKey(settings), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(flow), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), payload].map(part => part.toString('base64url')).join('.');
}
function readFlow(cookie: string | undefined, settings: ReconnectSettings): Flow {
  try {
    const value = cookie?.split(';').map(entry => entry.trim()).find(entry => entry.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!value) throw new Error();
    const parts = value.split('.').map(part => Buffer.from(part, 'base64url'));
    if (parts.length !== 3) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', cookieKey(settings), parts[0]);
    decipher.setAuthTag(parts[1]);
    const flow = JSON.parse(Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8')) as Flow;
    if (flow.expires < Date.now() || flow.publicUrl !== settings.publicUrl) throw new Error();
    return flow;
  } catch {
    throw new ReconnectError('This reconnect session expired or is invalid. Close this window and start again.');
  }
}
function validSource(origin: string, settings: ReconnectSettings): boolean {
  return origin === settings.salesforceOrigin
    || origin === settings.salesforceOrigin.replace(/\.my\.salesforce\.com$/, '.lightning.force.com');
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
function resultPage(reply: FastifyReply, success: boolean, message: string, flow?: Flow) {
  const nonce = randomBytes(18).toString('base64url');
  const payload = JSON.stringify({ type: 'docgen:reconnect', success, message,
    orgId: flow?.orgId, namedCredential: flow?.namedCredential }).replace(/</g, '\\u003c');
  const script = flow
    ? `if(window.opener){window.opener.postMessage(${payload},${JSON.stringify(flow.sourceOrigin)});}` : '';
  reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    .header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`)
    .type('text/html; charset=utf-8');
  return reply.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Docgen connection</title>
<style nonce="${nonce}">body{font:16px/1.6 system-ui,sans-serif;color:#182b42;background:#f4f7fb;margin:0;padding:40px}main{max-width:600px;margin:auto;background:white;border:1px solid #dce4ef;border-radius:12px;padding:32px}h1{font-size:24px}p{overflow-wrap:anywhere}</style></head>
<body><main><h1>${success ? 'Docgen connected' : 'Connection needs attention'}</h1><p>${escapeHtml(message)}</p><p>Return to the Docgen Status page. You can close this window.</p></main><script nonce="${nonce}">${script}</script></body></html>`);
}

function credentialPage(reply: FastifyReply, flow: Flow): unknown {
  const nonce = randomBytes(18).toString('base64url');
  const context = JSON.stringify({ orgId: flow.orgId, namedCredential: flow.namedCredential }).replace(/</g, '\\u003c');
  const origin = JSON.stringify(flow.sourceOrigin);
  reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'same-origin')
    .header('Content-Security-Policy', `default-src 'none'; connect-src 'self'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`)
    .type('text/html; charset=utf-8');
  return reply.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Docgen connection</title></head>
<body><h1>Connecting Docgen</h1><p id="status">Waiting for the credentials entered on the Salesforce Status page…</p>
<script nonce="${nonce}">
const context=${context}, sourceOrigin=${origin}; let received=false;
window.addEventListener('message',async event=>{
  if(received || event.source!==window.opener || event.origin!==sourceOrigin || event.data?.type!=='docgen:credentials'
    || event.data.orgId!==context.orgId || event.data.namedCredential!==context.namedCredential) return;
  received=true;
  try {
    const response=await fetch('./prepare',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clientId:event.data.clientId,clientSecret:event.data.clientSecret,state:${JSON.stringify(flow.state)}})});
    const result=await response.json();
    if(!response.ok || !result.authorizationUrl) throw new Error(result.error || 'Connection setup could not start.');
    window.location.assign(result.authorizationUrl);
  } catch(error) {
    const message=error.message || 'Connection setup could not start.';
    document.getElementById('status').textContent=message;
    if(window.opener) window.opener.postMessage({...context,type:'docgen:reconnect',success:false,message},sourceOrigin);
  }
});
if(window.opener) window.opener.postMessage({...context,type:'docgen:credentials-ready'},sourceOrigin);
</script></body></html>`);
}

export const connectRoutes: FastifyPluginAsync<{ config: AppConfig; connectionManager?: ConnectionManager }> = async (app, { config, connectionManager }) => {
  const bootstrapSettings = () => reconnectSettings({ ...config, sfClientId: config.sfClientId || 'pending-credential-setup' });
  const requireEditing = () => {
    if (!config.reconnectCredentialEditing || !connectionManager) {
      throw new ReconnectError('Credential editing is not enabled on this backend. Its owner must finish the one-time setup.');
    }
    return connectionManager;
  };
  let submissions = 0;
  let submissionWindow = Date.now();

  app.get<{ Querystring: ReconnectRequest & { sourceOrigin: string } }>('/connect/prepare', {
    logLevel: 'silent', schema: { querystring: connectionQuerySchema },
  }, async (request, reply) => {
    let flow: Flow | undefined;
    try {
      const settings = bootstrapSettings();
      if (!validSource(request.query.sourceOrigin, settings)) throw new ReconnectError('This backend is configured for a different Salesforce org.');
      flow = { ...request.query, credentialUpdate: true, staged: false,
        state: randomBytes(32).toString('base64url'), verifier: randomBytes(96).toString('base64url'),
        publicUrl: settings.publicUrl, expires: Date.now() + MAX_AGE_SECONDS * 1000 };
      requireEditing();
      reply.header('Set-Cookie', flowCookie(flow, settings));
      return credentialPage(reply, flow);
    } catch (error) { return resultPage(reply.code(400), false, safeMessage(error, 'Credential setup is unavailable.'), flow); }
  });

  app.post<{ Body: { clientId: string; clientSecret: string; state: string } }>('/connect/prepare', {
    logLevel: 'silent', bodyLimit: 4096,
    errorHandler: (_error, _request, reply) => reply.code(400).send({ error: 'Invalid connection setup request.' }),
    schema: { body: { type: 'object', additionalProperties: false, required: ['clientId', 'clientSecret', 'state'], properties: {
      clientId: { type: 'string', minLength: 8, maxLength: 256 },
      clientSecret: { type: 'string', minLength: 1, maxLength: 512 },
      state: { type: 'string', maxLength: 64 },
    } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const manager = requireEditing();
      const settings = bootstrapSettings();
      if (request.headers.origin !== new URL(settings.publicUrl).origin) throw new ReconnectError('Connection setup must come from its connection window.');
      const flow = readFlow(request.headers.cookie, settings);
      if (!flow.credentialUpdate || flow.staged || request.body.state !== flow.state || !validClientCredentials(request.body)) {
        throw new ReconnectError('Connection setup is invalid or expired. Start again from the Status page.');
      }
      // Bound unauthenticated temporary storage. Only verified callbacks may replace active credentials.
      if (Date.now() - submissionWindow >= 60000) { submissions = 0; submissionWindow = Date.now(); }
      if (++submissions > 20) return reply.code(429).send({ error: 'Too many connection attempts. Wait a minute and retry.' });
      await manager.store.stage(flow.state, { clientId: request.body.clientId, clientSecret: request.body.clientSecret }, flow.expires);
      flow.staged = true;
      reply.header('Set-Cookie', flowCookie(flow, settings));
      const candidate = reconnectSettings({ ...config, sfClientId: request.body.clientId, reconnectSfClientSecret: request.body.clientSecret });
      return reply.send({ authorizationUrl: authorizationUrl(candidate, flow) });
    } catch (error) { return reply.code(400).send({ error: safeMessage(error, 'Credential setup could not start.') }); }
  });
  // Suppress automatic URL/error logging: the callback query carries an OAuth code.
  app.get<{ Querystring: ReconnectRequest & { sourceOrigin: string } }>('/connect/start', {
    logLevel: 'silent',
    schema: { querystring: { type: 'object', additionalProperties: false,
      required: ['orgId', 'userId', 'namedCredential', 'sourceOrigin'], properties: {
        orgId: { type: 'string', pattern: '^00D[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$' },
        userId: { type: 'string', pattern: '^005[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$' },
        namedCredential: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,79}$' },
        sourceOrigin: { type: 'string', maxLength: 255 },
      } } },
  }, async (request, reply) => {
    try {
      if (connectionManager) await connectionManager.refresh(true);
      const settings = reconnectSettings(config);
      if (!validSource(request.query.sourceOrigin, settings)) {
        throw new ReconnectError('This backend is configured for a different Salesforce org. Check the selected endpoint.');
      }
      const flow: Flow = { ...request.query, state: randomBytes(32).toString('base64url'),
        verifier: randomBytes(96).toString('base64url'), publicUrl: settings.publicUrl,
        expires: Date.now() + MAX_AGE_SECONDS * 1000 };
      reply.header('Set-Cookie', flowCookie(flow, settings))
        .header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      return reply.redirect(authorizationUrl(settings, flow));
    } catch (error) {
      return resultPage(reply.code(400), false, error instanceof ReconnectError ? error.message : 'Backend reconnect configuration is invalid.');
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/connect/callback', {
    logLevel: 'silent',
  }, async (request, reply) => {
    let flow: Flow | undefined;
    let validatedState = false;
    reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    try {
      let settings = bootstrapSettings();
      flow = readFlow(request.headers.cookie, settings);
      const state = request.query.state;
      if (typeof state !== 'string' || state.length !== flow.state.length
          || !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) {
        throw new ReconnectError('The Salesforce authorization response did not match this reconnect session.');
      }
      validatedState = true;
      if (request.query.error || typeof request.query.code !== 'string' || !request.query.code) {
        throw new ReconnectError('Salesforce authorization was canceled or declined.');
      }
      let saveCredentials: (() => Promise<void>) | undefined;
      if (flow.credentialUpdate) {
        const manager = requireEditing();
        if (!flow.staged) throw new ReconnectError('Submit credentials from the Status page before authorizing.');
        const candidate = await manager.store.take(flow.state);
        settings = reconnectSettings({ ...config, sfClientId: candidate.clientId, reconnectSfClientSecret: candidate.clientSecret });
        const verifiedFlow = flow;
        saveCredentials = async () => {
          try { await manager.save(candidate, verifiedFlow.orgId, verifiedFlow.userId); }
          catch (error) { throw new ReconnectError(safeMessage(error, 'The verified credentials could not be activated. Ask the backend owner to check its storage configuration.')); }
        };
      } else {
        if (connectionManager) await connectionManager.refresh(true);
        settings = reconnectSettings(config);
      }
      const result = saveCredentials
        ? await completeReconnect(settings, flow, request.query.code, flow.verifier, saveCredentials)
        : await completeReconnect(settings, flow, request.query.code, flow.verifier);
      app.log.info({ orgId: result.orgId, adminUserId: flow.userId, namedCredential: flow.namedCredential }, 'Docgen connection restored and verified');
      return resultPage(reply, true, `Both connection directions are verified. Backend integration user: ${result.integrationUsername}.`, flow);
    } catch (error) {
      app.log.warn({ orgId: flow?.orgId }, 'Docgen reconnect did not complete');
      return resultPage(reply.code(400), false, safeMessage(error, 'Reconnect could not complete. Please start again.'), flow);
    } finally {
      if (validatedState && flow?.credentialUpdate && connectionManager) await connectionManager.store.discard(flow.state);
    }
  });

  app.post<{ Body: { orgId: string } }>('/connect/verify', {
    preHandler: app.authenticate,
    schema: { body: { type: 'object', required: ['orgId'], additionalProperties: false,
      properties: { orgId: { type: 'string', pattern: '^00D[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$' } } } },
  }, async (request, reply) => {
    try {
      if (connectionManager) await connectionManager.refresh(true);
      const identity = await verifyIntegration(reconnectSettings(config), request.body.orgId);
      return reply.header('Cache-Control', 'no-store').send({ connected: true, salesforceToAzure: true,
        azureToSalesforce: true, orgId: identity.orgId, integrationUsername: identity.integrationUsername });
    } catch (error) {
      return reply.code(503).send({ connected: false, salesforceToAzure: true, azureToSalesforce: false,
        error: error instanceof ReconnectError ? error.message : 'Salesforce connection could not be verified.' });
    }
  });
};
