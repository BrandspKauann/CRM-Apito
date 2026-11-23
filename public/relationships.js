const RecordRelationships = (() => {
  const pageSize = 5;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, className, action) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function searchKey(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  }

  function websiteDomain(website) {
    if (typeof website !== 'string') return '';
    const match = /^https:\/\/([a-z0-9.-]+)\/?$/i.exec(website);
    if (!match || match[1].length > 253) return '';
    const domain = match[1].toLowerCase();
    const labels = domain.split('.');
    if (labels.length < 2 || !/^[a-z]/.test(labels.at(-1))) return '';
    return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? domain : '';
  }

  function contactActions(fields) {
    const actions = element('div', 'rel-actions');
    const emailInput = fields.querySelector('[name=email]');
    const phoneInput = fields.querySelector('[name=phone]');
    function addLink(text, href) {
      const link = element('a', 'rel-action', text);
      link.href = href;
      actions.append(link);
    }
    function update() {
      actions.replaceChildren();
      const email = emailInput.value.trim();
      const phone = phoneInput.value.trim();
      if (email && emailInput.validity.valid && !/[\r\n,;]/.test(email)) {
        addLink('Enviar e-mail', 'mailto:' + encodeURIComponent(email).replace('%40', '@'));
      }
      const number = phone.replace(/[\s().-]/g, '');
      if (/^\+?\d{3,15}$/.test(number)) addLink('Ligar', 'tel:' + number);
      actions.hidden = !actions.childElementCount;
    }
    emailInput.addEventListener('input', update);
    phoneInput.addEventListener('input', update);
    update();
    return actions;
  }

  function relationshipGroup(title, rows, table, detail, emptyText, navigate) {
    const section = element('section', 'rel-group');
    const heading = element('h3', 'rel-heading', title);
    heading.append(element('span', 'rel-count', rows.length.toLocaleString('pt-BR')));
    section.append(heading);
    if (!rows.length) {
      section.append(element('p', 'rel-empty', emptyText));
      return section;
    }
    const list = element('ul', 'rel-list');
    const search = element('input', 'rel-search');
    let matches = rows;
    let page = 0;
    const status = element('span', 'rel-pages');
    status.setAttribute('aria-live', 'polite');
    const controls = element('div', 'rel-pagination');
    const previous = button('Anterior', 'rel-page', () => { page--; draw(); });
    const next = button('Próxima', 'rel-page', () => { page++; draw(); });
    controls.append(previous, status, next);
    if (rows.length > pageSize) {
      search.type = 'search';
      search.placeholder = 'Filtrar por nome';
      search.setAttribute('aria-label', 'Filtrar ' + title.toLocaleLowerCase('pt-BR') + ' por nome');
      search.addEventListener('keydown', event => {
        if (event.key === 'Enter') event.preventDefault();
      });
      search.addEventListener('input', () => {
        const query = searchKey(search.value);
        matches = query ? rows.filter(record => searchKey(record.name).includes(query)) : rows;
        page = 0;
        draw();
      });
      section.append(search);
    }
    section.append(list, controls);
    function draw() {
      const start = page * pageSize;
      const shown = matches.slice(start, start + pageSize);
      list.replaceChildren();
      shown.forEach(record => {
        const item = element('li');
        const link = button(null, 'rel-link', () => navigate(table, record));
        const copy = element('span', 'rel-copy');
        copy.append(element('strong', null, record.name));
        const subtitle = detail(record);
        if (subtitle) copy.append(element('small', null, subtitle));
        const arrow = element('span', 'rel-chevron', '›');
        arrow.setAttribute('aria-hidden', 'true');
        link.append(copy, arrow);
        item.append(link);
        list.append(item);
      });
      if (!shown.length) list.append(element('li', 'rel-empty', 'Nenhum resultado.'));
      previous.disabled = page === 0;
      next.disabled = start + shown.length >= matches.length;
      controls.hidden = matches.length <= pageSize;
      status.textContent = (start + 1) + '–' + (start + shown.length) + ' de ' + matches.length;
    }
    draw();
    return section;
  }

  function mount(table, record, data, trail, openRecord) {
    const fields = document.querySelector('#fields');
    const dialog = fields.closest('dialog');
    const isProfile = Boolean(record.id) && (table === 'contacts' || table === 'companies');
    const isSavedDeal = Boolean(record.id) && table === 'deals';
    dialog.classList.toggle('rel-dialog', isProfile);
    if (!isProfile && !isSavedDeal && !trail.length) return;
    const editor = dialog.querySelector('form');
    const baseline = new URLSearchParams(new FormData(editor)).toString();
    function go(target, path) {
      if (editor.querySelector('[type=submit]').disabled) return;
      const current = new URLSearchParams(new FormData(editor)).toString();
      if (current !== baseline && !window.confirm('Descartar as alterações desta ficha para abrir outra?')) return;
      openRecord(target.table, target.id, path);
    }
    function navigate(targetTable, targetRecord) {
      const target = { table: targetTable, id: targetRecord.id };
      const visited = trail.findIndex(item => item.table === target.table && item.id === target.id);
      const path = visited >= 0 ? trail.slice(0, visited) : [...trail, { table, id: record.id, name: record.name }];
      go(target, path);
    }
    if (isSavedDeal) {
      const contactSelect = fields.querySelector('[name=contact]');
      const openContact = button('Abrir ficha do contato', 'rel-back rel-open-contact', () => {
        const contact = data.contacts.find(row => String(row.id) === contactSelect.value);
        if (contact) navigate('contacts', contact);
      });
      const update = () => { openContact.hidden = !contactSelect.value; };
      contactSelect.addEventListener('change', update);
      fields.querySelector('.linked-contact').after(openContact);
      update();
    }
    if (isProfile) {
      const person = table === 'contacts';
      const title = document.querySelector('#modalTitle');
      title.textContent = record.name;
      title.prepend(element('span', 'rel-type', person ? 'Ficha do contato' : 'Ficha da empresa'));
      const properties = element('div', 'rel-properties');
      properties.append(...fields.children);
      if (person) properties.append(contactActions(properties));
      const groups = element('div', 'rel-groups');
      fields.append(properties, groups);
      if (person) {
        if (record.commercial_history?.length) {
          const history = element('section', 'rel-group');
          history.append(element('h3', 'rel-heading', 'Histórico comercial'));
          history.append(element('p', 'rel-copy', record.commercial_tags.join(' · ')));
          const labels = {won:'Negócio ganho', approved:'Orçamento aprovado', lost:'Oportunidade perdida',
            open:'Em aberto', closed_unknown:'Finalizado sem desfecho', cancelled:'Cancelado'};
          for (const group of record.commercial_history) {
            const details = element('details');
            details.append(element('summary', null, group.origin + ' · ' + labels[group.outcome] + ' (' + group.refs.length + ')'));
            details.append(element('p', 'rel-copy', group.refs.map(id => '#' + id).join(', ')));
            history.append(details);
          }
          groups.append(history);
        }
        const select = properties.querySelector('[name=company]');
        const companySection = element('div');
        function showCompany() {
          const company = data.companies.find(row => String(row.id) === select.value);
          companySection.replaceChildren(relationshipGroup('Empresa vinculada', company ? [company] : [], 'companies',
            row => row.city, 'Sem empresa vinculada.', navigate));
        }
        select.addEventListener('change', showCompany);
        showCompany();
        const deals = data.deals.filter(row => row.contact === record.id);
        groups.append(companySection, relationshipGroup('Negócios do contato', deals, 'deals',
          row => [row.stage, money(row.amount)].filter(Boolean).join(' · '), 'Nenhum negócio vinculado.', navigate));
      } else {
        const domain = websiteDomain(record.website);
        if (domain) {
          const site = element('div', 'rel-copy');
          const link = element('a', null, domain);
          link.href = 'https://' + domain;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          site.append(element('small', null, 'Site inferido pelo domínio do e-mail'), link);
          properties.append(site);
        }
        const people = data.contacts.filter(row => row.company === record.id);
        const names = new Map(people.map(row => [row.id, row.name]));
        const deals = data.deals.filter(row => row.company === record.id || names.has(row.contact));
        groups.append(relationshipGroup('Contatos da empresa', people, 'contacts',
          row => [row.email, row.phone].filter(Boolean).join(' · '), 'Nenhum contato vinculado.', navigate));
        groups.append(relationshipGroup('Oportunidades da empresa', deals, 'deals',
          row => [names.get(row.contact), row.stage, money(row.amount)].filter(Boolean).join(' · '),
          'Nenhuma oportunidade vinculada.', navigate));
      }
    }
    if (trail.length) {
      const parent = trail[trail.length - 1];
      const back = button('‹  Voltar para ' + parent.name, 'rel-back', () => go(parent, trail.slice(0, -1)));
      fields.prepend(back);
    }
  }
  return { mount, websiteDomain };
})();
