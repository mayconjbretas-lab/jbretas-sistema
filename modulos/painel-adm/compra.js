// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/compra.js
// Dashboard de COMPRA (volume e custo real de nota fiscal) por periodo.
// COMPARTILHADO (painel-adm desktop e admin mobile), mesmo padrao do
// fornecedores.js — tokens CURTOS (--sf/--bd/--ac/--tx/--dg/--ok/--mono),
// que existem tanto no admin.css (nativo) quanto no painel-adm.css
// (alias curto->longo).
// Expoe window.renderCompra(sec). Consome GET /compras?periodo=&ref=.
// Entra pelo seletor nav-custo ('compra'). Filtro de combustivel e
// CLIENT-SIDE: a rota devolve tudo, os chips so re-renderizam o corpo.
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

  // Chips de combustivel — lista FIXA (filtro client-side, sem nova API).
  const COMBS = ['TODOS', 'GC', 'GA', 'ET', 'S10', 'S500'];

  // Grupos que NAO sao distribuidora de bandeira: fora do grafico e da
  // etiqueta de fornecedor (paridade com COMPRAS_GRUPO_FORA no backend).
  const GRUPO_FORA = ['GASMIG', 'OUTROS_NAO_DISTRIBUIDORA'];
  // Produtos fora da base de negociacao (paridade com COMPRAS_PRODUTO_FORA):
  // gas e premium de marca propria, sem cotacao comparavel entre distribuidoras.
  const PRODUTO_FORA = ['GNV', 'OCT', 'POD'];

  let _shellPronto = false;
  let _dados       = null;
  let _periodo     = 'mes';   // dia|quinzena|quinzena15|mes|trimestre|ano
  let _ref         = null;    // referencia do periodo (null = default backend)
  let _comb        = 'TODOS'; // chip ativo; TODOS = base de negociacao

  // ── Formatação (própria da IIFE) ─────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function fmtLitros(v) { return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' L'; }
  function fmtReais(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtPreco(v) {
    if (v === null || v === undefined) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  function brData(iso) { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || ''); }

  // ── CSS injetado (escopo .cmp-wrap; tokens curtos) ───────────────
  function injetarEstilo() {
    if (document.getElementById('compra-style')) return;
    // No admin (.scr tem padding próprio) reduz o padding do wrap; detecta
    // pela ausência dos tokens longos (admin não carrega base.css).
    const emAdmin = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() === '';
    const st = document.createElement('style');
    st.id = 'compra-style';
    st.textContent =
      '#s-compra{height:auto;min-height:100%}' +
      '#s-compra.active{display:block}' +
      (emAdmin ? '.scr .cmp-wrap{padding:.2rem 0}' : '') +
      '.cmp-wrap{flex:1;min-height:0;overflow-y:auto;padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:1rem}' +
      '.cmp-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}' +
      '.cmp-title{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--tx)}' +
      '.cmp-chips{display:flex;gap:6px;flex-wrap:wrap}' +
      '.cmp-chip{background:var(--sf2);border:1px solid var(--bd);border-radius:20px;padding:5px 12px;font-size:.68rem;font-family:var(--mono);font-weight:700;color:var(--tx3);cursor:pointer;transition:all .15s}' +
      '.cmp-chip:hover{border-color:var(--bd2);color:var(--tx2)}' +
      '.cmp-chip.on{background:var(--acd);border-color:var(--ac);color:var(--ac)}' +
      '.cmp-subq{display:flex;gap:6px;flex-wrap:wrap}' +
      '.cmp-nav{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}' +
      '.cmp-navbtn{background:var(--sf2);border:1px solid var(--bd);color:var(--tx);border-radius:8px;width:34px;height:32px;cursor:pointer;font-size:.8rem;font-family:var(--mono);display:inline-flex;align-items:center;justify-content:center}' +
      '.cmp-navbtn:hover:not(:disabled){border-color:var(--ac);color:var(--ac)}' +
      '.cmp-navbtn:disabled{opacity:.35;cursor:not-allowed}' +
      '.cmp-nav-lbl{font-family:var(--mono);font-size:.82rem;font-weight:700;color:var(--tx);min-width:130px;text-align:center}' +
      '.cmp-nav-int{font-family:var(--mono);font-size:.72rem;color:var(--tx3)}' +
      '.cmp-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem}' +
      '.cmp-kpi{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:.9rem 1rem}' +
      '.cmp-kpi-lbl{font-size:.62rem;font-family:var(--mono);color:var(--tx3);text-transform:uppercase;letter-spacing:.06em}' +
      '.cmp-kpi-val{font-family:var(--mono);font-size:1.35rem;font-weight:700;color:var(--tx);margin-top:4px}' +
      '.cmp-kpi-sub{font-size:.66rem;color:var(--tx3);margin-top:3px}' +
      '.cmp-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:1rem 1.1rem}' +
      '.cmp-card-title{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--ac);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.8rem}' +
      '.cmp-chart{display:flex;align-items:flex-end;gap:.6rem}' +
      '.cmp-col{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0}' +
      '.cmp-colval{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--tx);margin-bottom:5px;white-space:nowrap}' +
      // Área de plotagem com ALTURA DEFINIDA — sem isso a % das barras não resolve.
      '.cmp-col-plot{width:100%;height:160px;display:flex;align-items:flex-end;justify-content:center}' +
      // Eixo começa em ZERO (volume, não preço): sem base truncada. min-height só
      // para uma barra minúscula continuar visível.
      '.cmp-bar{width:100%;max-width:64px;border-radius:6px 6px 0 0;min-height:3px;background:var(--ac)}' +
      '.cmp-colnome{font-size:.62rem;color:var(--tx2);margin-top:6px;text-align:center;word-break:break-word;line-height:1.2}' +
      '.cmp-colpreco{font-size:.6rem;font-family:var(--mono);color:var(--tx3);margin-top:2px;white-space:nowrap}' +
      '.cmp-tbl-wrap{overflow-x:auto}' +
      '.cmp-tbl{width:100%;border-collapse:collapse;font-size:.78rem}' +
      '.cmp-tbl th{font-family:var(--mono);font-size:.58rem;text-transform:uppercase;color:var(--tx3);padding:0 .4rem .5rem;text-align:right;white-space:nowrap;border-bottom:1px solid var(--bd)}' +
      '.cmp-tbl th:first-child,.cmp-tbl th:nth-child(2){text-align:left}' +
      '.cmp-tbl td{padding:.45rem .4rem;text-align:right;border-bottom:1px solid var(--bd);font-family:var(--mono);white-space:nowrap;color:var(--tx2)}' +
      '.cmp-tbl td:first-child{text-align:left;color:var(--tx);font-weight:600;font-family:var(--sans)}' +
      '.cmp-tbl td:nth-child(2){text-align:left;color:var(--tx2);font-family:var(--sans)}' +
      '.cmp-tbl tr:last-child td{border-bottom:none}' +
      '.cmp-nota{font-size:.7rem;color:var(--tx3);font-style:italic}' +
      '.cmp-empty{text-align:center;color:var(--tx3);padding:2rem;font-size:.82rem}' +
      '@media(max-width:480px){.cmp-kpis{grid-template-columns:1fr}.cmp-chart{gap:.3rem}.cmp-bar{max-width:40px}}';
    document.head.appendChild(st);
  }

  // ── Shell ─────────────────────────────────────────────────────────
  function montarShell(sec) {
    injetarEstilo();
    sec.innerHTML =
      '<div class="cmp-wrap">' +
        '<div class="cmp-head">' +
          '<div class="cmp-title">🧾 Compra</div>' +
        '</div>' +
        (window.navCustoHTML ? window.navCustoHTML('compra') : '') +
        '<div class="cmp-chips" id="cmp-per"></div>' +
        '<div class="cmp-subq" id="cmp-subq" style="display:none"></div>' +
        '<div class="cmp-nav" id="cmp-nav" style="display:none"></div>' +
        '<div class="cmp-chips" id="cmp-comb"></div>' +
        '<div id="cmp-body"><div class="cmp-empty">Carregando…</div></div>' +
      '</div>';
    _shellPronto = true;
  }

  async function carregar() {
    renderPeriodChips();
    renderSubQuinzena();
    const body = document.getElementById('cmp-body');
    if (body) body.innerHTML = '<div class="cmp-empty">Carregando…</div>';
    try {
      const url = '/compras?periodo=' + encodeURIComponent(_periodo) +
        (_ref ? '&ref=' + encodeURIComponent(_ref) : '');
      _dados = await apiFetch(url);
      renderNavegador();
      renderCombChips();
      renderBody();
    } catch (err) {
      if (body) body.innerHTML = '<div class="cmp-empty" style="color:var(--dg)">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    }
  }

  // O chip QUINZENA fica aceso tanto na quinzena fechada quanto no rolante.
  function chipAtivo(key) {
    return key === 'quinzena' ? (_periodo === 'quinzena' || _periodo === 'quinzena15') : (_periodo === key);
  }
  function renderPeriodChips() {
    const el = document.getElementById('cmp-per');
    if (!el) return;
    el.innerHTML = PERIODOS.map(p =>
      '<button class="cmp-chip' + (chipAtivo(p.key) ? ' on' : '') + '" onclick="__cmpPeriodo(\'' + p.key + '\')">' + p.label + '</button>'
    ).join('');
  }

  // Sub-chips FECHADA / ÚLTIMOS 15 DIAS — só quando QUINZENA está ativo.
  function renderSubQuinzena() {
    const el = document.getElementById('cmp-subq');
    if (!el) return;
    if (_periodo !== 'quinzena' && _periodo !== 'quinzena15') { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML =
      '<button class="cmp-chip' + (_periodo === 'quinzena' ? ' on' : '') + '" onclick="__cmpSubQ(\'fechada\')">FECHADA</button>' +
      '<button class="cmp-chip' + (_periodo === 'quinzena15' ? ' on' : '') + '" onclick="__cmpSubQ(\'rolante\')">ÚLTIMOS 15 DIAS</button>';
  }

  // Navegador [◀] rótulo [▶] intervalo. Some no quinzena15 (rolante).
  function renderNavegador() {
    const el = document.getElementById('cmp-nav');
    if (!el) return;
    const p = _dados && _dados.periodo;
    if (!p || _periodo === 'quinzena15') { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML =
      '<button class="cmp-navbtn" onclick="__cmpNav(\'ant\')"' + (p.tem_anterior ? '' : ' disabled') + '>◀</button>' +
      '<div class="cmp-nav-lbl">' + esc(p.rotulo) + '</div>' +
      '<button class="cmp-navbtn" onclick="__cmpNav(\'prox\')"' + (p.tem_proximo ? '' : ' disabled') + '>▶</button>' +
      '<div class="cmp-nav-int">' + esc(p.intervalo) + '</div>';
  }

  function renderCombChips() {
    const el = document.getElementById('cmp-comb');
    if (!el) return;
    el.innerHTML = COMBS.map(k =>
      '<button class="cmp-chip' + (_comb === k ? ' on' : '') + '" onclick="__cmpComb(\'' + k + '\')">' + esc(k) + '</button>'
    ).join('');
  }

  // ── Seletores de dados (a rota já devolve tudo; aqui só escolhe) ──
  // KPI: TODOS -> base_negociacao; um combustível -> item de por_combustivel.
  function fonteKpi() {
    if (!_dados) return null;
    if (_comb === 'TODOS') return _dados.base_negociacao || null;
    // Derivado das MESMAS linhas do gráfico (por_grupo_combustivel já sem
    // GASMIG/OUTROS_NAO_DISTRIBUIDORA): soma litros e valor, preço médio
    // ponderado (valor/litros, nunca média de médias). Assim a soma das
    // barras sempre fecha com o KPI.
    const linhas = (_dados.por_grupo_combustivel || [])
      .filter(x => x.combustivel === _comb && !GRUPO_FORA.includes(x.grupo));
    if (!linhas.length) return null;
    let litros = 0, valor = 0;
    linhas.forEach(x => { litros += Number(x.litros) || 0; valor += Number(x.valor) || 0; });
    return { litros, valor, preco_medio: litros > 0 ? valor / litros : null };
  }
  // Gráfico: TODOS -> por_grupo (negociavel===true); combustível -> por_grupo_combustivel
  // filtrando o combustível e excluindo GASMIG/OUTROS_NAO_DISTRIBUIDORA.
  function fonteGrafico() {
    if (!_dados) return [];
    let lista;
    if (_comb === 'TODOS') {
      // Mesmo filtro da base_negociacao (fonte do KPI): fora GASMIG/
      // OUTROS_NAO_DISTRIBUIDORA e fora GNV/OCT/POD. Agrega por grupo somando
      // litros+valor; assim a soma das barras fecha com o KPI por construção.
      const acc = {};
      (_dados.por_grupo_combustivel || [])
        .filter(x => !GRUPO_FORA.includes(x.grupo) && !PRODUTO_FORA.includes(x.combustivel))
        .forEach(x => {
          const g = acc[x.grupo] || (acc[x.grupo] = { litros: 0, valor: 0 });
          g.litros += Number(x.litros) || 0;
          g.valor += Number(x.valor) || 0;
        });
      lista = Object.entries(acc).map(([grupo, o]) => ({
        grupo, litros: o.litros, preco_medio: o.litros > 0 ? o.valor / o.litros : null,
      }));
    } else {
      lista = (_dados.por_grupo_combustivel || [])
        .filter(x => x.combustivel === _comb && !GRUPO_FORA.includes(x.grupo))
        .map(x => ({ grupo: x.grupo, litros: Number(x.litros) || 0, preco_medio: x.preco_medio }));
    }
    return lista.sort((a, b) => b.litros - a.litros);
  }
  // Tabela: postos. TODOS usa litros/valor/preco do posto; combustível usa
  // posto.combustiveis[X] e omite quem não tem aquele combustível.
  function fontePostos() {
    if (!_dados) return [];
    const rows = (_dados.postos || []).map(p => {
      let litros, preco;
      if (_comb === 'TODOS') {
        litros = Number(p.litros) || 0; preco = p.preco_medio;
      } else {
        const cb = p.combustiveis && p.combustiveis[_comb];
        if (!cb) return null;                 // omite postos sem esse combustível
        litros = Number(cb.litros) || 0; preco = cb.preco_medio;
      }
      // Fornecedor = grupos que abasteceram o posto, menos os não-distribuidora.
      const forn = (p.grupos || [])
        .filter(g => !GRUPO_FORA.includes(g.grupo))
        .map(g => g.grupo);
      return { nome: p.nome, fornecedor: forn.length ? forn.join(' + ') : '—', litros, preco };
    }).filter(Boolean);
    return rows.sort((a, b) => b.litros - a.litros);
  }

  function renderBody() {
    const body = document.getElementById('cmp-body');
    if (!body) return;
    if (!_dados) { body.innerHTML = '<div class="cmp-empty">Sem compras no período</div>'; return; }

    const kpi = fonteKpi();
    const grafico = fonteGrafico();
    const postos = fontePostos();

    const semDados = (!kpi || !(Number(kpi.litros) > 0)) && !grafico.length && !postos.length;
    if (semDados) { body.innerHTML = '<div class="cmp-empty">Sem compras no período</div>'; return; }

    const k = kpi || { litros: 0, valor: 0, preco_medio: null };
    const rotComb = (_comb === 'TODOS') ? 'todos os combustíveis' : _comb;

    const kpis =
      '<div class="cmp-kpis">' +
        '<div class="cmp-kpi"><div class="cmp-kpi-lbl">Litros comprados</div>' +
          '<div class="cmp-kpi-val">' + fmtLitros(k.litros) + '</div>' +
          '<div class="cmp-kpi-sub">' + esc(rotComb) + '</div></div>' +
        '<div class="cmp-kpi"><div class="cmp-kpi-lbl">Valor total</div>' +
          '<div class="cmp-kpi-val">R$ ' + fmtReais(k.valor) + '</div>' +
          '<div class="cmp-kpi-sub">nota fiscal</div></div>' +
        '<div class="cmp-kpi"><div class="cmp-kpi-lbl">Preço médio</div>' +
          '<div class="cmp-kpi-val">R$ ' + fmtPreco(k.preco_medio) + '</div>' +
          '<div class="cmp-kpi-sub">ponderado por litro · R$/L</div></div>' +
      '</div>';

    const nota = (_dados.ultima_importacao && _dados.ultima_importacao.em)
      ? '<div class="cmp-nota">Última importação: ' + brData(String(_dados.ultima_importacao.em).slice(0, 10)) + '.</div>'
      : '';

    body.innerHTML = kpis + renderChart(grafico) + renderTabela(postos) + nota;
  }

  // ── Gráfico de colunas VERTICAIS (sem lib), eixo em ZERO ─────────
  function renderChart(grafico) {
    const titulo = 'Volume por distribuidora — ' + esc(_comb === 'TODOS' ? 'todos' : _comb);
    if (!grafico.length) {
      return '<div class="cmp-card"><div class="cmp-card-title">' + titulo + '</div>' +
        '<div class="cmp-empty">Sem compras no período</div></div>';
    }
    const max = Math.max(...grafico.map(g => g.litros));
    const cols = grafico.map(g => {
      const h = (max > 0) ? (g.litros / max) * 100 : 0;   // eixo em ZERO
      return '<div class="cmp-col">' +
        '<div class="cmp-colval">' + fmtLitros(g.litros) + '</div>' +
        '<div class="cmp-col-plot"><div class="cmp-bar" style="height:' + h + '%"></div></div>' +
        '<div class="cmp-colnome">' + esc(g.grupo) + '</div>' +
        '<div class="cmp-colpreco">R$ ' + fmtPreco(g.preco_medio) + '/L</div>' +
      '</div>';
    }).join('');
    return '<div class="cmp-card"><div class="cmp-card-title">' + titulo + '</div>' +
      '<div class="cmp-chart">' + cols + '</div></div>';
  }

  // ── Tabela de postos (ordenada por litros desc) ──────────────────
  function renderTabela(postos) {
    if (!postos.length) {
      return '<div class="cmp-card"><div class="cmp-card-title">Postos</div>' +
        '<div class="cmp-empty">Sem compras no período</div></div>';
    }
    const head = '<tr><th>Posto</th><th>Fornecedor</th><th>Litros</th><th>Preço médio</th></tr>';
    const rows = postos.map(p =>
      '<tr>' +
        '<td>' + esc(p.nome) + '</td>' +
        '<td>' + esc(p.fornecedor) + '</td>' +
        '<td>' + fmtLitros(p.litros) + '</td>' +
        '<td>R$ ' + fmtPreco(p.preco) + '</td>' +
      '</tr>'
    ).join('');
    return '<div class="cmp-card"><div class="cmp-card-title">Postos</div>' +
      '<div class="cmp-tbl-wrap"><table class="cmp-tbl"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  // ── Ações públicas ───────────────────────────────────────────────
  // Trocar de TIPO limpa o _ref (volta pro default do backend). O chip
  // QUINZENA entra no modo FECHADA por padrão.
  window.__cmpPeriodo = function (key) {
    _ref = null;
    _periodo = (key === 'quinzena') ? 'quinzena' : key;
    carregar();
  };
  window.__cmpSubQ = function (modo) {
    _ref = null;
    _periodo = (modo === 'rolante') ? 'quinzena15' : 'quinzena';
    carregar();
  };
  // Setas: só mudam o _ref (usa os refs vizinhos que o backend já devolveu).
  window.__cmpNav = function (dir) {
    const p = _dados && _dados.periodo;
    if (!p) return;
    if (dir === 'ant' && !p.tem_anterior) return;
    if (dir === 'prox' && !p.tem_proximo) return;
    const alvo = (dir === 'ant') ? p.ref_anterior : p.ref_proximo;
    if (!alvo) return;
    _ref = alvo;
    carregar();
  };
  // Chip de combustível: filtro CLIENT-SIDE, sem nova chamada à API.
  window.__cmpComb = function (k) {
    if (COMBS.indexOf(k) < 0) return;
    _comb = k;
    renderCombChips();
    renderBody();
  };

  // ── Entrada pública ──────────────────────────────────────────────
  window.renderCompra = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('.cmp-wrap')) montarShell(sec);
    if (!_dados) carregar();
    else { renderPeriodChips(); renderSubQuinzena(); renderNavegador(); renderCombChips(); renderBody(); }
  };
})();
