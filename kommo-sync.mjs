import {createHash} from 'node:crypto';
import {extendedStreams, extendPage} from './kommo-extended.mjs';

const base = '/api/v4/';
const entityKinds = ['contacts', 'leads', 'companies'];
const sources = [
  ['contacts', 'contacts?with=leads,catalog_elements'],
  ['leads', 'leads?with=contacts,catalog_elements,loss_reason,source,source_id,is_price_modified_by_robot'],
  ['companies', 'companies?with=contacts,leads,catalog_elements'],
  ['pipelines', 'leads/pipelines'], ['loss_reasons', 'leads/loss_reasons'],
  ['tasks', 'tasks'], ['events', 'events'], ['catalogs', 'catalogs'],
  ['users', 'users?with=role'], ['roles', 'roles?with=users'], ['sources', 'sources'],
  ['unsorted', 'leads/unsorted']
];
export function initialStreams() {
  const specs = sources.map(([kind, path]) => ({kind, stream:kind, key:kind, path:base + path}));
  // The events endpoint on this account accepts unfiltered pages of 100.
  specs.find(s => s.kind === 'events').limit = 100;
  for (const entity of entityKinds) {
    for (const [path, key] of [['notes','notes'], ['tags','tags'], ['custom_fields','custom_fields'],
      ['custom_fields/groups','custom_field_groups']]) {
      const kind = entity + '.' + key;
      specs.push({kind, stream:kind, key, path:base + entity + '/' + path});
    }
  }
  specs.push({stream:'deleted_leads',kind:'deleted_leads',key:'leads',path:base + 'leads?with=only_deleted'});
  return [...specs,...extendedStreams];
}

function invalid(message) {
  const error = Error(message);
  error.importFormat = true;
  throw error;
}
export function unpackPage(spec, body, page) {
  if (body == null) return {rows:[], nextPage:null}; // HTTP 204
  if (spec.single) return {rows:[body], nextPage:null};
  const collections = Object.values(body._embedded || {}).filter(Array.isArray);
  const rows = Array.isArray(body) ? body : body._embedded?.[spec.key] ?? body[spec.key] ??
    (collections.length===1 ? collections[0] : undefined);
  if (!Array.isArray(rows)) invalid('Formato de listagem inesperado.');
  if (body._page != null && Number(body._page)!==page && rows.length) invalid('A Kommo devolveu outra página.');
  const next = body._links?.next?.href;
  let nextPage = null;
  if (next) {
    const parsed = new URL(next, 'https://example.invalid');
    const parameter = parsed.searchParams.get('page');
    nextPage = parameter === null ? page + 1 : Number(parameter);
    if (!rows.length || nextPage !== page + 1) invalid('Sequência de páginas inesperada.');
  } else if (!spec.unpaged && rows.length >= (spec.limit || 250)) {
    nextPage = page + 1;
  }
  return {rows, nextPage};
}

