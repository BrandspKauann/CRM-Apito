BEGIN;

CREATE SCHEMA IF NOT EXISTS kommo_import;

CREATE TABLE IF NOT EXISTS kommo_import.records (
  account_id bigint NOT NULL,
  kind text NOT NULL,
  source_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind, source_id)
);

CREATE TABLE IF NOT EXISTS kommo_import.edges (
  account_id bigint NOT NULL,
  from_kind text NOT NULL,
  from_id text NOT NULL,
  relation text NOT NULL,
  to_kind text NOT NULL,
  to_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (account_id, from_kind, from_id, relation, to_kind, to_id)
);

CREATE INDEX IF NOT EXISTS edges_target_idx
  ON kommo_import.edges (account_id, to_kind, to_id);

CREATE TABLE IF NOT EXISTS kommo_import.sync_state (
  account_id bigint NOT NULL,
  stream text NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  rows_seen bigint NOT NULL DEFAULT 0 CHECK (rows_seen >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, stream)
);

CREATE INDEX IF NOT EXISTS notes_entity_idx ON kommo_import.records
  (account_id, kind, (payload->>'entity_id'))
  WHERE kind IN ('contacts.notes', 'companies.notes', 'leads.notes');

CREATE OR REPLACE VIEW kommo_import.contacts AS
SELECT account_id, source_id, payload->>'name' AS name,
       payload->>'first_name' AS first_name, payload->>'last_name' AS last_name,
       jsonb_path_query_array(payload,
         '$.custom_fields_values[*] ? (@.field_code == "EMAIL").values[*].value') AS emails,
       jsonb_path_query_array(payload,
         '$.custom_fields_values[*] ? (@.field_code == "PHONE").values[*].value') AS phones,
       payload->>'responsible_user_id' AS responsible_user_id,
       payload->'custom_fields_values' AS custom_fields, synced_at
FROM kommo_import.records WHERE kind = 'contacts';

CREATE OR REPLACE VIEW kommo_import.companies AS
SELECT account_id, source_id, payload->>'name' AS name,
       payload->>'responsible_user_id' AS responsible_user_id,
       payload->'custom_fields_values' AS custom_fields, synced_at
FROM kommo_import.records WHERE kind = 'companies';

CREATE OR REPLACE VIEW kommo_import.leads AS
SELECT account_id, source_id, payload->>'name' AS name, (payload->>'price')::numeric AS price,
       payload->>'pipeline_id' AS pipeline_id, payload->>'status_id' AS status_id,
       payload->>'responsible_user_id' AS responsible_user_id,
       payload->'custom_fields_values' AS custom_fields, synced_at
FROM kommo_import.records WHERE kind = 'leads';

CREATE OR REPLACE VIEW kommo_import.notes AS
SELECT account_id, split_part(kind, '.', 1) AS entity_kind, payload->>'entity_id' AS entity_id,
       source_id, payload->>'note_type' AS note_type, payload#>>'{params,text}' AS note_text,
       payload->'params' AS parameters, payload->>'created_by' AS created_by,
       to_timestamp((payload->>'created_at')::double precision) AS created_at, synced_at
FROM kommo_import.records WHERE kind IN ('contacts.notes', 'companies.notes', 'leads.notes');

CREATE OR REPLACE VIEW kommo_import.relationships AS
SELECT e.account_id, e.from_kind, e.from_id, src.payload->>'name' AS from_name,
       e.relation, e.to_kind, e.to_id, dest.payload->>'name' AS to_name, e.payload
FROM kommo_import.edges e
LEFT JOIN kommo_import.records src
  ON (src.account_id, src.kind, src.source_id) = (e.account_id, e.from_kind, e.from_id)
LEFT JOIN kommo_import.records dest
  ON (dest.account_id, dest.kind, dest.source_id) = (e.account_id, e.to_kind, e.to_id);

CREATE OR REPLACE VIEW kommo_import.tasks AS
SELECT account_id, source_id, payload->>'entity_type' AS entity_type, payload->>'entity_id' AS entity_id,
       payload->>'text' AS task_text, (payload->>'is_completed')::boolean AS is_completed,
       to_timestamp((payload->>'complete_till')::double precision) AS due_at,
       payload->>'responsible_user_id' AS responsible_user_id, payload->'result' AS result, synced_at
FROM kommo_import.records WHERE kind = 'tasks';

CREATE OR REPLACE VIEW kommo_import.events AS
SELECT account_id, source_id, payload->>'type' AS event_type, payload->>'entity_type' AS entity_type,
       payload->>'entity_id' AS entity_id, payload->>'created_by' AS created_by,
       to_timestamp((payload->>'created_at')::double precision) AS created_at,
       payload->'value_before' AS value_before, payload->'value_after' AS value_after, synced_at
FROM kommo_import.records WHERE kind = 'events';

CREATE INDEX IF NOT EXISTS events_entity_idx ON kommo_import.records
  (account_id, (payload->>'entity_type'), (payload->>'entity_id')) WHERE kind = 'events';

CREATE OR REPLACE VIEW kommo_import.talks AS
SELECT account_id, source_id, payload->>'chat_id' AS chat_id, payload->>'contact_id' AS contact_id,
       payload->>'entity_type' AS entity_type, payload->>'entity_id' AS entity_id,
       payload->>'origin' AS origin, (payload->>'is_in_work')::boolean AS is_in_work,
       (payload->>'is_read')::boolean AS is_read,
       to_timestamp((payload->>'created_at')::double precision) AS created_at, synced_at
FROM kommo_import.records WHERE kind = 'talks';

CREATE OR REPLACE VIEW kommo_import.messages AS
SELECT r.account_id, r.source_id, r.payload->>'id' AS message_id, e.to_id AS talk_id,
       r.payload->>'chat_id' AS chat_id, r.payload->>'origin' AS origin,
       r.payload->>'type' AS direction, r.payload->>'message_type' AS content_type,
       r.payload->'author' AS author, r.payload->'recipient' AS recipient,
       r.payload->>'text' AS message_text, r.payload->'attachment' AS attachment,
       to_timestamp((r.payload->>'created_at')::double precision) AS created_at, r.synced_at
FROM kommo_import.records r
LEFT JOIN kommo_import.edges e
  ON (e.account_id, e.from_kind, e.from_id) = (r.account_id, r.kind, r.source_id)
 AND e.relation = 'conversation' AND e.to_kind = 'talks'
WHERE r.kind = 'messages';

CREATE OR REPLACE VIEW kommo_import.files AS
SELECT account_id, source_id, payload->>'name' AS name,
       (payload->>'size')::bigint AS size_bytes, payload->>'version_uuid' AS version_uuid,
       payload->>'extension' AS extension, payload->>'source_id' AS origin_source_id,
       (payload->>'is_trashed')::boolean AS is_trashed, synced_at
FROM kommo_import.records WHERE kind = 'files';

COMMIT;
