import { portfolioHistorySql, segmentHistorySql } from './commercial-history.mjs';
import { query, transaction } from './db.mjs';

const localEvents = `
  SELECT d.contact AS contact_id, 'CRM Apito' AS origin, d.id::text AS reference, e.kind,
    to_char(h.occurred_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS day
  FROM deals d LEFT JOIN deal_stage_history h ON h.deal_id=d.id
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN h.created OR h.id IS NULL THEN 'created' END),
    (CASE coalesce(h.stage,d.stage) WHEN 'Ganho' THEN 'won' WHEN 'Clientes' THEN 'won'
       WHEN 'Perdido' THEN 'lost' WHEN 'Orçamento aprovado' THEN 'approved' END)
  ) e(kind) WHERE d.contact IS NOT NULL AND e.kind IS NOT NULL`;

// Keep saved lists available on installations where the application role cannot create tables.
const listMarker = 'crm-apito/contact-segment/v1';
const storedLists = `SELECT 'lo-' || m.oid AS id,
  convert_from(lo_get(m.oid),'UTF8')::jsonb AS data
  FROM pg_largeobject_metadata m JOIN pg_description d ON d.objoid=m.oid
  AND d.classoid='pg_largeobject'::regclass AND d.objsubid=0
  WHERE m.lomowner=current_user::regrole AND d.description=$1`;

async function loadLists(execute, hasTable) {
  const objects = await execute(storedLists,[listMarker]);
  const lists = objects.rows.map(({id,data})=>({id,name:data.name,criteria:data.criteria}));
  if (hasTable) lists.push(...(await execute('SELECT id,name,criteria FROM crm.contact_segments')).rows);
  return lists.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}

export async function segmentData(portfolio = false) {
  const {rows:[schema]} = await query("SELECT to_regclass('crm.contact_segments') IS NOT NULL AS lists, to_regclass('crm.deal_stage_history') IS NOT NULL AS history");
  const lists = portfolio ? [] : await loadLists(query,schema.lists);
  const historySource = schema.history ? localEvents : localEvents.replace(
    'LEFT JOIN deal_stage_history h ON h.deal_id=d.id',
    'CROSS JOIN (SELECT NULL::bigint AS id,NULL::boolean AS created,NULL::text AS stage,NULL::timestamptz AS occurred_at) h');
  const local = portfolio ? (schema.history ? await query(`
    SELECT DISTINCT d.contact AS contact_id,d.company AS company_id,'CRM Apito' AS origin,d.id::text AS reference,
      CASE h.stage WHEN 'Ganho' THEN 'won' WHEN 'Clientes' THEN 'won' WHEN 'Perdido' THEN 'lost'
        WHEN 'Finalizado sem desfecho' THEN 'closed' WHEN 'Orçamento aprovado' THEN 'approved' ELSE 'stage' END AS kind,
      to_char(h.occurred_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS day
    FROM deals d JOIN deal_stage_history h ON h.deal_id=d.id
    WHERE (h.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`) : {rows:[]}) : await query(historySource);
  const imported = await transaction(async client => {
    const sources = await client.query("SELECT to_regclass('crm_enrichment.meeventos_crosswalk') IS NOT NULL AND to_regclass('kommo_import.records') IS NOT NULL AND to_regclass('crm_enrichment.crm_contact_sources') IS NOT NULL AS available");
    if (!sources.rows[0].available) return [];
    await client.query("SET LOCAL statement_timeout='25s'");
    await client.query('SET LOCAL jit=off');
    return (await client.query(portfolio ? portfolioHistorySql : segmentHistorySql)).rows;
  });
  return {lists,events:[...local.rows,...imported]};
}

export function validSegment(body) {
  const c = body?.criteria;
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 100 || !c) return false;
  if (Array.isArray(c.groups)) return ['any','all'].includes(c.mode) && c.groups.length>0 && c.groups.length<=30 &&
    c.groups.every(group=>group && !('groups' in Object(group)) && validSegment({name:body.name,criteria:group}));
  const validDate = value => {
    if (value === '') return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value+'T00:00:00Z');
    return Number.isFinite(+date) && date.toISOString().startsWith(value);
  };
  return ['', 'created','won','lost','approved','event'].includes(c.kind) &&
    ['', 'Kommo','MeEventos','CRM Apito'].includes(c.origin) &&
    ['', 'email','phone','both','company'].includes(c.profile) &&
    validDate(c.from) && validDate(c.to) && (!c.from || !c.to || c.from <= c.to);
}

export async function saveSegment(body) {
  return transaction(async client => {
    const execute = client.query.bind(client);
    await execute("SELECT pg_advisory_xact_lock(hashtext('crm-apito/contact-segments'))");
    const name=body.name.trim();
    const {rows:[schema]}=await execute("SELECT to_regclass('crm.contact_segments') IS NOT NULL AS available");
    const lists=await loadLists(execute,schema.available);
    if (lists.some(list=>list.name===name)) throw Object.assign(Error('Lista já existente.'),{code:'23505'});
    if (schema.available) return (await execute(
      'INSERT INTO crm.contact_segments(name,criteria) VALUES($1,$2) RETURNING id,name,criteria',
      [name,body.criteria])).rows[0];
    const {rows:[row]}=await execute("SELECT lo_from_bytea(0,$1::bytea) AS oid",
      [Buffer.from(JSON.stringify({name,criteria:body.criteria}))]);
    const oid=Number(row.oid);
    if (!Number.isSafeInteger(oid) || oid<1 || oid>4294967295) throw Error('OID inválido');
    await execute(`COMMENT ON LARGE OBJECT ${oid} IS '${listMarker}'`);
    return {id:'lo-'+oid,name,criteria:body.criteria};
  });
}