function entityKind(type) {
  return ({lead:'leads', contact:'contacts', company:'companies', task:'tasks'})[type] || type;
}
function unique(rows, keys) {
  const values = new Map();
  for (const row of rows) values.set(JSON.stringify(keys.map(key => row[key])), row);
  return [...values.values()];
}
export function preparePage(spec, rows, account) {
  const records = [], edges = [], streams = [];
  const edge = (kind,id,relation,toKind,toId,payload={}) => {
    if (toKind && toId != null && String(toId) !== '0') {
      edges.push({from_kind:kind,from_id:String(id),relation,to_kind:toKind,to_id:String(toId),payload});
    }
  };
  for (const row of rows) {
    let id = spec.primaryKey ? row[spec.primaryKey] : row.id ?? row.uuid ?? row.uid;
    if (spec.linkOwner) {
      const toKind = row.to_entity_type, toId = row.to_entity_id;
      if (toKind == null || toId == null) invalid('Vínculo sem identificador.');
      id = [spec.linkOwner.id,toKind,toId].join(':');
      edge(spec.linkOwner.kind,spec.linkOwner.id,'links',toKind,toId,row);
    }
    if (id == null || String(id) === '') invalid('Registro sem identificador de origem.');
    if (spec.stream.startsWith('messages:') || spec.stream.startsWith('file_versions:')) {
      id = spec.stream.slice(spec.stream.indexOf(':') + 1) + ':' + id;
    }
    records.push({kind:spec.kind,source_id:String(id),payload:row});
    if (entityKinds.includes(spec.kind)) {
      const kind = spec.kind;
      const links = row._embedded;
      if (!links || ['contacts','leads','companies','catalog_elements','customers'].some(key=>links[key]?.length)) {
        streams.push({stream:'links.'+kind+':'+id, kind:'links.'+kind, key:'links',
          path:base+kind+'/'+encodeURIComponent(id)+'/links', linkOwner:{kind,id:String(id)}});
      }
      for (const [type, linked] of Object.entries(row._embedded || {})) {
        if (!Array.isArray(linked)) continue;
        for (const item of linked) {
          const dest = type==='tags' ? kind+'.tags' : type==='catalog_elements' && item?.catalog_id ?
            'catalogs.'+item.catalog_id+'.elements' : type;
          edge(kind,id,type,dest,item?.id,item);
        }
      }
      edge(kind,id,'pipeline','pipelines',row.pipeline_id);
      if (row.pipeline_id && row.status_id) edge(kind,id,'status','statuses',row.pipeline_id+':'+row.status_id);
      edge(kind,id,'responsible_user','users',row.responsible_user_id);
    }
    if (spec.kind.endsWith('.notes')) edge(spec.kind,id,'entity',spec.kind.split('.')[0],row.entity_id);
    if (spec.kind === 'tasks' || spec.kind === 'events') edge(spec.kind,id,'entity',entityKind(row.entity_type),row.entity_id);
    if (spec.kind === 'pipelines') {
      for (const stage of row._embedded?.statuses || []) {
        const sourceId = id+':'+stage.id;
        records.push({kind:'statuses',source_id:sourceId,payload:stage});
        edge('statuses',sourceId,'pipeline','pipelines',id);
      }
    }
    if (spec.kind === 'catalogs') {
      for (const resource of ['elements','custom_fields']) {
        const kind = 'catalogs.'+id+'.'+resource;
        streams.push({stream:kind,kind,key:resource,path:base+'catalogs/'+encodeURIComponent(id)+'/'+resource});
      }
    }
  }
  let extra;
  try { extra = extendPage({stream:spec.stream,kind:spec.kind,rows,account}); }
  catch { invalid('Formato de registro da Kommo inesperado.'); }
  return {
    records:unique([...records,...extra.records || []],['kind','source_id']),
    edges:unique([...edges,...extra.edges || []],['from_kind','from_id','relation','to_kind','to_id']),
    streams:[...streams,...extra.streams || []]
  };
}

