// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/relatorios.js
// Aba RELATÓRIOS do Painel ADM (desktop). ADITIVO: expõe
// window.renderRelatorios(section), chamado pelo setTab (mesmo padrão
// do renderMedicao / renderColetaRevisao).
//
// Três vistas, cada uma com seu fetch e seu botão "Copiar p/ WhatsApp":
//  · Consolidado — GET /relatorios?data= (modo Dia, cruza medicao × TecnoX)
//                  ou GET /relatorios?inicio&fim (modo Período, rollup)
//  · Mix         — GET /relatorios/mix-periodo      (rollup)
//  · Produtos    — GET /relatorios/produtos-periodo (rollup)
//
// FONTE: as três vistas por PERÍODO leem o rollup da TecnoX
// (tecnox_venda_dia + tecnox_venda_produto_dia). Até 28/08/2026 liam
// vendas_tecnox, a planilha do supervisor, que cobria 24 dos 37 postos
// em gasolina e 29 em produtos. O modo Dia do Consolidado é o único que
// ainda usa a planilha, porque ele compara a medicao do gerente com o
// que a TecnoX registrou no mesmo dia.
// Tema Premium via tokens do painel-adm.css (--tx/--ac/--sf...), então
// segue claro/escuro sozinho. CSS da aba injetado uma vez no shell.
// ================================================================
(function () {
  let _shellPronto = false;
  let _dados       = null;            // resposta do GET /relatorios
  let _dataISO     = null;            // data selecionada (YYYY-MM-DD)
  // Card de Mix tem JANELA PRÓPRIA (período), independente do #rel-data diário.
  let _mixDados    = null;            // resposta do GET /relatorios/mix-periodo
  let _mixInicio   = null;            // início do período do Mix (YYYY-MM-DD)
  let _mixFim      = null;            // fim do período do Mix (YYYY-MM-DD)
  // Consolidado: alterna Dia (padrão) × Período. Período tem janela própria
  // (default = MESMO ciclo do card Mix, via _mixInicio/_mixFim do backend).
  let _consModo    = 'dia';
  let _consInicio  = null;
  let _consFim     = null;
  let _consDados   = null;            // resposta do GET /relatorios?inicio&fim
  // Venda de Produtos passou a ser por PERÍODO (antes vinha do fetch diário) e
  // usa a MESMA janela do card de Mix: um controle de período serve os dois
  // rankings, e os números ficam comparáveis entre eles.
  let _prodDados   = null;            // resposta do GET /relatorios/produtos-periodo

  // Fetch em voo, por card. Existe para o Copiar p/ WhatsApp NÃO mandar o
  // período anterior quando o usuário troca a data e clica logo em seguida —
  // sem isso o texto sai com os números velhos, sem nenhum aviso.
  let _diaCarregando  = false;
  let _mixCarregando  = false;
  let _prodCarregando = false;
  let _consCarregando = false;

  // Ontem em Brasília, formato en-CA (mesmo default do backend).
  function ontemISO() {
    return new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  // Hoje em Brasília (en-CA) — p/ detectar ciclo de Mix "em andamento" (fim futuro).
  function hojeISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  // "2026-07-15" -> "15/07/2026"
  function brData(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || '');
  }

  // "2026-07-15" -> "15/07" (rótulo curto de período do Mix).
  function brDataCurta(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}` : String(iso || '');
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
        // Contagem de dias lançados do posto — discreta, denuncia buraco de lançamento.
        '#s-relat .rel-rank .rk-dias { font-family: var(--mono); font-size: .7rem; color: var(--tx3); white-space: nowrap; }' +
        '#s-relat .rel-rank .rk-val { font-family: var(--mono); font-weight: 700; color: var(--ac); white-space: nowrap; }' +
        // Inputs de período do card de Mix (mesmo visual do .rel-date do topo).
        '#s-relat .rel-mixwin { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }' +
        '#s-relat .rel-mixwin input.rel-date { font-size: .74rem; padding: .35rem .45rem; }' +
        '#s-relat .rel-mixwin .rel-sep { color: var(--tx3); }' +
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
    ligarGuarda(sec);
    _shellPronto = true;
  }

  // ── Carrega os dados de uma data (GET /relatorios?data=) ─────────
  async function carregar(iso) {
    _dataISO = iso;
    const body = document.getElementById('rel-body');
    if (body) body.innerHTML = '<div class="empty">Carregando…</div>';
    _diaCarregando = true;
    try {
      _dados = await apiFetch('/relatorios?data=' + encodeURIComponent(iso));
      renderVista();
    } catch (err) {
      _dados = null;
      if (body) body.innerHTML = '<div class="empty" style="color:var(--dg)">Erro ao carregar: ' + (err.message || err) + '</div>';
    } finally {
      _diaCarregando = false;
    }
  }

  // ── Carrega o Mix POR PERÍODO (GET /relatorios/mix-periodo) ──────
  // Sem inicio/fim → backend usa o ciclo de vendas corrente (21→20) e
  // devolve a janela usada, que passa a alimentar os dois date inputs.
  async function carregarMix(inicio, fim) {
    const qs = (inicio && fim)
      ? '?inicio=' + encodeURIComponent(inicio) + '&fim=' + encodeURIComponent(fim)
      : '';
    _mixCarregando = true;
    try {
      _mixDados  = await apiFetch('/relatorios/mix-periodo' + qs);
      _mixInicio = _mixDados.inicio;
      _mixFim    = _mixDados.fim;
    } catch (err) {
      _mixInicio = inicio || _mixInicio;
      _mixFim    = fim    || _mixFim;
      _mixDados  = { inicio: _mixInicio, fim: _mixFim, postos: [], total: {}, _erro: (err.message || err) };
    } finally {
      _mixCarregando = false;
    }
    renderVista();
    // Produtos usa a janela do Mix. Vai DEPOIS de propósito: sem inicio/fim o
    // backend resolve o ciclo corrente (21→20) e só aqui sabemos qual foi —
    // assim a conta do ciclo não é repetida no front.
    carregarProdutos(_mixInicio, _mixFim);
  }

  // ── Carrega Venda de Produtos por PERÍODO ────────────────────────
  // GET /relatorios/produtos-periodo — soma LUBRIFICANTE + PRODUTO do rollup
  // da TecnoX. Mesma janela do card de Mix.
  async function carregarProdutos(inicio, fim) {
    const qs = (inicio && fim)
      ? '?inicio=' + encodeURIComponent(inicio) + '&fim=' + encodeURIComponent(fim)
      : '';
    _prodCarregando = true;
    try {
      _prodDados = await apiFetch('/relatorios/produtos-periodo' + qs);
    } catch (err) {
      _prodDados = { inicio, fim, postos: [], total: {}, _erro: (err.message || err) };
    } finally {
      _prodCarregando = false;
    }
    renderVista();
  }

  // ── Carrega o Consolidado por PERÍODO (GET /relatorios?inicio&fim) ──
  async function carregarConsPeriodo(inicio, fim) {
    _consInicio = inicio; _consFim = fim;
    _consCarregando = true;
    try {
      _consDados = await apiFetch('/relatorios?inicio=' + encodeURIComponent(inicio) + '&fim=' + encodeURIComponent(fim));
    } catch (err) {
      _consDados = { modo: 'periodo', inicio, fim, postos: [], totais: {}, _erro: (err.message || err) };
    } finally {
      _consCarregando = false;
    }
    renderVista();
  }

  // ── Guarda de re-render durante o clique ─────────────────────────
  // renderVista() troca o innerHTML do #rel-body INTEIRO. Se isso acontecer
  // entre o mousedown e o mouseup de um clique, o nó que recebeu o mousedown
  // sai do documento e o navegador NUNCA dispara o 'click' — o botão não
  // responde, e não há erro no console para denunciar.
  //
  // Era o bug do "Copiar p/ WhatsApp" do Mix: o botão fica no mesmo bloco dos
  // dois inputs de data, então clicar nele faz o input perder o foco, o
  // 'change' disparar, o fetch voltar e o card ser recriado no meio do clique.
  // Medido num DOM: com o fetch respondendo em até ~60ms o clique se perde;
  // acima disso ele passa, mas copia o período ANTERIOR (ver __relCopiar). Por
  // ser corrida, falhava de forma intermitente. O Consolidado em modo Período
  // tem o mesmo desenho e o mesmo problema.
  //
  // Enquanto o ponteiro está pressionado o render fica pendente e é aplicado no
  // pointerup. O timeout é rede de segurança: se o pointerup nunca chegar
  // (ponteiro sai da janela, gesto cancelado), o render não pode ficar preso.
  let _guardaLigada   = false;
  let _pointerDown    = false;
  let _renderPendente = false;
  let _guardaTimer    = null;

  function soltarGuarda() {
    _pointerDown = false;
    if (_guardaTimer) { clearTimeout(_guardaTimer); _guardaTimer = null; }
    if (_renderPendente) { _renderPendente = false; renderVista(); }
  }

  function ligarGuarda(sec) {
    if (_guardaLigada) return;
    _guardaLigada = true;
    sec.addEventListener('pointerdown', () => {
      _pointerDown = true;
      if (_guardaTimer) clearTimeout(_guardaTimer);
      _guardaTimer = setTimeout(soltarGuarda, 1000);
    });
    // up/cancel no DOCUMENTO, não na seção: se o usuário arrasta e solta fora,
    // o pointerup não passa pela seção e a guarda ficaria presa até o timeout.
    document.addEventListener('pointerup', soltarGuarda);
    document.addEventListener('pointercancel', soltarGuarda);
  }

  // ── Render: tudo numa tela só — consolidado em cima, mix + produtos
  //    lado a lado abaixo (grid 2 col; empilha em <900px). ────────────
  function renderVista() {
    const body = document.getElementById('rel-body');
    if (!body) return;
    if (_pointerDown) { _renderPendente = true; return; }
    // Os três cards têm fetch próprio e cada um trata seu próprio "carregando",
    // então NÃO abortamos aqui: cada card aparece quando o dele chega, sem um
    // wipar o outro.
    body.innerHTML =
      renderConsolidado() +
      '<div class="rel-grid2">' + renderMixCard() + renderProdutos() + '</div>';
    bindMixInputs();
  }

  // (Re)liga os handlers dos dois date inputs do card de Mix — o innerHTML
  // acima recria os elementos a cada render, então rebinda toda vez.
  function bindMixInputs() {
    const ini = document.getElementById('rel-mix-ini');
    const fim = document.getElementById('rel-mix-fim');
    const disparar = () => {
      const i = document.getElementById('rel-mix-ini');
      const f = document.getElementById('rel-mix-fim');
      if (i && f && i.value && f.value) carregarMix(i.value, f.value);
    };
    if (ini) ini.onchange = disparar;
    if (fim) fim.onchange = disparar;
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
    const modo = _consModo;
    const d = modo === 'periodo' ? _consDados : _dados;

    // Botões de modo (visual dos chips .fueltab; ativo = .active).
    const toggle =
      '<div class="rel-chips" style="gap:6px">' +
        '<button class="fueltab' + (modo === 'dia' ? ' active' : '') + '" onclick="__relConsModo(\'dia\')">Dia</button>' +
        '<button class="fueltab' + (modo === 'periodo' ? ' active' : '') + '" onclick="__relConsModo(\'periodo\')">Período</button>' +
      '</div>';
    // Período tem janela própria; Dia usa o input único do TOPO (#rel-data), como já era.
    const controles = modo === 'periodo'
      ? '<div class="rel-mixwin">' +
          '<input type="date" class="rel-date" id="rel-cons-ini" value="' + (_consInicio || '') + '" onchange="__relConsPeriodoInput()">' +
          '<span class="rel-sep">→</span>' +
          '<input type="date" class="rel-date" id="rel-cons-fim" value="' + (_consFim || '') + '" onchange="__relConsPeriodoInput()">' +
        '</div>'
      : '';

    // Subtítulo: dia → a data; período → "ciclo DD/MM a DD/MM".
    let sub;
    if (modo === 'periodo') {
      const i = (d && d.inicio) || _consInicio, f = (d && d.fim) || _consFim;
      sub = (i && f) ? ('ciclo ' + brDataCurta(i) + ' a ' + brDataCurta(f)) : '';
    } else {
      const dd = (d && d.data) || _dataISO;
      sub = dd ? brData(dd) : '';
    }

    // Corpo — colunas/rótulos vêm de d.modo (não dos params).
    let inner;
    if (d && d._erro) {
      inner = '<div class="empty" style="color:var(--dg)">Erro ao carregar: ' + d._erro + '</div>';
    } else if (!d) {
      inner = '<div class="empty">Carregando…</div>';
    } else {
      const ehPer = d.modo === 'periodo';
      // "Nd" com o visual discreto do badge do card Mix (.rk-dias é escopado em
      // .rel-rank e não vale na tabela, então replicamos inline).
      const nd = (v) => '<span style="font-family:var(--mono);font-size:.7rem;color:var(--tx3);white-space:nowrap">' + v + 'd</span>';
      // Período: ordena alfabético por nome no FRONT (não confia na ordem do backend).
      let postos = (d.postos || []);
      if (ehPer) postos = postos.slice().sort((a, b) => nomeExib(a.posto).localeCompare(nomeExib(b.posto)));
      const linhas = postos.map(p => ehPer
        ? '<tr>' +
            '<td class="nome">' + nomeExib(p.posto) + '</td>' +
            '<td class="num">' + (p.gasolina_litros == null ? '—' : fmtL(p.gasolina_litros) + ' L') + '</td>' +
            '<td class="num">' + fmtRS(p.produtos_rs) + '</td>' +
            '<td class="num">' + fmtPct(p.mix) + '</td>' +
            '<td class="num">' + nd(p.dias) + '</td>' +
          '</tr>'
        : '<tr>' +
            '<td class="nome">' + nomeExib(p.posto) + '</td>' +
            '<td class="num">' + (p.litros == null ? '—' : fmtL(p.litros) + ' L') + '</td>' +
            '<td class="num">' + fmtRS(p.lubrificantes_rs) + '</td>' +
            '<td class="num">' + fmtPct(p.mix) + '</td>' +
          '</tr>'
      ).join('');
      const t = d.totais || {};
      const total = ehPer
        ? '<tr class="rel-total">' +
            '<td>🏆 TOTAL REDE</td>' +
            '<td class="num">' + (t.gasolina_litros == null ? '—' : fmtL(t.gasolina_litros) + ' L') + '</td>' +
            '<td class="num">' + fmtRS(t.produtos_rs) + '</td>' +
            '<td class="num">' + fmtPct(t.mix) + '</td>' +
            '<td class="num">' + nd(t.dias_max || 0) + '</td>' +
          '</tr>'
        : '<tr class="rel-total">' +
            '<td>🏆 TOTAL REDE</td>' +
            '<td class="num">' + fmtL(t.litros) + ' L</td>' +
            '<td class="num">' + fmtRS(t.lubrificantes_rs) + '</td>' +
            '<td class="num">' + fmtPct(t.mix) + '</td>' +
          '</tr>';
      const head = ehPer
        // "Produtos" e não "Lubrif.": a coluna sempre somou lubrificante +
        // produto, e no rollup isso fica explícito (grupos LUBRIFICANTE e PRODUTO).
        ? '<th>Posto</th><th class="num">Gasolina (L)</th><th class="num">Produtos (R$)</th><th class="num">Mix GA</th><th class="num">Nd</th>'
        : '<th>Posto</th><th class="num">Combust. (L)</th><th class="num">Lubrif. (R$)</th><th class="num">Mix GA (dia)</th>';
      inner = '<table class="rel-table"><thead><tr>' + head + '</tr></thead><tbody>' + linhas + total + '</tbody></table>';
    }

    return '<div class="card" id="rel-card-consolidado">' +
      '<div class="chdr" style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;flex-wrap:wrap">' +
        '<div><div class="ctitle">Consolidado da rede</div>' + (sub ? '<div class="csub">' + sub + '</div>' : '') + '</div>' +
        '<div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">' +
          toggle + controles +
          '<button class="rel-copy" onclick="__relCopiar(\'consolidado\', this)">📋 Copiar p/ WhatsApp</button>' +
        '</div>' +
      '</div>' +
      '<div class="cbody" style="overflow-x:auto">' + inner + '</div>' +
    '</div>';
  }

  // Card do Mix: janela PRÓPRIA (dois date inputs) + ranking agregado do
  // período vindo de /relatorios/mix-periodo. Markup próprio (não usa
  // cardCabecalho) pra caber os inputs no cabeçalho ao lado do Copiar.
  function renderMixCard() {
    const d = _mixDados;
    const iniVal = _mixInicio || (d && d.inicio) || '';
    const fimVal = _mixFim    || (d && d.fim)    || '';
    let sub, inner;
    if (!d) {
      sub   = '% do volume de gasolina';
      inner = '<div class="empty">Carregando…</div>';
    } else if (d._erro) {
      sub   = '% do volume de gasolina';
      inner = '<div class="empty" style="color:var(--dg)">Erro ao carregar: ' + d._erro + '</div>';
    } else {
      const tot  = d.total || {};
      const rank = (d.postos || []).filter(p => p.mix != null);  // backend já ordena; null fora
      // Ciclo "em andamento" = fim ainda não passou (hoje <= fim): a cobertura é
      // PARCIAL e cresce a cada dia. Deixar explícito — o "1 dias lançados" cru era
      // lido como dado faltando, quando é ciclo aberto há 1 dia. Também mostra
      // quantos postos já têm mix (o denominador da rede não vem no payload).
      const emAndamento = d.fim >= hojeISO();
      const dias = tot.dias_max || 0;
      const diasTxt = dias + (dias === 1 ? ' dia' : ' dias') + ' lançados';
      const estado = emAndamento ? ('🟡 em andamento · ' + diasTxt + ' até agora') : diasTxt;
      // Cobertura com DENOMINADOR da rede: "N de 37". Antes era só a contagem
      // do que chegou ("23 postos com mix"), que não denunciava os 14 ausentes.
      const naRede = tot.postos_na_rede || rank.length;
      const nPostos = rank.length + ' de ' + naRede + ' postos';
      sub = 'ciclo ' + brDataCurta(d.inicio) + ' a ' + brDataCurta(d.fim) + ' · ' + estado + ' · ' + nPostos;
      inner = rank.length
        ? '<ul class="rel-rank">' + rank.map((p, i) =>
            '<li><span class="rk-pos">' + (i + 1) + '.</span>' +
            '<span class="rk-nome">' + nomeExib(p.nome) + '</span>' +
            '<span class="rk-dias">' + p.dias + 'd</span>' +
            '<span class="rk-val">' + fmtPct(p.mix) + '</span></li>'
          ).join('') + '</ul>'
        : '<div class="empty">Sem dados de mix para este período.</div>';
    }
    return '<div class="card" id="rel-card-mix">' +
      '<div class="chdr" style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;flex-wrap:wrap">' +
        '<div><div class="ctitle">🥇 Mix de Gasolina Aditivada</div><div class="csub">' + sub + '</div></div>' +
        '<div class="rel-mixwin">' +
          '<input type="date" class="rel-date" id="rel-mix-ini" value="' + iniVal + '">' +
          '<span class="rel-sep">→</span>' +
          '<input type="date" class="rel-date" id="rel-mix-fim" value="' + fimVal + '">' +
          '<button class="rel-copy" onclick="__relCopiar(\'mix\', this)">📋 Copiar p/ WhatsApp</button>' +
        '</div>' +
      '</div>' +
      '<div class="cbody" style="overflow-x:auto">' + inner + '</div>' +
    '</div>';
  }

  // Ranking de venda de produtos no PERÍODO do card de Mix (mesma janela).
  // LUBRIFICANTE e PRODUTO somam num número só — o split vai no title da linha,
  // que informa sem partir a tela em duas listas.
  function renderProdutos() {
    const d = _prodDados;
    const SUB = 'sem combustível, R$';
    if (!d) return cardCabecalho('🛢️ Venda de Produtos', SUB, 'produtos', '<div class="empty">Carregando…</div>');
    if (d._erro) {
      return cardCabecalho('🛢️ Venda de Produtos', SUB, 'produtos',
        '<div class="empty" style="color:var(--dg)">Erro ao carregar: ' + d._erro + '</div>');
    }
    const tot  = d.total || {};
    const rank = (d.postos || []).filter(p => p.produtos_rs != null);   // backend já ordena
    // Denominador da rede: o card mostrava 29 postos sem dizer que a rede tem 37.
    const naRede = tot.postos_na_rede || rank.length;
    const sub = 'ciclo ' + brDataCurta(d.inicio) + ' a ' + brDataCurta(d.fim) +
      ' · ' + rank.length + ' de ' + naRede + ' postos · ' + SUB;
    const inner = rank.length
      ? '<ul class="rel-rank">' + rank.map((p, i) => {
          const t = (p.lubrificante_rs != null && p.produto_rs != null)
            ? ' title="lubrificante ' + fmtRS(p.lubrificante_rs) + ' + produto ' + fmtRS(p.produto_rs) + '"'
            : '';
          return '<li' + t + '><span class="rk-pos">' + (i + 1) + '.</span>' +
            '<span class="rk-nome">' + nomeExib(p.nome) + '</span>' +
            '<span class="rk-dias">' + p.dias + 'd</span>' +
            '<span class="rk-val">' + fmtRS(p.produtos_rs) + '</span></li>';
        }).join('') + '</ul>'
      : '<div class="empty">Sem venda de produtos neste período.</div>';
    return cardCabecalho('🛢️ Venda de Produtos', sub, 'produtos', inner);
  }

  // ── Textos do WhatsApp (formatos fixos) ──────────────────────────
  const HR = '━━━━━━━━━━━━━━━';

  function textoConsolidado() {
    const d = _consModo === 'periodo' ? _consDados : _dados;
    if (!d) return '';
    if (!(d.postos || []).length) return '';   // idem: sem postos, nada a copiar
    // Modo PERÍODO: intervalo no cabeçalho + valores do período (gasolina).
    if (d.modo === 'periodo') {
      const linhas = ['📊 *RELATÓRIO — ' + brData(d.inicio) + ' a ' + brData(d.fim) + '*', HR];
      (d.postos || []).slice()
        .sort((a, b) => nomeExib(a.posto).localeCompare(nomeExib(b.posto)))
        .forEach(p => {
          const g = p.gasolina_litros == null ? '—' : fmtL(p.gasolina_litros) + 'L';
          const r = p.produtos_rs == null ? '—' : fmtRS(p.produtos_rs);
          const m = p.mix == null ? '—' : fmtPct(p.mix);
          linhas.push('- ' + nomeExib(p.posto) + ': ' + g + ' | ' + r + ' | ' + m);
        });
      const t = d.totais || {};
      linhas.push(HR, '🏆 *TOTAL REDE*',
        '⛽ Gasolina: *' + fmtL(t.gasolina_litros) + ' L*',
        '🛢️ Produtos: *' + fmtRS(t.produtos_rs) + '*');
      return linhas.join('\n');
    }
    // Modo DIA (formato atual, inalterado).
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
    const d = _mixDados; if (!d) return '';
    const rank = (d.postos || []).filter(p => p.mix != null);  // backend já ordena
    // Sem nenhuma linha, devolve vazio para o __relCopiar avisar "Sem dados".
    // Devolver só o cabeçalho fazia o botão dizer "Copiado!" e o usuário colar
    // um título sozinho no WhatsApp.
    if (!rank.length) return '';
    const linhas = [
      '🟢 *Mix G. Aditivada — ' + brDataCurta(d.inicio) + ' a ' + brDataCurta(d.fim) + '*',
      '(% do volume de gasolina)',
    ];
    rank.forEach((p, i) => linhas.push((i + 1) + '. ' + nomeExib(p.nome) + ' — ' + fmtPct(p.mix) + ' (' + p.dias + 'd)'));
    return linhas.join('\n');
  }

  function textoProdutos() {
    const d = _prodDados; if (!d) return '';
    const rank = (d.postos || []).filter(p => p.produtos_rs != null);   // backend já ordena
    if (!rank.length) return '';   // idem textoMix: nada a copiar, nada de cabeçalho solto
    const linhas = [
      '🟢 *VENDA DE PRODUTOS — ' + brDataCurta(d.inicio) + ' a ' + brDataCurta(d.fim) + '*',
      '(sem combustível, R$)',
    ];
    rank.forEach((p, i) => linhas.push((i + 1) + '. ' + nomeExib(p.nome) + ' — ' + fmtRS(p.produtos_rs) + ' (' + p.dias + 'd)'));
    const t = d.total || {};
    if (t.produtos_rs != null) linhas.push(HR, '🏆 *TOTAL REDE*: ' + fmtRS(t.produtos_rs));
    return linhas.join('\n');
  }

  // ── Ações públicas (chamadas pelos onclick inline) ───────────────
  // Âncora de rolagem: leva suave até o card do tipo, sem esconder os outros.
  window.__relScroll = function (tipo) {
    const el = document.getElementById('rel-card-' + tipo);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Alterna o modo do Consolidado. Período usa o MESMO ciclo do card Mix
  // (janela que o backend devolveu, guardada em _mixInicio/_mixFim).
  window.__relConsModo = function (m) {
    if (m !== 'dia' && m !== 'periodo') return;
    _consModo = m;
    if (m === 'periodo') {
      if (!_consInicio || !_consFim) {
        _consInicio = _mixInicio || ontemISO();
        _consFim    = _mixFim    || ontemISO();
      }
      if (!_consDados) carregarConsPeriodo(_consInicio, _consFim);
      else renderVista();
    } else {
      if (!_dados) carregar(_dataISO); else renderVista();
    }
  };
  window.__relConsPeriodoInput = function () {
    const i = document.getElementById('rel-cons-ini');
    const f = document.getElementById('rel-cons-fim');
    if (i && f && i.value && f.value) carregarConsPeriodo(i.value, f.value);
  };

  // Feedback curto no próprio botão, no mesmo molde do jbCopiar.
  function piscarBotao(btn, msg) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = orig; }, 1800);
  }

  window.__relCopiar = function (tipo, btn) {
    // Recusa copiar com fetch em voo. Sem isto, trocar a data e clicar em
    // seguida manda para o WhatsApp os números do período ANTERIOR, sem aviso —
    // pior que não copiar, porque parece certo.
    const carregando = tipo === 'mix' ? _mixCarregando
                     : tipo === 'produtos' ? _prodCarregando
                     : (_consModo === 'periodo' ? _consCarregando : _diaCarregando);
    if (carregando) { piscarBotao(btn, '⏳ Atualizando…'); return; }
    const texto = tipo === 'mix' ? textoMix()
                : tipo === 'produtos' ? textoProdutos()
                : textoConsolidado();
    // jbCopiar mostra "✓ Copiado!" mesmo para texto vazio (writeText('') resolve).
    // Sem esta guarda o usuário cola nada e acha que copiou.
    if (!texto || !texto.trim()) { piscarBotao(btn, '⚠️ Sem dados'); return; }
    window.jbCopiar(texto, btn);   // helper compartilhado (shared/js/clipboard.js)
  };

  // ── Entrada pública (chamada pelo setTab) ────────────────────────
  window.renderRelatorios = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('#rel-data')) montarShell(sec);
    // Três fetches independentes; cada um chama renderVista ao chegar. Produtos
    // é encadeado por carregarMix, que resolve a janela do ciclo no backend.
    if (!_dados)    carregar(_dataISO);        // Consolidado (modo Dia)
    if (!_mixDados) carregarMix();             // Mix + Produtos (ciclo corrente)
    if (_dados && _mixDados && _prodDados) renderVista();   // reabertura: só re-render
  };
})();
