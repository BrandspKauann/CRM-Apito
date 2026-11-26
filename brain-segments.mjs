import {query,transaction} from './db.mjs';
import {VERSION,fields,fieldMap,templates,normalized,validRule,evaluate} from './segment-rules.mjs';
let cache,pending;
const iso=value=>{if(value===null||value===undefined||value==='')return null;const d=new Date(typeof value==='number'?value*1000:value);return Number.isFinite(+d)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):null;};
const arr=v=>Array.isArray(v)?v:[];
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function fact(value,source,source_id,raw=value,state='confirmed',method='campo explícito',observed_at=null){return {value,source,source_id,raw,state,method,observed_at,rule_version:VERSION};}
const uid=(kind,key)=>kind+':'+key;
function entity(kind,key,name){return {uid:uid(kind,key),kind,key:String(key),name,facts:{}};}
function put(e,key,value,source='Brain Apito',id=e.key,raw=value,state='confirmed',method='campo explícito',at=null){if(value!==null&&value!==undefined&&value!=='')e.facts[key]=fact(value,source,id,raw,state,method,at);}
const eventTypes=new Map([['corporativo','Corporativo'],['dinamica / team building','Desenvolvimento de equipes'],['treinamentos','Desenvolvimento de equipes'],['workshop / cursos','Desenvolvimento de equipes'],['casamento','Social'],['festa','Social'],['debutante','Social'],['ativacoes / experiencias','Ativações e experiências'],['palestras','Palestras'],['frete','Logística'],['gravacao de samba e jingle','Gravação musical']]);
const cfMap=new Map([
 ['tipo de evento','event_type'],['data do evento','event_date'],['como chegou para negociacao?','acquisition'],['local do evento/sala','event_location'],['quantidade de pessoas','participants'],['motivo de perda','loss_reason'],['retorno de contato','return_date'],['proposta','proposal'],['atendente','attendant'],['reuniao de alinhamento','meeting_date'],['tempo de show/evento','duration'],['qual e o objetivo do evento?','briefing_objective']
]);
export async function loadDataset(force=false){
 if(!force&&cache&&Date.now()-cache.loaded<30000)return cache;
 if(pending)return pending;
 pending=readDataset().then(data=>cache=data).finally(()=>pending=undefined);return pending;
}
export function invalidateSegments(){cache=undefined;}
async function readDataset(){
 const raw=await transaction(async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query("SET LOCAL statement_timeout='15s'");
  const data={};
  for(const [key,sql] of Object.entries({
   contacts:'SELECT * FROM brain.contacts ORDER BY id',companies:'SELECT * FROM brain.companies ORDER BY id',
   sources:`SELECT m.*,k.account_id FROM crm_enrichment.crm_contact_sources m LEFT JOIN (SELECT source_id,min(account_id) AS account_id FROM kommo_import.contacts GROUP BY source_id HAVING count(DISTINCT account_id)=1) k ON m.source='kommo' AND k.source_id=m.source_id`,
   leads:`SELECT l.*,r.payload->'closed_at' AS closed_at,r.payload->'created_at' AS created_at,r.payload#>'{_embedded,contacts}' AS people,r.payload->>'is_deleted' AS is_deleted FROM kommo_import.leads l LEFT JOIN kommo_import.records r ON r.account_id=l.account_id AND r.source_id=l.source_id AND r.kind='leads'`,
   metadata:`SELECT account_id,kind,source_id,payload,synced_at FROM kommo_import.records WHERE kind IN ('pipelines','statuses','leads.custom_fields','contacts.custom_fields','companies.custom_fields')`,
   edges:`SELECT DISTINCT account_id,from_kind,from_id,to_kind,to_id FROM kommo_import.edges WHERE from_kind='leads' AND to_kind='contacts'`,
   tasks:'SELECT * FROM kommo_import.tasks',
   agenda_fields:`SELECT contact_id,name,value,raw_value FROM address_book.fields WHERE upper(name) IN ('TITLE','ROLE')`,
   addresses:`SELECT contact_id,array_agg(DISTINCT nullif(trim(city),'')) FILTER (WHERE nullif(trim(city),'') IS NOT NULL) AS cities,array_agg(DISTINCT nullif(trim(region),'')) FILTER (WHERE nullif(trim(region),'') IS NOT NULL) AS regions FROM address_book.addresses GROUP BY contact_id`,
   ambiguous_candidates:`SELECT DISTINCT crm_contact_id FROM kommo_import.contact_match_candidates WHERE ambiguous`,
   meeventos_review:`SELECT account_id,source_type,source_id,match_result FROM crm_enrichment.meeventos_crosswalk WHERE match_result LIKE 'revisar%'`,
   duplicates:'SELECT contact_ids FROM address_book.duplicate_candidates',
   phone_normalized:`SELECT DISTINCT contact_id FROM address_book.phones WHERE normalization_status='explicit_international_unverified' AND match_key IS NOT NULL AND match_key<>''`,
   annotations:`SELECT DISTINCT ON (entity_kind,entity_key,field) * FROM brain.segment_annotations ORDER BY entity_kind,entity_key,field,id DESC`,
   sync:'SELECT account_id,stream,status,rows_seen,updated_at FROM kommo_import.sync_state ORDER BY account_id,stream',
   source_counts:`SELECT 'agenda' AS source,count(*)::int AS count FROM address_book.contacts UNION ALL SELECT 'registros',count(*)::int FROM kommo_import.records UNION ALL SELECT 'relacionamentos',count(*)::int FROM kommo_import.edges UNION ALL SELECT 'mensagens',count(*)::int FROM kommo_import.messages UNION ALL SELECT 'enriquecimentos',count(*)::int FROM address_book.enrichment_facts`
  }))data[key]=(await c.query(sql)).rows;
  return data;
 });
 const entities=new Map(),byKind={contact:[],company:[],opportunity:[]},related=new Map();
 const add=e=>{entities.set(e.uid,e);byKind[e.kind].push(e);related.set(e.uid,{contact:[],company:[],opportunity:[]});return e;};
 const link=(a,b)=>{if(!a||!b)return;const list=related.get(a.uid)[b.kind];if(!list.some(x=>x.uid===b.uid))list.push(b);const reverse=related.get(b.uid)[a.kind];if(!reverse.some(x=>x.uid===a.uid))reverse.push(a);};
 const companies=new Map(raw.companies.map(c=>[String(c.id),add(entity('company',c.id,c.name))]));
 for(const c of raw.companies)put(companies.get(String(c.id)),'company_city',c.city);
 const contacts=new Map(raw.contacts.map(c=>[String(c.id),add(entity('contact',c.id,c.name))]));
 const duplicateIds=new Set(raw.duplicates.flatMap(d=>arr(d.contact_ids).map(String)));
 const agendaFields=new Map();for(const f of raw.agenda_fields){const key=String(f.contact_id);const list=agendaFields.get(key)||[];list.push(f);agendaFields.set(key,list);}
 const addresses=new Map(raw.addresses.map(a=>[String(a.contact_id),a]));
 const normalizedPhones=new Set(raw.phone_normalized.map(r=>String(r.contact_id)));
 for(const c of raw.contacts){
  const e=contacts.get(String(c.id));e.email=c.email;e.phone=c.phone;e.company_key=c.company==null?null:String(c.company);link(e,companies.get(String(c.company)));
  for(const [key,value] of Object.entries({has_email:Boolean(c.email?.trim()),has_phone:Boolean(c.phone?.trim()),email_valid:Boolean(c.email?.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)),phone_normalized:normalizedPhones.has(String(c.address_book_id)),missing_company:!c.company,incomplete:!c.name?.trim()||!c.email?.trim()||!c.phone?.trim()||!c.company,duplicate_candidate:duplicateIds.has(String(c.address_book_id))}))put(e,key,value,'Regra objetiva',c.id,value,'confirmed','verificação do cadastro');
  if(/^(contato|teste|sem nome|desconhecido|cliente|empresa)(\s*\d*)?$/i.test(c.name?.trim()||''))put(e,'generic_name',true,'Regra de revisão',c.id,c.name,'suggested','palavra no nome');
  for(const [name,key] of [['TITLE','job_title'],['ROLE','job_function']]){const original=(agendaFields.get(String(c.address_book_id))||[]).filter(f=>f.name.toUpperCase()===name);const values=[...new Set(original.map(f=>typeof f.value==='string'?f.value:typeof f.raw_value==='string'?f.raw_value:null).filter(v=>v?.trim()))];if(values.length)put(e,key,values.length===1?values[0]:values,'Agenda — campo explícito',String(c.address_book_id),original,values.length>1?'conflict':'confirmed');}
  const addr=addresses.get(String(c.address_book_id));
  if(addr){for(const [key,values] of [['contact_city',arr(addr.cities)],['contact_state',arr(addr.regions)]])if(values.length)put(e,key,values.length===1?values[0]:values,'Agenda — endereço explícito',String(c.address_book_id),values,values.length>1?'conflict':'confirmed');}
  const hints=[[/\b(hotel|resort)\b/i,'sector','Hotelaria e turismo'],[/\b(agencia|produtora)\b/i,'sector','Agências e produtoras'],[/\b(percuss|baterista|cantor|cantora|musico)\w*/i,'specialty','Profissional musical']];
  for(const [pattern,key,value] of hints)if(pattern.test(normalized(c.name)))put(e,key,value,'Regra de revisão',c.id,c.name,'suggested','palavra no nome');
 }
 for(const c of raw.companies){const e=companies.get(String(c.id));if(/\b(hotel|resort)\b/.test(normalized(c.name)))put(e,'sector','Hotelaria e turismo','Regra de revisão',c.id,c.name,'suggested','palavra no nome');if(/\b(agencia|produtora)\b/.test(normalized(c.name)))put(e,'sector','Agências e produtoras','Regra de revisão',c.id,c.name,'suggested','palavra no nome');}
 for(const r of raw.ambiguous_candidates){const e=contacts.get(String(r.crm_contact_id));if(e)put(e,'ambiguous_identity',true,'Candidato de identidade Kommo',e.key,true,'confirmed','correspondência a revisar');}
 const meeventosReview=new Map(raw.meeventos_review.map(r=>[r.source_type+':'+r.source_id,r]));
 const map=new Map();const sourceIds=new Map();
 for(const s of raw.sources){
  const e=contacts.get(String(s.contact_id));if(!e)continue;
  const pendingMatch=meeventosReview.get(s.source+':'+s.source_id);if(pendingMatch)put(e,'ambiguous_identity',true,'Correspondência MeEventos pendente',s.source_id,pendingMatch,'confirmed','correspondência a revisar');
  const list=sourceIds.get(e.uid)||[];list.push({source:s.source,id:s.source_id,account_id:s.account_id});sourceIds.set(e.uid,list);
  if(s.source==='kommo'&&s.account_id!=null){const key=s.account_id+':'+s.source_id;const set=map.get(key)||new Set();set.add(e);map.set(key,set);}
  else if(s.source==='kommo')put(e,'ambiguous_identity',true,'Vínculo sem conta inequívoca',s.source_id,true,'confirmed','revisão de identidade');
 }
 for(const e of contacts.values()){const sources=sourceIds.get(e.uid)||[];if(sources.length)put(e,'source',[...new Set(sources.map(s=>s.source))],'crm_contact_sources',e.key,sources);e.source_links=sources;}
 for(const set of map.values())if(set.size>1)for(const e of set)put(e,'ambiguous_identity',true,'Correspondência múltipla',e.key,true,'confirmed','revisão de identidade');
 const pipeline=new Map(),status=new Map();
 const fieldDefinitions=[];
 for(const r of raw.metadata){
  if(r.kind==='pipelines'){pipeline.set(r.account_id+':'+r.source_id,r.payload.name);for(const s of arr(r.payload._embedded?.statuses))status.set(r.account_id+':'+r.source_id+':'+s.id,s.name);}
  if(r.kind==='statuses')status.set(r.account_id+':'+r.payload.pipeline_id+':'+r.source_id,r.payload.name);
  if(r.kind.endsWith('.custom_fields'))fieldDefinitions.push({account_id:r.account_id,entity:r.kind.split('.')[0],id:r.source_id,name:r.payload.name,type:r.payload.type,options:r.payload.enums||[],source_updated_at:r.synced_at});
 }
 const opportunities=new Map(),today=iso(Date.now()/1000);const fieldCoverage=new Map();
 for(const l of raw.leads){
  if(l.is_deleted==='true')continue;
  const key=l.account_id+':'+l.source_id,e=add(entity('opportunity',key,l.name));opportunities.set(key,e);e.account_id=l.account_id;e.pipeline_id=l.pipeline_id;e.status_id=l.status_id;e.source_id=l.source_id;e.source_updated_at=l.synced_at;
  put(e,'account_id',String(l.account_id),'Kommo',key);put(e,'pipeline_id',l.pipeline_id,'Kommo',key);put(e,'status_id',l.status_id,'Kommo',key);
  const pname=pipeline.get(l.account_id+':'+l.pipeline_id),sname=status.get(l.account_id+':'+l.pipeline_id+':'+l.status_id);
  put(e,'pipeline_name',pname,'Kommo',key);put(e,'stage_name',sname,'Kommo',key,{account_id:l.account_id,pipeline_id:l.pipeline_id,status_id:l.status_id,label:sname});
  put(e,'technical_status',l.status_id==='142'?'Encerrado ganho':l.status_id==='143'?'Encerrado perdido':'Aberto','Protocolo Kommo',key,{status_id:l.status_id,label:sname});
  put(e,'source','Kommo','Kommo',key);put(e,'quoted_value',l.price===null?null:Number(l.price),'Kommo',key,l.price);
  put(e,'owner',l.responsible_user_id,'Kommo',key);
  if(['venda perdida','perdido','fechado - perdido','fechado perdido'].includes(normalized(sname)))put(e,'commercial_result','Perda confirmada','Etapa comercial Kommo',key,{pipeline:pname,stage:sname});
  if(normalized(sname)==='atendimento finalizado')put(e,'commercial_result','Atendimento encerrado','Etapa comercial Kommo',key,{pipeline:pname,stage:sname});
  if(normalized(sname)==='venda ganha'&&normalized(pname)==='funil comercial')put(e,'commercial_result','Venda confirmada','Etapa comercial Kommo',key,{pipeline:pname,stage:sname});
  if(normalized(sname)==='evento finalizado'){put(e,'commercial_result','Evento realizado','Etapa comercial Kommo',key,{pipeline:pname,stage:sname});put(e,'event_situation','Realizado','Etapa comercial Kommo',key,sname);}
  if(['evento confirmado','eventos confirmados','contrato assinado'].includes(normalized(sname)))put(e,'event_situation','Confirmado','Etapa comercial Kommo',key,sname);
  for(const f of arr(l.custom_fields)){
   const k=cfMap.get(normalized(f.field_name));const fv=arr(f.values).map(v=>v.value).filter(v=>v!==null&&v!==undefined&&v!=='');
   const coverageKey=l.account_id+':'+f.field_id;const covered=fieldCoverage.get(coverageKey)||new Set();covered.add(key);fieldCoverage.set(coverageKey,covered);
   if(!k||!fv.length)continue;
   let value=fv.length===1?fv[0]:fv;
   if(['event_date','return_date','meeting_date'].includes(k))value=typeof value==='number'||/^\d{9,10}$/.test(String(value))?iso(Number(value)):null;
   if(k==='participants')value=/^\d+$/.test(String(value))&&Number(value)>0?Number(value):null;
   if(k==='event_type')value=eventTypes.get(normalized(value))||value;
   put(e,k,value,'Campo Kommo',key,{field_id:f.field_id,field_name:f.field_name,values:f.values},'confirmed','campo explícito',l.synced_at);
  }
  if(normalized(e.facts.loss_reason?.value)==='evento cancelado')put(e,'event_situation','Cancelado','Motivo documentado Kommo',key,e.facts.loss_reason.raw);
  if(!e.facts.event_situation&&e.facts.event_date&&e.facts.technical_status?.value==='Aberto')put(e,'event_situation','Em negociação','Oportunidade aberta com data registrada',key,{status:l.status_id,date:e.facts.event_date.value});
  for(const p of arr(l.people)){const matches=map.get(l.account_id+':'+p.id);if(matches?.size===1)link(e,[...matches][0]);}
 }
 for(const r of raw.edges){const e=opportunities.get(r.account_id+':'+r.from_id),matches=map.get(r.account_id+':'+r.to_id);if(matches?.size===1)link(e,[...matches][0]);}
 // A contact's employer is not evidence that the company bought an opportunity.
 // Imported company identities remain unlinked until a source-backed crosswalk exists.
 for(const e of entities.values()){
  const tasks=raw.tasks.filter(t=>e.kind==='opportunity'?t.entity_type==='leads'&&String(t.account_id)===String(e.account_id)&&String(t.entity_id)===String(e.source_id):false);
  if(tasks.length){put(e,'task_open',tasks.some(t=>!t.is_completed),'Kommo tasks',e.key,tasks.map(t=>t.source_id));put(e,'task_overdue',tasks.some(t=>!t.is_completed&&t.due_at&&new Date(t.due_at)<new Date()),'Kommo tasks',e.key,tasks.filter(t=>!t.is_completed).map(t=>({id:t.source_id,due_at:t.due_at})));}
 }
 for(const e of contacts.values()){
  const opps=related.get(e.uid).opportunity;put(e,'opportunities_count',opps.length,'Vínculos por conta Kommo',e.key,opps.map(o=>o.key));
  if(opps.some(o=>o.facts.task_open?.value))put(e,'task_open',true,'Tarefas vinculadas',e.key,opps.filter(o=>o.facts.task_open?.value).map(o=>o.key));
  if(opps.some(o=>o.facts.task_overdue?.value))put(e,'task_overdue',true,'Tarefas vinculadas',e.key,opps.filter(o=>o.facts.task_overdue?.value).map(o=>o.key));
  if(opps.some(o=>o.facts.commercial_result?.value==='Venda confirmada'))put(e,'relationship',['Cliente'],'Venda comercial comprovada',e.key,opps.filter(o=>o.facts.commercial_result?.value==='Venda confirmada').map(o=>o.key));
 }

 for(const a of raw.annotations){const e=entities.get(uid(a.entity_kind,a.entity_key));if(e&&fieldMap.has(a.field)){e.facts[a.field]=fact(a.value,a.source,a.source_id||String(a.id),a.evidence,a.state,a.method,a.observed_at);e.facts[a.field].annotation_id=a.id;e.facts[a.field].author=a.author;}}
 for(const e of entities.values()){
  if(e.facts.event_date?.value){const date=e.facts.event_date.value;put(e,'event_month',Number(date.slice(5,7)),'Derivação da data do evento',e.key,date);put(e,'event_year',Number(date.slice(0,4)),'Derivação da data do evento',e.key,date);put(e,'days_to_event',Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000),'Derivação da data do evento',e.key,date);}
  put(e,'review_needed',Object.values(e.facts).some(f=>['suggested','conflict'].includes(f.state)),'Revisão de evidências',e.key);
 }
 const dataset={loaded:Date.now(),indexed_at:new Date().toISOString(),today,entities,byKind,related,sync:raw.sync,source_counts:raw.source_counts,field_definitions:fieldDefinitions.map(f=>({...f,filled_opportunities:fieldCoverage.get(f.account_id+':'+f.id)?.size||0})),identity:{mapped_kommo_ids:map.size,ambiguous_kommo_ids:[...map.values()].filter(s=>s.size!==1).length,opportunities_without_contact:byKind.opportunity.filter(e=>!related.get(e.uid).contact.length).length}};
 return dataset;
}
export function preview(dataset,{entity_kind='contact',criteria,offset=0,limit=25}){
 if(!['contact','company','opportunity'].includes(entity_kind)||!validRule(criteria)||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(Error('Confira a entidade, os filtros e a paginação.'),{status:400});
 const matches=[];let unknown=0;
 for(const e of dataset.byKind[entity_kind]){const r=evaluate(criteria,e,dataset);if(r.match===true)matches.push({entity:e,proof:r.proof});else if(r.match===null)unknown++;}
 return {total:matches.length,unknown,evaluated:dataset.byKind[entity_kind].length,rows:matches.slice(offset,offset+limit).map(({entity:e,proof})=>({kind:e.kind,key:e.key,name:e.name,email:e.email,phone:e.phone,proof})),offset,has_more:offset+limit<matches.length,indexed_at:dataset.indexed_at,rule_version:VERSION};
}
export function coverage(dataset){
 return fields.map(f=>{const entities=f.entity==='any'?[...dataset.entities.values()]:dataset.byKind[f.entity];const c={...f,total:entities.length,confirmed:0,suggested:0,conflict:0,unknown:0};for(const e of entities){const fact=e.facts[f.key];if(fact?.state==='conflict')c.conflict++;else if(!fact||fact.value===null||fact.state==='unknown'||fact.state==='rejected')c.unknown++;else if(fact.state==='suggested')c.suggested++;else c.confirmed++;}return c;});
}
export async function seedLists(){
 for(const t of templates)await query('INSERT INTO brain.segment_saved_lists(name,entity_kind,criteria,template_key,author) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[t.name,t.entity_kind,t.criteria,t.key,'Implantação de regras versionadas']);
}
export async function listMetadata(){
 const d=await loadDataset();const lists=(await query('SELECT * FROM brain.segment_saved_lists ORDER BY id')).rows;
 return {dimensions:(await import('./segment-rules.mjs')).dimensions,fields,coverage:coverage(d),counts:Object.fromEntries(Object.entries(d.byKind).map(([k,v])=>[k,v.length])),source_counts:d.source_counts,identity:d.identity,indexed_at:d.indexed_at,rule_version:VERSION,sync:d.sync,field_definitions:d.field_definitions,lists:lists.map(l=>({...l,...preview(d,{entity_kind:l.entity_kind,criteria:l.criteria,limit:1}),rows:undefined})),limitations:['Contagens representam cadastros, não pessoas únicas.','Mensagens e enriquecimentos podem não estar disponíveis; consulte a cobertura.','Recorrência e recebimentos exigem evidências e revisão de contratações distintas.','Sugestões no nome não são classificações confirmadas.','A cidade da empresa e o local do evento não identificam a cidade do contato.']};
}
export async function saveList(body,author){
 if(!body||typeof body.name!=='string'||!body.name.trim()||body.name.length>100||!['contact','company','opportunity'].includes(body.entity_kind)||!validRule(body.criteria))throw Object.assign(Error('Nome ou regras da lista inválidos.'),{status:400});
 return (await query('INSERT INTO brain.segment_saved_lists(name,entity_kind,criteria,author) VALUES($1,$2,$3,$4) RETURNING *',[body.name.trim(),body.entity_kind,body.criteria,author])).rows[0];
}
export async function annotate(body,author,{dataset,transact=transaction}={}){
 const d=dataset||await loadDataset();const e=d.entities.get(uid(body.entity_kind,body.entity_key));const f=fieldMap.get(body.field);
 if(!e||!f?.manual||!['any',e.kind].includes(f.entity)||!['confirmed','rejected','conflict','unknown'].includes(body.state)||typeof body.evidence!=='string'||body.evidence.trim().length<3||body.evidence.length>2000)throw Object.assign(Error('Confira o cadastro, o campo, a decisão e a evidência.'),{status:400});
 const vals=Array.isArray(body.value)?body.value:[body.value];
 if(body.state==='confirmed'&&(['participants','confirmed_contracts','recurrence_12m','recurrence_24m'].includes(f.key))&&!vals.every(v=>Number.isSafeInteger(v)&&v>=(f.key==='participants'?1:0)))throw Object.assign(Error('Informe uma quantidade inteira válida.'),{status:400});
 if(body.state==='confirmed'&&(vals.length<1||vals.length>20||!vals.every(v=>validRule({field:f.key,operator:'eq',value:v}))))throw Object.assign(Error('Valor incompatível com o campo.'),{status:400});
 const row=await transact(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[e.uid+':'+f.key]);
  const last=(await c.query('SELECT id FROM brain.segment_annotations WHERE entity_kind=$1 AND entity_key=$2 AND field=$3 ORDER BY id DESC LIMIT 1',[e.kind,e.key,f.key])).rows[0];
  if(String(last?.id||'')!==String(body.previous_id||''))throw Object.assign(Error('Este campo foi revisado por outra pessoa. Atualize antes de salvar.'),{status:409});
  return (await c.query('INSERT INTO brain.segment_annotations(entity_kind,entity_key,field,value,state,evidence,author,previous_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[e.kind,e.key,f.key,JSON.stringify(body.state==='unknown'?null:body.value??null),body.state,body.evidence.trim(),author,last?.id||null])).rows[0];
 });invalidateSegments();return row;
}
