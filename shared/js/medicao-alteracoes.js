// JBRETAS SISTEMA — shared/js/medicao-alteracoes.js
// Faixa âmbar + lista das alterações campo a campo da medição (audit_log
// UPDATE_CAMPO), via GET /medicao-alteracoes?dias=N. Compartilhado por
// logistica (desktop) e logistica-mobile — sem fork. Montado por
// window.medicaoAlteracoes.montar(host): cria a faixa no TOPO do host; o botão
// "Ver" abre um modal com a lista (seletor 3/7/15 dias + copiar p/ WhatsApp).
// Copiar reaproveita window.jbCopiar (shared/js/clipboard.js).
(function () {
  'use strict';

  let _host = null, _faixa = null, _modal = null;
  let _dias = 3, _cache = null;

  const PERIODOS = [3, 7, 15];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Número com separador de milhar; vazio → null (o chamador decide o travessão).
  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR');
  }
  // ISO 'YYYY-MM-DD' → 'DD/MM' (o dia da medição). Devolve como veio se não casar.
  function fmtDia(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (m[3] + '/' + m[2]) : (iso || '—');
  }

  async function montar(host) {
    if (!host) return;
    _host = host;
    if (!_faixa) {
      _faixa = document.createElement('div');
      _faixa.className = 'malt-faixa';
      _faixa.style.display = 'none';
      host.insertBefore(_faixa, host.firstChild);   // no TOPO da aba Medição
    }
    await carregar();
  }

  // Busca as alterações do período e atualiza a faixa (e a lista, se aberta).
  async function carregar() {
    try {
      _cache = await apiFetch('/medicao-alteracoes?dias=' + _dias);
    } catch (e) {
      _cache = null;
      if (_faixa) _faixa.style.display = 'none';   // faixa é acessório: falha silenciosa
      console.warn('medicao-alteracoes: falha ao carregar:', e && e.message);
      return;
    }
    renderFaixa();
    if (_modal && _modal.classList.contains('aberto')) renderLista();
  }

  function renderFaixa() {
    if (!_faixa) return;
    const n = (_cache && _cache.alteracoes) ? _cache.alteracoes.length : 0;
    if (!n) { _faixa.style.display = 'none'; return; }
    _faixa.style.display = '';
    const plural = n === 1 ? 'alteração' : 'alterações';
    const mais = (_cache && _cache.truncado) ? '+' : '';
    _faixa.innerHTML =
      '<span class="malt-faixa-txt">✏️ ' + n + mais + ' ' + plural +
        ' em medições dos últimos ' + _dias + ' dias</span>' +
      '<button type="button" class="malt-faixa-btn" id="malt-ver">Ver</button>';
    _faixa.querySelector('#malt-ver').addEventListener('click', abrir);
  }

  // ── Modal com a lista ─────────────────────────────────────────────────────
  function abrir() {
    if (!_modal) {
      _modal = document.createElement('div');
      _modal.className = 'malt-modal';
      _modal.innerHTML =
        '<div class="malt-sheet">' +
          '<div class="malt-head">' +
            '<span class="malt-title">✏️ Alterações de medição</span>' +
            '<div class="malt-periodos" id="malt-periodos"></div>' +
            '<button type="button" class="malt-copiar" id="malt-copiar">📋 Copiar p/ WhatsApp</button>' +
            '<button type="button" class="malt-x" id="malt-x" aria-label="Fechar">✕</button>' +
          '</div>' +
          '<div class="malt-body" id="malt-lista"></div>' +
        '</div>';
      document.body.appendChild(_modal);
      // Fecha ao clicar fora do sheet ou no ✕.
      _modal.addEventListener('click', e => { if (e.target === _modal) fechar(); });
      _modal.querySelector('#malt-x').addEventListener('click', fechar);
      _modal.querySelector('#malt-copiar').addEventListener('click', e => window.jbCopiar(textoWhatsApp(), e.currentTarget));
      _modal.querySelector('#malt-periodos').innerHTML = PERIODOS.map(d =>
        '<button type="button" class="malt-per" data-d="' + d + '">' + d + ' dias</button>').join('');
      _modal.querySelectorAll('.malt-per').forEach(b => b.addEventListener('click', () => trocarPeriodo(Number(b.getAttribute('data-d')))));
    }
    _modal.classList.add('aberto');
    renderLista();
  }
  function fechar() { if (_modal) _modal.classList.remove('aberto'); }

  async function trocarPeriodo(d) {
    if (d === _dias) return;
    _dias = d;
    await carregar();   // atualiza faixa + lista
  }

  function renderLista() {
    if (!_modal) return;
    _modal.querySelectorAll('.malt-per').forEach(b =>
      b.classList.toggle('on', Number(b.getAttribute('data-d')) === _dias));
    const lista = _modal.querySelector('#malt-lista');
    const alts = (_cache && _cache.alteracoes) || [];
    if (!alts.length) { lista.innerHTML = '<div class="malt-vazio">Sem alterações nos últimos ' + _dias + ' dias.</div>'; return; }
    const aviso = (_cache && _cache.truncado)
      ? '<div class="malt-trunc">Mostrando as 500 mais recentes.</div>' : '';
    let html = aviso + '<div class="malt-wrap"><table class="malt-tbl"><thead><tr>' +
      '<th>Posto</th><th>Comb</th><th>Dia</th><th>Campo</th><th>De</th><th>Para</th><th>Quem</th>' +
      '</tr></thead><tbody>';
    alts.forEach(a => {
      const de = fmtNum(a.valor_antes);
      const para = fmtNum(a.valor_depois);
      html += '<tr>' +
        '<td class="malt-posto" title="' + esc(a.posto) + '">' + esc(a.posto) + '</td>' +
        '<td>' + esc(a.combustivel) + '</td>' +
        '<td class="malt-num">' + esc(fmtDia(a.data)) + '</td>' +
        '<td class="malt-campo">' + esc(a.campo) + '</td>' +
        '<td class="malt-de">' + (de === null ? '<span class="malt-tr">—</span>' : '<s>' + esc(de) + '</s>') + '</td>' +
        '<td class="malt-para">' + (para === null ? '—' : esc(para)) + '</td>' +
        '<td class="malt-quem">' + esc(a.quem) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    lista.innerHTML = html;
  }

  // Texto p/ colar no WhatsApp. Uma linha em branco ENTRE postos. Números com
  // separador de milhar (fmtNum); "de" vazio vira travessão.
  function textoWhatsApp() {
    const alts = (_cache && _cache.alteracoes) || [];
    let txt = '*Alterações de medição — últimos ' + _dias + ' dias*\n';
    let postoAnt = null;
    alts.forEach(a => {
      if (postoAnt !== null && a.posto !== postoAnt) txt += '\n';   // linha em branco entre postos
      const de = fmtNum(a.valor_antes), para = fmtNum(a.valor_depois);
      txt += '\n' + (a.posto || '—') + ' · ' + (a.combustivel || '—') + ' · ' + fmtDia(a.data) +
             '\n' + (a.campo || '?') + ': ' + (de === null ? '—' : de) + ' → ' + (para === null ? '—' : para) +
             ' (' + (a.quem || '—') + ')';
      postoAnt = a.posto;
    });
    return txt.trim();
  }

  window.medicaoAlteracoes = { montar: montar, recarregar: carregar };
})();