async function enqueue(client, accountId, specs) {
  if (!specs.length) return;
  await client.query(`WITH access AS (
      SELECT EXISTS(SELECT FROM kommo_import.sync_state WHERE account_id=$1 AND stream='@source'
        AND cursor->>'messageScopeDenied'='true') AS denied
    ), queued AS (
      SELECT s, denied AND s->>'kind'='messages' AS blocked FROM jsonb_array_elements($2::jsonb) s, access
    )
    INSERT INTO kommo_import.sync_state(account_id,stream,cursor,status)
    SELECT $1,s->>'stream',jsonb_build_object('spec',s,'page',1) ||
      CASE WHEN blocked THEN jsonb_build_object('error','Kommo requer a permissão External chat history.')
      ELSE '{}'::jsonb END, CASE WHEN blocked THEN 'blocked' ELSE 'pending' END
    FROM queued ON CONFLICT DO NOTHING`,
  [accountId, JSON.stringify(specs)]);
}
async function writePage(client, accountId, {records, edges, streams}) {
  if (records.length) await client.query(`INSERT INTO kommo_import.records(account_id,kind,source_id,payload)
    SELECT $1,r.kind,r.source_id,r.payload FROM jsonb_to_recordset($2::jsonb) AS r(kind text,source_id text,payload jsonb)
    ON CONFLICT(account_id,kind,source_id) DO UPDATE SET payload=EXCLUDED.payload,synced_at=now()`,
  [accountId,JSON.stringify(records)]);
  if (edges.length) await client.query(`INSERT INTO kommo_import.edges(account_id,from_kind,from_id,relation,to_kind,to_id,payload)
    SELECT $1,e.* FROM jsonb_to_recordset($2::jsonb) AS e(from_kind text,from_id text,relation text,to_kind text,to_id text,payload jsonb)
    ON CONFLICT(account_id,from_kind,from_id,relation,to_kind,to_id) DO UPDATE SET payload=EXCLUDED.payload`,
  [accountId,JSON.stringify(edges)]);
  await enqueue(client, accountId, streams);
}
function resourcePath(spec, page) {
  const url = new URL(spec.path,'https://example.invalid');
  if (!spec.single && !spec.unpaged) {
    url.searchParams.set('page',String(page));
    url.searchParams.set('limit',String(spec.limit || 250));
  }
  return url.pathname + url.search;
}
async function loadSource(origin) {
  const {query} = await import('./db.mjs');
  const result = await query(`SELECT s.account_id, a.payload FROM kommo_import.sync_state s
    JOIN kommo_import.records a ON a.account_id=s.account_id AND a.kind='account' AND a.source_id=s.account_id::text
    WHERE s.stream='@source' AND s.cursor->>'origin'=$1 ORDER BY s.updated_at DESC LIMIT 1`,[origin]);
  return result.rows[0]?.payload;
}
async function initialize(origin, request) {
  let account;
  try { account = await request('/api/v4/account?with=drive_url,users_groups,task_types,amojo_id'); }
  catch (e) {
    if (![400,403].includes(e.status)) throw e;
    account = await request('/api/v4/account');
  }
  if (!Number.isSafeInteger(account?.id) || account.id <= 0) invalid('Não foi possível identificar a conta.');
  const {transaction} = await import('./db.mjs');
  await transaction(async client => {
    await writePage(client,account.id,{
      records:[{kind:'account',source_id:String(account.id),payload:account}],
      edges:[],streams:initialStreams()
    });
    await client.query(`INSERT INTO kommo_import.sync_state(account_id,stream,cursor,status,rows_seen)
      VALUES($1,'@source',jsonb_build_object('origin',$2::text),'complete',1)
      ON CONFLICT(account_id,stream) DO UPDATE SET cursor=jsonb_set(kommo_import.sync_state.cursor,'{origin}',to_jsonb($2::text))`,[account.id,origin]);
  });
  return account;
}
async function summarize(account) {
  if (!account) return {status:'idle', streams:[], retryAfterMs:0};
  const {query} = await import('./db.mjs');
  const result = await query(`SELECT COALESCE(cursor->'spec'->>'kind','account') AS stream,
    CASE WHEN bool_or(status='running') THEN 'running'
         WHEN bool_or(status='retrying') THEN 'retrying'
         WHEN bool_or(status='pending') THEN 'pending'
         WHEN bool_or(status='error') THEN 'error'
         WHEN bool_or(status='blocked') THEN 'blocked' ELSE 'complete' END AS status,
    sum(rows_seen)::text AS rows_seen, min(cursor->>'error') AS error,
    min((cursor->>'retryAt')::bigint) FILTER(WHERE status='retrying') AS retry_at,
    max((cursor->>'pauseUntil')::bigint) AS pause_until
    FROM kommo_import.sync_state WHERE account_id=$1 GROUP BY 1 ORDER BY 1`,[account.id]);
  const rows = result.rows;
  const hasWork = rows.some(r=>['pending','running','retrying'].includes(r.status));
  const status = hasWork ? 'running' : rows.some(r=>r.status!=='complete') ? 'partial' : 'complete';
  const pauseUntil = Math.max(0,...rows.map(r=>Number(r.pause_until) || 0));
  const next = rows.filter(r=>r.retry_at).map(r=>Number(r.retry_at));
  const retryAt = next.length && !rows.some(r=>['pending','running'].includes(r.status)) ? Math.min(...next) : 0;
  return {status,streams:rows.map(({stream,status,rows_seen,error}) =>
    ({stream,status,rows_seen:Number(rows_seen),...(error ? {error} : {})})),
    retryAfterMs:hasWork ? Math.max(250,pauseUntil-Date.now(),retryAt-Date.now()) : 0};
}
export async function syncStatus(origin) {
  return summarize(await loadSource(origin));
}
// Kommo also serves a filtered entity-links collection on supported accounts.
// Never infer a missing owner's links from some other owner's successful result.
export function groupedLinks(body, ownerKind, owners) {
  const links = body?._embedded?.links;
  if (!Array.isArray(links) || !links.length || body._links?.next?.href ||
      (body._total_items != null && Number(body._total_items)!==links.length) ||
      (links.length>=250 && body._total_items==null)) return null;
  const allowed = new Set(owners.map(String)), grouped = new Map();
  for (const link of links) {
    const id = String(link.entity_id);
    if (!allowed.has(id) || link.entity_type!==ownerKind || !link.to_entity_type || !link.to_entity_id) return null;
    if (!grouped.has(id)) grouped.set(id,[]);
    grouped.get(id).push(link);
  }
  return grouped;
}
function sameLinks(first, second) {
  const identity = row => JSON.stringify([row.to_entity_type,String(row.to_entity_id),row.metadata ?? null]);
  return JSON.stringify(first.map(identity).sort())===JSON.stringify(second.map(identity).sort());
}
async function setBulkMode(client, accountId, kind, value) {
  await client.query(`UPDATE kommo_import.sync_state SET cursor=jsonb_set(cursor,ARRAY[$2::text],to_jsonb($3::text))
    WHERE account_id=$1 AND stream='@source'`,[accountId,'bulk_'+kind,value]);
}
async function importLinkGroup(client,account,request,spec,mode) {
  const ownerKind = spec.linkOwner.kind;
  const jobs = await client.query(`SELECT stream,cursor->'spec' AS spec FROM kommo_import.sync_state
    WHERE account_id=$1 AND stream LIKE $2 AND status='pending' AND rows_seen=0
      AND NOT(cursor ? 'bulkFallback') ORDER BY stream LIMIT 40`,
    [account.id,'links.'+ownerKind+':%']);
  if (jobs.rows.length<2) return false;
  const ids = jobs.rows.map(job=>String(job.spec.linkOwner.id));
  const params=new URLSearchParams();
  ids.forEach(id=>params.append('filter[entity_id][]',id));
  const path=base+ownerKind+'/links?'+params;
  let grouped;
  try {
    grouped=groupedLinks(await request(path),ownerKind,ids);
    if (grouped && mode!=='verified') {
      const [sampleId,sampleLinks] = grouped.entries().next().value;
      const sample = jobs.rows.find(job=>String(job.spec.linkOwner.id)===sampleId);
      const response = await request(resourcePath(sample.spec,1));
      const page = unpackPage(sample.spec,response,1);
      if (page.nextPage || !sameLinks(page.rows,sampleLinks)) grouped=null;
    }
  } catch(e) {
    if (!e.importFormat && ![400,403,404,405,422].includes(e.status)) throw e;
    grouped=null;
  }
  if (!grouped) {
    if (mode!=='verified') await setBulkMode(client,account.id,ownerKind,'individual');
    else await client.query(`UPDATE kommo_import.sync_state SET cursor=cursor || '{"bulkFallback":true}'::jsonb
      WHERE account_id=$1 AND stream=ANY($2::text[])`,[account.id,jobs.rows.map(job=>job.stream)]);
    return false;
  }
  if (mode!=='verified') await setBulkMode(client,account.id,ownerKind,'verified');
  const records=[],edges=[],counts=[],missing=[];
  for (const job of jobs.rows) {
    const links = grouped.get(String(job.spec.linkOwner.id));
    if (!links) { missing.push(job.stream); continue; }
    const batch = preparePage(job.spec, links, account);
    records.push(...batch.records);
    edges.push(...batch.edges);
    counts.push({stream:job.stream,n:links.length});
  }
  await writePage(client,account.id,{records,edges,streams:[]});
  await client.query(`UPDATE kommo_import.sync_state s SET status='complete',rows_seen=rows_seen+x.n,
    updated_at=clock_timestamp() FROM jsonb_to_recordset($2::jsonb) x(stream text,n int)
    WHERE s.account_id=$1 AND s.stream=x.stream`,[account.id,JSON.stringify(counts)]);
  if (missing.length) await client.query(`UPDATE kommo_import.sync_state SET cursor=cursor || '{"bulkFallback":true}'::jsonb
    WHERE account_id=$1 AND stream=ANY($2::text[])`,[account.id,missing]);
  return true;
}
async function onePage(client, account, request) {
  // A single transaction owns the remote request, records, links and cursor. A terminated
  // worker rolls everything back, and a concurrent invocation immediately yields.
  const lock = await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',[account.id]);
  if (!lock.rows[0].locked) return false;
  const source = await client.query(`SELECT cursor FROM kommo_import.sync_state WHERE account_id=$1 AND stream='@source'`,[account.id]);
  const sourceState = source.rows[0]?.cursor || {};
  if (Number(sourceState.pauseUntil)>Date.now()) return false;
  // Probe once early for each owner type, while the core streams are still being imported.
  for (const kind of entityKinds.filter(k=>!sourceState['bulk_'+k])) {
    const probe = await client.query(`SELECT cursor->'spec' AS spec FROM kommo_import.sync_state
      WHERE account_id=$1 AND stream LIKE $2 AND status='pending' ORDER BY stream OFFSET 1 LIMIT 1`,
    [account.id,'links.'+kind+':%']);
    if (!probe.rows.length) continue;
    // A transient server/rate-limit error uses the per-stream retry handling below.
    sourceState.probe = probe.rows[0].spec.stream;
    break;
  }
  const result = await client.query(`SELECT stream,cursor FROM kommo_import.sync_state
    WHERE account_id=$1 AND status IN ('pending','running','retrying')
      AND COALESCE((cursor->>'retryAt')::bigint,0) <= $2
      AND NOT EXISTS(SELECT FROM kommo_import.sync_state WHERE account_id=$1 AND stream='@source'
        AND COALESCE((cursor->>'pauseUntil')::bigint,0)>$2)
    ORDER BY CASE WHEN (stream='talks' AND cursor->>'page'='1') OR (stream LIKE 'messages:%' AND NOT EXISTS (
          SELECT FROM kommo_import.sync_state WHERE account_id=$1 AND stream='@source' AND cursor->>'messageProbed'='true'
        )) THEN -1
        WHEN stream LIKE 'links.%:%' OR stream LIKE 'file_links:%' OR stream LIKE 'file_versions:%' THEN 2
        WHEN stream LIKE 'messages:%' THEN 1 ELSE 0 END, updated_at, stream LIMIT 1`,[account.id,Date.now()]);
  if (!result.rows.length) return false;
  let {stream,cursor} = result.rows[0];
  if (sourceState.probe) {
    const probe = await client.query('SELECT stream,cursor FROM kommo_import.sync_state WHERE account_id=$1 AND stream=$2',
      [account.id,sourceState.probe]);
    if (probe.rowCount) ({stream,cursor}=probe.rows[0]);
  }
  const {spec,page} = cursor;
  let next, batch;
  try {
    if (spec.linkOwner && !cursor.bulkFallback && page===1 && sourceState['bulk_'+spec.linkOwner.kind]!=='individual' &&
        await importLinkGroup(client,account,request,spec,sourceState['bulk_'+spec.linkOwner.kind])) return true;
    const response = await request(resourcePath(spec,page),spec.host,account);
    const unpacked = unpackPage(spec,response,page);
    next = unpacked.nextPage;
    batch = preparePage(spec,unpacked.rows,account);
    const signature = createHash('sha256').update(JSON.stringify(batch.records.map(r=>[r.kind,r.source_id]))).digest('hex');
    if (unpacked.rows.length && signature===cursor.previous) invalid('A Kommo repetiu a página anterior.');
    await writePage(client,account.id,batch);
    if (spec.kind==='messages') await client.query(`UPDATE kommo_import.sync_state SET
      cursor=cursor || '{"messageProbed":true}'::jsonb WHERE account_id=$1 AND stream='@source'
      AND NOT (cursor ? 'messageProbed')`,[account.id]);
    await client.query(`UPDATE kommo_import.sync_state SET status=$3,rows_seen=rows_seen+$4,
      cursor=jsonb_build_object('spec',$5::jsonb,'page',$6::int,'previous',$7::text),updated_at=clock_timestamp()
      WHERE account_id=$1 AND stream=$2`,[account.id,stream,next?'running':'complete',
        unpacked.rows.length,JSON.stringify(spec),next || page,signature]);
    return true;
  } catch (error) {
    // Never commit partial writes after database errors: let the transaction roll back.
    if (!error.importFormat && !error.remote) throw error;
    const status = error.status, attempts=(cursor.attempts || 0) + 1;
    const transient = error.remote && (!status || [408,425,429].includes(status) || status>=500);
    const retry = transient && attempts <= 8;
    const delay = Math.max(error.retryAfterMs || 0, Math.min(120000, 2000*2**Math.min(attempts-1,6)));
    cursor.error = error.importFormat ? error.message : status ? 'Kommo respondeu HTTP ' + status : 'Falha de comunicação com a Kommo.';
    cursor.attempts = attempts;
    cursor.retryAt = retry ? Date.now()+delay : 0;
    if (spec.kind==='messages' && error.messageScopeDenied) {
      cursor.error = 'Kommo requer a permissão External chat history.';
      await client.query(`UPDATE kommo_import.sync_state SET cursor=cursor ||
        '{"messageProbed":true,"messageScopeDenied":true}'::jsonb WHERE account_id=$1 AND stream='@source'`,[account.id]);
      await client.query(`UPDATE kommo_import.sync_state SET status='blocked',updated_at=clock_timestamp(),
        cursor=jsonb_set(cursor,'{error}',to_jsonb($2::text)) WHERE account_id=$1 AND stream LIKE 'messages:%'
        AND status IN ('pending','running','retrying')`,[account.id,cursor.error]);
    } else if (spec.kind==='messages' && !retry) {
      await client.query(`UPDATE kommo_import.sync_state SET cursor=cursor || '{"messageProbed":true}'::jsonb
        WHERE account_id=$1 AND stream='@source' AND NOT (cursor ? 'messageProbed')`,[account.id]);
    }
    if (status===429) await client.query(`UPDATE kommo_import.sync_state SET
      cursor=jsonb_set(cursor,'{pauseUntil}',to_jsonb($2::bigint)) WHERE account_id=$1 AND stream='@source'`,
      [account.id,Date.now()+delay]);
    await client.query(`UPDATE kommo_import.sync_state SET status=$3,cursor=$4::jsonb,updated_at=clock_timestamp()
      WHERE account_id=$1 AND stream=$2`,[account.id,stream,retry?'retrying':
        [401,402,403].includes(status)?'blocked':'error',JSON.stringify(cursor)]);
    return status !== 429;
  }
}
export async function advanceSync(origin, request, retry) {
  const started = Date.now();
  const account = await loadSource(origin) || await initialize(origin, request);
  const {transaction,query} = await import('./db.mjs');
  if (retry) await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[account.id]);
    await client.query(`UPDATE kommo_import.sync_state SET cursor=cursor-'messageProbed'-'messageScopeDenied'
      WHERE account_id=$1 AND stream='@source'`,[account.id]);
    await client.query(`UPDATE kommo_import.sync_state SET status='pending',
      cursor=cursor-'attempts'-'retryAt'-'error',updated_at=clock_timestamp()
      WHERE account_id=$1 AND status IN ('blocked','error')`,[account.id]);
  });
  for (let i=0;i<25 && Date.now()-started<11000;i++) {
    if (!await transaction(client=>onePage(client,account,request))) break;
    await new Promise(resolve=>setTimeout(resolve,180));
  }
  return summarize(account);
}
