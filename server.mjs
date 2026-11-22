import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { handleIntegration } from './integrations.mjs';

const directory = new URL('./data/', import.meta.url);
await mkdir(directory, {recursive:true});
const db = new DatabaseSync(process.env.CRM_DB || fileURLToPath(new URL('crm.sqlite', directory)));
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY, name TEXT NOT NULL, company INTEGER REFERENCES companies(id), email TEXT NOT NULL, phone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deals(id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact INTEGER REFERENCES contacts(id), amount REAL NOT NULL, stage TEXT NOT NULL, notes TEXT NOT NULL);`);
const fields = {companies:['name','city'],contacts:['name','company','email','phone'],deals:['name','contact','amount','stage','notes']};
const assets = {'/':'index.html','/style.css':'style.css','/app.js':'app.js'};
const stages = ['Prospec��o','Em contato','Proposta','Ganho','Perdido'];
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));}
http.createServer(async(req,res)=>{
  try {
    if (await handleIntegration(req,res)) return;
    if(req.method==='GET' && Object.hasOwn(assets,req.url)){
      const mime={'/':'text/html','/style.css':'text/css','/app.js':'text/javascript'};
      res.writeHead(200,{'Content-Type':mime[req.url]+'; charset=utf-8','Cache-Control':'no-cache'}).end(await readFile(new URL(assets[req.url],import.meta.url)));return;
    }
    if(req.method==='GET' && req.url==='/api/crm'){
      const data={stages};
      for(const table of Object.keys(fields)) data[table]=db.prepare('SELECT * FROM '+table+' ORDER BY id DESC').all();
      return json(res,200,data);
    }
    const match=/^\/api\/(companies|contacts|deals)(?:\/(\d+))?$/.exec(req.url);
    if(!match)return json(res,404,{error:'Recurso n�o encontrado'});
    const [,table,id]=match;
    if(req.method!==(id?'PUT':'POST'))return json(res,405,{error:'M�todo inv�lido'});
    if(!req.headers['content-type']?.startsWith('application/json') || (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host))return json(res,403,{error:'Origem ou formato inv�lido'});
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>32000)return json(res,413,{error:'Texto muito longo'});chunks.push(chunk);}
    let body;try{body=JSON.parse(Buffer.concat(chunks));}catch{return json(res,400,{error:'Dados inv�lidos'});}
    if(!body || typeof body.name!=='string'||!body.name.trim())return json(res,400,{error:'Informe um nome'});
    const cols=fields[table];
    const values=cols.map(k=>{
      if(k==='contact'||k==='company')return body[k]?Number(body[k]):null;
      if(k==='amount')return Number(body[k]??0);
      return String(body[k]??'').trim();
    });
    if(table==='deals' && (!stages.includes(body.stage)||!Number.isFinite(Number(body.amount))||Number(body.amount)<0))return json(res,400,{error:'Verifique o valor e a etapa'});
    const query=id?'UPDATE '+table+' SET '+cols.map(k=>k+'=?').join(',')+' WHERE id=?':'INSERT INTO '+table+' ('+cols.join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')';
    const result=db.prepare(query).run(...values,...(id?[id]:[]));
    if(!result.changes)return json(res,404,{error:'Registro n�o encontrado'});
    json(res,id?200:201,{id:Number(id||result.lastInsertRowid)});
  }catch(e){json(res,400,{error:'N�o foi poss�vel concluir. Verifique os dados e os v�nculos.'});}
}).listen(Number(process.env.PORT||4317),process.env.BIND_HOST||'127.0.0.1');

