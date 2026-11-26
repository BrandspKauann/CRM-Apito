BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS brain.segment_annotations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 entity_kind text NOT NULL CHECK(entity_kind IN ('contact','company','opportunity')),
 entity_key text NOT NULL,
 field text NOT NULL,
 value jsonb,
 state text NOT NULL CHECK(state IN ('confirmed','suggested','rejected','conflict','unknown')),
 evidence text NOT NULL CHECK(length(evidence) BETWEEN 3 AND 2000),
 source text NOT NULL DEFAULT 'Revisão humana',
 source_id text,
 method text NOT NULL DEFAULT 'manual',
 rule_version text NOT NULL DEFAULT 'brain-segments/2',
 author text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 previous_id bigint REFERENCES brain.segment_annotations(id)
);
CREATE INDEX IF NOT EXISTS segment_annotation_lookup ON brain.segment_annotations(entity_kind,entity_key,field,id DESC);
CREATE TABLE IF NOT EXISTS brain.segment_saved_lists (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 100),
 entity_kind text NOT NULL CHECK(entity_kind IN ('contact','company','opportunity')),
 criteria jsonb NOT NULL,
 template_key text UNIQUE,
 rule_version text NOT NULL DEFAULT 'brain-segments/2',
 author text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON brain.segment_annotations,brain.segment_saved_lists TO brain_crm;
GRANT USAGE,SELECT ON SEQUENCE brain.segment_annotations_id_seq,brain.segment_saved_lists_id_seq TO brain_crm;
GRANT SELECT ON brain.segment_annotations,brain.segment_saved_lists TO brain_readonly;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='mcp_brain_reader') THEN GRANT SELECT ON brain.segment_annotations,brain.segment_saved_lists TO mcp_brain_reader; END IF; END $$;
COMMIT;
