// Each outcome keeps its original system and record ID. A shared employer never identifies a buyer.
export const commercialHistorySql = `
WITH active_account AS (
  SELECT s.account_id FROM kommo_import.sync_state s
  JOIN public.integration_configs i ON i.provider='kommo' AND rtrim(i.base_url,'/')=rtrim(s.cursor->>'origin','/')
  WHERE s.stream='@source'
), source_map AS MATERIALIZED (
  SELECT source,source_id::text AS source_id,min(contact_id) AS contact_id
  FROM crm_enrichment.crm_contact_sources WHERE source IN ('kommo','budgets')
  GROUP BY source,source_id HAVING count(DISTINCT contact_id)=1
), leads AS (
  SELECT r.source_id, r.payload, coalesce(r.payload#>'{_embedded,contacts}','[]'::jsonb) AS people
  FROM kommo_import.records r JOIN active_account a USING(account_id)
  WHERE r.kind='leads' AND coalesce(r.payload->>'is_deleted','false') <> 'true'
), evidence AS (
  SELECT m.contact_id, 'Kommo' AS origin, l.source_id AS reference,
    CASE l.payload->>'status_id' WHEN '142' THEN 'won' WHEN '143' THEN 'lost'
      ELSE 'open' END AS outcome
  FROM leads l CROSS JOIN LATERAL jsonb_array_elements(l.people) p
  JOIN source_map m ON m.source='kommo' AND m.source_id=p->>'id'
  WHERE l.payload->>'status_id' ~ '^[1-9][0-9]*$'
    AND (jsonb_array_length(l.people)=1 OR p->>'is_main'='true')
  UNION ALL
  SELECT m.contact_id,'MeEventos',b.source_id::text,
    CASE lower(trim(b.attributes->>'status')) WHEN 'aprovado' THEN 'approved'
      WHEN 'em aberto' THEN 'open' WHEN 'finalizados' THEN 'closed_unknown'
      WHEN 'perdido' THEN 'lost' WHEN 'recusado' THEN 'lost'
      WHEN 'cancelado' THEN 'cancelled' END
  FROM crm_enrichment.meeventos_crosswalk b JOIN active_account a USING(account_id)
  JOIN source_map m ON m.source='budgets' AND m.source_id=b.source_id::text
  WHERE b.source_type='budgets' AND b.match_result <> 'revisar_multiplos'
)
SELECT contact_id,origin,outcome,array_agg(DISTINCT reference ORDER BY reference) AS refs
FROM evidence WHERE outcome IS NOT NULL GROUP BY contact_id,origin,outcome
ORDER BY contact_id,origin,outcome`;

export const commercialLabels = {
  won: 'Cliente', approved: 'Orçamento aprovado', lost: 'Oportunidade perdida',
  open: 'Oportunidade em aberto', closed_unknown: 'Orçamento finalizado sem desfecho',
  cancelled: 'Cancelamento registrado'
};

export function attachCommercialHistory(contacts, records) {
  const byId = new Map(contacts.map(contact => [contact.id, contact]));
  for (const {contact_id, origin, outcome, refs} of records) {
    const person = byId.get(contact_id);
    if (!person || !commercialLabels[outcome]) continue;
    (person.commercial_history ??= []).push({origin, outcome, refs});
    const tags = person.commercial_tags ??= [];
    if (!tags.includes(commercialLabels[outcome])) tags.push(commercialLabels[outcome]);
  }
  for (const contact of contacts) {
    const tags = contact.commercial_tags;
    if (tags?.includes(commercialLabels.lost) && !tags.includes(commercialLabels.won) &&
        !tags.includes(commercialLabels.approved)) tags.push('Perda sem fechamento identificado');
  }
}
