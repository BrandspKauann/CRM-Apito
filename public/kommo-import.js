const KommoImport = (() => {
  const endpoint = '/api/integrations/kommo/sync';
  const storageKey = 'kommo-import-in-progress';
  const streamLabels = {
    account: 'Conta', contacts: 'Contatos', companies: 'Empresas', leads: 'Negócios', tasks: 'Tarefas',
    events: 'Eventos', users: 'Usuários', pipelines: 'Funis', catalogs: 'Catálogos', elements: 'Itens',
    notes: 'Notas', links: 'Vínculos', tags: 'Etiquetas', custom_fields: 'Campos personalizados',
    statuses: 'Etapas', roles: 'Perfis', groups: 'Grupos', sources: 'Origens', customers: 'Clientes',
    loss_reasons: 'Motivos de perda', files: 'Arquivos', talks: 'Conversas', segments: 'Segmentos'
  };
  const streamStates = { pending: 'Aguardando', running: 'Em andamento', retrying: 'Aguardando nova tentativa',
    blocked: 'Acesso bloqueado', error: 'Falha', complete: 'Concluído' };
  const number = new Intl.NumberFormat('pt-BR');
  let snapshot, active = false, generation = 0, notice = '';

  function remember(enabled) {
    try {
      if (enabled) sessionStorage.setItem(storageKey, '1');
      else sessionStorage.removeItem(storageKey);
    } catch { /* A aba ainda pode executar a importação sem armazenamento local. */ }
  }
  function render() {
    const panel = document.querySelector('#kommo-import-panel');
    const button = panel?.querySelector('[data-import-action]');
    if (!button) return;
    const streams = snapshot?.streams || [];
    const state = snapshot?.status;
    const total = streams.reduce((sum, stream) => sum + Number(stream.rows_seen || 0), 0);
    const completed = streams.filter(stream => stream.status === 'complete').length;
    const summary = panel.querySelector('[data-import-summary]');
    const statuses = { idle: 'Pronto para importar.', running: active ? 'Importação em andamento.' : 'Importação disponível para continuar.',
      partial: 'Importação parcial. Consulte as pendências por recurso.', complete: 'Importação concluída.' };
    summary.textContent = notice || statuses[state] || 'Consultando importação…';
    button.disabled = active || state === 'complete';
    button.textContent = active ? 'Aguarde…' : state === 'partial' ? 'Tentar recursos pendentes' :
      state === 'running' ? 'Continuar importação' : state === 'complete' ? 'Importação concluída' :
      state === 'idle' ? 'Iniciar importação' : 'Atualizar status';
    const details = panel.querySelector('details');
    details.hidden = streams.length === 0;
    details.querySelector('summary').textContent = number.format(total) + ' registros lidos · ' +
      completed + ' de ' + streams.length + ' recursos concluídos';
    details.querySelector('tbody').innerHTML = streams.map(item => {
      const label = String(item.stream).split('.').map(part => streamLabels[part] || part.replaceAll('_', ' ')).join(' · ');
      return '<tr><th scope="row">' + esc(label) + '</th><td>' + number.format(Number(item.rows_seen) || 0) + '</td><td>' +
        esc(streamStates[item.status] || item.status) + (item.error ? '<small>' + esc(item.error) + '</small>' : '') + '</td></tr>';
    }).join('');
  }
  async function request(method, retry) {
    const options = { method, cache: 'no-store', signal: AbortSignal.timeout(120000) };
    if (method === 'POST') {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(retry ? { retry: true } : {});
    }
    const response = await apiFetch(endpoint, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.streams) ||
        !['idle','running','complete','partial'].includes(result.status)) {
      const error = new Error(result.error || 'Falha ao consultar a importação.');
      error.transient = response.status === 429 || response.status >= 500;
      throw error;
    }
    return result;
  }
  async function run(write, retry = false) {
    if (active) return;
    const current = generation;
    active = true;
    if (write) remember(true);
    notice = write ? 'Importando para o Neon. Mantenha esta aba aberta.' : 'Consultando importação…';
    render();
    let failures = 0;
    try {
      while (current === generation) {
        let result;
        try {
          result = await request(write ? 'POST' : 'GET', retry);
        } catch (error) {
          if (current !== generation) return;
          const temporary = error.transient || ['TimeoutError','TypeError','AbortError'].includes(error.name);
          if (!write || !temporary || ++failures > 6) throw error;
          // O servidor pode ter salvo o lote antes de uma queda da conexão.
          // Reenvie o avanço normal, sem reabrir recursos em erro outra vez.
          retry = false;
          notice = 'Conexão interrompida. Tentando retomar do último lote salvo…';
          render();
          await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * 2 ** failures)));
          continue;
        }
        if (current !== generation) return;
        snapshot = result;
        failures = 0;
        retry = false;
        notice = '';
        render();
        if (!write || result.status !== 'running') break;
        const wait = Number(result.retryAfterMs) || 0;
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      }
    } catch (error) {
      if (current === generation) notice = error.message || 'Falha na importação.';
    } finally {
      if (current === generation) {
        if (write) remember(false);
        active = false;
        render();
      }
    }
  }
  function mount(panel) {
    panel.innerHTML = '<section class="kommo-import" aria-label="Importação para o Neon"><h3>Importar para o Neon</h3>' +
      '<p id="kommo-import-summary" data-import-summary role="status"></p>' +
      '<details hidden><summary></summary><table><thead><tr><th>Recurso</th><th>Lidos</th><th>Estado</th></tr></thead><tbody></tbody></table></details>' +
      '<div class="integration-actions"><button type="button" data-import-action></button></div></section>';
    panel.querySelector('button').onclick = () => run(Boolean(snapshot), snapshot?.status === 'partial');
    if (active) render();
    else run(false);
  }
  function resume() {
    try { if (sessionStorage.getItem(storageKey)) run(true); }
    catch { /* Armazenamento indisponível neste navegador. */ }
  }
  function endSession() {
    generation++;
    active = false;
    snapshot = undefined;
    notice = '';
    remember(false);
  }
  return { mount, resume, endSession };
})();
