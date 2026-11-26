-- Reorganiza uma COPIA COMPLETA e conferida do banco original. Execute como
-- administrador, conectado ao destino independente (nunca ao banco anselmo).
-- Antes: backup/restauracao com Large Objects, owners e ACLs; provisionar os
-- papeis abaixo e suas credenciais fora deste arquivo. Este SQL NAO cria banco,
-- troca conexoes, encerra sessoes, apaga origem, altera colunas ou reseta IDs.
-- Alteracoes de schema preservam OIDs, dados, FKs e sequencias vinculadas.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '10s';

DO $preconditions$
DECLARE required_role text;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Execute a reorganizacao com o administrador PostgreSQL';
  END IF;
  IF current_database() = 'anselmo' THEN
    RAISE EXCEPTION 'A origem anselmo deve ser preservada; execute na copia independente';
  END IF;
  FOREACH required_role IN ARRAY ARRAY['brain_owner','brain_readonly','brain_editor','brain_crm'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = required_role) THEN
      RAISE EXCEPTION 'Provisione o papel % antes desta migracao', required_role;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = required_role
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'O papel % possui privilegios administrativos inesperados', required_role;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
    WHERE d.datname=current_database() AND r.rolname='brain_owner') THEN
    RAISE EXCEPTION 'O banco destino deve pertencer a brain_owner';
  END IF;
  IF to_regclass('address_book.contacts') IS NULL
    OR to_regclass('kommo_import.contacts') IS NULL
    OR to_regclass('crm_enrichment.crm_contact_sources') IS NULL THEN
    RAISE EXCEPTION 'Restaure os schemas de origem completos antes da reorganizacao';
  END IF;
END;
$preconditions$;

CREATE SCHEMA IF NOT EXISTS brain AUTHORIZATION brain_owner;
CREATE SCHEMA IF NOT EXISTS crm AUTHORIZATION brain_owner;

DO $tables$
DECLARE item record; source_oid oid; target_oid oid;
BEGIN
  -- Whitelist: nenhum outro objeto de public e movido automaticamente.
  -- Os dois objetos opcionais podem nao existir: o app preserva o fallback LO.
  FOR item IN SELECT * FROM (VALUES
    ('companies','brain',true), ('contacts','brain',true),
    ('deals','crm',true), ('integration_configs','crm',true),
    ('staffing_events','crm',true), ('staffing_roles','crm',true),
    ('staffing_assignments','crm',true), ('automation_rules','crm',true),
    ('automation_runs','crm',true), ('contact_segments','crm',false),
    ('deal_stage_history','crm',false)
  ) AS whitelist(name,destination,required) LOOP
    source_oid := to_regclass(format('public.%I',item.name));
    target_oid := to_regclass(format('%I.%I',item.destination,item.name));
    IF source_oid IS NOT NULL AND target_oid IS NOT NULL THEN
      RAISE EXCEPTION 'Colisao entre public.% e %.%; revise antes de continuar',
        item.name,item.destination,item.name;
    END IF;
    IF source_oid IS NULL AND target_oid IS NULL THEN
      IF item.required THEN RAISE EXCEPTION 'Tabela obrigatoria ausente: %',item.name; END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_class WHERE oid=coalesce(source_oid,target_oid) AND relkind IN ('r','p')) THEN
      RAISE EXCEPTION 'O objeto % deve ser uma tabela real, nao uma view',item.name;
    END IF;
    IF source_oid IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I',item.name,item.destination);
    END IF;
    EXECUTE format('ALTER TABLE %I.%I OWNER TO brain_owner',item.destination,item.name);
  END LOOP;
END;
$tables$;

DO $large_objects$
DECLARE obj record;
BEGIN
  -- Somente os LOs privados do CRM legado; OID e conteudo ficam intactos.
  FOR obj IN SELECT m.oid,d.description,m.lomacl,m.lomowner
    FROM pg_largeobject_metadata m JOIN pg_roles r ON r.oid=m.lomowner
    LEFT JOIN pg_description d ON d.objoid=m.oid AND d.objsubid=0
      AND d.classoid='pg_catalog.pg_largeobject'::regclass
    WHERE r.rolname='crm_web_vps' LOOP
    IF obj.description IS NULL OR obj.description NOT IN
      ('crm-apito/company-brand-register/v1','crm-apito/contact-segment/v1') THEN
      RAISE EXCEPTION 'Large Object % exige revisao explicita antes da troca de proprietario',obj.oid;
    END IF;
    IF EXISTS (SELECT FROM aclexplode(obj.lomacl) a WHERE a.grantee<>obj.lomowner) THEN
      RAISE EXCEPTION 'Large Object % possui ACL nao privada',obj.oid;
    END IF;
    EXECUTE format('ALTER LARGE OBJECT %s OWNER TO brain_crm',obj.oid);
  END LOOP;
