// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/kpi.js
// Aba KPI (sugestão de pedido) do Painel ADM. ADITIVO: expõe
// window.renderKpi(container) — recebe o container, NÃO crava IDs
// globais fora dele (padrão do custo-margem.js / medicao.js).
//
// Fonte: GET /sugestao-pedido?data=&bandeira= (por posto+combustível:
// medição atual, capacidade, venda média, giro, fator do dia, sugestão).
// data/bandeira vão pra API (re-fetch); combustível/ordenar são filtros
// de cliente sobre a resposta. Gráficos em div+CSS (sem biblioteca).
// Roda no desktop (painel-adm, base.css) e no mobile (admin, tokens via
// ponte #s-kpi no admin.css). Depende de api.js (apiFetch).
// ================================================================
(function () {
  let _sec        = null;
  let _shellPronto = false;
  let _resp       = null;     // última resposta da API
  let _bandeiras  = null;     // bandeiras distintas (cache da 1ª carga sem filtro)
  let _combs      = null;     // combustíveis distintos (cache)
  // Filtros
  let _data     = '';         // '' → amanhã (default do input)
  let _bandeira = '';         // vai pra API
  let _fComb    = '';         // filtro de cliente
  let _ordenar  = 'giro';     // giro | sugerido | posto | venda

  // ── Helpers ─────────────────────────────────────────────────────
  function amanhaISO() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  const esc  = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtL = (n) => (n === null || n === undefined) ? '—' : Math.round(Number(n)).toLocaleString('pt-BR');
  const fmt2 = (n) => (n === null || n === undefined) ? '—'
    : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── Shell (filtros + métricas + tabela + gráficos), montado uma vez ─
  function montarShell(sec) {
    sec.innerHTML =
      '<div class="kpi-wrap">' +
        '<div class="kpi-filtros">' +
          '<label class="kpi-f"><span>Entrega</span>' +
            '<input type="date" id="kpi-data" class="kpi-inp"></label>' +
          '<label class="kpi-f"><span>Bandeira</span>' +
            '<select id="kpi-bandeira" class="kpi-inp"></select></label>' +
          '<label class="kpi-f"><span>Combustível</span>' +
            '<select id="kpi-comb" class="kpi-inp"></select></label>' +
          '<label class="kpi-f"><span>Ordenar</span>' +
            '<select id="kpi-ordenar" class="kpi-inp">' +
              '<option value="giro">Giro (menor 1º)</option>' +
              '<option value="sugerido">Sugerido (maior 1º)</option>' +
              '<option value="venda">Venda/dia (maior 1º)</option>' +
              '<option value="posto">Posto (A–Z)</option>' +
            '</select></label>' +
        '</div>' +
        '<div class="kpi-metricas" id="kpi-metricas"></div>' +
        '<div id="kpi-body"><div class="kpi-msg">Carregando…</div></div>' +
      '</div>';

    sec.querySelector('#kpi-data').onchange     = (e) => { _data = e.target.value || ''; carregar(); };
    sec.querySelector('#kpi-bandeira').onchange = (e) => { _bandeira = e.target.value || ''; carregar(); };
    sec.querySelector('#kpi-comb').onchange     = (e) => { _fComb = e.target.value || ''; renderTudo(); };
    sec.querySelector('#kpi-ordenar').onchange  = (e) => { _ordenar = e.target.value || 'giro'; renderTudo(); };
    _shellPronto = true;
  }

  function popularSelects() {
    const selB = _sec.querySelector('#kpi-bandeira');
    const selC = _sec.querySelector('#kpi-comb');
    if (selB && _bandeiras && !selB.dataset.pronto) {
      selB.innerHTML = '<option value="">Todas as bandeiras</option>' +
        _bandeiras.map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join('');
      selB.dataset.pronto = '1';
    }
    if (selB) selB.value = _bandeira;
    if (selC && _combs && !selC.dataset.pronto) {
      selC.innerHTML = '<option value="">Todos</option>' +
        _combs.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
      selC.dataset.pronto = '1';
    }
    if (selC) selC.value = _fComb;
  }

  // ── Carga (GET /sugestao-pedido) ────────────────────────────────
  async function carregar() {
    const body = _sec.querySelector('#kpi-body');
    if (body) body.innerHTML = '<div class="kpi-msg">Carregando…</div>';
    let q = '/sugestao-pedido?data=' + encodeURIComponent(_data || amanhaISO());
    if (_bandeira) q += '&bandeira=' + encodeURIComponent(_bandeira);
    try {
      _resp = await apiFetch(q);
      // Cache das opções na 1ª carga (sem bandeira, cobre a rede toda).
      if (!_bandeira && !_bandeiras) {
        _bandeiras = [...new Set((_resp.itens || []).map(i => i.bandeira).filter(Boolean))].sort();
      }
      if (!_combs) {
        _combs = [...new Set((_resp.itens || []).map(i => i.combustivel).filter(Boolean))].sort();
      }
      popularSelects();
      renderTudo();
    } catch (err) {
      if (body) body.innerHTML = '<div class="kpi-erro">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    }
  }

  // ── Itens filtrados/ordenados (cliente) ─────────────────────────
  function itensView() {
    let arr = (_resp && _resp.itens) ? _resp.itens.slice() : [];
    if (_fComb) arr = arr.filter(i => i.combustivel === _fComb);
    const inf = Number.POSITIVE_INFINITY;
    if (_ordenar === 'giro')          arr.sort((a, b) => (a.giro == null ? inf : a.giro) - (b.giro == null ? inf : b.giro));
    else if (_ordenar === 'sugerido') arr.sort((a, b) => (b.sugestao || 0) - (a.sugestao || 0));
    else if (_ordenar === 'venda')    arr.sort((a, b) => (b.venda_media || 0) - (a.venda_media || 0));
    else if (_ordenar === 'posto')    arr.sort((a, b) => String(a.posto_nome).localeCompare(String(b.posto_nome)));
    return arr;
  }

  function renderTudo() {
    if (!_resp) return;
    renderMetricas();
    const body = _sec.querySelector('#kpi-body');
    if (body) body.innerHTML = renderTabela() + renderGraficos();
  }

  // ── Métricas ────────────────────────────────────────────────────
  function renderMetricas() {
    const el = _sec.querySelector('#kpi-metricas');
    if (!el) return;
    const tot = _resp.totais || {};
    // Fator do dia = o da GASOLINA COMUM (GC) especificamente — média com
    // combustíveis neutralizados dentro não significaria nada.
    const gc = (_resp.fatores || {}).GC || null;
    const gcVal = gc ? fmt2(gc.valor) : '—';
    const gcSub = (_resp.dia_semana || '') + (gc && (gc.base || 0) < 20 ? ' · sem base' : '');
    const cards = [
      { lbl: 'Sugerido total',   val: fmtL(tot.sugerido) + ' L', sub: (_resp.data_entrega || '') },
      { lbl: 'Postos críticos',  val: String(tot.postos_criticos || 0), sub: 'giro < 1 dia', cls: (tot.postos_criticos ? 'kpi-m-crit' : '') },
      { lbl: 'Fator do dia (GC)', val: gcVal, sub: gcSub },
      { lbl: 'Rede 30 dias',     val: fmtL(tot.rede_venda_30d) + ' L', sub: 'total vendido · rede' },
    ];
    el.innerHTML = cards.map(c =>
      '<div class="kpi-card ' + (c.cls || '') + '">' +
        '<div class="kpi-card-lbl">' + esc(c.lbl) + '</div>' +
        '<div class="kpi-card-val">' + c.val + '</div>' +
        '<div class="kpi-card-sub">' + esc(c.sub) + '</div>' +
      '</div>').join('');
  }

  // ── Tabela de sugestão ──────────────────────────────────────────
  function giroChip(g) {
    if (g === null || g === undefined) return '<span class="kpi-chip kpi-chip-neutro">—</span>';
    const cls = g < 1 ? 'kpi-chip-crit' : (g < 1.5 ? 'kpi-chip-alerta' : 'kpi-chip-neutro');
    return '<span class="kpi-chip ' + cls + '">' + fmt2(g) + '</span>';
  }
  function renderTabela() {
    const arr = itensView();
    if (!arr.length) return '<div class="kpi-msg">Nenhum item para os filtros atuais.</div>';
    let linhas = '';
    arr.forEach(i => {
      const teto = (i.limitado_por === 'espaco')
        ? ' <span class="kpi-teto" title="Limitado pelo espaço do tanque">teto</span>' : '';
      linhas +=
        '<tr>' +
          '<td class="kpi-td-posto">' + esc(i.posto_nome) + '</td>' +
          '<td>' + esc(i.combustivel) + '</td>' +
          '<td class="kpi-num">' + fmtL(i.medicao_atual) + '</td>' +
          '<td class="kpi-num">' + fmtL(i.capacidade) + '</td>' +
          '<td class="kpi-num">' + fmtL(i.venda_media) + '</td>' +
          '<td class="kpi-td-giro">' + giroChip(i.giro) + '</td>' +
          '<td class="kpi-num kpi-td-sug">' + fmtL(i.sugestao) + teto + '</td>' +
        '</tr>';
    });
    return '<div class="kpi-tbl-wrap"><table class="kpi-tbl">' +
      '<thead><tr>' +
        '<th>POSTO</th><th>COMB</th><th class="kpi-num">TANQUE</th>' +
        '<th class="kpi-num">CAPACIDADE</th><th class="kpi-num">VENDA/DIA</th>' +
        '<th>GIRO</th><th class="kpi-num">SUGERIDO</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }

  // ── Gráficos (div + CSS, sem biblioteca) ────────────────────────
  // Bloco 1: pico por dia da semana — barras DIVERGENTES a partir do 1.0
  // (fator neutro) usando resp.fatores. "sem base" quando base < 20.
  function renderPicoDia() {
    const fatores = _resp.fatores || {};
    const cods = Object.keys(fatores).sort();
    if (!cods.length) return '<div class="kpi-msg">Sem fatores.</div>';
    const MAXDEV = 0.5;   // o teto do fator é [0.5, 1.5] → desvio máx. 0,5
    let rows = '';
    cods.forEach(cod => {
      const f = fatores[cod];
      const semBase = (f.base || 0) < 20;
      const dev = semBase ? 0 : (f.valor - 1);
      const pct = Math.min(50, Math.abs(dev) / MAXDEV * 50);   // metade da trilha
      const barra = dev >= 0
        ? '<div class="kpi-div-bar kpi-pos" style="left:50%;width:' + pct + '%"></div>'
        : '<div class="kpi-div-bar kpi-neg" style="right:50%;width:' + pct + '%"></div>';
      const rot = semBase
        ? '<span class="kpi-sembase">sem base</span>'
        : '<span class="kpi-div-val">' + fmt2(f.valor) + (f.teto ? ' <span class="kpi-teto">teto</span>' : '') + '</span>';
      rows +=
        '<div class="kpi-div-row">' +
          '<div class="kpi-div-lbl">' + esc(cod) + '</div>' +
          '<div class="kpi-div-track"><div class="kpi-div-center"></div>' + barra + '</div>' +
          '<div class="kpi-div-num">' + rot + '</div>' +
        '</div>';
    });
    return '<div class="kpi-graf">' +
      '<div class="kpi-graf-tit">Pico por dia da semana · ' + esc(_resp.dia_semana || '') + '</div>' +
      rows + '</div>';
  }

  // Bloco 2: volume por posto — VENDA dos últimos 30 dias por posto (ranking de
  // quem vende mais na rede). Soma venda_total_30d dos itens filtrados, desc.
  function renderVolumePosto() {
    const arr = itensView();
    const porPosto = new Map();
    arr.forEach(i => porPosto.set(i.posto_nome, (porPosto.get(i.posto_nome) || 0) + (Number(i.venda_total_30d) || 0)));
    const lista = [...porPosto.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!lista.length) return '<div class="kpi-graf"><div class="kpi-graf-tit">Volume por posto · 30 dias</div>' +
      '<div class="kpi-msg">Sem venda registrada.</div></div>';
    const max = lista[0][1] || 1;
    const rows = lista.map(([nome, v]) =>
      '<div class="kpi-hb-row">' +
        '<div class="kpi-hb-lbl">' + esc(nome) + '</div>' +
        '<div class="kpi-hb-track"><div class="kpi-hb-bar" style="width:' + (v / max * 100) + '%"></div></div>' +
        '<div class="kpi-hb-num">' + fmtL(v) + '</div>' +
      '</div>').join('');
    return '<div class="kpi-graf"><div class="kpi-graf-tit">Volume por posto · 30 dias</div>' + rows + '</div>';
  }

  function renderGraficos() {
    return '<div class="kpi-grafs">' + renderPicoDia() + renderVolumePosto() + '</div>';
  }

  // ── Entrada pública ─────────────────────────────────────────────
  window.renderKpi = function (container) {
    if (!container) return;
    _sec = container;
    if (!_shellPronto || !container.querySelector('#kpi-data')) montarShell(container);
    const inp = container.querySelector('#kpi-data');
    if (inp && !inp.value) inp.value = _data || amanhaISO();
    carregar();
  };
})();
