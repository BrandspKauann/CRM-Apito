const EventStaffing = (() => {
  const endpoint = '/api/staffing';
  const labels = {invited:'Aguardando resposta', confirmed:'Confirmado', declined:'Recusado'};
  const formatDate = new Intl.DateTimeFormat('pt-BR', {dateStyle:'short', timeStyle:'short'});
  const displayDate = value => formatDate.format(new Date(value));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function action(text, fn, className) {
    const button = element('button', text, className || 'staff-action');
    button.type = 'button';
    button.onclick = fn;
    return button;
  }

  function field(parent, title, type, required) {
    const label = element('label', title);
    const input = element('input');
    input.type = type;
    input.required = required;
    label.append(input);
    parent.append(label);
    return input;
  }

  function submit(form, text) {
    const button = element('button', text, 'staff-primary');
    button.type = 'submit';
    form.append(button);
  }

  async function mount(root, data, directory, apiFetch) {
    const section = element('section', undefined, 'staffing');
    const notice = element('p', '', 'staff-notice');
    notice.setAttribute('role','status');
    const view = element('div');
    section.append(notice,view);
    root.replaceChildren(section);
    let events = [], selectedId, busy = false, creating = false;

    async function request(path, method, payload) {
      const response = await apiFetch(endpoint + path, method ? {
        method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      } : undefined);
      const json = await response.json().catch(()=>({}));
      if (!response.ok) throw Error(json.error || 'A operação não pôde ser concluída.');
      return json;
    }

    async function load() {
      const result = await request('');
      if (!Array.isArray(result.events)) throw Error('Resposta de escala inválida.');
      events = result.events;
      if (!events.some(e=>e.id===selectedId)) selectedId=events[0]?.id;
      render();
    }

    function retryLoad(message) {
      view.replaceChildren(action('Carregar escalas novamente',start));
      notice.textContent = message;
    }

    async function start() {
      view.replaceChildren();
      notice.textContent = 'Carregando escalas…';
      try { await load(); notice.textContent=''; }
      catch (err) {retryLoad(err.message);}
    }

    async function change(path, method, payload, success, afterWrite) {
      if (busy) return;
      busy=true; view.inert=true;
      notice.textContent='Salvando…';
      try {
        const row = await request(path,method,payload);
        if (afterWrite) afterWrite(row);
        try { await load(); notice.textContent=success; }
        catch { retryLoad(success+' Recarregue para ver a escala atualizada.'); }
      } catch (err) { notice.textContent=err.message; }
      finally {busy=false;view.inert=false;}
    }

    function render() {
      view.replaceChildren();
      const tools = element('div',undefined,'staff-toolbar');
      if (events.length) {
        const label = element('label','Evento');
        const select = element('select');
        events.forEach(event=>select.add(new Option(event.name+' · '+displayDate(event.starts_at),String(event.id))));
        select.value=String(selectedId);
        select.onchange=()=>{selectedId=Number(select.value);creating=false;notice.textContent='';render();};
        label.append(select); tools.append(label);
      }
      if (!creating && events.length) tools.append(action('Novo evento',()=>{
        creating=true;render();view.querySelector('[name=eventName]').focus();
      },'staff-primary'));
      view.append(tools);
      if (creating || !events.length) { renderEventForm(); return; }
      renderEvent(events.find(e=>e.id===selectedId));
    }

    function renderEventForm() {
      const panel=element('section',undefined,'staff-card');
      panel.append(element('h2','Novo evento'));
      const form=element('form',undefined,'staff-form');
      const name=field(form,'Nome do evento','text',true);
      name.name='eventName';name.maxLength=160;
      const start=field(form,'Início','datetime-local',true);
      const end=field(form,'Término','datetime-local',true);
      const location=field(form,'Local','text',false);
      const url=field(form,'Link do grupo do WhatsApp (opcional)','url',false);
      url.placeholder='https://chat.whatsapp.com/…';
      submit(form,'Criar evento');
      if (events.length) form.append(action('Cancelar',()=>{creating=false;render();}));
      form.onsubmit=e=>{
        e.preventDefault();
        if (!name.value.trim()) {name.focus();notice.textContent='Informe o nome do evento.';return;}
        if (new Date(end.value)<=new Date(start.value)) {end.focus();notice.textContent='Informe um término posterior ao início.';return;}
        change('/events','POST',{name:name.value.trim(),starts_at:new Date(start.value).toISOString(),
          ends_at:new Date(end.value).toISOString(),location:location.value.trim(),group_url:url.value.trim()},
          'Evento criado.',row=>{selectedId=row.id;creating=false;});
      };
      panel.append(form);view.append(panel);
    }

    function renderEvent(event) {
      const hero=element('header',undefined,'staff-header');
      const identity=element('div');
      identity.append(element('h2',event.name),element('p',displayDate(event.starts_at)+' até '+displayDate(event.ends_at)));
      if (event.location) identity.append(element('p',event.location));
      const total=event.roles.reduce((count,r)=>count+r.capacity,0);
      const confirmed=event.roles.reduce((count,r)=>count+r.assignments.filter(a=>a.status==='confirmed').length,0);
      const count=element('div',undefined,'staff-count');
      count.append(element('strong',confirmed+' / '+total),element('span','vagas confirmadas'));
      hero.append(identity,count);view.append(hero);
      const grid=element('div',undefined,'staff-grid');
      const detail=element('details',undefined,'staff-card staff-add-role');
      detail.append(element('summary','Adicionar função e vagas'));
      const form=element('form',undefined,'staff-form');
      const roleName=field(form,'Função','text',true);
      const capacity=field(form,'Vagas','number',true);
      capacity.min='1';capacity.step='1';capacity.value='1';roleName.maxLength=120;
      submit(form,'Adicionar função');
      form.onsubmit=e=>{e.preventDefault();change('/events/'+event.id+'/roles','POST',
        {name:roleName.value.trim(),capacity:Number(capacity.value)},'Função adicionada.');};
      if (!event.roles.length) detail.open=true;
      detail.append(form);view.append(detail,grid);
      for(const role of event.roles) renderRole(grid,event,role);
    }

    async function copyText(text, container) {
      container.querySelector('.staff-copy')?.remove();
      try {
        await navigator.clipboard.writeText(text);notice.textContent='Copiado para a área de transferência.';
      } catch {
        const box=element('textarea',undefined,'staff-copy');
        box.readOnly=true;box.setAttribute('aria-label','Texto para copiar');box.value=text;
        container.append(box);box.focus();box.select();notice.textContent='Selecione e copie o texto.';
      }
    }

    function renderRole(grid,event,role) {
      const panel=element('section',undefined,'staff-card');
      const header=element('header',undefined,'staff-role-head');
      const filled=role.assignments.filter(a=>a.status==='confirmed').length;
      header.append(element('h3',role.name),element('span',filled+' de '+role.capacity+' vagas','staff-chip'));
      panel.append(header);
      for (const assignment of role.assignments) {
        const row=element('div',undefined,'staff-row');
        const name=element('strong',assignment.contact_name);
        const status=element('span',labels[assignment.status] || assignment.status,'staff-status');
        status.dataset.state=assignment.status;
        const controls=element('div',undefined,'staff-actions');
        const respond=(label,next)=>action(label,()=>change('/assignments/'+assignment.id,'PATCH',{status:next},'Resposta registrada.'));
        if (assignment.status==='invited') {
          const confirm=respond('Confirmar','confirmed');confirm.disabled=filled>=role.capacity;
          const proposal = [
            'Olá, '+assignment.contact_name+'! Você tem disponibilidade para trabalhar no evento '+event.name+'?',
            'Função: '+role.name,'Período: '+displayDate(event.starts_at)+' até '+displayDate(event.ends_at),
            event.location && 'Local: '+event.location
          ].filter(Boolean).join('\n');
          controls.append(action('Copiar proposta',()=>copyText(proposal+'\nPor favor, responda confirmando ou recusando o convite.',row)),confirm,respond('Registrar recusa','declined'));
          if (Date.parse(event.starts_at)>Date.now()) {
            const generate=action('Gerar e copiar convite com link', async ()=>{
              if (busy) return;
              busy=true; view.inert=true;
              try {
                const {token}=await request('/assignments/'+assignment.id+'/link','POST',{});
                if (typeof token!=='string' || !token) throw Error('Não foi possível obter o link do convite.');
                const link=new URL('/convite.html',location.origin);
                link.hash=encodeURIComponent(token);
                await copyText(proposal+'\nConfirme ou recuse sua participação: '+link.href,row);
              } catch (err) {notice.textContent=err.message;}
              finally {
                busy=false;view.inert=false;
                const manual=row.querySelector('.staff-copy');
                if (manual) {manual.focus();manual.select();}
              }
            });
            controls.append(generate,element('small','Gerar novamente substitui o link anterior deste convite.','staff-help'));
          }
        } else {
          if(assignment.status==='confirmed' && event.group_url) controls.append(action('Copiar link do grupo',()=>copyText(event.group_url,row)));
          controls.append(respond('Reabrir convite','invited'));
        }
        row.append(name,status,controls);panel.append(row);
      }
      const searchBox=element('div',undefined,'staff-search');
      const search=field(searchBox,'Convidar parceiro','search',false);
      search.placeholder='Buscar contato por nome, e-mail ou telefone';
      const choices=element('div',undefined,'staff-choices');
      const searchStatus=element('span','','staff-help');searchStatus.setAttribute('role','status');
      const already=new Set(role.assignments.map(a=>String(a.contact_id)));
      search.oninput=()=>{
        choices.replaceChildren();searchStatus.textContent='';
        const term=normalize(search.value.trim());
        if (term.length<2) {if(term) searchStatus.textContent='Digite pelo menos dois caracteres.';return;}
        let found=0;
        for(const p of data.contacts) {
          if(already.has(String(p.id)) || !normalize([p.name,p.email,p.phone].join(' ')).includes(term)) continue;
          const item=action([p.name,p.email || p.phone].filter(Boolean).join(' · '),()=>change(
            '/roles/'+role.id+'/assignments','POST',{contact_id:p.id},'Convite registrado. Copie a proposta para enviá-la ao parceiro.'));
          choices.append(item);
          if(++found===8) break;
        }
        searchStatus.textContent=found ? 'Selecione um contato para registrar o convite.' : 'Nenhum contato disponível para essa busca.';
      };
      searchBox.append(searchStatus,choices);panel.append(searchBox);grid.append(panel);
    }

    await start();
  }
  return {mount};
})();
