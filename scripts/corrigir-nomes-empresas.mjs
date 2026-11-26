import {query, transaction, closeDatabase} from '../db.mjs';
import {loadBrandRegister, saveBrandRegister} from '../brand-register.mjs';
import {identifyBrand} from './identificar-marcas.mjs';
import {internalBrands} from './marcas-fontes-crm.mjs';

const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const options = process.argv.slice(2);
const apply = options.includes('--apply');
const supplied = new Map();
for (const option of options.filter(arg => arg !== '--apply')) {
  const split = option.indexOf('=');
  const domain = option.slice(0, split), name = option.slice(split + 1).trim();
  if (split < 1 || !domainPattern.test(domain) || !name || name.length > 150) throw Error('Correção inválida.');
  supplied.set(domain,{name,source:'Kauann'});
}

try {
  const {rows} = await query('SELECT id,name,to_jsonb(c)->>\'website\' AS website FROM brain.companies c ORDER BY id');
  const companies = rows.filter(c => domainPattern.test(c.name) && c.name.length <= 253 &&
    (!c.website || c.website === 'https://' + c.name));
  const sources = await internalBrands(query);
  const decisions = [];
  let next = 0, processed = 0;
  async function worker() {
    while (next < companies.length) {
      const {id,name:domain} = companies[next++];
      const evidence = supplied.get(domain) || sources.get(domain) || await identifyBrand(domain);
      if (evidence && evidence.name !== domain) decisions.push({id, domain, ...evidence});
      if (++processed % 500 === 0) console.log('MARCAS_PROGRESSO',processed,'/',companies.length);
    }
  }
  await Promise.all(Array.from({length:24}, worker));
  const stats = {analisadas:companies.length, identificadas:decisions.length, sem_confirmacao:companies.length-decisions.length};
  if (apply && decisions.length) {
    const saved = await transaction(async client => {
      const execute = client.query.bind(client);
      await execute("SET LOCAL lock_timeout='10s'");
      await execute("SELECT pg_advisory_xact_lock(hashtext('crm-company-brand-register'))");
      const register = await loadBrandRegister(execute);
      const hasWebsite = (await execute("SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='website') v")).rows[0].v;
      const changed = await execute(`UPDATE brain.companies c SET name=p.name ${hasWebsite ? ",website='https://'||p.domain" : ''}
        FROM jsonb_to_recordset($1::jsonb) p(id integer,domain text,name text)
        WHERE c.id=p.id AND c.name=p.domain AND coalesce(nullif(to_jsonb(c)->>'website',''),'https://'||p.domain)='https://'||p.domain
        RETURNING c.id`,[JSON.stringify(decisions)]);
      const ids = new Set(changed.rows.map(c=>c.id));
      const bySource = {};
      for (const {id,domain,name,source} of decisions) {
        if (!ids.has(id)) continue;
        register.entries[id] = {domain,name,source};
        const category = source.startsWith('https://') ? 'site' : source;
        bySource[category] = (bySource[category] || 0) + 1;
      }
      if (ids.size) await saveBrandRegister(execute,register);
      const check = await loadBrandRegister(execute);
      for (const {id,domain,name} of decisions) {
        if (ids.has(id) && (check.entries[id]?.domain !== domain || check.entries[id]?.name !== name)) throw Error('Falha ao verificar o registro de marcas.');
      }
      return {corrigidas:ids.size, origens:bySource, total_arquivo:Object.keys(check.entries).length};
    });
    Object.assign(stats,saved);
  }
  console.log('MARCAS_RESULTADO',JSON.stringify(stats));
  if (apply && supplied.size) {
    const {entries} = await loadBrandRegister(query);
    const confirmed = Object.entries(entries).filter(([,entry])=>supplied.get(entry.domain)?.name === entry.name);
    const {rows:verified} = await query('SELECT id,name FROM brain.companies WHERE id=ANY($1::integer[])',[confirmed.map(([id])=>Number(id))]);
    console.log('MARCAS_EXEMPLOS_CONFIRMADOS',verified.filter(c => c.name===entries[c.id].name).length,'/',supplied.size);
  }
} finally {
  await closeDatabase();
}
