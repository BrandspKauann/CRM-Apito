import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresSessionOptions, postgresConnectionOptions } from '../db-options.mjs';

test('preserva o search_path do servidor quando o Brain não foi configurado', () => {
  for (const config of [undefined, null, {}, {searchPath: ''}]) {
    const options = postgresSessionOptions(config, {});
    assert.equal(options.application_name, 'crm-apito');
    assert.equal(Object.hasOwn(options, 'options'), false);
  }
});

test('configura o mesmo namespace pelo túnel VPS ou pela conexão direta', () => {
  const expected = {application_name: 'crm-apito', options: '-c search_path=crm,brain,public'};
  assert.deepEqual(postgresSessionOptions({searchPath: 'crm,brain,public'}, {}), expected);
  assert.deepEqual(postgresSessionOptions(null, {BRAIN_APITO_SEARCH_PATH: 'crm,brain,public'}), expected);
  assert.deepEqual(postgresSessionOptions({searchPath:''}, {BRAIN_APITO_SEARCH_PATH: 'crm,brain,public'}), expected);
});

test('recusa schemas e opções não autorizados sem expor o valor da configuração', () => {
  for (const searchPath of ['public', 'crm,brain,public -c role=postgres', 'crm, brain, public', [], {}, 1]) {
    assert.throws(() => postgresSessionOptions({searchPath}, {}), /^Error: BRAIN_APITO_SEARCH_PATH\/searchPath deve ser crm,brain,public$/);
    assert.throws(() => postgresSessionOptions(null, {BRAIN_APITO_SEARCH_PATH: searchPath}), /deve ser crm,brain,public$/);
  }
});

test('a URL não pode sobrescrever o namespace validado e preserva TLS e caracteres escapados', () => {
  const connection = {connectionString: 'postgresql://user:p%40ss%2Fword@db.example/brain_apito?sslmode=verify-full&options=-c%20search_path%3Dpublic&application_name=other'};
  const pinned = postgresConnectionOptions(connection, postgresSessionOptions(null, {BRAIN_APITO_SEARCH_PATH:'crm,brain,public'}));
  const uri = new URL(pinned.connectionString);
  assert.equal(uri.searchParams.get('options'), '-c search_path=crm,brain,public');
  assert.equal(uri.searchParams.get('application_name'), 'crm-apito');
  assert.equal(uri.searchParams.get('sslmode'), 'verify-full');
  assert.equal(decodeURIComponent(uri.password), 'p@ss/word');
  assert.equal(new URL(connection.connectionString).searchParams.get('application_name'), 'other');
});

test('mantém parâmetros legados da URL quando o Brain não está habilitado', () => {
  const connection = {connectionString:'postgresql://db.example/legacy?options=-c%20statement_timeout%3D5000'};
  assert.equal(postgresConnectionOptions(connection, postgresSessionOptions(null, {})).connectionString, connection.connectionString);
});
