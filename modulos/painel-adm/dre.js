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
//     TecnoX: medido na carga de um posto, a coluna Desconto do arquivo ficou
//     cerca de um terço abaixo de bruta − líquida, e é a SUBTRAÇÃO que bate com
//     o próprio "Total Geral" do mesmo arquivo. Ele existe só para auditoria e
//     NÃO é renderizado em lugar nenhum desta tela. Se um dia aparecer, o
//     desconto da rede passa a ser subnotificado em ~32% sem nada avisando.
//  2) `margem_pct` pode vir null (venda líquida zero). Mostra "—", nunca
//     "0,00%": margem de venda zerada não existe, e 0,00% seria lido como
//     medida real.
//
// margem_pct JÁ vem em pontos percentuais (12.5 chega como 12,50%). NÃO multiplicar
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
    { id: 'dia',      rotulo: 'Dia',       pronta: false },
    { id: 'mes',      rotulo: 'Mês',       pronta: true,
      dica: 'Fechamento do período escolhido, por categoria' },
    { id: 'posto',    rotulo: 'Por Posto', pronta: true,
      dica: 'Compara os postos entre si no mesmo período' },
    { id: 'projecao', rotulo: 'Projeção',  pronta: false },
  ];

  var _shellPronto = false;
  var _subaba      = 'mes';  // sub-aba ativa: 'mes' | 'posto'
  var _dados       = null;   // resposta do GET /dre (agrupar=categoria)
  var _dadosDia    = null;   // resposta do GET /dre (agrupar=dia) — série do gráfico
  var _dadosPosto  = null;   // resposta do GET /dre (agrupar=posto)
  var _postos      = null;   // lista do GET /postos (cache da sessão)
  var _inicio      = null;
  var _fim         = null;
  var _postoId     = '';     // '' = rede toda
  var _carregando  = false;
  var _erro        = null;
  // Ordenação da tabela. Default = venda líquida desc, como pedido.
  var _ord = { col: 'venda_liquida', dir: 'desc' };
  // Ordenação da tabela POR POSTO — estado próprio, não compartilhado: as duas
  // tabelas têm conjuntos de colunas diferentes, e uma ordenação por
  // `cat_nome` herdada pela outra aba não teria coluna correspondente.
  // Default = margem % desc, que é a pergunta desta aba.
  var _ordPosto = { col: 'margem_pct', dir: 'desc' };

  // ── Importação (ver o bloco IMPORTAÇÃO mais abaixo) ──
  var _impFile    = null;    // File escolhido, reenviado no confirmar

  // A rota POST /dre/importar é ehTI. No backend TI é uma FLAG (perfis.ti),
  // não um perfil do enum — mesma checagem do painel-ti e do auth.js.
  // Sem isso o botão apareceria para o ADM e só descobriria no 403.
  function ehTIAqui() {
    var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    return !!(u && u.ti === true);
  }

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
  // enfeite: sem ele a quantidade de combustível (litros) e a de lubrificante
  // (unidades) ficam na mesma coluna como se fossem a mesma medida — e a de
  // combustível é ordens de magnitude maior, o que reforça a leitura errada.
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
  // Quantidade AGREGADA de um posto: soma LITRO de combustível com UNIDADE de
  // produto, então não existe sufixo verdadeiro para ela. Sai sem unidade, com
  // o motivo no title da coluna — a mesma decisão já tomada no total da aba
  // Mês. Rotular a soma como litro ou como unidade mentiria das duas formas.
  function fmtQtdMista(v) { return vazio(v) ? '—' : nf(v, 3); }
  // Percentual: 2 casas. null -> '—' (ver regra 2 no cabeçalho).
  function fmtPct(v) { return (v === null || v === undefined) ? '—' : nf(v, 2) + '%'; }
  // margem_pct ausente = venda líquida zero. NÃO é margem zero: é ausência de
  // base para calcular. Usado pelos dois gráficos para decidir se há barra.
  function temMargem(l) { return l && l.margem_pct !== null && l.margem_pct !== undefined; }

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

  // ── Colunas da tabela POR POSTO (sub-aba "Por Posto") ────────────
  // Conjunto menor que o de categoria, de propósito: a pergunta aqui é "qual
  // posto rende mais", e venda bruta / desconto não participam dessa
  // comparação — margem se compara sobre líquida. As CHAVES são as mesmas da
  // outra tabela (venda_liquida, custo_total, lucro, margem_pct), o que faz o
  // CSS de celular que esconde `.col-<key>` valer para as duas sem regra nova.
  var COLS_POSTO = [
    // `fmt` recebe (valor, linha) — usa a linha para cair no MESMO rótulo que
    // o gráfico usa. Ver `rotuloPosto`.
    { key: 'nome',          rot: 'Posto',         tipo: 'txt',
      fmt: function (v, l) { return esc(rotuloPosto(l || { nome: v })); } },
    { key: 'quantidade',    rot: 'Quantidade',    tipo: 'num', fmt: fmtQtdMista,
      titulo: 'Litros de combustível somados a unidades de produto — a soma não tem unidade única.' },
    { key: 'venda_liquida', rot: 'Venda líquida', rotCurto: 'Líquida', tipo: 'num', fmt: fmtRS },
    { key: 'custo_total',   rot: 'Custo',         tipo: 'num', fmt: fmtRS },
    { key: 'lucro',         rot: 'Lucro',         tipo: 'num', fmt: fmtRS },
    { key: 'margem_pct',    rot: 'Margem %',      rotCurto: 'Margem', tipo: 'num', fmt: fmtPct },
  ];
  var COL_POSTO_POR_KEY = {};
  COLS_POSTO.forEach(function (c) { COL_POSTO_POR_KEY[c.key] = c; });
  // Celular: ficam Posto, Venda líquida, Lucro e Margem. As duas escondidas
  // já estão na lista de `.col-` do media query da outra tabela.
  var MOBILE_OCULTA_POSTO = ['quantidade', 'custo_total'];

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
      // úteis, e um valor de sete dígitos com centavos ("R$ 9.999.999,99" como
      // pior caso) a 1.45rem — ou a 1.55rem do admin.css — pede ~210px. Sem
      // isto o número vaza do card ou quebra em duas linhas.
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
      // SELECAO NATIVA DESLIGADA — SO NA AREA DO GRAFICO.
      // No Android/iOS o toque longo numa barra inicia a selecao de texto
      // ANTES do handler abrir o balao: sobe a barra "Selecionar tudo /
      // Copiar" e ela cobre o tooltip. Vale para o wrap inteiro — SVG,
      // rotulos dos dois eixos e o proprio balao.
      // O seletor descendente (`*`) e redundante para `user-select`, que
      // herda, mas NAO para `-webkit-touch-callout`, que nao herda em todas
      // as versoes; e o callout e justamente o menu que aparece no toque
      // longo. Custa um seletor e cobre os dois casos.
      // NAO estender para a tabela: lá o usuario PRECISA marcar e copiar o
      // valor de uma celula. Por isso o escopo e .dre-graf-wrap e nao #s-dre.
      '#s-dre .dre-graf-wrap, #s-dre .dre-graf-wrap * {' +
        ' -webkit-user-select: none; -ms-user-select: none; user-select: none;' +
        ' -webkit-touch-callout: none; }' +
      // manipulation = mantem a rolagem vertical com o dedo sobre o grafico,
      // mas descarta o duplo-toque-para-zoom, que atrasava o primeiro toque
      // em ~300ms. `none` bloquearia a rolagem e prenderia o usuario no
      // grafico — nao e o que se quer.
      '#s-dre .dre-graf-wrap { touch-action: manipulation; }' +
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
      // z-index 20: acima de qualquer coisa DENTRO da secao (o rodape sticky
      // e 2; um thead sticky, se alguem adicionar, costuma ficar em 5-19 no
      // padrao das outras telas deste projeto). Nao adianta pedir mais: tanto
      // .pa-main (painel-adm) quanto .main (admin mobile) sao
      // `position:relative; z-index:1`, ou seja CONTEXTO DE EMPILHAMENTO — o
      // balao esta preso dentro dele e nao passa por cima da .bnav fixa
      // (z-index 100) por mais alto que seja o numero. Isso e aceitavel
      // porque o balao abre no TOPO do grafico: para ele cair atras da barra
      // de navegacao, as barras teriam de estar abaixo da dobra, e ai nao ha
      // como tocar numa. Medido em 375px — ver o teste no commit.
      '#s-dre .dre-tip { position: absolute; z-index: 20; pointer-events: none;' +
        'background: var(--sf2); border: 1px solid var(--bd2); border-radius: 8px;' +
        'padding: .45rem .6rem; font-size: .7rem; color: var(--tx2);' +
        'box-shadow: 0 4px 14px rgba(0,0,0,.35); min-width: 9.5rem; }' +
      '#s-dre .dre-tip b { display: block; color: var(--tx); font-family: var(--mono);' +
        'font-size: .72rem; margin-bottom: .25rem; }' +
      '#s-dre .dre-tip span { display: flex; justify-content: space-between; gap: .7rem;' +
        'font-family: var(--mono); color: var(--tx); }' +
      '#s-dre .dre-tip i { font-style: normal; color: var(--tx3); }' +
      // ── GRÁFICO POR POSTO: barras HORIZONTAIS ────────────────────
      // Reusa .dre-bar / .dre-bar.neg (cor), .dre-hit (alvo de ponteiro),
      // .dre-zero (linha do zero) e o wrap .dre-graf-wrap — que é o que traz
      // de graça o user-select:none, o touch-action e o balão. Só o que é
      // próprio da orientação horizontal está aqui.
      //
      // --hbnome é a largura da coluna de NOMES, e é a MESMA variável usada
      // pelas faixas de rótulo acima e abaixo do desenho. É ela que mantém os
      // três blocos na mesma grade — sem medir nada em JS e sem listener de
      // resize.
      '#s-dre .dre-hplot { --hbnome: 9.5rem; position: relative; }' +
      '#s-dre .dre-hgrid, #s-dre .dre-hstrip {' +
        ' display: grid; grid-template-columns: var(--hbnome) 1fr; }' +
      '#s-dre .dre-hnames { display: flex; flex-direction: column; min-width: 0; }' +
      // height = --hbl, emitido pelo JS a partir de HB_LINHA: a faixa de TEXTO
      // tem exatamente a altura da faixa DESENHADA no SVG, então nome e barra
      // ficam na mesma linha por construção — sem posicionar por porcentagem.
      // Elipse + title: nome de posto longo em 375px não cabe, e cortar sem
      // deixar o nome inteiro acessível tornaria a comparação inútil.
      '#s-dre .dre-hname { height: var(--hbl); line-height: var(--hbl);' +
        ' font-size: .66rem; color: var(--tx2); white-space: nowrap;' +
        ' overflow: hidden; text-overflow: ellipsis; padding-right: .45rem;' +
        ' text-align: right; }' +
      '#s-dre .dre-harea { position: relative; min-width: 0; }' +
      // Sem `height` fixo: a altura vem do atributo do próprio SVG, que é
      // n × HB_LINHA em px. Y do viewBox = altura em px, logo a escala
      // vertical é 1 e as faixas não deformam com a largura.
      '#s-dre .dre-hgraf { display: block; width: 100%; }' +
      '#s-dre .dre-hxs { position: relative; height: .95rem; }' +
      '#s-dre .dre-hx { position: absolute; top: 0; transform: translateX(-50%);' +
        ' color: var(--tx3); font-family: var(--mono); font-size: .6rem;' +
        ' line-height: 1; white-space: nowrap; pointer-events: none; }' +
      // O rótulo da média é A referência da tela, não um rótulo de eixo
      // qualquer — por isso tem cor de destaque e peso.
      '#s-dre .dre-hmedia { position: absolute; top: 0; color: var(--ac);' +
        ' font-family: var(--mono); font-size: .62rem; font-weight: 700;' +
        ' line-height: 1; white-space: nowrap; pointer-events: none;' +
        ' transform: translateX(-50%); }' +
      // Perto das bordas o rótulo centrado sairia do card: ancora pela ponta.
      '#s-dre .dre-hmedia.na-esq { transform: none; }' +
      '#s-dre .dre-hmedia.na-dir { transform: translateX(-100%); }' +
      '#s-dre .dre-hlinha-media { stroke: var(--ac); stroke-width: 1.5;' +
        ' stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }' +
      // Marca de custo desconhecido na linha da tabela e no nome do gráfico.
      '#s-dre .dre-lacuna { color: var(--wn); font-weight: 700;' +
        ' cursor: help; }' +
      // Justificativa embaixo do seletor travado (sub-aba "Por Posto").
      '#s-dre .dre-nota-txt { font-size: .64rem; color: var(--tx3);' +
        ' line-height: 1.35; padding-top: .25rem; }' +
      // O projeto não tinha estilo de `:disabled` para .sel — sem isto o
      // campo travado fica com a aparência do destravado em parte dos
      // navegadores, e "travado" que parece clicável é pior que campo
      // escondido: o usuário fica tentando mudar o escopo e nada acontece.
      // Escopo #s-dre para não mudar select desabilitado de outras telas.
      '#s-dre .sel:disabled { background: var(--sf); border-style: dashed;' +
        ' color: var(--tx3); cursor: not-allowed; opacity: 1; }' +
      // ── IMPORTAÇÃO: só o que o conjunto .cmi-* do Custo & Margem não cobre
      // (lista das 5 conferências, spinner, faixa de aviso da 5 e o
      // recolhível do resumo). SEM escopo #s-dre de propósito: o modal é
      // anexado ao <body>, fora da seção.
      '.dri-confs { display: flex; flex-direction: column; gap: 2px; margin: .6rem 0; }' +
      '.dri-conf { display: grid; grid-template-columns: 1.1rem 1fr auto; gap: .5rem;' +
        'align-items: baseline; padding: .32rem .45rem; border-radius: 6px;' +
        'background: var(--sf2); font-size: .72rem; color: var(--tx2); }' +
      '.dri-ic { font-family: var(--mono); font-weight: 700; text-align: center; }' +
      '.dri-conf.ok .dri-ic { color: var(--ok); }' +
      '.dri-conf.bad .dri-ic { color: var(--dg); }' +
      '.dri-conf.warn .dri-ic { color: var(--wn); }' +
      '.dri-conf.na .dri-ic { color: var(--tx3); }' +
      '.dri-conf.bad { border: 1px solid var(--dg); }' +
      '.dri-conf.warn { border: 1px solid var(--wn); }' +
      '.dri-rot b { color: var(--tx); font-family: var(--mono); }' +
      '.dri-val { font-family: var(--mono); font-size: .68rem; color: var(--tx3); text-align: right; }' +
      // Em celular a linha vira duas: o rótulo não cabe ao lado do valor.
      '@media (max-width: 560px) {' +
        '.dri-conf { grid-template-columns: 1.1rem 1fr; }' +
        '.dri-val { grid-column: 2; text-align: left; }' +
      '}' +
      '.dri-det { margin: .4rem 0 0; padding-left: 1.1rem; font-size: .7rem; color: var(--tx2); }' +
      '.dri-det li { margin-bottom: .2rem; }' +
      // Aviso da conferência 5: destaque em --wn (avisa), não em --dg (barra).
      '.dri-aviso { border: 1px solid var(--wn); border-radius: 8px; padding: .55rem .65rem;' +
        'margin: .6rem 0; background: rgba(249,199,79,.07); }' +
      '.dri-aviso-tit { font-family: var(--mono); font-size: .74rem; font-weight: 700;' +
        'color: var(--wn); margin-bottom: .3rem; }' +
      '.dri-aviso-txt { font-size: .68rem; color: var(--tx2); line-height: 1.45; margin-bottom: .5rem; }' +
      '.dri-tblwrap { overflow-x: auto; }' +
      '.dri-det-box { margin: .6rem 0; }' +
      '.dri-det-box > summary { cursor: pointer; font-family: var(--mono); font-size: .72rem;' +
        'color: var(--tx); padding: .35rem 0; }' +
      '.dri-ok { color: var(--ok); font-family: var(--mono); font-size: .74rem;' +
        'padding: .5rem 0; text-align: center; }' +
      // Spinner do processamento (arquivo com muitos postos demora).
      '.dri-load { display: flex; flex-direction: column; align-items: center; gap: .7rem;' +
        'padding: 1.6rem .5rem; color: var(--tx2); font-size: .74rem; text-align: center; }' +
      '.dri-spin { width: 26px; height: 26px; border-radius: 50%;' +
        'border: 3px solid var(--bd); border-top-color: var(--ac);' +
        'animation: dri-gira .8s linear infinite; }' +
      '@keyframes dri-gira { to { transform: rotate(360deg); } }' +
      // O botão de importar fica no topo da aba, ao lado do título.
      '#s-dre .dre-top { align-items: center; }' +
      '#s-dre .dre-imp-acao { display: flex; gap: .4rem; }' +
      '#s-dre .dre-table { width: 100%; border-collapse: collapse; font-size: .84rem; }' +
      '#s-dre .dre-table th { text-align: left; font-family: var(--mono); font-size: .64rem; text-transform: uppercase; letter-spacing: .05em; color: var(--tx3); padding: .55rem .6rem; border-bottom: 1px solid var(--bd); white-space: nowrap; }' +
      '#s-dre .dre-table th.ord { cursor: pointer; user-select: none; }' +
      '#s-dre .dre-table th.ord:hover { color: var(--ac); }' +
      '#s-dre .dre-table th.ord.on { color: var(--ac); }' +
      '#s-dre .dre-table th .rot-c { display: none; }' +
      '#s-dre .dre-table td { padding: .55rem .6rem; border-bottom: 1px solid var(--bd); color: var(--tx2); }' +
      // nowrap nas células numéricas: GARANTIA de uma linha só. Hoje o
      // .dre-scroll já rola na horizontal e nada quebra, mas sem isto a quebra
      // depende da conta de largura do container — e o min-content de um valor
      // monetário é a parte DEPOIS do espaço ("R$ " conta como palavra
      // separada), então o "R$" cairia sozinho numa segunda linha se a coluna
      // fosse comprimida. Com nowrap isso não pode acontecer, independente do
      // container.
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
        // célula vira elipse em vez de esticar a tabela. Os percentuais saem da
        // LARGURA do maior valor plausível de cada coluna (ver abaixo).
        '#s-dre .dre-table { table-layout: fixed; width: 100%; }' +
        // Dimensionados pela LARGURA do maior valor plausível de cada coluna na
        // menor largura suportada (360px, ~332px úteis), com o padding da célula
        // somado: um valor de sete dígitos com centavos pede ~107px, um de seis
        // ~93px, e um percentual de duas casas ~46px. A categoria fica com o
        // resto — ela tem elipse e title, e um número cortado não teria
        // conserto.
        '#s-dre .col-cat_nome, #s-dre .col-nome { width: 25%; }' +
        '#s-dre .col-venda_liquida { width: 32%; }' +
        '#s-dre .col-lucro { width: 28%; }' +
        '#s-dre .col-margem_pct { width: 15%; }' +
        // Categoria em uma linha com elipse (nome inteiro no title): sem isto
        // "PRODUTOS ICMS TRIBUTADOS REVENDA" ocupava 4 linhas, as alturas de
        // linha ficavam desiguais e o chevron do toque descia para uma linha
        // sozinha, parecendo um bullet solto.
        '#s-dre .dre-table td.col-cat_nome, #s-dre .dre-table td.col-nome {' +
          'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
        // Numérica que não couber na célula ellipsiza, em vez de vazar.
        '#s-dre .dre-table td.num, #s-dre .dre-table th.num { overflow: hidden;' +
          'text-overflow: ellipsis; }' +
        // "Venda líquida" -> "Líquida" e "Margem %" -> "Margem". Em 375px o
        // cabeçalho é que dita a largura dessas duas colunas, não o número.
        '#s-dre .dre-table th .rot-l { display: none; }' +
        '#s-dre .dre-table th .rot-c { display: inline; }' +
      '}' +
      '@media (max-width: 560px) {' +
        // 5.6rem = ~90px dos ~347 úteis em 375px. Sobra ~250px para o eixo de
        // valor, que é onde a comparação acontece. Nome maior que isso vira
        // elipse (o inteiro fica no title) — encurtar a barra para caber o
        // nome inverteria a prioridade da tela.
        '#s-dre .dre-hplot { --hbnome: 5.6rem; }' +
        '#s-dre .dre-hname { font-size: .6rem; padding-right: .3rem; }' +
        '#s-dre .dre-hx, #s-dre .dre-hmedia { font-size: .56rem; }' +
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
          // Botão só para TI: a rota é ehTI, e mostrar um botão que responde
          // 403 é pior que não mostrar. Mesmo par botão+input escondido da
          // importação do Custo & Margem.
          (ehTIAqui()
            ? '<div class="dre-imp-acao">' +
                '<button class="cm-btn ghost" id="dre-imp-btn" onclick="__dreImpAbrir()"' +
                  ' title="Importar o .xls de categoria da TecnoX">📥 Importar planilha</button>' +
                '<input type="file" id="dre-imp-file" accept=".xls" hidden onchange="__dreImpFile(this)">' +
              '</div>'
            : '') +
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
              '<div id="dre-f-posto">' +
                '<label class="filtro-lbl" for="dre-posto">Posto</label>' +
                '<select class="sel" id="dre-posto"><option value="">Rede toda</option></select>' +
                // A justificativa fica LOGO ABAIXO do próprio campo, que é
                // onde o usuário olha quando percebe que ele não mexe. Um
                // controle travado e mudo faz procurar o que quebrou.
                '<div class="dre-nota-txt" id="dre-posto-nota" hidden>Travado na rede toda: ' +
                  'esta aba compara os postos entre si, e filtrar um deixaria uma linha ' +
                  'só para comparar.</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="dre-body"><div class="empty">Carregando…</div></div>' +
        '<div class="dre-rodape">' + esc(RODAPE) + '</div>' +
      '</div>';

    renderSubabas();
    aplicarEscopoSubaba();

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
      // "Dia" e "Projeção" seguem visíveis e desabilitadas com tooltip, em vez
      // de escondidas — quem abre a tela vê para onde ela vai crescer.
      if (!a.pronta) {
        return '<button class="fueltab" disabled title="em breve">' + esc(a.rotulo) + '</button>';
      }
      return '<button class="fueltab' + (_subaba === a.id ? ' active' : '') + '"' +
        ' onclick="__dreSubaba(\'' + a.id + '\')" title="' + esc(a.dica || '') + '">' +
        esc(a.rotulo) + '</button>';
    }).join('');
  }

  // Trava o seletor de posto em "Rede toda" na sub-aba "Por Posto", com o
  // motivo visível embaixo. `disabled` e não `hidden`: o campo continua na
  // tela mostrando o escopo em vigor, em vez de sumir e deixar o usuário sem
  // saber sobre o que os números falam.
  function aplicarEscopoSubaba() {
    var sel  = document.getElementById('dre-posto');
    var nota = document.getElementById('dre-posto-nota');
    if (!sel || !nota) return;
    var rede = (_subaba === 'posto');
    sel.disabled = rede;
    nota.hidden = !rede;
    // O `title` diz o mesmo no hover, para quem clica no campo antes de ler.
    sel.title = rede
      ? 'Travado na rede toda nesta aba — ela compara os postos entre si.'
      : '';
  }

  window.__dreSubaba = function (id) {
    var a = SUBABAS.filter(function (x) { return x.id === id; })[0];
    if (!a || !a.pronta || _subaba === id) return;
    _subaba = id;
    // "Por Posto" é comparação ENTRE postos: força a rede toda. Ao voltar
    // para "Mês" o seletor destrava zerado — o posto que estava escolhido não
    // volta sozinho, porque a tela passou a mostrar a rede e reativar um
    // filtro sem o usuário pedir mudaria os números sem aviso.
    if (id === 'posto' && _postoId) {
      _postoId = '';
      var sel = document.getElementById('dre-posto');
      if (sel) sel.value = '';
    }
    renderSubabas();
    aplicarEscopoSubaba();
    carregar();
  };

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
      // A sub-aba "Por Posto" pede UMA chamada só (agrupar=posto): ela não tem
      // gráfico diário nem tabela de categoria. Buscar as três sempre gastaria
      // duas leituras por troca de aba sem nada na tela usar o resultado.
      if (_subaba === 'posto') {
        _dadosPosto = await apiFetch('/dre' + base + '&agrupar=posto');
        return;
      }
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
      _dadosPosto = null;
      _erro = err && err.message ? err.message : String(err);
    } finally {
      _carregando = false;
      render();
    }
  }

  // DOMÍNIO DO EIXO DE VALOR (margem %) — comum aos DOIS gráficos.
  // Uma função só porque as regras são as mesmas e, se divergissem, um dos
  // gráficos passaria a desenhar a mesma margem em escala diferente do outro.
  //
  // SEMPRE INCLUI O ZERO: é o requisito "linha de referência no zero, sempre
  // visível". Sem isto um período todo positivo desenharia a linha fora da
  // área. `extra` entra no domínio quando existe — é a média da rede no
  // gráfico por posto: se ela caísse fora, a linha de referência (que é o
  // ponto da tela) sairia da área desenhada.
  function escalaMargem(vals, extra) {
    var v = vals.slice();
    if (extra !== null && extra !== undefined && Number.isFinite(Number(extra))) {
      v.push(Number(extra));
    }
    var topo = Math.max(0, Math.max.apply(null, v));
    var base = Math.min(0, Math.min.apply(null, v));
    // Valores todos iguais (inclusive um único ponto) dariam extensão 0 e
    // divisão por zero na escala. O piso de 1 ponto percentual mantém a barra
    // visível e a escala sã — é o caso "um único dia não quebra".
    if (topo - base < 1) topo = base + 1;
    var folga = (topo - base) * 0.12;
    topo += folga; base -= folga;
    if (base > 0) base = 0;
    if (topo < 0) topo = 0;
    return { topo: topo, base: base };
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
    // de "não há margem para calcular". Ver `temMargem`.
    var comBarra = linhas.filter(temMargem);
    if (!comBarra.length) return '';               // todos os dias sem margem: nada a desenhar

    var dom = escalaMargem(comBarra.map(function (l) { return Number(l.margem_pct); }));
    var topo = dom.topo, base = dom.base;

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
        '<svg class="dre-graf dre-svg" viewBox="0 0 ' + VB_W + ' ' + VB_H + '"' +
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

  // ══ GRÁFICO DE MARGEM POR POSTO (SVG puro, barras HORIZONTAIS) ═══
  //
  // POR QUE HORIZONTAL, e não vertical como o da aba Mês: aqui o rótulo é o
  // NOME do posto, não o número do dia. 37 nomes em pé, em 375px, seriam
  // ilegíveis mesmo rotacionados. Barra horizontal põe o nome numa linha de
  // texto normal, que trunca com elipse e cabe.
  //
  // E É AQUI QUE ELE DIFERE DO OUTRO: o da aba Mês escala TUDO para caber
  // (viewBox fixo, nenhuma rolagem). Neste, a faixa de cada posto tem ALTURA
  // FIXA em px (HB_LINHA) e o SVG fica com n × HB_LINHA — 37 postos dão ~666px
  // e o CARD cresce, rolando com a PÁGINA. Rolagem vertical é aceitável (é o
  // gesto natural de quem lê uma lista); horizontal não é, e é por isso que o
  // eixo de valor continua sendo 100% da largura, sempre.
  //
  // Não há container com rolagem própria de propósito: uma barra de rolagem
  // interna estreitaria a coluna do desenho e desalinharia as faixas de rótulo
  // de cima e de baixo, que dependem da mesma grade CSS.
  //
  // A altura do viewBox é a altura em PX, então o fator de escala vertical é 1
  // e as faixas não deformam. O texto continua FORA do SVG — mesmo motivo do
  // gráfico diário (ver o comentário junto de M_BASE).
  var HB_VB_W  = 720;   // unidades de largura do viewBox (não são pixels)
  var HB_LINHA = 18;    // altura da faixa de cada posto, em PX reais
  var HB_ESQ   = 2;     // respiro; o nome do posto é HTML, em coluna própria
  var HB_DIR   = 2;

  // Monta o gráfico por posto. `linhas` JÁ vem ordenada — é a mesma lista que
  // alimenta a tabela, para que gráfico e tabela nunca mostrem ordens
  // diferentes. `mediaRede` é a margem do PERÍODO INTEIRO (totais.margem_pct
  // da rota), não a média das margens dos postos: a segunda daria a cada posto
  // o mesmo peso, e um posto pequeno mexeria na referência tanto quanto um
  // grande. A referência é o que a rede fez.
  // Devolve '' quando não há nada a desenhar — quem chama usa isso para não
  // montar card vazio.
  function svgMargemPosto(linhas, mediaRede) {
    if (!linhas || !linhas.length) return '';
    var comBarra = linhas.filter(temMargem);
    if (!comBarra.length) return '';

    var dom = escalaMargem(comBarra.map(function (l) { return Number(l.margem_pct); }), mediaRede);
    var topo = dom.topo, base = dom.base;

    var n = linhas.length;
    var altura = n * HB_LINHA;
    var areaL = HB_VB_W - HB_ESQ - HB_DIR;
    var x = function (v) { return HB_ESQ + (v - base) / (topo - base) * areaL; };
    var xZero = x(0);
    // % da ÁREA DE PLOTAGEM (não do viewBox inteiro): é contra ela que as
    // faixas de rótulo se posicionam, e as duas ocupam a mesma coluna da grade.
    var pct = function (v) { return ((x(v) - HB_ESQ) / areaL * 100); };

    // Barra com 6px de respiro entre faixas; piso de 4px para a barra não
    // desaparecer se algum dia HB_LINHA encolher.
    var altBar = Math.max(4, HB_LINHA - 6);

    var barras = '', alvos = '', nomes = '';
    linhas.forEach(function (l, i) {
      var yFaixa = i * HB_LINHA;
      var yBar = yFaixa + (HB_LINHA - altBar) / 2;
      if (temMargem(l)) {
        var v = Number(l.margem_pct);
        var larg = Math.abs(x(v) - xZero);
        // Margem minúscula viraria linha invisível; 1 unidade de piso garante
        // que o posto apareça.
        if (larg < 1) larg = 1;
        barras += '<rect class="dre-bar' + (v < 0 ? ' neg' : '') + '"' +
          ' x="' + (v >= 0 ? xZero : xZero - larg).toFixed(2) + '"' +
          ' y="' + yBar.toFixed(2) + '"' +
          ' width="' + larg.toFixed(2) + '" height="' + altBar + '" rx="1"></rect>';
      }
      // ALVO DE PONTEIRO: faixa de largura cheia, uma por posto. Com barra
      // curta (margem perto de zero) ninguém acerta o ponteiro nela, e um
      // posto sem margem não teria nada para tocar. Mesma solução do gráfico
      // diário, e é o `.dre-hit` dele que dá o realce ao passar.
      alvos += '<rect class="dre-hit" x="' + HB_ESQ + '" y="' + yFaixa +
        '" width="' + areaL + '" height="' + HB_LINHA + '" data-i="' + i + '"></rect>';
      // Nome em HTML, na coluna irmã. `title` sempre, porque a elipse só
      // aparece quando falta espaço e não há como saber aqui se faltou.
      var lac = temLacuna(l)
        ? '<span class="dre-lacuna" title="' + esc(textoLacuna(l)) + '">*</span>' : '';
      nomes += '<span class="dre-hname" title="' + esc(tituloPosto(l)) + '">' +
        esc(rotuloPosto(l)) + lac + '</span>';
    });

    // Linha da média + rótulo. O rótulo é HTML, na faixa de cima, e ancora
    // pela ponta quando está perto da borda — centrado, sairia do card.
    var temMedia = mediaRede !== null && mediaRede !== undefined && Number.isFinite(Number(mediaRede));
    var linhaMedia = '', rotMedia = '';
    if (temMedia) {
      var xm = x(Number(mediaRede));
      linhaMedia = '<line class="dre-hlinha-media" x1="' + xm.toFixed(2) + '" y1="0"' +
        ' x2="' + xm.toFixed(2) + '" y2="' + altura + '"></line>';
      var pm = pct(Number(mediaRede));
      var borda = pm < 14 ? ' na-esq' : (pm > 86 ? ' na-dir' : '');
      // A seta só existe quando o rótulo ancora pela PONTA, e aponta para o
      // lado onde a linha ficou:
      //   na-esq -> rótulo cresce para a direita, linha na borda ESQUERDA dele;
      //   na-dir -> rótulo cresce para a esquerda, linha na borda DIREITA.
      // Centrado (o caso comum), o rótulo já fica sobre a linha e uma seta na
      // ponta do texto apontaria para o lado errado.
      var txtMedia = 'média da rede ' + nf(Number(mediaRede), 2) + '%';
      if (borda === ' na-esq') txtMedia = '◂ ' + txtMedia;
      if (borda === ' na-dir') txtMedia = txtMedia + ' ▸';
      rotMedia = '<span class="dre-hmedia' + borda + '" style="left:' + pm.toFixed(3) + '%">' +
        txtMedia + '</span>';
    }

    // Rótulos do eixo de valor, na faixa DE BAIXO: base (só se negativa), zero
    // e topo. Ficam fora do SVG e fora da área que cresce, então continuam
    // legíveis com 37 postos.
    var marcas = [{ v: 0 }, { v: topo }];
    if (base < 0) marcas.unshift({ v: base });
    var rotX = marcas.map(function (mk) {
      var pv = pct(mk.v);
      var borda = pv < 6 ? ' style="left:0;transform:none"'
        : (pv > 94 ? ' style="left:100%;transform:translateX(-100%)"'
          : ' style="left:' + pv.toFixed(3) + '%"');
      return '<span class="dre-hx"' + borda + '>' + nf(mk.v, 1) + '%</span>';
    }).join('');

    return '<div class="dre-hplot" style="--hbl:' + HB_LINHA + 'px">' +
      '<div class="dre-hstrip"><span></span><div class="dre-hxs">' + rotMedia + '</div></div>' +
      '<div class="dre-hgrid">' +
        '<div class="dre-hnames">' + nomes + '</div>' +
        '<div class="dre-harea">' +
          '<svg class="dre-hgraf dre-svg" viewBox="0 0 ' + HB_VB_W + ' ' + altura + '"' +
            ' height="' + altura + '" preserveAspectRatio="none" role="img"' +
            ' aria-label="Margem por posto no período, com a média da rede">' +
            // Zero e média por baixo das barras: são referência, não enfeite.
            '<line class="dre-zero" x1="' + xZero.toFixed(2) + '" y1="0"' +
              ' x2="' + xZero.toFixed(2) + '" y2="' + altura + '"></line>' +
            linhaMedia + barras + alvos +
          '</svg>' +
        '</div>' +
      '</div>' +
      '<div class="dre-hstrip"><span></span><div class="dre-hxs">' + rotX + '</div></div>' +
    '</div>';
  }

  // ── RÓTULO E TÍTULO DO POSTO ─────────────────────────────────────
  // Um lugar só, usado pela tabela E pelo gráfico. `nome` vem null quando a
  // linha do banco não casa com nenhum posto no join. Cada lado escrevendo o
  // seu texto para esse caso fazia a MESMA linha aparecer com dois rótulos
  // diferentes na mesma tela.
  function rotuloPosto(l) { return (l && l.nome) ? l.nome : '— sem nome'; }
  function tituloPosto(l) {
    return (l && l.nome) ? l.nome
      : 'Posto sem nome no cadastro (posto_id ' + ((l && l.chave) || '?') + ')';
  }

  // ── LACUNA DE CUSTO POR LINHA ────────────────────────────────────
  // A rota devolve `custo_desconhecido` em cada linha e nos totais: linhas que
  // entraram na venda mas não no custo. ESTA ABA ORDENA POR MARGEM, então a
  // lacuna deixa de ser ruído estatístico e passa a poder mexer no RANKING —
  // um posto com parte do custo faltando aparece mais rentável do que é. Daí a
  // marca na linha; o aviso agregado da tela é assunto do passo 3, ainda
  // pendente, e quando vier deve cobrir as duas abas de um lugar só.
  function temLacuna(l) {
    return !!(l && l.custo_desconhecido && l.custo_desconhecido.linhas > 0);
  }
  function textoLacuna(l) {
    var c = l.custo_desconhecido;
    return c.linhas + ' lançamento(s) sem custo no arquivo da TecnoX (' +
      fmtRS(c.venda_liquida) + ' de venda líquida). O custo abaixo é só do que se ' +
      'sabe, então lucro e margem deste posto estão OTIMISTAS.';
  }

  // Liga o tooltip. PONTEIRO, não mouse: pointerdown/pointermove cobrem mouse,
  // toque e caneta com um só caminho — no celular o toque na coluna abre o
  // mesmo balão, que era o requisito. Sem inline handler porque são até 90
  // alvos; um listener delegado no SVG resolve todos.
  //
  // SERVE OS DOIS GRÁFICOS. `opts` cobre o que muda entre eles e nada mais:
  //   titulo   — o cabeçalho do balão (data no diário, nome do posto aqui);
  //   seguirY  — o balão acompanha a LINHA tocada. No diário o alvo é uma
  //              coluna de altura cheia, e o balão fica no topo; no por posto
  //              o alvo é uma faixa, e um balão fixo no topo não diria de qual
  //              posto ele fala.
  // Os defaults reproduzem exatamente o comportamento do gráfico diário.
  function ligarTooltipGrafico(linhas, opts) {
    var o = opts || {};
    var svg = document.querySelector('#s-dre ' + (o.svg || '.dre-graf'));
    var tip = document.querySelector('#s-dre .dre-tip');
    if (!svg || !tip) return;
    var titulo = o.titulo || function (l) { return brData(l.data || l.chave); };
    var esconder = function () { tip.style.display = 'none'; };
    var mostrar = function (ev) {
      var alvo = ev.target && ev.target.closest ? ev.target.closest('.dre-hit') : null;
      if (!alvo) { esconder(); return; }
      var l = linhas[parseInt(alvo.getAttribute('data-i'), 10)];
      if (!l) { esconder(); return; }
      tip.innerHTML =
        '<b>' + titulo(l) + '</b>' +
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
      if (o.seguirY) {
        // Centrado na faixa e preso dentro do wrap: nas primeiras e nas
        // últimas linhas o balão sairia do card.
        var altTip = tip.offsetHeight;
        var yc = r.top + r.height / 2 - wrap.top - altTip / 2;
        tip.style.top = Math.max(2, Math.min(yc, wrap.height - altTip - 2)).toFixed(0) + 'px';
      } else {
        tip.style.top = '0px';
      }
    };
    svg.addEventListener('pointermove', mostrar);
    svg.addEventListener('pointerdown', mostrar);
    svg.addEventListener('pointerleave', esconder);
    // pointercancel: quando o Android decide que o gesto virou rolagem, ele
    // CANCELA o ponteiro em vez de mandar pointerup/leave. Sem isto o balão
    // ficaria aberto depois de uma rolagem iniciada sobre o gráfico.
    svg.addEventListener('pointercancel', esconder);

    // Cinturão e suspensório para o toque longo: o `user-select: none` do CSS
    // já impede a seleção, mas em WebView antigo do Android ele é ignorado em
    // conteúdo SVG. Cancelar o selectstart no wrap fecha essa brecha e não
    // afeta a tabela, que está fora do wrap.
    // `wrapEl`, nao `wrap`: dentro do `mostrar` acima ja existe um `wrap` que
    // e um DOMRect. Dois `var wrap` com significados diferentes na mesma
    // funcao funcionam (escopos distintos) e confundem na leitura.
    var wrapEl = tip.parentElement;
    if (wrapEl) {
      wrapEl.addEventListener('selectstart', function (ev) { ev.preventDefault(); });
    }
  }

  // Toque fora do gráfico fecha o balão (no celular não há "leave").
  //
  // FORA do ligarTooltipGrafico DE PROPÓSITO. Antes o listener era registrado
  // ali dentro, e ligarTooltipGrafico roda a cada render() — ou seja, a cada
  // ordenação de coluna e a cada troca de filtro. Cada chamada pendurava mais
  // um listener anônimo no document, fechado sobre um `svg` que o innerHTML
  // seguinte já havia descartado: nunca removido, crescendo sem limite numa
  // tela que o usuário reordena à vontade. Aqui é UM listener, registrado uma
  // única vez, que resolve os elementos ATUAIS na hora do evento.
  // `.dre-svg` é a classe-marca que os DOIS gráficos carregam, justamente
  // para este listener não precisar saber qual está na tela.
  document.addEventListener('pointerdown', function (ev) {
    var svgs = document.querySelectorAll('#s-dre .dre-svg');
    if (!svgs.length) return;
    for (var i = 0; i < svgs.length; i++) {
      if (svgs[i].contains(ev.target)) return;
    }
    var tips = document.querySelectorAll('#s-dre .dre-tip');
    for (var j = 0; j < tips.length; j++) tips[j].style.display = 'none';
  });

  // ── Ordenação da tabela ──────────────────────────────────────────
  // `ord` e `cols` vêm de fora: as duas tabelas ordenam pelas mesmas regras
  // (null por último, texto em pt-BR, número por valor) sobre conjuntos de
  // colunas diferentes. Uma função só, dois estados.
  function ordenar(linhas, ord, cols) {
    var col = cols.filter(function (c) { return c.key === ord.col; })[0] || cols[cols.length - 1];
    var dir = ord.dir === 'asc' ? 1 : -1;
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

  // `escopo` = 'posto' na tabela por posto; ausente na de categoria. Cada uma
  // mexe no SEU estado de ordenação — ver o comentário de `_ordPosto`.
  window.__dreOrdenar = function (key, escopo) {
    var cols = (escopo === 'posto') ? COLS_POSTO : COLS;
    var ord  = (escopo === 'posto') ? _ordPosto  : _ord;
    var c = cols.filter(function (x) { return x.key === key; })[0];
    if (!c) return;
    if (ord.col === key) {
      ord.dir = ord.dir === 'desc' ? 'asc' : 'desc';
    } else {
      // Primeiro clique: texto sobe (A→Z), número desce (maior primeiro).
      ord.col = key;
      ord.dir = c.tipo === 'txt' ? 'asc' : 'desc';
    }
    render();
  };

  // ── Render ───────────────────────────────────────────────────────
  // Dataset da sub-aba ATIVA. O subtítulo e o período têm de descrever o que
  // está na tela — não o que a outra aba carregou antes.
  function dadosAtivos() { return _subaba === 'posto' ? _dadosPosto : _dados; }

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
      var per = (dadosAtivos() && dadosAtivos().periodo) ? dadosAtivos().periodo : null;
      sub.textContent = nomePosto + ' · ' +
        brData(per ? per.inicio : _inicio) + ' a ' + brData(per ? per.fim : _fim) +
        (per ? ' · ' + per.dias + ' dia(s)' : '');
    }

    if (_carregando) { body.innerHTML = '<div class="empty">Carregando…</div>'; return; }
    if (_erro) {
      body.innerHTML = '<div class="empty" style="color:var(--dg)">' + esc(_erro) + '</div>';
      return;
    }
    // Daqui para baixo é o corpo da sub-aba "Mês". A "Por Posto" tem KPIs,
    // gráfico e tabela próprios, e desvia aqui em vez de ramificar cada bloco.
    if (_subaba === 'posto') { renderPorPosto(body); return; }
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
    var ordenadas = ordenar(linhas, _ord, COLS);
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
      // UNIDADE (produtos): somar litros de combustível com unidades de produto
      // não produz grandeza nenhuma. O número existe no payload (a rota soma a
      // coluna do banco), mas exibi-lo com ou sem sufixo seria mentira das duas
      // formas —
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


  // ── Render da sub-aba "Por Posto" ────────────────────────────────
  // Mesmos KPIs, mesmas classes `col-<key>`, mesma linha de detalhe de celular
  // e mesmo `.dre-graf-wrap` da aba Mês. O que é próprio daqui: o conjunto de
  // colunas, o gráfico horizontal e a média da rede como referência.
  function renderPorPosto(body) {
    if (!_dadosPosto) { body.innerHTML = '<div class="empty">Sem dados.</div>'; return; }

    var T = _dadosPosto.totais || {};
    var linhas = Array.isArray(_dadosPosto.linhas) ? _dadosPosto.linhas : [];

    if (!linhas.length) {
      body.innerHTML =
        '<div class="card"><div class="cbody">' +
          '<div class="empty">Nenhum posto com lançamento no período.<br>' +
          '<span class="csub">A DRE vem do .xls de categoria da TecnoX, importado por posto. ' +
          'Posto não importado neste período não aparece aqui.</span></div>' +
        '</div></div>';
      return;
    }

    // KPIs: os MESMOS da aba Mês, sobre os totais da rede no período. São a
    // linha de base contra a qual as barras se leem.
    var kpis = '<div class="kgrid">' + KPIS.map(function (k) {
      var v = T[k.key];
      var cls = 'kval';
      if (k.destaque) cls += ' ac';
      if (k.sinal && !vazio(v)) cls += (Number(v) < 0 ? ' neg' : ' pos');
      return '<div class="kbox">' +
        '<div class="klbl">' + esc(k.rot) + '</div>' +
        '<div class="' + cls + '">' + k.fmt(v) + '</div>' +
      '</div>';
    }).join('') + '</div>';

    // UMA ordenação para os dois: a mesma lista alimenta gráfico e tabela, e é
    // por isso que "ordenadas junto" não precisou de sincronização nenhuma.
    var ordenadas = ordenar(linhas, _ordPosto, COLS_POSTO);
    var mediaRede = (T.margem_pct === null || T.margem_pct === undefined) ? null : Number(T.margem_pct);

    var ths = COLS_POSTO.map(function (c) {
      var on = _ordPosto.col === c.key;
      var seta = on ? (_ordPosto.dir === 'desc' ? ' ↓' : ' ↑') : '';
      var tit = c.titulo ? c.titulo : ('Ordenar por ' + c.rot);
      return '<th class="ord col-' + c.key + (c.tipo === 'num' ? ' num' : '') + (on ? ' on' : '') + '"' +
        ' onclick="__dreOrdenar(\'' + c.key + '\', \'posto\')"' +
        ' title="' + esc(tit) + '">' +
        '<span class="rot-l">' + esc(c.rot) + '</span>' +
        '<span class="rot-c">' + esc(c.rotCurto || c.rot) + '</span>' +
        seta + '</th>';
    }).join('');

    var trs = ordenadas.map(function (l) {
      var celulas = COLS_POSTO.map(function (c) {
        var v = l[c.key];
        var neg = (c.tipo === 'num' && !vazio(v) && Number(v) < 0) ? ' dre-neg' : '';
        // O nome leva `title` com o nome inteiro: em celular a célula trunca
        // com elipse, e sem isto o posto ficaria sem identificação.
        var tit = (c.key === 'nome') ? ' title="' + esc(tituloPosto(l)) + '"'
          : (c.titulo ? ' title="' + esc(c.titulo) + '"' : '');
        // A marca de lacuna vai no NOME, não numa coluna nova: é ressalva de
        // toda a linha, e uma coluna a mais não caberia em 375px.
        var marca = (c.key === 'nome' && temLacuna(l))
          ? '<span class="dre-lacuna" title="' + esc(textoLacuna(l)) + '">*</span>' : '';
        return '<td class="col-' + c.key + (c.tipo === 'num' ? ' num' : '') + neg + '"' + tit + '>'
          + c.fmt(v, l) + marca + '</td>';
      }).join('');
      var det = MOBILE_OCULTA_POSTO.map(function (k) {
        var c = COL_POSTO_POR_KEY[k];
        return '<div class="dre-det-par"><span>' + esc(c.rot) + '</span><b>' + c.fmt(l[k], l) + '</b></div>';
      }).join('');
      return '<tr onclick="__dreDetalhe(this)" title="Toque para ver quantidade e custo">'
        + celulas + '</tr>'
        + '<tr class="dre-det"><td colspan="' + COLS_POSTO.length + '">' + det + '</td></tr>';
    }).join('');

    // Rodapé = totais da ROTA (a rede no período), não a soma das linhas na
    // tela — mesma regra da aba Mês.
    var tfoot = '<tr>' + COLS_POSTO.map(function (c, i) {
      if (i === 0) return '<td class="col-' + c.key + '">REDE</td>';
      if (c.key === 'quantidade') {
        return '<td class="col-' + c.key + ' num" title="Sem total: a coluna mistura litros (combustíveis) e unidades (produtos).">—</td>';
      }
      var v = T[c.key];
      var neg = (!vazio(v) && Number(v) < 0) ? ' dre-neg' : '';
      return '<td class="col-' + c.key + ' num' + neg + '">' + c.fmt(v) + '</td>';
    }).join('') + '</tr>';

    // ── Gráfico horizontal, ENTRE os KPIs e a tabela ──
    var svg = svgMargemPosto(ordenadas, mediaRede);
    var comMargem = ordenadas.filter(temMargem).length;
    var comLacuna = ordenadas.filter(temLacuna).length;
    var cardGraf = svg
      ? '<div class="card" style="margin-top:.9rem">' +
          '<div class="chdr">' +
            '<div class="ctitle">Margem por posto</div>' +
            '<div class="csub">' + comMargem + ' posto(s) com margem' +
              (ordenadas.length > comMargem
                ? ' · ' + (ordenadas.length - comMargem) + ' sem venda líquida (sem barra)' : '') +
              // A média vai TAMBÉM no subtítulo: com 37 postos o card fica alto
              // e o rótulo da linha sai da vista ao rolar a página.
              (mediaRede === null ? '' : ' · média da rede ' + nf(mediaRede, 2) + '%') +
              ' · passe o mouse ou toque numa faixa</div>' +
          '</div>' +
          '<div class="cbody"><div class="dre-graf-wrap">' + svg +
            '<div class="dre-tip" style="display:none"></div>' +
          '</div></div>' +
        '</div>'
      : '';

    body.innerHTML = kpis + cardGraf +
      '<div class="card" style="margin-top:.9rem">' +
        '<div class="chdr">' +
          '<div class="ctitle">Por posto</div>' +
          '<div class="csub">' + ordenadas.length + ' posto(s) · clique no cabeçalho para ordenar' +
            (comLacuna
              ? ' · ' + comLacuna + ' com <span class="dre-lacuna">*</span> têm custo incompleto no arquivo'
              : '') +
            '</div>' +
        '</div>' +
        '<div class="cbody dre-scroll">' +
          '<table class="dre-table">' +
            '<thead><tr>' + ths + '</tr></thead>' +
            '<tbody>' + trs + '</tbody>' +
            '<tfoot>' + tfoot + '</tfoot>' +
          '</table>' +
        '</div>' +
      '</div>';

    // DEPOIS do innerHTML: os alvos de ponteiro só existem agora. Mesmo binder
    // do gráfico diário — só o título do balão e o eixo que ele segue mudam.
    if (svg) {
      ligarTooltipGrafico(ordenadas, {
        svg: '.dre-hgraf',
        seguirY: true,
        titulo: function (l) { return esc(rotuloPosto(l)); },
      });
    }
  }


  // ══ IMPORTAÇÃO DO .XLS → POST /dre/importar ══════════════════════
  // MESMO fluxo e MESMOS componentes da importação do Custo & Margem
  // (modulos/logistica/custo-margem.js): botão + input escondido, dry_run
  // primeiro, modal .cmi-* com a prévia, e só então o botão que grava. O CSS
  // do modal é injetado por lá (__cmInjetarEstiloImport) para não haver duas
  // cópias das mesmas regras envelhecendo em paralelo.
  //
  // A DIFERENÇA OBRIGATÓRIA: /custos/importar recebe base64 num JSON;
  // /dre/importar recebe MULTIPART no campo `arquivo` (a rota usa multer com
  // memoryStorage). Então aqui vai FormData, e o Content-Type NÃO é definido à
  // mão — quem monta o boundary é o navegador, e fixar 'application/json'
  // faria o multer não achar arquivo nenhum.
  var IMP_MAX_MB = 15;   // mesmo teto da rota (limits.fileSize)

  // Fetch dedicado, como o importFetch do Custo & Margem: precisa do STATUS e
  // do CORPO mesmo em erro, porque o 400 da rota traz `codigo`, `detalhes` e as
  // próprias conferências — é com isso que a tela explica o que corrigir. O
  // apiFetch descartaria o corpo em não-2xx. Mantém o refresh-once do token.
  async function impFetch(file, dryRun, _retry) {
    var token = window.jbretasGetItem ? window.jbretasGetItem('jbretas_token') : null;
    var fd = new FormData();
    fd.append('arquivo', file, file.name);
    fd.append('dry_run', dryRun ? 'true' : 'false');
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var resp = await fetch(window.JBRETAS_CONFIG.API_URL + '/dre/importar', {
      method: 'POST', headers: headers, body: fd,
    });
    if (resp.status === 401 && !_retry && typeof window.jbretasRefresh === 'function') {
      if (await window.jbretasRefresh()) return impFetch(file, dryRun, true);
    }
    if (resp.status === 401) {
      if (window.jbretasClearSessao) window.jbretasClearSessao();
      window.location.href = (window.caminhoRaiz ? window.caminhoRaiz() : '') + 'index.html?expirado=1';
      return { status: 401, json: {} };
    }
    var json = null;
    try { json = await resp.json(); } catch (e) { /* corpo não-JSON */ }
    return { status: resp.status, json: json || {} };
  }

  // status HTTP + corpo → mensagem legível. Espelha o mensagemErroImport do
  // Custo & Margem, com os status que ESTA rota devolve.
  function impMensagemErro(status, json) {
    var base = json && json.erro ? String(json.erro) : '';
    if (status === 403) return 'Só o perfil TI pode importar a DRE.';
    if (status === 413) return 'Arquivo maior que ' + IMP_MAX_MB + ' MB. A rota recusa antes de ler.';
    if (status === 429) {
      var seg = Number(json && json.retry_apos) || 0;
      var espera = seg <= 0 ? ''
        : (seg >= 60 ? ' Tente em ' + Math.ceil(seg / 60) + ' min.' : ' Tente em ' + seg + 's.');
      return (base || 'Muitas importações em pouco tempo.') + espera;
    }
    if (status === 400) return base || 'O arquivo não é um .xls válido.';
    return base ? ('Erro: ' + base) : ('Erro inesperado (HTTP ' + status + ').');
  }

  // ── Modal (mesma estrutura do cmi-* do Custo & Margem) ───────────
  function impMontarModal() {
    // Injeta o CSS .cmi-* de lá. Se o custo-margem.js não estiver carregado o
    // modal ainda funciona, só sem estilo — então avisa no console em vez de
    // falhar calado.
    if (typeof window.__cmInjetarEstiloImport === 'function') window.__cmInjetarEstiloImport();
    else console.warn('DRE: custo-margem.js não carregado; modal de importação sem estilo.');
    if (document.getElementById('dri-overlay')) return;
    var ov = document.createElement('div');
    ov.className = 'cmi-overlay';
    ov.id = 'dri-overlay';
    ov.innerHTML =
      '<div class="cmi-sheet">' +
        '<button class="cmi-close" id="dri-close">✕</button>' +
        '<div class="cmi-title" id="dri-title">Prévia da importação</div>' +
        '<div class="cmi-file" id="dri-file"></div>' +
        '<div id="dri-body"></div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('dri-close').onclick = impFechar;
    ov.addEventListener('click', function (e) { if (e.target === ov) impFechar(); });
  }
  function impFechar() { var ov = document.getElementById('dri-overlay'); if (ov) ov.classList.remove('open'); }
  function impAbrirOverlay() { impMontarModal(); document.getElementById('dri-overlay').classList.add('open'); }
  window.__dreImpFechar = impFechar;

  function impErro(msg, detalhes) {
    impAbrirOverlay();
    document.getElementById('dri-title').textContent = 'Importação';
    document.getElementById('dri-file').textContent = _impFile ? _impFile.name : '';
    var lista = (detalhes && detalhes.length)
      ? '<ul class="dri-det">' + detalhes.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
      : '';
    document.getElementById('dri-body').innerHTML =
      '<div class="cmi-erro-ic">⚠️</div>' +
      '<div class="cmi-msg">' + esc(msg) + '</div>' + lista +
      '<div class="cmi-foot"><button class="cmi-btn ghost" onclick="__dreImpFechar()">Fechar</button></div>';
  }

  // Spinner: arquivo com muitos postos demora (a rota confere bloco por bloco).
  function impProcessando(titulo, texto) {
    impAbrirOverlay();
    document.getElementById('dri-title').textContent = titulo;
    document.getElementById('dri-file').textContent = _impFile ? _impFile.name : '';
    document.getElementById('dri-body').innerHTML =
      '<div class="dri-load"><div class="dri-spin"></div><div>' + esc(texto) + '</div></div>';
  }

  // As 5 conferências, na ordem, com o rótulo do que cada uma garante.
  var IMP_CONF = [
    { k: 'c1', n: '1', rot: 'Soma das categorias x "Total Empresa:"' },
    { k: 'c2', n: '2', rot: 'Soma dos "Total Dia:" x "Total Geral:"' },
    { k: 'c3', n: '3', rot: 'Chave (posto, data, categoria) única no arquivo' },
    { k: 'c4', n: '4', rot: 'cod_empresa casa com posto cadastrado' },
    { k: 'c5', n: '5', rot: '"Lucro Total R$" x (líquida − custo)' },
  ];

  // Detalhe curto por conferência — o que ela mediu, não só ok/falhou.
  function impDetalheConf(k, c) {
    if (!c) return 'não executada (uma anterior barrou antes)';
    if (k === 'c1') return c.ok ? c.blocos + ' bloco(s) fecham' : c.falhas.length + ' bloco(s) não fecham';
    if (k === 'c2') return c.ok ? c.dias + ' dia(s) somam o total geral' : (c.motivo || 'não fecha');
    if (k === 'c3') return c.ok ? c.chaves + ' chave(s) distinta(s)' : c.duplicadas.length + ' chave(s) repetida(s)';
    if (k === 'c4') return c.ok ? c.postos + ' posto(s) casado(s)' : c.faltando.length + ' cod_empresa sem posto';
    if (k === 'c5') {
      if (!c.comparadas) return 'sem coluna de lucro no arquivo — nada comparado';
      return c.ok ? c.comparadas + ' linha(s) conferem'
        : c.divergencias.length + ' de ' + c.comparadas + ' divergem (delta ' + fmtRS(c.delta_total) + ')';
    }
    return '';
  }

  function impRenderPrevia(p, gravado) {
    var C = p.conferencias || {};
    var per = p.periodo || {};
    var postos = p.postos_detectados || [];
    var resumo = p.resumo_por_posto || [];
    var c5 = C.c5 || null;
    // BLOQUEIA o confirmar se 1, 2, 3 ou 4 falharam. A 5 avisa e NÃO bloqueia.
    var bloqueadas = ['c1', 'c2', 'c3', 'c4'].filter(function (k) { return C[k] && C[k].ok === false; });
    var podeGravar = !bloqueadas.length;

    document.getElementById('dri-title').textContent = gravado ? 'Importação concluída' : 'Prévia da importação';
    document.getElementById('dri-file').textContent = (p.arquivo && p.arquivo.nome) || (_impFile ? _impFile.name : '');

    // Cards no topo: o que o celular precisa ver primeiro.
    var cards = '<div class="cmi-cards">' +
      '<div class="cmi-c"><b>' + (p.registros != null ? p.registros : '—') + '</b><span>Registros</span></div>' +
      '<div class="cmi-c"><b>' + postos.length + '</b><span>Posto(s)</span></div>' +
      '<div class="cmi-c' + (bloqueadas.length ? ' bad' : '') + '"><b>' + bloqueadas.length +
        '</b><span>Barrando</span></div>' +
    '</div>';

    var faixa = (per.inicio || per.fim)
      ? '<div class="cmi-faixa">Período: <b>' + esc(brData(per.inicio)) + '</b> → <b>' +
        esc(brData(per.fim)) + '</b>' + (per.dias ? ' · ' + per.dias + ' dia(s)' : '') + '</div>'
      : '';

    var postosTxt = postos.length
      ? '<div class="cmi-info">Postos detectados: ' + postos.map(function (x) {
          return esc(x.nome || x.nome_arquivo) + ' (' + x.cod_empresa + ')';
        }).join(', ') + '</div>'
      : '';

    // As 5 conferências, uma a uma.
    var confs = '<div class="dri-confs">' + IMP_CONF.map(function (cf) {
      var c = C[cf.k];
      var st = !c ? 'na' : (c.ok ? 'ok' : (cf.k === 'c5' ? 'warn' : 'bad'));
      var ic = st === 'ok' ? '✓' : (st === 'bad' ? '✕' : (st === 'warn' ? '!' : '–'));
      return '<div class="dri-conf ' + st + '">' +
        '<span class="dri-ic">' + ic + '</span>' +
        '<span class="dri-rot"><b>' + cf.n + '.</b> ' + esc(cf.rot) + '</span>' +
        '<span class="dri-val">' + esc(impDetalheConf(cf.k, c)) + '</span>' +
      '</div>';
    }).join('') + '</div>';

    // O que precisa ser corrigido NO ARQUIVO quando alguma barrou.
    var erroBloq = '';
    if (bloqueadas.length) {
      var det = (p.detalhes && p.detalhes.length) ? p.detalhes : [];
      // O QUE CORRIGIR depende de QUAL conferência barrou, e a diferença é
      // real: 1, 2 e 3 são problema DO ARQUIVO (soma que não fecha, chave
      // repetida); a 4 é problema de CADASTRO — o arquivo está certo, falta o
      // cod_empresa no posto. Mandar "corrija a planilha" num caso de cadastro
      // faz o operador reexportar da TecnoX à toa e voltar com o mesmo erro.
      var comoCorrigir = (C.c4 && C.c4.ok === false)
        ? 'Não é problema do arquivo: falta o cod_empresa no cadastro do posto. ' +
          'Preencha postos.cod_empresa_tecnox e importe de novo. Nada foi gravado.'
        : 'Corrija no arquivo exportado da TecnoX, salve e importe de novo. Nada foi gravado.';
      erroBloq = '<div class="cmi-bloq">' +
        '<div class="cmi-bloq-tit">⛔ ' + esc(p.erro || 'Conferência não fechou') + '</div>' +
        (det.length ? '<ul>' + det.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="cmi-fix">' + esc(comoCorrigir) + '</div>' +
      '</div>';
    }

    // Divergências da conferência 5: EM DESTAQUE, mas sem bloquear.
    var divHtml = '';
    if (c5 && !c5.ok && c5.divergencias && c5.divergencias.length) {
      var linhas = c5.divergencias.slice(0, 30).map(function (d) {
        return '<tr><td>' + esc(brData(d.data)) + '</td><td>' + esc(d.cat_nome) + '</td>' +
          '<td class="cmi-cst">' + fmtRS(d.lucro_arq) + '</td>' +
          '<td class="cmi-cst">' + fmtRS(d.lucro_calc) + '</td>' +
          '<td class="cmi-cst dre-neg">' + fmtRS(d.delta) + '</td></tr>';
      }).join('');
      divHtml = '<div class="dri-aviso">' +
        '<div class="dri-aviso-tit">⚠️ Conferência 5: ' + c5.divergencias.length +
          ' divergência(s), delta total ' + fmtRS(c5.delta_total) + '</div>' +
        '<div class="dri-aviso-txt">A coluna "Lucro Total R$" do arquivo discorda de ' +
          'venda líquida − custo. Isto AVISA e não impede a importação: o lucro não é gravado ' +
          '(a tabela não tem a coluna) e a DRE calcula líquida − custo. Confira esses dias na TecnoX.</div>' +
        // A tabela rola DENTRO do próprio container. Sem isto, em 375px as 5
        // colunas arrastavam o modal inteiro na horizontal — medido.
        '<div class="dri-tblwrap"><table class="cmi-tbl"><thead><tr><th>Data</th><th>Categoria</th>' +
          '<th>Lucro arq.</th><th>Calculado</th><th>Delta</th></tr></thead><tbody>' +
          linhas + '</tbody></table></div>' +
        (c5.divergencias.length > 30
          ? '<div class="cmi-fix">… e mais ' + (c5.divergencias.length - 30) + '</div>' : '') +
      '</div>';
    }

    // Resumo por posto: a informação mais volumosa. RECOLHIDO em tela estreita
    // (no celular a prioridade é conferências, registros e divergências) e
    // aberto no desktop, onde há espaço.
    var estreito = !!(window.matchMedia && window.matchMedia('(max-width: 560px)').matches);
    var resumoHtml = '';
    if (resumo.length) {
      var rows = resumo.map(function (r) {
        return '<tr><td>' + esc(r.nome) + '</td><td class="cmi-cst">' + r.dias + '</td>' +
          '<td class="cmi-cst">' + r.categorias + '</td>' +
          '<td class="cmi-cst">' + fmtRS(r.venda_bruta) + '</td>' +
          '<td class="cmi-cst">' + fmtRS(r.venda_liquida) + '</td>' +
          '<td class="cmi-cst">' + fmtRS(r.custo_total) + '</td></tr>';
      }).join('');
      resumoHtml = '<details class="dri-det-box"' + (estreito ? '' : ' open') + '>' +
        '<summary>Resumo por posto (' + resumo.length + ')</summary>' +
        '<div class="dri-tblwrap"><table class="cmi-tbl"><thead><tr><th>Posto</th><th>Dias</th>' +
          '<th>Cats</th><th>Bruta</th><th>Líquida</th><th>Custo</th></tr></thead><tbody>' +
          rows + '</tbody></table></div>' +
      '</details>';
    }

    // Rodapé: antes de gravar mostra o confirmar (se nada barrou); depois de
    // gravar troca por "Fechar", mantendo TODO o resultado na tela — o usuário
    // confere o que subiu.
    var foot;
    if (gravado) {
      foot = '<div class="dri-ok">✓ ' + (p.gravados != null ? p.gravados : 0) +
               ' registro(s) gravados. Os dados da aba já foram recarregados.</div>' +
             '<div class="cmi-foot"><button class="cmi-btn ghost" onclick="__dreImpFechar()">Fechar</button></div>';
    } else if (podeGravar) {
      foot = '<div class="cmi-foot">' +
        '<button class="cmi-btn" id="dri-gravar" onclick="__dreImpConfirmar()">Confirmar importação' +
          (p.registros != null ? ' (' + p.registros + ')' : '') + '</button>' +
        '<button class="cmi-btn ghost" onclick="__dreImpFechar()">Cancelar</button></div>';
    } else {
      // Sem botão de confirmar: não há o que fazer aqui além de corrigir o arquivo.
      foot = '<div class="cmi-foot"><button class="cmi-btn ghost" onclick="__dreImpFechar()">Fechar</button></div>';
    }

    document.getElementById('dri-body').innerHTML =
      cards + faixa + postosTxt + confs + erroBloq + divHtml + resumoHtml + foot;
  }

  // ── Handlers ─────────────────────────────────────────────────────
  window.__dreImpAbrir = function () {
    var inp = document.getElementById('dre-imp-file');
    if (inp) { inp.value = ''; inp.click(); }
  };

  window.__dreImpFile = async function (input) {
    var file = input.files && input.files[0];
    input.value = '';                                  // permite reescolher o mesmo arquivo
    if (!file) return;
    // O relatório da TecnoX é .xls legado (BIFF8). A rota confere os magic
    // bytes OLE2 e recusa .xlsx; barrar aqui evita a ida à rede.
    if (!/\.xls$/i.test(file.name)) { alert('Selecione o .xls exportado da TecnoX (.xlsx não serve).'); return; }
    if (file.size > IMP_MAX_MB * 1024 * 1024) { alert('Arquivo maior que ' + IMP_MAX_MB + ' MB.'); return; }

    _impFile = file;
    var btn = document.getElementById('dre-imp-btn');
    var rot = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Conferindo…'; }
    impProcessando('Conferindo o arquivo', 'Lendo e conferindo bloco por bloco. Arquivo com muitos postos demora.');
    try {
      var r = await impFetch(file, true);
      // 400 COM `conferencias` no corpo não é erro de tela: é conferência que
      // barrou, e a prévia mostra isso melhor que um alerta — inclusive quais
      // fecharam antes da que falhou.
      if (r.json && r.json.conferencias) { impRenderPrevia(r.json, false); return; }
      if (r.status !== 200) { impErro(impMensagemErro(r.status, r.json), r.json && r.json.detalhes); return; }
      impRenderPrevia(r.json, false);
    } catch (err) {
      impErro('Erro ao enviar o arquivo: ' + ((err && err.message) || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = rot || '📥 Importar planilha'; }
    }
  };

  window.__dreImpConfirmar = async function () {
    if (!_impFile) return;
    var btn = document.getElementById('dri-gravar');
    if (btn) { btn.disabled = true; btn.textContent = 'Gravando…'; }
    impProcessando('Gravando', 'Enviando os registros em lotes. Não feche a tela.');
    try {
      var r = await impFetch(_impFile, false);
      if (r.status === 200 && r.json && r.json.gravados != null) {
        // Recarrega os dados da aba ANTES de repintar o modal: quando o usuário
        // fechar, a tela atrás já mostra o que subiu.
        await carregar();
        impRenderPrevia(r.json, true);
        return;
      }
      // Falhou ao gravar: mostra o erro. Para tentar de novo é preciso
      // reescolher o arquivo — o dry_run é refeito e a prévia volta. Guardar a
      // prévia anterior só para reexibi-la seria guardar um retrato que pode
      // não valer mais (o arquivo em disco pode ter mudado no meio).
      impErro(impMensagemErro(r.status, r.json), r.json && r.json.detalhes);
    } catch (err) {
      impErro('Erro ao gravar: ' + ((err && err.message) || err));
    }
  };

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
