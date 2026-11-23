// Maintenance CLI. Run with --apply to persist matches using the CRM database role.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query, transaction, closeDatabase } from '../db.mjs';

const cwd = fileURLToPath(new URL('.', import.meta.url));
function python(code, input = '') {
  const result = spawnSync('python3', ['-c', code], { cwd, input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('A análise falhou: ' + (result.stderr || '').split('\n').filter(Boolean).at(-1));
  return result.stdout;
}
const sql = python('from vincular_empresas import SNAPSHOT;print(SNAPSHOT)');
async function snapshot(execute) {
  const result = await execute(sql);
  return result.rows.map(row => row.json_build_array);
}
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
try {
  const rows = await snapshot(query);
  const decisions = JSON.parse(python(
    'import json,sys;from vincular_empresas import Rules,analyze;print(json.dumps(analyze(json.load(sys.stdin),Rules())))',
    JSON.stringify(rows)));
  const summary = {};
  for (const row of decisions) summary[row[3]] = (summary[row[3]] || 0) + 1;
  console.log('CRM_DOMAINS_PLAN', JSON.stringify(summary));
  if (process.argv.includes('--apply')) {
    const counts = await transaction(async client => {
      await client.query("SET LOCAL lock_timeout='8s'");
      await client.query('LOCK TABLE public.contacts,public.companies IN SHARE ROW EXCLUSIVE MODE');
      if (digest(await snapshot(client.query.bind(client))) !== digest(rows)) throw new Error('Base alterada; repita a análise.');
      const matches = decisions.filter(d => d[3] === 'vincular').map(([id, domain, target]) => ({ id, domain, target }));
      await client.query('CREATE TEMP TABLE company_plan(id int PRIMARY KEY, domain text NOT NULL, target int) ON COMMIT DROP');
      await client.query('INSERT INTO company_plan SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(id int,domain text,target int)', [JSON.stringify(matches)]);
      const created = await client.query(`WITH added AS (
        INSERT INTO public.companies(name,city) SELECT DISTINCT domain,'' FROM company_plan WHERE target IS NULL RETURNING id,name
      ), resolved AS (UPDATE company_plan p SET target=a.id FROM added a WHERE p.domain=a.name AND p.target IS NULL)
      SELECT count(*)::int n FROM added`);
      const updated = await client.query('UPDATE public.contacts c SET company=p.target FROM company_plan p WHERE c.id=p.id AND c.company IS NULL AND p.target IS NOT NULL');
      if (updated.rowCount !== matches.length) throw new Error('Quantidade de vínculos divergente.');
      const total = await client.query('SELECT count(*)::int total,count(company)::int vinculados FROM public.contacts');
      return { empresas_criadas: created.rows[0].n, novos_vinculos: updated.rowCount, ...total.rows[0] };
    });
    console.log('CRM_DOMAINS_APPLIED', JSON.stringify(counts));
  }
} finally {
  await closeDatabase();
}
