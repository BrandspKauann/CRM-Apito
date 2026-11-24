import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

test('o link público da escala respeita a resposta, a lotação e os horários', async t => {
  process.env.CRM_PREVIEW_PORT = '0';
  const { server } = await import('../work/preview.mjs');
  t.after(() => new Promise(resolve => server.close(resolve)));
  if (!server.listening) await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + '/api/';

  async function request(path, method = 'GET', body, cookie) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }

  const logout = await request('logout', 'POST', {});
  const guest = logout.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('session', 'GET', undefined, guest)).data.authenticated, false);
  const login = await request('login', 'POST', {}, guest);
  assert.equal(login.status, 200);
  const admin = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('session', 'GET', undefined, admin)).data.authenticated, true);
  assert.equal((await request('staffing', 'GET', undefined, guest)).status, 401);

  async function create(path, values) {
    const response = await request(path, 'POST', values, admin);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.ok(response.data.id);
    return response.data.id;
  }

  async function grant(assignment) {
    const path = 'staffing/assignments/' + assignment + '/link';
    assert.equal((await request(path, 'POST', {}, guest)).status, 401);
    const response = await request(path, 'POST', {}, admin);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.ok(response.data.token);
    return response.data.token;
  }

  const publicReply = (token, action) =>
    request('staffing-invite', 'POST', { token, action }, guest);

  const nextWeek = Date.now() + 7 * 24 * 3600 * 1000;
  const starts_at = new Date(nextWeek).toISOString();
  const ends_at = new Date(nextWeek + 2 * 3600 * 1000).toISOString();
  const group_url = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';
  const event = await create('staffing/events', { name: 'Encontro fictício', starts_at, ends_at, location: 'Sala A', group_url });
  const role = await create('staffing/events/' + event + '/roles', { name: 'Recepção', capacity: 1 });
  const assign = (roleId, contact_id) => create('staffing/roles/' + roleId + '/assignments', { contact_id });

  const ana = await create('contacts', { name: 'Pessoa A' });
  const bia = await create('contacts', { name: 'Pessoa B' });
  const cai = await create('contacts', { name: 'Pessoa C' });
  const assignmentAna = await assign(role, ana);
  const assignmentBia = await assign(role, bia);
  const assignmentCai = await assign(role, cai);
  const retired = await grant(assignmentAna);
  const tokenA = await grant(assignmentAna);
  assert.notEqual(tokenA, retired);
  assert.equal((await publicReply(retired, 'view')).status, 404);
  const tokenB = await grant(assignmentBia);
  const tokenC = await grant(assignmentCai);

  const view = await publicReply(tokenA, 'view');
  assert.equal(view.status, 200);
  assert.equal(view.data.event_name, 'Encontro fictício');
  assert.equal(view.data.status, 'invited');
  assert.ok(!JSON.stringify(view.data).includes(group_url));

  for (let i = 0; i < 2; i++) {
    const refusal = await publicReply(tokenC, 'decline');
    assert.equal(refusal.status, 200);
    assert.equal(refusal.data.status, 'declined');
    assert.ok(!JSON.stringify(refusal.data).includes(group_url));
  }
  assert.equal((await publicReply(tokenC, 'confirm')).status, 409);

  // Os dois convites disputam a última vaga.
  const replies = await Promise.all([publicReply(tokenA, 'confirm'), publicReply(tokenB, 'confirm')]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  const winner = replies.findIndex(r => r.status === 200);
  const winnerToken = [tokenA, tokenB][winner];
  const winnerContact = [ana, bia][winner];
  assert.equal(replies[winner].data.status, 'confirmed');
  assert.equal(replies[winner].data.group_url, group_url);
  assert.ok(!JSON.stringify(replies[1 - winner].data).includes(group_url));
  assert.equal((await publicReply(winnerToken, 'confirm')).status, 200);
  assert.equal((await publicReply(winnerToken, 'view')).data.group_url, group_url);

  const clash = await create('staffing/events', { name: 'Evento simultâneo', starts_at, ends_at, location: 'Sala B', group_url });
  const secondRole = await create('staffing/events/' + clash + '/roles', { name: 'Palco', capacity: 2 });
  const conflicting = await assign(secondRole, winnerContact);
  assert.equal((await publicReply(await grant(conflicting), 'confirm')).status, 409);

  const overview = await request('staffing', 'GET', undefined, admin);
  assert.equal(overview.status, 200);
  const assignments = overview.data.events.find(e => e.id === event).roles.find(r => r.id === role).assignments;
  assert.equal(assignments.filter(s => s.status === 'confirmed').length, 1);
  assert.equal(assignments.find(s => s.id === assignmentCai).status, 'declined');
  assert.ok(!JSON.stringify(overview.data).includes(winnerToken));
});
