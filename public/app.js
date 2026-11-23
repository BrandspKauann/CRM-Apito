const $ = selector => document.querySelector(selector);
const pages = {
  home: 'Visão geral',
  companies: 'Empresas',
  contacts: 'Contatos',
  deals: 'Funil de negócios',
  automations: 'Automações',
  integrations: 'Integrações'
};
const singular = { companies: 'empresa', contacts: 'contato', deals: 'negócio' };
const labels = {
  name: 'Nome', city: 'Cidade', email: 'E-mail', phone: 'Telefone',
  company: 'Empresa', amount: 'Valor (R$)', contact: 'Contato',
  stage: 'Etapa', notes: 'Observações', next_action: 'Próxima ação', follow_up_on: 'Data de acompanhamento'
};
const keys = {
  companies: ['name', 'city'],
  contacts: ['name', 'company', 'email', 'phone'],
  deals: ['name', 'contact', 'amount', 'stage', 'next_action', 'follow_up_on', 'notes']
};
const iconPaths = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-4h6v4M8 7h2m4 0h2M8 11h2m4 0h2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  chart: '<path d="M4 20V4m0 16h16M8 16l4-5 3 2 5-7"/><path d="M17 6h3v3"/>',
  plug: '<path d="M9 3v5m6-5v5M7 8h10v4a5 5 0 0 1-10 0V8Zm5 9v4"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-5 5h2"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
// Solid silhouettes and a second ink for the five navigation emblems.
const navEmblems = {
  automations: '<path d="M14 1 3 14h8l-1 9L22 9h-9z"/>',
  home: '<path d="M2 21V3h20v18z"/><path class="ink-cut" d="M5 6h14v9H5z"/><path class="ink-accent" d="M6 13 9 8l3 3 5-4 2 6z"/><path class="ink-cut" d="M5 17h6v1H5z"/>',
  companies: '<path d="m2 7 12-5v19H2z"/><path class="ink-accent" d="m16 8 6 3v10h-6z"/><path class="ink-cut" d="M5 9h2v3H5zm5-2h2v3h-2zm-5 7h2v3H5zm5-2h2v3h-2zm-2 6h3v3H8zm10-5h2v3h-2z"/>',
  contacts: '<path class="ink-accent" d="m5 4 14-3 3 16-4 1V6H5z"/><path d="M2 7h16v15H2z"/><circle class="ink-cut" cx="10" cy="12" r="2.3"/><path class="ink-cut" d="M5.5 19c0-5.5 9-5.5 9 0z"/>',
  deals: '<path d="M1 4h22l-4 5H5z"/><path class="ink-accent" d="M5.7 11h12.6l-3.5 4H9.2z"/><path d="M9.6 17h4.8v3.2l-4.8 2z"/>',
  integrations: '<path d="m2 13 4-4 2 2 3-3 1.6 1.6-3 3 1.8 1.8 3-3L16 13l-3 3 1 1-3.5 3.5a5 5 0 0 1-7-7z"/><path class="ink-accent" d="m22 10-3 3-8-8 3-3a5 5 0 0 1 7 0l1 1a5 5 0 0 1 0 7z"/>'
};
function navIcon(page) {
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' + navEmblems[page] + '</svg>';
}
function icon(name, size = 20) {
  return '<svg aria-hidden="true" focusable="false" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    iconPaths[name] + '</svg>';
}
const money = amount => Number(amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let page = 'home', data, editing, search = '';
const directoryPageSize = 50;
let directoryPage = 1, directoryFilter = '', directory;

function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim();
}
function buildDirectory(records) {
  const companies = new Map(records.companies.map(row => [row.id, row]));
  const contacts = new Map(records.contacts.map(row => [row.id, row]));
  const contactCounts = new Map();
  const entries = new Map();
  for (const row of records.contacts) {
    if (row.company != null) contactCounts.set(row.company, (contactCounts.get(row.company) || 0) + 1);
    const company = companies.get(row.company);
    entries.set(row, {
      text: normalizeSearch([row.name, company?.name, row.email, row.phone, ...(row.commercial_tags || [])].filter(Boolean).join(' ')),
      digits: String(row.phone || '').replace(/\D/g, '')
    });
  }
  for (const row of records.companies) {
    entries.set(row, { text: normalizeSearch([row.name, row.city, RecordRelationships.websiteDomain(row.website)].filter(Boolean).join(' ')), digits: '' });
  }
  return { companies, contacts, contactCounts, entries };
}

const directoryFilters = {
  contacts: [['', 'Todos os contatos'], ['phone', 'Com telefone'], ['email', 'Com e-mail'],
    ['missingEmail', 'Sem e-mail'], ['withoutCompany', 'Sem empresa vinculada'],
    ...['Cliente', 'Orçamento aprovado', 'Oportunidade perdida', 'Perda sem fechamento identificado',
      'Oportunidade em aberto', 'Orçamento finalizado sem desfecho', 'Cancelamento registrado'].map(tag => ['tag/' + tag, tag])],
  companies: [['', 'Todas as empresas'], ['hasContacts', 'Com contatos vinculados'],
    ['noContacts', 'Sem contatos vinculados']]
};
function directoryMatch(query) {
  const term = normalizeSearch(query);
  const digits = /^[+\d\s().-]+$/.test(term) ? term.replace(/\D/g, '') : '';
  return row => {
    const entry = directory.entries.get(row);
    return entry.text.includes(term) || Boolean(digits && entry.digits.includes(digits));
  };
}
function directoryRows() {
  const matches = directoryMatch(search);
  return data[page].filter(row => {
    if (!matches(row)) return false;
    if (directoryFilter.startsWith('tag/')) return row.commercial_tags?.includes(directoryFilter.slice(4));
    switch (directoryFilter) {
      case 'phone': return Boolean(row.phone?.trim());
      case 'email': return Boolean(row.email?.trim());
      case 'missingEmail': return !row.email?.trim();
      case 'withoutCompany': return row.company == null;
      case 'hasContacts': return directory.contactCounts.has(row.id);
      case 'noContacts': return !directory.contactCounts.has(row.id);
      default: return true;
    }
  });
}
function mountDirectoryFilter() {
  const searchBox = $('.search-box');
  $('#search').placeholder = page === 'contacts' ? 'Nome, empresa, e-mail ou telefone' : 'Nome, cidade ou domínio';
  searchBox.insertAdjacentHTML('afterend', '<label class="directory-filter"><span class="sr-only">Filtrar ' +
    pages[page].toLowerCase() + '</span><select id="directory-filter">' +
    directoryFilters[page].map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join('') +
    '</select></label>');
  const select = $('#directory-filter');
  select.value = directoryFilter;
  select.onchange = () => { directoryFilter = select.value; directoryPage = 1; renderRows(); };
}
function directoryPager(start, end, total) {
  if (total <= directoryPageSize) return '';
  return '<div class="directory-pager" role="group" aria-label="Paginação">' +
    '<span aria-live="polite">' + (start + 1) + '–' + end + ' de ' + total.toLocaleString('pt-BR') + '</span>' +
    '<button type="button" data-directory-step="-1"' + (start === 0 ? ' disabled' : '') + '>Anterior</button>' +
    '<button type="button" data-directory-step="1"' + (end === total ? ' disabled' : '') + '>Próxima</button></div>';
}

