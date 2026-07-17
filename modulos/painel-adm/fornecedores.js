// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/fornecedores.js
// Dashboard de custo por fornecedor. COMPARTILHADO (painel-adm desktop
// e admin mobile), padrão do relatorios.js — tokens CURTOS
// (--sf/--bd/--ac/--tx/--dg/--wn/--ok/--rl), que existem tanto no
// admin.css (nativo) quanto no painel-adm.css (alias curto→longo).
// Expõe window.renderFornecedores(sec). Consome GET /fornecedores-dashboard.
// Entra pela aba Custo & Margem (botão "📊 Fornecedores"); "← Custo" volta.
// ================================================================
(function () {
  const PERIODOS = [
    { key: 'dia', label: 'DIA' },
    { key: 'quinzena', label: 'QUINZENA' },
    { key: 'mes', label: 'MÊS' },
    { key: 'trimestre', label: 'TRIMESTRE' },
    { key: 'ano', label: 'ANO' },
  ];

  let _shellPronto = false;
  let _dados       = null;
  let _periodo     = 'mes';
  let _comb        = null;

  // ── Formatação ───────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function fmtCusto(v) {
    if (v === null || v === undefined) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  function fmtReais(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtLitros(v) { return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' L'; }
  function fmtCentNum(delta) { return (Number(delta) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
  const ZERO = 0.00005; // tolerância p/ "é o menor"
  function brData(iso) { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || ''); }

  // ── CSS injetado (escopo .forn-wrap; tokens curtos) ──────────────
  function injetarEstilo() {
    if (document.getElementById('fornecedores-style')) return;
    // No admin (.scr tem padding próprio) reduz o padding do wrap; detecta pela
    // ausência dos tokens longos (admin não carrega base.css).
    const emAdmin = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() === '';
    const st = document.createElement('style');
    st.id = 'fornecedores-style';
    st.textContent =
      '#s-forn{height:auto;min-height:100%}' +
      '#s-forn.active{display:block}' +
      (emAdmin ? '.scr .forn-wrap{padding:.2rem 0}' : '') +
      '.forn-wrap{flex:1;min-height:0;overflow-y:auto;padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:1rem}' +
      '.forn-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}' +
      '.forn-title{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--tx)}' +
      '.forn-back{background:var(--sf2);border:1px solid var(--bd);color:var(--tx);font-family:var(--mono);font-size:.72rem;font-weight:700;padding:.5rem .8rem;border-radius:8px;cursor:pointer}' +
      '.forn-back:hover{border-color:var(--ac);color:var(--ac)}' +
      '.forn-chips{display:flex;gap:6px;flex-wrap:wrap}' +
      '.forn-chip{background:var(--sf2);border:1px solid var(--bd);border-radius:20px;padding:5px 12px;font-size:.68rem;font-family:var(--mono);font-weight:700;color:var(--tx3);cursor:pointer;transition:all .15s}' +
      '.forn-chip:hover{border-color:var(--bd2);color:var(--tx2)}' +
      '.forn-chip.on{background:var(--acd);border-color:var(--ac);color:var(--ac)}' +
      '.forn-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem}' +
      '.forn-kpi{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:.9rem 1rem}' +
      '.forn-kpi-lbl{font-size:.62rem;font-family:var(--mono);color:var(--tx3);text-transform:uppercase;letter-spacing:.06em}' +
      '.forn-kpi-val{font-family:var(--mono);font-size:1.35rem;font-weight:700;color:var(--tx);margin-top:4px}' +
      '.forn-kpi-sub{font-size:.66rem;color:var(--tx3);margin-top:3px}' +
      '.forn-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:1rem 1.1rem}' +
      '.forn-card-title{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--ac);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.8rem}' +
      '.forn-chart{display:flex;align-items:flex-end;gap:.6rem}' +
      '.forn-col{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0}' +
      '.forn-colval{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--tx);margin-bottom:5px;white-space:nowrap}' +
      // Área de plotagem com ALTURA DEFINIDA — sem isso a % de altura das barras não resolve.
      '.forn-col-plot{width:100%;height:160px;display:flex;align-items:flex-end;justify-content:center}' +
      '.forn-bar{width:100%;max-width:64px;border-radius:6px 6px 0 0;min-height:6px}' +
      '.forn-bar.bom{background:var(--ok)}' +
      '.forn-bar.med{background:var(--wn)}' +
      '.forn-bar.ruim{background:var(--dg)}' +
      '.forn-colnome{font-size:.62rem;color:var(--tx2);margin-top:6px;text-align:center;word-break:break-word;line-height:1.2}' +
      '.forn-coldelta{font-size:.6rem;font-family:var(--mono);margin-top:2px;font-weight:700}' +
      '.forn-econ{margin-top:.9rem;font-size:.76rem;color:var(--tx2);border-top:1px solid var(--bd);padding-top:.7rem}' +
      '.forn-econ b{color:var(--dg)}' +
      '.forn-matriz-wrap{overflow-x:auto}' +
      '.forn-matriz{width:100%;border-collapse:collapse;font-size:.78rem}' +
      '.forn-matriz th{font-family:var(--mono);font-size:.58rem;text-transform:uppercase;color:var(--tx3);padding:0 .4rem .5rem;text-align:right;white-space:nowrap;border-bottom:1px solid var(--bd)}' +
      '.forn-matriz th:first-child{text-align:left}' +
      '.forn-matriz td{padding:.45rem .4rem;text-align:right;border-bottom:1px solid var(--bd);font-family:var(--mono);white-space:nowrap;color:var(--tx2)}' +
      '.forn-matriz td:first-child{text-align:left;color:var(--tx);font-weight:600;font-family:var(--sans)}' +
      '.forn-matriz tr:last-child td{border-bottom:none}' +
      '.forn-mat-menor{color:var(--ok);font-weight:700}' +
      '.forn-mat-med{color:var(--wn)}' +
      '.forn-mat-ruim{color:var(--dg);font-weight:700}' +
      '.forn-mat-na{color:var(--tx3);opacity:.6}' +
      '.forn-nota{font-size:.7rem;color:var(--tx3);font-style:italic}' +
      '.forn-empty{text-align:center;color:var(--tx3);padding:2rem;font-size:.82rem}' +
      '@media(max-width:480px){.forn-kpis{grid-template-columns:1fr}.forn-chart{gap:.3rem}.forn-bar{max-width:40px}}';
    document.head.appendChild(st);
  }

  // ── Shell ─────────────────────────────────────────────────────────
  function montarShell(sec) {
    injetarEstilo();
    sec.innerHTML =
      '<div class="forn-wrap">' +
        '<div class="forn-head">' +
          '<div class="forn-title">📊 Fornecedores</div>' +
          '<button class="forn-back" onclick="__fornVoltar()">← Custo</button>' +
        '</div>' +
        '<div class="forn-chips" id="forn-per"></div>' +
        '<div class="forn-chips" id="forn-comb"></div>' +
        '<div id="forn-body"><div class="forn-empty">Carregando…</div></div>' +
      '</div>';
    _shellPronto = true;
  }

  async function carregar() {
    renderPeriodChips();
    const body = document.getElementById('forn-body');
    if (body) body.innerHTML = '<div class="forn-empty">Carregando…</div>';
    try {
      _dados = await apiFetch('/fornecedores-dashboard?periodo=' + encodeURIComponent(_periodo));
      const combs = Object.keys(_dados.combustiveis || {});
      if (!_comb || !combs.includes(_comb)) _comb = combs[0] || null;
      renderCombChips();
      renderBody();
    } catch (err) {
      if (body) body.innerHTML = '<div class="forn-empty" style="color:var(--dg)">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    }
  }

  function renderPeriodChips() {
    const el = document.getElementById('forn-per');
    if (!el) return;
    el.innerHTML = PERIODOS.map(p =>
      '<button class="forn-chip' + (_periodo === p.key ? ' on' : '') + '" onclick="__fornPeriodo(\'' + p.key + '\')">' + p.label + '</button>'
    ).join('');
  }

  function renderCombChips() {
    const el = document.getElementById('forn-comb');
    if (!el) return;
    const combs = Object.keys((_dados && _dados.combustiveis) || {});
    el.innerHTML = combs.map(k =>
      '<button class="forn-chip' + (_comb === k ? ' on' : '') + '" onclick="__fornComb(\'' + esc(k) + '\')">' + esc(k) + '</button>'
    ).join('');
  }

  function renderBody() {
    const body = document.getElementById('forn-body');
    if (!body) return;
    const c = (_comb && _dados.combustiveis) ? _dados.combustiveis[_comb] : null;
    if (!c || !c.fornecedores.length) {
      body.innerHTML = '<div class="forn-empty">Sem custos de fornecedor para esse período.</div>';
      return;
    }
    const forns = c.fornecedores;                    // já ordenado por media asc (backend)
    const menor = forns[0];
    const maiorDelta = forns.reduce((a, b) => (b.delta > a.delta ? b : a), forns[0]);

    const kpis =
      '<div class="forn-kpis">' +
        '<div class="forn-kpi"><div class="forn-kpi-lbl">Menor custo médio</div>' +
          '<div class="forn-kpi-val">R$ ' + fmtCusto(menor.media) + '</div>' +
          '<div class="forn-kpi-sub">' + esc(menor.distribuidora) + '</div></div>' +
        '<div class="forn-kpi"><div class="forn-kpi-lbl">Maior diferença</div>' +
          '<div class="forn-kpi-val" style="color:var(--dg)">' + (maiorDelta.delta > ZERO ? '+' + fmtCentNum(maiorDelta.delta) + 'c' : '0') + '</div>' +
          '<div class="forn-kpi-sub">' + esc(maiorDelta.distribuidora) + ' vs ' + esc(menor.distribuidora) + '</div></div>' +
        '<div class="forn-kpi"><div class="forn-kpi-lbl">Volume do período</div>' +
          '<div class="forn-kpi-val">' + fmtLitros(c.litros) + '</div>' +
          '<div class="forn-kpi-sub">' + esc(_comb) + ' · carga recebida</div></div>' +
      '</div>';

    const nota = (_dados.n_datas_serie === 1)
      ? '<div class="forn-nota">Série iniciada em ' + brData(_dados.inicio) + ' — os períodos maiores vão ganhando dados a cada lançamento diário.</div>'
      : '';

    body.innerHTML = kpis + renderChart(forns, c) + renderMatriz() + nota;
  }

  // ── Gráfico de colunas (sem lib), eixo truncado ──────────────────
  function renderChart(forns, c) {
    const medias = forns.map(f => f.media);
    const min = Math.min(...medias), max = Math.max(...medias);
    const range = max - min;
    const base = min - 0.15 * range;   // eixo truncado
    const denom = max - base;
    const n = forns.length;
    const cols = forns.map((f, i) => {
      const cls = (i === 0) ? 'bom' : ((i === n - 1 && n > 1) ? 'ruim' : 'med');
      const h = (denom <= 0) ? 100 : Math.max(6, ((f.media - base) / denom) * 100);
      const ehMenor = f.delta <= ZERO;
      const cor = ehMenor ? 'var(--ok)' : (i === n - 1 ? 'var(--dg)' : 'var(--wn)');
      const deltaLbl = ehMenor ? 'menor' : ('+' + fmtCentNum(f.delta) + 'c');
      return '<div class="forn-col">' +
        '<div class="forn-colval">' + fmtCusto(f.media) + '</div>' +
        '<div class="forn-col-plot"><div class="forn-bar ' + cls + '" style="height:' + h + '%"></div></div>' +
        '<div class="forn-colnome">' + esc(f.distribuidora) + '</div>' +
        '<div class="forn-coldelta" style="color:' + cor + '">' + deltaLbl + '</div>' +
      '</div>';
    }).join('');
    const maiorDelta = forns.reduce((a, b) => (b.delta > a.delta ? b : a), forns[0]);
    const econ = (maiorDelta.delta > ZERO)
      ? '<div class="forn-econ">Custo extra no período se todo o volume (' + fmtLitros(c.litros) + ') viesse de <b>' +
        esc(maiorDelta.distribuidora) + '</b>: <b>R$ ' + fmtReais(maiorDelta.custo_extra) + '</b></div>'
      : '';
    return '<div class="forn-card"><div class="forn-card-title">Custo médio por fornecedor — ' + esc(_comb) + '</div>' +
      '<div class="forn-chart">' + cols + '</div>' + econ + '</div>';
  }

  // ── Matriz de diferenças (combustíveis × distribuidoras) ─────────
  function renderMatriz() {
    const combs = Object.keys(_dados.combustiveis || {});
    const distrSet = new Set();
    combs.forEach(k => (_dados.combustiveis[k].fornecedores || []).forEach(f => distrSet.add(f.distribuidora)));
    const distrs = [...distrSet].sort((a, b) => a.localeCompare(b));
    if (!combs.length || !distrs.length) return '';
    const head = '<tr><th>Comb</th>' + distrs.map(d => '<th>' + esc(d) + '</th>').join('') + '</tr>';
    const rows = combs.map(k => {
      const forns = _dados.combustiveis[k].fornecedores || [];
      const maxDelta = forns.length ? Math.max(...forns.map(f => f.delta)) : 0;
      const byDistr = {};
      forns.forEach(f => { byDistr[f.distribuidora] = f; });
      const cels = distrs.map(d => {
        const f = byDistr[d];
        if (!f) return '<td class="forn-mat-na">—</td>';
        if (f.delta <= ZERO) return '<td class="forn-mat-menor">menor</td>';
        const cls = (Math.abs(f.delta - maxDelta) <= ZERO) ? 'forn-mat-ruim' : 'forn-mat-med';
        return '<td class="' + cls + '">+' + fmtCentNum(f.delta) + 'c</td>';
      }).join('');
      return '<tr><td>' + esc(k) + '</td>' + cels + '</tr>';
    }).join('');
    return '<div class="forn-card"><div class="forn-card-title">Matriz de diferenças (¢ vs menor)</div>' +
      '<div class="forn-matriz-wrap"><table class="forn-matriz"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  // ── Troca de section (compartilhado desktop/mobile via .scr) ─────
  function ativarSection(id) {
    document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
    const s = document.getElementById(id);
    if (s) s.classList.add('active');
  }

  // ── Ações públicas ───────────────────────────────────────────────
  window.__fornPeriodo = function (p) { _periodo = p; carregar(); };
  window.__fornComb = function (k) { _comb = k; renderCombChips(); renderBody(); };
  // Entra no dashboard (chamado pelo botão do header do Custo & Margem).
  window.__abrirForn = function () {
    ativarSection('s-forn');
    renderFornecedores(document.getElementById('s-forn'));
  };
  // Volta pra aba Custo & Margem.
  window.__fornVoltar = function () {
    ativarSection('s-custo');
    if (window.renderCustoMargem) renderCustoMargem(document.getElementById('s-custo'));
  };

  // ── Entrada pública ──────────────────────────────────────────────
  window.renderFornecedores = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('.forn-wrap')) montarShell(sec);
    if (!_dados) carregar();
    else { renderPeriodChips(); renderCombChips(); renderBody(); }
  };
})();
