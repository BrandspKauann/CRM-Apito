import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

const folder=new URL('./data/',import.meta.url);
await mkdir(folder,{recursive:true});
let key;
try {key=await readFile(new URL('integrations.key',folder));}
catch {
 try {await writeFile(new URL('integrations.key',folder),randomBytes(32),{flag:'wx',mode:0o600});}
 catch(error){if(error.code!=='EEXIST')throw error;}
 key=await readFile(new URL('integrations.key',folder));
}
if(key.length!==32)throw Error('Chave de integra��o inv�lida');
const file=new URL('integrations.json',folder);
let configs={};
try {configs=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
function seal(value){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
function unseal(value){
 const b=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
 decipher.setAuthTag(b.subarray(12,28));
 return Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8');
}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));}
function publicConfig(provider){
 const c=configs[provider];
 return {connected:!!c,baseUrl:c?.baseUrl||'',lastChecked:c?.lastChecked||null};
}
function validUrl(provider,raw){
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||!url.hostname.includes('.')||url.hostname==='localhost'||/^\d+(\.\d+){3}$/.test(url.hostname))throw Error('Informe a URL HTTPS do sistema');
 if(provider==='kommo'&&!url.hostname.endsWith('.kommo.com'))throw Error('Informe o endere�o da sua conta Kommo');
 return url.origin;
}
async function request(provider,config,path){
 const response=await fetch(config.baseUrl+path,{headers:{Authorization:provider==='kommo'?'Bearer '+unseal(config.token):unseal(config.token),Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(response.status===401||response.status===403?'Token recusado pelo servi�o':'Servi�o respondeu HTTP '+response.status);
 if(response.status===204)return {};
 return response.json();
}
export async function handleIntegration(req,res){
 const route=/^\/api\/integrations(?:\/(kommo|meeventos)(?:\/(test|preview))?)?$/.exec(req.url);
 if(!route)return false;
 const [,provider,action]=route;
 if(req.method==='GET'&&!provider){send(res,200,{kommo:publicConfig('kommo'),meeventos:publicConfig('meeventos')});return true;}
 if(!provider){send(res,405,{error:'M�todo inv�lido'});return true;}
 if(req.method==='GET'&&action==='preview'){
  try{
   const config=configs[provider];if(!config)throw Error('Configure a integra��o primeiro');
   const paths=provider==='kommo'?['/api/v4/contacts?limit=20','/api/v4/leads?limit=20']:['/api/v1/clients?page=1&limit=20','/api/v1/events?page=1&limit=20'];
   const results=await Promise.all(paths.map(path=>request(provider,config,path)));
   const lists=provider==='kommo'?{
    contacts:(results[0]._embedded?.contacts||[]).map(r=>({id:r.id,name:r.name})),
    leads:(results[1]._embedded?.leads||[]).map(r=>({id:r.id,name:r.name,price:r.price}))
   }:{clients:(results[0].data||[]).map(r=>({id:r.id,name:r.nome||r.razaosocial||'Cliente'})),events:(results[1].data||[]).map(r=>({id:r.id,name:r.nomeevento||'Evento'}))};
   send(res,200,lists);
  }catch(error){send(res,502,{error:error.message});}return true;
 }
 if(req.method==='POST'&&(action==='test'||!action)){
  if(!req.headers['content-type']?.startsWith('application/json')||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)){send(res,403,{error:'Origem inv�lida'});return true;}
  try{
   let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>16000)throw Error('Dados muito longos');parts.push(chunk);}
   const body=JSON.parse(Buffer.concat(parts));
   const previous=configs[provider];
   const baseUrl=validUrl(provider,String(body.baseUrl||previous?.baseUrl||'').replace(/\/+$/,'')+'/');
   const token=String(body.token||'').trim();
   if(!token&&(!previous?.token||baseUrl!==previous.baseUrl))throw Error('Informe o token para este endere�o');
   const config={baseUrl,token:token?seal(token):previous.token};
   await request(provider,config,provider==='kommo'?'/api/v4/account':'/api/v1/events');
   if(!action){
    config.lastChecked=new Date().toISOString();
    const next={...configs,[provider]:config};
    await writeFile(file,JSON.stringify(next),{mode:0o600});
    configs=next;
   }
   send(res,200,{ok:true,...publicConfig(provider),baseUrl});
  }catch(error){send(res,400,{error:error.message||'N�o foi poss�vel conectar'});}return true;
 }
 send(res,405,{error:'M�todo inv�lido'});return true;
}

