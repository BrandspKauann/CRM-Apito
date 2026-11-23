import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyBrand, brandFromHtml, isPublicAddress } from '../scripts/identificar-marcas.mjs';

test('identifica organização em metadados estruturados do mesmo site', () => {
  const brand = url => brandFromHtml('velazul.example',
    '<script type="application/ld+json">' +
    JSON.stringify({'@graph':[{'@type':'Organization',name:'Vel Azul',url}]}) +
    '</script>', 'https://velazul.example/');
  assert.equal(brand('https://www.velazul.example/').name,'Vel Azul');
  assert.equal(brand('https://outra.example/'),null);
});

test('identifica grafia e acentos no domínio oficial, ignorando nomes sem relação', () => {
  const name = (html,domain='grupocafe.com.br') => brandFromHtml(domain,html,'https://'+domain+'/')?.name;
  assert.equal(name('<meta content="Grupo Caf&eacute;" property="og:site_name">'),'Grupo Café');
  assert.equal(name('<title>Serviços - Grupo Café | Página inicial</title>'),'Grupo Café');
  assert.equal(name('<title>Hospedagem</title>'),undefined);
  assert.equal(name('<title>Grupo Café | Domain for sale</title>'),undefined);
  assert.equal(name('<script>let tag = \'<meta property="og:site_name" content="Grupo Café">\'</script>'),undefined);
  assert.equal(name('<!-- <title>Grupo Café</title> -->'),undefined);
  assert.equal(name('<title>Grupo Café</title>','outramarca.com.br'),undefined);
});

test('recusa IPs privados, especiais e parâmetros de URL fornecidos como domínio', async () => {
  for (const ip of ['10.0.0.1','127.0.0.1','169.254.169.254','100.64.0.1','0.0.0.0',
    '172.24.1.1','192.168.2.1','192.0.2.1','198.19.0.1','224.0.0.1','::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(ip),false,ip);
  }
  assert.equal(isPublicAddress('93.184.216.34'),true);
  assert.equal(await identifyBrand('127.0.0.1'),null);
  assert.equal(await identifyBrand('https://example.net@localhost'),null);
});

test('marca divergente exige duas confirmações e vínculo lexical distintivo', () => {
  const domain = 'miravela.example';
  const page = 'https://miravela.example/perfil/ana?chave=privada';
  const meta = name => '<meta property="og:site_name" content="'+name+'">';
  const org = (name,url=page.split('/perfil')[0]) => '<script type="application/ld+json">'+
    JSON.stringify({'@type':'Organization',name,url})+'</script>';
  const name = 'Miravela Design';
  const full = brandFromHtml(domain,meta(name)+org(name),page);
  assert.equal(full.name,name);
  assert.equal(full.source,'https://miravela.example/#json-ld+og:site_name');
  assert.equal(brandFromHtml(domain,meta(name)+meta(name),page),null);
  assert.equal(brandFromHtml(domain,meta(name)+org(name,'https://outro.example/'),page),null);
  assert.equal(brandFromHtml(domain,meta('Outra Empresa')+org('Outra Empresa'),page),null);
  assert.equal(brandFromHtml(domain,meta('Miravela WordPress')+org('Miravela WordPress'),page),null);
  assert.equal(brandFromHtml('agencia.example',meta('Agência Design')+'<title>Agência Design</title>',page),null);
  assert.equal(brandFromHtml(domain,meta(name)+'<title>'+name+'</title>',page).name,name);
});
