import test from 'node:test';
import assert from 'node:assert/strict';
import defaults from '../automation-defaults.mjs';

test('as regras internas acompanham o funil, respeitam edição e pausa', async t => {
  process.env.CRM_PREVIEW_PORT = '0';
  const {server} = await import('../work/preview.mjs');
  t.after(() => server.close());
  if (!server.listening) await new Promise(resolve => server.once('listening',resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/';
  async function api(path,method='GET',body) {
    const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result = await response.json();
    assert.ok(response.ok,JSON.stringify(result));
    return result;
  }
  const {rules} = await api('automations');
  assert.equal(rules.length,5);
  const {id} = await api('deals','POST',{name:'Evento',amount:0,stage:'Prospecção'});
  for (const template of defaults) {
    if (template.event !== 'created') await api('deals/'+id,'PATCH',{stage:template.event});
    const {deals} = await api('crm');
    assert.equal(deals[0].next_action,template.message.replace('{{negocio}}','Evento'));
  }
  await api('deals/'+id,'PATCH',{stage:'Perdido'});
  assert.equal((await api('automations')).runs.length,5);
  const rule = rules.find(rule=>rule.event==='Proposta');
  await api('automations','PUT',{...rule,message:'Ligar sobre {{negocio}}'});
  await api('deals/'+id,'PATCH',{stage:'Proposta'});
  assert.equal((await api('crm')).deals[0].next_action,'Ligar sobre Evento');
  await api('automations','PATCH',{id:rule.id,enabled:false});
  await api('deals/'+id,'PATCH',{stage:'Prospecção'});
  await api('deals/'+id,'PATCH',{stage:'Proposta'});
  assert.equal((await api('automations')).runs.length,6);
});
