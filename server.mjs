import {segmentData, validSegment, saveSegment} from './contact-segments.mjs';
import {rulesApi,writeDeal} from './automations.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {query, transaction} from './db.mjs';
import {loadBrandRegister} from './brand-register.mjs';
import {commercialHistorySql, attachCommercialHistory} from './commercial-history.mjs';
import {handleAuth, requireAuth} from './auth.mjs';
import {handleStaffing, handleStaffingInvite} from './staffing.mjs';
import {handleIntegration} from './integrations.mjs';
import {followUpError, writableFields} from './follow-up.mjs';

const fields = {
  companies: ['name', 'city'],
  contacts: ['name', 'company', 'email', 'phone'],
  deals: ['name', 'contact', 'company', 'amount', 'stage', 'notes', 'next_action', 'follow_up_on'],
};
const assets = {
  '/': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/auth.css': ['auth.css', 'text/css'],
  '/dashboard.css': ['dashboard.css', 'text/css'],
  '/pipeline.css': ['pipeline.css', 'text/css'],
  '/relationships.css': ['relationships.css', 'text/css'],
  '/segments.js': ['segments.js','text/javascript'],
  '/staffing.js': ['staffing.js','text/javascript'],
  '/staffing.css': ['staffing.css','text/css'],
  '/convite.html': ['convite.html','text/html'],
  '/convite.js': ['convite.js','text/javascript'],
  '/convite.css': ['convite.css','text/css'],
  '/directory.css': ['directory.css', 'text/css'],
  '/segments.css': ['segments.css', 'text/css'],
  '/relationships.js': ['relationships.js', 'text/javascript'],
  '/kommo-import.js': ['kommo-import.js', 'text/javascript'],
  '/stage-art.svg': ['stage-art.svg', 'image/svg+xml'],
  '/app.js': ['app.js', 'text/javascript'],
};
const stages = ['Prospecção', 'Em contato', 'Proposta', 'Perdido', 'Ganho', 'Clientes', 'Finalizado sem desfecho', 'Orçamento aprovado'];
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
    if (await handleStaffingInvite(req, res, {query, transaction})) return;
    if (!requireAuth(req, res)) return;
    if (req.method === 'GET' && req.url === '/api/data-source') {
      const {rows: [source]} = await query("SELECT current_database() AS database, current_user AS application_role, current_setting('search_path') AS namespaces");
      json(res, 200, {name: source.database === 'brain_apito' ? 'Brain Apito' : 'Base configurada', ...source});
      return;
    }
    if (await handleStaffing(req, res, {query, transaction})) return;
    if (await handleIntegration(req, res)) return;
    if (req.method === 'GET' && req.url === '/api/commercial-history') {
      const imported = await query("SELECT to_regclass('crm_enrichment.crm_contact_sources') IS NOT NULL AND to_regclass('crm_enrichment.meeventos_crosswalk') IS NOT NULL AND to_regclass('kommo_import.sync_state') IS NOT NULL AS available");
      const evidence = imported.rows[0].available ? await transaction(async client => {
        await client.query("SET LOCAL statement_timeout='12s'");
        await client.query('SET LOCAL jit=off');
        await client.query('SET LOCAL enable_nestloop=off');
        return (await client.query(commercialHistorySql)).rows;
      }) : [];
      const contacts = [...new Set(evidence.map(row => row.contact_id))].map(id => ({id}));
      attachCommercialHistory(contacts, evidence);
      json(res, 200, contacts);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/crm') {
      const data = {stages};
      const results = await Promise.all(Object.keys(fields).map(table => query(`SELECT * FROM ${table} ORDER BY id DESC`)));
      Object.keys(fields).forEach((table, index) => { data[table] = results[index].rows; });
      const {entries: brands} = await loadBrandRegister(query);
      for (const company of data.companies) {
        if (!company.website && brands[company.id]) company.website = 'https://' + brands[company.id].domain;
        if (!company.website && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(company.name)) {
          company.website = 'https://' + company.name.toLowerCase();
        }
      }
      json(res, 200, data);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/portfolio-history') return json(res,200,await segmentData(true));
    const segments = req.url === '/api/contact-segments';
    if (segments && req.method === 'GET') return json(res,200,await segmentData());
    const match = /^\/api\/(companies|contacts|deals)(?:\/(\d+))?$/.exec(req.url);
    const automation = req.url === '/api/automations';
    if (automation && req.method === 'GET') return await rulesApi(req,res,null,stages,json);
    if (!match && !automation && !segments) { json(res, 404, {error:'Recurso não encontrado'}); return; }
    const [, table, id] = match || [];
    const moveDeal = table === 'deals' && id && req.method === 'PATCH';
    const deleteDeal = table === 'deals' && id && req.method === 'DELETE';
    if (!deleteDeal && !automation && !moveDeal && req.method !== (id ? 'PUT' : 'POST')) { json(res, 405, {error:'Método inválido'}); return; }
    if (!req.headers['content-type']?.startsWith('application/json') || !sameOrigin(req)) {
      json(res, 403, {error:'Origem ou formato inválido'}); return;
    }
    if (deleteDeal) {
      const result = await query('DELETE FROM deals WHERE id = $1 RETURNING id', [id]);
      return json(res, result.rowCount ? 200 : 404, result.rows[0] || {error:'Oportunidade não encontrada.'});
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
    if (segments) {
      if (!validSegment(body)) return json(res,400,{error:'Confira o nome, o período e os filtros da lista.'});
      try { return json(res,201,await saveSegment(body)); }
      catch (error) {
        if (error.code === '23505') return json(res,409,{error:'Já existe uma lista com esse nome.'});
        throw error;
      }
    }
    if (automation) return await rulesApi(req,res,body,stages,json);
    if (moveDeal) {
      if (!stages.includes(body?.stage)) { json(res, 400, {error:'Etapa inválida'}); return; }
      const result = await writeDeal('UPDATE deals SET stage = $1 WHERE id = $2 RETURNING id, stage', [body.stage, id],id);
      if (!result.rowCount) { json(res, 404, {error:'Negócio não encontrado'}); return; }
      json(res, 200, result.rows[0]); return;
    }
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      json(res, 400, {error:'Informe um nome'}); return;
    }
    if (table === 'deals') {
      const error = (!body.contact && !body.company) ? 'Vincule a oportunidade a um contato ou a uma empresa.' : followUpError(body);
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
    const params = id ? [...values, Number(id)] : values;
    if (table === 'contacts') {
      const company = body.company ? Number(body.company) : null;
      const normalizeName = value => value.normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase().replace(/\s+/g,' ');
      const name = normalizeName(body.name);
      const email = String(body.email || '').trim().toLowerCase();
      const result = await transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(91372,$1::integer)',[company || 0]);
        const candidates = await client.query('SELECT id,name,email FROM contacts WHERE company IS NOT DISTINCT FROM $1::integer AND ($2::integer IS NULL OR id<>$2)',[company,id || null]);
        const duplicate = candidates.rows.find(row => normalizeName(row.name) === name || (email && row.email?.trim().toLowerCase() === email));
        if (duplicate) return {duplicate:duplicate.id};
        return client.query(sql,params);
      });
      if (result.duplicate) return json(res,409,{code:'duplicate_contact',id:result.duplicate,error:'Já existe um contato com esse nome ou e-mail nesse cadastro de empresa (#'+result.duplicate+').'});
      return result.rowCount ? json(res,id ? 200 : 201,result.rows[0]) : json(res,404,{error:'Contato não encontrado.'});
    }
    const result = table === 'deals' ? await writeDeal(sql,params,id,!id && body.fromSegment === true && body.contact ? {contact:Number(body.contact),stage:body.stage} : null) : await query(sql,params);
    if (!result.rowCount) { json(res, 404, {error:'Registro não encontrado'}); return; }
    json(res, id || result.skipped ? 200 : 201, {id:result.rows[0].id, ...(result.skipped && {skipped:true})});
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
