const ContactSegments = (() => {
  const kinds = {'':'Qualquer evento',created:'Virou oportunidade',won:'Conversão em cliente',lost:'Oportunidade perdida',approved:'Orçamento aprovado',event:'Data do evento contratado ou orçado'};
  const options = pairs => Object.entries(pairs).map(([value,name]) => '<option value="'+value+'">'+name+'</option>').join('');
  function match(person, events, criteria) {
    if (criteria.groups) {
      const hits = criteria.groups.map(group => match(person,events,group));
      if (criteria.mode === 'all' ? hits.some(hit => !hit) : hits.every(hit => !hit)) return null;
      return [...new Set(hits.filter(Boolean).flat())];
    }
    const {kind,origin,from,to,profile} = criteria;
    const hasEmail = Boolean(person.email?.trim()), hasPhone = Boolean(person.phone?.trim());
    if ((profile === 'email' || profile === 'both') && !hasEmail ||
        (profile === 'phone' || profile === 'both') && !hasPhone ||
        profile === 'company' && !person.company) return null;
    const evidence = events.filter(e => (!kind || e.kind === kind) && (!origin || e.origin === origin) &&
      (!from || e.day && e.day >= from) && (!to || e.day && e.day <= to));
    if ((kind || origin || from || to) && !evidence.length) return null;
    return evidence;
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = "'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }
  const symbols = {
    rules:'<path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    save:'<path d="M5 4h12l3 3v13H4V4zM8 4v5h8V4M8 20v-6h8v6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
    right:'<path d="m9 5 7 7-7 7"/>',left:'<path d="m15 5-7 7 7 7"/>'
  };
  const icon = name => '<svg class="seg-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+symbols[name]+'</svg>';
  const origins = {'':'Todas as origens',Kommo:'Kommo',MeEventos:'MeEventos','CRM Apito':'CRM Apito'};
  const profiles = {'':'Qualquer contato',email:'Com e-mail',phone:'Com telefone',both:'Com e-mail e telefone',company:'Com empresa vinculada'};
  const periods = {all:'Todo o histórico',year:'Ano',month:'Mês e ano',day:'Dia específico',since:'A partir de',until:'Até',range:'Intervalo'};
  const formatNumber = new Intl.NumberFormat('pt-BR');
  const fmt = value => formatNumber.format(value);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function selectField(label, name, choices) {
    return '<label>'+label+'<select name="'+name+'">'+options(choices)+'</select></label>';
  }

  function periodFor({from,to}) {
    if (!from) return to ? 'until' : 'all';
    if (!to) return 'since';
    if (from === to) return 'day';
    if (from.endsWith('-01-01') && to === from.slice(0,4)+'-12-31') return 'year';
    if (from.endsWith('-01') && to === monthEnd(from.slice(0,7))) return 'month';
    return 'range';
  }

  function monthEnd(value) {
    const [y,m] = value.split('-').map(Number);
    return value+'-'+new Date(Date.UTC(y,m,0)).getUTCDate();
  }

  async function mount(root, data, directory, apiFetch, openRecord) {
    const body = element('section','seg-workspace');
    body.setAttribute('aria-label','Segmentação de contatos');
    root.replaceChildren(body);
    body.innerHTML = '<div class="seg-state" role="status">'+icon('rules')+'<span>Carregando histórico…</span></div>';
    try {
      const response = await apiFetch('/api/contact-segments');
      if (!response.ok) throw Error();
      const payload = await response.json();
      if (body.isConnected) render(payload);
    } catch {
      body.innerHTML = '<div class="seg-state" role="alert"><span>Não foi possível carregar o histórico.</span><button type="button" class="seg-secondary">Tentar novamente</button></div>';
      body.querySelector('button').onclick = () => mount(root,data,directory,apiFetch,openRecord);
    }

    function render({lists,events}) {
      const byContact = new Map();
      for (const event of events) {
        if (!byContact.has(event.contact_id)) byContact.set(event.contact_id,[]);
        byContact.get(event.contact_id).push(event);
      }
      body.innerHTML = `
        <div class="seg-layout">
          <section class="seg-builder" aria-labelledby="seg-builder-title">
            <div class="seg-panel-head"><span class="seg-heading-icon">${icon('rules')}</span><h2 id="seg-builder-title">Regras da lista</h2><span class="seg-counter"></span></div>
            <div class="seg-library"><label>Listas salvas<select name="saved"><option value="">Nova segmentação</option></select></label><small class="seg-draft" hidden>Regras alteradas. Dê um nome para salvar esta versão como nova lista.</small></div>
            <div class="seg-mode"><span id="seg-mode-label">Combinar grupos</span><div class="seg-toggle" role="group" aria-labelledby="seg-mode-label"><button type="button" data-mode="any" aria-pressed="true">Qualquer grupo (OU)</button><button type="button" data-mode="all" aria-pressed="false">Todos os grupos (E)</button></div></div>
            <div class="seg-groups"></div>
            <button type="button" class="seg-add" data-add>${icon('plus')}Adicionar grupo</button>
            <div class="seg-save"><label for="seg-name">Nome da lista</label><div class="seg-save-row"><input id="seg-name" name="listName" maxlength="100" placeholder="Ex.: Clientes convertidos em 2026"><button type="button" class="seg-primary" data-save>${icon('save')}Salvar nova lista</button></div></div>
            <p class="seg-notice" role="status"></p>
          </section>
          <section class="seg-preview" aria-labelledby="seg-preview-title">
            <div class="seg-panel-head"><span class="seg-heading-icon">${icon('people')}</span><h2 id="seg-preview-title">Público da lista</h2></div>
            <div class="seg-summary"><strong class="seg-total">—</strong><span>contatos encontrados</span><div class="seg-meter" aria-hidden="true"><i></i></div><small class="seg-share"></small></div>
            <div class="seg-results-head"><h3>Contatos correspondentes</h3><button class="seg-export seg-secondary" type="button" data-export>${icon('download')}Exportar CSV</button></div>
            <div class="seg-results"></div><div class="seg-pagination"></div>
          </section>
        </div>`;
      const find = selector => body.querySelector(selector);
      const groups = find('.seg-groups'), saved = find('[name=saved]'), listName = find('[name=listName]');
      const preview = find('.seg-results'), notice = find('.seg-notice'), pagination = find('.seg-pagination');
      const save = find('[data-save]'), download = find('[data-export]');
      const editors = new Map();
      const pageSize = 25;
      let mode = 'any', results = [], offset = 0, saving = false, savedRules = '';

      function updateGroups() {
        find('.seg-counter').textContent = editors.size+(editors.size===1?' grupo':' grupos');
        find('[data-add]').disabled = editors.size >= 30;
        for (const [index,group] of [...editors.keys()].entries()) {
          const title = 'Grupo '+(index+1);
          group.querySelector('legend').textContent = title;
          group.querySelector('.seg-group-title').textContent = title;
          const remove = group.querySelector('.seg-remove');
          remove.disabled = editors.size===1;
          remove.setAttribute('aria-label','Remover '+title.toLowerCase());
          const connector = group.previousElementSibling;
          if (connector?.classList.contains('seg-connector')) connector.remove();
          if (index) group.before(element('div','seg-connector',mode==='any'?'OU':'E'));
        }
        body.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
      }

      function addGroup(initial = {}) {
        const group = element('fieldset','seg-group');
        group.innerHTML = '<legend class="sr-only"></legend><div class="seg-group-head"><strong class="seg-group-title"></strong><button type="button" class="seg-remove" title="Remover grupo">'+icon('close')+'</button></div><div class="seg-fields">'+
          selectField('Evento comercial','kind',kinds)+selectField('Origem do evento','origin',origins)+
          selectField('Dados do contato','profile',profiles)+selectField('Período do evento','period',periods)+'</div><div class="seg-dates"></div>';
        groups.append(group);
        const input = key => group.querySelector('[name="'+key+'"]');
        for (const key of ['kind','origin','profile']) input(key).value = initial[key] || '';
        input('period').value = periodFor(initial);
        const dateFields = group.querySelector('.seg-dates');
        function drawDates() {
          const unit = input('period').value;
          const type = {year:'number',month:'month',day:'date',since:'date',until:'date',range:'date'}[unit];
          const label = {year:'Ano',month:'Mês',day:'Dia',since:'Desde',until:'Até',range:'De'}[unit];
          dateFields.innerHTML = type ? '<label>'+label+'<input required name="start" type="'+type+'" '+(unit==='year'?'min="1000" max="9999"':'')+'></label>'+(unit==='range'?'<label>Até<input required name="end" type="date"></label>':'') : '';
        }
        drawDates();
        if (initial.from && input('start')) {
          const unit = input('period').value;
          input('start').value = unit==='year' ? initial.from.slice(0,4) : unit==='month' ? initial.from.slice(0,7) : initial.from;
        }
        if (initial.to && input('period').value==='until') input('start').value=initial.to;
        if (initial.to && input('end')) input('end').value = initial.to;
        editors.set(group,() => {
          const unit = input('period').value;
          let from = input('start')?.value || '', to = from;
          if (unit !== 'all' && (!from || !input('start').validity.valid)) return {error:'Preencha o período do grupo.'};
          if (unit==='year') { to=from+'-12-31'; from+='-01-01'; }
          if (unit==='month') { to=monthEnd(from); from+='-01'; }
          if (unit==='range') {
            to=input('end').value;
            if (!to || !input('end').validity.valid) return {error:'Preencha a data final do grupo.'};
            if (from>to) return {error:'A data final deve ser igual ou posterior à inicial.'};
          }
          if (unit==='since') to='';
          if (unit==='until') from='';
          return {kind:input('kind').value,origin:input('origin').value,profile:input('profile').value,from,to};
        });
        group.onchange = event => {
          if (event.target === input('period')) drawDates();
          editRules();
        };
        group.querySelector('.seg-remove').onclick = () => {
          const adjacent = group.nextElementSibling?.nextElementSibling || group.previousElementSibling?.previousElementSibling;
          const connector = group.previousElementSibling || group.nextElementSibling;
          if (connector?.classList.contains('seg-connector')) connector.remove();
          editors.delete(group);
          group.remove();
          updateGroups();
          editRules();
          adjacent?.querySelector('select')?.focus();
        };
        return group;
      }

      function readCriteria() {
        const rules = [];
        for (const read of editors.values()) {
          const rule = read();
          if (rule.error) return rule;
          if (editors.size>1 && Object.values(rule).every(v=>!v)) return {error:'Escolha uma condição em cada grupo ou remova o grupo vazio.'};
          rules.push(rule);
        }
        return {mode,groups:rules};
      }

      function addContactRow({person,evidence}) {
        const row = element('button','seg-person');
        row.type = 'button';
        row.onclick = () => openRecord('contacts',person.id);
        const name = person.name || 'Contato sem nome';
        const words = name.trim().split(/\s+/);
        const avatar = element('span','seg-avatar',((words[0]?.[0]||'')+(words.length>1?words.at(-1)[0]:'')).toLocaleUpperCase('pt-BR'));
        avatar.setAttribute('aria-hidden','true');
        const identity = element('span','seg-person-main');
        identity.append(element('strong','',name),element('small','',directory.companies.get(person.company)?.name || person.email || person.phone || ''));
        const info = element('span','seg-detail');
        const event = evidence.reduce((latest,next)=>!latest || (next.day||'')>(latest.day||'') ? next : latest,null);
        if (event) {
          info.append(element('span','',kinds[event.kind] || event.kind),element('small','',[event.origin,event.day?.split('-').reverse().join('/')].filter(Boolean).join(' · ')));
        }
        const arrow = element('span','seg-chevron');
        arrow.innerHTML = icon('right');
        row.append(avatar,identity,info,arrow);
        return row;
      }

      function drawResults(error) {
        const n=results.length, total=data.contacts.length;
        find('.seg-total').textContent = error ? '—' : fmt(n);
        const share = total ? 100*n/total : 0;
        find('.seg-share').textContent = error ? 'Aguardando regras completas' : share.toLocaleString('pt-BR',{maximumFractionDigits:1})+'% da base de '+fmt(total)+' contatos';
        find('.seg-meter i').style.width = (error?0:share)+'%';
        download.disabled = !!error || n===0;
        save.disabled = saving || !!error;
        preview.replaceChildren();
        pagination.replaceChildren();
        if (error || !n) {
          preview.append(element('p','seg-state',error ? 'Complete as regras para visualizar os contatos.' : 'Nenhum contato atende a essas regras. Ajuste os filtros para ampliar o público.'));
          return;
        }
        preview.append(...results.slice(offset,offset+pageSize).map(addContactRow));
        pagination.append(element('span','',fmt(offset+1)+'–'+fmt(Math.min(n,offset+pageSize))+' de '+fmt(n)));
        if (n<=pageSize) return;
        for (const [label,step,symbol] of [['Página anterior',-pageSize,'left'],['Próxima página',pageSize,'right']]) {
          const button=element('button','seg-secondary');
          button.type='button';
          button.setAttribute('aria-label',label);
          button.title=label;
          button.innerHTML=icon(symbol);
          button.disabled = offset+step<0 || offset+step>=n;
          button.onclick=()=>{
            offset+=step;drawResults();
            const next=pagination.querySelector('[aria-label="'+label+'"]:not(:disabled)') || pagination.querySelector('button:not(:disabled)');
            next?.focus();
          };
          pagination.append(button);
        }
      }

      function refresh() {
        const c=readCriteria();
        offset=0;
        results=[];
        if (!c.error) {
          for (const person of data.contacts) {
            const evidence=match(person,byContact.get(person.id)||[],c);
            if (evidence) results.push({person,evidence});
          }
        }
        drawResults(c.error);
        notice.textContent = c.error || fmt(results.length)+' contatos encontrados.';
        notice.classList.toggle('sr-only',!c.error);
        return c;
      }
      function feedback(message) {
        notice.classList.remove('sr-only');
        notice.textContent=message;
      }

      function editRules() {
        const original = lists.find(list=>String(list.id)===saved.value);
        if (original && savedRules!==JSON.stringify(readCriteria())) {
          saved.value='';
          if (listName.value.trim()===original.name) listName.value='';
          find('.seg-draft').hidden=false;
        }
        refresh();
      }

      find('[data-add]').onclick = () => {
        const group=addGroup();
        updateGroups();editRules();group.querySelector('select').focus();
      };
      body.querySelectorAll('[data-mode]').forEach(button=>{
        button.onclick=()=>{if (mode!==button.dataset.mode) {mode=button.dataset.mode;updateGroups();editRules();}};
      });
      function addList(list) {saved.add(new Option(list.name,String(list.id)));}
      lists.forEach(addList);
      saved.onchange = () => {
        const list=lists.find(item=>String(item.id)===saved.value);
        find('.seg-draft').hidden=true;
        editors.clear();groups.replaceChildren();listName.value=list?.name || '';
        const c=list?.criteria;
        mode=c?.mode || 'any';
        for (const group of c?.groups || [c]) addGroup(group);
        savedRules=JSON.stringify(readCriteria());
        updateGroups();refresh();
      };

      save.onclick = async () => {
        const c=readCriteria(), name=listName.value.trim();
        if (c.error) {feedback(c.error);return;}
        if (!name) {listName.focus();feedback('Informe um nome para salvar a lista.');return;}
        saving=true;save.disabled=true;
        try {
          const response=await apiFetch('/api/contact-segments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,criteria:c})});
          const list=await response.json();
          if (!response.ok) throw Error(list.error || 'Não foi possível salvar a lista.');
          lists.push(list);addList(list);
          if (listName.value.trim()===name && JSON.stringify(readCriteria())===JSON.stringify(c)) {
            saved.value=String(list.id);
            savedRules=JSON.stringify(c);
            find('.seg-draft').hidden=true;
          }
          feedback('Lista salva: '+list.name+'.');
        } catch(error) {feedback(error.message);}
        finally {saving=false;save.disabled=Boolean(readCriteria().error);}
      };
      download.onclick = () => {
        const lines=[['ID','Nome','Empresa','E-mail','Telefone','Histórico correspondente (origem, referência e data)']];
        for (const {person,evidence} of results) lines.push([person.id,person.name,directory.companies.get(person.company)?.name,person.email,person.phone,
          evidence.map(e=>[kinds[e.kind],e.origin,'#'+e.reference,e.day||'Data desconhecida'].join(' · ')).join(' | ')]);
        const url=URL.createObjectURL(new Blob(['\ufeff'+lines.map(cols=>cols.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download='segmentacao-contatos.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      addGroup();updateGroups();refresh();
    }
  }
  return {mount,match};
})();
