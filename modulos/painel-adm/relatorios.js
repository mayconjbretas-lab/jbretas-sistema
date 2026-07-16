// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/relatorios.js
// Aba RELATÓRIOS do Painel ADM (desktop). ADITIVO: expõe
// window.renderRelatorios(section), chamado pelo setTab (mesmo padrão
// do renderMedicao / renderColetaRevisao).
//
// Consome GET /relatorios?data=YYYY-MM-DD (agregador da rede: litros
// de combustível, mix de gasolina aditivada e venda de produtos/
// lubrificantes do TecnoX). Três vistas sobre o MESMO fetch:
// Consolidado (tabela) · Mix (ranking) · Produtos (ranking). Cada
// vista tem botão "Copiar p/ WhatsApp" com formato fixo.
// Tema Premium via tokens do painel-adm.css (--tx/--ac/--sf...), então
// segue claro/escuro sozinho. CSS da aba injetado uma vez no shell.
// ================================================================
(function () {
  let _shellPronto = false;
  let _dados       = null;            // resposta do GET /relatorios
  let _dataISO     = null;            // data selecionada (YYYY-MM-DD)

  // Ontem em Brasília, formato en-CA (mesmo default do backend).
  function ontemISO() {
    return new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  // "2026-07-15" -> "15/07/2026"
  function brData(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || '');
  }

  // Nome de exibição: tira o prefixo "P. " e capitaliza natural
  // (MIRAGEM JBRETAS -> "Miragem Jbretas").
  function nomeExib(nome) {
    return String(nome || '')
      .replace(/^P\.\s*/i, '')
      .trim()
      .toLowerCase()
      .replace(/(^|[\s\-])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }

  // ── Formatadores ─────────────────────────────────────────────────
  const fmtL = (v) => (v === null || v === undefined)
    ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const fmtRS = (v) => (v === null || v === undefined)
    ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (v) => (v === null || v === undefined)
    ? '—' : (Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

  // ── Shell da aba (topo + chips + corpo), montado uma vez ─────────
  function montarShell(sec) {
    _dataISO = _dataISO || ontemISO();
    sec.innerHTML =
      '<style>' +
        // Deixa a aba fluir e a .pa-main rolar a página (id vence .scr{display:none}).
        '#s-relat { height: auto; min-height: 100%; }' +
        '#s-relat.active { display: block; }' +
        '#s-relat .rel-wrap { max-width: 1100px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: .9rem; }' +
        '#s-relat .rel-top { display: flex; align-items: center; justify-content: space-between; gap: .8rem; flex-wrap: wrap; }' +
        '#s-relat .rel-title { font-family: var(--mono); font-size: 1rem; font-weight: 700; color: var(--tx); }' +
        '#s-relat .rel-date { background: var(--sf2); border: 1px solid var(--bd); border-radius: 8px; padding: .5rem .7rem; color: var(--tx); font-family: var(--mono); font-size: .82rem; outline: none; }' +
        '#s-relat .rel-date:focus { border-color: var(--ac); }' +
        '#s-relat .rel-chips { display: flex; gap: 6px; flex-wrap: wrap; }' +
        '#s-relat .rel-body { display: flex; flex-direction: column; gap: .9rem; }' +
        '#s-relat .rel-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .9rem; align-items: start; }' +
        '@media (max-width: 900px) { #s-relat .rel-grid2 { grid-template-columns: 1fr; } }' +
        // Telas de celular (~390px): aperta fonte/padding da tabela do consolidado
        // pra caber legível; se ainda estourar, o .cbody rola na horizontal.
        '@media (max-width: 430px) {' +
          '#s-relat .rel-title { font-size: .9rem; }' +
          '#s-relat .rel-table { font-size: .74rem; }' +
          '#s-relat .rel-table th, #s-relat .rel-table td { padding: .4rem .35rem; }' +
          '#s-relat .rel-rank li { font-size: .8rem; padding: .5rem .6rem; }' +
        '}' +
        '#s-relat .rel-copy { background: var(--sf2); border: 1px solid var(--bd); color: var(--tx2); font-family: var(--mono); font-size: .7rem; font-weight: 700; padding: .45rem .8rem; border-radius: 8px; cursor: pointer; white-space: nowrap; transition: all .15s; }' +
        '#s-relat .rel-copy:hover { border-color: var(--ac); color: var(--ac); }' +
        '#s-relat .rel-table { width: 100%; border-collapse: collapse; font-size: .84rem; }' +
        '#s-relat .rel-table th { text-align: left; font-family: var(--mono); font-size: .64rem; text-transform: uppercase; letter-spacing: .05em; color: var(--tx3); padding: .55rem .6rem; border-bottom: 1px solid var(--bd); }' +
        '#s-relat .rel-table td { padding: .55rem .6rem; border-bottom: 1px solid var(--bd); color: var(--tx2); }' +
        '#s-relat .rel-table th.num, #s-relat .rel-table td.num { text-align: right; }' +
        '#s-relat .rel-table td.num { font-family: var(--mono); color: var(--tx); }' +
        '#s-relat .rel-table td.nome { color: var(--tx); font-weight: 600; }' +
        '#s-relat .rel-table tr:hover td { background: var(--sf2); }' +
        '#s-relat .rel-table tr.rel-total td { border-top: 2px solid var(--ac); border-bottom: none; background: var(--acd); color: var(--ac); font-weight: 700; }' +
        '#s-relat .rel-table tr.rel-total:hover td { background: var(--acd); }' +
        '#s-relat .rel-rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }' +
        '#s-relat .rel-rank li { display: flex; align-items: baseline; gap: .5rem; padding: .55rem .75rem; background: var(--sf2); border: 1px solid var(--bd); border-radius: 8px; font-size: .86rem; }' +
        '#s-relat .rel-rank li:first-child { border-color: var(--ac); background: var(--acd); }' +
        '#s-relat .rel-rank .rk-pos { font-family: var(--mono); font-weight: 700; color: var(--tx3); min-width: 1.6rem; }' +
        '#s-relat .rel-rank .rk-nome { flex: 1; color: var(--tx); font-weight: 600; }' +
        '#s-relat .rel-rank .rk-val { font-family: var(--mono); font-weight: 700; color: var(--ac); white-space: nowrap; }' +
      '</style>' +
      '<div class="rel-wrap">' +
        '<div class="rel-top">' +
          '<div class="rel-title">📊 Relatórios — Rede</div>' +
          '<input type="date" class="rel-date" id="rel-data" value="' + _dataISO + '">' +
        '</div>' +
        // Chips = âncoras de rolagem (scrollIntoView suave até o card); NÃO alternam
        // vistas — os 3 cards ficam todos visíveis.
        '<div class="rel-chips">' +
          '<button class="fueltab" onclick="__relScroll(\'consolidado\')">📊 Consolidado</button>' +
          '<button class="fueltab" onclick="__relScroll(\'mix\')">🥇 Mix G. Aditivada</button>' +
          '<button class="fueltab" onclick="__relScroll(\'produtos\')">🛢️ Venda de Produtos</button>' +
        '</div>' +
        '<div class="rel-body" id="rel-body"><div class="empty">Carregando…</div></div>' +
      '</div>';
    const inp = sec.querySelector('#rel-data');
    inp.onchange = () => carregar(inp.value);
    _shellPronto = true;
  }

  // ── Carrega os dados de uma data (GET /relatorios?data=) ─────────
  async function carregar(iso) {
    _dataISO = iso;
    const body = document.getElementById('rel-body');
    if (body) body.innerHTML = '<div class="empty">Carregando…</div>';
    try {
      _dados = await apiFetch('/relatorios?data=' + encodeURIComponent(iso));
      renderVista();
    } catch (err) {
      _dados = null;
      if (body) body.innerHTML = '<div class="empty" style="color:var(--dg)">Erro ao carregar: ' + (err.message || err) + '</div>';
    }
  }

  // ── Render: tudo numa tela só — consolidado em cima, mix + produtos
  //    lado a lado abaixo (grid 2 col; empilha em <900px). ────────────
  function renderVista() {
    const body = document.getElementById('rel-body');
    if (!body) return;
    if (!_dados) { body.innerHTML = '<div class="empty">Carregando…</div>'; return; }
    body.innerHTML =
      renderConsolidado() +
      '<div class="rel-grid2">' + renderMix() + renderProdutos() + '</div>';
  }

  // Card com cabeçalho (título + subtítulo opcional + botão copiar).
  function cardCabecalho(titulo, sub, tipo, inner) {
    return '<div class="card" id="rel-card-' + tipo + '">' +
      '<div class="chdr" style="display:flex;justify-content:space-between;align-items:center;gap:.6rem">' +
        '<div><div class="ctitle">' + titulo + '</div>' + (sub ? '<div class="csub">' + sub + '</div>' : '') + '</div>' +
        '<button class="rel-copy" onclick="__relCopiar(\'' + tipo + '\', this)">📋 Copiar p/ WhatsApp</button>' +
      '</div>' +
      '<div class="cbody" style="overflow-x:auto">' + inner + '</div>' +
    '</div>';
  }

  function renderConsolidado() {
    const d = _dados;
    const linhas = (d.postos || []).map(p =>
      '<tr>' +
        '<td class="nome">' + nomeExib(p.posto) + '</td>' +
        '<td class="num">' + (p.litros == null ? '—' : fmtL(p.litros) + ' L') + '</td>' +
        '<td class="num">' + fmtRS(p.lubrificantes_rs) + '</td>' +
        '<td class="num">' + fmtPct(p.mix) + '</td>' +
      '</tr>'
    ).join('');
    const t = d.totais || {};
    const total =
      '<tr class="rel-total">' +
        '<td>🏆 TOTAL REDE</td>' +
        '<td class="num">' + fmtL(t.litros) + ' L</td>' +
        '<td class="num">' + fmtRS(t.lubrificantes_rs) + '</td>' +
        '<td class="num">' + fmtPct(t.mix) + '</td>' +
      '</tr>';
    const tabela =
      '<table class="rel-table">' +
        '<thead><tr>' +
          '<th>Posto</th><th class="num">Combust. (L)</th><th class="num">Lubrif. (R$)</th><th class="num">Mix GA</th>' +
        '</tr></thead>' +
        '<tbody>' + linhas + total + '</tbody>' +
      '</table>';
    return cardCabecalho('Consolidado da rede', '', 'consolidado', tabela);
  }

  function renderMix() {
    const rank = (_dados.postos || []).filter(p => p.mix != null).sort((a, b) => b.mix - a.mix);
    const inner = rank.length
      ? '<ul class="rel-rank">' + rank.map((p, i) =>
          '<li><span class="rk-pos">' + (i + 1) + '.</span><span class="rk-nome">' + nomeExib(p.posto) + '</span><span class="rk-val">' + fmtPct(p.mix) + '</span></li>'
        ).join('') + '</ul>'
      : '<div class="empty">Sem dados de mix para esta data.</div>';
    return cardCabecalho('🥇 Mix de Gasolina Aditivada', '% do volume de gasolina', 'mix', inner);
  }

  function renderProdutos() {
    const comDados = (_dados.postos || []).filter(p => p.lubrificantes_rs != null);
    let inner;
    if (!comDados.length) {
      inner = '<div class="empty">🛢️ Aguardando dados TecnoX</div>';
    } else {
      const rank = comDados.slice().sort((a, b) => b.lubrificantes_rs - a.lubrificantes_rs);
      inner = '<ul class="rel-rank">' + rank.map((p, i) =>
        '<li><span class="rk-pos">' + (i + 1) + '.</span><span class="rk-nome">' + nomeExib(p.posto) + '</span><span class="rk-val">' + fmtRS(p.lubrificantes_rs) + '</span></li>'
      ).join('') + '</ul>';
    }
    return cardCabecalho('🛢️ Venda de Produtos', 'sem combustível, R$', 'produtos', inner);
  }

  // ── Textos do WhatsApp (formatos fixos) ──────────────────────────
  const HR = '━━━━━━━━━━━━━━━';

  function textoConsolidado() {
    const d = _dados; if (!d) return '';
    const linhas = ['📊 *RELATÓRIO DIÁRIO — ' + brData(d.data) + '*', HR];
    (d.postos || []).forEach(p => {
      const l = p.litros == null ? '—' : fmtL(p.litros) + 'L';
      const r = p.lubrificantes_rs == null ? '—' : fmtRS(p.lubrificantes_rs);
      const m = p.mix == null ? '—' : fmtPct(p.mix);
      linhas.push('- ' + nomeExib(p.posto) + ': ' + l + ' | ' + r + ' | ' + m);
    });
    const t = d.totais || {};
    linhas.push(HR);
    linhas.push('🏆 *TOTAL REDE*');
    linhas.push('⛽ Combustível: *' + fmtL(t.litros) + ' L*');
    linhas.push('🛢️ Produtos: *' + fmtRS(t.lubrificantes_rs) + '*');
    return linhas.join('\n');
  }

  function textoMix() {
    const d = _dados; if (!d) return '';
    const rank = (d.postos || []).filter(p => p.mix != null).sort((a, b) => b.mix - a.mix);
    const linhas = ['🟢 *MIX DE GASOLINA ADITIVADA*', '(% do volume de gasolina)'];
    rank.forEach((p, i) => linhas.push((i + 1) + '. ' + nomeExib(p.posto) + ' — ' + fmtPct(p.mix)));
    return linhas.join('\n');
  }

  function textoProdutos() {
    const d = _dados; if (!d) return '';
    const rank = (d.postos || []).filter(p => p.lubrificantes_rs != null).sort((a, b) => b.lubrificantes_rs - a.lubrificantes_rs);
    const linhas = ['🟢 *VENDA DE PRODUTOS*', '(sem combustível, R$)'];
    rank.forEach((p, i) => linhas.push((i + 1) + '. ' + nomeExib(p.posto) + ' — ' + fmtRS(p.lubrificantes_rs)));
    return linhas.join('\n');
  }

  // ── Ações públicas (chamadas pelos onclick inline) ───────────────
  // Âncora de rolagem: leva suave até o card do tipo, sem esconder os outros.
  window.__relScroll = function (tipo) {
    const el = document.getElementById('rel-card-' + tipo);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.__relCopiar = function (tipo, btn) {
    const texto = tipo === 'mix' ? textoMix()
                : tipo === 'produtos' ? textoProdutos()
                : textoConsolidado();
    const feedback = () => {
      const orig = btn.textContent;
      btn.textContent = '✓ Copiado!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(feedback).catch(() => {
        window.prompt('Copie o texto abaixo:', texto);
      });
    } else {
      window.prompt('Copie o texto abaixo:', texto);
    }
  };

  // ── Entrada pública (chamada pelo setTab) ────────────────────────
  window.renderRelatorios = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('#rel-data')) montarShell(sec);
    if (!_dados) carregar(_dataISO);  // primeira abertura busca; depois só re-renderiza
    else renderVista();
  };
})();
