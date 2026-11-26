// Return only organization names and domains from explicit fields in the same source record.
const emailHost = field => `CASE WHEN trim(${field}) ~ '^[^@,;[:space:]]+@[^@,;[:space:]]+$'
  THEN lower(split_part(trim(${field}), '@', 2)) END`;

const sources = [
  ['MeEventos', `SELECT DISTINCT ${emailHost('e.email')} AS domain,
      COALESCE(NULLIF(trim(m.attributes->>'nomefantasia'),''), trim(m.attributes->>'razaosocial')) AS name,
      false AS site
    FROM crm_enrichment.meeventos_crosswalk m
    CROSS JOIN LATERAL (VALUES (m.attributes->>'email'),(m.attributes->>'email2')) e(email)
    WHERE m.source_type='clients' AND m.account_id IN (SELECT account_id FROM active)`],
  ['Kommo', `SELECT DISTINCT
      CASE f->>'field_code' WHEN 'EMAIL' THEN ${emailHost("v->>'value'")}
        ELSE lower(substring(trim(v->>'value') from '(?i)^(?:https?://)?(?:www[.])?([a-z0-9.-]+)(?:[/:?#]|$)')) END AS domain,
      r.payload->>'name' AS name, f->>'field_code' = 'WEB' AS site
    FROM kommo_import.records r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.payload->'custom_fields_values')='array' THEN r.payload->'custom_fields_values' ELSE '[]'::jsonb END) f
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(f->'values')='array' THEN f->'values' ELSE '[]'::jsonb END) v
    WHERE r.kind='companies' AND r.account_id IN (SELECT account_id FROM active)
      AND f->>'field_code' IN ('EMAIL','WEB') AND coalesce(r.payload->>'is_deleted','false') <> 'true'`],
  ['Agenda do iPhone', `SELECT DISTINCT ${emailHost('e.original_email')} AS domain,
      o.organization_name AS name, false AS site
    FROM address_book.organizations o JOIN address_book.emails e USING(contact_id)`]
];

const active = `WITH active AS (
  SELECT s.account_id FROM kommo_import.sync_state s JOIN crm.integration_configs i
    ON i.provider='kommo' AND rtrim(s.cursor->>'origin','/')=rtrim(i.base_url,'/')
  WHERE s.stream='@source'
)`;
const letters = text => text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const compact = text => letters(text).replace(/[^a-z0-9]/g,'');
// Match a separate legal designation only at the end; retain the source's entire display name.
const legalEnding = /[\s,]+(?:s\s*\.?\s*\/?\s*a\.?|sociedade an[oô]nima|ltda\.?|limitada|eireli)\s*$/iu;

export async function internalBrands(query) {
  const observations = new Map();
  for (const [source, sql] of sources) {
    let rows;
    try {
      ({rows} = await query(`${active} SELECT domain, name, site FROM (${sql}) src
        WHERE domain IN (SELECT lower(name) FROM brain.companies)
          AND length(trim(name)) BETWEEN 2 AND 150 ORDER BY domain, name`));
    } catch (err) {
      if (!['42501','42P01','3F000'].includes(err.code)) throw err;
      console.warn('Fonte de marcas indisponível:', source, err.code);
      continue;
    }
    for (const {domain,name:raw,site} of rows) {
      const name = raw.trim().replace(/\s+/gu,' ');
      const base = name.replace(legalEnding,'');
      if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} &'’.,+!-]*$/u.test(base) ||
          /^www\.|\.[a-z]{2,}(?:$|\/)/i.test(base)) continue;
      const seen = observations.get(domain) || new Map();
      const key = base.toLocaleLowerCase('pt-BR');
      const group = seen.get(key) || {variants:new Map(), sources:new Set(), hasWebsite:false};
      const variant = name.toLocaleLowerCase('pt-BR');
      if (!group.variants.has(variant)) group.variants.set(variant,{name,source});
      group.sources.add(source);
      group.hasWebsite ||= source === 'Kommo' && site === true;
      seen.set(key,group);
      observations.set(domain,seen);
    }
  }
  const names = new Map();
  for (const [domain, candidates] of observations) {
    if (candidates.size !== 1) continue;
    const [[base,group]] = candidates;
    // A bare brand takes precedence only when explicitly present. Never synthesize a short name.
    const brand = group.variants.get(base) ||
      (group.variants.size === 1 && group.variants.values().next().value);
    if (!brand) continue;
    const stem = compact(domain.split('.')[0]);
    if (compact(base) === stem || compact(brand.name) === stem) {
      names.set(domain,brand);
    } else if (group.hasWebsite && group.sources.has('MeEventos') && base.length >= 4 &&
        !/^(?:cliente|empresa|comercial|contato|financeiro|marketing|vendas|sem nome|teste|matriz|filial)$/i.test(base)) {
      // Same company name in the owning Kommo website field AND the MeEventos business identity.
      names.set(domain,{name:brand.name, source:'Kommo (site) + MeEventos'});
    }
  }
  return names;
}
