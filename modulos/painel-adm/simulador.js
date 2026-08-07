// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/simulador.js
// Simulador de negociação (ADM/LOGISTICA). COMPARTILHADO (painel-adm
// desktop e admin mobile), mesmo padrao do compra.js — tokens CURTOS
// (--sf/--bd/--ac/--tx/--dg/--ok/--mono), que existem no admin.css
// (nativo) e no painel-adm.css (alias curto->longo).
// Expoe window.renderSimulador(sec). Consome o MESMO GET /compras?periodo=&ref=
// da aba Compra — nenhuma rota nova. Entra pelo seletor nav-custo ('simulador').
// Dois modos (troca client-side):
//   Cenário  — "e se toda a rede comprasse de uma distribuidora só?"
//   Comparar — "quanto cada posto paga acima do melhor preço da rede?"
// ================================================================
(function () {
  'use strict';

  const PERIODOS = [
    { key: 'dia', label: 'DIA' },
    { key: 'quinzena', label: 'QUINZENA' },
    { key: 'mes', label: 'MÊS' },
    { key: 'trimestre', label: 'TRIMESTRE' },
    { key: 'ano', label: 'ANO' },
  ];

  // Chips de combustivel — só aparecem no modo Comparar (filtro client-side).
  const COMBS = ['TODOS', 'GC', 'GA', 'ET', 'S10', 'S500'];

  // Paridade com o backend: grupos e produtos fora da base de negociacao.
  const GRUPO_FORA   = ['GASMIG', 'OUTROS_NAO_DISTRIBUIDORA'];
  const PRODUTO_FORA = ['GNV', 'OCT', 'POD'];

  // Aviso obrigatório do modo Cenário — texto fixo, sempre visível.
  const AVISO_CENARIO =
    'Cenário, não promessa. O preço de cada distribuidora vem das compras ' +
    'que ela realmente fez no período — em volumes que podem ser muito ' +
    'menores que o da rede. Fornecedor pequeno pode não ter capacidade nem ' +
    'manter o preço nessa escala.';

  let _shellPronto = false;
  let _dados       = null;
  let _periodo     = 'mes';       // dia|quinzena|quinzena15|mes|trimestre|ano
  let _ref         = null;        // referencia do periodo (null = default backend)
  let _modo        = 'cenario';   // cenario|comparar
  let _comb        = 'TODOS';     // só usado no modo comparar

  // ── Formatação (própria da IIFE) ─────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function fmtLitros(v) { return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' L'; }
  function fmtReais(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtPreco(v) {
    if (v === null || v === undefined) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  function fmtCent(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'c'; }
  function brData(iso) { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || ''); }

  // ── CSS injetado (escopo .sim-wrap; tokens curtos) ───────────────
  function injetarEstilo() {
    if (document.getElementById('simulador-style')) return;
    // No admin (.scr tem padding próprio) reduz o padding do wrap; detecta
    // pela ausência dos tokens longos (admin não carrega base.css).
    const emAdmin = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() === '';
    const st = document.createElement('style');
    st.id = 'simulador-style';
    st.textContent =
      '#s-simulador{height:auto;min-height:100%}' +
      '#s-simulador.active{display:block}' +
      (emAdmin ? '.scr .sim-wrap{padding:.2rem 0}' : '') +
      '.sim-wrap{flex:1;min-height:0;overflow-y:auto;padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:1rem}' +
      '.sim-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}' +
      '.sim-title{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--tx)}' +
      '.sim-chips{display:flex;gap:6px;flex-wrap:wrap}' +
      '.sim-chip{background:var(--sf2);border:1px solid var(--bd);border-radius:20px;padding:5px 12px;font-size:.68rem;font-family:var(--mono);font-weight:700;color:var(--tx3);cursor:pointer;transition:all .15s}' +
      '.sim-chip:hover{border-color:var(--bd2);color:var(--tx2)}' +
      '.sim-chip.on{background:var(--acd);border-color:var(--ac);color:var(--ac)}' +
      '.sim-subq{display:flex;gap:6px;flex-wrap:wrap}' +
      '.sim-nav{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}' +
      '.sim-navbtn{background:var(--sf2);border:1px solid var(--bd);color:var(--tx);border-radius:8px;width:34px;height:32px;cursor:pointer;font-size:.8rem;font-family:var(--mono);display:inline-flex;align-items:center;justify-content:center}' +
      '.sim-navbtn:hover:not(:disabled){border-color:var(--ac);color:var(--ac)}' +
      '.sim-navbtn:disabled{opacity:.35;cursor:not-allowed}' +
      '.sim-nav-lbl{font-family:var(--mono);font-size:.82rem;font-weight:700;color:var(--tx);min-width:130px;text-align:center}' +
      '.sim-nav-int{font-family:var(--mono);font-size:.72rem;color:var(--tx3)}' +
      // Botões de modo — pílulas maiores que os chips.
      '.sim-modos{display:flex;gap:8px;flex-wrap:wrap}' +
      '.sim-modo{background:transparent;border:1px solid var(--bd);border-radius:999px;padding:7px 18px;font-size:.76rem;font-family:var(--mono);font-weight:700;color:var(--tx);cursor:pointer;transition:all .15s}' +
      '.sim-modo:hover{border-color:var(--ac);color:var(--ac)}' +
      '.sim-modo.on{background:var(--acd);border-color:var(--ac);color:var(--ac)}' +
      '.sim-kpis{display:grid;grid-template-columns:1fr;gap:.8rem}' +
      '.sim-kpi{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:.9rem 1rem}' +
      '.sim-kpi-lbl{font-size:.62rem;font-family:var(--mono);color:var(--tx3);text-transform:uppercase;letter-spacing:.06em}' +
      '.sim-kpi-val{font-family:var(--mono);font-size:1.35rem;font-weight:700;color:var(--tx);margin-top:4px}' +
      '.sim-kpi-sub{font-size:.66rem;color:var(--tx3);margin-top:3px}' +
      '.sim-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:1rem 1.1rem}' +
      '.sim-card-title{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--ac);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.8rem}' +
      '.sim-tbl-wrap{overflow-x:auto}' +
      '.sim-tbl{width:100%;border-collapse:collapse;font-size:.78rem}' +
      '.sim-tbl th{font-family:var(--mono);font-size:.58rem;text-transform:uppercase;color:var(--tx3);padding:0 .4rem .5rem;text-align:right;white-space:nowrap;border-bottom:1px solid var(--bd)}' +
      '.sim-tbl th:first-child,.sim-tbl th:nth-child(2){text-align:left}' +
      '.sim-tbl td{padding:.45rem .4rem;text-align:right;border-bottom:1px solid var(--bd);font-family:var(--mono);white-space:nowrap;color:var(--tx2)}' +
      '.sim-tbl td:first-child{text-align:left;color:var(--tx);font-weight:600;font-family:var(--sans)}' +
      '.sim-tbl td:nth-child(2){text-align:left;color:var(--tx2);font-family:var(--sans)}' +
      '.sim-tbl tr:last-child td{border-bottom:none}' +
      // Linha "Hoje (real)" destacada.
      '.sim-tbl tr.sim-real td{background:var(--acd);color:var(--tx);font-weight:700;border-top:1px solid var(--bd)}' +
      '.sim-aviso{font-size:.72rem;color:var(--tx3);font-style:italic;line-height:1.5;border-top:1px solid var(--bd);padding-top:.7rem}' +
      '.sim-empty{text-align:center;color:var(--tx3);padding:2rem;font-size:.82rem}' +
      '@media(max-width:480px){.sim-tbl{font-size:.72rem}}';
    document.head.appendChild(st);
  }

  // ── Shell ─────────────────────────────────────────────────────────
  function montarShell(sec) {
    injetarEstilo();
    sec.innerHTML =
      '<div class="sim-wrap">' +
        '<div class="sim-head">' +
          '<div class="sim-title">⚖️ Simulador</div>' +
        '</div>' +
        (window.navCustoHTML ? window.navCustoHTML('simulador') : '') +
        '<div class="sim-chips" id="sim-per"></div>' +
        '<div class="sim-subq" id="sim-subq" style="display:none"></div>' +
        '<div class="sim-nav" id="sim-nav" style="display:none"></div>' +
        '<div class="sim-modos" id="sim-modos"></div>' +
        '<div class="sim-chips" id="sim-comb" style="display:none"></div>' +
        '<div id="sim-body"><div class="sim-empty">Carregando…</div></div>' +
      '</div>';
    _shellPronto = true;
  }

  async function carregar() {
    renderPeriodChips();
    renderSubQuinzena();
    renderModos();
    renderCombChips();
    const body = document.getElementById('sim-body');
    if (body) body.innerHTML = '<div class="sim-empty">Carregando…</div>';
    try {
      const url = '/compras?periodo=' + encodeURIComponent(_periodo) +
        (_ref ? '&ref=' + encodeURIComponent(_ref) : '');
      _dados = await apiFetch(url);
      renderNavegador();
      renderBody();
    } catch (err) {
      if (body) body.innerHTML = '<div class="sim-empty" style="color:var(--dg)">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    }
  }

  // O chip QUINZENA fica aceso tanto na quinzena fechada quanto no rolante.
  function chipAtivo(key) {
    return key === 'quinzena' ? (_periodo === 'quinzena' || _periodo === 'quinzena15') : (_periodo === key);
  }
  function renderPeriodChips() {
    const el = document.getElementById('sim-per');
    if (!el) return;
    el.innerHTML = PERIODOS.map(p =>
      '<button class="sim-chip' + (chipAtivo(p.key) ? ' on' : '') + '" onclick="__simPeriodo(\'' + p.key + '\')">' + p.label + '</button>'
    ).join('');
  }

  // Sub-chips FECHADA / ÚLTIMOS 15 DIAS — só quando QUINZENA está ativo.
  function renderSubQuinzena() {
    const el = document.getElementById('sim-subq');
    if (!el) return;
    if (_periodo !== 'quinzena' && _periodo !== 'quinzena15') { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML =
      '<button class="sim-chip' + (_periodo === 'quinzena' ? ' on' : '') + '" onclick="__simSubQ(\'fechada\')">FECHADA</button>' +
      '<button class="sim-chip' + (_periodo === 'quinzena15' ? ' on' : '') + '" onclick="__simSubQ(\'rolante\')">ÚLTIMOS 15 DIAS</button>';
  }

  // Navegador [◀] rótulo [▶] intervalo. Some no quinzena15 (rolante).
  function renderNavegador() {
    const el = document.getElementById('sim-nav');
    if (!el) return;
    const p = _dados && _dados.periodo;
    if (!p || _periodo === 'quinzena15') { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML =
      '<button class="sim-navbtn" onclick="__simNav(\'ant\')"' + (p.tem_anterior ? '' : ' disabled') + '>◀</button>' +
      '<div class="sim-nav-lbl">' + esc(p.rotulo) + '</div>' +
      '<button class="sim-navbtn" onclick="__simNav(\'prox\')"' + (p.tem_proximo ? '' : ' disabled') + '>▶</button>' +
      '<div class="sim-nav-int">' + esc(p.intervalo) + '</div>';
  }

  function renderModos() {
    const el = document.getElementById('sim-modos');
    if (!el) return;
    const btn = (m, l) => '<button class="sim-modo' + (_modo === m ? ' on' : '') + '" onclick="__simModo(\'' + m + '\')">' + l + '</button>';
    el.innerHTML = btn('cenario', 'Cenário') + btn('comparar', 'Comparar');
  }

  // Chips de combustível: só no modo Comparar.
  function renderCombChips() {
    const el = document.getElementById('sim-comb');
    if (!el) return;
    if (_modo !== 'comparar') { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = COMBS.map(k =>
      '<button class="sim-chip' + (_comb === k ? ' on' : '') + '" onclick="__simComb(\'' + k + '\')">' + esc(k) + '</button>'
    ).join('');
  }

  // ── Base comum: por_grupo_combustivel já filtrado (grupo E produto) ──
  function baseGrupoComb() {
    return ((_dados && _dados.por_grupo_combustivel) || [])
      .filter(x => !GRUPO_FORA.includes(x.grupo) && !PRODUTO_FORA.includes(x.combustivel));
  }

  // ── MODO CENÁRIO ──────────────────────────────────────────────────
  // "e se toda a rede comprasse de uma distribuidora só?"
  function calcCenario() {
    const linhas = baseGrupoComb();
    if (!linhas.length) return null;
    const precoPorGrupo = {};   // grupo -> { comb: preco_medio }
    const volumeRede = {};      // comb  -> litros somados de TODOS os grupos
    const valorRede = {};       // comb  -> valor  somado de TODOS os grupos
    linhas.forEach(x => {
      const g = x.grupo, c = x.combustivel;
      (precoPorGrupo[g] || (precoPorGrupo[g] = {}))[c] = x.preco_medio;
      volumeRede[c] = (volumeRede[c] || 0) + (Number(x.litros) || 0);
      valorRede[c]  = (valorRede[c]  || 0) + (Number(x.valor)  || 0);
    });
    const combsRede = Object.keys(volumeRede);
    const totalCombs = combsRede.length;
    const totalVol = combsRede.reduce((s, c) => s + volumeRede[c], 0);
    const custoRealTotal = combsRede.reduce((s, c) => s + valorRede[c], 0);

    const linhasGrupo = Object.keys(precoPorGrupo).map(g => {
      const precos = precoPorGrupo[g];
      // C = combustíveis que ESTE grupo tem preço (e que existem na rede).
      const C = Object.keys(precos).filter(c => precos[c] != null && volumeRede[c] != null);
      let custoCenario = 0, custoRealSub = 0, volCoberto = 0;
      C.forEach(c => {
        custoCenario += volumeRede[c] * Number(precos[c]);   // rede inteira ao preço do grupo
        custoRealSub += valorRede[c];                        // real, MESMO subconjunto C
        volCoberto   += volumeRede[c];
      });
      return {
        grupo: g,
        numC: C.length,
        totalCombs,
        cobertura: totalVol > 0 ? volCoberto / totalVol : 0,
        custoCenario,
        diferenca: custoCenario - custoRealSub,   // sempre no mesmo subconjunto
      };
    }).filter(r => r.numC > 0);

    linhasGrupo.sort((a, b) => a.diferenca - b.diferenca);   // mais econômico primeiro
    return { linhasGrupo, custoRealTotal };
  }

  function renderCenario() {
    const r = calcCenario();
    if (!r || !r.linhasGrupo.length) return '<div class="sim-empty">Sem compras no período</div>';

    // 100% = grupo tem preço em TODOS os combustíveis do volumeRede.
    const full    = r.linhasGrupo.filter(l => l.numC === l.totalCombs);
    const parcial = r.linhasGrupo.filter(l => l.numC < l.totalCombs);

    const cobTxt = (l) => (l.numC === l.totalCombs)
      ? '100%'
      : Math.round(l.cobertura * 100) + '% · ' + l.numC + ' de ' + l.totalCombs + ' combustíveis';
    const vsHojeCell = (dif) => {
      const cor = dif < 0 ? 'var(--ok)' : (dif > 0 ? 'var(--dg)' : 'var(--tx2)');
      const txt = (dif < 0 ? '−' : (dif > 0 ? '+' : '')) + 'R$ ' + fmtReais(Math.abs(dif));
      return '<td style="color:' + cor + '">' + txt + '</td>';
    };

    // ── Tabela principal: só quem cobre 100% (números comparáveis entre si) ──
    const headMain = '<tr><th>Distribuidora</th><th>Cobertura</th><th>Custo do cenário</th><th>vs hoje</th></tr>';
    const rowsMain = full.length
      ? full.map(l =>
          '<tr>' +
            '<td>' + esc(l.grupo) + '</td>' +
            '<td>' + esc(cobTxt(l)) + '</td>' +
            '<td>R$ ' + fmtReais(l.custoCenario) + '</td>' +
            vsHojeCell(l.diferenca) +
          '</tr>'
        ).join('')
      : '<tr><td colspan="4" style="color:var(--tx3)">Nenhuma distribuidora cobre todos os combustíveis do período</td></tr>';
    const real = '<tr class="sim-real"><td>Hoje (real)</td><td>100%</td><td>R$ ' + fmtReais(r.custoRealTotal) + '</td><td>—</td></tr>';
    const tabelaMain = '<div class="sim-card"><div class="sim-card-title">Se toda a rede comprasse de uma só</div>' +
      '<div class="sim-tbl-wrap"><table class="sim-tbl"><thead>' + headMain + '</thead><tbody>' + rowsMain + real + '</tbody></table></div></div>';

    // ── Cobertura parcial: sem "Custo do cenário" (o número que engana) ──
    let tabelaParcial = '';
    if (parcial.length) {
      const headP = '<tr><th>Distribuidora</th><th>Cobertura</th><th>vs hoje (só nos combustíveis dela)</th></tr>';
      const rowsP = parcial.map(l =>
        '<tr>' +
          '<td>' + esc(l.grupo) + '</td>' +
          '<td>' + esc(cobTxt(l)) + '</td>' +
          vsHojeCell(l.diferenca) +
        '</tr>'
      ).join('');
      tabelaParcial = '<div class="sim-card"><div class="sim-card-title">Cobertura parcial — não comparável com as acima</div>' +
        '<div class="sim-tbl-wrap"><table class="sim-tbl"><thead>' + headP + '</thead><tbody>' + rowsP + '</tbody></table></div></div>';
    }

    const aviso = '<div class="sim-aviso">' + esc(AVISO_CENARIO) + '</div>';
    return tabelaMain + tabelaParcial + aviso;
  }

  // ── MODO COMPARAR ─────────────────────────────────────────────────
  // "quanto cada posto paga acima do melhor preço da rede?"
  function calcComparar() {
    const linhas = baseGrupoComb();
    if (!linhas.length) return null;
    // melhorPreco[comb] = menor preco_medio entre os grupos.
    const melhor = {};
    linhas.forEach(x => {
      const c = x.combustivel, P = x.preco_medio;
      if (P == null) return;
      if (_comb !== 'TODOS' && c !== _comb) return;
      if (melhor[c] == null || Number(P) < melhor[c]) melhor[c] = Number(P);
    });
    if (!Object.keys(melhor).length) return { rows: [], totalExtra: 0 };

    const rows = ((_dados && _dados.postos) || []).map(p => {
      const cbs = p.combustiveis || {};
      let extra = 0, litrosTotal = 0;
      Object.keys(cbs).forEach(c => {
        if (PRODUTO_FORA.includes(c)) return;              // gás/premium fora
        if (_comb !== 'TODOS' && c !== _comb) return;      // chip específico
        if (melhor[c] == null) return;                     // sem melhor preço → ignora
        const o = cbs[c];
        const L = Number(o.litros) || 0;
        const P = o.preco_medio;
        if (P == null || L <= 0) return;
        const delta = Number(P) - melhor[c];               // por combustível, nunca média geral
        extra += L * (delta > 0 ? delta : 0);              // delta negativo = 0
        litrosTotal += L;
      });
      if (litrosTotal <= 0) return null;                   // posto sem volume considerado sai
      const forn = (p.grupos || [])
        .filter(g => !GRUPO_FORA.includes(g.grupo))
        .map(g => g.grupo);
      return {
        nome: p.nome,
        fornecedor: forn.length ? forn.join(' + ') : '—',
        litros: litrosTotal,
        centavos: litrosTotal > 0 ? (extra / litrosTotal) * 100 : 0,
        extra,
      };
    }).filter(Boolean);

    const totalExtra = rows.reduce((s, r) => s + r.extra, 0);
    rows.sort((a, b) => b.extra - a.extra);
    return { rows, totalExtra };
  }

  function renderComparar() {
    const r = calcComparar();
    if (!r || !r.rows.length) return '<div class="sim-empty">Sem compras no período</div>';
    const kpi =
      '<div class="sim-kpis"><div class="sim-kpi">' +
        '<div class="sim-kpi-lbl">Extra total no período</div>' +
        '<div class="sim-kpi-val" style="color:var(--dg)">R$ ' + fmtReais(r.totalExtra) + '</div>' +
        '<div class="sim-kpi-sub">' + r.rows.length + ' postos · vs melhor preço da rede' +
          (_comb !== 'TODOS' ? ' · ' + esc(_comb) : '') + '</div>' +
      '</div></div>';
    const head = '<tr><th>Posto</th><th>Fornecedor</th><th>Litros</th><th>c/L acima</th><th>Extra no período</th></tr>';
    const rows = r.rows.map(p =>
      '<tr>' +
        '<td>' + esc(p.nome) + '</td>' +
        '<td>' + esc(p.fornecedor) + '</td>' +
        '<td>' + fmtLitros(p.litros) + '</td>' +
        '<td>' + fmtCent(p.centavos) + '</td>' +
        '<td>R$ ' + fmtReais(p.extra) + '</td>' +
      '</tr>'
    ).join('');
    const titulo = 'Quanto cada posto paga acima do melhor preço' + (_comb !== 'TODOS' ? ' — ' + esc(_comb) : '');
    const tabela = '<div class="sim-card"><div class="sim-card-title">' + titulo + '</div>' +
      '<div class="sim-tbl-wrap"><table class="sim-tbl"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></div>';
    return kpi + tabela;
  }

  function renderBody() {
    const body = document.getElementById('sim-body');
    if (!body) return;
    if (!_dados) { body.innerHTML = '<div class="sim-empty">Sem compras no período</div>'; return; }
    body.innerHTML = (_modo === 'comparar') ? renderComparar() : renderCenario();
  }

  // ── Ações públicas ───────────────────────────────────────────────
  // Trocar de TIPO limpa o _ref (volta pro default do backend). O chip
  // QUINZENA entra no modo FECHADA por padrão.
  window.__simPeriodo = function (key) {
    _ref = null;
    _periodo = (key === 'quinzena') ? 'quinzena' : key;
    carregar();
  };
  window.__simSubQ = function (modo) {
    _ref = null;
    _periodo = (modo === 'rolante') ? 'quinzena15' : 'quinzena';
    carregar();
  };
  // Setas: só mudam o _ref (usa os refs vizinhos que o backend já devolveu).
  window.__simNav = function (dir) {
    const p = _dados && _dados.periodo;
    if (!p) return;
    if (dir === 'ant' && !p.tem_anterior) return;
    if (dir === 'prox' && !p.tem_proximo) return;
    const alvo = (dir === 'ant') ? p.ref_anterior : p.ref_proximo;
    if (!alvo) return;
    _ref = alvo;
    carregar();
  };
  // Modo Cenário/Comparar — troca CLIENT-SIDE (não refaz a API).
  window.__simModo = function (m) {
    if (m !== 'cenario' && m !== 'comparar') return;
    _modo = m;
    renderModos();
    renderCombChips();
    renderBody();
  };
  // Chip de combustível (só no modo Comparar) — filtro CLIENT-SIDE.
  window.__simComb = function (k) {
    if (COMBS.indexOf(k) < 0) return;
    _comb = k;
    renderCombChips();
    renderBody();
  };

  // ── Entrada pública ──────────────────────────────────────────────
  window.renderSimulador = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('.sim-wrap')) montarShell(sec);
    if (!_dados) carregar();
    else { renderPeriodChips(); renderSubQuinzena(); renderModos(); renderCombChips(); renderNavegador(); renderBody(); }
  };
})();
