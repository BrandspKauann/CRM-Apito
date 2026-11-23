// Kommo exposes conversations on the CRM host and the file archive on the
// drive host returned by the authenticated account endpoint.
export const extendedStreams = [
  {stream: 'talks', kind: 'talks', path: '/api/v4/talks', key: 'talks', primaryKey: 'talk_id'},
  {stream: 'files', kind: 'files', host: 'drive', path: '/v1.0/files', key: 'files', primaryKey: 'uuid', limit: 25},
  {stream: 'trashed_files', kind: 'files', host: 'drive', path: '/v1.0/files?filter[deleted]=1', key: 'files', primaryKey: 'uuid', limit: 25},
];

function link(fromKind, fromId, relation, toKind, toId) {
  return {from_kind: fromKind, from_id: String(fromId), relation, to_kind: toKind, to_id: String(toId), payload: {}};
}

export function extendPage({stream, kind, rows}) {
  const streams = [], edges = [];
  for (const row of rows) {
    if (kind === 'talks') {
      const id = row.talk_id;
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw Error('Conversa sem identificador válido');
      streams.push({
        stream: 'messages:' + id, kind: 'messages', key: 'messages',
        path: '/api/v4/talks/' + encodeURIComponent(id) + '/messages'
      });
      if (row.contact_id) edges.push(link('talks', id, 'contact', 'contacts', row.contact_id));
      if (row.entity_type === 'lead' && row.entity_id) edges.push(link('talks', id, 'lead', 'leads', row.entity_id));
      if (row.chat_id) edges.push(link('talks', id, 'chat', 'chats', row.chat_id));
      if (row.source_id) edges.push(link('talks', id, 'source', 'sources', row.source_id));
    } else if (kind === 'messages') {
      const talkId = stream.slice('messages:'.length);
      const sourceId = talkId + ':' + row.id;
      edges.push(link('messages', sourceId, 'conversation', 'talks', talkId));
      if (row.chat_id) edges.push(link('messages', sourceId, 'chat', 'chats', row.chat_id));
    } else if (kind === 'files') {
      const uuid = String(row.uuid ?? '');
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid)) throw Error('Arquivo sem UUID válido');
      streams.push({stream: 'file_links:' + uuid, kind: 'file_links', path: '/api/v4/files/' + uuid + '/links',
        single: true, primaryKey: 'file_uuid'});
      if (row.has_multiple_versions) {
        streams.push({stream: 'file_versions:' + uuid, kind: 'file_versions', host: 'drive',
          path: '/v1.0/files/' + uuid + '/versions', key: 'versions', primaryKey: 'uuid', limit: 25});
      }
    } else if (kind === 'file_links') {
      for (const entity of row.entities ?? []) {
        if (entity.id && entity.entity_type) {
          edges.push(link('files', row.file_uuid, 'attached_to', entity.entity_type, entity.id));
        }
      }
    } else if (kind === 'file_versions') {
      const fileId = stream.slice('file_versions:'.length);
      edges.push(link('file_versions', fileId + ':' + row.uuid, 'version_of', 'files', fileId));
    }
  }
  return {streams, edges};
}
