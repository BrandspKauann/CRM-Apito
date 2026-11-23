import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {query} from './db.mjs';
import {handleAuth, requireAuth} from './auth.mjs';
import {handleIntegration} from './integrations.mjs';
import {followUpError, writableFields} from './follow-up.mjs';

const fields = {
  companies: ['name', 'city'],
  contacts: ['name', 'company', 'email', 'phone'],
  deals: ['name', 'contact', 'amount', 'stage', 'notes', 'next_action', 'follow_up_on'],
};
const assets = {
  '/': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/auth.css': ['auth.css', 'text/css'],
  '/dashboard.css': ['dashboard.css', 'text/css'],
  '/pipeline.css': ['pipeline.css', 'text/css'],
  '/relationships.css': ['relationships.css', 'text/css'],
  '/directory.css': ['directory.css', 'text/css'],
  '/relationships.js': ['relationships.js', 'text/javascript'],
  '/kommo-import.js': ['kommo-import.js', 'text/javascript'],
  '/stage-art.svg': ['stage-art.svg', 'image/svg+xml'],
  '/app.js': ['app.js', 'text/javascript'],
};
const stages = ['Prospecção', 'Em contato', 'Proposta', 'Ganho', 'Perdido'];
function json(res, status, value) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}).end(JSON.stringify(value));
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}
function isDatabaseInputError(error) {
  return typeof error?.code === 'string' && (/^23/.test(error.code) || /^22/.test(error.code));
}

export async function handler(req, res) {
  try {
    if (await handleAuth(req, res)) return;
    if (req.method === 'GET' && Object.hasOwn(assets, req.url)) {
      const [filename, mime] = assets[req.url];
      const content = await readFile(new URL('./public/' + filename, import.meta.url));
      res.writeHead(200, {'Content-Type':mime + '; charset=utf-8', 'Cache-Control':'no-cache'}).end(content);
      return;
    }
    if (!requireAuth(req, res)) return;
    if (await handleIntegration(req, res)) return;
    if (req.method === 'GET' && req.url === '/api/crm') {
      const data = {stages};
      const results = await Promise.all(Object.keys(fields).map(table => query(`SELECT * FROM ${table} ORDER BY id DESC`)));
      Object.keys(fields).forEach((table, index) => { data[table] = results[index].rows; });
      json(res, 200, data);
      return;
    }
    const match = /^\/api\/(companies|contacts|deals)(?:\/(\d+))?$/.exec(req.url);
    if (!match) { json(res, 404, {error:'Recurso não encontrado'}); return; }
    const [, table, id] = match;
    const moveDeal = table === 'deals' && id && req.method === 'PATCH';
    if (!moveDeal && req.method !== (id ? 'PUT' : 'POST')) { json(res, 405, {error:'Método inválido'}); return; }
    if (!req.headers['content-type']?.startsWith('application/json') || !sameOrigin(req)) {
      json(res, 403, {error:'Origem ou formato inválido'}); return;
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32000) { json(res, 413, {error:'Texto muito longo'}); return; }
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { json(res, 400, {error:'Dados inválidos'}); return; }
    if (moveDeal) {
      if (!stages.includes(body?.stage)) { json(res, 400, {error:'Etapa inválida'}); return; }
      const result = await query('UPDATE deals SET stage = $1 WHERE id = $2 RETURNING id, stage', [body.stage, id]);
      if (!result.rowCount) { json(res, 404, {error:'Negócio não encontrado'}); return; }
      json(res, 200, result.rows[0]); return;
    }
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      json(res, 400, {error:'Informe um nome'}); return;
    }
    if (table === 'deals') {
      const error = followUpError(body);
      if (error) { json(res, 400, {error}); return; }
    }
    const cols = writableFields(fields[table], body, Boolean(id));
    const values = cols.map(key => {
      if (key === 'contact' || key === 'company') return body[key] ? Number(body[key]) : null;
      if (key === 'amount') return Number(body[key] ?? 0);
      if (key === 'follow_up_on') return body[key] || null;
      return String(body[key] ?? '').trim();
    });
    if (cols.some((key, index) => (key === 'company' || key === 'contact') && values[index] !== null &&
        (!Number.isSafeInteger(values[index]) || values[index] < 1)) ||
        (table === 'deals' && (!stages.includes(body.stage) || !Number.isFinite(Number(body.amount)) || Number(body.amount) < 0))) {
      json(res, 400, {error:'Verifique o valor e a etapa'}); return;
    }
    const placeholders = cols.map((_, index) => '$' + (index + 1));
    const sql = id
      ? `UPDATE ${table} SET ${cols.map((key, index) => key + ' = ' + placeholders[index]).join(', ')} WHERE id = $${cols.length + 1} RETURNING id`
      : `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
    const result = await query(sql, id ? [...values, Number(id)] : values);
    if (!result.rowCount) { json(res, 404, {error:'Registro não encontrado'}); return; }
    json(res, id ? 200 : 201, {id:result.rows[0].id});
  } catch (error) {
    console.error('Falha ao atender requisição do CRM:', error?.code || error?.name);
    json(res, isDatabaseInputError(error) ? 400 : 503, {
      error: isDatabaseInputError(error) ? 'Verifique os dados e os vínculos.' : 'Serviço temporariamente indisponível.',
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  http.createServer(handler).listen(Number(process.env.PORT || 4317), process.env.BIND_HOST || '127.0.0.1');
}
