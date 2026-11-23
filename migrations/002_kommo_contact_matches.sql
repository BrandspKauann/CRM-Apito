BEGIN;

CREATE OR REPLACE FUNCTION kommo_import.match_email(raw text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN length(v) <= 254
    AND v ~ '^[a-z0-9_%+.!#$&''*=/^{}|~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'
    AND v !~ '(^\.|\.\.|\.@|@-|\.-|-\.|-$)'
    THEN v END
  FROM (SELECT lower(btrim(raw)) AS v) q
$$;

CREATE OR REPLACE FUNCTION kommo_import.match_phone(raw text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  WITH input AS (
    SELECT btrim(raw) AS v, regexp_replace(raw, '[^0-9]', '', 'g') AS digits
  ), parsed AS (
    SELECT
      CASE WHEN v LIKE '00%' THEN substring(digits FROM 3)
           ELSE digits END AS number,
      v LIKE '+%' OR v LIKE '00%' AS international
    FROM input
    WHERE v ~ '^\+?[0-9(][0-9() .-]+$'
  ), canonical AS (
    SELECT CASE
      WHEN NOT international AND number ~ '^[1-9]{2}([2-5][0-9]{7}|9[0-9]{8})$'
        THEN '55' || number
      WHEN number ~ '^55[1-9]{2}([2-5][0-9]{7}|9[0-9]{8})$'
        THEN number
      WHEN international AND number NOT LIKE '55%' AND number ~ '^[1-9][0-9]{7,14}$'
        THEN number
      END AS digits
    FROM parsed
  )
  SELECT CASE WHEN digits !~ '([0-9])\1{7}$' THEN '+' || digits END FROM canonical
$$;

CREATE OR REPLACE VIEW kommo_import.contact_match_candidates AS
WITH active_accounts AS (
  SELECT s.account_id FROM kommo_import.sync_state s
  JOIN public.integration_configs config
    ON config.provider = 'kommo'
   AND rtrim(s.cursor->>'origin','/') = rtrim(config.base_url,'/')
  WHERE s.stream = '@source'
), kommo_keys AS MATERIALIZED (
  SELECT DISTINCT c.account_id, c.source_id, v.method, v.match_key
  FROM kommo_import.contacts c JOIN active_accounts a USING (account_id)
  CROSS JOIN LATERAL (
    SELECT 'phone'::text AS method, kommo_import.match_phone(p) AS match_key
    FROM jsonb_array_elements_text(c.phones) p
    UNION ALL
    SELECT 'email', kommo_import.match_email(e)
    FROM jsonb_array_elements_text(c.emails) e
  ) v
  WHERE v.match_key IS NOT NULL
), crm_keys AS MATERIALIZED (
  SELECT c.id, v.method, v.match_key FROM public.contacts c
  CROSS JOIN LATERAL (VALUES
    ('phone', kommo_import.match_phone(c.phone)), ('email', kommo_import.match_email(c.email))
  ) v(method, match_key) WHERE v.match_key IS NOT NULL
), pairs AS (
  SELECT k.account_id, k.source_id, p.id AS crm_contact_id,
         array_agg(DISTINCT k.method ORDER BY k.method) AS matched_by
  FROM kommo_keys k JOIN crm_keys p USING (method, match_key)
  GROUP BY k.account_id, k.source_id, p.id
), counts AS (
  SELECT pairs.*,
    count(*) OVER (PARTITION BY account_id, source_id) AS crm_candidates,
    count(*) OVER (PARTITION BY account_id, crm_contact_id) AS kommo_candidates
  FROM pairs
)
SELECT m.account_id, m.source_id AS kommo_contact_id, k.payload->>'name' AS kommo_name,
       m.crm_contact_id, c.name AS crm_name, c.address_book_id, m.matched_by,
       m.crm_candidates, m.kommo_candidates,
       m.crm_candidates > 1 OR m.kommo_candidates > 1 AS ambiguous
FROM counts m JOIN public.contacts c ON c.id = m.crm_contact_id
JOIN kommo_import.records k
  ON (k.account_id, k.kind, k.source_id) = (m.account_id, 'contacts', m.source_id);

DO $grants$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT ON kommo_import.contact_match_candidates TO crm_app;
  END IF;
END;
$grants$;

CREATE OR REPLACE VIEW kommo_import.entity_timeline AS
SELECT r.account_id, e.to_kind AS entity_kind, e.to_id AS entity_id,
       r.kind AS source_kind, r.source_id,
       to_timestamp((r.payload->>'created_at')::double precision) AS occurred_at,
       CASE
         WHEN r.kind = 'events' THEN r.payload->>'type'
         WHEN r.kind = 'tasks' THEN 'task'
         ELSE r.payload->>'note_type'
       END AS activity_type,
       CASE WHEN r.kind = 'tasks' THEN r.payload->>'text'
            WHEN r.kind LIKE '%.notes' THEN r.payload#>>'{params,text}'
       END AS activity_text,
       r.payload->>'created_by' AS created_by,
       r.payload->'value_before' AS value_before,
       r.payload->'value_after' AS value_after
FROM kommo_import.edges e JOIN kommo_import.records r
  ON (r.account_id, r.kind, r.source_id) = (e.account_id, e.from_kind, e.from_id)
WHERE e.relation = 'entity'
  AND r.kind IN ('tasks','events','contacts.notes','leads.notes','companies.notes');

DO $grants$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT ON kommo_import.entity_timeline TO crm_app;
  END IF;
END;
$grants$;

COMMIT;
