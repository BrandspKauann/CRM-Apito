import {readFile} from 'node:fs/promises';
import {query, transaction} from './db.mjs';

const configured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
let ready;
function prepare() {
  ready ??= readFile(new URL('./migrations/automations.sql', import.meta.url),'utf8')
    .then(sql => query(sql)).catch(error => { ready = undefined; throw error; });
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
  if (req.method !== 'POST' || !['created',...stages].includes(body?.event) ||
    !['name','subject','message'].every(key => typeof body[key] === 'string' && body[key].trim()) ||
    body.name.length>120 || body.subject.length>200 || body.message.length>8000 || /[\r\n]/.test(body.subject))
    return json(res,400,{error:'Confira o gatilho, o nome e o conteúdo do email.'});
  await query('INSERT INTO automation_rules(name,event,subject,message) VALUES($1,$2,$3,$4)',[body.name.trim(),body.event,body.subject.trim(),body.message.trim()]);
  json(res,201,{});
}
export async function writeDeal(sql,params,id) {
  await prepare();
  const {result,jobs} = await transaction(async client => {
    const old = id && (await client.query('SELECT stage FROM deals WHERE id=$1 FOR UPDATE',[id])).rows[0];
    const result = await client.query(sql,params);
    if (!result.rowCount) return {result,jobs:[]};
    const deal = (await client.query('SELECT d.*,c.email,c.name AS person FROM deals d LEFT JOIN contacts c ON c.id=d.contact WHERE d.id=$1',[result.rows[0].id])).rows[0];
    if (old && old.stage === deal.stage) return {result,jobs:[]};
    const event = old ? deal.stage : 'created';
    const rules = (await client.query('SELECT * FROM automation_rules WHERE enabled AND event=$1',[event])).rows;
    const jobs = [];
    for (const rule of rules) {
      const fill = value => value.replace(/{{(contato|negocio)}}/g,(_,key)=>key==='contato' ? deal.person || '' : deal.name);
      const recipient = deal.email?.trim();
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
