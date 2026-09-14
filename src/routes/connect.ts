import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { AppConfig } from '../types';
import { completeReconnect, ReconnectError, ReconnectRequest, reconnectSettings, ReconnectSettings, verifyIntegration } from '../sf/reconnect';

const COOKIE = '__Host-docgen-reconnect';
const MAX_AGE_SECONDS = 600;
interface Flow extends ReconnectRequest {
  state: string;
  verifier: string;
  sourceOrigin: string;
  publicUrl: string;
  expires: number;
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

export const connectRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (app, { config }) => {
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
      const settings = reconnectSettings(config);
      if (!validSource(request.query.sourceOrigin, settings)) {
        throw new ReconnectError('This backend is configured for a different Salesforce org. Check the selected endpoint.');
      }
      const flow: Flow = { ...request.query, state: randomBytes(32).toString('base64url'),
        verifier: randomBytes(96).toString('base64url'), publicUrl: settings.publicUrl,
        expires: Date.now() + MAX_AGE_SECONDS * 1000 };
      reply.header('Set-Cookie', `${COOKIE}=${seal(flow, settings)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`)
        .header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      const params = new URLSearchParams({ response_type: 'code', client_id: settings.clientId,
        redirect_uri: `${settings.publicUrl}/connect/callback`, scope: 'api openid', prompt: 'consent', display: 'popup',
        state: flow.state, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256' });
      return reply.redirect(`${settings.salesforceOrigin}/services/oauth2/authorize?${params}`);
    } catch (error) {
      return resultPage(reply.code(400), false, error instanceof ReconnectError ? error.message : 'Backend reconnect configuration is invalid.');
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/connect/callback', {
    logLevel: 'silent',
  }, async (request, reply) => {
    let flow: Flow | undefined;
    reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    try {
      const settings = reconnectSettings(config);
      flow = readFlow(request.headers.cookie, settings);
      const state = request.query.state;
      if (typeof state !== 'string' || state.length !== flow.state.length
          || !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) {
        throw new ReconnectError('The Salesforce authorization response did not match this reconnect session.');
      }
      if (request.query.error || typeof request.query.code !== 'string' || !request.query.code) {
        throw new ReconnectError('Salesforce authorization was canceled or declined.');
      }
      const result = await completeReconnect(settings, flow, request.query.code, flow.verifier);
      app.log.info({ orgId: result.orgId, adminUserId: flow.userId, namedCredential: flow.namedCredential }, 'Docgen connection restored and verified');
      return resultPage(reply, true, `Both connection directions are verified. Backend integration user: ${result.integrationUsername}.`, flow);
    } catch (error) {
      app.log.warn({ orgId: flow?.orgId }, 'Docgen reconnect did not complete');
      return resultPage(reply.code(400), false, error instanceof ReconnectError ? error.message : 'Reconnect could not complete. Please start again.', flow);
    }
  });

  app.post<{ Body: { orgId: string } }>('/connect/verify', {
    preHandler: app.authenticate,
    schema: { body: { type: 'object', required: ['orgId'], additionalProperties: false,
      properties: { orgId: { type: 'string', pattern: '^00D[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$' } } } },
  }, async (request, reply) => {
    try {
      const identity = await verifyIntegration(reconnectSettings(config), request.body.orgId);
      return reply.header('Cache-Control', 'no-store').send({ connected: true, salesforceToAzure: true,
        azureToSalesforce: true, orgId: identity.orgId, integrationUsername: identity.integrationUsername });
    } catch (error) {
      return reply.code(503).send({ connected: false, salesforceToAzure: true, azureToSalesforce: false,
        error: error instanceof ReconnectError ? error.message : 'Salesforce connection could not be verified.' });
    }
  });
};
