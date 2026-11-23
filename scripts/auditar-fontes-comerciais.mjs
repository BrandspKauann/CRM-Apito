// Inspect source shape and coverage before rebuilding commercial tags. Only aggregate metadata is logged.
import { query, closeDatabase } from '../db.mjs';
const checks = {
  columns: `select n.nspname schema,c.relname relation,string_agg(a.attname,',' order by a.attnum) columns,
    has_table_privilege(c.oid,'select') readable from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where (n.nspname='crm_enrichment' or (n.nspname='public' and c.relname in ('contacts','deals')))
    and c.relkind in ('r','v','m') group by n.nspname,c.relname,c.oid`,
  permissions: `select has_schema_privilege('public','create') can_create,has_schema_privilege('crm_enrichment','create') can_create_enrichment`,
  sources: 'select source,count(*)::int n from crm_enrichment.crm_contact_sources group by 1',
  mee: 'select source_type,match_result,count(*)::int n from crm_enrichment.meeventos_crosswalk group by 1,2',
  attributes: `select source_type,k,count(*)::int n from crm_enrichment.meeventos_crosswalk
    cross join lateral jsonb_object_keys(attributes) k group by 1,2 order by 1,2`,
  dbroles: `select current_database() db,current_user role,pg_get_userbyid(c.relowner)=current_user owns_contacts
    from pg_class c where c.oid='public.contacts'::regclass`,
  configs: 'select provider,base_url from integration_configs',
  streams: `select kind,count(*)::int n,max(synced_at)::date latest from kommo_import.records
    where kind in ('contacts','leads','pipelines','events') group by kind`,
  relations: `select from_kind,relation,to_kind,count(*)::int n from kommo_import.edges
    where (from_kind,to_kind) in (('contacts','leads'),('leads','contacts')) group by 1,2,3`
};
try {
  for(const [name,sql] of Object.entries(checks)) console.log('SOURCE_'+name,JSON.stringify((await query(sql)).rows));
} finally { await closeDatabase(); }
