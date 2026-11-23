// The caller must use a single transaction and the same transaction-scoped
// advisory lock for load/modify/save. Ordinary readers only need load.
const marker = 'crm-apito/company-brand-register/v1';
const maxBytes = 16 * 1024 * 1024;
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const markerQuery = `
  SELECT m.oid, current_setting('lo_compat_privileges') = 'off'
    AND NOT EXISTS (
      SELECT FROM pg_catalog.aclexplode(m.lomacl) a WHERE a.grantee <> m.lomowner
    ) AS private
  FROM pg_catalog.pg_largeobject_metadata m
  JOIN pg_catalog.pg_description d ON d.objoid=m.oid AND d.objsubid=0
    AND d.classoid='pg_catalog.pg_largeobject'::regclass
  WHERE m.lomowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
    AND d.description=$1`;

function validText(value, limit) {
  return typeof value === 'string' && value.trim() === value && value.length > 0 &&
    value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value);
}

function checkEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw Error('Cadastro de marcas inválido.');
  }
  for (const [id, entry] of Object.entries(entries)) {
    if (!/^[1-9]\d{0,9}$/.test(id) || Number(id)>2147483647 || !entry ||
        typeof entry !== 'object' || Array.isArray(entry) ||
        !validText(entry.domain, 253) || !domainPattern.test(entry.domain) ||
        !validText(entry.name, 240) || !validText(entry.source, 2048)) {
      throw Error('Entrada inválida no cadastro de marcas.');
    }
  }
}

function safeOid(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 4294967295) throw Error('Identificador do cadastro inválido.');
  return id;
}

function onePrivate(rows) {
  if (rows.length > 1) throw Error('Mais de um cadastro de marcas da conta atual.');
  if (rows.length && rows[0].private !== true) throw Error('O cadastro de marcas não é privado.');
  return rows.length ? safeOid(rows[0].oid) : null;
}

export async function loadBrandRegister(execute) {
  // A single statement provides a consistent snapshot even for readers outside
  // a transaction. Avoid reading contents unless exactly one private object matches.
  const {rows} = await execute(`WITH candidates AS (${markerQuery})
    SELECT oid,private, CASE WHEN private AND (SELECT count(*) FROM candidates)=1
      THEN pg_catalog.lo_get(oid,0::bigint,$2::integer) END AS contents
    FROM candidates`, [marker,maxBytes+1]);
  const oid = onePrivate(rows);
  if (oid === null) return {oid, entries:{}};
  const bytes = rows[0].contents;
  if (!Buffer.isBuffer(bytes) || bytes.length>maxBytes) throw Error('Tamanho do cadastro de marcas inválido.');
  const envelope = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if (envelope?.version !== 1) throw Error('Versão desconhecida do cadastro de marcas.');
  checkEntries(envelope.entries);
  return {oid,entries:envelope.entries};
}

export async function saveBrandRegister(execute, {oid, entries}) {
  checkEntries(entries);
  const content = Buffer.from(JSON.stringify({version:1, entries}), 'utf8');
  if (content.length>maxBytes) throw Error('Cadastro de marcas excede o limite de tamanho.');
  const expected = oid === null ? null : safeOid(oid);
  let actual = onePrivate((await execute(markerQuery, [marker])).rows);
  if (actual !== expected) throw Error('Cadastro de marcas mudou durante a atualização.');
  if (actual === null) {
    const created = await execute('SELECT pg_catalog.lo_create(0) AS oid');
    actual = safeOid(created.rows[0].oid);
    // COMMENT accepts a literal OID and a literal string, not bind parameters.
    // Both inputs are a validated Postgres OID and an application constant.
    await execute(`COMMENT ON LARGE OBJECT ${actual} IS '${marker}'`);
  }
  const opened = await execute(`WITH candidates AS (${markerQuery})
    SELECT pg_catalog.lo_open(oid,131072) AS fd FROM candidates
    WHERE oid=$2::oid AND private AND (SELECT count(*) FROM candidates)=1`, [marker,actual]);
  if (opened.rows.length !== 1) throw Error('Cadastro de marcas privado não localizado.');
  const fd = opened.rows[0].fd;
  const write = await execute('SELECT pg_catalog.lowrite($1,$2::bytea) AS written', [fd,content]);
  if (write.rows[0].written !== content.length) throw Error('Gravação incompleta do cadastro de marcas.');
  await execute('SELECT pg_catalog.lo_truncate($1,$2)', [fd,content.length]);
  await execute('SELECT pg_catalog.lo_close($1)', [fd]);
  return {oid:actual, entries};
}
