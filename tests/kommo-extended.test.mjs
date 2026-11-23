import assert from 'node:assert/strict';
import test from 'node:test';
import {extendedStreams} from '../kommo-extended.mjs';
import {preparePage, unpackPage} from '../kommo-sync.mjs';

test('associa a mensagem à conversa com o mesmo identificador composto usado na gravação', () => {
  const talks = extendedStreams.find(spec => spec.kind === 'talks');
  const talkPage = preparePage(talks, [{talk_id: 53, contact_id: 2}], {});
  const messages = talkPage.streams.find(spec => spec.kind === 'messages');
  assert.equal(messages.path, '/api/v4/talks/53/messages');
  assert.throws(() => unpackPage(messages, {detail: 'coleção indisponível'}, 1));
  const page = preparePage(messages, [{id: 'msg-2', text: 'Teste de importação'}], {});
  assert.equal(page.records[0].source_id, '53:msg-2');
  assert.deepEqual(page.edges[0], {
    from_kind: 'messages', from_id: page.records[0].source_id, relation: 'conversation',
    to_kind: 'talks', to_id: talkPage.records[0].source_id, payload: {}
  });
});

test('associa a versão ao arquivo usando as chaves dos dois registros persistidos', () => {
  const files = extendedStreams.find(spec => spec.stream === 'files');
  const uuid = 'ab085050-7f03-4cb6-b575-89429ae2e631';
  const filePage = preparePage(files, [{uuid, has_multiple_versions: true}], {});
  const versions = filePage.streams.find(spec => spec.kind === 'file_versions');
  const page = preparePage(versions, [{uuid: 'v1', file_uuid: uuid}], {});
  assert.equal(page.records[0].source_id, uuid + ':v1');
  assert.equal(page.edges[0].from_id, page.records[0].source_id);
  assert.equal(page.edges[0].to_id, filePage.records[0].source_id);
});
