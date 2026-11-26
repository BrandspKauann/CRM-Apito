import {loadDataset,listMetadata,preview,saveList,annotate,invalidateSegments} from './brain-segments.mjs';
import {query} from './db.mjs';
import {authenticatedUsername} from './auth.mjs';
const send=(res,status,value)=>res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));
export async function handleBrainSegments(req,res){
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/brain-segments'))return false;
 try{
  if(req.method==='GET'){
   if(url.pathname==='/api/brain-segments')send(res,200,await listMetadata());
   else if(url.pathname==='/api/brain-segments/entity'){
    const d=await loadDataset(),e=d.entities.get(url.searchParams.get('kind')+':'+url.searchParams.get('key'));
    if(!e){send(res,404,{error:'Cadastro não encontrado.'});return true;}
    const history=(await query('SELECT * FROM brain.segment_annotations WHERE entity_kind=$1 AND entity_key=$2 ORDER BY id DESC LIMIT 100',[e.kind,e.key])).rows;
    send(res,200,{...e,related:Object.fromEntries(Object.entries(d.related.get(e.uid)).map(([k,list])=>[k,list.map(x=>({kind:x.kind,key:x.key,name:x.name}))])),history,indexed_at:d.indexed_at});
   } else if(url.pathname==='/api/brain-segments/review'){
    const d=await loadDataset();const rows=[];const category=url.searchParams.get('category')||'all';
    for(const e of d.entities.values())for(const [field,fact] of Object.entries(e.facts))if(['suggested','conflict'].includes(fact.state)||['duplicate_candidate','ambiguous_identity'].includes(field)&&fact.value===true&&!e.facts.identity_review?.annotation_id){const identity=['duplicate_candidate','ambiguous_identity'].includes(field);if(category==='all'||category==='identities'&&identity||category==='suggested'&&fact.state==='suggested'||category==='conflict'&&fact.state==='conflict')rows.push({kind:e.kind,key:e.key,name:e.name,field,fact});}
    const offset=Number(url.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0)throw Object.assign(Error('Página inválida.'),{status:400});
    send(res,200,{total:rows.length,rows:rows.slice(offset,offset+25),offset,has_more:offset+25<rows.length});
   }else send(res,404,{error:'Recurso não encontrado.'});
   return true;
  }
  if(req.method!=='POST'){send(res,405,{error:'Método inválido.'});return true;}
  if(!req.headers['content-type']?.startsWith('application/json')||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)){send(res,403,{error:'Origem ou formato inválido.'});return true;}
  const chunks=[];let length=0;for await(const c of req){length+=c.length;if(length>32000){send(res,413,{error:'Dados muito longos.'});return true;}chunks.push(c);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Dados inválidos.'),{status:400});}
  const author=authenticatedUsername(req);if(!author){send(res,401,{error:'Acesso não autorizado.'});return true;}
  if(url.pathname==='/api/brain-segments/preview')send(res,200,preview(await loadDataset(),body));
  else if(url.pathname==='/api/brain-segments/lists')send(res,201,await saveList(body,author));
  else if(url.pathname==='/api/brain-segments/annotations')send(res,201,await annotate(body,author));
  else if(url.pathname==='/api/brain-segments/refresh'){invalidateSegments();await loadDataset(true);send(res,200,await listMetadata());}
  else send(res,404,{error:'Recurso não encontrado.'});
 }catch(e){if(!e.status&&e.code!=='23505')console.error('Falha na segmentação:',e.code||e.name);if(e.code==='23505')send(res,409,{error:'Já existe uma lista com esse nome.'});else send(res,e.status||503,{error:e.status?e.message:'Não foi possível consultar a segmentação. Tente atualizar a base em instantes.'});}
 return true;
}
