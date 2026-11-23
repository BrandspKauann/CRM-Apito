import assert from 'node:assert/strict';
import test from 'node:test';
import { unpackPage, preparePage, groupedLinks, initialStreams, combineEventPages, capacityState } from '../kommo-sync.mjs';

test('reserva capacidade para o CRM e permite retomar quando a branch cresce', () => {
  const gib=1024**3;
  const previous=capacityState(gib-32*1024**2,gib);
  assert.equal(previous.availableBytes,0);
  assert.equal(previous.reserveBytes,Math.ceil(gib/10));
  assert.ok(capacityState(previous.usedBytes,2*gib).availableBytes>0);
  assert.equal(capacityState(0,0),null);
});

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

const events = {stream:'events', kind:'events', key:'events', path:'/api/v4/events', limit:2};
const eventCursor = {spec:events, page:1, previous:null};
const account = {id:101};
const eventPage = (page, ids) => ({_page:page, _embedded:{events:ids.map(id=>({id}))}});

test('janela de eventos deduplica registros e avança somente até a última página validada', () => {
  const first = eventPage(1,['aa','bb']);
  const second = eventPage(2,['bb','cc']);
  const result = combineEventPages(events,eventCursor,[first,second],account);
  assert.deepEqual(result.batch.records.map(row=>row.source_id).sort(),['aa','bb','cc']);
  assert.equal(result.count,4);
  assert.equal(result.lastPage,2);
  assert.equal(result.next,3);
  assert.ok(result.signature);
  assert.equal(eventCursor.page,1);
});

test('janela para na primeira página final mesmo que uma consulta antecipada retorne registros', () => {
  const result = combineEventPages(events,eventCursor,[
    eventPage(1,['aa','bb']),null,eventPage(3,['ignorado'])
  ],account);
  assert.equal(result.lastPage,2);
  assert.equal(result.next,null);
  assert.equal(result.count,2);
  assert.deepEqual(result.batch.records.map(row=>row.source_id),['aa','bb']);
});

test('janela rejeita salto de página, continuação inesperada e evento sem identificador', () => {
  const first = eventPage(1,['aa','bb']);
  for (const invalid of [
    eventPage(3,['cc']),
    {...eventPage(2,['cc']),_links:{next:{href:'?page=4'}}},
    {_page:2,_embedded:{events:[{type:'lead_added'}]}}
  ]) {
    assert.throws(()=>combineEventPages(events,eventCursor,[first,invalid],account));
  }
  assert.equal(eventCursor.page,1);
});

test('valida o arquivo proprietário nos dois formatos de vínculos da API', () => {
  const fileId='85218eab-a52e-41b7-9500-ed467a8fbb81';
  const file={stream:'file_links:'+fileId,kind:'file_links',path:'/api/v4/files/'+fileId+'/links',
    single:true,primaryKey:'file_uuid'};
  const entities=[{entity_type:'leads',id:123}];
  for (const body of [{file_uuid:fileId,entities},{file_uuid:fileId,_embedded:{entities}}]) {
    const {rows,nextPage}=unpackPage(file,body,1);
    assert.equal(rows.length,1);
    assert.equal(rows[0].file_uuid,fileId);
    assert.deepEqual(rows[0].entities,entities);
    assert.equal(nextPage,null);
  }
  assert.throws(()=>unpackPage(file,{file_uuid:'00000000-0000-0000-0000-000000000000',entities:[]},1));
});

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