function mountLinkPicker(key, id) {
  const table = key === 'contact' ? 'contacts' : 'companies';
  const records = data[table];
  const select = $('#fields select[name="' + key + '"]');
  const label = select.closest('label');
  const status = document.createElement('small');
  status.className = 'link-picker-count';
  status.setAttribute('aria-live', 'polite');
  let selected = directory[table].get(id);
  function fill(query) {
    const matches = query.trim() ? records.filter(directoryMatch(query)) : records;
    const options = matches.slice(0, directoryPageSize);
    if (selected && !options.includes(selected)) options.unshift(selected);
    select.replaceChildren(new Option('Sem vínculo', ''));
    for (const row of options) {
      const detail = table === 'contacts' ? [linked('companies', row.company), row.phone || row.email] : [row.city];
      const title = [row.name, ...detail].filter(Boolean).join(' · ');
      select.add(new Option(title, String(row.id), false, row === selected));
    }
    status.textContent = matches.length > directoryPageSize
      ? 'Exibindo os primeiros ' + directoryPageSize + ' de ' + matches.length.toLocaleString('pt-BR') + '. Refine a busca.'
      : matches.length ? '' : 'Nenhum resultado para esta busca.';
  }
  if (records.length > directoryPageSize) {
    const filterLabel = document.createElement('label');
    filterLabel.textContent = key === 'contact' ? 'Buscar contato para vincular' : 'Buscar empresa para vincular';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = key === 'contact' ? 'Nome, e-mail ou telefone' : 'Nome ou cidade';
    input.addEventListener('input', () => {
      selected = directory[table].get(Number(select.value));
      fill(input.value);
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
    filterLabel.append(input, status);
    label.before(filterLabel);
  }
  fill('');
}

function showLogin(message = '') {
  KommoImport.endSession();
  data = undefined;
  directory = undefined;
  if ($('dialog').open) $('dialog').close();
  $('.frame').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-error').textContent = message;
  $('#login-form').elements.username.focus();
}
async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    showLogin('Sua sessão expirou. Entre novamente.');
    throw Error('Sessão expirada');
  }
  return response;
}
async function start() {
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw Error('Não foi possível verificar sua sessão.');
    const session = await response.json();
    if (!session.authenticated) { showLogin(); return; }
    $('#login-screen').hidden = true;
    $('.frame').hidden = false;
    await refresh();
  } catch (error) {
    if (!$('#login-screen').hidden) return;
    showLogin(error.message || 'Não foi possível conectar ao CRM.');
  }
}
$('#login-form').onsubmit = async event => {
  event.preventDefault();
  const formElement = event.currentTarget, button = event.submitter;
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formElement.elements.username.value,
        password: formElement.elements.password.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Usuário ou senha incorretos.');
    formElement.elements.password.value = '';
    $('#login-screen').hidden = true;
    $('.frame').hidden = false;
    await refresh();
  } catch (error) {
    showLogin(error.message || 'Não foi possível entrar.');
  } finally {
    button.disabled = false;
  }
};
$('#logout').onclick = async () => {
  try {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) throw Error('Não foi possível encerrar a sessão.');
    showLogin();
  } catch (error) {
    $('#alert').textContent = error.message;
  }
};

