import assert from 'node:assert/strict';
import test from 'node:test';
import { unpackPage, preparePage, groupedLinks, initialStreams } from '../kommo-sync.mjs';

test('consulta eventos por páginas de 100 aceitas pela conta', () => {
  const eventStream = initialStreams().find(item => item.stream === 'events');
  assert.equal(eventStream.path, '/api/v4/events');
  assert.equal(eventStream.limit, 100);
});

test('vínculos em lote exigem resposta completa e donos dentro do filtro', () => {
  const link = {entity_type:'leads',entity_id:1,to_entity_type:'contacts',to_entity_id:6};
  const body = {_total_items:1,_embedded:{links:[link]}};
  assert.deepEqual([...groupedLinks(body,'leads',['1','2'])],[['1',[link]]]);
  assert.equal(groupedLinks(body,'leads',['2']), null);
  assert.equal(groupedLinks(body,'contacts',['1']), null);
  assert.equal(groupedLinks({...body,_total_items:5},'leads',['1']), null);
  assert.equal(groupedLinks({...body,_links:{next:{href:'?page=2'}}},'leads',['1']), null);
  assert.equal(groupedLinks(null,'leads',['1']), null);
});

const spec = { stream: 'contacts', kind: 'contacts', path: '/api/v4/contacts', key: 'contacts', limit: 2 };

test('uma página cheia continua a importação mesmo sem link de paginação', () => {
  const rows = [{ id: 11 }, { id: 12 }];
  const result = unpackPage(spec, { _embedded: { contacts: rows } }, 1);
  assert.deepEqual(result.rows, rows);
  assert.equal(result.nextPage, 2);
});

test('uma coleção vazia encerra a paginação', () => {
  const result = unpackPage(spec, { _embedded: { contacts: [] } }, 2);
  assert.deepEqual(result.rows, []);
  assert.equal(result.nextPage, null);
});

test('um link repetido não reinicia a mesma página nem avança o checkpoint', () => {
  const body = { _embedded: { contacts: [{ id: 1 }] }, _links: { next: { href: '?page=1' } } };
  assert.throws(() => unpackPage(spec, body, 1));
});

test('resposta 204 termina o recurso, erro de formato permanece visível', () => {
  assert.deepEqual(unpackPage(spec, null, 1), { rows: [], nextPage: null });
  assert.throws(() => unpackPage(spec, { unexpected: [] }, 1));
});

test('repetir a transformação preserva identidade e conteúdo do registro', () => {
  const rows = [{ id: 11, name: 'Contato de teste', custom_fields_values: [
    { field_code: 'PHONE', values: [{ value: '0000' }, { value: '1111' }] }
  ], _embedded: { companies: [{ id: 22 }] } }];
  const result = preparePage(spec, rows, { id: 101 });
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].payload, rows[0]);
  assert.ok(result.edges.length > 0);
  assert.deepEqual(preparePage(spec, rows, { id: 101 }), result);
});
