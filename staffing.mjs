import { createHash, randomBytes } from 'node:crypto';

// Only handleStaffingInvite is public. Mount handleStaffing after requireAuth.
const listSql = `
  SELECT e.id, e.name, e.starts_at, e.ends_at, e.location, e.group_url,
         r.id AS role_id, r.name AS role_name, r.capacity,
         a.id AS assignment_id, a.contact_id, c.name AS contact_name, a.status
  FROM crm.staffing_events e
  LEFT JOIN crm.staffing_roles r ON r.event_id=e.id
  LEFT JOIN crm.staffing_assignments a ON a.role_id=r.id
  LEFT JOIN brain.contacts c ON c.id=a.contact_id
  ORDER BY e.starts_at DESC, e.id, r.id, a.id`;

function groupRows(rows) {
  const events = new Map();
  const roles = new Map();
  for (const row of rows) {
    const {id,name,starts_at,ends_at,location,group_url,role_id,role_name,capacity,assignment_id,contact_id,contact_name,status} = row;
    if (!events.has(id)) events.set(id,{id,name,starts_at,ends_at,location,group_url,roles:[]});
    if (role_id === null) continue;
    if (!roles.has(role_id)) {
      const role = {id:role_id,name:role_name,capacity,assignments:[]};
      roles.set(role_id,role);
      events.get(id).roles.push(role);
    }
    if (assignment_id !== null) roles.get(role_id).assignments.push({id:assignment_id,contact_id,contact_name,status});
  }
  return [...events.values()];
}

class StaffingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function textField(value, size, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > size || (required && !value.trim())) {
    throw new StaffingError(400,'Confira os campos de texto da escala.');
  }
  return value.trim();
}
function validId(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const day = new Date(value.slice(0,10)+'T00:00:00Z');
  if (!Number.isFinite(+day) || day.toISOString().slice(0,10) !== value.slice(0,10)) return NaN;
  return Date.parse(value);
}
function validLink(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.origin === 'https://chat.whatsapp.com' && !url.username && !url.password &&
      /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  } catch { return false; }
}
async function bodyOf(req) {
  let size=0;
  const parts=[];
  for await (const chunk of req) {
    size += chunk.length;
    if (size>8192) throw new StaffingError(413,'Solicitação muito longa.');
    parts.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (value && typeof value==='object' && !Array.isArray(value)) return value;
  } catch { /* Report the same validation error for malformed bodies. */ }
  throw new StaffingError(400,'Dados inválidos.');
}
function allowedWrite(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return false;
  if (req.headers['sec-fetch-site']==='cross-site') return false;
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}
async function createEvent(query, body) {
  const name=textField(body.name,160,true);
  const location=textField(body.location,250);
  const link=textField(body.group_url,600);
  const start=instant(body.starts_at), end=instant(body.ends_at);
  if (!(start < end)) throw new StaffingError(400,'Informe início e fim válidos, com o fim posterior ao início.');
  if (!validLink(link)) throw new StaffingError(400,'Informe um link de convite do WhatsApp.');
  return (await query(`INSERT INTO crm.staffing_events(name,starts_at,ends_at,location,group_url)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[name,new Date(start),new Date(end),location,link])).rows[0];
}
async function createRole(query, id, body) {
  const name=textField(body.name,120,true);
  if (!validId(body.capacity) || body.capacity>999) throw new StaffingError(400,'Informe de 1 a 999 vagas.');
  return (await query(`INSERT INTO crm.staffing_roles(event_id,name,capacity) VALUES($1,$2,$3) RETURNING id`,
    [id,name,body.capacity])).rows[0];
}
async function invite(query,id,body) {
  if (!validId(body.contact_id)) throw new StaffingError(400,'Selecione um contato.');
  return (await query(`INSERT INTO crm.staffing_assignments(role_id,contact_id) VALUES($1,$2) RETURNING id`,
    [id,body.contact_id])).rows[0];
}
async function lockAssignment(client,id) {
  // All assignment writers take locks in the same order. READ COMMITTED makes
  // the final query see replies and token rotations committed while waiting.
  const {rows:[keys]}=await client.query('SELECT role_id,contact_id FROM crm.staffing_assignments WHERE id=$1',[id]);
  if (!keys) throw new StaffingError(404,'Convite não encontrado.');
  await client.query('SELECT pg_advisory_xact_lock(1735611759,$1::integer)',[keys.role_id]);
  await client.query('SELECT pg_advisory_xact_lock(1735611760,$1::integer)',[keys.contact_id]);
  const {rows:[slot]}=await client.query(`SELECT a.id,a.role_id,a.contact_id,a.status,a.invite_hash,
    r.name AS role_name,r.capacity,e.name AS event_name,e.starts_at,e.ends_at,e.location,e.group_url,
    e.starts_at>clock_timestamp() AS upcoming
    FROM crm.staffing_assignments a JOIN crm.staffing_roles r ON r.id=a.role_id
    JOIN crm.staffing_events e ON e.id=r.event_id WHERE a.id=$1`,[id]);
  if (!slot) throw new StaffingError(404,'Convite não encontrado.');
  return slot;
}
async function checkAvailability(client,slot) {
  const count=await client.query("SELECT count(*)::int AS used FROM crm.staffing_assignments WHERE role_id=$1 AND status='confirmed'",[slot.role_id]);
  if (count.rows[0].used>=slot.capacity) throw new StaffingError(409,'Todas as vagas desta função estão preenchidas.');
  const overlapping=await client.query(`SELECT 1 FROM crm.staffing_assignments a
    JOIN crm.staffing_roles r ON r.id=a.role_id JOIN crm.staffing_events e ON e.id=r.event_id
    WHERE a.contact_id=$1 AND a.status='confirmed' AND e.starts_at<$2 AND e.ends_at>$3 LIMIT 1`,
    [slot.contact_id,slot.ends_at,slot.starts_at]);
  if (overlapping.rowCount) throw new StaffingError(409,'Este contato já está confirmado nesse horário.');
}
function expired() { return new StaffingError(410,'Este convite expirou.'); }
async function updateStatus(client,slot,status,viaLink) {
  if (slot.status===status) return {id:slot.id,status};
  if (viaLink && slot.status!=='invited') throw new StaffingError(409,'A resposta deste convite já foi registrada.');
  if (status==='confirmed') await checkAvailability(client,slot);
  const {rows:[changed]}=await client.query(`UPDATE crm.staffing_assignments SET status=$2,
    responded_at=CASE WHEN $2='invited' THEN NULL ELSE now() END,
    invite_hash=CASE WHEN $3::boolean THEN invite_hash ELSE NULL END
    WHERE id=$1 AND (NOT $3 OR $4::timestamptz>clock_timestamp()) RETURNING id,status`,
    [slot.id,status,viaLink,slot.starts_at]);
  if (!changed) throw expired();
  return changed;
}
async function respond(transaction,id,status) {
  if (!['invited','confirmed','declined'].includes(status)) throw new StaffingError(400,'Resposta inválida.');
  return transaction(async client => updateStatus(client,await lockAssignment(client,id),status,false));
}
function digest(token) { return createHash('sha256').update(token,'ascii').digest('hex'); }
async function issueLink(transaction,id) {
  return transaction(async client => {
    const slot=await lockAssignment(client,id);
    if (!slot.upcoming) throw expired();
    if (slot.status!=='invited') throw new StaffingError(409,'Só é possível gerar um link para um convite pendente.');
    const token=randomBytes(32).toString('hex');
    const updated=await client.query(`UPDATE crm.staffing_assignments SET invite_hash=$2
      WHERE id=$1 AND $3::timestamptz>clock_timestamp()`,[id,digest(token),slot.starts_at]);
    if (!updated.rowCount) throw expired();
    return {token};
  });
}
function inviteSummary(slot,status) {
  const {event_name,role_name,starts_at,ends_at,location}=slot;
  return {event_name,role_name,starts_at,ends_at,location,status,group_url:status==='confirmed'?slot.group_url:null};
}
async function readInvite({query,transaction},{token,action}) {
  if (!['view','confirm','decline'].includes(action)) throw new StaffingError(400,'Ação de convite inválida.');
  if (typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token)) throw new StaffingError(404,'Convite não encontrado.');
  const hash=digest(token);
  if (action==='view') {
    const {rows:[slot]}=await query(`SELECT e.name AS event_name,r.name AS role_name,
      e.starts_at,e.ends_at,e.location,a.status,e.starts_at>clock_timestamp() AS upcoming,
      CASE WHEN a.status='confirmed' THEN e.group_url END AS group_url
      FROM crm.staffing_assignments a JOIN crm.staffing_roles r ON r.id=a.role_id
      JOIN crm.staffing_events e ON e.id=r.event_id WHERE a.invite_hash=$1`,[hash]);
    if (!slot) throw new StaffingError(404,'Convite não encontrado.');
    if (!slot.upcoming) throw expired();
    return inviteSummary(slot,slot.status);
  }
  return transaction(async client => {
    const {rows:[match]}=await client.query('SELECT id FROM crm.staffing_assignments WHERE invite_hash=$1',[hash]);
    if (!match) throw new StaffingError(404,'Convite não encontrado.');
    const slot=await lockAssignment(client,match.id);
    if (slot.invite_hash!==hash) throw new StaffingError(404,'Convite não encontrado.');
    if (!slot.upcoming) throw expired();
    const changed=await updateStatus(client,slot,action==='confirm'?'confirmed':'declined',true);
    return inviteSummary(slot,changed.status);
  });
}
function reply(res, status, value) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));
}
export async function handleStaffingInvite(req,res,db) {
  if (req.url.split('?')[0]!=='/api/staffing-invite') return false;
  try {
    if (req.method!=='POST') throw new StaffingError(405,'Método inválido.');
    if (!allowedWrite(req)) throw new StaffingError(403,'Origem ou formato inválido.');
    const summary=await readInvite(db,await bodyOf(req));
    reply(res,200,summary);
  } catch (error) {
    if (error instanceof StaffingError) reply(res,error.status,{error:error.message});
    else reply(res,503,{error:'Convites temporariamente indisponíveis.'});
  }
  return true;
}
export async function handleStaffing(req,res,{query,transaction}) {
  const path=req.url.split('?')[0];
  if (path!=='/api/staffing' && !path.startsWith('/api/staffing/')) return false;
  try {
    if (path==='/api/staffing' && req.method==='GET') {
      reply(res,200,{events:groupRows((await query(listSql)).rows)});
      return true;
    }
    const roles=path.match(/^\/api\/staffing\/events\/(\d+)\/roles$/);
    const invites=path.match(/^\/api\/staffing\/roles\/(\d+)\/assignments$/);
    const responses=path.match(/^\/api\/staffing\/assignments\/(\d+)$/);
    const links=path.match(/^\/api\/staffing\/assignments\/(\d+)\/link$/);
    const isEvent=path==='/api/staffing/events';
    if (!isEvent && !roles && !invites && !responses && !links) throw new StaffingError(404,'Rota de escala não encontrada.');
    if (req.method!==(responses?'PATCH':'POST')) throw new StaffingError(405,'Método inválido.');
    if (!allowedWrite(req)) throw new StaffingError(403,'Origem ou formato inválido.');
    const id=Number((roles || invites || responses || links)?.[1]);
    if (!isEvent && !validId(id)) throw new StaffingError(400,'Identificador inválido.');
    const body=await bodyOf(req);
    let result;
    if (isEvent) result=await createEvent(query,body);
    else if (roles) result=await createRole(query,id,body);
    else if (invites) result=await invite(query,id,body);
    else if (links) result=await issueLink(transaction,id);
    else result=await respond(transaction,id,body.status);
    reply(res,responses?200:201,result);
  } catch (error) {
    if (error instanceof StaffingError) reply(res,error.status,{error:error.message});
    else if (error.code==='23503') reply(res,404,{error:'Evento, função ou contato não encontrado.'});
    else if (error.code==='23505') reply(res,409,{error:'Função ou convite já cadastrado.'});
    else if (error.code==='42P01') reply(res,503,{error:'A estrutura de escalas ainda precisa ser instalada no banco de dados.'});
    else throw error;
  }
  return true;
}