END;
$large_objects$;

DO $known_function$
DECLARE source_oid oid; target_oid oid; definition text;
BEGIN
  source_oid := to_regprocedure('public.record_crm_deal_stage()');
  target_oid := to_regprocedure('crm.record_crm_deal_stage()');
  IF source_oid IS NOT NULL AND target_oid IS NOT NULL THEN
    RAISE EXCEPTION 'Colisao da funcao record_crm_deal_stage';
  END IF;
  IF source_oid IS NOT NULL THEN
    IF NOT EXISTS (SELECT FROM pg_proc WHERE oid=source_oid AND prorettype='trigger'::regtype) THEN
      RAISE EXCEPTION 'Assinatura inesperada da funcao record_crm_deal_stage';
    END IF;
    ALTER FUNCTION public.record_crm_deal_stage() SET SCHEMA crm;
    target_oid := to_regprocedure('crm.record_crm_deal_stage()');
  END IF;
  IF target_oid IS NOT NULL THEN
    -- Corpos PL/pgSQL textuais nao acompanham automaticamente SET SCHEMA.
    definition := pg_get_functiondef(target_oid);
    EXECUTE replace(definition,'public.deal_stage_history','crm.deal_stage_history');
  END IF;
END;
$known_function$;

DO $database_grants$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC',current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO brain_crm,brain_readonly,brain_editor',current_database());
  EXECUTE format('ALTER ROLE brain_crm IN DATABASE %I SET search_path=crm,brain,public',current_database());
END;
$database_grants$;

-- Nenhum GRANT CREATE ao papel de aplicacao: LOs privados continuam utilizaveis.
GRANT USAGE ON SCHEMA brain,crm,address_book,kommo_import,crm_enrichment TO brain_crm;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA brain,crm,kommo_import TO brain_crm;
GRANT SELECT ON ALL TABLES IN SCHEMA address_book,crm_enrichment TO brain_crm;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA brain,crm,kommo_import TO brain_crm;
GRANT USAGE ON SCHEMA brain TO brain_readonly,brain_editor;
GRANT SELECT ON ALL TABLES IN SCHEMA brain TO brain_readonly;
GRANT brain_readonly TO brain_editor;
GRANT INSERT,UPDATE ON brain.contacts,brain.companies TO brain_editor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA brain TO brain_editor;

GRANT USAGE ON SCHEMA address_book,kommo_import,crm_enrichment TO brain_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA address_book,kommo_import,crm_enrichment TO brain_owner;
CREATE INDEX IF NOT EXISTS brain_contact_sources_contact_id_idx ON crm_enrichment.crm_contact_sources(contact_id);
CREATE OR REPLACE VIEW brain.contact_sources WITH (security_barrier=true) AS
  SELECT source,source_id,contact_id FROM crm_enrichment.crm_contact_sources;
CREATE OR REPLACE VIEW brain.kommo_contacts WITH (security_barrier=true) AS
  SELECT * FROM kommo_import.contacts;
CREATE OR REPLACE VIEW brain.address_book_contacts WITH (security_barrier=true) AS
  SELECT id,display_name,family_name,given_name,properties,import_sha256,raw_sha256
  FROM address_book.contacts;
CREATE OR REPLACE VIEW brain.contact_profiles WITH (security_barrier=true) AS
  SELECT c.*,co.name AS company_name,co.city AS company_city,
    ab.properties AS address_book_properties,
    coalesce((SELECT jsonb_agg(jsonb_build_object('source',s.source,'source_id',s.source_id)
      ORDER BY s.source,s.source_id) FROM crm_enrichment.crm_contact_sources s
      WHERE s.contact_id=c.id),'[]'::jsonb) AS sources
  FROM brain.contacts c LEFT JOIN brain.companies co ON co.id=c.company
  LEFT JOIN address_book.contacts ab ON ab.id=c.address_book_id;
ALTER VIEW brain.contact_sources OWNER TO brain_owner;
ALTER VIEW brain.kommo_contacts OWNER TO brain_owner;
ALTER VIEW brain.address_book_contacts OWNER TO brain_owner;
ALTER VIEW brain.contact_profiles OWNER TO brain_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA brain TO brain_readonly,brain_crm;
ALTER DEFAULT PRIVILEGES FOR ROLE brain_owner IN SCHEMA brain GRANT SELECT ON TABLES TO brain_readonly;

COMMENT ON SCHEMA brain IS 'Brain Apito: entidades compartilhadas, independentes dos aplicativos';
COMMENT ON SCHEMA crm IS 'Operacoes exclusivas do CRM Apito';
DO $database_comment$
BEGIN
  EXECUTE format('COMMENT ON DATABASE %I IS %L',current_database(),
    'Base central Brain Apito; consumidores com credenciais e permissoes proprias');
END;
$database_comment$;
COMMIT;
