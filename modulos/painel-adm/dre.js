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
  var _dados       = null;   // resposta do GET /dre
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
    var qs = '?inicio=' + encodeURIComponent(_inicio) +
             '&fim=' + encodeURIComponent(_fim) +
             '&agrupar=categoria' +
             (_postoId ? '&posto_id=' + encodeURIComponent(_postoId) : '');
    try {
      _dados = await apiFetch('/dre' + qs);
    } catch (err) {
      _dados = null;
      _erro = err && err.message ? err.message : String(err);
    } finally {
      _carregando = false;
      render();
    }
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

    body.innerHTML = kpis +
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
