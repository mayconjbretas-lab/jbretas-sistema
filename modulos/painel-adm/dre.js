// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/dre.js
// Aba DRE do Painel ADM (desktop). ADITIVO: expõe window.renderDre(section),
// chamado pelo setTab (mesmo padrão do renderRelatorios / renderMedicao).
//
// FONTE: GET /dre?inicio&fim&posto_id&agrupar (guard ADM ou LOGISTICA).
// A rota lê `tecnox_categoria_dia`, que é carregada do .xls "Venda de produtos
// por empresa e categoria - ANALITICO" exportado à mão da TecnoX — a API deles
// não expõe categoria de produto nem custo por item. Por isso a cobertura
// depende de quem importou o quê: posto sem arquivo carregado simplesmente não
// aparece, e o total da "Rede toda" é a soma do que EXISTE, não da rede inteira.
// O subtítulo do card diz isso na tela.
//
// PERÍODO DEFAULT = ÚLTIMO MÊS CALENDÁRIO FECHADO (dia 1 ao último dia do mês
// anterior). Ver `mesFechado()`. NÃO é o ciclo 21→20 do `cicloVendas` do
// backend, que é o que as abas de Relatórios usam — aqui a janela é o mês civil
// fechado, por decisão de quem lê a DRE.
//
// ESTA ETAPA IMPLEMENTA SÓ A VISTA "MÊS".
// As outras três (Dia · Por Posto · Projeção) ficam visíveis e DESABILITADAS,
// com tooltip "em breve". Projeção não tem nada implementado de propósito: sem
// uma regra de projeção acordada, qualquer número ali seria invenção — e num
// painel de margem invenção vira decisão de preço.
//
// DUAS REGRAS DE EXIBIÇÃO QUE NÃO SÃO ESTÉTICA
// --------------------------------------------
//  1) "Desconto" na tela é SEMPRE o `desconto_calc` da rota
//     (venda_bruta − venda_liquida). O `desconto_arq`, que a rota também
//     devolve, é o valor cru do relatório e é sabidamente SUBNOTIFICADO pela
//     TecnoX (medido na carga de Araponga: 19.443,40 no arquivo contra
//     28.762,80 de bruta − líquida, que é o que o próprio "Total Geral" do
//     arquivo confirma). Ele existe só para auditoria e NÃO é renderizado em
//     lugar nenhum desta tela. Se um dia aparecer na tela, o desconto da rede
//     passa a ser subnotificado em ~32% sem nada avisando.
//  2) `margem_pct` pode vir null (venda líquida zero). Mostra "—", nunca
//     "0,00%": margem de venda zerada não existe, e 0,00% seria lido como
//     medida real.
//
// margem_pct JÁ vem em pontos percentuais (10.86 = 10,86%). NÃO multiplicar
// por 100 — diferente do fmtPct do relatorios.js, cujas rotas devolvem fração.
//
// Tema Premium via tokens já existentes (--tx/--ac/--sf/--bd/--dg/--ok...),
// resolvidos pela camada de alias do painel-adm.css. Nenhum token novo.
// ================================================================
(function () {
  'use strict';

  // Mesmo guard da rota. Se o perfil não estiver aqui, a tela não chama a API
  // (a rota devolveria 403 e a tela mostraria erro cru).
  var PERFIS_VEEM = ['ADM', 'LOGISTICA'];

  // As 4 sub-abas do topo. `pronta:false` = visível, desabilitada, tooltip.
  var SUBABAS = [
    { id: 'dia',     rotulo: 'Dia',       pronta: false },
    { id: 'mes',     rotulo: 'Mês',       pronta: true  },
    { id: 'posto',   rotulo: 'Por Posto', pronta: false },
    { id: 'projecao', rotulo: 'Projeção', pronta: false },
  ];

  var _shellPronto = false;
  var _dados       = null;   // resposta do GET /dre (agrupar=categoria)
  var _dadosDia    = null;   // resposta do GET /dre (agrupar=dia) — série do gráfico
  var _postos      = null;   // lista do GET /postos (cache da sessão)
  var _inicio      = null;
  var _fim         = null;
  var _postoId     = '';     // '' = rede toda
  var _carregando  = false;
  var _erro        = null;
  // Ordenação da tabela. Default = venda líquida desc, como pedido.
  var _ord = { col: 'venda_liquida', dir: 'desc' };

  // ── Datas (Brasília, en-CA = YYYY-MM-DD, mesmo default do backend) ──
  // toLocaleDateString com timeZone, NÃO toISOString: toISOString devolve UTC,
  // e entre 21:00 e 00:00 de Brasília o UTC já virou o dia seguinte. No dia 20
  // ou no dia 21 isso trocaria o CICLO inteiro, não só um dia — o painel
  // mostraria o mês errado por três horas toda noite.
  function hojeISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  // Último MÊS CALENDÁRIO FECHADO: dia 1 ao último dia do mês anterior.
  //   · hoje 02/09/2026 -> 01/08/2026 a 31/08/2026
  //   · hoje 15/03/2026 -> 01/02/2026 a 28/02/2026
  //   · hoje 10/03/2024 -> 01/02/2024 a 29/02/2024  (bissexto)
  //   · hoje 07/01/2026 -> 01/12/2025 a 31/12/2025  (virada de ano)
  //
  // O DIA de hoje não entra na conta: mês fechado é mês fechado, seja dia 1 ou
  // dia 31. Diferente do ciclo 21→20 dos outros relatórios, que depende do dia.
  //
  // ÚLTIMO DIA DO MÊS sem tabela e sem regra de bissexto escrita à mão:
  // Date.UTC usa índice de mês base ZERO, então `m` (base 1) já aponta para o
  // mês SEGUINTE, e o dia 0 recua para o último dia de `m` — resolve 28, 29,
  // 30 e 31 de uma vez. Regra de bissexto na mão é fonte clássica de bug
  // (o caso /400), então não se escreve.
  //
  // FUSO: os dois lados aqui são UTC (Date.UTC + getUTCDate), nunca misturados
  // com hora local, então não há deriva. O único ponto que lê o fuso do Brasil
  // é o hojeISO() — e é de propósito.
  function mesFechado(refISO) {
    var p = String(refISO).split('-').map(Number);
    var a = p[0], m = p[1] - 1;
    if (m === 0) { m = 12; a -= 1; }
    var ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    var z = function (n) { return String(n).padStart(2, '0'); };
    return { inicio: a + '-' + z(m) + '-01', fim: a + '-' + z(m) + '-' + z(ultimo) };
  }
  function brData(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || '');
  }

  // ── Formatadores pt-BR ───────────────────────────────────────────
  function nf(v, casas) {
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  var vazio = function (v) { return v === null || v === undefined || v === '' || Number.isNaN(Number(v)); };
  // Dinheiro: 2 casas.
  function fmtRS(v) { return vazio(v) ? '—' : 'R$ ' + nf(v, 2); }
  // UNIDADE da quantidade. COMBUSTIVEIS vem em LITRO; todo o resto em UNIDADE.
  // A coluna mistura as duas grandezas, então o sufixo é INFORMAÇÃO, não
  // enfeite: sem ele, 449.381,601 (litros) e 330,000 (unidades de lubrificante)
  // aparecem como se fossem a mesma medida.
  //
  // O teste é `indexOf(...) === 0` (começa com), NÃO "contém": a categoria 12 é
  // "FILTRO DE COMBUSTIVEL", que tem a palavra dentro e é vendida por UNIDADE.
  // Um `includes` marcaria filtro de combustível como litro — o oposto do que
  // se quer, e sem erro nenhum para denunciar.
  //
  // normalize('NFD') + remoção de acento antes de comparar: o export pode vir
  // "COMBUSTÍVEIS" com acento, e aí a comparação crua falharia calada.
  function unidadeDe(catNome) {
    var n = String(catNome || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toUpperCase();
    return n.indexOf('COMBUSTIVE') === 0 ? ' L' : ' un';
  }
  // Quantidade: 3 casas + unidade. `linha` ausente = sem sufixo (ver o tfoot).
  function fmtQtd(v, linha) {
    if (vazio(v)) return '—';
    return nf(v, 3) + (linha ? unidadeDe(linha.cat_nome) : '');
  }
  // Percentual: 2 casas. null -> '—' (ver regra 2 no cabeçalho).
  function fmtPct(v) { return (v === null || v === undefined) ? '—' : nf(v, 2) + '%'; }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Colunas da tabela por categoria ──────────────────────────────
  // `desconto_arq` NÃO está aqui, de propósito — ver regra 1 no cabeçalho.
  var COLS = [
    { key: 'cat_nome',      rot: 'Categoria',     tipo: 'txt', fmt: function (v) { return esc(v); } },
    { key: 'quantidade',    rot: 'Quantidade',    tipo: 'num', fmt: fmtQtd },
    { key: 'venda_bruta',   rot: 'Venda bruta',   tipo: 'num', fmt: fmtRS },
    { key: 'desconto_calc', rot: 'Desconto',      tipo: 'num', fmt: fmtRS },
    { key: 'venda_liquida', rot: 'Venda líquida', rotCurto: 'Líquida', tipo: 'num', fmt: fmtRS },
    { key: 'custo_total',   rot: 'Custo',         tipo: 'num', fmt: fmtRS },
    { key: 'lucro',         rot: 'Lucro',         tipo: 'num', fmt: fmtRS },
    { key: 'margem_pct',    rot: 'Margem %',      rotCurto: 'Margem', tipo: 'num', fmt: fmtPct },
  ];

  // Índice por chave, para a linha de detalhe reusar o MESMO formatador da
  // coluna escondida — não há segunda formatação para divergir.
  // Declarado E preenchido AQUI, logo depois de COLS: `var` iça a declaração
  // mas não a inicialização, então preencher antes do `var` deixava o objeto
  // undefined e estourava no primeiro c.key.
  var COL_POR_KEY = {};
  COLS.forEach(function (c) { COL_POR_KEY[c.key] = c; });

  var KPIS = [
    { rot: 'Venda bruta',   key: 'venda_bruta',   fmt: fmtRS },
    { rot: 'Descontos',     key: 'desconto_calc', fmt: fmtRS },
    { rot: 'Venda líquida', key: 'venda_liquida', fmt: fmtRS, destaque: true },
    { rot: 'Custo total',   key: 'custo_total',   fmt: fmtRS },
    { rot: 'Lucro',         key: 'lucro',         fmt: fmtRS, sinal: true },
    { rot: 'Margem %',      key: 'margem_pct',    fmt: fmtPct, sinal: true },
  ];

  // Colunas que o CELULAR esconde da tabela e mostra na linha de detalhe. As
  // que ficam — Categoria, Venda líquida, Lucro, Margem — são as que respondem
  // "vendeu quanto, sobrou quanto, a que taxa". As 8 colunas não cabem em
  // 375px, e comprimi-las até caber deixaria todas ilegíveis.
  var MOBILE_OCULTA = ['quantidade', 'venda_bruta', 'desconto_calc', 'custo_total'];

  var RODAPE = 'Lucro bruto = venda líquida − custo de compra. ' +
    'Não inclui frete, taxa de cartão nem despesas operacionais.';

  // Abre/fecha o detalhe da linha (só tem efeito onde o CSS de celular torna
  // a .dre-det exibível). `aberto` na própria linha gira o chevron.
  window.__dreDetalhe = function (tr) {
    if (!tr) return;
    var det = tr.nextElementSibling;
    if (!det || det.className.indexOf('dre-det') < 0) return;
    var abrindo = det.className.indexOf('aberta') < 0;
    det.className = abrindo ? 'dre-det aberta' : 'dre-det';
    tr.className = abrindo ? 'aberto' : '';
  };

  // ── CSS da aba, injetado uma vez ─────────────────────────────────
  // Só tokens que já existem (alias curtos do painel-adm.css). O que há aqui
  // são AJUSTES DE LAYOUT sobre classes existentes (.kgrid vira 3 colunas
  // porque são 6 KPIs, não 4) e o estado :disabled do .fueltab, que a classe
  // original não tem.
  function css() {
    return '<style>' +
      '#s-dre { height: auto; min-height: 100%; }' +
      '#s-dre.active { display: block; }' +
      '#s-dre .dre-wrap { max-width: 1100px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: .9rem; }' +
      '#s-dre .dre-top { display: flex; align-items: center; justify-content: space-between; gap: .8rem; flex-wrap: wrap; }' +
      '#s-dre .dre-title { font-family: var(--mono); font-size: 1rem; font-weight: 700; color: var(--tx); }' +
      // .fueltab não prevê disabled (nenhuma tela usava até aqui). Mesmo
      // tratamento visual do .navc-btn:disabled do nav-custo, para as três
      // abas futuras parecerem desligadas e não quebradas.
      '#s-dre .fueltab:disabled { opacity: .4; cursor: not-allowed; }' +
      '#s-dre .fueltab:disabled:hover { border-color: var(--bd); }' +
      '#s-dre .dre-filtros { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .7rem; align-items: end; }' +
      '@media (max-width: 760px) { #s-dre .dre-filtros { grid-template-columns: 1fr; } }' +
      '#s-dre .dre-date { width: 100%; background: var(--sf2); border: 1px solid var(--bd); border-radius: 8px; padding: .55rem .7rem; color: var(--tx); font-family: var(--mono); font-size: .82rem; outline: none; transition: border-color .15s; }' +
      '#s-dre .dre-date:focus { border-color: var(--ac); }' +
      // 6 KPIs: 3 colunas em desktop, 2 abaixo de 900px. NUNCA 1 coluna — em
      // 2 colunas os seis cabem em três linhas e dá para comparar venda com
      // custo sem rolar; empilhados viram seis telas de scroll.
      '#s-dre .kgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }' +
      '@media (max-width: 900px) { #s-dre .kgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }' +
      '#s-dre .kval { font-size: 1.45rem; }' +
      // Em celular o valor TEM de encolher: em 375px cada card fica com ~148px
      // úteis, e "R$ 2.254.766,24" a 1.45rem (ou a 1.55rem do admin.css) pede
      // ~210px. Sem isto o número vaza do card ou quebra em duas linhas.
      // nowrap para garantir que a saída seja encolher a fonte, não quebrar.
      '@media (max-width: 560px) { #s-dre .kval { font-size: .95rem; white-space: nowrap; } }' +
      '#s-dre .kval.neg { color: var(--dg); }' +
      '#s-dre .kval.pos { color: var(--ok); }' +
      // ── GRÁFICO ─────────────────────────────────────────────────
      // width:100% + viewBox = escala sozinho para o container. É o que faz
      // 31 ou 90 barras caberem em 375px sem rolagem horizontal.
      // `height` fixo em CSS porque preserveAspectRatio="none" estica o
      // desenho: sem altura definida o SVG assumiria a proporção do viewBox e
      // ficaria altíssimo no desktop.
      '#s-dre .dre-graf-wrap { position: relative; }' +
      '#s-dre .dre-graf { display: block; width: 100%; height: 190px; overflow: visible; }' +
      '@media (max-width: 560px) { #s-dre .dre-graf { height: 150px; } }' +
      '#s-dre .dre-bar { fill: var(--ac); }' +
      '#s-dre .dre-bar.neg { fill: var(--dg); }' +
      '#s-dre .dre-zero { stroke: var(--bd2); stroke-width: 1; }' +
      // vector-effect: sem ele o preserveAspectRatio="none" esticaria a
      // espessura do traço junto com o desenho e a linha do zero sairia
      // grossa e irregular. Vale para o texto também: por isso os rótulos
      // usam tamanho em px do viewBox e não herdam escala do container.
      '#s-dre .dre-zero { vector-effect: non-scaling-stroke; }' +
      // Rótulos em HTML, tamanho natural (o SVG estica, o texto não).
      // .dre-plot é o sistema de coordenadas comum: o SVG ocupa 100% dele e os
      // rótulos se posicionam em % sobre a mesma caixa.
      '#s-dre .dre-plot { position: relative; }' +
      '#s-dre .dre-area { position: relative; }' +
      '#s-dre .dre-ey, #s-dre .dre-ex { position: absolute; color: var(--tx3);' +
        'font-family: var(--mono); font-size: .6rem; line-height: 1; pointer-events: none;' +
        'white-space: nowrap; }' +
      // Y: no vão da esquerda, centrado na linha que rotula.
      '#s-dre .dre-ey { left: 0; transform: translateY(-50%); }' +
      '#s-dre .dre-ey.base { transform: translateY(-100%); }' +
      // X: numa faixa própria abaixo do SVG, centrado na barra.
      // A faixa do eixo X comeca DEPOIS do vao dos rotulos Y (e termina antes
      // da margem direita), espelhando a area de plotagem do viewBox. Assim o
      // rotulo do dia 1 nao cai sobre o rotulo de porcentagem.
      '#s-dre .dre-exs { position: relative; height: 1rem; margin: 2px 1.11% 0 6.39%; }' +
      '#s-dre .dre-ex { top: 0; transform: translateX(-50%); }' +
      '#s-dre .dre-hit { fill: transparent; cursor: pointer; }' +
      '#s-dre .dre-hit:hover { fill: var(--acd); }' +
      // Tooltip: div sobre o SVG, não <title> nativo — <title> não abre ao
      // toque e não deixa formatar as quatro linhas.
      '#s-dre .dre-tip { position: absolute; z-index: 3; pointer-events: none;' +
        'background: var(--sf2); border: 1px solid var(--bd2); border-radius: 8px;' +
        'padding: .45rem .6rem; font-size: .7rem; color: var(--tx2);' +
        'box-shadow: 0 4px 14px rgba(0,0,0,.35); min-width: 9.5rem; }' +
      '#s-dre .dre-tip b { display: block; color: var(--tx); font-family: var(--mono);' +
        'font-size: .72rem; margin-bottom: .25rem; }' +
      '#s-dre .dre-tip span { display: flex; justify-content: space-between; gap: .7rem;' +
        'font-family: var(--mono); color: var(--tx); }' +
      '#s-dre .dre-tip i { font-style: normal; color: var(--tx3); }' +
      '#s-dre .dre-table { width: 100%; border-collapse: collapse; font-size: .84rem; }' +
      '#s-dre .dre-table th { text-align: left; font-family: var(--mono); font-size: .64rem; text-transform: uppercase; letter-spacing: .05em; color: var(--tx3); padding: .55rem .6rem; border-bottom: 1px solid var(--bd); white-space: nowrap; }' +
      '#s-dre .dre-table th.ord { cursor: pointer; user-select: none; }' +
      '#s-dre .dre-table th.ord:hover { color: var(--ac); }' +
      '#s-dre .dre-table th.ord.on { color: var(--ac); }' +
      '#s-dre .dre-table th .rot-c { display: none; }' +
      '#s-dre .dre-table td { padding: .55rem .6rem; border-bottom: 1px solid var(--bd); color: var(--tx2); }' +
      // nowrap nas células numéricas: GARANTIA de uma linha só. Hoje o
      // .dre-scroll já rola na horizontal e nada quebra, mas sem isto a quebra
      // depende da conta de largura do container — e o min-content de
      // "R$ 2.219.511,51" é a parte depois do espaço, então o "R$" cairia
      // sozinho numa segunda linha se a coluna fosse comprimida. Com nowrap
      // isso não pode acontecer, independente do container.
      '#s-dre .dre-table th.num, #s-dre .dre-table td.num { text-align: right; font-family: var(--mono); white-space: nowrap; }' +
      // Categoria é a única coluna que pode quebrar (nome longo tipo
      // "PRODUTOS ICMS TRIBUTADOS REVENDA"); ela absorve a sobra de largura.
      '#s-dre .dre-table td:first-child { min-width: 9rem; }' +
      '#s-dre .dre-table tbody tr:hover td { background: var(--acd); }' +
      '#s-dre .dre-table tfoot td { font-family: var(--mono); font-weight: 700; color: var(--tx); border-top: 1px solid var(--bd2); border-bottom: none; }' +
      '#s-dre .dre-neg { color: var(--dg); }' +
      '#s-dre .dre-scroll { overflow-x: auto; }' +
      // RODAPÉ STICKY, e isso não é enfeite. Ele estava no fim do fluxo, e
      // medido no shell real (1280x800) ficava em offsetTop 1137 num container
      // de 676px visíveis: era preciso rolar 520px, passando as 13 linhas da
      // tabela, para descobrir que o lucro é BRUTO. Quem bate o olho nos KPIs e
      // fecha a aba nunca via o aviso — e a ressalva é justamente sobre o
      // número que ele acabou de ler.
      // sticky + bottom:0 prende no rodapé do .pa-main (o único container que
      // rola), então o texto acompanha a rolagem e está sempre visível. Fundo
      // opaco em var(--bg) porque o conteúdo passa por baixo.
      '#s-dre .dre-rodape { position: sticky; bottom: 0; z-index: 2; background: var(--bg); ' +
        'border-top: 1px solid var(--bd); font-size: .66rem; color: var(--tx3); ' +
        'line-height: 1.4; padding: .5rem .2rem; margin-top: .2rem; }' +
      // ── LINHA DE DETALHE (celular) ──────────────────────────────
      // Sempre renderizada, escondida por padrão. Só o media query abaixo a
      // torna exibível, então no desktop o toque na linha não faz nada e o
      // JS não precisa saber a largura da tela.
      '#s-dre .dre-det { display: none; }' +
      '#s-dre .dre-det-par { display: flex; justify-content: space-between; gap: .8rem; padding: .18rem 0; }' +
      '#s-dre .dre-det-par span { color: var(--tx3); }' +
      '#s-dre .dre-det-par b { font-family: var(--mono); color: var(--tx); font-weight: 700; }' +
      // ── CELULAR: 4 colunas em vez de 8 ──────────────────────────
      // As 8 colunas dão ~850px de tabela; em 375px sobra pouco mais de 350.
      // Ficam Categoria, Venda líquida, Lucro e Margem — "vendeu quanto,
      // sobrou quanto, a que taxa". As outras quatro vão para o detalhe, a um
      // toque, em vez de virarem rolagem horizontal que ninguém acha.
      '@media (max-width: 560px) {' +
        '#s-dre .col-quantidade, #s-dre .col-venda_bruta,' +
        '#s-dre .col-desconto_calc, #s-dre .col-custo_total { display: none; }' +
        '#s-dre .dre-det.aberta { display: table-row; }' +
        '#s-dre .dre-det.aberta td { background: var(--sf2); padding: .5rem .6rem; font-size: .76rem; }' +
        // Afordância do toque: chevron na categoria, que gira quando abre.
        '#s-dre .dre-table tbody tr:not(.dre-det) { cursor: pointer; }' +
        '#s-dre .dre-table tbody tr:not(.dre-det) td:first-child::after {' +
          'content: " \\25BE"; color: var(--tx3); font-size: .7em; }' +
        '#s-dre .dre-table tbody tr.aberto td:first-child::after { color: var(--ac); }' +
        '#s-dre .dre-table tbody tr.aberto td { background: var(--acd); }' +
        // O min-width de 9rem da Categoria é do DESKTOP e aqui é justamente o
        // que estoura: medido em 375px, os três valores de dinheiro pedem 286px
        // dos ~347 úteis, então a Categoria só pode ocupar o resto. Com 144px
        // fixos a tabela ia a 430px e rolava 83px na horizontal.
        '#s-dre .dre-table th:first-child, #s-dre .dre-table td:first-child { min-width: 0; }' +
        // LARGURA FIXA POR PERCENTUAL, não por conteúdo. Com table-layout:auto
        // a largura vinha do texto: ora a tabela passava do container (as
        // colunas de dinheiro pedem ~245px dos 347 e a categoria tomava o que
        // sobrava, mais o que quisesse), ora um max-width fixo na categoria
        // esticava tudo de volta. Com `fixed` + width:100% a tabela cabe no
        // container por construção, em qualquer largura, e o que não cabe na
        // célula vira elipse em vez de esticar a tabela. Percentuais medidos
        // para os maiores valores reais (R$ 2.190.748,71 na líquida).
        '#s-dre .dre-table { table-layout: fixed; width: 100%; }' +
        // Percentuais dimensionados pelo MAIOR valor real de cada coluna na
        // menor largura suportada (360px, ~332px úteis), com o padding da
        // célula somado: líquida "R$ 2.190.748,71" ~107px, lucro
        // "R$ 221.240,46" ~93px, margem "10,10%" ~46px. A categoria fica com o
        // resto — ela tem elipse e title, um número cortado não teria conserto.
        '#s-dre .col-cat_nome { width: 25%; }' +
        '#s-dre .col-venda_liquida { width: 32%; }' +
        '#s-dre .col-lucro { width: 28%; }' +
        '#s-dre .col-margem_pct { width: 15%; }' +
        // Categoria em uma linha com elipse (nome inteiro no title): sem isto
        // "PRODUTOS ICMS TRIBUTADOS REVENDA" ocupava 4 linhas, as alturas de
        // linha ficavam desiguais e o chevron do toque descia para uma linha
        // sozinha, parecendo um bullet solto.
        '#s-dre .dre-table td.col-cat_nome { white-space: nowrap; overflow: hidden;' +
          'text-overflow: ellipsis; }' +
        // Numérica que não couber na célula ellipsiza, em vez de vazar.
        '#s-dre .dre-table td.num, #s-dre .dre-table th.num { overflow: hidden;' +
          'text-overflow: ellipsis; }' +
        // "Venda líquida" -> "Líquida" e "Margem %" -> "Margem". Em 375px o
        // cabeçalho é que dita a largura dessas duas colunas, não o número.
        '#s-dre .dre-table th .rot-l { display: none; }' +
        '#s-dre .dre-table th .rot-c { display: inline; }' +
      '}' +
      '@media (max-width: 430px) {' +
        '#s-dre .dre-title { font-size: .9rem; }' +
        // .70rem (e não .74) para os últimos px: com nowrap nas colunas de
        // dinheiro, é a fonte que decide se a tabela cabe sem rolar.
        '#s-dre .dre-table { font-size: .70rem; }' +
        // .2rem lateral: são os últimos 12px que faltavam para a tabela de 4
        // colunas caber em 375px sem rolar. Medido — com .3rem sobravam 11px
        // de excesso e o container ainda arrastava.
        '#s-dre .dre-table th, #s-dre .dre-table td { padding: .4rem .2rem; }' +
        // O .cbody (container que rola) tem 14,4px de padding de cada lado, e
        // era o que sobrava de transbordo: em 375px a largura de CONTEÚDO era
        // 318px para uma tabela de 345. Zerar só a lateral devolve 28,8px e a
        // tabela passa a caber; as células têm padding próprio, então não fica
        // encostada. MEDIR pelo clientWidth engana aqui — ele inclui o padding.
        '#s-dre .dre-scroll { padding-left: 0; padding-right: 0; }' +
      '}' +
    '</style>';
  }

  // ── Shell (montado uma vez) ──────────────────────────────────────
  function montarShell(sec) {
    // Default = último MÊS CALENDÁRIO fechado. Mês em andamento teria total
    // subindo a cada importação; o número que se cobra é de um mês que já
    // terminou e não muda mais.
    var mes = mesFechado(hojeISO());
    _inicio = _inicio || mes.inicio;
    _fim    = _fim    || mes.fim;

    sec.innerHTML = css() +
      '<div class="dre-wrap">' +
        '<div class="dre-top">' +
          '<div class="dre-title">🧾 DRE — Produtos e Combustíveis</div>' +
        '</div>' +
        '<div class="fueltab-row" id="dre-subabas"></div>' +
        '<div class="card">' +
          '<div class="chdr">' +
            '<div class="ctitle">Período e escopo</div>' +
            '<div class="csub" id="dre-escopo-sub">—</div>' +
          '</div>' +
          '<div class="cbody">' +
            '<div class="dre-filtros">' +
              '<div>' +
                '<label class="filtro-lbl" for="dre-inicio">Início</label>' +
                '<input type="date" class="dre-date" id="dre-inicio" value="' + esc(_inicio) + '">' +
              '</div>' +
              '<div>' +
                '<label class="filtro-lbl" for="dre-fim">Fim</label>' +
                '<input type="date" class="dre-date" id="dre-fim" value="' + esc(_fim) + '">' +
              '</div>' +
              '<div>' +
                '<label class="filtro-lbl" for="dre-posto">Posto</label>' +
                '<select class="sel" id="dre-posto"><option value="">Rede toda</option></select>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="dre-body"><div class="empty">Carregando…</div></div>' +
        '<div class="dre-rodape">' + esc(RODAPE) + '</div>' +
      '</div>';

    renderSubabas();

    var iIni = sec.querySelector('#dre-inicio');
    var iFim = sec.querySelector('#dre-fim');
    var iPos = sec.querySelector('#dre-posto');
    iIni.onchange = function () { _inicio = iIni.value; carregar(); };
    iFim.onchange = function () { _fim = iFim.value; carregar(); };
    iPos.onchange = function () { _postoId = iPos.value; carregar(); };

    _shellPronto = true;
  }

  function renderSubabas() {
    var el = document.getElementById('dre-subabas');
    if (!el) return;
    el.innerHTML = SUBABAS.map(function (a) {
      // Só "Mês" está implementada nesta etapa; as outras ficam visíveis e
      // desabilitadas com tooltip, em vez de escondidas — quem abre a tela vê
      // para onde ela vai crescer.
      if (!a.pronta) {
        return '<button class="fueltab" disabled title="em breve">' + esc(a.rotulo) + '</button>';
      }
      return '<button class="fueltab active" title="Fechamento do período escolhido">' + esc(a.rotulo) + '</button>';
    }).join('');
  }

  // ── Postos para o seletor (cache: uma vez por sessão da aba) ─────
  async function carregarPostos() {
    if (_postos) return _postos;
    try {
      var r = await apiFetch('/postos');
      _postos = (r.postos || []).slice().sort(function (a, b) {
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
      });
    } catch (e) {
      // Falhar aqui não impede a DRE: sem a lista, fica só "Rede toda".
      _postos = [];
    }
    var sel = document.getElementById('dre-posto');
    if (sel) {
      sel.innerHTML = '<option value="">Rede toda</option>' + _postos.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === _postoId ? ' selected' : '') + '>' + esc(p.nome) + '</option>';
      }).join('');
    }
    return _postos;
  }

  // ── Fetch ────────────────────────────────────────────────────────
  async function carregar() {
    var body = document.getElementById('dre-body');
    if (!_inicio || !_fim) return;
    if (_inicio > _fim) {
      _dados = null;
      _erro = 'Período inválido: o início (' + brData(_inicio) + ') é depois do fim (' + brData(_fim) + ').';
      render();
      return;
    }
    _erro = null;
    _carregando = true;
    if (body) body.innerHTML = '<div class="empty">Carregando…</div>';
    // MESMO período e MESMO posto nas duas chamadas, mudando só `agrupar`. A
    // rota já agrupa por dia; o gráfico não precisou de rota nova.
    var base = '?inicio=' + encodeURIComponent(_inicio) +
               '&fim=' + encodeURIComponent(_fim) +
               (_postoId ? '&posto_id=' + encodeURIComponent(_postoId) : '');
    try {
      // Em PARALELO: são duas leituras independentes da mesma janela, e em
      // série o tempo de tela dobrava. O gráfico é SECUNDÁRIO — se só a
      // chamada por dia falhar, a tabela e os KPIs continuam aparecendo e o
      // gráfico simplesmente não é desenhado (ver `.catch` abaixo). O oposto
      // não vale: sem o agrupar=categoria não há tela.
      var r = await Promise.all([
        apiFetch('/dre' + base + '&agrupar=categoria'),
        apiFetch('/dre' + base + '&agrupar=dia').catch(function (e) {
          console.warn('DRE: série diária não carregou, gráfico omitido:', e && e.message);
          return null;
        }),
      ]);
      _dados = r[0];
      _dadosDia = r[1];
    } catch (err) {
      _dados = null;
      _dadosDia = null;
      _erro = err && err.message ? err.message : String(err);
    } finally {
      _carregando = false;
      render();
    }
  }

  // ══ GRÁFICO DE MARGEM DIÁRIA (SVG puro) ══════════════════════════
  // SVG à mão, sem biblioteca: o projeto não tem lib de gráfico, e um gráfico
  // de barras com linha de zero não justifica adicionar uma (peso, CDN,
  // superfície de atualização) para desenhar retângulos.
  //
  // COMO ELE CABE EM QUALQUER LARGURA SEM ROLAR: o SVG tem `viewBox` fixo e
  // `width:100%`. O desenho é feito num sistema de coordenadas de VB_W
  // unidades e o navegador escala para o container — então 31 ou 90 barras
  // cabem em 375px por construção, sem media query e sem scroll. É por isso
  // que "reduzir a largura da barra" não precisou de código: a barra é uma
  // fração do viewBox.
  var VB_W = 720;      // unidades de largura do viewBox (não são pixels)
  var VB_H = 200;      // altura
  var M_ESQ = 46;      // margem p/ os rótulos de % do eixo Y
  var M_DIR = 8;
  var M_TOPO = 12;
  var M_BASE = 8;      // só respiro; os números do dia são HTML, fora do SVG

  // POR QUE OS RÓTULOS SÃO HTML E NÃO <text> NO SVG
  // O SVG usa preserveAspectRatio="none" para poder ter altura própria (é o
  // que faz 90 barras caberem em 375px sem rolagem). Isso escala X e Y por
  // fatores DIFERENTES — medido em 375px: 0,386 na horizontal contra 0,68 na
  // vertical. Retângulo distorcido não incomoda ninguém; TEXTO sim: os rótulos
  // saíam achatados, e "0,0%" chegava a se ler como "0,8%" num painel de
  // margem. Então o desenho fica no SVG e os rótulos vão em HTML posicionado
  // por PORCENTAGEM sobre o mesmo sistema de coordenadas — tamanho natural,
  // sem distorção, e sem precisar de listener de resize para redesenhar.

  // '2026-08-31' -> 31 (só o dia, que é o rótulo do eixo X)
  function diaDoISO(iso) { return parseInt(String(iso || '').slice(8, 10), 10); }

  // Escolhe quais dias recebem rótulo: primeiro, último e alguns no meio.
  // Rotular todos ilegibiliza em 375px; rotular só as pontas perde referência
  // num mês inteiro. `passo` sai da quantidade de barras, não de uma constante.
  function indicesRotulados(n) {
    if (n <= 1) return [0];
    var alvo = 6;                                  // ~6 rótulos, dê o período que der
    var passo = Math.max(1, Math.round((n - 1) / (alvo - 1)));
    var idx = [];
    for (var i = 0; i < n; i += passo) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    // Se o penúltimo ficou colado no último, tira — os dois rótulos se sobrepõem.
    if (idx.length > 2 && (n - 1 - idx[idx.length - 2]) < passo / 2) idx.splice(idx.length - 2, 1);
    return idx;
  }

  // Monta o SVG. Devolve '' quando não há NADA para desenhar — quem chama usa
  // isso para não renderizar card vazio.
  function svgMargemDiaria(linhas) {
    if (!linhas || !linhas.length) return '';
    // margem_pct null = venda líquida zero. NÃO é zero: o dia entra no eixo
    // (ele existe) mas não ganha barra. Tratar como 0 desenharia uma barra
    // rente à linha de zero, que se lê como "margem zerada", coisa diferente
    // de "não há margem para calcular".
    var comBarra = linhas.filter(function (l) { return l.margem_pct !== null && l.margem_pct !== undefined; });
    if (!comBarra.length) return '';               // todos os dias sem margem: nada a desenhar

    var vals = comBarra.map(function (l) { return Number(l.margem_pct); });
    var maxV = Math.max.apply(null, vals);
    var minV = Math.min.apply(null, vals);
    // O DOMÍNIO SEMPRE INCLUI O ZERO — é o requisito "linha de referência no
    // zero, sempre visível". Sem isto, um período todo positivo desenharia a
    // linha fora da área visível.
    var topo = Math.max(0, maxV);
    var base = Math.min(0, minV);
    // Período de valores todos iguais (inclusive um único dia) daria altura 0
    // e divisão por zero na escala. O piso de 1 ponto percentual mantém a
    // barra visível e a escala sã — é o caso "um único dia não quebra".
    if (topo - base < 1) { topo = base + 1; }
    var folga = (topo - base) * 0.12;
    topo += folga; base -= folga;
    if (base > 0) base = 0;
    if (topo < 0) topo = 0;

    var areaL = VB_W - M_ESQ - M_DIR;
    var areaA = VB_H - M_TOPO - M_BASE;
    var y = function (v) { return M_TOPO + (topo - v) / (topo - base) * areaA; };
    var yZero = y(0);

    var n = linhas.length;
    var passoX = areaL / n;
    // Barra ocupa 70% do passo (30% de respiro). Com 90 dias isso dá barra
    // fininha, que é o comportamento pedido; com 1 dia daria uma barra
    // larguíssima, então há TETO de 42 unidades e a barra fica centrada.
    var larg = Math.min(passoX * 0.7, 42);
    var rotulados = indicesRotulados(n);

    var barras = '', eixoX = '', alvos = '';
    linhas.forEach(function (l, i) {
      var cx = M_ESQ + passoX * i + passoX / 2;
      var x = cx - larg / 2;
      var m = l.margem_pct;
      var temBarra = (m !== null && m !== undefined);
      if (temBarra) {
        var v = Number(m);
        var yv = y(v);
        var alt = Math.abs(yv - yZero);
        // Barra de valor minúsculo viraria linha invisível; 1 unidade de piso
        // garante que o dia apareça.
        if (alt < 1) alt = 1;
        var yTopo = v >= 0 ? yZero - alt : yZero;
        barras += '<rect class="dre-bar' + (v < 0 ? ' neg' : '') + '"' +
          ' x="' + x.toFixed(2) + '" y="' + yTopo.toFixed(2) + '"' +
          ' width="' + larg.toFixed(2) + '" height="' + alt.toFixed(2) + '" rx="1"></rect>';
      }
      // ALVO DE PONTEIRO: retângulo transparente de altura cheia, um por dia.
      // Com 90 barras a barra real tem ~4 unidades e ninguém acerta o mouse
      // nela — e num dia sem barra não haveria nada para tocar. O alvo cobre
      // a coluna inteira e é ele que dispara o tooltip.
      alvos += '<rect class="dre-hit" x="' + (M_ESQ + passoX * i).toFixed(2) + '" y="' + M_TOPO +
        '" width="' + passoX.toFixed(2) + '" height="' + areaA + '"' +
        ' data-i="' + i + '"></rect>';
      if (rotulados.indexOf(i) >= 0) {
        // left em PORCENTAGEM do mesmo sistema de coordenadas do SVG: o rótulo
        // acompanha a barra em qualquer largura, sem depender de resize.
        // left relativo a AREA DE PLOTAGEM (sem o vao dos rotulos Y), porque a
        // faixa .dre-exs tambem comeca depois do vao. Usar o viewBox inteiro
        // punha o rotulo do primeiro dia por cima do rotulo de % do eixo Y.
        eixoX += '<span class="dre-ex" style="left:' +
          ((cx - M_ESQ) / (VB_W - M_ESQ - M_DIR) * 100).toFixed(3) + '%">' +
          diaDoISO(l.data || l.chave) + '</span>';
      }
    });

    // Rótulos de % no eixo Y: topo, zero e base (só os que fazem sentido).
    var marcas = [{ v: topo }, { v: 0 }];
    // `base` so entra quando ha valor negativo (senao repetiria o zero).
    // Ela e marcada como `.base` para ser ancorada ACIMA da linha: centrada
    // (translateY(-50%)) ela descia para dentro da faixa do eixo X e batia no
    // rotulo do primeiro dia — medido em 375px e 430px.
    if (base < 0) marcas.push({ v: base, base: true });
    var eixoY = marcas.map(function (mk) {
      return '<span class="dre-ey' + (mk.base ? ' base' : '') +
        '" style="top:' + (y(mk.v) / VB_H * 100).toFixed(3) + '%">' +
        nf(mk.v, 1) + '%</span>';
    }).join('');

    // O SVG leva SÓ o desenho (barras, linha do zero, alvos de ponteiro).
    // Os rótulos saem em <span> HTML irmãos, posicionados em % — ver o
    // comentário sobre distorção junto de M_BASE.
    // .dre-area envolve SÓ o SVG: é a caixa contra a qual os rótulos de % se
    // posicionam. Pendurá-los no .dre-plot (que inclui a faixa do eixo X)
    // fazia `top:96%` cair DENTRO da faixa — medido em 375px: o rótulo da base
    // aterrissava sobre o número do primeiro dia.
    return '<div class="dre-plot">' +
      '<div class="dre-area">' +
        '<svg class="dre-graf" viewBox="0 0 ' + VB_W + ' ' + VB_H + '"' +
          ' preserveAspectRatio="none" role="img"' +
          ' aria-label="Margem por dia no período">' +
          // Linha do zero por baixo das barras: é a referência, não um enfeite.
          '<line class="dre-zero" x1="' + M_ESQ + '" y1="' + yZero.toFixed(2) +
            '" x2="' + (VB_W - M_DIR) + '" y2="' + yZero.toFixed(2) + '"></line>' +
          barras + alvos +
        '</svg>' +
        eixoY +
      '</div>' +
      '<div class="dre-exs">' + eixoX + '</div>' +
    '</div>';
  }

  // Liga o tooltip. PONTEIRO, não mouse: pointerdown/pointermove cobrem mouse,
  // toque e caneta com um só caminho — no celular o toque na coluna abre o
  // mesmo balão, que era o requisito. Sem inline handler porque são até 90
  // alvos; um listener delegado no SVG resolve todos.
  function ligarTooltipGrafico(linhas) {
    var svg = document.querySelector('#s-dre .dre-graf');
    var tip = document.querySelector('#s-dre .dre-tip');
    if (!svg || !tip) return;
    var esconder = function () { tip.style.display = 'none'; };
    var mostrar = function (ev) {
      var alvo = ev.target && ev.target.closest ? ev.target.closest('.dre-hit') : null;
      if (!alvo) { esconder(); return; }
      var l = linhas[parseInt(alvo.getAttribute('data-i'), 10)];
      if (!l) { esconder(); return; }
      tip.innerHTML =
        '<b>' + brData(l.data || l.chave) + '</b>' +
        '<span><i>Venda líquida</i>' + fmtRS(l.venda_liquida) + '</span>' +
        '<span><i>Custo</i>' + fmtRS(l.custo_total) + '</span>' +
        '<span><i>Lucro</i>' + fmtRS(l.lucro) + '</span>' +
        '<span><i>Margem</i>' + fmtPct(l.margem_pct) + '</span>';
      tip.style.display = 'block';
      // Posiciona relativo ao WRAP do gráfico, não à página: o container rola
      // e coordenadas de viewport descolariam do balão ao rolar.
      var wrap = tip.parentElement.getBoundingClientRect();
      var r = alvo.getBoundingClientRect();
      var x = r.left + r.width / 2 - wrap.left;
      var largTip = tip.offsetWidth;
      // Prende dentro do wrap: perto das bordas o balão sairia da tela.
      x = Math.max(4, Math.min(x - largTip / 2, wrap.width - largTip - 4));
      tip.style.left = x.toFixed(0) + 'px';
      tip.style.top = '0px';
    };
    svg.addEventListener('pointermove', mostrar);
    svg.addEventListener('pointerdown', mostrar);
    svg.addEventListener('pointerleave', esconder);
    // Toque fora do gráfico fecha o balão (no celular não há "leave").
    document.addEventListener('pointerdown', function (ev) {
      if (svg && !svg.contains(ev.target)) esconder();
    });
  }

  // ── Ordenação da tabela ──────────────────────────────────────────
  function ordenar(linhas) {
    var col = COLS.filter(function (c) { return c.key === _ord.col; })[0] || COLS[4];
    var dir = _ord.dir === 'asc' ? 1 : -1;
    return linhas.slice().sort(function (a, b) {
      var va = a[col.key], vb = b[col.key];
      // null SEMPRE por último, nas duas direções: margem null é ausência de
      // dado, não o menor valor — ordenar como -infinito mentiria no ranking.
      var na = (va === null || va === undefined), nb = (vb === null || vb === undefined);
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      if (col.tipo === 'txt') return String(va).localeCompare(String(vb), 'pt-BR') * dir;
      return (Number(va) - Number(vb)) * dir;
    });
  }

  window.__dreOrdenar = function (key) {
    var c = COLS.filter(function (x) { return x.key === key; })[0];
    if (!c) return;
    if (_ord.col === key) {
      _ord.dir = _ord.dir === 'desc' ? 'asc' : 'desc';
    } else {
      // Primeiro clique: texto sobe (A→Z), número desce (maior primeiro).
      _ord.col = key;
      _ord.dir = c.tipo === 'txt' ? 'asc' : 'desc';
    }
    render();
  };

  // ── Render ───────────────────────────────────────────────────────
  function render() {
    var body = document.getElementById('dre-body');
    var sub  = document.getElementById('dre-escopo-sub');
    if (!body) return;

    if (sub) {
      var nomePosto = 'Rede toda';
      if (_postoId && _postos) {
        var p = _postos.filter(function (x) { return x.id === _postoId; })[0];
        if (p) nomePosto = p.nome;
      }
      // Período vem da RESPOSTA quando existe, não do estado dos inputs. Se um
      // fetch falhar depois de o usuário mexer nas datas, o subtítulo tem de
      // descrever os números que estão na tela — misturar data nova com
      // contagem velha rotularia o total errado.
      var per = (_dados && _dados.periodo) ? _dados.periodo : null;
      sub.textContent = nomePosto + ' · ' +
        brData(per ? per.inicio : _inicio) + ' a ' + brData(per ? per.fim : _fim) +
        (per ? ' · ' + per.dias + ' dia(s)' : '');
    }

    if (_carregando) { body.innerHTML = '<div class="empty">Carregando…</div>'; return; }
    if (_erro) {
      body.innerHTML = '<div class="empty" style="color:var(--dg)">' + esc(_erro) + '</div>';
      return;
    }
    if (!_dados) { body.innerHTML = '<div class="empty">Sem dados.</div>'; return; }

    var T = _dados.totais || {};
    var linhas = Array.isArray(_dados.linhas) ? _dados.linhas : [];

    if (!linhas.length) {
      body.innerHTML =
        '<div class="card"><div class="cbody">' +
          '<div class="empty">Nenhum lançamento no período.<br>' +
          '<span class="csub">A DRE vem do .xls de categoria da TecnoX, importado por posto. ' +
          'Se o posto não foi importado neste período, ele não aparece aqui.</span></div>' +
        '</div></div>';
      return;
    }

    // ── KPIs ──
    var kpis = '<div class="kgrid">' + KPIS.map(function (k) {
      var v = T[k.key];
      var cls = 'kval';
      if (k.destaque) cls += ' ac';
      // Lucro e margem coloridos pelo sinal: prejuízo tem de salta aos olhos.
      if (k.sinal && !vazio(v)) cls += (Number(v) < 0 ? ' neg' : ' pos');
      return '<div class="kbox">' +
        '<div class="klbl">' + esc(k.rot) + '</div>' +
        '<div class="' + cls + '">' + k.fmt(v) + '</div>' +
      '</div>';
    }).join('') + '</div>';

    // ── Tabela por categoria ──
    var ordenadas = ordenar(linhas);
    // Cada th/td leva `col-<key>`, e é por essa classe que o CSS esconde
    // coluna em celular. NÃO por :nth-child: qualquer coluna nova ou reordenada
    // deslocaria os índices e passaria a esconder a coluna errada, calado.
    var ths = COLS.map(function (c) {
      var on = _ord.col === c.key;
      var seta = on ? (_ord.dir === 'desc' ? ' ↓' : ' ↑') : '';
      return '<th class="ord col-' + c.key + (c.tipo === 'num' ? ' num' : '') + (on ? ' on' : '') + '"' +
        ' onclick="__dreOrdenar(\'' + c.key + '\')"' +
        ' title="Ordenar por ' + esc(c.rot) + '">' +
        // Dois rótulos, um visível por vez, escolhidos pelo media query. Toda
        // coluna tem o par (curto = longo quando não há versão curta), para a
        // troca ser uniforme e não depender de :has().
        '<span class="rot-l">' + esc(c.rot) + '</span>' +
        '<span class="rot-c">' + esc(c.rotCurto || c.rot) + '</span>' +
        seta + '</th>';
    }).join('');

    var trs = ordenadas.map(function (l, idx) {
      var celulas = COLS.map(function (c) {
        var v = l[c.key];
        var neg = (c.tipo === 'num' && !vazio(v) && Number(v) < 0) ? ' dre-neg' : '';
        // A categoria leva `title` com o nome inteiro: em celular a célula
        // trunca com elipse (nome longo em 4 linhas desalinhava a tabela e
        // jogava o chevron para uma linha só dele), então o nome completo
        // precisa continuar acessível.
        var tit = (c.key === 'cat_nome') ? ' title="' + esc(v) + '"' : '';
        return '<td class="col-' + c.key + (c.tipo === 'num' ? ' num' : '') + neg + '"' + tit + '>'
          + c.fmt(v, l) + '</td>';
      }).join('');
      // Linha de DETALHE com as 4 colunas que o celular esconde. É renderizada
      // SEMPRE, em display:none; só o media query de celular a torna exibível.
      // Assim existe um caminho de código só — o CSS decide se o toque abre
      // algo — em vez de um ramo "se é mobile" no JS, que é o que faria a
      // versão mobile divergir da desktop com o tempo.
      var det = MOBILE_OCULTA.map(function (k) {
        var c = COL_POR_KEY[k];
        return '<div class="dre-det-par"><span>' + esc(c.rot) + '</span><b>' + c.fmt(l[k], l) + '</b></div>';
      }).join('');
      return '<tr onclick="__dreDetalhe(this)" title="Toque para ver quantidade, venda bruta, desconto e custo">'
        + celulas + '</tr>'
        + '<tr class="dre-det"><td colspan="' + COLS.length + '">' + det + '</td></tr>';
    }).join('');

    // Rodapé da tabela = os totais da ROTA, não a soma das linhas na tela.
    // São iguais hoje, mas se um dia a tela filtrar linhas, o total continua
    // sendo o do período — e o número que o supervisor cobra não muda por
    // causa de um filtro visual.
    // O tfoot leva as MESMAS classes col-<key> do thead/tbody. Sem elas o
    // rodapé continuava com as 8 células visíveis e, sozinho, esticava a
    // tabela para 869px num container de 347px — as colunas escondidas no
    // corpo voltavam pela largura, e a tabela rolava do mesmo jeito.
    var tfoot = '<tr>' + COLS.map(function (c, i) {
      if (i === 0) return '<td class="col-' + c.key + '">TOTAL</td>';
      // QUANTIDADE NÃO TEM TOTAL. A coluna mistura LITRO (combustíveis) com
      // UNIDADE (produtos): 449.381,601 L + 614 un não somam "449.995,601" de
      // grandeza nenhuma. O número existe no payload (a rota soma a coluna do
      // banco), mas exibi-lo com ou sem sufixo seria mentira das duas formas —
      // então sai travessão com o motivo no title. É a mesma decisão do
      // sufixo por linha, levada até o rodapé.
      if (c.key === 'quantidade') {
        return '<td class="col-' + c.key + ' num" title="Sem total: a coluna mistura litros (combustíveis) e unidades (produtos).">—</td>';
      }
      var v = T[c.key];
      var neg = (!vazio(v) && Number(v) < 0) ? ' dre-neg' : '';
      return '<td class="col-' + c.key + ' num' + neg + '">' + c.fmt(v) + '</td>';
    }).join('') + '</tr>';

    // ── Gráfico de margem diária, ENTRE os KPIs e a tabela ──
    // `_dadosDia` pode ser null (a chamada por dia falhou — ela é secundária e
    // não derruba a tela) ou vir com linhas sem margem nenhuma. Nos dois casos
    // svgMargemDiaria devolve '' e o card NÃO é montado: período sem dado não
    // mostra caixa vazia, que é pior que não mostrar nada.
    var linhasDia = (_dadosDia && Array.isArray(_dadosDia.linhas)) ? _dadosDia.linhas : [];
    var svg = svgMargemDiaria(linhasDia);
    var comMargem = linhasDia.filter(function (l) {
      return l.margem_pct !== null && l.margem_pct !== undefined;
    }).length;
    var cardGraf = svg
      ? '<div class="card" style="margin-top:.9rem">' +
          '<div class="chdr">' +
            '<div class="ctitle">Margem por dia</div>' +
            '<div class="csub">' + comMargem + ' dia(s) com margem' +
              (linhasDia.length > comMargem
                ? ' · ' + (linhasDia.length - comMargem) + ' sem venda líquida (sem barra)' : '') +
              ' · passe o mouse ou toque numa coluna</div>' +
          '</div>' +
          '<div class="cbody"><div class="dre-graf-wrap">' + svg +
            '<div class="dre-tip" style="display:none"></div>' +
          '</div></div>' +
        '</div>'
      : '';

    body.innerHTML = kpis + cardGraf +
      '<div class="card" style="margin-top:.9rem">' +
        '<div class="chdr">' +
          '<div class="ctitle">Por categoria</div>' +
          '<div class="csub">' + ordenadas.length + ' categoria(s) · clique no cabeçalho para ordenar</div>' +
        '</div>' +
        '<div class="cbody dre-scroll">' +
          '<table class="dre-table">' +
            '<thead><tr>' + ths + '</tr></thead>' +
            '<tbody>' + trs + '</tbody>' +
            '<tfoot>' + tfoot + '</tfoot>' +
          '</table>' +
        '</div>' +
      '</div>';

    // DEPOIS do innerHTML: os alvos de ponteiro só existem agora.
    if (svg) ligarTooltipGrafico(linhasDia);
  }

  // ── Entrada ──────────────────────────────────────────────────────
  window.renderDre = function (sec) {
    if (!sec) return;
    var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    if (!u || PERFIS_VEEM.indexOf(u.perfil) < 0) {
      sec.innerHTML = css() +
        '<div class="dre-wrap"><div class="card"><div class="cbody">' +
          '<div class="empty">Acesso restrito — a DRE é de ADM e Logística.</div>' +
        '</div></div></div>';
      return;
    }
    if (!_shellPronto) montarShell(sec);
    carregarPostos();
    // Recarrega a cada entrada na aba: o período default é o mês corrente, e o
    // arquivo do dia pode ter sido importado entre duas visitas.
    carregar();
  };
})();
