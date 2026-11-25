import {readFile} from 'node:fs/promises';
import {query, transaction} from './db.mjs';
import defaults from './automation-defaults.mjs';

const configured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
let ready;
function prepare() {
  ready ??= readFile(new URL('./migrations/automations.sql', import.meta.url),'utf8')
    .then(sql => transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('crm-apito-automation-setup'))");
      // The VPS web role uses migrations applied before deployment.
      if (!process.env.CRM_VPS_CONNECTION) await client.query(sql);
      await client.query(`INSERT INTO automation_rules(template_key,name,event,message,subject,action)
        SELECT key,name,event,message,'Próxima ação','followup'
        FROM jsonb_to_recordset($1::jsonb) AS template(key text,name text,event text,message text)
        WHERE NOT EXISTS (SELECT 1 FROM automation_rules existing WHERE existing.template_key=template.key)
        ON CONFLICT (template_key) DO NOTHING`, [JSON.stringify(defaults)]);
    })).catch(error => { ready = undefined; throw error; });
  return ready;
}
export async function rulesApi(req,res,body,stages,json) {
  await prepare();
  if (req.method === 'GET') {
    const rules = await query('SELECT * FROM automation_rules ORDER BY id DESC');
    const runs = await query('SELECT r.id,a.name,r.deal_id,r.status,r.created_at FROM automation_runs r JOIN automation_rules a ON a.id=r.rule_id ORDER BY r.id DESC LIMIT 50');
    return json(res,200,{rules:rules.rows,runs:runs.rows,configured:configured()});
  }
  if (req.method === 'PATCH' && Number.isSafeInteger(body?.id) && typeof body.enabled === 'boolean') {
    const result = await query('UPDATE automation_rules SET enabled=$1 WHERE id=$2',[body.enabled,body.id]);
    return json(res,result.rowCount ? 200 : 404,{});
  }
  if (!['POST','PUT'].includes(req.method) || !['email','followup'].includes(body?.action ?? 'email') || !['created',...stages].includes(body?.event) ||
    !['name','subject','message'].every(key => typeof body[key] === 'string' && body[key].trim()) ||
    body.name.length>120 || body.subject.length>200 || body.message.length>(body.action==='followup'?200:8000) || /[\r\n]/.test(body.subject))
    return json(res,400,{error:'Confira o gatilho, o nome e o texto da ação.'});
  const values = [body.name.trim(),body.event,body.subject.trim(),body.message.trim(),body.action ?? 'email'];
  if (req.method === 'PUT') {
    if (!Number.isSafeInteger(body.id)) return json(res,400,{error:'Identificador inválido.'});
    const updated = await query('UPDATE automation_rules SET name=$1,event=$2,subject=$3,message=$4,action=$5 WHERE id=$6',[...values,body.id]);
    return json(res,updated.rowCount ? 200 : 404,{});
  }
  await query('INSERT INTO automation_rules(name,event,subject,message,action) VALUES($1,$2,$3,$4,$5)',values);
  json(res,201,{});
}
export async function writeDeal(sql,params,id,segmentContact) {
  await prepare();
  const {result,jobs} = await transaction(async client => {
    if (segmentContact) {
      await client.query('SELECT pg_advisory_xact_lock(51481,$1::integer)',[segmentContact.contact]);
      const existing=await client.query('SELECT id FROM deals WHERE contact=$1 AND stage=$2 LIMIT 1',[segmentContact.contact,segmentContact.stage]);
      if (existing.rowCount) return {result:{...existing,skipped:true},jobs:[]};
    }
    const old = id && (await client.query('SELECT stage FROM deals WHERE id=$1 FOR UPDATE',[id])).rows[0];
    const result = await client.query(sql,params);
    if (!result.rowCount) return {result,jobs:[]};
    const deal = (await client.query('SELECT d.*,c.email,c.name AS person FROM deals d LEFT JOIN contacts c ON c.id=d.contact WHERE d.id=$1',[result.rows[0].id])).rows[0];
    if (old && old.stage === deal.stage) return {result,jobs:[]};
    const event = old ? deal.stage : 'created';
    const rules = (await client.query('SELECT * FROM automation_rules WHERE enabled AND event=$1',[event])).rows;
    const jobs = [];
    for (const rule of rules.sort((a,b)=>Number(!a.template_key)-Number(!b.template_key) || a.id-b.id)) {
      const fill = value => value.replace(/{{(contato|negocio)}}/g,(_,key)=>key==='contato' ? deal.person || '' : deal.name);
      const recipient = deal.email?.trim();
      if (rule.action === 'followup') {
        const next = fill(rule.message).slice(0,200);
        await client.query('UPDATE deals SET next_action=$1 WHERE id=$2',[next,deal.id]);
        await client.query('INSERT INTO automation_runs(rule_id,deal_id,subject,message,status) VALUES($1,$2,$3,$4,$5)',[rule.id,deal.id,rule.subject,next,'Próxima ação definida']);
        continue;
      }
      const status = !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient || '') ? 'Contato sem email válido' : configured() ? 'Aguardando envio' : 'SMTP não configurado';
      const row = await client.query('INSERT INTO automation_runs(rule_id,deal_id,recipient,subject,message,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[rule.id,deal.id,recipient,fill(rule.subject),fill(rule.message),status]);
      if (status==='Aguardando envio') jobs.push(row.rows[0]);
    }
    return {result,jobs};
  });
  for (const job of jobs) {
    let status;
    try {
      const {default:mailer} = await import('nodemailer');
      const smtp = mailer.createTransport({host:'smtp.hostinger.com',port:465,secure:true,connectionTimeout:8000,socketTimeout:12000,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}});
      await smtp.sendMail({from:process.env.SMTP_USER,to:job.recipient,subject:job.subject,text:job.message});
      status='Aceito pelo servidor de email';
    } catch { status='Falha no envio'; }
    await query('UPDATE automation_runs SET status=$1 WHERE id=$2',[status,job.id]);
  }
  return result;
}
