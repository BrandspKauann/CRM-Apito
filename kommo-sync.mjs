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
export function initialStreams(cutoff) {
  const specs = sources.map(([kind, path]) => ({kind, stream:kind, key:kind, path:base + path}));
  // Freeze the upper endpoint of this archive so newly created events do not shift its pages.
  specs.find(s => s.kind === 'events').path += '?filter[created_at][to]=' + cutoff;
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
  const rows = Array.isArray(body) ? body : body._embedded?.[spec.key] ?? body[spec.key];
  if (!Array.isArray(rows)) invalid('Formato de listagem inesperado.');
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
        for (const item of linked) edge(kind,id,type,type === 'tags' ? kind+'.tags' : type,item?.id,item);
      }
      edge(kind,id,'pipeline','pipelines',row.pipeline_id);
      edge(kind,id,'status','statuses',row.status_id);
      edge(kind,id,'responsible_user','users',row.responsible_user_id);
    }
    if (spec.kind.endsWith('.notes')) edge(spec.kind,id,'entity',spec.kind.split('.')[0],row.entity_id);
    if (spec.kind === 'tasks' || spec.kind === 'events') edge(spec.kind,id,'entity',entityKind(row.entity_type),row.entity_id);
    if (spec.kind === 'pipelines') {
      for (const stage of row._embedded?.statuses || []) {
        records.push({kind:'statuses',source_id:String(stage.id),payload:stage});
        edge('statuses',stage.id,'pipeline','pipelines',id);
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
  await client.query(`INSERT INTO kommo_import.sync_state(account_id,stream,cursor)
    SELECT $1,s->>'stream',jsonb_build_object('spec',s,'page',1)
    FROM jsonb_array_elements($2::jsonb) s ON CONFLICT DO NOTHING`,
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
      edges:[],streams:initialStreams(Math.floor(Date.now()/1000))
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
async function onePage(client, account, request) {
  // A single transaction owns the remote request, records, links and cursor. A terminated
  // worker rolls everything back, and a concurrent invocation immediately yields.
  const lock = await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',[account.id]);
  if (!lock.rows[0].locked) return false;
  const result = await client.query(`SELECT stream,cursor FROM kommo_import.sync_state
    WHERE account_id=$1 AND status IN ('pending','running','retrying')
      AND COALESCE((cursor->>'retryAt')::bigint,0) <= $2
      AND NOT EXISTS(SELECT FROM kommo_import.sync_state WHERE account_id=$1 AND stream='@source'
        AND COALESCE((cursor->>'pauseUntil')::bigint,0)>$2)
    ORDER BY CASE WHEN stream LIKE 'links.%:%' OR stream LIKE 'file_links:%' OR stream LIKE 'file_versions:%' THEN 2
        WHEN stream LIKE 'messages:%' THEN 1 ELSE 0 END, updated_at, stream LIMIT 1`,[account.id,Date.now()]);
  if (!result.rows.length) return false;
  const {stream,cursor} = result.rows[0];
  const {spec,page} = cursor;
  let next, batch;
  try {
    const response = await request(resourcePath(spec,page),spec.host,account);
    const unpacked = unpackPage(spec,response,page);
    next = unpacked.nextPage;
    batch = preparePage(spec,unpacked.rows,account);
    await writePage(client,account.id,batch);
    await client.query(`UPDATE kommo_import.sync_state SET status=$3,rows_seen=rows_seen+$4,
      cursor=jsonb_build_object('spec',$5::jsonb,'page',$6::int),updated_at=clock_timestamp()
      WHERE account_id=$1 AND stream=$2`,[account.id,stream,next?'running':'complete',
        unpacked.rows.length,JSON.stringify(spec),next || page]);
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
  if (retry) await query(`UPDATE kommo_import.sync_state SET status='pending',
    cursor=cursor-'attempts'-'retryAt'-'error',updated_at=clock_timestamp()
    WHERE account_id=$1 AND status IN ('blocked','error')`,[account.id]);
  for (let i=0;i<25 && Date.now()-started<11000;i++) {
    if (!await transaction(client=>onePage(client,account,request))) break;
    await new Promise(resolve=>setTimeout(resolve,180));
  }
  return summarize(account);
}
