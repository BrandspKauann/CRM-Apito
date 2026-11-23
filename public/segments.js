const ContactSegments = (() => {
  const kinds = {'':'Qualquer evento',created:'Virou oportunidade',won:'Conversão em cliente',lost:'Oportunidade perdida',approved:'Orçamento aprovado',event:'Data do evento contratado ou orçado'};
  const options = pairs => Object.entries(pairs).map(([value,name]) => '<option value="'+value+'">'+name+'</option>').join('');
  function match(person, events, criteria) {
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
  async function mount(root, data, directory, apiFetch, openRecord) {
    const body = document.createElement('section');
    body.className = 'segment-panel segment-body';
    root.replaceChildren(body);
    body.setAttribute('aria-label','Regras de segmentação');
    body.textContent = 'Carregando histórico…';
    try {
      const response = await apiFetch('/api/contact-segments');
      if (!response.ok) throw Error('Não foi possível carregar o histórico.');
      const payload = await response.json();
      if (body.isConnected) render(payload);
    } catch (error) {
      body.textContent = error.message + ' ';
      const retry = document.createElement('button');
      retry.textContent = 'Tentar novamente';
      retry.onclick = () => mount(root, data, directory, apiFetch, openRecord);
      body.append(retry);
    }
    function render({lists,events}) {
      const byContact = new Map();
      for (const event of events) {
        if (!byContact.has(event.contact_id)) byContact.set(event.contact_id,[]);
        byContact.get(event.contact_id).push(event);
      }
      body.innerHTML = '<label>Listas salvas<select name="saved"><option value="">Nova segmentação</option></select></label>'+
        '<h2>Regras da lista</h2><form class="segment-filters"><label>Evento comercial<select name="kind">'+options(kinds)+'</select></label>'+
        '<label>Origem<select name="origin">'+options({'':'Todas',Kommo:'Kommo',MeEventos:'MeEventos','CRM Apito':'CRM Apito'})+'</select></label>'+
        '<label>Dados do contato<select name="profile">'+options({'':'Todos',email:'Com e-mail',phone:'Com telefone',both:'Com e-mail e telefone',company:'Com empresa'})+'</select></label>'+
        '<label>Período<select name="period">'+options({all:'Todo o histórico',year:'Ano',month:'Mês e ano',day:'Dia específico',since:'A partir de',range:'Intervalo'})+'</select></label>'+
        '<div class="segment-dates"></div><button type="submit">Aplicar regras</button></form>'+
        '<div class="segment-tools"><label>Nome da lista<input name="listName" maxlength="100"></label><button type="button" data-save>Salvar nova lista</button>'+
        '<button type="button" data-export>Exportar CSV</button></div><p role="status"></p><div class="segment-results"></div>';
      const form = body.querySelector('form'), inputs = form.elements;
      const dates = form.querySelector('.segment-dates'), saved = body.querySelector('[name=saved]');
      const output = body.querySelector('.segment-results'), notice = body.querySelector('[role=status]');
      const name = body.querySelector('[name=listName]');
      let results = [], offset = 0;
      function dateInputs() {
        const mode = inputs.period.value;
        const type = {year:'number',month:'month',day:'date',since:'date',range:'date'}[mode];
        dates.innerHTML = !type ? '' : '<label>'+({year:'Ano',month:'Mês',day:'Dia',since:'Desde',range:'De'})[mode]+
          '<input required name="start" type="'+type+'" '+(mode==='year'?'min="1000" max="9999"':'')+'></label>'+
          (mode==='range'?'<label>Até<input required type="date" name="end"></label>':'');
      }
      function criteria() {
        if (!form.reportValidity()) return null;
        let from = inputs.start?.value || '', to = from;
        switch (inputs.period.value) {
          case 'year': to=from+'-12-31'; from+='-01-01'; break;
          case 'month': {
            const [year,month] = from.split('-').map(Number);
            to=from+'-'+new Date(Date.UTC(year,month,0)).getUTCDate(); from+='-01'; break;
          }
          case 'range': to=inputs.end.value; break;
          case 'since': to=''; break;
        }
        if (from && to && from>to) { notice.textContent='A data final deve ser igual ou posterior à inicial.'; return null; }
        return {kind:inputs.kind.value,origin:inputs.origin.value,profile:inputs.profile.value,from,to};
      }
      function show() {
        output.replaceChildren();
        const count=document.createElement('strong');
        count.textContent=results.length.toLocaleString('pt-BR')+' contatos encontrados';
        output.append(count);
        results.slice(offset,offset+25).forEach(({person,evidence})=>{
          const row=document.createElement('button');
          row.type='button'; row.className='record'; row.onclick=()=>openRecord('contacts',person.id);
          const title=document.createElement('strong'), detail=document.createElement('small');
          title.textContent=person.name;
          detail.textContent=[directory.companies.get(person.company)?.name,...evidence.slice(0,2).map(e=>
            kinds[e.kind]+' · '+e.origin+' · '+(e.day?e.day.split('-').reverse().join('/'):'Data desconhecida'))].filter(Boolean).join(' | ');
          row.append(title,detail); output.append(row);
        });
        if(results.length>25) for(const [title,step] of [['Anterior',-25],['Próxima',25]]) {
          const btn=document.createElement('button'); btn.type='button'; btn.textContent=title;
          btn.disabled=offset+step<0 || offset+step>=results.length;
          btn.onclick=()=>{offset+=step;show();};output.append(btn);
        }
      }
      function apply() {
        const c=criteria(); if(!c) return null;
        results=[];
        for(const person of data.contacts) {
          const evidence=match(person,byContact.get(person.id)||[],c);
          if(evidence) results.push({person,evidence});
        }
        offset=0; notice.textContent=''; show(); return c;
      }
      function addList(list) { saved.add(new Option(list.name,String(list.id))); }
      lists.forEach(addList);
      saved.onchange=()=>{
        const list=lists.find(v=>String(v.id)===saved.value);
        form.reset();inputs.period.value='all'; name.value=list?.name||'';
        const c=list?.criteria;
        if(c) {
          for(const key of ['kind','origin','profile']) inputs[key].value=c[key];
          inputs.period.value=c.from ? (c.to ? 'range':'since') : 'all';
        }
        dateInputs();
        if(inputs.start) inputs.start.value=c.from;
        if(inputs.end) inputs.end.value=c.to;
        apply();
      };
      inputs.period.onchange=dateInputs;
      form.onsubmit=e=>{e.preventDefault();apply();};
      const save=body.querySelector('[data-save]');
      save.onclick=async()=>{
        const c=apply();if(!c)return;
        if(!name.value.trim()){name.focus();notice.textContent='Informe um nome para salvar a lista.';return;}
        save.disabled=true;
        try {
          const res=await apiFetch('/api/contact-segments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.value.trim(),criteria:c})});
          const list=await res.json();if(!res.ok)throw Error(list.error);
          lists.push(list);addList(list);saved.value=String(list.id);notice.textContent='Lista salva.';
        } catch(e){notice.textContent=e.message;}finally{save.disabled=false;}
      };
      body.querySelector('[data-export]').onclick=()=>{
        if(!apply())return;
        const lines=[['ID','Nome','Empresa','E-mail','Telefone','Histórico correspondente (origem, referência e data)']];
        for(const {person,evidence} of results) lines.push([person.id,person.name,directory.companies.get(person.company)?.name,person.email,person.phone,
          evidence.map(e=>[kinds[e.kind],e.origin,'#'+e.reference,e.day||'Data desconhecida'].join(' · ')).join(' | ')]);
        const url=URL.createObjectURL(new Blob(['\ufeff'+lines.map(cols=>cols.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download='segmentacao-contatos.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      apply();
    }
  }
  return {mount,match};
})();
