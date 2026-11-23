import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, relative, resolve, isAbsolute } from 'node:path';
import { followUpError, writableFields } from '../follow-up.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const stages = ['Prospecção', 'Em contato', 'Proposta', 'Ganho', 'Perdido'];
const tables = { companies: [], contacts: [], deals: [] };
const rules = [], runs = [];
function trigger(deal,event) {
  for (const rule of rules.filter(rule=>rule.enabled && rule.event===event)) {
    if (rule.action==='followup') {
      const person=tables.contacts.find(c=>c.id===deal.contact);
      deal.next_action=rule.message.replace(/{{(contato|negocio)}}/g,(_,key)=>key==='contato'?person?.name || '':deal.name);
    }
    runs.unshift({id:runs.length+1,deal_id:deal.id,name:rule.name,created_at:new Date(),status:rule.action==='followup'?'Próxima ação definida':'SMTP não configurado'});
  }
}
const fields = {
  companies: ['name', 'city'], contacts: ['name', 'company', 'email', 'phone'],
  deals: ['name', 'contact', 'amount', 'stage', 'notes', 'next_action', 'follow_up_on'],
};
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const emptySettings = { connected: false, baseUrl: '' };
function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function previewHtml(html) {
  return html.replace(/<input\b[^>]*\bname="(username|password)"[^>]*>/gu, (_, name) =>
      '<input name="' + name + '" type="' + (name === 'username' ? 'text' : 'password') + '" value="' +
      (name === 'username' ? 'demo@example.test' : 'demo') + '" readonly autocomplete="off">');
}
async function save(req, res, table, id) {
  const rows = tables[table];
  const row = id ? rows.find(item => item.id === Number(id)) : {};
  if (!row) return json(res, 404, { error: 'Registro não encontrado.' });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) return json(res, 413, { error: 'Conteúdo muito longo.' });
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (req.method === 'PATCH') {
    if (!stages.includes(body?.stage)) return json(res, 400, { error: 'Etapa inválida.' });
    const changed=row.stage!==body.stage;
    row.stage = body.stage;
    if(changed) trigger(row,row.stage);
    return json(res, 200, { id: row.id, stage: row.stage });
  }
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return json(res, 400, { error: 'Informe o nome.' });
  if (table === 'deals') {
    const error = followUpError(body);
    if (error) return json(res, 400, { error });
  }
  const values = Object.fromEntries(writableFields(fields[table], body, Boolean(id)).map(key => {
    if (key === 'contact' || key === 'company') return [key, Number(body[key]) || null];
    if (key === 'amount') return [key, Number(body[key]) || 0];
    if (key === 'follow_up_on') return [key, body[key] || null];
    return [key, String(body[key] ?? '').trim()];
  }));
  if (table === 'deals' && (!stages.includes(values.stage) || values.amount < 0 || !Number.isFinite(values.amount)))
    return json(res, 400, { error: 'Verifique a etapa e o valor.' });
  const previous=row.stage;
  Object.assign(row, values);
  if (!id) {
    row.id = Math.max(0, ...rows.map(item => item.id)) + 1;
    rows.unshift(row);
  }
  if(table==='deals' && (!id || previous!==row.stage)) trigger(row,id?row.stage:'created');
  return json(res, id ? 200 : 201, { id: row.id });
}

const port = Number(process.env.CRM_PREVIEW_PORT || 4318);
export const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://127.0.0.1:4318').pathname;
    if (path.startsWith('/api/')) {
      const authenticated = !/(?:^|;\s*)apito_demo_logout=1(?:;|$)/u.test(req.headers.cookie || '');
      if (path === '/api/session') return json(res, 200, { authenticated });
      if (path === '/api/login' || path === '/api/logout') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Método inválido.' });
        req.resume();
        const cookie = path === '/api/logout' ? 'apito_demo_logout=1' : 'apito_demo_logout=; Max-Age=0';
        return json(res, 200, { ok: true }, { 'Set-Cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/' });
      }
      if (!authenticated) return json(res, 401, { error: 'Entre na prévia.' });
      if(path==='/api/automations'){
        if(req.method==='GET') return json(res,200,{rules,runs:runs.slice(0,50),configured:false});
        if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) return json(res,403,{});
        let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>32000)return json(res,413,{});}
        const b=JSON.parse(raw);
        if(req.method==='POST' && ['email','followup'].includes(b.action) && ['created',...stages].includes(b.event) && [b.name,b.subject,b.message].every(v=>typeof v==='string' && v.trim())){
          rules.push({...b,id:rules.length+1,enabled:true}); return json(res,201,{});
        }
        const rule=rules.find(r=>r.id===b.id);
        if(req.method==='PATCH' && rule && typeof b.enabled==='boolean'){rule.enabled=b.enabled;return json(res,200,{});}
        return json(res,400,{error:'Regra inválida'});
      }
      if (path === '/api/crm') return json(res, 200, { stages, ...tables });
      if (path === '/api/integrations') return json(res, 200, { kommo: emptySettings, meeventos: emptySettings });
      const match = /^\/api\/(companies|contacts|deals)(?:\/(\d+))?$/u.exec(path);
      if (match && (req.method === (match[2] ? 'PUT' : 'POST') ||
          (match[1] === 'deals' && match[2] && req.method === 'PATCH'))) return await save(req, res, match[1], match[2]);
      return json(res, 501, { error: 'A consulta a serviços externos está desativada nesta prévia.' });
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    const localPath = relative(root, file);
    if (localPath.startsWith('..') || isAbsolute(localPath)) return res.writeHead(403).end();
    const type = types[extname(file)];
    if (!type) return res.writeHead(404).end();
    const content = await readFile(file, 'utf8');
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(localPath === 'index.html' ? previewHtml(content) : content);
  } catch (error) {
    if (error.code === 'ENOENT') return res.writeHead(404).end();
    return json(res, 400, { error: 'Não foi possível ler a solicitação.' });
  }
}).listen(port, '127.0.0.1', () => console.log('Prévia CRM: http://127.0.0.1:' + port));
