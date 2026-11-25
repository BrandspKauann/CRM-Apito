\set ON_ERROR_STOP on
-- Execute via psql in the CRM database, as its administrator, on first installation.
-- CREATE ROLE intentionally fails if the name already belongs to another account.
BEGIN;
CREATE ROLE apito_mcp_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 6;
SELECT format('GRANT CONNECT ON DATABASE %I TO apito_mcp_reader', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO apito_mcp_reader;
GRANT SELECT (id, name, company, email, phone) ON public.contacts TO apito_mcp_reader;
GRANT SELECT (id, name, city) ON public.companies TO apito_mcp_reader;
ALTER ROLE apito_mcp_reader SET default_transaction_read_only = on;
ALTER ROLE apito_mcp_reader SET statement_timeout = '4s';
\password apito_mcp_reader
COMMIT;
