/* Rascunho salvo no banco por usuario, com feedback de estado; nunca confirma operacoes. */
(function () {
  'use strict';
  const form = document.querySelector('form[data-rascunho]');
  if (!form) return;
  const tipo = form.dataset.rascunho;
  const url = '/rascunhos/' + encodeURIComponent(tipo) + '/novo';
  const estado = document.createElement('span');
  estado.setAttribute('role', 'status');
  estado.style.cssText = 'font-size:.82rem;opacity:.75;display:inline-block;margin:8px';
  estado.textContent = 'Carregando rascunho...';
  form.prepend(estado);
  let carregado = false, pendente = false, timer, salvando = false;
  const campos = () => Array.from(form.querySelectorAll('input[name],select[name],textarea[name]'))
    .filter(el => !['password','file','hidden'].includes(el.type) && !el.disabled);
  function ler() {
    const contagem = {};
    const valores = {};
    for (const el of campos()) {
      const indice = contagem[el.name] || 0;
      contagem[el.name] = indice + 1;
      const k = el.name + '#' + indice;
      valores[k] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    }
    return valores;
  }
  function preencher(valores) {
    const contagem = {};
    for (const el of campos()) {
      const indice = contagem[el.name] || 0;
      contagem[el.name] = indice + 1;
      const valor = valores[el.name + '#' + indice];
      if (valor === undefined) continue;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = Boolean(valor);
      else el.value = String(valor);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  async function salvar() {
    if (!carregado || salvando || !pendente) return;
    salvando = true; pendente = false; estado.textContent = 'Salvando...';
    try {
      const resp = await fetch(url, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ dados: ler() })
      });
      if (!resp.ok) throw new Error('Falha ao salvar');
      estado.textContent = 'Rascunho salvo automaticamente';
    } catch (_) { estado.textContent = 'Sem conexão: alterações ainda não salvas'; pendente = true; }
    finally { salvando = false; if (pendente) agendar(); }
  }
  function agendar() { clearTimeout(timer); timer = setTimeout(salvar, 1600); }
  form.addEventListener('input', () => { if (carregado) { pendente = true; agendar(); } });
  form.addEventListener('change', () => { if (carregado) { pendente = true; agendar(); } });
  form.addEventListener('submit', () => {
    clearTimeout(timer);
    // Documento real so e criado pela rota POST de negocio, nunca pelo autosave.
    // O rascunho fica recuperavel ate a conclusao confirmada pelo servidor.
  });
  fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(r => {
      if (r.rascunho?.dados && Object.keys(r.rascunho.dados).length) {
        if (confirm('Encontramos um rascunho salvo. Deseja continuar de onde parou?')) preencher(r.rascunho.dados);
      }
      estado.textContent = 'Salvamento automático ativo';
    })
    .catch(() => { estado.textContent = 'Salvamento indisponível'; })
    .finally(() => { carregado = true; });
})();
