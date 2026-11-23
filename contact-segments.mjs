import { segmentHistorySql } from './commercial-history.mjs';
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

export async function segmentData() {
  const lists = await query('SELECT id,name,criteria FROM contact_segments ORDER BY name');
  const local = await query(localEvents);
  const imported = await transaction(async client => {
    const sources = await client.query("SELECT to_regclass('crm_enrichment.meeventos_crosswalk') IS NOT NULL AND to_regclass('kommo_import.records') IS NOT NULL AND to_regclass('crm_enrichment.crm_contact_sources') IS NOT NULL AS available");
    if (!sources.rows[0].available) return [];
    await client.query("SET LOCAL statement_timeout='25s'");
    await client.query('SET LOCAL jit=off');
    return (await client.query(segmentHistorySql)).rows;
  });
  return {lists:lists.rows,events:[...local.rows,...imported]};
}

export function validSegment(body) {
  const c = body?.criteria;
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 100 || !c) return false;
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
  return (await query('INSERT INTO contact_segments(name,criteria) VALUES($1,$2) RETURNING id,name,criteria',
    [body.name.trim(),body.criteria])).rows[0];
}
