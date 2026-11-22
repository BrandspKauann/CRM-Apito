const $=s=>document.querySelector(s);
function showLogin(message=''){
 data=undefined;
 if($('dialog').open)$('dialog').close();
 $('.frame').hidden=true;
 $('#login-screen').hidden=false;
 $('#login-error').textContent=message;
 $('#login-form').elements.username.focus();
}
async function apiFetch(url,options){
 const response=await fetch(url,options);
 if(response.status===401){showLogin('Sua sessão expirou. Entre novamente.');throw Error('Sessão expirada');}
 return response;
}
async function start(){
 try{
  const response=await fetch('/api/session',{cache:'no-store'});
  if(!response.ok)throw Error('Não foi possível verificar sua sessão.');
  const session=await response.json();
  if(!session.authenticated){showLogin();return;}
  $('#login-screen').hidden=true;
  $('.frame').hidden=false;
  await refresh();
 }catch(error){
  if(!$('#login-screen').hidden)return;
  showLogin(error.message||'Não foi possível conectar ao CRM.');
 }
}
$('#login-form').onsubmit=async e=>{
 e.preventDefault();
 const form=e.currentTarget,button=e.submitter;
 button.disabled=true;$('#login-error').textContent='';
 try{
  const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.elements.username.value,password:form.elements.password.value})});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Usuário ou senha incorretos.');
  form.elements.password.value='';
  $('#login-screen').hidden=true;
  $('.frame').hidden=false;
  await refresh();
 }catch(error){
  showLogin(error.message||'Não foi possível entrar.');
 }finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{
 try{
  const response=await fetch('/api/logout',{method:'POST'});
  if(!response.ok)throw Error('Não foi possível encerrar a sessão.');
  showLogin();
 }catch(error){$('#alert').textContent=error.message;}
};
const pages={home:'Visão geral',companies:'Empresas',contacts:'Contatos',deals:'Funil de negócios',integrations:'Integrações'};
const singular={companies:'empresa',contacts:'contato',deals:'negócio'};
const labels={name:'Nome',city:'Cidade',email:'E-mail',phone:'Telefone',company:'Empresa',amount:'Valor (R$)',contact:'Contato',stage:'Etapa',notes:'Observações'};
const keys={companies:['name','city'],contacts:['name','company','email','phone'],deals:['name','contact','amount','stage','notes']};
const money=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let page='home', data, editing, search='';
function linked(table,id){return data[table].find(row=>row.id===id)?.name||'—';}
function summary(row,table){
 if(table==='companies')return row.city||'Cidade não informada';
 if(table==='contacts')return [linked('companies',row.company),row.email,row.phone].filter(Boolean).join(' · ');
 return linked('contacts',row.contact)+' · '+money(row.amount);
}
function card(row,table){return '<button class="record" data-table="'+table+'" data-id="'+row.id+'"><strong>'+esc(row.name)+'</strong><span>'+esc(summary(row,table))+'</span>'+(table==='deals'?'<small>'+esc(row.stage)+'</small>':'')+'</button>';}
function section(title,rows,table){return '<article><h3>'+title+'</h3>'+(rows.map(r=>card(r,table)).join('')||'<p class="empty">Nenhum registro por aqui.</p>')+'</article>';}
function renderRows(){
 const rows=data[page].filter(r=>(r.name+' '+summary(r,page)).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 $('#rows').innerHTML=page==='deals'?data.stages.map(s=>section(s,rows.filter(r=>r.stage===s),page)).join(''):section(pages[page]+' ('+rows.length+')',rows,page);
}
function draw(){
 $('nav').innerHTML=Object.entries(pages).map(([k,v],i)=>'<button data-page="'+k+'" aria-current="'+(page===k?'page':'false')+'"><span class="nav-icon">'+['◈','▦','♙','▥','⚙'][i]+'</span>'+v+'</button>').join('');
 $('h1').textContent=page==='home'?'Seu próximo negócio começa aqui.':pages[page];$('#eyebrow').textContent='';$('#subtitle').textContent=page==='home'?'Sua operação de prospecção, em uma visão conectada.':'';
 $('#create').textContent=page==='companies'?'+ Nova empresa':page==='contacts'?'+ Novo contato':'+ Novo negócio';
 $('#create').hidden=page==='integrations';
 if(page==='integrations'){drawIntegrations();return;}
 if(page!=='home'){
  $('#content').innerHTML='<input id="search" type="search" aria-label="Buscar registros" placeholder="Buscar '+pages[page].toLowerCase()+'"><div id="rows" class="'+(page==='deals'?'board':'list')+'"></div>';
  $('#search').value=search;$('#search').oninput=e=>{search=e.target.value;renderRows();};renderRows();return;
 }
 const open=data.deals.filter(r=>!['Ganho','Perdido'].includes(r.stage));
 const stats=[['Empresas encontradas',data.companies.length,'Perfil ideal'],['Abordagens criadas',data.deals.length,'Em andamento'],['Negócios em aberto',open.length,'Funil'],['Novas respostas',data.contacts.length,'Conversas']];
 $('#content').innerHTML='<section class="stats">'+stats.map(([k,v,tag])=>'<article><small>'+k+'</small><div><strong>'+esc(v)+'</strong><label>✦ '+tag+'</label></div></article>').join('')+'</section><section class="panels">'+section('Empresas para sua próxima conversa',data.companies.slice(0,5),'companies')+section('Sua próxima abordagem',data.deals.slice(0,5),'deals')+'</section>';
}
async function drawIntegrations(){
 $('#subtitle').textContent='Conecte suas ferramentas para consultar informações neste CRM.';
 $('#content').innerHTML='<p class="empty">Carregando integrações...</p>';
 try{
  const response=await apiFetch('/api/integrations');if(!response.ok)throw Error('Não foi possível carregar as integrações');
  const settings=await response.json();
  $('#content').innerHTML='<div class="integration-grid">'+[['kommo','Kommo','Subdomínio da conta, como https://suaempresa.kommo.com','Token de longa duração da integração privada'],['meeventos','Meeventos','URL HTTPS do seu sistema Meeventos','API Token da Loja de Apps']].map(([id,title,placeholder,hint])=>'<article class="integration-card"><div class="integration-heading"><h3>'+title+'</h3><span class="status">'+(settings[id].connected?'Configurada':'Não conectada')+'</span></div><p>'+hint+'</p><form data-integration="'+id+'"><label>Endereço da conta<input name="baseUrl" type="url" required placeholder="'+placeholder+'" value="'+esc(settings[id].baseUrl)+'"></label><label>Token de acesso<input name="token" type="password" autocomplete="off" placeholder="'+(settings[id].connected?'Deixe vazio para manter o token':'Cole o token aqui')+'"></label><div class="integration-actions"><button type="button" data-test="'+id+'">Testar conexão</button><button type="submit">Salvar conexão</button>'+(settings[id].connected?'<button type="button" data-preview="'+id+'">Consultar dados</button>':'')+'</div></form><p class="integration-feedback" role="status"></p><div class="integration-preview"></div></article>').join('')+'</div>';
 }catch(error){$('#content').textContent=error.message;}
}
$('#content').addEventListener('click',async e=>{
 const previewButton=e.target.closest('[data-preview]');if(previewButton){await showPreview(previewButton.dataset.preview,previewButton.closest('.integration-card'));return;}
 const button=e.target.closest('[data-test]');if(!button)return;
 const form=button.closest('form'),card=button.closest('.integration-card');
 await integrationRequest(form,card,'test');
});
$('#content').addEventListener('submit',async e=>{
 if(!e.target.matches('[data-integration]'))return;
 e.preventDefault();await integrationRequest(e.target,e.target.closest('.integration-card'),'save');
});
async function integrationRequest(form,card,action){
 const provider=form.dataset.integration,feedback=card.querySelector('.integration-feedback');
 const buttons=form.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);feedback.textContent='Verificando conexão...';
 try{
  const response=await apiFetch('/api/integrations/'+provider+(action==='test'?'/test':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
  const result=await response.json();if(!response.ok)throw Error(result.error);
  feedback.textContent=action==='test'?'Conexão válida. Salve para ativar.':'Conexão salva.';
  if(action==='save'){
   form.elements.token.value='';card.querySelector('.status').textContent='Configurada';
   if(!card.querySelector('[data-preview]'))form.querySelector('.integration-actions').insertAdjacentHTML('beforeend','<button type="button" data-preview="'+provider+'">Consultar dados</button>');
   await showPreview(provider,card);
  }
 }catch(error){feedback.textContent=error.message||'Falha na conexão';}finally{buttons.forEach(b=>b.disabled=false);}
}
async function showPreview(provider,card){
 const feedback=card.querySelector('.integration-feedback');feedback.textContent='Consultando dados...';
 try{const response=await apiFetch('/api/integrations/'+provider+'/preview');const list=await response.json();if(!response.ok)throw Error(list.error);
  card.querySelector('.integration-preview').innerHTML=Object.entries(list).map(([label,rows])=>'<h4>'+({contacts:'Contatos',leads:'Negócios',clients:'Clientes',events:'Eventos'}[label]||label)+'</h4>'+(rows.length?'<ul>'+rows.map(row=>'<li>'+esc(row.name)+' <small>#'+esc(row.id)+'</small></li>').join('')+'</ul>':'<p>Nenhum registro encontrado.</p>')).join('');feedback.textContent='Dados atualizados.';
 }catch(error){feedback.textContent=error.message||'Falha na consulta';}
}
function form(table,id){
 const row=data[table].find(r=>r.id===id)||{};editing={table,id};
 $('#modalTitle').textContent=(id?'Editar ':table==='companies'?'Nova ':'Novo ')+singular[table];
 $('#fields').innerHTML=keys[table].map(k=>{
  let input;
  if(['contact','company','stage'].includes(k)){
   const options=k==='stage'?data.stages.map(s=>[s,s]):[['','Sem vínculo'],...data[k==='contact'?'contacts':'companies'].map(r=>[r.id,r.name])];
   input='<select name="'+k+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'" '+(String(v)===String(row[k])?'selected':'')+'>'+esc(t)+'</option>').join('')+'</select>';
  }else if(k==='notes')input='<textarea name="notes">'+esc(row.notes)+'</textarea>';
  else input='<input name="'+k+'" '+(k==='name'?'required maxlength="200"':'')+' type="'+(k==='amount'?'number':k==='email'?'email':k==='phone'?'tel':'text')+'" '+(k==='amount'?'min="0" step="0.01"':'')+' value="'+esc(row[k])+'">';
  return '<label>'+labels[k]+input+'</label>';
 }).join('');$('#error').textContent='';$('dialog').showModal();
}
async function refresh(){const res=await apiFetch('/api/crm');if(!res.ok)throw Error('Falha ao carregar o CRM');data=await res.json();draw();}
$('nav').onclick=e=>{const button=e.target.closest('[data-page]');if(button){page=button.dataset.page;search='';draw();}};
$('#create').onclick=()=>{if(data)form(page==='home'?'deals':page);};
$('#content').onclick=e=>{const b=e.target.closest('[data-id]');if(b)form(b.dataset.table,Number(b.dataset.id));};
$('#cancel').onclick=()=>$('dialog').close();
$('dialog form').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;
 try{const {table,id}=editing;const res=await apiFetch('/api/'+table+(id?'/'+id:''),{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
 if(!res.ok)throw Error((await res.json()).error);$('dialog').close();await refresh();}
 catch(err){($('dialog').open?$('#error'):$('#alert')).textContent=err.message;}finally{button.disabled=false;}
};
start();

