CREATE TABLE IF NOT EXISTS crm.automation_rules (
 id serial PRIMARY KEY, name text NOT NULL, event text NOT NULL, subject text NOT NULL,
 message text NOT NULL, enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS crm.automation_runs (
 id bigserial PRIMARY KEY, rule_id integer NOT NULL REFERENCES crm.automation_rules(id), deal_id integer NOT NULL,
 recipient text, subject text NOT NULL, message text NOT NULL, status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm.automation_rules ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'email';
ALTER TABLE crm.automation_rules ADD COLUMN IF NOT EXISTS template_key text;
CREATE UNIQUE INDEX IF NOT EXISTS automation_rules_template ON crm.automation_rules(template_key);
