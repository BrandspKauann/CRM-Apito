// Each outcome keeps its original system and record ID. A shared employer never identifies a buyer.
const sourceSql = `
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
), lead_people AS MATERIALIZED (
  SELECT l.source_id AS reference,p->>'id' AS original_contact,l.payload->>'status_id' AS status, l.payload
  FROM leads l CROSS JOIN LATERAL jsonb_array_elements(l.people) p
  WHERE l.payload->>'status_id' ~ '^[1-9][0-9]*$'
    AND (jsonb_array_length(l.people)=1 OR p->>'is_main'='true')
)`;

export const commercialHistorySql = sourceSql + `, evidence AS (
  SELECT m.contact_id, 'Kommo' AS origin, l.reference,
    CASE l.status WHEN '142' THEN 'won' WHEN '143' THEN 'lost' ELSE 'open' END AS outcome
  FROM lead_people l JOIN source_map m ON m.source='kommo' AND m.source_id=l.original_contact
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

// Dates belong to individual source events. An event date or a last edit cannot date a sale.
export const segmentHistorySql = sourceSql + `, matched AS (
  SELECT m.contact_id,l.* FROM lead_people l JOIN source_map m
  ON m.source='kommo' AND m.source_id=l.original_contact
), events AS (
  SELECT contact_id,'Kommo' AS origin,reference,e.kind,
    CASE WHEN e.stamp ~ '^[1-9][0-9]{0,9}$' THEN
      to_char(to_timestamp(e.stamp::bigint) AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') END AS day
  FROM matched CROSS JOIN LATERAL (VALUES ('created',payload->>'created_at'),
    (CASE status WHEN '142' THEN 'won' WHEN '143' THEN 'lost' END,payload->>'closed_at')) e(kind,stamp)
  WHERE e.kind IS NOT NULL
  UNION
  SELECT m.contact_id,'Kommo',m.reference,
    CASE r.payload#>>'{value_after,0,lead_status,id}' WHEN '142' THEN 'won' WHEN '143' THEN 'lost' END,
    to_char(to_timestamp((r.payload->>'created_at')::bigint) AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD')
  FROM kommo_import.records r JOIN active_account a USING(account_id)
  JOIN matched m ON m.reference=r.payload->>'entity_id'
  WHERE r.kind='events' AND r.payload->>'type'='lead_status_changed'
    AND r.payload#>>'{value_after,0,lead_status,id}' IN ('142','143')
    AND r.payload->>'created_at' ~ '^[1-9][0-9]{0,9}$'
  UNION
  SELECT m.contact_id,'MeEventos',b.source_id::text,e.kind,
    CASE WHEN e.stamp ~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}($|[ T])' THEN left(e.stamp,10) END
  FROM crm_enrichment.meeventos_crosswalk b JOIN active_account a USING(account_id)
  JOIN source_map m ON m.source='budgets' AND m.source_id=b.source_id::text
  CROSS JOIN LATERAL (VALUES ('created',b.attributes->>'dataCadastro'),
    ('event',coalesce(b.attributes->>'dataevento',b.attributes->>'event_date')),
    (CASE lower(trim(b.attributes->>'status')) WHEN 'aprovado' THEN 'approved'
       WHEN 'perdido' THEN 'lost' WHEN 'recusado' THEN 'lost' END,
     CASE lower(trim(b.attributes->>'status')) WHEN 'aprovado' THEN b.attributes->>'dataAprovacao'
       WHEN 'perdido' THEN b.attributes->>'dataPerda' WHEN 'recusado' THEN b.attributes->>'dataRecusa' END)
  ) e(kind,stamp)
  WHERE b.source_type='budgets' AND b.match_result <> 'revisar_multiplos' AND e.kind IS NOT NULL
    AND (e.kind <> 'event' OR e.stamp IS NOT NULL)
)
SELECT DISTINCT contact_id,origin,reference,kind,day FROM events`;

export const portfolioHistorySql = sourceSql +  `, audit AS (
 SELECT r.payload->>'entity_id' AS reference,r.payload->>'created_at' AS stamp,
   r.payload->>'type' AS action,r.payload#>'{value_before,0}' AS before_value,
   r.payload#>'{value_after,0}' AS after_value
 FROM kommo_import.records r JOIN active_account a USING(account_id)
 WHERE r.kind='events' AND r.payload->>'entity_type' IN ('lead','leads')
), statuses AS (
 SELECT r.source_id,r.payload->>'name' AS name FROM kommo_import.records r
 JOIN active_account a USING(account_id) WHERE r.kind='statuses'
), changes AS (
 SELECT audit.reference,audit.stamp,jsonb_agg(DISTINCT jsonb_build_object('action',action,
   'before',coalesce(old.name,before_value#>>'{lead_status,id}',before_value#>>'{sale,value}',before_value#>>'{name_field_value,name}'),
   'after',coalesce(new_status.name,after_value#>>'{lead_status,id}',after_value#>>'{sale,value}',after_value#>>'{name_field_value,name}'))) AS changes
 FROM audit JOIN leads l ON l.source_id=audit.reference AND l.payload->>'updated_at'=audit.stamp
 LEFT JOIN statuses old ON old.source_id=before_value#>>'{lead_status,id}'
 LEFT JOIN statuses new_status ON new_status.source_id=after_value#>>'{lead_status,id}'
 GROUP BY audit.reference,audit.stamp
), facts AS (
 SELECT m.contact_id,'Kommo' AS origin,l.reference,e.kind,
   to_char(to_timestamp(e.stamp::bigint) AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS day
 FROM lead_people l JOIN source_map m ON m.source='kommo' AND m.source_id=l.original_contact
 CROSS JOIN LATERAL (VALUES ('updated',l.payload->>'updated_at'),
   (CASE l.status WHEN '142' THEN 'won' WHEN '143' THEN 'lost' END,l.payload->>'closed_at')) e(kind,stamp)
 WHERE e.kind IS NOT NULL AND e.stamp ~ '^[1-9][0-9]{0,9}$'
 UNION
 SELECT m.contact_id,'Kommo',l.reference,
   CASE r.payload#>>'{value_after,0,lead_status,id}' WHEN '142' THEN 'won' ELSE 'lost' END,
   to_char(to_timestamp((r.payload->>'created_at')::bigint) AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD')
 FROM kommo_import.records r JOIN active_account a USING(account_id)
 JOIN lead_people l ON l.reference=r.payload->>'entity_id'
 JOIN source_map m ON m.source='kommo' AND m.source_id=l.original_contact
 WHERE r.kind='events' AND r.payload->>'type'='lead_status_changed'
 AND r.payload#>>'{value_after,0,lead_status,id}' IN ('142','143') AND r.payload->>'created_at' ~ '^[1-9][0-9]{0,9}$'
 UNION
 SELECT m.contact_id,'MeEventos',b.source_id::text,e.kind,left(e.stamp,10)
 FROM crm_enrichment.meeventos_crosswalk b JOIN active_account a USING(account_id)
 JOIN source_map m ON m.source='budgets' AND m.source_id=b.source_id::text
 CROSS JOIN LATERAL (VALUES ('updated',b.attributes->>'dataAtualizacao'),('closed',b.attributes->>'dataFinalizacao'),
 ('lost',b.attributes->>'dataPerda'),('lost',b.attributes->>'dataRecusa'),('approved',b.attributes->>'dataAprovacao')) e(kind,stamp)
 WHERE b.source_type='budgets' AND b.match_result <> 'revisar_multiplos'
 AND e.stamp ~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}($|[ T])'
) SELECT facts.*,changes.changes FROM facts LEFT JOIN changes
 ON facts.origin='Kommo' AND facts.kind='updated' AND changes.reference=facts.reference
 WHERE facts.day <= '2026-11-30'`;
