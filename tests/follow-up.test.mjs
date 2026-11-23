import test from 'node:test';
import assert from 'node:assert/strict';
import { followUpError, writableFields } from '../follow-up.mjs';

test('aceita dia bissexto e rejeita datas impossíveis de acompanhamento', () => {
  assert.equal(followUpError({ follow_up_on: '2028-02-29' }), '');
  for (const day of ['2027-02-29', '2028-04-31', '2028-13-01', '0000-01-01']) {
    assert.ok(followUpError({ follow_up_on: day }), day);
  }
});

test('PUT preserva acompanhamentos omitidos e permite limpá-los explicitamente', () => {
  const fields = ['name', 'next_action', 'follow_up_on'];
  assert.deepEqual(writableFields(fields, { name: 'Contrato' }, true), ['name']);
  assert.deepEqual(writableFields(fields, { follow_up_on: '' }, true), ['name', 'follow_up_on']);
  const clear = { name: 'Contrato', next_action: '', follow_up_on: null };
  assert.deepEqual(writableFields(fields, clear, true), fields);
  assert.equal(followUpError(clear), '');
});
