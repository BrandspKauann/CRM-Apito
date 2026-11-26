import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const username = process.env.CRM_ADMIN_USER;
const password = process.env.CRM_ADMIN_PASSWORD;
const secret = process.env.CRM_SESSION_SECRET;
if (!username || !password || password.length < 8 || !secret || secret.length < 32) {
  throw new Error('Configure CRM_ADMIN_USER, CRM_ADMIN_PASSWORD (mínimo 8 caracteres) e CRM_SESSION_SECRET (mínimo 32 caracteres)');
}

const accounts = new Map([[username, password]]);
const contactUser = 'contato@apitodemestre.com.br';
const contactPassword = process.env.CRM_CONTACT_PASSWORD;
if (contactPassword) {
  if (contactPassword.length < 12 || username === contactUser) throw Error('Configuração inválida da conta de contato');
  accounts.set(contactUser, contactPassword);
}

const cookieName = 'crm_apito_session';
const lifetimeSeconds = 60 * 60 * 24;
const digest = value => createHash('sha256').update(value).digest();
const equal = (left, right) => timingSafeEqual(digest(left), digest(right));
const signature = value => createHmac('sha256', secret).update(value).digest('base64url');
const send = (res, status, value, headers = {}) => res.writeHead(status, {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers,
}).end(JSON.stringify(value));
const sameOrigin = req => {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
};
function cookieOptions(req) {
  const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
function isAuthenticated(req) {
  const raw = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='));
  if (!raw) return false;
  const [payload, mac] = raw.slice(cookieName.length + 1).split('.');
  if (!payload || !mac || !equal(signature(payload), mac)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return accounts.has(session.user) && Number.isSafeInteger(session.expires) && session.expires > Date.now();
  } catch { return false; }
}
function issueCookie(req, user) {
  const payload = Buffer.from(JSON.stringify({user, expires: Date.now() + lifetimeSeconds * 1000})).toString('base64url');
  return `${cookieName}=${payload}.${signature(payload)}; Max-Age=${lifetimeSeconds}; ${cookieOptions(req)}`;
}
export function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  send(res, 401, {error: 'Acesso não autorizado'});
  return false;
}
export async function handleAuth(req, res) {
  if (req.url === '/api/session' && req.method === 'GET') {
    send(res, 200, {authenticated: isAuthenticated(req)});
    return true;
  }
  if (req.url === '/api/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) send(res, 403, {error: 'Origem inválida'});
    else send(res, 200, {ok: true}, {'Set-Cookie': `${cookieName}=; Max-Age=0; ${cookieOptions(req)}`});
    return true;
  }
  if (req.url !== '/api/login' || req.method !== 'POST') return false;
  if (!sameOrigin(req) || !req.headers['content-type']?.startsWith('application/json')) {
    send(res, 403, {error: 'Origem ou formato inválido'});
    return true;
  }
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) { send(res, 413, {error: 'Dados muito longos'}); return true; }
    parts.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { send(res, 400, {error: 'Dados inválidos'}); return true; }
  if (typeof body?.username !== 'string' || typeof body?.password !== 'string' ||
      !accounts.has(body.username) || !equal(body.password, accounts.get(body.username))) {
    send(res, 401, {error: 'Usuário ou senha inválidos'});
    return true;
  }
  send(res, 200, {ok: true}, {'Set-Cookie': issueCookie(req, body.username)});
  return true;
}

export function authenticatedUsername(req) {
  if (!isAuthenticated(req)) return null;
  const raw=(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(cookieName+'='));
  return JSON.parse(Buffer.from(raw.slice(cookieName.length+1).split('.')[0],'base64url').toString('utf8')).user;
}
