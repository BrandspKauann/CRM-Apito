import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CRM_ADMIN_USER = 'admin';
process.env.CRM_ADMIN_PASSWORD = 'senha-de-teste-segura';
process.env.CRM_SESSION_SECRET = 'a'.repeat(64);
const {handleAuth, requireAuth} = await import('../auth.mjs');

function request(url, method = 'GET', body, cookie) {
  return {
    url, method,
    headers: {host:'localhost:4317', ...(body && {'content-type':'application/json'}), ...(cookie && {cookie})},
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); },
  };
}
function response() {
  return {
    status: undefined, headers: undefined, body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = JSON.parse(body); return this; },
  };
}

test('sessão exige credenciais válidas, cookie íntegro e permite logout', async () => {
  const before = response();
  assert.equal(await handleAuth(request('/api/session'), before), true);
  assert.deepEqual(before.body, {authenticated:false});

  const invalid = response();
  await handleAuth(request('/api/login', 'POST', {username:'admin', password:'incorreta'}), invalid);
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers['Set-Cookie'], undefined);

  const login = response();
  await handleAuth(request('/api/login', 'POST', {username:'admin', password:'senha-de-teste-segura'}), login);
  assert.equal(login.status, 200);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  assert.match(login.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);

  const session = response();
  await handleAuth(request('/api/session', 'GET', undefined, cookie), session);
  assert.deepEqual(session.body, {authenticated:true});
  assert.equal(requireAuth(request('/api/crm', 'GET', undefined, cookie), response()), true);

  const tampered = response();
  assert.equal(requireAuth(request('/api/crm', 'GET', undefined, cookie + 'x'), tampered), false);
  assert.equal(tampered.status, 401);

  const logout = response();
  await handleAuth(request('/api/logout', 'POST', undefined, cookie), logout);
  assert.equal(logout.status, 200);
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/);
});
