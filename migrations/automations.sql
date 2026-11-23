CREATE TABLE IF NOT EXISTS automation_rules (
 id serial PRIMARY KEY, name text NOT NULL, event text NOT NULL, subject text NOT NULL,
 message text NOT NULL, enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS automation_runs (
 id bigserial PRIMARY KEY, rule_id integer NOT NULL REFERENCES automation_rules(id), deal_id integer NOT NULL,
 recipient text, subject text NOT NULL, message text NOT NULL, status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