function linked(table, id) {
  return directory[table].get(id)?.name || '';
}
function dealContactLabel(deal) {
  const contact = directory.contacts.get(deal.contact);
  return contact ? [contact.name, linked('companies', contact.company)].filter(Boolean).join(' · ') : '';
}
function summary(row, table) {
  if (table === 'companies') return [row.city, RecordRelationships.websiteDomain(row.website)].filter(Boolean).join(' · ') || 'Cidade não informada';
  if (table === 'contacts') {
    return [...(row.commercial_tags || []), linked('companies', row.company), row.email, row.phone].filter(Boolean).join(' · ');
  }
  return [dealContactLabel(row), money(row.amount)].filter(Boolean).join(' · ');
}
function initials(value) {
  return String(value || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR');
}
function stageTone(stage) {
  if (stage === 'Ganho') return 'is-won';
  if (stage === 'Perdido') return 'is-lost';
  if (stage === 'Proposta') return 'is-proposal';
  return 'is-progress';
}
function stagePill(stage) {
  return '<span class="stage-pill ' + stageTone(stage) + '">' + esc(stage) + '</span>';
}
const followUpFilters = {
  all: 'Todos', overdue: 'Em atraso', today: 'Hoje', unscheduled: 'Sem data', future: 'Futuros'
};
const followUpOrder = { overdue: 0, today: 1, unscheduled: 2, future: 3, closed: 4 };
const dayFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
let pipelineFocus = 'all';
let boardView = 'contacts';
const boardPages = new Map();
const boardPageSize = 15;
const portfolioColumns = [
  ['Cliente', 'Clientes', 'Com cliente vinculado'],
  ['Orçamento aprovado', 'Orçamento aprovado', 'Com orçamento aprovado'],
  ['Oportunidade em aberto', 'Em negociação', 'Com negociação aberta'],
  ['Oportunidade perdida', 'Perda registrada', 'Com perda registrada'],
  ['Cancelamento registrado', 'Cancelamento', 'Com cancelamento'],
  ['Orçamento finalizado sem desfecho', 'Finalizado sem desfecho', 'Com orçamento finalizado'],
  ['', 'Sem histórico identificado', 'Sem histórico identificado']
];

function portfolioRanks(records) {
  const contacts = new Map(), companies = new Map();
  const unknown = portfolioColumns.length - 1;
  for (const person of records.contacts) {
    const index = portfolioColumns.findIndex(([tag]) => person.commercial_tags?.includes(tag));
    contacts.set(person.id, index < 0 ? unknown : index);
  }
  for (const deal of records.deals) {
    if (!contacts.has(deal.contact)) continue;
    const index = deal.stage === 'Ganho' ? 0 : deal.stage === 'Perdido' ? 3 : 2;
    contacts.set(deal.contact, Math.min(contacts.get(deal.contact), index));
  }
  for (const person of records.contacts) {
    if (person.company != null) companies.set(person.company,
      Math.min(companies.get(person.company) ?? unknown, contacts.get(person.id)));
  }
  return {contacts, companies};
}

function boardControls() {
  return '<div class="board-views" role="group" aria-label="Visualização do funil">' +
    ['contacts','companies','deals'].map(key =>
      '<button type="button" data-board-view="' + key + '" aria-pressed="' + (boardView === key) + '">' +
      (key === 'deals' ? 'Negócios' : pages[key]) + ' <b>' + data[key].length.toLocaleString('pt-BR') +
      '</b></button>').join('') + '</div>';
}

function renderPortfolio(board) {
  const person = boardView === 'contacts';
  const matches = directoryMatch(search);
  const groups = portfolioColumns.map(() => []);
  for (const row of data[boardView]) {
    if (matches(row)) groups[directory.portfolio[boardView].get(row.id) ?? groups.length - 1].push(row);
  }
  board.innerHTML = groups.map((rows, index) => {
    const title = portfolioColumns[index][person ? 1 : 2];
    const last = Math.max(0, Math.ceil(rows.length / boardPageSize) - 1);
    const current = Math.min(boardPages.get(index) || 0, last);
    const start = current * boardPageSize;
    const cards = rows.slice(start, start + boardPageSize).map(row => {
      const count = directory.contactCounts.get(row.id) || 0;
      const detail = person ? [linked('companies', row.company), row.email || row.phone] :
        [count + (count === 1 ? ' contato vinculado' : ' contatos vinculados'), row.city];
      return '<button type="button" class="record portfolio-card" data-table="' + boardView + '" data-id="' +
        row.id + '"><strong>' + esc(row.name) + '</strong><small>' +
        esc(detail.filter(Boolean).join(' · ')) + '</small></button>';
    }).join('');
    const pager = last ? '<div class="portfolio-pages"><button type="button" data-column="' + index +
      '" data-page-number="' + (current - 1) + '" aria-label="Página anterior de ' + title + '"' +
      (current === 0 ? ' disabled' : '') + '>‹</button><span>' + (start + 1) + '–' +
      Math.min(start + boardPageSize, rows.length) + '</span><button type="button" data-column="' + index +
      '" data-page-number="' + (current + 1) + '" aria-label="Próxima página de ' + title + '"' +
      (current === last ? ' disabled' : '') + '>›</button></div>' : '';
    return '<article class="stage-column"><div class="stage-column-header"><div class="stage-column-title"><h2>' +
      title + '</h2><span class="stage-count">' + rows.length.toLocaleString('pt-BR') +
      '</span></div>' + pager + '</div><div class="stage-column-body">' +
      (cards || '<p class="stage-empty">Nenhum cadastro.</p>') + '</div></article>';
  }).join('');
}

function localCalendarDay() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}
function followUpStatus(row, today) {
  if (row.stage === 'Ganho' || row.stage === 'Perdido') return 'closed';
  if (!row.follow_up_on) return 'unscheduled';
  if (row.follow_up_on < today) return 'overdue';
  return row.follow_up_on === today ? 'today' : 'future';
}
function followUpLine(row, status) {
  if (status === 'closed') return '';
  const date = row.follow_up_on ? dayFormatter.format(new Date(row.follow_up_on + 'T00:00:00Z')) : '';
  const statusText = { overdue: 'Em atraso · ' + date, today: 'Hoje', future: 'Agendado · ' + date, unscheduled: 'Sem data' };
  return '<span class="deal-followup"><span class="followup-state followup-' + status + '">' +
    icon('calendar', 14) + statusText[status] + '</span>' +
    (row.next_action ? '<span class="followup-action">' + esc(row.next_action) + '</span>' : '') + '</span>';
}
function renderPipelineFilters(board, counts) {
  let filters = $('#pipeline-filters');
  if (!filters) {
    filters = document.createElement('fieldset');
    filters.id = 'pipeline-filters';
    filters.innerHTML = '<legend class="sr-only">Filtrar por acompanhamento</legend>' +
      Object.entries(followUpFilters).map(([value, label]) =>
        '<label><input type="radio" name="pipeline-focus" value="' + value + '">' +
        '<span>' + label + ' <b data-count></b></span></label>').join('');
    board.before(filters);
    filters.onchange = event => {
      pipelineFocus = event.target.value;
      renderRows();
    };
  }
  for (const radio of filters.querySelectorAll('input')) {
    radio.checked = radio.value === pipelineFocus;
    radio.parentElement.querySelector('[data-count]').textContent = counts[radio.value];
  }
}
function recordButton(row, table, variant = '', status) {
  const target = 'type="button" data-table="' + table + '" data-id="' + esc(row.id) + '"';
  if (variant === 'deal') {
    return '<button ' + target + ' class="record deal-card"><span class="deal-card-top">' +
      '<strong>' + esc(row.name) + '</strong>' + icon('chevron', 16) + '</span>' +
      '<span class="deal-card-contact">' + esc(dealContactLabel(row) || 'Sem contato vinculado') +
      '</span><span class="deal-card-bottom"><b>' + money(row.amount) + '</b></span>' +
      followUpLine(row, status) + '</button>';
  }
  if (variant === 'recent') {
    return '<button ' + target + ' class="record recent-row"><span class="recent-row-copy"><strong>' +
      esc(row.name) + '</strong><small>' + esc(linked('contacts', row.contact) || 'Sem contato vinculado') +
      '</small></span><span class="recent-row-side"><b>' + money(row.amount) + '</b>' +
      stagePill(row.stage) + '</span></button>';
  }
  if (variant === 'company') {
    const contacts = directory.contactCounts.get(row.id) || 0;
    return '<button ' + target + ' class="record company-row"><span class="company-mark">' +
      esc(initials(row.name)) + '</span><span class="company-row-name"><strong>' + esc(row.name) +
      '</strong><small>' + esc(summary(row, table)) + '</small></span>' +
      '<span class="company-row-count">' + contacts + ' ' + (contacts === 1 ? 'contato' : 'contatos') +
      '</span>' + icon('chevron', 17) + '</button>';
  }
  return '<button ' + target + ' class="record collection-row"><span class="collection-icon">' +
    (table === 'companies' ? icon('building', 19) : icon('users', 19)) + '</span>' +
    '<span class="collection-row-copy"><strong>' + esc(row.name) + '</strong><small>' +
    esc(summary(row, table)) + '</small></span>' + icon('chevron', 18) + '</button>';
}
function emptyState(title, description, table) {
  return '<div class="content-empty"><span class="empty-icon">' +
    icon(table === 'deals' ? 'chart' : table === 'contacts' ? 'users' : 'building', 25) +
    '</span><strong>' + title + '</strong><p>' + description + '</p>' +
    (table ? '<button type="button" class="text-link" data-new="' + table + '">' +
      icon('plus', 16) + ' Adicionar ' + singular[table] + '</button>' : '') + '</div>';
}
function sectionHeading(kicker, title, target, linkText) {
  return '<div class="section-heading"><div>' +
    (kicker ? '<p class="section-kicker">' + kicker + '</p>' : '') +
    '<h2>' + title + '</h2></div>' +
    (target ? '<button class="text-link" type="button" data-go="' + target + '">' +
      linkText + ' ' + icon('arrow', 16) + '</button>' : '') + '</div>';
}
function renderRows() {
  if (page === 'deals' && boardView !== 'deals') {
    renderPortfolio($('#rows'));
    return;
  }
  const term = normalizeSearch(search);
  const rows = page === 'deals' ? data.deals.filter(row => !term || normalizeSearch(
    [row.name, row.stage, row.next_action, summary(row, page)].join(' ')).includes(term)) : directoryRows();
  const target = $('#rows');
  if (page === 'deals') {
    const today = localCalendarDay();
    const counts = { all: rows.length, overdue: 0, today: 0, unscheduled: 0, future: 0 };
    const byStage = new Map(data.stages.map(stage => [stage, []]));
    for (const row of rows) {
      const status = followUpStatus(row, today);
      if (status !== 'closed') counts[status]++;
      if (pipelineFocus === 'all' || pipelineFocus === status) byStage.get(row.stage)?.push({ row, status });
    }
    renderPipelineFilters(target, counts);
    target.innerHTML = data.stages.map(stage => {
      const current = byStage.get(stage).sort((a, b) => followUpOrder[a.status] - followUpOrder[b.status] ||
        String(a.row.follow_up_on || '').localeCompare(String(b.row.follow_up_on || '')) || b.row.id - a.row.id);
      const total = current.reduce((sum, item) => sum + Number(item.row.amount || 0), 0);
      return '<article class="stage-column" data-stage="' + esc(stage) + '"><div class="stage-column-header"><div class="stage-column-title">' +
        '<span class="stage-dot ' + stageTone(stage) + '"></span><h2>' + esc(stage) +
        '</h2><span class="stage-count">' + current.length + '</span></div><small>' + money(total) +
        '</small></div><div class="stage-column-body">' +
        (current.map(({ row, status }) => recordButton(row, 'deals', 'deal', status)).join('') ||
          '<p class="stage-empty">' + (search || pipelineFocus !== 'all' ? 'Nenhum resultado nesta etapa.' : 'Nenhum negócio nesta etapa.') +
          '</p>') + '</div></article>';
    }).join('');
    return;
  }
  directoryPage = Math.max(1, Math.min(directoryPage, Math.ceil(rows.length / directoryPageSize)));
  const start = (directoryPage - 1) * directoryPageSize;
  const end = Math.min(start + directoryPageSize, rows.length);
  const filtered = Boolean(search.trim() || directoryFilter);
  target.innerHTML = '<article class="collection-card" tabindex="-1" aria-label="' + pages[page] + '">' +
    sectionHeading('', pages[page] + ' <span class="collection-count">' +
      rows.length.toLocaleString('pt-BR') + '</span>') +
    (rows.slice(start, end).map(row => recordButton(row, page)).join('') ||
      emptyState(filtered ? 'Nenhum resultado encontrado' : 'Sua base começa aqui',
        filtered ? 'Ajuste o filtro ou tente outra busca.' : 'Cadastre o primeiro registro para começar.', filtered ? '' : page)) +
    directoryPager(start, end, rows.length) + '</article>';
}
function drawHome() {
  const open = data.deals.filter(row => !['Ganho', 'Perdido'].includes(row.stage));
  const pipelineValue = open.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const metrics = [
    ['building', 'Empresas', data.companies.length, 'na sua base'],
    ['users', 'Contatos', data.contacts.length, 'cadastrados'],
    ['chart', 'Negócios em aberto', open.length, 'em negociação'],
    ['wallet', 'Valor em aberto', money(pipelineValue), 'em negociação']
  ];
  const largestStage = Math.max(1, ...data.stages.map(stage =>
    data.deals.filter(row => row.stage === stage).length));
  const bars = data.stages.map(stage => {
    const amount = data.deals.filter(row => row.stage === stage).length;
    const width = Math.round(amount / largestStage * 100);
    return '<div class="pipeline-row"><span class="pipeline-label">' +
      '<span class="stage-dot ' + stageTone(stage) + '"></span>' + esc(stage) +
      '</span><div class="pipeline-track" aria-hidden="true"><span class="pipeline-fill ' +
      stageTone(stage) + '" style="width:' + width + '%"></span></div>' +
      '<strong class="pipeline-number" aria-label="' + amount + (amount === 1 ? ' negócio' : ' negócios') + '">' +
      amount + '</strong></div>';
  }).join('');
  const recent = data.deals.slice(0, 4);
  const companies = data.companies.slice(0, 4);
  $('#content').innerHTML =
    '<section class="metrics" aria-label="Indicadores do CRM">' +
    metrics.map(([glyph, label, number, detail], index) =>
      '<article class="metric-card metric-' + index + '"><div class="metric-top"><span class="metric-label">' +
      label + '</span><span class="metric-icon">' + icon(glyph, 21) + '</span></div>' +
      '<strong class="metric-number">' + number + '</strong><span class="metric-detail">' +
      detail + '</span></article>').join('') +
    '</section><div class="dashboard-grid"><article class="dashboard-card pipeline-panel">' +
    sectionHeading('', 'Oportunidades por etapa', 'deals', 'Abrir funil') +
    '<div class="pipeline-bars">' + bars + '</div><div class="panel-footnote">' +
    '<span class="footnote-dot"></span>' + data.deals.length + ' ' +
    (data.deals.length === 1 ? 'negócio cadastrado' : 'negócios cadastrados') +
    '</div></article><article class="dashboard-card recent-panel">' +
    sectionHeading('', 'Negócios recentes', 'deals', 'Ver todos') +
    '<div class="recent-list">' +
    (recent.map(row => recordButton(row, 'deals', 'recent')).join('') ||
      emptyState('Nenhum negócio ainda', 'Crie uma oportunidade para acompanhar seu funil.', 'deals')) +
    '</div></article></div><article class="dashboard-card companies-panel">' +
    sectionHeading('', 'Empresas cadastradas', 'companies', 'Ver empresas') +
    '<div class="company-list">' +
    (companies.map(row => recordButton(row, 'companies', 'company')).join('') ||
      emptyState('Nenhuma empresa cadastrada', 'Adicione empresas para construir sua base.', 'companies')) +
    '</div></article>';
}
function draw() {
  $('nav').innerHTML = Object.entries(pages).map(([key, title]) =>
    '<button type="button" data-page="' + key + '" aria-current="' +
    (page === key ? 'page' : 'false') + '"><span class="nav-icon">' +
    navIcon(key) + '</span><span>' + title + '</span></button>').join('');
  const title = $('#page-title') || $('.heading h1');
  title.textContent = pages[page];
  const breadcrumb = $('#breadcrumb');
  if (breadcrumb) breadcrumb.textContent = pages[page];
  const eyebrow = $('#eyebrow');
  if (eyebrow) eyebrow.textContent = page === 'home' ?
    new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(new Date()) : '';
  $('#subtitle').textContent = ({
    home: 'Acompanhe o funil e os negócios mais recentes.',
    companies: 'Organize as empresas com quem você se relaciona.',
    contacts: 'Consulte telefones, e-mails e empresas vinculadas.',
    deals: 'Acompanhe cada oportunidade até o fechamento.',
    automations: 'Defina o que acontece quando um negócio é criado ou muda de etapa.',
    integrations: 'Configure as conexões com Kommo e MeEventos.'
  })[page];
  $('#create').innerHTML = icon('plus', 18) + '<span>' +
    (page === 'companies' ? 'Nova empresa' : page === 'contacts' ? 'Novo contato' : 'Novo negócio') +
    '</span>';
  $('#create').hidden = ['integrations','automations'].includes(page);
  $('#alert').textContent = '';
  $('#content').className = page === 'home' ? 'dashboard-view' :
    page === 'integrations' ? 'integrations-view' : 'records-view';
  document.title = pages[page] + ' | CRM Apito de Mestre';
  if (page === 'automations') { drawAutomations(); return; }
  if (page === 'integrations') { drawIntegrations(); return; }
  if (page === 'home') { drawHome(); return; }
  $('#content').innerHTML = '<div class="records-toolbar"><label class="search-box">' +
    icon('search', 19) + '<span class="sr-only">Buscar ' + pages[page].toLowerCase() +
    '</span><input id="search" type="search" placeholder="Buscar ' +
    pages[page].toLowerCase() + '"></label><span class="records-hint">' +
    data[page].length + ' ' + (data[page].length === 1 ? 'registro' : 'registros') +
    ' na sua base</span></div><div id="rows" class="' +
    (page === 'deals' ? 'board' : 'list') + '"></div>';
  if (page === 'deals') {
    $('.records-toolbar').insertAdjacentHTML('beforebegin', boardControls());
    $('#rows').classList.toggle('portfolio', boardView !== 'deals');
    $('#search').placeholder = boardView === 'contacts' ? 'Buscar nome, empresa, e-mail ou telefone' :
      boardView === 'companies' ? 'Buscar empresa, cidade ou domínio' : 'Buscar negócio';
    $('.records-hint').textContent = boardView === 'companies' ? 'Histórico dos contatos vinculados' :
      boardView === 'contacts' ? 'Histórico comercial por contato' : 'Acompanhamento dos negócios';
    if (boardView !== 'deals' && data.historyUnavailable) $('#alert').textContent =
      'O histórico importado está indisponível. O quadro considera apenas os negócios deste CRM.';
  }
  if (directoryFilters[page]) mountDirectoryFilter();
  $('#search').value = search;
  $('#search').oninput = event => { search = event.target.value; directoryPage = 1; boardPages.clear(); renderRows(); };
  renderRows();
}
function changePage(next) {
  if (!pages[next]) return;
  page = next;
  directoryPage = 1;
  directoryFilter = '';
  boardPages.clear();
  search = '';
  draw();
  window.scrollTo(0, 0);
}
async function drawIntegrations() {
  $('#content').innerHTML = '<p class="loading-state">Carregando integrações...</p>';
  try {
    const response = await apiFetch('/api/integrations');
    if (!response.ok) throw Error('Não foi possível carregar as integrações.');
    const settings = await response.json();
    if (page !== 'integrations') return;
    $('#content').innerHTML = '<div class="integration-grid">' +
      [
        ['kommo', 'Kommo', 'CRM e contatos',
          'Subdomínio da conta, como https://suaempresa.kommo.com',
          'Token de longa duração da integração privada'],
        ['meeventos', 'Meeventos', 'Eventos e clientes',
          'URL HTTPS do seu sistema Meeventos', 'API Token da Loja de Apps']
      ].map(([id, title, category, placeholder, hint]) => {
        const connected = settings[id].connected;
        return '<article class="integration-card"><div class="integration-heading">' +
          '<span class="integration-logo ' + id + '">' + title[0] + '</span>' +
          '<div class="integration-name"><small>' + category + '</small><h2>' + title + '</h2></div>' +
          '<span class="status ' + (connected ? 'is-connected' : '') + '">' +
          (connected ? 'Configurada' : 'Não conectada') + '</span></div>' +
          '<p class="integration-description">' + hint + '</p>' +
          '<form data-integration="' + id + '"><label>Endereço da conta' +
          '<input name="baseUrl" type="url" required placeholder="' + placeholder +
          '" value="' + esc(settings[id].baseUrl) + '"></label>' +
          '<label>Token de acesso<input name="token" type="password" autocomplete="off" placeholder="' +
          (connected ? 'Deixe vazio para manter o token' : 'Cole o token aqui') +
          '"></label><div class="integration-actions"><button type="button" data-test="' + id +
          '">Testar conexão</button><button type="submit">Salvar conexão</button>' +
          (connected ? '<button type="button" data-preview="' + id + '">Consultar dados</button>' : '') +
          '</div></form><p class="integration-feedback" role="status"></p>' +
          (id === 'kommo' ? '<div id="kommo-import-panel"></div>' : '') +
          '<div class="integration-preview"></div></article>';
      }).join('') + '</div>';
    if (settings.kommo.connected) KommoImport.mount($('#kommo-import-panel'));
  } catch (error) {
    if (page === 'integrations') $('#content').innerHTML =
      '<p class="loading-state" role="alert">' + esc(error.message) + '</p>';
  }
}
async function integrationRequest(formElement, card, action) {
  const provider = formElement.dataset.integration;
  const feedback = card.querySelector('.integration-feedback');
  const buttons = formElement.querySelectorAll('button');
  buttons.forEach(button => button.disabled = true);
  feedback.textContent = 'Verificando conexão...';
  try {
    const response = await apiFetch('/api/integrations/' + provider +
      (action === 'test' ? '/test' : ''), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(formElement)))
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    feedback.textContent = action === 'test' ?
      'Conexão válida. Salve para ativar.' : 'Conexão salva.';
    if (action === 'save') {
      formElement.elements.token.value = '';
      const status = card.querySelector('.status');
      status.textContent = 'Configurada';
      status.classList.add('is-connected');
      if (!card.querySelector('[data-preview]')) {
        formElement.querySelector('.integration-actions').insertAdjacentHTML('beforeend',
          '<button type="button" data-preview="' + provider + '">Consultar dados</button>');
      }
      if (provider === 'kommo') KommoImport.mount($('#kommo-import-panel'));
      await showPreview(provider, card);
    }
  } catch (error) {
    feedback.textContent = error.message || 'Falha na conexão.';
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
}
async function showPreview(provider, card) {
  const feedback = card.querySelector('.integration-feedback');
  feedback.textContent = 'Consultando dados...';
  try {
    const response = await apiFetch('/api/integrations/' + provider + '/preview');
    const list = await response.json();
    if (!response.ok) throw Error(list.error);
    card.querySelector('.integration-preview').innerHTML =
      Object.entries(list).map(([label, rows]) =>
        '<h3>' + ({ contacts: 'Contatos', leads: 'Negócios', clients: 'Clientes',
          events: 'Eventos' }[label] || esc(label)) + '</h3>' +
        (rows.length ? '<ul>' + rows.map(row => '<li>' + esc(row.name) +
          ' <small>#' + esc(row.id) + '</small></li>').join('') + '</ul>' :
          '<p>Nenhum registro encontrado.</p>')).join('');
    feedback.textContent = 'Dados atualizados.';
  } catch (error) {
    feedback.textContent = error.message || 'Falha na consulta.';
  }
}
function form(table, id, trail = [], initial = {}) {
  const row = data[table].find(item => item.id === id) || initial;
  editing = { table, id };
  $('#modalTitle').textContent = (id ? 'Editar ' : table === 'companies' ? 'Nova ' : 'Novo ') +
    singular[table];
  $('#fields').innerHTML = keys[table].map(key => {
    let input;
    if (key === 'contact' || key === 'company') {
      input = '<select name="' + key + '"></select>';
    } else if (key === 'stage') {
      input = '<select name="stage">' + data.stages.map(stage =>
        '<option ' + (stage === row.stage ? 'selected' : '') + '>' + esc(stage) + '</option>'
      ).join('') + '</select>';
    } else if (key === 'notes') {
      input = '<textarea name="notes">' + esc(row.notes) + '</textarea>';
    } else if (key === 'next_action') {
      input = '<input name="next_action" maxlength="200" value="' + esc(row.next_action) + '">';
    } else if (key === 'follow_up_on') {
      input = '<input type="date" name="follow_up_on" min="0001-01-01" max="9999-12-31" value="' + esc(row.follow_up_on) + '">';
    } else {
      input = '<input name="' + key + '" ' +
        (key === 'name' ? 'required maxlength="200"' : '') + ' type="' +
        (key === 'amount' ? 'number' : key === 'email' ? 'email' :
          key === 'phone' ? 'tel' : 'text') + '" ' +
        (key === 'amount' ? 'min="0" step="0.01"' : '') +
        ' value="' + esc(row[key]) + '">';
    }
    return '<label>' + labels[key] + input + '</label>';
  }).join('');
  if (table === 'contacts') mountLinkPicker('company', row.company);
  if (table === 'deals') mountLinkPicker('contact', row.contact);
  if (table === 'deals') {
    const contactSelect = $('#fields select[name="contact"]');
    const details = document.createElement('section');
    details.className = 'linked-contact';
    contactSelect.closest('label').after(details);
    function showContact() {
      const contact = data.contacts.find(item => String(item.id) === contactSelect.value);
      const entries = contact ? [
        ['Empresa', linked('companies', contact.company)], ['E-mail', contact.email], ['Telefone', contact.phone]
      ] : [];
      details.innerHTML = contact
        ? '<h3>' + esc(contact.name) + '</h3><dl>' + entries.map(([label, value]) =>
          '<div><dt>' + label + '</dt><dd>' + esc(value || 'Não informado') + '</dd></div>').join('') + '</dl>'
        : '<p>Selecione um contato para ver os dados dele aqui.</p>';
    }
    contactSelect.onchange = showContact;
    showContact();
    if (id) $('#modalTitle').textContent = row.name;
  }
  $('#error').textContent = '';
  RecordRelationships.mount(table, row, data, trail, form);
  if (page === 'deals' && table === 'contacts' && id) {
    const editor = $('dialog form');
    const original = new URLSearchParams(new FormData(editor)).toString();
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'rel-action';
    create.textContent = 'Criar negócio para este contato';
    create.onclick = () => {
      if (new URLSearchParams(new FormData(editor)).toString() !== original &&
          !window.confirm('Descartar as alterações da ficha e abrir um novo negócio?')) return;
      form('deals', undefined, [], {name: row.name, contact: id, stage: data.stages[0]});
    };
    $('#fields .rel-actions').after(create);
  }
  const dialog = $('dialog');
  if (dialog.open) {
    dialog.scrollTop = 0;
    const title = $('#modalTitle');
    title.tabIndex = -1;
    title.focus();
  } else {
    dialog.showModal();
  }
}
async function refresh() {
  const response = await apiFetch('/api/crm');
  if (!response.ok) throw Error('Falha ao carregar o CRM.');
  const records = await response.json();
  const historyResponse = await apiFetch('/api/commercial-history');
  if (historyResponse.ok) {
    const groups = new Map((await historyResponse.json()).map(person => [person.id, person]));
    for (const person of records.contacts) Object.assign(person, groups.get(person.id));
  }
  records.historyUnavailable = !historyResponse.ok;
  data = records;
  directory = buildDirectory(data);
  directory.portfolio = portfolioRanks(data);
  draw();
  KommoImport.resume();
}
$('nav').onclick = event => {
  const button = event.target.closest('[data-page]');
  if (button) changePage(button.dataset.page);
};
$('#create').onclick = () => { if (data) form(page === 'home' ? 'deals' : page); };
const movesInProgress = new Set();
let gesture = null;
function endGesture() {
  if (!gesture) return;
  gesture.card.classList.remove('dragging');
  gesture.column?.classList.remove('drop-target');
  gesture = null;
}
const content = $('#content');
content.addEventListener('pointerdown', event => {
  const card = event.target.closest('.deal-card');
  if (!card || !event.isPrimary || event.button !== 0 || movesInProgress.has(Number(card.dataset.id))) return;
  gesture = { card, pointer: event.pointerId, x: event.clientX, y: event.clientY, moving: false, column: null };
  card.setPointerCapture(event.pointerId);
});
function dropColumn(event) {
  return document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-stage]');
}
content.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if (!gesture.moving && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 7) return;
  gesture.moving = true;
  gesture.card.classList.add('dragging');
  const board = gesture.card.closest('.board');
  const bounds = board.getBoundingClientRect();
  if (event.clientX > bounds.right - 40) board.scrollLeft += 28;
  if (event.clientX < bounds.left + 40) board.scrollLeft -= 28;
  gesture.column?.classList.remove('drop-target');
  gesture.column = dropColumn(event);
  gesture.column?.classList.add('drop-target');
});
content.addEventListener('lostpointercapture', endGesture);
content.addEventListener('pointercancel', endGesture);
content.addEventListener('pointerup', async event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const { card, moving } = gesture;
  const column = dropColumn(event);
  endGesture();
  if (!moving) return;
  // The browser dispatches a click immediately after pointerup, including after a drag.
  const suppress = click => { click.preventDefault(); click.stopImmediatePropagation(); };
  card.addEventListener('click', suppress, { once: true, capture: true });
  setTimeout(() => card.removeEventListener('click', suppress, true), 0);
  if (!column) return;
  const deal = data.deals.find(item => item.id === Number(card.dataset.id));
  const stage = column.dataset.stage;
  if (!deal || deal.stage === stage || movesInProgress.has(deal.id)) return;
  movesInProgress.add(deal.id);
  $('#alert').textContent = '';
  try {
    const res = await apiFetch('/api/deals/' + deal.id, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
    if (!res.ok) throw Error((await res.json()).error || 'Não foi possível mover o negócio.');
    await refresh();
  } catch (error) {
    $('#alert').textContent = error.message;
  } finally { movesInProgress.delete(deal.id); }
});
$('#content').addEventListener('click', async event => {
  const view = event.target.closest('[data-board-view]');
  if (view) {
    boardView = view.dataset.boardView;
    boardPages.clear();
    search = '';
    draw();
    $('#content [aria-pressed="true"]')?.focus({preventScroll:true});
    return;
  }
  const pager = event.target.closest('[data-page-number]');
  if (pager) {
    const column = Number(pager.dataset.column);
    boardPages.set(column, Number(pager.dataset.pageNumber));
    renderRows();
    $('#rows [data-column="' + column + '"]:not(:disabled)')?.focus({preventScroll:true});
    return;
  }
  const step = event.target.closest('[data-directory-step]');
  if (step && directoryFilters[page]) {
    directoryPage += Number(step.dataset.directoryStep);
    renderRows();
    const collection = $('.collection-card');
    collection.focus({ preventScroll: true });
    collection.scrollIntoView({ block: 'start' });
    return;
  }
  const link = event.target.closest('[data-go]');
  if (link) {
    if (link.dataset.go === 'deals') boardView = 'deals';
    changePage(link.dataset.go);
    return;
  }
  const add = event.target.closest('[data-new]');
  if (add) { form(add.dataset.new); return; }
  const preview = event.target.closest('[data-preview]');
  if (preview) {
    await showPreview(preview.dataset.preview, preview.closest('.integration-card'));
    return;
  }
  const test = event.target.closest('[data-test]');
  if (test) {
    await integrationRequest(test.closest('form'), test.closest('.integration-card'), 'test');
    return;
  }
  const record = event.target.closest('[data-id]');
  if (record) form(record.dataset.table, Number(record.dataset.id));
});
$('#content').addEventListener('submit', async event => {
  if (!event.target.matches('[data-integration]')) return;
  event.preventDefault();
  await integrationRequest(event.target, event.target.closest('.integration-card'), 'save');
});
$('#cancel').onclick = () => $('dialog').close();
$('dialog form').onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const { table, id } = editing;
    const response = await apiFetch('/api/' + table + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
    });
    if (!response.ok) throw Error((await response.json()).error);
    if (page === 'deals' && table === 'deals' && !id) {
      boardView = 'deals';
      pipelineFocus = 'all';
      search = '';
    }
    $('dialog').close();
    await refresh();
  } catch (error) {
    ($('dialog').open ? $('#error') : $('#alert')).textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
start();

async function drawAutomations(notice = '') {
  const root = $('#content');
  root.innerHTML = '<p role="status">Carregando automações…</p>';
  async function request(method, body) {
    const response = await apiFetch('/api/automations', {
      method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Não foi possível atualizar as automações.');
    return result;
  }
  try {
    const state = await request('GET');
    if (page !== 'automations') return;
    const eventLabel = event => event === 'created' ? 'Ao criar um negócio' : 'Ao entrar em ' + event;
    function renderRule(rule) {
      const email = rule.action === 'email';
      return `<article class="automation-rule">
        <div class="automation-rule-heading"><h3>${esc(rule.name)}</h3><span class="rule-state ${rule.enabled ? 'active' : ''}">${rule.enabled ? 'Ativa' : 'Pausada'}</span></div>
        <p class="rule-event">${esc(eventLabel(rule.event))}</p>
        <dl><dt>${email ? 'Enviar email ao contato' : 'Definir próxima ação'}</dt>
        <dd>${email ? '<strong>'+esc(rule.subject)+'</strong><br>' : ''}${esc(rule.message)}</dd></dl>
        <div class="rule-actions"><button type="button" data-edit-rule="${rule.id}">Editar</button>
        <button type="button" data-toggle-rule="${rule.id}">${rule.enabled ? 'Pausar' : 'Ativar'}</button></div>
      </article>`;
    }
    root.innerHTML = `<div class="automation-layout">
      <section class="automation-rules"><h2>Regras do funil</h2>
      <p class="automation-feedback" role="status">${esc(notice)}</p>
      ${state.rules.map(renderRule).join('') || '<p>Nenhuma regra criada.</p>'}</section>
      <section class="automation-editor"><h2 data-editor-title>Nova automação</h2>
        <form>
          <label>Nome da regra<input name="name" required maxlength="120" placeholder="Ex.: Acompanhar proposta"></label>
          <label>Gatilho<select name="event">${['created', ...data.stages].map(event =>
            '<option value="'+esc(event)+'">'+esc(eventLabel(event))+'</option>').join('')}</select></label>
          <label>Ação<select name="action"><option value="followup">Definir próxima ação no negócio</option><option value="email">Enviar email ao contato</option></select></label>
          <p data-smtp-warning hidden>Configure o SMTP da Hostinger para habilitar o envio de emails.</p>
          <label hidden>Assunto<input name="subject" maxlength="200"></label>
          <label><span data-message-label>Próxima ação</span><textarea name="message" required maxlength="200" rows="4" aria-describedby="rule-variables"></textarea></label>
          <small id="rule-variables">Use {{negocio}} e {{contato}} para inserir os nomes do negócio e do contato.</small>
          <div class="rule-actions"><button type="submit">Criar regra</button><button type="button" data-reset-rule hidden>Cancelar edição</button></div>
        </form>
      </section>
      <section class="automation-history"><h2>Execuções recentes</h2>
        ${state.runs.map(run => '<article><strong>'+esc(run.name)+'</strong><p>Negócio #'+esc(run.deal_id)+' · '+esc(run.status)+'</p><small>'+esc(new Date(run.created_at).toLocaleString('pt-BR'))+'</small></article>').join('') ||
          '<p>O histórico aparece quando um negócio acionar uma regra.</p>'}
      </section>
    </div>`;
    const form = root.querySelector('form');
    const submit = form.querySelector('[type="submit"]');
    const cancel = form.querySelector('[data-reset-rule]');
    let editedId = null;
    function showAction() {
      const email = form.elements.action.value === 'email';
      form.elements.subject.closest('label').hidden = !email;
      form.elements.subject.required = email;
      form.elements.message.maxLength = email ? 8000 : 200;
      form.querySelector('[data-message-label]').textContent = email ? 'Mensagem' : 'Próxima ação';
      form.querySelector('[data-smtp-warning]').hidden = !email || state.configured;
    }
    function editRule(rule) {
      editedId = rule?.id ?? null;
      form.reset();
      if (rule) {
        for (const field of ['name','event','action','subject','message']) form.elements[field].value = rule[field];
      }
      showAction();
      root.querySelector('[data-editor-title]').textContent = rule ? 'Editar automação' : 'Nova automação';
      submit.textContent = rule ? 'Salvar alterações' : 'Criar regra';
      cancel.hidden = !rule;
      form.elements.name.focus();
    }
    async function save(button,method,body,confirmation) {
      button.disabled = true;
      $('#alert').textContent = '';
      try {
        await request(method,body);
        if (page === 'automations') await drawAutomations(confirmation);
      } catch (error) {
        button.disabled = false;
        if (page === 'automations') $('#alert').textContent = error.message;
      }
    }
    form.elements.action.onchange = showAction;
    cancel.onclick = () => editRule(null);
    form.onsubmit = event => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      if (body.action === 'followup') body.subject = 'Próxima ação';
      if (editedId !== null) body.id = editedId;
      save(submit, editedId === null ? 'POST' : 'PUT', body, editedId === null ? 'Regra criada.' : 'Alterações salvas.');
    };
    root.querySelectorAll('[data-edit-rule]').forEach(button => {
      button.onclick = () => editRule(state.rules.find(rule => rule.id === Number(button.dataset.editRule)));
    });
    root.querySelectorAll('[data-toggle-rule]').forEach(button => {
      button.onclick = () => {
        const rule = state.rules.find(item => item.id === Number(button.dataset.toggleRule));
        save(button, 'PATCH', {id:rule.id, enabled:!rule.enabled}, rule.enabled ? 'Regra pausada.' : 'Regra ativada.');
      };
    });
  } catch (error) {
    if (page === 'automations') root.textContent = error.message;
  }
}
