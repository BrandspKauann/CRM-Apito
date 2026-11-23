import assert from 'node:assert/strict';
import { closeDatabase, transaction } from '../db.mjs';
import { commercialHistorySql, attachCommercialHistory } from '../commercial-history.mjs';

try {
  const {people, evidence} = await transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return {people:(await client.query('SELECT id FROM public.contacts')).rows,
      evidence:(await client.query(commercialHistorySql)).rows};
  });
  attachCommercialHistory(people,evidence);
  const totals = {}, sources = {};
  for (const person of people) {
    for (const tag of person.commercial_tags || []) totals[tag]=(totals[tag] || 0)+1;
    for (const group of person.commercial_history || []) {
      assert.ok(group.refs.length && group.refs.every(id => /^\d+$/.test(id)));
      const label=group.origin+' '+group.outcome;
      sources[label]=(sources[label] || 0)+group.refs.length;
    }
  }
  assert.ok(sources['Kommo won'] && sources['MeEventos approved'], 'Duas fontes com fechamento obrigatório para validar.');
  console.log('CRM_SEGMENTS',JSON.stringify({contacts:people.length,classified:people.filter(p=>p.commercial_tags?.length).length,totals,sources}));
} finally {await closeDatabase();}
