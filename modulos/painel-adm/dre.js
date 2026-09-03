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
    { id: 'dia',      rotulo: 'Dia',       pronta: true,
      dica: 'Um dia só, posto a posto' },
    { id: 'mes',      rotulo: 'Mês',       pronta: true,
      dica: 'Fechamento do período escolhido, por categoria' },
    { id: 'posto',    rotulo: 'Por Posto', pronta: true,
      dica: 'Compara os postos entre si no mesmo período' },
    { id: 'projecao', rotulo: 'Projeção',  pronta: true,
      dica: 'Mês corrente projetado e o ano mês a mês' },
  ];

  var _shellPronto = false;
  var _subaba      = 'mes';  // sub-aba ativa: 'dia' | 'mes' | 'posto'
  var _dados       = null;   // resposta do GET /dre (agrupar=categoria)
  var _dadosDia    = null;   // resposta do GET /dre (agrupar=dia) — série do gráfico
  var _dadosPosto  = null;   // resposta do GET /dre (agrupar=posto)
  // ── Sub-aba "Dia" ──
  var _dia      = null;      // a data escolhida (YYYY-MM-DD). Uma só, não intervalo.
  var _dadosD   = null;      // GET /dre do DIA (agrupar=posto, ou =categoria com posto)
  var _dadosDAnt = null;     // MESMA chamada no dia ANTERIOR, só para a comparação.
                             // Secundária: se falhar, a comparação é OMITIDA, não zerada.
  // ── Sub-aba "Projeção" ──
  var _dadosPMes = null;     // GET /dre agrupar=dia, dia 1 do mês corrente até hoje
  var _dadosPAno = null;     // GET /dre agrupar=dia, 01/01 até hoje (agrupado por mês aqui)
  // A LITRAGEM VEM NA PRÓPRIA SÉRIE. A GET /dre devolve `litros` em cada
  // linha e nos totais, nos três agrupamentos — só o que é medido em litro,
  // separado da `quantidade` que mistura litro com unidade.
  //
  // Antes esta aba pedia `agrupar=categoria` mês a mês só para somar litro:
  // 9 a 12 requisições por tela aberta, para um dado que a rota já tinha em
  // mãos. Agora são DUAS chamadas, as mesmas de sempre.
  //
  // Métrica exibida no gráfico. O gráfico é UM só; isto troca o CAMPO.
  var _metricaAno = 'lucro';
  // Escopo do gráfico e da tabela: 'ano' = 12 meses; 'mes' = série DIÁRIA de
  // UM mês, escolhido em `_mesDiario`. Troca o EIXO, não a métrica — as duas
  // dimensões são independentes, então 4 métricas × 2 escopos saem do mesmo
  // desenhador.
  // Trocar de MÉTRICA nunca busca nada. Trocar de MÊS busca uma vez, e só se
  // aquele mês ainda não estiver em `_seriesMes`.
  var _escopoAno = 'ano';
  // Qual mês o modo Diário mostra ('YYYY-MM'). Default = mês corrente.
  var _mesDiario = null;
  // CACHE das séries diárias por mês. A do mês CORRENTE já vem no fetch da
  // aba; a de um mês passado não, então é buscada quando o usuário escolhe —
  // e guardada, para voltar ao mês não repetir a chamada.
  // Zerado a cada `carregar()`: trocar o posto muda os números, e cache que
  // sobrevive a isso devolve o dado do posto anterior.
  var _seriesMes = null;     // Map 'YYYY-MM' -> resposta do GET /dre
  var _carregandoMes = false;
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
  // Barra com o balão aberto, e a que estava aberta antes do gesto atual.
  // NO MÓDULO, e não na closure do binder, porque o listener de "toque fora"
  // (que é único e vive fora dele) também precisa zerar as duas.
  var _barraSel = null;
  var _barraAnt = null;

  // Ordenação da tabela do DIA. Estado próprio pelo mesmo motivo, e com uma
  // particularidade: a tabela troca de conjunto de colunas quando um posto é
  // escolhido (postos -> categorias). Ver `ordDiaValida`.
  var _ordDia = { col: 'margem_pct', dir: 'desc' };

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

  // Anda `n` dias a partir de um ISO. TODA a conta em UTC (Date.UTC entrando,
  // getUTC* saindo), nunca hora local: `new Date('2026-03-01')` seguido de
  // setDate local desliza uma hora em fuso com horário de verão e pode pular
  // ou repetir um dia. Aqui não há hora nenhuma envolvida.
  // Atravessa mês e ano sozinho, e resolve 28/29/30/31 sem tabela.
  function somarDiasISO(iso, n) {
    var p = String(iso).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    var z = function (x) { return String(x).padStart(2, '0'); };
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate());
  }

  // Dia da semana de um ISO. Date.UTC + getUTCDay pelo mesmo motivo de
  // `somarDiasISO`: `new Date('2026-09-01')` é meia-noite UTC e, lido com
  // getDay() local em Brasília (UTC-3), volta para o dia ANTERIOR.
  var SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function diaDaSemana(iso) {
    var p = String(iso).split('-').map(Number);
    return SEMANA[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }

  // ONTEM, no fuso do Brasil — o default da sub-aba "Dia".
  // Por que ontem e não hoje: o dado vem do .xls exportado à mão da TecnoX, e
  // o dia corrente quase nunca está importado. Abrir na data de hoje mostraria
  // "sem dado" na maioria dos acessos, e quem abre a aba concluiria que a tela
  // está quebrada em vez de que o arquivo do dia ainda não subiu.
  function ontemISO() { return somarDiasISO(hojeISO(), -1); }

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
  // UNIDADE da quantidade. Duas famílias vêm em LITRO; o resto, em UNIDADE.
  // A coluna mistura as duas grandezas, então o sufixo é INFORMAÇÃO, não
  // enfeite: sem ele a quantidade de combustível (litros) e a de lubrificante
  // (unidades) ficam na mesma coluna como se fossem a mesma medida — e a de
  // combustível é ordens de magnitude maior, o que reforça a leitura errada.
  //
  // normalize('NFD') + remoção de acento antes de comparar: o export pode vir
  // "COMBUSTÍVEIS" com acento, e aí a comparação crua falharia calada.
  //
  // MEDIDO sobre as 44.481 linhas da tabela (03/09/2026): contagem de itens é
  // inteira, volume de bomba/bico quase nunca é. Cruzado com o preço unitário:
  //
  //   categoria                  %frac    R$/un   -> grandeza
  //   COMBUSTIVEIS                100%     5,51      LITRO
  //   LUBRIFICANTES A GRANEL       98%     3,32      LITRO
  //   as outras 24 categorias        0%   15 a 108    unidade
  //
  // A separação é total: 98-100% contra ZERO por cento, sem caso ambíguo.
  //
  // OS DOIS TESTES SÃO DIFERENTES DE PROPÓSITO, cada um pelo seu motivo:
  //
  // "COMBUSTIVE" é COMEÇA COM, nunca contém: a categoria 12 é
  // "FILTRO DE COMBUSTIVEL", que tem a palavra dentro do nome e é vendida por
  // UNIDADE (0% fracionária, R$ 54,44). Um `includes` marcaria filtro de
  // combustível como litro — o oposto do que se quer, e sem erro nenhum para
  // denunciar, só uma litragem inflada.
  //
  // "GRANEL" é CONTÉM: a granel É venda por volume, é o que a palavra
  // significa, e assim pega um "ARLA A GRANEL" que a TecnoX cadastre amanhã
  // sem precisar mexer no código. "LUBRIFICANTES PESADOS" (tambor, R$ 97,39,
  // 0% fracionária) não contém a palavra e fica de fora, corretamente.
  //
  // MESMA regra do `ehLitro` na GET /dre (jbretas-api/server.js). Ao mexer
  // aqui, mexer lá — divergir faz litro significar duas coisas na mesma tela.
  function unidadeDe(catNome) {
    var n = String(catNome || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toUpperCase();
    return (n.indexOf('COMBUSTIVE') === 0 || n.indexOf('GRANEL') >= 0) ? ' L' : ' un';
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

  // ── Colunas da tabela da sub-aba "Dia" ───────────────────────────
  // DERIVADAS das definições que já existem, não redigitadas: mesmos
  // formatadores, mesmos rótulos curtos, mesmas chaves. Se `fmtRS` ou o rótulo
  // de uma coluna mudar, muda nas três abas de uma vez.
  //
  // Sem `quantidade`: num dia só, a soma de litros com unidades diz menos
  // ainda do que num mês, e a coluna a mais custaria largura em 375px.
  var COLS_DIA_NUM = ['venda_liquida', 'custo_total', 'lucro', 'margem_pct']
    .map(function (k) { return COL_POSTO_POR_KEY[k]; });
  // Duas variantes, escolhidas pelo escopo: sem posto escolhido a tabela lista
  // POSTOS; com posto escolhido, as CATEGORIAS daquele posto no dia.
  var COLS_DIA     = [COL_POSTO_POR_KEY.nome].concat(COLS_DIA_NUM);
  var COLS_DIA_CAT = [COL_POR_KEY.cat_nome].concat(COLS_DIA_NUM);
  // Celular: cai só o Custo, e sobram as 4 colunas das outras abas.
  var MOBILE_OCULTA_DIA = ['custo_total'];

  // Colunas em vigor e guarda da ordenação. Trocar de escopo troca a primeira
  // coluna (`nome` <-> `cat_nome`), e uma ordenação por uma chave que não
  // existe mais cairia no fallback de `ordenar` e ordenaria por OUTRA coluna
  // sem avisar — com a seta do cabeçalho apontando para nenhuma.
  function colsDia() { return _postoId ? COLS_DIA_CAT : COLS_DIA; }
  function ordDiaValida() {
    var cols = colsDia();
    var existe = cols.some(function (c) { return c.key === _ordDia.col; });
    if (!existe) { _ordDia.col = 'margem_pct'; _ordDia.dir = 'desc'; }
    return _ordDia;
  }

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
      // ── SUB-ABA "DIA" ────────────────────────────────────────────
      // Setas colando no campo de data, tudo numa linha. `min-width:0` no
      // input para o grid não estourar em 375px — o campo de data nativo tem
      // largura intrínseca teimosa.
      '#s-dre .dre-navdia { display: flex; gap: .3rem; align-items: stretch; }' +
      '#s-dre .dre-navdia .dre-date { min-width: 0; flex: 1; }' +
      '#s-dre .dre-passo { flex: 0 0 auto; width: 2.1rem; background: var(--sf2);' +
        ' border: 1px solid var(--bd); border-radius: 8px; color: var(--tx2);' +
        ' font-size: 1.05rem; line-height: 1; cursor: pointer;' +
        ' transition: border-color .15s, color .15s; }' +
      '#s-dre .dre-passo:hover:not(:disabled) { border-color: var(--ac); color: var(--ac); }' +
      '#s-dre .dre-passo:disabled { color: var(--tx3); border-style: dashed;' +
        ' cursor: not-allowed; }' +
      // Margem embaixo do lucro e variação ao lado da venda: são RESSALVAS do
      // número de cima, então ficam no mesmo card, menores.
      '#s-dre .kmini { font-size: .68rem; font-family: var(--mono); color: var(--tx3);' +
        ' margin-top: 2px; }' +
      '#s-dre .kmini.pos { color: var(--ok); }' +
      '#s-dre .kmini.neg { color: var(--dg); }' +
      // Legenda da linha da média — ABAIXO do gráfico, fora da área de
      // plotagem, para não tapar barra nenhuma. O traço é uma amostra da
      // própria linha (tracejada, cor de destaque), então não precisa dizer
      // "a linha tracejada é": mostra.
      '#s-dre .dre-legenda { display: flex; align-items: center; gap: .35rem;' +
        ' margin-top: .3rem; font-family: var(--mono); font-size: .62rem;' +
        ' font-weight: 700; color: var(--ac); }' +
      '#s-dre .dre-leg-traco { display: inline-block; width: 1.5rem; height: 0;' +
        ' border-top: 1.5px dashed var(--ac); }' +
      // Faixa de "sem dado": informa a data e mantém a navegação à vista.
      '#s-dre .dre-vazio-dia { text-align: center; padding: 1.6rem 1rem; color: var(--tx3); }' +
      '#s-dre .dre-vazio-dia b { display: block; color: var(--tx2); font-size: .9rem;' +
        ' margin-bottom: .35rem; }' +
      // TRÊS KPIs (abas Dia e Projeção). O `.kgrid` geral cai para 2 colunas
      // abaixo de 900px, o que deixaria um card órfão sozinho na segunda
      // linha — daí a classe própria.
      //
      // POR QUE EMPILHA E NÃO FICA EM 3 COLUNAS NO CELULAR: em 375px, três
      // colunas dão card de 110px, com 78px de conteúdo. Um valor de sete
      // dígitos com centavos pede ~97px a .95rem, e o `.kval` é nowrap — ele
      // VAZAVA do card (medido: scrollWidth 97 contra clientWidth 78). Os
      // cards caberem não é o mesmo que os números caberem, e o erro estava
      // em ter conferido só a primeira coisa. Empilhado, cada card fica com a
      // largura toda e o valor sobra espaço.
      // Três cards empilhados são três linhas — aceitável; a objeção a
      // empilhar valia para os SEIS da aba Mês, que viravam seis telas.
      '#s-dre .kgrid.kgrid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }' +
      '@media (max-width: 700px) {' +
        '#s-dre .kgrid.kgrid-3 { grid-template-columns: 1fr; }' +
        // Empilhado há largura sobrando: o valor volta ao tamanho de leitura
        // em vez de ficar com a fonte reduzida do layout apertado.
        '#s-dre .kgrid.kgrid-3 .kval { font-size: 1.35rem; }' +
      '}' +
      // 700–900px: três colunas estreitas, então o valor encolhe para caber.
      '@media (min-width: 701px) and (max-width: 900px) {' +
        '#s-dre .kgrid.kgrid-3 .kval { font-size: 1.15rem; }' +
      '}' +
      // ── SUB-ABA "PROJEÇÃO" ───────────────────────────────────────
      // TRÊS ASPECTOS, três afirmações diferentes sobre o mesmo eixo:
      //   sólido    = mês FECHADO, é fato;
      //   hachurado = PROJEÇÃO, ninguém mediu;
      //   contorno  = PARCIAL, o mês em curso — é fato, mas fato incompleto,
      //               e cresce a cada importação.
      // Um mês parcial desenhado sólido ao lado de meses inteiros se leria
      // como queda real; hachurado, se leria como estimativa. Nenhum dos dois
      // é verdade, daí o terceiro aspecto.
      //
      // Barra PROJETADA: hachurada e com contorno. O contorno é o que faz a
      // barra continuar legível quando ela é baixa — só as listras, numa barra
      // de 6px de altura, viram um borrão.
      '#s-dre .dre-bar.proj { stroke: var(--ac); stroke-width: 1;' +
        ' vector-effect: non-scaling-stroke; }' +
      '#s-dre .dre-bar.proj.neg { stroke: var(--dg); }' +
      // Barra PARCIAL: contorno cheio e preenchimento claro (--acd é o accent
      // translúcido que o projeto já usa para fundo destacado).
      '#s-dre .dre-bar.parcial { fill: var(--acd); stroke: var(--ac);' +
        ' stroke-width: 1.5; vector-effect: non-scaling-stroke; }' +
      '#s-dre .dre-bar.parcial.neg { stroke: var(--dg); }' +
      '#s-dre .dre-sw.parcial { border: 1.5px solid var(--ac); background: var(--acd); }' +
      '#s-dre .dre-hach-f { fill: var(--ac); }' +
      '#s-dre .dre-hach-f.neg { fill: var(--dg); }' +
      // Marca do mês corrente: vertical, discreta, POR BAIXO das barras.
      '#s-dre .dre-marca-x { stroke: var(--bd2); stroke-width: 1;' +
        ' stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }' +
      '#s-dre .dre-ex.atual { color: var(--ac); font-weight: 700; }' +
      // Faixa de incerteza embaixo do valor projetado.
      '#s-dre .kfaixa { font-size: .66rem; font-family: var(--mono);' +
        ' color: var(--tx3); margin-top: 2px; }' +
      // Legenda realizado/projetado do gráfico anual.
      '#s-dre .dre-legproj { display: flex; flex-wrap: wrap; gap: .2rem .9rem;' +
        ' margin-top: .3rem; font-family: var(--mono); font-size: .6rem;' +
        ' color: var(--tx3); }' +
      '#s-dre .dre-legproj i { font-style: normal; display: inline-flex;' +
        ' align-items: center; gap: .3rem; }' +
      '#s-dre .dre-sw { display: inline-block; width: .8rem; height: .55rem;' +
        ' border-radius: 2px; }' +
      '#s-dre .dre-sw.real { background: var(--ac); }' +
      '#s-dre .dre-sw.proj { border: 1px solid var(--ac);' +
        ' background: repeating-linear-gradient(90deg, var(--ac) 0 2px, transparent 2px 4px); }' +
      // AVISO da projeção — no rodapé da aba, sempre visível, nunca opcional.
      // Borda à esquerda em vez de fundo colorido: precisa ser lido, não
      // ignorado como banner, e não pode competir com os números acima.
      '#s-dre .dre-aviso-proj { margin-top: .9rem; border-left: 2px solid var(--wn);' +
        ' background: var(--sf); border-radius: 0 8px 8px 0; padding: .6rem .8rem;' +
        ' font-size: .68rem; color: var(--tx3); line-height: 1.5; }' +
      '#s-dre .dre-aviso-proj b { color: var(--tx2); font-weight: 700; }' +
      '#s-dre .dre-aviso-proj ul { margin: .35rem 0 0; padding-left: 1.1rem; }' +
      '#s-dre .dre-aviso-proj li { margin: .15rem 0; }' +
      // Seletor de métrica: pílulas `.ftag`, que já existem nos dois módulos.
      // No cabeçalho do card, quebrando linha em tela estreita em vez de
      // comprimir os quatro botões até ficarem inclicáveis.
      '#s-dre .dre-metricas { display: flex; flex-wrap: wrap; gap: .3rem;' +
        ' margin-top: .45rem; }' +
      '#s-dre .dre-metricas .ftag { font-size: .64rem; padding: 4px 10px; }' +
      // O ESCOPO é a segunda fileira, separada da métrica por uma borda:
      // "o quê" e "que eixo" são perguntas diferentes, e os seis botões numa
      // fileira só fariam parecer seis opções da mesma coisa.
      '#s-dre .dre-escopos { border-top: 1px solid var(--bd); padding-top: .4rem;' +
        ' margin-top: .4rem; }' +
      '#s-dre .dre-escopos .ftag { font-family: var(--mono); }' +
      // Seletor de mês: as mesmas setas `.dre-passo` da aba Dia, com o mês no
      // meio. Fica na fileira do escopo, ao lado de "Diário".
      '#s-dre .dre-navmes { display: inline-flex; align-items: stretch; gap: .25rem;' +
        ' margin-left: .35rem; }' +
      '#s-dre .dre-navmes b { display: inline-flex; align-items: center;' +
        ' padding: 0 .5rem; font-family: var(--mono); font-size: .66rem;' +
        ' font-weight: 700; color: var(--ac); background: var(--acd);' +
        ' border: 1px solid var(--bd); border-radius: 8px; white-space: nowrap; }' +
      // CURSOR diz se a barra leva a algum lugar. O `.dre-hit` já é `pointer`
      // por causa do balão; a fatia NÃO clicável volta ao cursor normal, que é
      // a convenção para "isto não é um link". `not-allowed` seria pior: daria
      // a entender que nem o balão funciona, e ele funciona.
      '#s-dre .dre-hit.sem-clique { cursor: default; }' +
      // Faixa de "buscando o mês" no lugar do desenho.
      '#s-dre .dre-buscando { text-align: center; padding: 2rem 1rem; color: var(--tx3);' +
        ' font-family: var(--mono); font-size: .72rem; }' +
      // No celular estes quatro botoes sao o controle principal do grafico, e
      // com o padding do `.ftag` padrao eles saem com 22px de altura — pouco
      // para acertar com o dedo. Sobem para ~32px SO aqui; o `.ftag` das
      // outras telas fica como esta.
      '@media (max-width: 700px) {' +
        '#s-dre .dre-metricas .ftag { padding: 9px 12px; font-size: .66rem; }' +
      '}' +
      // QUATRO KPIs: 4 colunas no desktop largo, 2 no meio, 1 no celular.
      // Mesmo motivo do kgrid-3 — o valor é que dita, não o card.
      '#s-dre .kgrid.kgrid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }' +
      '@media (max-width: 1100px) {' +
        '#s-dre .kgrid.kgrid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }' +
      '}' +
      '@media (max-width: 700px) {' +
        '#s-dre .kgrid.kgrid-4 { grid-template-columns: 1fr; }' +
        '#s-dre .kgrid.kgrid-4 .kval { font-size: 1.35rem; }' +
      '}' +
      // Etiqueta de situação na tabela anual. Cor DIZ o que é: realizado em
      // texto normal, projetado em destaque, sem dado apagado. Sem cor, a
      // coluna vira três palavras que ninguém distingue de longe.
      '#s-dre .dre-sit { font-size: .62rem; font-family: var(--mono);' +
        ' padding: 2px 6px; border-radius: 10px; white-space: nowrap; }' +
      '#s-dre .dre-sit.real { color: var(--tx2); background: var(--sf3); }' +
      '#s-dre .dre-sit.proj { color: var(--ac); background: var(--acd);' +
        ' border: 1px dashed var(--ac); }' +
      '#s-dre .dre-sit.parcial { color: var(--wn); background: var(--sf3); }' +
      '#s-dre .dre-sit.vazio { color: var(--tx3); background: transparent; }' +
      // As duas linhas de total. A de projetado vem tracejada em cima para
      // separar visualmente do que é fato, e não só pelo rótulo.
      '#s-dre .dre-tano tfoot .tot-real td { font-weight: 700; }' +
      '#s-dre .dre-tano tfoot .tot-proj td { color: var(--ac);' +
        ' border-top: 1px dashed var(--bd2); }' +
      // Linha do mês corrente e dos meses sem dado, discretas.
      '#s-dre .dre-tano tbody tr.sit-vazio td { color: var(--tx3); }' +
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
        // TABELA ANUAL em celular: 4 das 7 colunas. Escopado em `.dre-tano`
        // porque `col-venda_liquida` e `col-litros` PRECISAM continuar
        // visíveis nas outras três tabelas — esconder por chave global
        // apagaria a coluna errada em outra aba.
        '#s-dre .dre-tano .col-litros, #s-dre .dre-tano .col-venda_liquida { display: none; }' +
        '#s-dre .dre-tano .col-rotulo { width: 16%; }' +
        '#s-dre .dre-tano .col-lucro { width: 32%; }' +
        '#s-dre .dre-tano .col-margem_pct { width: 20%; }' +
        '#s-dre .dre-tano .col-situacao { width: 32%; }' +
        '#s-dre .dre-tano .dre-sit { font-size: .58rem; padding: 1px 4px; }' +
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
    _dia    = _dia    || ontemISO();

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
              // Início/Fim (abas Mês e Por Posto) e Data única (aba Dia)
              // ocupam a MESMA faixa de filtros, um par por vez. Ver
              // `aplicarEscopoSubaba`.
              '<div id="dre-f-inicio">' +
                '<label class="filtro-lbl" for="dre-inicio">Início</label>' +
                '<input type="date" class="dre-date" id="dre-inicio" value="' + esc(_inicio) + '">' +
              '</div>' +
              '<div id="dre-f-fim">' +
                '<label class="filtro-lbl" for="dre-fim">Fim</label>' +
                '<input type="date" class="dre-date" id="dre-fim" value="' + esc(_fim) + '">' +
              '</div>' +
              // Um campo de data só, com setas para andar dia a dia. As setas
              // existem porque o uso real é "e ontem? e antes de ontem?", e
              // fazer isso pelo calendário nativo são três toques por dia.
              // `max` = hoje: não há .xls do futuro, e a seta › para no dia de
              // hoje em vez de levar a uma sequência garantida de telas vazias.
              // Período FIXO na aba Projeção (mês corrente e ano corrente até
              // hoje), então não há data para escolher. A nota substitui os
              // dois campos em vez de deixá-los mudos na tela.
              '<div id="dre-f-fixo" hidden>' +
                '<label class="filtro-lbl">Período</label>' +
                '<div class="dre-nota-txt">Fixo: mês corrente e ano corrente até hoje — ' +
                  'a projeção parte do que já foi importado, não de um recorte escolhido.</div>' +
              '</div>' +
              '<div id="dre-f-dia" hidden>' +
                '<label class="filtro-lbl" for="dre-dia">Data</label>' +
                '<div class="dre-navdia">' +
                  '<button type="button" class="dre-passo" id="dre-dia-ant"' +
                    ' onclick="__dreDiaPasso(-1)" title="Dia anterior"' +
                    ' aria-label="Dia anterior">‹</button>' +
                  '<input type="date" class="dre-date" id="dre-dia"' +
                    ' value="' + esc(_dia) + '" max="' + esc(hojeISO()) + '">' +
                  '<button type="button" class="dre-passo" id="dre-dia-prox"' +
                    ' onclick="__dreDiaPasso(1)" title="Dia seguinte"' +
                    ' aria-label="Dia seguinte">›</button>' +
                '</div>' +
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
    var iDia = sec.querySelector('#dre-dia');
    iIni.onchange = function () { _inicio = iIni.value; carregar(); };
    iFim.onchange = function () { _fim = iFim.value; carregar(); };
    iPos.onchange = function () { _postoId = iPos.value; carregar(); };
    // Data vazia (o usuário limpou o campo) volta para ontem em vez de
    // disparar uma requisição com `inicio=`, que a rota recusaria com 400.
    iDia.onchange = function () {
      _dia = iDia.value || ontemISO();
      iDia.value = _dia;
      atualizarPassoDia();
      carregar();
    };

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

  // Faixa de filtros conforme a sub-aba:
  //   Mês / Por Posto -> Início + Fim
  //   Dia             -> Data única com setas
  //   Projeção        -> nenhum campo de data (período fixo), com o motivo
  // E o seletor de posto, que está TRAVADO só em "Por Posto" (essa aba compara
  // os postos entre si). `disabled` e não `hidden` ali: o campo continua na
  // tela mostrando o escopo em vigor, em vez de sumir e deixar o usuário sem
  // saber sobre o que os números falam.
  function aplicarEscopoSubaba() {
    var sel  = document.getElementById('dre-posto');
    var nota = document.getElementById('dre-posto-nota');
    if (!sel || !nota) return;
    var umDia = (_subaba === 'dia');
    var fixo  = (_subaba === 'projecao');
    var byId = function (id) { return document.getElementById(id); };
    byId('dre-f-inicio').hidden = umDia || fixo;
    byId('dre-f-fim').hidden    = umDia || fixo;
    byId('dre-f-dia').hidden    = !umDia;
    byId('dre-f-fixo').hidden   = !fixo;

    var rede = (_subaba === 'posto');
    sel.disabled = rede;
    nota.hidden = !rede;
    // O `title` diz o mesmo no hover, para quem clica no campo antes de ler.
    sel.title = rede
      ? 'Travado na rede toda nesta aba — ela compara os postos entre si.'
      : (umDia ? 'Escolha um posto para ver a quebra por categoria no dia.'
               : (fixo ? 'Projeta a rede toda, ou só o posto escolhido.' : ''));
    if (umDia) atualizarPassoDia();
  }

  // A seta › para no dia de HOJE. Desabilitada com `title` explicando, e não
  // escondida: sumir um dos dois botões desloca o campo de data e o usuário
  // perde a referência de onde clicar. A seta ‹ nunca trava — andar para trás
  // é sempre válido, inclusive por cima de dias sem dado.
  function atualizarPassoDia() {
    var b = document.getElementById('dre-dia-prox');
    if (!b) return;
    var noLimite = (_dia >= hojeISO());
    b.disabled = noLimite;
    b.title = noLimite ? 'Hoje é o último dia disponível' : 'Dia seguinte';
  }

  // Passo de um dia. Anda MESMO que o dia vizinho não tenha dado: quem está
  // procurando o dia que faltou importar precisa poder atravessar o vazio.
  window.__dreDiaPasso = function (n) {
    if (_subaba !== 'dia' || !_dia) return;
    var alvo = somarDiasISO(_dia, n);
    if (alvo > hojeISO()) return;      // não há .xls do futuro
    _dia = alvo;
    var inp = document.getElementById('dre-dia');
    if (inp) inp.value = _dia;
    atualizarPassoDia();
    carregar();
  };

  window.__dreSubaba = function (id) {
    var a = SUBABAS.filter(function (x) { return x.id === id; })[0];
    if (!a || !a.pronta || _subaba === id) return;
    _subaba = id;
    // "Por Posto" é comparação ENTRE postos: força a rede toda. Ao voltar
    // para "Mês" ou "Dia" o seletor destrava zerado — o posto que estava
    // escolhido não volta sozinho, porque a tela passou a mostrar a rede e
    // reativar um filtro sem o usuário pedir mudaria os números sem aviso.
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
  //
  // GERAÇÃO DA CARGA — por que existe.
  //
  // Trocar de sub-aba chama `carregar()` sem esperar a carga anterior, então
  // DUAS cargas ficam no ar. A que voltava primeiro executava o `finally`
  // dela: `_carregando = false` e `render()`. Só que `render()` despacha para
  // a sub-aba ATUAL — a nova, cujos dados ainda não chegaram — e o
  // `renderProjecao` (ou o de qualquer outra) caía na guarda de dataset nulo e
  // escrevia "Sem dados.".
  //
  // MEDIDO na aba Projeção: entrar na tela e clicar em "Projeção" durante a
  // carga da aba Mês dava "Carregando… → Sem dados. → dados", com o `finally`
  // da carga do Mês em t=1550ms e o da Projeção em t=1560ms. Dez milissegundos
  // de "sem dados" numa tela que tinha dados.
  //
  // A correção é NUMA SÓ: cada `carregar()` tira um número, e só a carga mais
  // recente tem direito de mexer no estado da tela. Resposta velha é
  // descartada em silêncio — ela não é erro, só perdeu a corrida.
  // Vale para as quatro sub-abas, porque as quatro passam por aqui.
  var _gerCarga = 0;

  // Só a carga corrente encerra o estado e redesenha. Devolve se era ela.
  function fecharCarga(ger) {
    if (ger !== _gerCarga) return false;
    _carregando = false;
    render();
    return true;
  }
  // Idem para escrever erro: erro de uma carga abandonada não vai à tela.
  function ehCargaAtual(ger) { return ger === _gerCarga; }

  async function carregar() {
    var ger = ++_gerCarga;
    var body = document.getElementById('dre-body');

    // ── sub-aba "Projeção": mês corrente + ano corrente ──
    // As DUAS chamadas combinadas, as duas com `agrupar=dia`. O agrupamento
    // por MÊS é feito no cliente (`agruparPorMes`) — a rota não tem esse
    // agrupamento e não foi criada rota nova.
    // O período é FIXO (mês corrente e ano corrente até hoje), então os campos
    // de data não participam desta aba; o de posto sim, e vai nas duas.
    if (_subaba === 'projecao') {
      var hj = hojeISO();
      _erro = null;
      _carregando = true;
      if (body) body.innerHTML = '<div class="empty">Carregando…</div>';
      var pid = _postoId ? '&posto_id=' + encodeURIComponent(_postoId) : '';
      var faixa = function (ini) {
        return '?inicio=' + encodeURIComponent(ini) + '&fim=' + encodeURIComponent(hj) +
          pid + '&agrupar=dia';
      };
      var anoP = hj.slice(0, 4);
      var mesCorr = hj.slice(0, 7);
      try {
        var rp = await Promise.all([
          apiFetch('/dre' + faixa(hj.slice(0, 7) + '-01')),   // dia 1 do mês corrente
          apiFetch('/dre' + faixa(anoP + '-01-01')),           // 01/01 do ano corrente
        ]);
        _dadosPMes = rp[0];
        _dadosPAno = rp[1];
        // O mês corrente ENTRA NO CACHE já buscado: ele é a primeira das duas
        // chamadas, e sem semear aqui o modo Diário pediria de novo o que
        // acabou de chegar.
        _seriesMes = new Map();
        _seriesMes.set(mesCorr, rp[0]);
        if (!_mesDiario) _mesDiario = mesCorr;
      } catch (err) {
        _dadosPMes = null;
        _dadosPAno = null;
        _seriesMes = null;
        if (ehCargaAtual(ger)) _erro = err && err.message ? err.message : String(err);
      } finally {
        // `return` dentro de `finally` engoliria exceção — a guarda da busca
        // seguinte fica FORA dele.
        fecharCarga(ger);
      }
      // Modo Diário num mês passado: a série dele não veio nas duas chamadas
      // acima. Busca DEPOIS do render, para a tela não esperar por ela — o
      // card do gráfico se anuncia carregando sozinho.
      // `ehCargaAtual`: se o usuário já trocou de aba, não há por que buscar.
      if (ehCargaAtual(ger) &&
          _escopoAno === 'mes' && _mesDiario && _mesDiario !== mesCorr) {
        await garantirSerieMes(_mesDiario);
      }
      return;
    }

    // ── sub-aba "Dia": UM dia, inicio = fim ──
    // Caminho próprio e curto, antes da validação de intervalo: aqui não há
    // intervalo para validar (é a mesma data nas duas pontas) e o agrupamento
    // depende de haver posto escolhido.
    if (_subaba === 'dia') {
      if (!_dia) return;
      _erro = null;
      _carregando = true;
      if (body) body.innerHTML = '<div class="empty">Carregando…</div>';
      // Com posto escolhido a pergunta muda de "qual posto" para "qual
      // categoria dentro deste posto" — e é o mesmo GET /dre, só trocando
      // `agrupar`. Sem posto, lista os postos do dia.
      var agr = _postoId ? 'categoria' : 'posto';
      var qs = function (d) {
        return '?inicio=' + encodeURIComponent(d) + '&fim=' + encodeURIComponent(d) +
          (_postoId ? '&posto_id=' + encodeURIComponent(_postoId) : '') +
          '&agrupar=' + agr;
      };
      var ant = somarDiasISO(_dia, -1);
      try {
        var rd = await Promise.all([
          apiFetch('/dre' + qs(_dia)),
          // DIA ANTERIOR — só para a comparação do KPI, e por isso
          // SECUNDÁRIA: `.catch` devolve null e a comparação é OMITIDA. Um
          // erro aqui não pode derrubar a tela do dia escolhido, e mostrar
          // "0%" no lugar afirmaria estabilidade que ninguém mediu.
          apiFetch('/dre' + qs(ant)).catch(function (e) {
            console.warn('DRE: dia anterior não carregou, comparação omitida:', e && e.message);
            return null;
          }),
        ]);
        _dadosD = rd[0];
        _dadosDAnt = rd[1];
      } catch (err) {
        _dadosD = null;
        _dadosDAnt = null;
        if (ehCargaAtual(ger)) _erro = err && err.message ? err.message : String(err);
      } finally {
        fecharCarga(ger);
      }
      return;
    }

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
        return;      // o `finally` abaixo é quem fecha a carga
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
      if (ehCargaAtual(ger)) _erro = err && err.message ? err.message : String(err);
    } finally {
      fecharCarga(ger);
    }
  }

  // DOMÍNIO DO EIXO DE VALOR — comum a TODOS os gráficos da tela.
  // Uma função só porque as regras são as mesmas e, se divergissem, dois
  // gráficos passariam a desenhar o mesmo número em escala diferente.
  //
  // Chamava-se `escalaMargem`, mas passou a servir também um eixo em DINHEIRO
  // (o lucro mensal da aba Projeção) — nome com "margem" ali seria mentira
  // para quem for mexer depois.
  //
  // SEMPRE INCLUI O ZERO: é o requisito "linha de referência no zero, sempre
  // visível". Sem isto um período todo positivo desenharia a linha fora da
  // área. `extra` entra no domínio quando existe — é a média (da rede, ou
  // mensal): se caísse fora, a linha de referência sairia da área desenhada.
  // `piso` é a extensão MÍNIMA do domínio, na unidade do eixo: 1 ponto
  // percentual para margem, e um valor em reais para o eixo de dinheiro.
  function escalaComZero(vals, extra, piso) {
    var v = vals.slice();
    if (extra !== null && extra !== undefined && Number.isFinite(Number(extra))) {
      v.push(Number(extra));
    }
    var topo = Math.max(0, Math.max.apply(null, v));
    var base = Math.min(0, Math.min.apply(null, v));
    // Valores todos iguais (inclusive um único ponto) dariam extensão 0 e
    // divisão por zero na escala. O piso de 1 ponto percentual mantém a barra
    // visível e a escala sã — é o caso "um único dia não quebra".
    var minimo = Number.isFinite(piso) ? piso : 1;
    if (topo - base < minimo) topo = base + minimo;
    // Guarda os extremos REAIS antes da folga: é por eles que se decide se o
    // domínio tem de atravessar o zero.
    var soPositivo = (base >= 0);
    var soNegativo = (topo <= 0);
    var folga = (topo - base) * 0.12;
    topo += folga; base -= folga;
    if (base > 0) base = 0;
    if (topo < 0) topo = 0;
    // SEM FOLGA DO LADO QUE NÃO TEM VALOR. Com todos os valores >= 0, a folga
    // empurrava `base` para baixo do zero e o eixo ganhava um rótulo negativo
    // — medido na métrica Litros, onde ele saía como "-114 mil L". Litro não é
    // negativo; o rótulo era uma afirmação falsa sobre a grandeza. O zero
    // continua no domínio (é a própria borda), então a linha de referência
    // segue visível, agora como base do gráfico.
    if (soPositivo) base = 0;
    if (soNegativo) topo = 0;
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
  function indicesRotulados(n, maxRotulos) {
    if (n <= 1) return [0];
    // `maxRotulos` >= n rotula TODOS — é o caso dos 12 meses da aba Projeção,
    // onde pular mês deixaria o eixo ilegível ("qual barra é agosto?").
    var alvo = Number.isFinite(maxRotulos) ? maxRotulos : 6;
    if (alvo >= n) { var todos = []; for (var t = 0; t < n; t++) todos.push(t); return todos; }
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
  // SERVE AS TRÊS ABAS que usam barra VERTICAL — a série por DIA (aba Mês), a
  // série por POSTO num dia (aba Dia) e o LUCRO POR MÊS (aba Projeção). A
  // geometria é a mesma nas três: barras a partir do zero, escala com o zero
  // dentro, alvo de ponteiro de altura cheia, rótulos em HTML fora do SVG.
  // `opts` cobre só o que difere:
  //   valor      — função (linha) -> número da barra. Default: margem_pct.
  //   rotuloX    — função (linha) -> texto do eixo X, ou null para NÃO rotular.
  //   rotuloY    — função (número) -> texto do eixo Y. Default: percentual.
  //   maxRotulos — quantos rótulos no eixo X (>= n rotula todos).
  //   media      — valor de uma linha horizontal de referência, ou null.
  //   mediaRot   — texto da legenda da média. Default: "média da rede N%".
  //   aspecto    — função (linha) -> '' | 'proj' | 'parcial'. Era um booleano
  //                `hachura`, e booleano não expressa TRÊS estados: fechado
  //                (sólido), projetado (hachurado) e parcial (contorno).
  //   clicavel   — função (linha) -> bool. Falso marca o alvo com
  //                `.sem-clique`, que tira a afordância do cursor.
  //   marcaX     — índice que recebe marca vertical (o mês corrente), ou null.
  //   piso       — extensão mínima do domínio, na unidade do eixo.
  //   aria       — a descrição acessível, que muda com o que está no eixo.
  // Sem `opts` o comportamento é EXATAMENTE o da série diária de antes.
  //
  // O NOME não é mais "MargemDiaria" de propósito: com um eixo em dinheiro
  // servido pela mesma função, o nome antigo mentiria para quem for mexer.
  function svgBarrasVerticais(linhas, opts) {
    var o = opts || {};
    var valor = o.valor || function (l) { return l.margem_pct; };
    var rotuloX = (o.rotuloX === undefined)
      ? function (l) { return diaDoISO(l.data || l.chave); }
      : o.rotuloX;
    var rotuloY = o.rotuloY || function (v) { return nf(v, 1) + '%'; };
    if (!linhas || !linhas.length) return '';
    // Valor ausente NÃO é zero: a fatia entra no eixo (ela existe) mas não
    // ganha barra. Tratar como 0 desenharia uma barra rente à linha de zero,
    // que se lê como "margem zerada" / "lucro zero" — afirmação diferente de
    // "não há número para mostrar". Ver `temMargem` e o mês sem importação.
    var temValor = function (l) {
      var v = valor(l);
      return v !== null && v !== undefined && Number.isFinite(Number(v));
    };
    var comBarra = linhas.filter(temValor);
    if (!comBarra.length) return '';               // nada a desenhar
    var valores = comBarra.map(function (l) { return Number(valor(l)); });

    // A média entra no domínio: se ficasse fora, a linha de referência —
    // que é o motivo de ela existir — sairia da área desenhada.
    var dom = escalaComZero(valores, o.media, o.piso);
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
    var rotulados = indicesRotulados(n, o.maxRotulos);

    var barras = '', eixoX = '', alvos = '';
    linhas.forEach(function (l, i) {
      var cx = M_ESQ + passoX * i + passoX / 2;
      var x = cx - larg / 2;
      if (temValor(l)) {
        var v = Number(valor(l));
        var yv = y(v);
        var alt = Math.abs(yv - yZero);
        // Barra de valor minúsculo viraria linha invisível; 1 unidade de piso
        // garante que a fatia apareça.
        if (alt < 1) alt = 1;
        var yTopo = v >= 0 ? yZero - alt : yZero;
        // ASPECTO: sólido (fechado), hachurado (projetado) ou contorno
        // (parcial, mês em curso). A hachura é um `pattern` de listras
        // VERTICAIS, não diagonais: o SVG usa preserveAspectRatio="none" e
        // escala X e Y por fatores diferentes, o que torceria uma diagonal em
        // ângulo diferente a cada largura de tela. Listra vertical continua
        // vertical sob qualquer escala — só o espaçamento acompanha a barra.
        var asp = o.aspecto ? (o.aspecto(l) || '') : '';
        barras += '<rect class="dre-bar' + (v < 0 ? ' neg' : '') + (asp ? ' ' + asp : '') + '"' +
          (asp === 'proj' ? ' fill="url(#dre-hach-' + (v < 0 ? 'neg' : 'pos') + ')"' : '') +
          ' x="' + x.toFixed(2) + '" y="' + yTopo.toFixed(2) + '"' +
          ' width="' + larg.toFixed(2) + '" height="' + alt.toFixed(2) + '" rx="1"></rect>';
      }
      // ALVO DE PONTEIRO: retângulo transparente de altura cheia, um por dia.
      // Com 90 barras a barra real tem ~4 unidades e ninguém acerta o mouse
      // nela — e num dia sem barra não haveria nada para tocar. O alvo cobre
      // a coluna inteira e é ele que dispara o tooltip.
      var podeClicar = o.clicavel ? !!o.clicavel(l) : true;
      alvos += '<rect class="dre-hit' + (podeClicar ? '' : ' sem-clique') +
        '" x="' + (M_ESQ + passoX * i).toFixed(2) + '" y="' + M_TOPO +
        '" width="' + passoX.toFixed(2) + '" height="' + areaA + '"' +
        ' data-i="' + i + '"></rect>';
      if (rotuloX && rotulados.indexOf(i) >= 0) {
        // left em PORCENTAGEM do mesmo sistema de coordenadas do SVG: o rótulo
        // acompanha a barra em qualquer largura, sem depender de resize.
        // left relativo a AREA DE PLOTAGEM (sem o vao dos rotulos Y), porque a
        // faixa .dre-exs tambem comeca depois do vao. Usar o viewBox inteiro
        // punha o rotulo do primeiro dia por cima do rotulo de % do eixo Y.
        eixoX += '<span class="dre-ex' + (o.marcaX === i ? ' atual' : '') + '" style="left:' +
          ((cx - M_ESQ) / (VB_W - M_ESQ - M_DIR) * 100).toFixed(3) + '%">' +
          esc(rotuloX(l)) + '</span>';
      }
    });

    // Rótulos de % no eixo Y: topo, zero e base (só os que fazem sentido).
    // `topo` so entra quando e DIFERENTE de zero: com todos os valores
    // negativos o topo do dominio E o zero, e as duas marcas saiam no mesmo
    // lugar com o mesmo texto ("R$ 0" duas vezes, medido).
    var marcas = [];
    if (topo !== 0) marcas.push({ v: topo });
    marcas.push({ v: 0 });
    // `base` so entra quando ha valor negativo (senao repetiria o zero).
    // Ela e marcada como `.base` para ser ancorada ACIMA da linha: centrada
    // (translateY(-50%)) ela descia para dentro da faixa do eixo X e batia no
    // rotulo do primeiro dia — medido em 375px e 430px.
    if (base < 0) marcas.push({ v: base, base: true });
    var eixoY = marcas.map(function (mk) {
      return '<span class="dre-ey' + (mk.base ? ' base' : '') +
        '" style="top:' + (y(mk.v) / VB_H * 100).toFixed(3) + '%">' +
        esc(rotuloY(mk.v)) + '</span>';
    }).join('');

    // LINHA DA MÉDIA: horizontal, tracejada, atravessando a área toda. Só
    // existe quando `o.media` vem — a série diária da aba Mês não a usa.
    var temMedia = (o.media !== null && o.media !== undefined && Number.isFinite(Number(o.media)));
    var linhaMedia = '', legenda = '';
    if (temMedia) {
      var ym = y(Number(o.media));
      linhaMedia = '<line class="dre-hlinha-media" x1="' + M_ESQ + '" y1="' + ym.toFixed(2) +
        '" x2="' + (VB_W - M_DIR) + '" y2="' + ym.toFixed(2) + '"></line>';
      // O VALOR VAI NUMA LEGENDA ABAIXO, não num rótulo sobre a linha.
      // Rótulo colado na linha, dentro da área, TAPAVA barras: ele precisa de
      // fundo opaco para ser legível sobre o desenho, e esse fundo apaga o
      // dado que estiver atrás — medido em 375px, onde ele cobria a cauda das
      // barras. Reservar margem à direita para ele custaria ~20% da área de
      // plotagem em celular, que é onde ela já é mais escassa.
      // Aqui não há ambiguidade: existe UMA linha tracejada no gráfico.
      legenda = '<div class="dre-legenda"><span class="dre-leg-traco"></span>' +
        esc(o.mediaRot || ('média da rede ' + nf(Number(o.media), 2) + '%')) + '</div>';
    }

    // MARCA VERTICAL numa fatia (o mês corrente). Vai por BAIXO das barras,
    // atravessando a área: é uma referência de posição, não um dado, e não
    // pode competir com a barra que marca.
    var marca = '';
    if (o.marcaX !== null && o.marcaX !== undefined && o.marcaX >= 0 && o.marcaX < n) {
      var xm2 = M_ESQ + passoX * o.marcaX + passoX / 2;
      marca = '<line class="dre-marca-x" x1="' + xm2.toFixed(2) + '" y1="' + M_TOPO +
        '" x2="' + xm2.toFixed(2) + '" y2="' + (M_TOPO + areaA).toFixed(2) + '"></line>';
    }

    // Padrões de hachura. Declarados só quando há barra hachurada, para o SVG
    // dos outros gráficos não carregar defs que ninguém referencia.
    // `patternUnits="userSpaceOnUse"`: o passo é em unidades do viewBox, então
    // acompanha a largura da barra em qualquer tela.
    var defs = '';
    if (o.aspecto && linhas.some(function (l) { return o.aspecto(l) === 'proj'; })) {
      // PASSO 11 / LISTRA 4, medido em 375px: dá listra de 1,8px com vão de
      // 3,2px, ou ~3,5 listras por barra de 12. Com o passo 7/3 que estava
      // aqui antes a listra ficava em 1,35px com vão de 1,8px e a barra
      // projetada se lia como SÓLIDA no celular — que é justamente a distinção
      // que este gráfico existe para fazer. O vão maior que a listra é o que
      // faz o olho ler "hachurado" em vez de "cheio".
      defs = '<defs>' +
        '<pattern id="dre-hach-pos" patternUnits="userSpaceOnUse" width="11" height="11">' +
          '<rect width="4" height="11" class="dre-hach-f"></rect></pattern>' +
        '<pattern id="dre-hach-neg" patternUnits="userSpaceOnUse" width="11" height="11">' +
          '<rect width="4" height="11" class="dre-hach-f neg"></rect></pattern>' +
      '</defs>';
    }

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
          ' aria-label="' + esc(o.aria || 'Margem por dia no período') + '">' +
          // Zero e média por baixo das barras: são referência, não enfeite.
          '<line class="dre-zero" x1="' + M_ESQ + '" y1="' + yZero.toFixed(2) +
            '" x2="' + (VB_W - M_DIR) + '" y2="' + yZero.toFixed(2) + '"></line>' +
          defs + marca + linhaMedia + barras + alvos +
        '</svg>' +
        eixoY +
      '</div>' +
      // A faixa do eixo X só existe quando há rótulo: sem isto ela reservava
      // 1rem de altura vazia embaixo do gráfico da aba Dia.
      (rotuloX ? '<div class="dre-exs">' + eixoX + '</div>' : '') +
      legenda +
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

    var dom = escalaComZero(comBarra.map(function (l) { return Number(l.margem_pct); }), mediaRede);
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
  //   extra    — [{rot, val}] com medidas a mais, no formato das de cima.
  //   nota     — linha final sem rótulo (realizado/projetado).
  //   aoClicar — função (linha) chamada no clique. Quem decide QUAIS fatias
  //              aceitam clique é o `clicavel` do desenhador, que marca as
  //              outras com `.sem-clique`.
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
    var esconder = function () {
      tip.style.display = 'none';
      // Fechar o balão zera a seleção: reabrir a MESMA barra volta a ser um
      // primeiro toque, não um segundo.
      _barraSel = null; _barraAnt = null;
    };
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
        '<span><i>Margem</i>' + fmtPct(l.margem_pct) + '</span>' +
        // `extra`: medidas ADICIONAIS, no mesmo formato das quatro de cima.
        // A aba Projeção usa para Litros — quem toca uma barra quer o mês
        // inteiro, não só a métrica que está no eixo naquele momento.
        (o.extra ? o.extra(l).map(function (x) {
          return '<span><i>' + esc(x.rot) + '</i>' + esc(x.val) + '</span>';
        }).join('') : '') +
        // `nota`: linha final sem rótulo — a aba Projeção diz nela se o mês é
        // realizado ou projetado, que é a informação sem a qual os números
        // acima podem ser lidos como fato.
        (o.nota ? '<span><i>&nbsp;</i>' + esc(o.nota(l)) + '</span>' : '');
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
    // CLIQUE que navega. `aoClicar` é opcional; sem ele nada muda.
    //
    // NO TOQUE SÃO DOIS TOQUES, e não é capricho: no celular o primeiro toque
    // é o que ABRE o balão. Se ele também navegasse, o balão apareceria e a
    // tela trocaria no mesmo gesto — os quatro números ficariam ilegíveis, e
    // não haveria como só CONSULTAR uma barra. Então o primeiro toque mostra,
    // o segundo na MESMA barra navega. Com mouse, um clique basta: o balão já
    // está aberto pelo hover.
    if (o.aoClicar) {
      // O SEGREDO DO DOIS-TOQUES: compara com o alvo do gesto ANTERIOR, não do
      // atual. A primeira tentativa guardava o alvo no `pointerdown` do MESMO
      // gesto e comparava no `click` — sempre igual, então o primeiro toque
      // navegava e o balão não era lido por ninguém.
      // Este listener é registrado ANTES do `mostrar`, então roda antes dele e
      // ainda vê `_barraSel` como estava.
      svg.addEventListener('pointerdown', function (ev) {
        var alvo = ev.target && ev.target.closest ? ev.target.closest('.dre-hit') : null;
        _barraAnt = _barraSel;
        _barraSel = alvo ? alvo.getAttribute('data-i') : null;
      });
      svg.addEventListener('click', function (ev) {
        var alvo = ev.target && ev.target.closest ? ev.target.closest('.dre-hit') : null;
        if (!alvo || alvo.classList.contains('sem-clique')) return;
        var l = linhas[parseInt(alvo.getAttribute('data-i'), 10)];
        if (!l) return;
        // Com mouse o balão já está aberto pelo hover: um clique basta.
        // Com toque, o primeiro abre e o segundo na MESMA barra navega.
        if (ev.pointerType === 'touch' && _barraAnt !== alvo.getAttribute('data-i')) return;
        o.aoClicar(l);
      });
    }
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
    // Toque fora fecha o balão, então também zera a seleção — senão voltar à
    // mesma barra contaria como SEGUNDO toque e navegaria de surpresa.
    _barraSel = null; _barraAnt = null;
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
    var cols = (escopo === 'posto') ? COLS_POSTO : (escopo === 'dia' ? colsDia() : COLS);
    var ord  = (escopo === 'posto') ? _ordPosto  : (escopo === 'dia' ? _ordDia   : _ord);
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
  function dadosAtivos() {
    if (_subaba === 'posto')    return _dadosPosto;
    if (_subaba === 'dia')      return _dadosD;
    if (_subaba === 'projecao') return _dadosPMes;
    return _dados;
  }

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
      if (_subaba === 'projecao') {
        // Nem intervalo nem contagem de dias aqui: o `dias` da rota é a
        // extensão do CALENDÁRIO (01/09 a 03/09 = 3), e nesta aba o número
        // que importa é "dias COM DADO", que aparece no KPI. Repetir a
        // contagem do calendário no subtítulo criaria dois números
        // parecidos e diferentes na mesma tela.
        var hjP = hojeISO();
        sub.textContent = nomePosto + ' · ' +
          MESES_LONGO[Number(hjP.slice(5, 7)) - 1] + '/' + hjP.slice(0, 4) +
          ' · ano ' + hjP.slice(0, 4) + ' até ' + brData(hjP);
      } else if (_subaba === 'dia') {
        // UMA data, não intervalo: "01/09/2026 a 01/09/2026 · 1 dia(s)" é a
        // mesma informação escrita três vezes. O dia da semana entra porque a
        // margem de um domingo não se compara com a de uma terça, e sem ele o
        // usuário precisa ir ao calendário para saber qual foi.
        sub.textContent = nomePosto + ' · ' + brData(per ? per.inicio : _dia) +
          ' · ' + diaDaSemana(per ? per.inicio : _dia);
      } else {
        sub.textContent = nomePosto + ' · ' +
          brData(per ? per.inicio : _inicio) + ' a ' + brData(per ? per.fim : _fim) +
          (per ? ' · ' + per.dias + ' dia(s)' : '');
      }
    }

    if (_carregando) { body.innerHTML = '<div class="empty">Carregando…</div>'; return; }
    if (_erro) {
      body.innerHTML = '<div class="empty" style="color:var(--dg)">' + esc(_erro) + '</div>';
      return;
    }
    // Daqui para baixo é o corpo da sub-aba "Mês". A "Por Posto" tem KPIs,
    // gráfico e tabela próprios, e desvia aqui em vez de ramificar cada bloco.
    if (_subaba === 'dia')      { renderDia(body); return; }
    if (_subaba === 'posto')    { renderPorPosto(body); return; }
    if (_subaba === 'projecao') { renderProjecao(body); return; }
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
    // svgBarrasVerticais devolve '' e o card NÃO é montado: período sem dado não
    // mostra caixa vazia, que é pior que não mostrar nada.
    var linhasDia = (_dadosDia && Array.isArray(_dadosDia.linhas)) ? _dadosDia.linhas : [];
    var svg = svgBarrasVerticais(linhasDia);
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


  // ── Render da sub-aba "Dia" ──────────────────────────────────────
  // Reusa: `svgBarrasVerticais` (o mesmo desenho vertical da aba Mês, com
  // `rotuloX:null` e a linha da média), `ligarTooltipGrafico`, o wrap
  // `.dre-graf-wrap` (que traz user-select/touch-action/balão), as classes
  // `col-<key>` do celular e a linha de detalhe.
  //
  // ESCOPO: sem posto escolhido, a lista é de POSTOS naquele dia. Com posto
  // escolhido, é a quebra por CATEGORIA daquele posto no dia — mesma rota,
  // outro `agrupar`. O gráfico segue a lista, seja qual for.
  function renderDia(body) {
    if (!_dadosD) { body.innerHTML = '<div class="empty">Sem dados.</div>'; return; }

    var T = _dadosD.totais || {};
    var linhas = Array.isArray(_dadosD.linhas) ? _dadosD.linhas : [];
    var porCat = !!_postoId;
    var cols = colsDia();
    var ord = ordDiaValida();

    // ── DIA SEM DADO ──
    // Nem tela em branco nem KPI zerado: zero venda e zero custo se leem como
    // "o posto vendeu nada", que é afirmação diferente de "este dia não foi
    // importado". As setas continuam na faixa de filtros, intactas, porque
    // achar o dia que falta é justamente o que se faz aqui.
    if (!linhas.length) {
      body.innerHTML =
        '<div class="card"><div class="cbody">' +
          '<div class="dre-vazio-dia">' +
            '<b>Sem dado para ' + esc(brData(_dia)) + ' (' + esc(diaDaSemana(_dia)) + ')</b>' +
            'Nenhum lançamento importado para esta data' +
            (porCat ? ' neste posto' : ' em nenhum posto') + '.<br>' +
            '<span class="csub">A DRE vem do .xls de categoria da TecnoX, importado à mão. ' +
              'Use as setas ‹ › acima para procurar o dia mais próximo que já subiu.</span>' +
          '</div>' +
        '</div></div>';
      return;
    }

    // ── KPIs: venda líquida, custo, lucro (com a margem embaixo) ──
    // Três, não os seis da aba Mês: num dia só, venda bruta e desconto não
    // mudam nenhuma decisão, e três cards cabem numa linha em 375px.
    var vl = T.venda_liquida, ct = T.custo_total, lu = T.lucro, mg = T.margem_pct;
    var kpis =
      '<div class="kgrid kgrid-3">' +
        '<div class="kbox">' +
          '<div class="klbl">Venda líquida</div>' +
          '<div class="kval ac">' + fmtRS(vl) + '</div>' +
          variacaoVenda(vl) +
        '</div>' +
        '<div class="kbox">' +
          '<div class="klbl">Custo</div>' +
          '<div class="kval">' + fmtRS(ct) + '</div>' +
          // Ressalva no MESMO card do custo, porque é dele que ela fala.
          (lacunaTexto(T) ? '<div class="kmini">' + esc(lacunaTexto(T)) + '</div>' : '') +
        '</div>' +
        '<div class="kbox">' +
          '<div class="klbl">Lucro bruto</div>' +
          '<div class="kval' + (vazio(lu) ? '' : (Number(lu) < 0 ? ' neg' : ' pos')) + '">' +
            fmtRS(lu) + '</div>' +
          '<div class="kmini' + (mg === null || mg === undefined ? '' :
            (Number(mg) < 0 ? ' neg' : ' pos')) + '">margem ' + fmtPct(mg) + '</div>' +
        '</div>' +
      '</div>';

    // UMA ordenação para gráfico e tabela — a mesma lista alimenta os dois.
    var ordenadas = ordenar(linhas, ord, cols);

    // ── Gráfico: barras verticais, uma por posto (ou categoria) ──
    // `rotuloX: null` de propósito. O rótulo aqui seria o NOME do posto, e 37
    // nomes em pé não são legíveis em nenhuma largura — mesmo rotacionados.
    // Quem identifica cada barra é o balão (mouse e toque), e a tabela logo
    // abaixo repete a MESMA ordem, então a barra n é a linha n.
    var mediaRede = (T.margem_pct === null || T.margem_pct === undefined)
      ? null : Number(T.margem_pct);
    // O gráfico é ordenado por MARGEM decrescente sempre, independente da
    // ordenação da tabela: um gráfico de barras cuja altura sobe e desce sem
    // padrão não se lê, e a comparação com a linha da média é o ponto dele.
    var paraGrafico = ordenar(linhas, { col: 'margem_pct', dir: 'desc' }, cols);
    var svg = svgBarrasVerticais(paraGrafico, {
      rotuloX: null,
      media: mediaRede,
      aria: 'Margem por ' + (porCat ? 'categoria' : 'posto') + ' em ' + brData(_dia) +
        ', com a média da rede',
    });
    var comMargem = paraGrafico.filter(temMargem).length;
    var oQue = porCat ? 'categoria' : 'posto';
    var cardGraf = svg
      ? '<div class="card" style="margin-top:.9rem">' +
          '<div class="chdr">' +
            '<div class="ctitle">Margem por ' + oQue + '</div>' +
            '<div class="csub">' + comMargem + ' ' + oQue + '(s) com margem' +
              (paraGrafico.length > comMargem
                ? ' · ' + (paraGrafico.length - comMargem) + ' sem venda líquida (sem barra)' : '') +
              (mediaRede === null ? '' : ' · média ' + nf(mediaRede, 2) + '%') +
              ' · ordenado por margem · passe o mouse ou toque numa barra</div>' +
          '</div>' +
          '<div class="cbody"><div class="dre-graf-wrap">' + svg +
            '<div class="dre-tip" style="display:none"></div>' +
          '</div></div>' +
        '</div>'
      : '';

    // ── Tabela ──
    var ths = cols.map(function (c) {
      var on = ord.col === c.key;
      var seta = on ? (ord.dir === 'desc' ? ' ↓' : ' ↑') : '';
      return '<th class="ord col-' + c.key + (c.tipo === 'num' ? ' num' : '') + (on ? ' on' : '') + '"' +
        ' onclick="__dreOrdenar(\'' + c.key + '\', \'dia\')"' +
        ' title="Ordenar por ' + esc(c.rot) + '">' +
        '<span class="rot-l">' + esc(c.rot) + '</span>' +
        '<span class="rot-c">' + esc(c.rotCurto || c.rot) + '</span>' +
        seta + '</th>';
    }).join('');

    var trs = ordenadas.map(function (l) {
      var celulas = cols.map(function (c, i) {
        var v = l[c.key];
        var neg = (c.tipo === 'num' && !vazio(v) && Number(v) < 0) ? ' dre-neg' : '';
        var primeira = (i === 0);
        var tit = primeira
          ? ' title="' + esc(porCat ? String(v || '') : tituloPosto(l)) + '"' : '';
        // MESMA marcação das outras abas: o `*` vai no rótulo da linha, com o
        // detalhe no title, porque é ressalva de toda a linha.
        var marca = (primeira && temLacuna(l))
          ? '<span class="dre-lacuna" title="' + esc(textoLacuna(l)) + '">*</span>' : '';
        return '<td class="col-' + c.key + (c.tipo === 'num' ? ' num' : '') + neg + '"' + tit + '>'
          + c.fmt(v, l) + marca + '</td>';
      }).join('');
      var det = MOBILE_OCULTA_DIA.map(function (k) {
        var c = COL_POSTO_POR_KEY[k];
        return '<div class="dre-det-par"><span>' + esc(c.rot) + '</span><b>' + c.fmt(l[k], l) + '</b></div>';
      }).join('');
      return '<tr onclick="__dreDetalhe(this)" title="Toque para ver o custo">'
        + celulas + '</tr>'
        + '<tr class="dre-det"><td colspan="' + cols.length + '">' + det + '</td></tr>';
    }).join('');

    var tfoot = '<tr>' + cols.map(function (c, i) {
      if (i === 0) return '<td class="col-' + c.key + '">' + (porCat ? 'TOTAL' : 'REDE') + '</td>';
      var v = T[c.key];
      var neg = (!vazio(v) && Number(v) < 0) ? ' dre-neg' : '';
      return '<td class="col-' + c.key + ' num' + neg + '">' + c.fmt(v) + '</td>';
    }).join('') + '</tr>';

    var comLacuna = ordenadas.filter(temLacuna).length;
    body.innerHTML = kpis + cardGraf +
      '<div class="card" style="margin-top:.9rem">' +
        '<div class="chdr">' +
          '<div class="ctitle">' + (porCat ? 'Por categoria' : 'Por posto') + '</div>' +
          '<div class="csub">' + ordenadas.length + ' ' + oQue + '(s) · ' +
            'clique no cabeçalho para ordenar' +
            (porCat ? '' : ' · escolha um posto no filtro para ver as categorias dele') +
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

    // DEPOIS do innerHTML. Mesmo binder das outras abas; o balão é ancorado no
    // topo (o alvo é uma coluna de altura cheia, como na aba Mês), e o título
    // é o nome do posto ou da categoria em vez da data.
    if (svg) {
      ligarTooltipGrafico(paraGrafico, {
        titulo: function (l) {
          return esc(porCat ? (l.cat_nome || '—') : rotuloPosto(l));
        },
      });
    }
  }

  // Variação da venda líquida contra o DIA ANTERIOR.
  // OMITE em vez de mostrar zero quando não há base: sem dado do dia anterior,
  // "0,0%" afirmaria estabilidade que ninguém mediu — e é justamente o dia sem
  // importação que produziria esse zero. Também omite quando a venda anterior
  // é zero, porque a divisão não existe (variação percentual sobre base zero
  // é infinita, não 100%).
  function variacaoVenda(vlHoje) {
    if (!_dadosDAnt) return '';
    var la = Array.isArray(_dadosDAnt.linhas) ? _dadosDAnt.linhas : [];
    if (!la.length) return '';
    var va = _dadosDAnt.totais ? _dadosDAnt.totais.venda_liquida : null;
    if (vazio(va) || Number(va) === 0 || vazio(vlHoje)) return '';
    var d = (Number(vlHoje) - Number(va)) / Number(va) * 100;
    // A SETA SAI DO VALOR EXIBIDO, não do cru. Com a seta vinda do cru, uma
    // variação de +0,04% mostrava "▲ 0,0%" — seta para cima ao lado de um zero,
    // que se lê como erro da tela. Arredonda primeiro, decide depois: abaixo de
    // 0,05% a variação é "=", que é o que o número está dizendo.
    var dExib = Math.round(d * 10) / 10;
    var cls = dExib > 0 ? ' pos' : (dExib < 0 ? ' neg' : '');
    var seta = dExib > 0 ? '▲' : (dExib < 0 ? '▼' : '=');
    var texto = dExib === 0
      ? '= estável vs. dia anterior'
      : seta + ' ' + nf(Math.abs(dExib), 1) + '% vs. dia anterior';
    return '<div class="kmini' + cls + '" title="Dia anterior (' +
      esc(brData(somarDiasISO(_dia, -1))) + '): ' + esc(fmtRS(va)) + '">' +
      texto + '</div>';
  }

  // Texto curto da lacuna de custo do PERÍODO (vem em `totais`), para o card
  // do custo. Vazio quando não há lacuna — sem faixa de aviso à toa.
  function lacunaTexto(T) {
    var c = T && T.custo_desconhecido;
    if (!c || !c.linhas) return '';
    return c.linhas + ' lançamento(s) sem custo (' + fmtRS(c.venda_liquida) + ' de venda)';
  }

  // ══ SUB-ABA "PROJEÇÃO" ═══════════════════════════════════════════
  //
  // O QUE ELA NÃO FAZ, e é o mais importante: não modela sazonalidade nem
  // tendência. Projetar dezembro a partir de agosto com um modelo inventado
  // aqui produziria um número de aparência sofisticada e sem lastro — e é
  // número de lucro, que alguém vai levar para uma reunião. A regra é MÉDIA
  // SIMPLES, declarada na tela e no aviso do rodapé:
  //   · mês corrente = média DIÁRIA dos dias COM DADO × dias do mês;
  //   · meses futuros = média dos últimos 3 meses FECHADOS.
  // Nada além disso.
  //
  // "DIAS COM DADO", nunca "dia do mês": a fonte é um .xls importado à mão. Se
  // a importação parou no dia 8, a média diária tem de dividir por 8, não pelo
  // dia de hoje — dividir pelo dia do mês diluiria o lucro em dias que nunca
  // foram medidos e a projeção sairia baixa, com cara de queda real.

  var MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                     'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                     'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // Quantos dias tem o mês de um ISO. Date.UTC com dia 0 do mês SEGUINTE —
  // mesma técnica de `mesFechado`, que resolve 28/29/30/31 sem regra de
  // bissexto escrita à mão.
  function diasNoMes(iso) {
    var p = String(iso).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  }

  // Dinheiro CURTO, para rótulo de eixo: "R$ 1,2 mi", "R$ 740 mil".
  // O eixo tem ~46 unidades de viewBox de largura; um valor com centavos não
  // cabe e, num eixo, não acrescenta nada.
  // O sinal vem DEPOIS do "R$", igual ao `fmtRS` do resto da tela
  // ("R$ -184 mil", não "-R$ 184 mil"): duas convenções de sinal na mesma
  // tela fazem o leitor conferir duas vezes qual é qual.
  function fmtRSCurto(v) {
    if (!Number.isFinite(v)) return '—';
    var a = Math.abs(v), sinal = v < 0 ? '-' : '';
    if (a >= 1e6) return 'R$ ' + sinal + nf(a / 1e6, 1) + ' mi';
    if (a >= 1e3) return 'R$ ' + sinal + nf(a / 1e3, 0) + ' mil';
    return 'R$ ' + sinal + nf(a, 0);
  }

  // ── LITRAGEM ─────────────────────────────────────────────────────
  // A regra de "o que é litro" mora no SERVIDOR (o `ehLitro` da GET /dre), e
  // é a mesma do `unidadeDe` daqui — ver lá a medição que a sustenta.
  // Conferida contra as 26 categorias reais do banco, com zero divergência
  // entre os dois lados.
  //
  // Aqui só se SOMA o que já vem separado — não se reclassifica nada. Se a
  // regra tiver de mudar, muda num lugar: na rota.

  // NÚMERO OU NULL, estrito.
  //
  // POR QUE ISTO EXISTE: `Number(null)` é ZERO, e `Number.isFinite(0)` é true.
  // Então `Number.isFinite(Number(v)) ? Number(v) : null` — que parece uma
  // guarda — converte AUSÊNCIA em ZERO sem avisar. Foi exatamente o que
  // aconteceu aqui: com a litragem de um mês falhando, a tabela mostrava
  // "0 L" naquele mês e o total realizado saía MENOR que a realidade, em vez
  // de "—". É a mesma armadilha do custo na GET /dre.
  // Aqui a ausência é testada ANTES de qualquer conversão.
  function numOuNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Litro no corpo da tela: SEM casas decimais. A coluna do banco tem 3, mas
  // num total mensal de ~1,3 milhão de litros os mililitros são ruído — e a
  // tela já mostra 3 casas onde a grandeza é de um dia (aba Mês).
  function fmtL(v) { return vazio(v) ? '—' : nf(v, 0) + ' L'; }
  // Litro CURTO, para rótulo de eixo.
  function fmtLCurto(v) {
    if (!Number.isFinite(v)) return '—';
    var a = Math.abs(v), sinal = v < 0 ? '-' : '';
    if (a >= 1e6) return sinal + nf(a / 1e6, 1) + ' mi L';
    if (a >= 1e3) return sinal + nf(a / 1e3, 0) + ' mil L';
    return sinal + nf(a, 0) + ' L';
  }

  // ── MÉTRICAS DO GRÁFICO ANUAL ────────────────────────────────────
  // UM gráfico, quatro leituras. `chave` é o campo da fatia; `mediaDe` diz
  // como calcular a linha de referência dos meses REALIZADOS.
  //
  // `razao: true` na margem é a distinção que importa: margem é uma RAZÃO, não
  // uma soma. A média mensal de margem NÃO é a média das margens mensais — é
  // (soma dos lucros) / (soma das vendas). Um mês pequeno com margem alta
  // puxaria a média das margens para cima sem ter puxado a rede para cima.
  // A mesma regra vale na projeção: `mediaUltimosFechados` projeta venda e
  // custo separados e só então divide.
  var METRICAS = [
    { id: 'faturamento', rot: 'Faturamento', chave: 'venda_liquida',
      eixo: fmtRSCurto, corpo: fmtRS },
    { id: 'lucro', rot: 'Lucro', chave: 'lucro',
      eixo: fmtRSCurto, corpo: fmtRS },
    { id: 'litros', rot: 'Litros', chave: 'litros',
      eixo: fmtLCurto, corpo: fmtL },
    { id: 'margem', rot: 'Margem %', chave: 'margem_pct', razao: true,
      eixo: function (v) { return nf(v, 1) + '%'; }, corpo: fmtPct },
  ];
  function metricaAtual() {
    return METRICAS.filter(function (m) { return m.id === _metricaAno; })[0] || METRICAS[1];
  }
  window.__dreMetrica = function (id) {
    if (!METRICAS.some(function (m) { return m.id === id; })) return;
    if (_metricaAno === id) return;
    _metricaAno = id;
    render();          // só redesenha; nenhuma requisição nova
  };

  // ESCOPOS do eixo. 'mes' lê `_seriesMes`, o cache por mês.
  var ESCOPOS = [
    { id: 'ano', rot: 'Ano' },
    { id: 'mes', rot: 'Diário' },
  ];
  window.__dreEscopoAno = function (id) {
    if (!ESCOPOS.some(function (e) { return e.id === id; })) return;
    if (_escopoAno === id) return;
    _escopoAno = id;
    // Trocar para Diário num mês fora do cache dispara UMA busca; nos outros
    // casos, nenhuma. Voltar a um mês já visto também não busca.
    if (id === 'mes' && _mesDiario && !(_seriesMes && _seriesMes.has(_mesDiario))) {
      garantirSerieMes(_mesDiario);
      return;
    }
    render();
  };

  // Busca a série diária de um mês SE não estiver em cache, e renderiza.
  // Renderiza DUAS vezes de propósito: uma para o card dizer que está
  // buscando, outra com o resultado. Sem a primeira, a tela fica congelada no
  // mês anterior enquanto a requisição corre, e o usuário clica de novo.
  async function garantirSerieMes(mes) {
    // MESMA guarda de geração: sair da aba durante a busca de um mês faria o
    // `finally` daqui renderizar a aba nova. Sem `++`, porque isto não é uma
    // carga nova — é um pedaço da carga corrente.
    var ger = _gerCarga;
    if (!_seriesMes) _seriesMes = new Map();
    if (_seriesMes.has(mes)) { render(); return; }
    _carregandoMes = true;
    render();
    var hj = hojeISO();
    var ini = mes + '-01';
    var ult = mes + '-' + String(diasNoMes(ini)).padStart(2, '0');
    // Mês corrente vai só até HOJE; num mês fechado `ult` já é o fim.
    var fim = (ult > hj) ? hj : ult;
    try {
      _seriesMes.set(mes, await apiFetch('/dre?inicio=' + encodeURIComponent(ini) +
        '&fim=' + encodeURIComponent(fim) +
        (_postoId ? '&posto_id=' + encodeURIComponent(_postoId) : '') + '&agrupar=dia'));
    } catch (e) {
      // Falha NÃO entra no cache: uma nova tentativa (voltar ao mês) busca de
      // novo, em vez de guardar o erro para sempre.
      console.warn('DRE: serie diaria de ' + mes + ' nao carregou:', e && e.message);
    } finally {
      _carregandoMes = false;
      if (ehCargaAtual(ger)) render();
    }
  }

  window.__dreMesPasso = function (n) {
    if (_escopoAno !== 'mes' || !_mesDiario) return;
    var alvo = somarMesesISO(_mesDiario, n);
    var lim = limitesMesDiario();
    if (!lim || alvo < lim.min || alvo > lim.max) return;
    _mesDiario = alvo;
    garantirSerieMes(alvo);
  };

  // Vai direto a um mês — usado pelo clique numa barra do gráfico anual.
  window.__dreMesIr = function (mes) {
    if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return;
    var lim = limitesMesDiario();
    if (!lim || mes < lim.min || mes > lim.max) return;
    _mesDiario = mes;
    _escopoAno = 'mes';
    garantirSerieMes(mes);
  };

  // Anda `n` meses num 'YYYY-MM'. Date.UTC com dia 1 e mês base zero
  // atravessa o ano sozinho — mesma técnica de `mesFechado` e `somarDiasISO`,
  // sem hora local envolvida.
  function somarMesesISO(mesISO, n) {
    var p = String(mesISO).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  // LIMITES da navegação de mês.
  //   max = mês CORRENTE — não há dado do futuro.
  //   min = primeiro mês COM DADO do ano carregado.
  //
  // "do ano carregado", e não "do banco": esta aba busca UM ano (01/01 até
  // hoje), então é até aí que ela sabe onde o dado começa. Chegar a 2025
  // exigiria outra busca e um seletor de ano, e a referência dos 3 fechados
  // também sairia de fora do que está na tela. O `title` da seta diz isso.
  function limitesMesDiario() {
    if (!_dadosPAno) return null;
    var meses = agruparPorMes(_dadosPAno.linhas).map(function (m) { return m.mes; });
    if (!meses.length) return null;
    return { min: meses[0], max: hojeISO().slice(0, 7) };
  }

  // MÉDIA DIÁRIA dos últimos meses fechados, por métrica — a referência do
  // modo 'mes'. Dividir a média MENSAL por 30 daria outro número: os meses
  // têm contagens de dias COM DADO diferentes, e é por dia com dado que se
  // divide. Então soma valor e soma dias, e divide no fim.
  // Margem é RAZÃO e não se divide por dia nenhum: é (Σ lucro)/(Σ venda).
  function mediaDiariaFechados(fechados, met, n) {
    var usados = fechados.slice(-(n || 3));
    if (!usados.length) return null;
    if (met.razao) {
      var v = 0, c = 0;
      usados.forEach(function (m) { v += m.venda_liquida; c += m.custo_total; });
      return v !== 0 ? (v - c) / v * 100 : null;
    }
    var soma = 0, dias = 0, falta = false;
    usados.forEach(function (m) {
      var x = numOuNull(m[met.chave]);
      if (x === null) falta = true; else soma += x;
      dias += m.dias;
    });
    // Litragem faltando num dos meses invalidaria a média — melhor não ter
    // referência que ter uma baixa sem aviso.
    if (falta || !dias) return null;
    return soma / dias;
  }

  // ── Colunas da TABELA ANUAL ──────────────────────────────────────
  // Sem ordenação: a tabela é cronológica por natureza, e reordenar meses por
  // valor destruiria a única leitura que ela oferece — a evolução do ano.
  // `rotulo` e `situacao` são texto montado na fatia, não campos da rota.
  // O rótulo da primeira coluna muda com o escopo ("Mês" ou "Dia"), então o
  // cabeçalho vem de fora — a chave é a mesma nos dois, e por isso o CSS de
  // celular e a linha de detalhe valem para os dois sem regra nova.
  var COLS_ANO = [
    { key: 'rotulo',        rot: 'Mês',           tipo: 'txt' },
    { key: 'litros',        rot: 'Litros',        tipo: 'num', fmt: fmtL },
    { key: 'venda_liquida', rot: 'Venda líquida', rotCurto: 'Líquida', tipo: 'num', fmt: fmtRS },
    { key: 'custo_total',   rot: 'Custo',         tipo: 'num', fmt: fmtRS },
    { key: 'lucro',         rot: 'Lucro',         tipo: 'num', fmt: fmtRS },
    { key: 'margem_pct',    rot: 'Margem %',      rotCurto: 'Margem', tipo: 'num', fmt: fmtPct },
    { key: 'situacao',      rot: 'Situação',      tipo: 'txt' },
  ];
  // Celular: ficam Mês, Lucro, Margem e Situação — "quando, quanto sobrou, a
  // que taxa, e se é fato". Litros/Venda/Custo vão para o detalhe ao toque.
  var MOBILE_OCULTA_ANO = ['litros', 'venda_liquida', 'custo_total'];

  // Soma um conjunto de fatias devolvendo os totais e a margem como RAZÃO.
  // `litros` sai null se QUALQUER fatia tiver litro desconhecido: um total de
  // litros com meses faltando seria menor que a realidade sem nada dizendo.
  function somarFatias(fatias) {
    var t = { n: fatias.length, venda_liquida: 0, custo_total: 0, lucro: 0, litros: 0 };
    var litroCompleto = fatias.length > 0;
    fatias.forEach(function (f) {
      t.venda_liquida += Number(f.venda_liquida) || 0;
      t.custo_total   += Number(f.custo_total)   || 0;
      t.lucro         += Number(f.lucro)         || 0;
      var lt = numOuNull(f.litros);
      if (lt === null) litroCompleto = false; else t.litros += lt;
    });
    if (!litroCompleto) t.litros = null;
    t.margem_pct = t.venda_liquida !== 0 ? t.lucro / t.venda_liquida * 100 : null;
    return t;
  }

  // Desvio padrão AMOSTRAL (n-1). Amostral e não populacional porque os dias
  // observados são uma amostra do mês, não o mês inteiro — com n pequeno a
  // diferença entre os dois divisores não é decorativa. Devolve null com menos
  // de 2 pontos, onde dispersão não existe.
  function desvioPadrao(vals) {
    var n = vals.length;
    if (n < 2) return null;
    var media = vals.reduce(function (a, b) { return a + b; }, 0) / n;
    var soma = vals.reduce(function (a, b) { return a + (b - media) * (b - media); }, 0);
    return Math.sqrt(soma / (n - 1));
  }

  // Série diária -> um registro por MÊS. Feito no cliente, a partir do
  // `agrupar=dia`, como combinado: não há rota nova.
  // `dias` conta os dias COM DADO — a rota devolve uma linha por dia que tem
  // lançamento, então um dia não importado simplesmente não aparece, e é
  // exatamente essa contagem que a projeção precisa.
  function agruparPorMes(linhas) {
    var por = new Map();
    (linhas || []).forEach(function (l) {
      var iso = l.data || l.chave;
      var mes = String(iso).slice(0, 7);          // YYYY-MM
      var a = por.get(mes);
      if (!a) {
        a = { mes: mes, dias: 0, venda_liquida: 0, custo_total: 0,
              sc_linhas: 0, sc_venda: 0, margens: [], vendaDia: [],
              litros: 0, litroAusente: false, litrosDia: [] };
        por.set(mes, a);
      }
      a.dias += 1;
      a.venda_liquida += Number(l.venda_liquida) || 0;
      a.custo_total   += Number(l.custo_total)   || 0;
      if (l.custo_desconhecido) {
        a.sc_linhas += Number(l.custo_desconhecido.linhas) || 0;
        a.sc_venda  += Number(l.custo_desconhecido.venda_liquida) || 0;
      }
      if (temMargem(l)) a.margens.push(Number(l.margem_pct));
      a.vendaDia.push(Number(l.venda_liquida) || 0);
      // AUSENTE não é ZERO. Um dia em que só se vendeu produto tem litros = 0
      // de verdade; um dia cuja resposta NÃO TRAZ o campo é desconhecido — é o
      // que acontece enquanto a API com `litros` não estiver no ar. O primeiro
      // soma zero, o segundo apaga a litragem do mês inteiro para "—".
      var lt = numOuNull(l.litros);
      if (lt === null) a.litroAusente = true;
      else { a.litros += lt; a.litrosDia.push(lt); }
    });
    return [...por.values()].sort(function (a, b) { return a.mes.localeCompare(b.mes); })
      .map(function (a) {
        a.lucro = a.venda_liquida - a.custo_total;
        a.margem_pct = a.venda_liquida !== 0 ? a.lucro / a.venda_liquida * 100 : null;
        a.custo_desconhecido = { linhas: a.sc_linhas, venda_liquida: a.sc_venda };
        if (a.litroAusente) a.litros = null;
        return a;
      });
  }

  // Projeção do MÊS CORRENTE a partir dos dias com dado.
  // Devolve `null` com menos de MIN_DIAS_PROJ dias — projetar 30 dias a partir
  // de 2 é chute com aparência de conta, e a tela prefere não dizer nada a
  // dizer isso.
  var MIN_DIAS_PROJ = 3;
  function projetarMes(mesAtual, iso) {
    if (!mesAtual || mesAtual.dias < MIN_DIAS_PROJ) return null;
    var D = diasNoMes(iso);
    var lucroDia = mesAtual.lucro / mesAtual.dias;
    var vendaDia = mesAtual.venda_liquida / mesAtual.dias;
    var lucro = lucroDia * D;
    var venda = vendaDia * D;
    // FAIXA DE INCERTEZA: sai do desvio padrão da MARGEM DIÁRIA, convertido em
    // dinheiro pela venda projetada. É a dispersão CRUA dos dias observados,
    // não erro padrão da média (que seria σ/√n) — o erro padrão daria uma
    // faixa bem mais estreita, e faixa estreita numa projeção de 8 dias é
    // justamente a falsa confiança que se quer evitar aqui.
    // NÃO é intervalo de confiança e a tela não chama de intervalo.
    var sd = desvioPadrao(mesAtual.margens);
    var faixa = (sd === null) ? null : venda * sd / 100;
    // LITRO segue a MESMA regra de projeção: média diária × dias do mês.
    //
    // A FAIXA DO LITRO passou a existir quando a GET /dre começou a devolver
    // `litros` por LINHA: agora há série diária, e dispersão diária é
    // exatamente o que uma faixa precisa. Antes a litragem vinha de uma
    // chamada por mês inteiro, sem série, e o card dizia "sem faixa" — não por
    // escolha, por falta de dado.
    // A dispersão é a do PRÓPRIO litro, não a da margem: margem não diz nada
    // sobre volume.
    var litrosReal = numOuNull(mesAtual.litros);
    var litros = (litrosReal === null) ? null : litrosReal / mesAtual.dias * D;
    var sdL = desvioPadrao(mesAtual.litrosDia || []);
    // Faixa do FATURAMENTO: a dispersão da margem não serve aqui — usa a da
    // própria venda líquida diária, que existe na série.
    var sdV = desvioPadrao(mesAtual.vendaDia || []);
    return {
      dias: mesAtual.dias, diasDoMes: D,
      lucro: lucro, venda: venda, litros: litros,
      margem_pct: venda !== 0 ? lucro / venda * 100 : null,
      faixa: faixa, sd_margem: sd,
      faixa_venda: (sdV === null) ? null : sdV * D,
      faixa_litros: (sdL === null || litros === null) ? null : sdL * D,
    };
  }

  // Média dos últimos `n` meses FECHADOS COM DADO, contando de trás para
  // frente. Mês fechado sem importação não entra: ele não vale zero, ele é
  // desconhecido — e entrar como zero puxaria a média para baixo e a projeção
  // dos meses futuros com ela.
  function mediaUltimosFechados(fechados, n) {
    var usados = fechados.slice(-n);
    if (!usados.length) return null;
    var soma = usados.reduce(function (a, m) {
      a.venda += m.venda_liquida; a.custo += m.custo_total;
      // Litro só entra se TODOS os meses usados o têm. Média de litro com um
      // mês faltando sairia baixa e viraria projeção baixa, sem nada avisando.
      var lm = numOuNull(m.litros);
      if (lm === null) a.litroCompleto = false; else a.litros += lm;
      return a;
    }, { venda: 0, custo: 0, litros: 0, litroCompleto: true });
    var venda = soma.venda / usados.length;
    var custo = soma.custo / usados.length;
    return {
      n: usados.length,
      meses: usados.map(function (m) { return m.mes; }),
      venda_liquida: venda, custo_total: custo, lucro: venda - custo,
      // MARGEM COMO RAZÃO: venda e custo projetados separados e SÓ ENTÃO
      // divididos. Média das margens mensais daria outro número, e daria peso
      // igual a um mês pequeno e a um mês grande.
      margem_pct: venda !== 0 ? (venda - custo) / venda * 100 : null,
      litros: soma.litroCompleto ? soma.litros / usados.length : null,
    };
  }

  // ── Render da sub-aba "Projeção" ─────────────────────────────────
  function renderProjecao(body) {
    if (!_dadosPMes || !_dadosPAno) {
      body.innerHTML = '<div class="empty">Sem dados.</div>';
      return;
    }
    var hoje = hojeISO();
    var ano = Number(hoje.slice(0, 4));
    var mesNum = Number(hoje.slice(5, 7));          // 1..12
    var mesISO = hoje.slice(0, 7);

    // A litragem já vem somada por `agruparPorMes`, da própria série diária.
    var mesesAno = agruparPorMes(_dadosPAno.linhas);
    var doMes = agruparPorMes(_dadosPMes.linhas)[0] || null;
    var porMes = new Map(mesesAno.map(function (m) { return [m.mes, m]; }));
    var fechados = mesesAno.filter(function (m) { return m.mes < mesISO; });
    var proj = projetarMes(doMes, hoje);
    var base3 = mediaUltimosFechados(fechados, 3);
    var mesAnt = fechados.length ? fechados[fechados.length - 1] : null;
    var nDias = doMes ? doMes.dias : 0;

    // ── BLOCO 1: KPIs do mês corrente, um card por MÉTRICA ──
    // Cada card carrega a projeção (número grande), a faixa quando existe, e o
    // REALIZADO até agora com a contagem de dias com dado. Compactar assim, em
    // vez de uma fileira "realizado" e outra "projetado", é o que mantém
    // quatro cards em vez de sete — sete empilhados no celular empurrariam o
    // gráfico para fora da primeira tela.
    function cardMetrica(rot, projVal, faixaVal, fmt, realVal, extra, semFaixaNota) {
      var corpo;
      if (proj && projVal !== null && projVal !== undefined) {
        corpo = '<div class="kval ac">' + fmt(projVal) + '</div>' +
          '<div class="kfaixa"' + (semFaixaNota ? ' title="' + esc(semFaixaNota) + '"' : '') + '>' +
            (faixaVal === null || faixaVal === undefined
              ? (semFaixaNota ? 'sem faixa' : '—')
              : '± ' + fmt(faixaVal)) + '</div>';
      } else {
        // OMITIDA com o motivo no lugar do número — nunca um número fraco sem
        // aviso. Cobre "menos de 3 dias" e "litro não carregou".
        corpo = '<div class="kval">—</div>' +
          '<div class="kfaixa">' +
            (!proj
              ? (nDias
                  ? nDias + ' dia(s): menos de ' + MIN_DIAS_PROJ + ', não projeta'
                  : 'nenhum dia importado')
              : 'litragem não disponível') + '</div>';
      }
      return '<div class="kbox">' +
        '<div class="klbl">' + esc(rot) + ' · projeção</div>' + corpo +
        '<div class="kmini">realizado ' + fmt(realVal) +
          ' em ' + nDias + ' dia(s) com dado' + (extra || '') + '</div>' +
      '</div>';
    }

    var margemReal = doMes ? doMes.margem_pct : null;
    var kpis = '<div class="kgrid kgrid-4">' +
      cardMetrica('Faturamento', proj ? proj.venda : null, proj ? proj.faixa_venda : null,
        fmtRS, doMes ? doMes.venda_liquida : null, '') +
      cardMetrica('Lucro bruto', proj ? proj.lucro : null, proj ? proj.faixa : null,
        fmtRS, doMes ? doMes.lucro : null,
        ' · margem ' + fmtPct(margemReal)) +
      cardMetrica('Litros', proj ? proj.litros : null, proj ? proj.faixa_litros : null,
        fmtL, doMes ? doMes.litros : null, '',
        'A faixa é o desvio padrão da litragem diária projetado no mês.') +
      kpiVsMesAnterior(mesAnt, proj) +
    '</div>';

    // ── BLOCO 2: as fatias do eixo ──
    //
    // DUAS DIMENSÕES INDEPENDENTES: a MÉTRICA (o que a altura mede) e o
    // ESCOPO (o que cada barra é). 4 × 2 = 8 leituras, um desenhador só.
    // A partir daqui nada sabe qual escopo está ativo: tudo lê `fatias`,
    // `modo` e `met`.
    var met = metricaAtual();
    var porDia = (_escopoAno === 'mes');
    var fatias, modo;

    if (!porDia) {
      // ── ESCOPO ANO: 12 fatias, janeiro a dezembro ──
      // 12 SEMPRE: o eixo é o ano, não os meses que por acaso têm dado. Mês
      // fechado sem importação fica SEM BARRA, com o motivo no balão — barra
      // zerada afirmaria lucro zero.
      fatias = [];
      for (var i = 1; i <= 12; i++) {
        var chave = ano + '-' + String(i).padStart(2, '0');
        var real = porMes.get(chave) || null;
        var s;
        if (i < mesNum) {
          s = real
            ? { tipo: 'real', venda_liquida: real.venda_liquida, custo_total: real.custo_total,
                lucro: real.lucro, margem_pct: real.margem_pct, litros: real.litros,
                dias: real.dias }
            : { tipo: 'vazio' };
        } else if (i === mesNum) {
          // MÊS CORRENTE. Com projeção, a barra mostra o MÊS PROJETADO
          // (hachurada). Sem projeção — menos de MIN_DIAS_PROJ dias — mostra o
          // REALIZADO até agora, com aspecto de PARCIAL.
          //
          // Antes esta fatia não desenhava barra nenhuma no caso parcial, o que
          // escondia um mês que TEM dado e aparece na tabela. Aspecto próprio
          // resolve o que motivou esconder: parcial não se confunde com
          // fechado nem com projeção.
          s = proj
            ? { tipo: 'proj', venda_liquida: proj.venda, custo_total: proj.venda - proj.lucro,
                lucro: proj.lucro, margem_pct: proj.margem_pct, litros: proj.litros,
                dias: proj.dias }
            : { tipo: 'parcial', dias: nDias,
                venda_liquida: doMes ? doMes.venda_liquida : null,
                custo_total: doMes ? doMes.custo_total : null,
                lucro: doMes ? doMes.lucro : null,
                margem_pct: doMes ? doMes.margem_pct : null,
                litros: doMes ? doMes.litros : null };
        } else {
          s = base3
            ? { tipo: 'proj', venda_liquida: base3.venda_liquida, custo_total: base3.custo_total,
                lucro: base3.lucro, margem_pct: base3.margem_pct, litros: base3.litros,
                baseN: base3.n }
            : { tipo: 'vazio' };
        }
        s.mes = i;
        s.chave = chave;
        s.rotulo = MESES_CURTO[i - 1];
        s.tituloLongo = MESES_LONGO[i - 1] + ' de ' + ano;
        s.situacao = s.tipo === 'real' ? 'realizado'
          : s.tipo === 'proj' ? 'projetado'
          : s.tipo === 'parcial' ? ('parcial (' + s.dias + ' dia' + (s.dias === 1 ? '' : 's') + ')')
          : 'sem dado';
        fatias.push(s);
      }
      // Só meses FECHADOS entram na referência: uma média que inclui a própria
      // projeção não serve para julgar a projeção.
      var reaisAno = fatias.filter(function (f) { return f.tipo === 'real'; });
      modo = {
        titulo: met.rot + ' por mês — ' + ano,
        // `unidade`/`plural` separados: "mês(es)" e "dia(s)" não seguem a
        // mesma regra, e concatenar '(es)' saía "dia(es)".
        unidade: 'mês', plural: 'mês(es)',
        media: mediaMetrica(reaisAno, met),
        mediaRot: 'média mensal realizada ' + met.corpo(mediaMetrica(reaisAno, met)),
        marcaX: mesNum - 1,
        colRot: 'Mês',
        base: reaisAno,
      };
    } else {
      // ── ESCOPO DIÁRIO: um dia por fatia, dia 1 ao ÚLTIMO DIA DO MÊS ──
      // O eixo vai até o fim do mês, não até o último dia com dado: no mês
      // corrente os dias que faltam aparecem vazios, e é isso que mostra
      // QUANTO FALTA. Cortar o eixo no último dia importado faria um mês de
      // 3 dias parecer cheio.
      var mesAlvo = _mesDiario || mesISO;
      var ehCorrente = (mesAlvo === mesISO);
      var serieMes = _seriesMes ? _seriesMes.get(mesAlvo) : null;
      var mesNumAlvo = Number(mesAlvo.slice(5, 7));
      var porDiaMap = new Map(((serieMes && serieMes.linhas) || []).map(function (l) {
        return [String(l.data || l.chave), l];
      }));
      var D = diasNoMes(mesAlvo + '-01');
      fatias = [];
      for (var d = 1; d <= D; d++) {
        var iso = mesAlvo + '-' + String(d).padStart(2, '0');
        var lin = porDiaMap.get(iso) || null;
        var f = lin
          ? { tipo: 'real', venda_liquida: lin.venda_liquida, custo_total: lin.custo_total,
              lucro: lin.lucro, margem_pct: lin.margem_pct, litros: numOuNull(lin.litros) }
          : { tipo: 'vazio' };
        f.mes = mesNumAlvo;
        f.chave = iso;
        f.dia = d;
        f.rotulo = String(d);
        f.tituloLongo = brData(iso) + ' · ' + diaDaSemana(iso);
        // FUTURO x NÃO IMPORTADO são coisas diferentes, e o balão diz qual: um
        // dia que ainda não chegou não tem dado a faltar. Num mês FECHADO
        // "a vir" não existe — todo dia dele já passou.
        f.situacao = lin ? 'realizado' : (iso > hoje ? 'a vir' : 'sem dado');
        fatias.push(f);
      }
      // REFERÊNCIA: média diária dos 3 fechados, SEM o mês exibido.
      //
      // Excluir o próprio mês não é detalhe: comparar agosto com uma média que
      // INCLUI agosto compara agosto com uma versão diluída de si mesmo, e a
      // linha passa perto das barras quase por construção. Fora dele, a linha
      // responde de verdade "este mês está acima ou abaixo dos anteriores".
      var baseRef = fechados.filter(function (m) { return m.mes !== mesAlvo; });
      var mDia = mediaDiariaFechados(baseRef, met, 3);
      var nRef = Math.min(3, baseRef.length);
      modo = {
        titulo: met.rot + ' por dia — ' + MESES_LONGO[mesNumAlvo - 1] + '/' + mesAlvo.slice(0, 4),
        unidade: 'dia', plural: 'dia(s)',
        media: mDia,
        mediaRot: mDia === null
          ? ''
          : 'média diária dos ' + nRef + ' mês(es) fechado(s) anteriores: ' + met.corpo(mDia),
        // Marca o dia de HOJE — só quando o mês exibido é o corrente. Num mês
        // fechado não há "hoje" dentro dele, e a marca apontaria um dia
        // qualquer.
        marcaX: ehCorrente ? Number(hoje.slice(8, 10)) - 1 : null,
        colRot: 'Dia',
        base: fatias.filter(function (x) { return x.tipo === 'real'; }),
        mesAlvo: mesAlvo, ehCorrente: ehCorrente,
        carregando: (!serieMes && _carregandoMes),
      };
    }

    // SEM MÊS FECHADO (janeiro, ou ano sem importação anterior) o gráfico
    // ANUAL não se desenha: onze fatias vazias e uma parcial não são um
    // gráfico do ano, são ruído. O card fica, com os seletores — e é aí que
    // "Mês atual" passa a ser a vista útil, porque ela não depende de mês
    // fechado nenhum.
    var semBaseAnual = (!porDia && !fechados.length);
    // Buscando a série de outro mês: NÃO desenha. Trinta fatias vazias
    // enquanto a requisição corre mostrariam um mês sem dado que na verdade
    // ninguém sabe ainda — e o usuário concluiria que o mês está vazio.
    var buscando = (porDia && modo.carregando);
    var svgAno = (semBaseAnual || buscando) ? '' : svgBarrasVerticais(fatias, {
      // Fatia sem dado não ganha barra. A PARCIAL ganha — ela tem dado, só
      // não tem o mês inteiro.
      valor: function (l) { return l.tipo === 'vazio' ? null : l[met.chave]; },
      rotuloX: function (l) { return l.rotulo; },
      rotuloY: met.eixo,
      maxRotulos: porDia ? 8 : 12,
      media: modo.media,
      mediaRot: modo.mediaRot,
      aspecto: function (l) {
        return l.tipo === 'proj' ? 'proj' : (l.tipo === 'parcial' ? 'parcial' : '');
      },
      // CLICÁVEL só no gráfico ANUAL, e só nas fatias que têm dia a dia para
      // mostrar: mês projetado não tem dias, mês sem importação não tem nada.
      clicavel: function (l) { return !porDia && podeAbrirDia(l); },
      marcaX: modo.marcaX,
      piso: met.razao ? 1 : undefined,
      aria: modo.titulo,
    });

    var nReal = fatias.filter(function (f) { return f.tipo === 'real'; }).length;
    var nProj = fatias.filter(function (f) { return f.tipo === 'proj'; }).length;
    var nParc = fatias.filter(function (f) { return f.tipo === 'parcial'; }).length;
    var nSem = fatias.length - nReal - nProj - nParc;

    var seletores =
      '<div class="dre-metricas">' + METRICAS.map(function (m) {
        return '<button type="button" class="ftag' + (m.id === _metricaAno ? ' active' : '') +
          '" onclick="__dreMetrica(\'' + m.id + '\')">' + esc(m.rot) + '</button>';
      }).join('') + '</div>' +
      // ESCOPO à parte da métrica, com separador: são duas perguntas
      // diferentes ("o quê" e "que eixo"), e juntar os seis botões numa fileira
      // só faria parecer que são seis opções da mesma coisa.
      '<div class="dre-metricas dre-escopos">' + ESCOPOS.map(function (e) {
        return '<button type="button" class="ftag' + (e.id === _escopoAno ? ' active' : '') +
          '" onclick="__dreEscopoAno(\'' + e.id + '\')">' + esc(e.rot) + '</button>';
      }).join('') +
      // SELETOR DE MÊS, só no modo Diário. As setas param nos limites e dizem
      // por quê no `title` — desabilitada e muda faria o usuário clicar duas
      // vezes achando que travou.
      (porDia ? (function () {
        var lim = limitesMesDiario() || { min: modo.mesAlvo, max: modo.mesAlvo };
        var ant = somarMesesISO(modo.mesAlvo, -1);
        var prox = somarMesesISO(modo.mesAlvo, 1);
        var noMin = (ant < lim.min), noMax = (prox > lim.max);
        return '<span class="dre-navmes">' +
          '<button type="button" class="dre-passo" onclick="__dreMesPasso(-1)"' +
            (noMin ? ' disabled' : '') +
            ' title="' + (noMin
              ? 'Primeiro mês com dado no ano carregado (' + esc(lim.min) + ')'
              : 'Mês anterior') + '"' +
            ' aria-label="Mês anterior">‹</button>' +
          '<b>' + esc(MESES_CURTO[Number(modo.mesAlvo.slice(5, 7)) - 1]) + '/' +
            esc(modo.mesAlvo.slice(0, 4)) + '</b>' +
          '<button type="button" class="dre-passo" onclick="__dreMesPasso(1)"' +
            (noMax ? ' disabled' : '') +
            ' title="' + (noMax ? 'O mês corrente é o último' : 'Mês seguinte') + '"' +
            ' aria-label="Mês seguinte">›</button>' +
        '</span>';
      })() : '') +
      '</div>';

    // O CARD SAI MESMO SEM BARRA NENHUMA, e é de propósito: quando a métrica
    // escolhida não tem dado (litragem indisponível, por exemplo), esconder o
    // card levava os SELETORES com ele — o usuário escolhia Litros, tudo
    // desaparecia e não havia como voltar para Lucro.
    var cardAno =
      '<div class="card" style="margin-top:.9rem">' +
        '<div class="chdr">' +
          '<div class="ctitle">' + esc(modo.titulo) + '</div>' +
          '<div class="csub">' + (svgAno
            ? nReal + ' ' + modo.plural + ' com dado' +
              (nParc ? ' · 1 parcial' : '') +
              (nProj ? ' · ' + nProj + ' projetado(s)' : '') +
              (nSem ? ' · ' + nSem + ' sem barra' : '') +
              ' · passe o mouse ou toque numa barra'
            : (buscando ? 'buscando a série do mês…'
               : semBaseAnual ? 'sem mês fechado para comparar'
               : 'nenhum ' + modo.unidade + ' tem ' + met.rot.toLowerCase() + ' para desenhar')) +
          '</div>' +
          seletores +
        '</div>' +
        '<div class="cbody">' + (buscando
          ? '<div class="dre-buscando">Buscando ' +
            esc(MESES_LONGO[Number(modo.mesAlvo.slice(5, 7)) - 1] + '/' +
                modo.mesAlvo.slice(0, 4)) + '…</div>'
          : svgAno
          ? '<div class="dre-graf-wrap">' + svgAno +
              '<div class="dre-legproj">' +
                '<i><span class="dre-sw real"></span>' + (porDia ? 'dia com dado' : 'realizado') + '</i>' +
                (nParc ? '<i><span class="dre-sw parcial"></span>parcial (mês em curso)</i>' : '') +
                (nProj ? '<i><span class="dre-sw proj"></span>projetado' +
                  (base3 ? ' (média de ' + base3.n + ' fechado(s))' : '') + '</i>' : '') +
                // A legenda da marca só sai quando a marca EXISTE: num mês
                // fechado não há "hoje" dentro dele, e anunciar uma marca
                // ausente manda o leitor procurar o que não está lá.
                (modo.marcaX === null || modo.marcaX === undefined ? ''
                  : '<i>| marca vertical = ' + (porDia ? 'hoje' : 'mês corrente') + '</i>') +
              '</div>' +
              '<div class="dre-tip" style="display:none"></div>' +
            '</div>'
          : '<div class="empty">' + (semBaseAnual
              ? 'Nenhum mês fechado com dado neste ano, então não há o que comparar mês a ' +
                'mês. Veja <b>Mês atual</b> acima — a série diária não depende de mês fechado.'
              : 'Sem ' + esc(met.rot.toLowerCase()) + ' para desenhar neste escopo. Escolha ' +
                'outra métrica acima — os valores em dinheiro não são afetados.') + '</div>') +
        '</div>' +
      '</div>';

    // ── BLOCO 3: a tabela, que ACOMPANHA o escopo ──
    var thsA = COLS_ANO.map(function (c) {
      var rot = (c.key === 'rotulo') ? modo.colRot : c.rot;
      return '<th class="col-' + c.key + (c.tipo === 'num' ? ' num' : '') + '">' +
        '<span class="rot-l">' + esc(rot) + '</span>' +
        '<span class="rot-c">' + esc(c.rotCurto || rot) + '</span></th>';
    }).join('');

    var trsA = fatias.map(function (f) {
      var celulas = COLS_ANO.map(function (c) {
        if (c.key === 'rotulo') {
          return '<td class="col-rotulo" title="' + esc(f.tituloLongo) + '">' +
            esc(f.rotulo) + '</td>';
        }
        if (c.key === 'situacao') {
          return '<td class="col-situacao"><span class="dre-sit ' + f.tipo + '">' +
            esc(f.situacao) + '</span></td>';
        }
        var v = f[c.key];
        var neg = (!vazio(v) && Number(v) < 0) ? ' dre-neg' : '';
        return '<td class="col-' + c.key + ' num' + neg + '">' + c.fmt(v) + '</td>';
      }).join('');
      var det = MOBILE_OCULTA_ANO.map(function (k) {
        var c = COLS_ANO.filter(function (x) { return x.key === k; })[0];
        return '<div class="dre-det-par"><span>' + esc(c.rot) + '</span><b>' + c.fmt(f[k]) + '</b></div>';
      }).join('');
      return '<tr class="sit-' + f.tipo + '" onclick="__dreDetalhe(this)"' +
        ' title="Toque para ver litros, venda e custo">' + celulas + '</tr>' +
        '<tr class="dre-det"><td colspan="' + COLS_ANO.length + '">' + det + '</td></tr>';
    }).join('');

    // RODAPÉ COM DOIS TOTAIS, nunca um só. Somar fato com estimativa num
    // número único esconde onde termina um e começa o outro — e é esse número
    // somado que alguém levaria para uma reunião como se fosse apurado.
    //
    // A fatia PARCIAL fica fora dos dois nos DOIS escopos: no ano ela não é mês
    // fechado nem projeção; no mês ela não existe (os dias são realizados).
    function linhaTotal(rot, t, cls) {
      return '<tr class="' + cls + '"><td class="col-rotulo">' + esc(rot) + '</td>' +
        '<td class="col-litros num">' + fmtL(t.litros) + '</td>' +
        '<td class="col-venda_liquida num">' + fmtRS(t.venda_liquida) + '</td>' +
        '<td class="col-custo_total num">' + fmtRS(t.custo_total) + '</td>' +
        '<td class="col-lucro num' + (t.lucro < 0 ? ' dre-neg' : '') + '">' + fmtRS(t.lucro) + '</td>' +
        '<td class="col-margem_pct num">' + fmtPct(t.margem_pct) + '</td>' +
        '<td class="col-situacao">' + t.n + ' ' + modo.plural + '</td></tr>';
    }
    var tfootA;
    if (!porDia) {
      tfootA = linhaTotal('REALIZADO', somarFatias(fatias.filter(function (f) { return f.tipo === 'real'; })), 'tot-real') +
        linhaTotal('PROJETADO', somarFatias(fatias.filter(function (f) { return f.tipo === 'proj'; })), 'tot-proj');
    } else {
      // No modo diário o "realizado" é o mês exibido. Num mês FECHADO ele é o
      // mês inteiro, e o rótulo diz isso — "MÊS ATÉ AGORA" num mês que acabou
      // sugeriria que ainda vai crescer. A segunda linha (a projeção) só faz
      // sentido no mês CORRENTE: projetar um mês fechado não é projeção.
      tfootA = linhaTotal(modo.ehCorrente ? 'MÊS ATÉ AGORA' : 'MÊS FECHADO',
        somarFatias(modo.base), 'tot-real');
      if (proj && modo.ehCorrente) {
        tfootA += linhaTotal('PROJEÇÃO DO MÊS', {
          n: diasNoMes(hoje), litros: proj.litros, venda_liquida: proj.venda,
          custo_total: proj.venda - proj.lucro, lucro: proj.lucro,
          margem_pct: proj.margem_pct,
        }, 'tot-proj');
      }
    }

    var cardTab =
      '<div class="card" style="margin-top:.9rem">' +
        '<div class="chdr">' +
          '<div class="ctitle">' + (porDia
            ? MESES_LONGO[Number(modo.mesAlvo.slice(5, 7)) - 1] + '/' +
              modo.mesAlvo.slice(0, 4) + ', dia a dia'
            : 'O ano mês a mês') + '</div>' +
          '<div class="csub">Ordem cronológica · os dois totais ficam separados de ' +
            'propósito: fato e estimativa não se somam num número só</div>' +
        '</div>' +
        '<div class="cbody dre-scroll">' + (buscando
          ? '<div class="dre-buscando">Buscando…</div>'
          : '<table class="dre-table dre-tano">' +
              '<thead><tr>' + thsA + '</tr></thead>' +
              '<tbody>' + trsA + '</tbody>' +
              '<tfoot>' + tfootA + '</tfoot>' +
            '</table>') +
        '</div>' +
      '</div>';

    body.innerHTML = kpis + cardAno + cardTab +
      avisoProjecao(hoje, nDias, proj, base3, fechados);

    // Só liga o balão quando há SVG: o card pode existir sem desenho.
    if (svgAno) {
      ligarTooltipGrafico(fatias, {
        // No gráfico ANUAL, a barra leva ao dia a dia daquele mês. No diário
        // não há para onde ir — a fatia já é um dia.
        aoClicar: porDia ? null : function (l) {
          if (podeAbrirDia(l)) window.__dreMesIr(l.chave);
        },
        // No modo diário o título já traz o dia da semana (ver `tituloLongo`).
        titulo: function (l) { return l.tituloLongo; },
        // Litros SEMPRE no balão, seja qual for a métrica no eixo: quem toca
        // uma barra quer a fatia inteira, não só o que está no eixo.
        extra: function (l) { return [{ rot: 'Litros', val: fmtL(l.litros) }]; },
        nota: function (l) {
          if (l.tipo === 'real') {
            return porDia ? 'realizado'
              : 'realizado · ' + l.dias + ' dia(s) · clique para ver dia a dia';
          }
          if (l.tipo === 'parcial') {
            return 'parcial: ' + l.dias + ' dia(s) · clique para ver dia a dia';
          }
          if (l.tipo === 'proj' && l.mes === mesNum && !porDia) {
            return 'PROJETADO de ' + l.dias + ' dia(s)';
          }
          if (l.tipo === 'proj') return 'PROJETADO (média de ' + l.baseN + ' fechado(s))';
          return l.situacao === 'a vir' ? 'dia ainda não chegou' : 'sem dado importado';
        },
      });
    }
  }

  // Fatia do gráfico ANUAL que tem dia a dia para abrir: mês REALIZADO ou
  // PARCIAL. Mês projetado não tem dias (é uma média), e mês sem importação
  // não tem nada — abrir o diário deles mostraria uma tela vazia sem motivo.
  function podeAbrirDia(l) {
    return !!l && (l.tipo === 'real' || l.tipo === 'parcial') && !!l.chave;
  }

  // Média de uma métrica sobre um conjunto de fatias REALIZADAS.
  // Margem é RAZÃO: (Σ lucro)/(Σ venda), nunca média das margens — um mês
  // pequeno com margem alta puxaria a média sem ter puxado a rede.
  function mediaMetrica(fatias, met) {
    if (!fatias.length) return null;
    if (met.razao) {
      var t = somarFatias(fatias);
      return t.margem_pct;
    }
    var comValor = fatias.filter(function (f) { return numOuNull(f[met.chave]) !== null; });
    if (!comValor.length) return null;
    return comValor.reduce(function (a, f) { return a + Number(f[met.chave]); }, 0) / comValor.length;
  }

  // Card "vs. mês anterior fechado". Fora do renderProjecao só para o bloco de
  // KPIs caber numa expressão legível.
  function kpiVsMesAnterior(mesAnt, proj) {
    if (mesAnt && proj && mesAnt.lucro !== 0) {
      // Math.abs no DENOMINADOR, de propósito: com um mês anterior de
      // PREJUÍZO, dividir pelo valor com sinal inverteria a leitura — sair de
      // -163 mil para -152 mil é melhora, e apareceria como queda. Com o
      // módulo embaixo, o sinal do resultado é o sinal da melhora.
      var dvs = (proj.lucro - mesAnt.lucro) / Math.abs(mesAnt.lucro) * 100;
      var dv = Math.round(dvs * 10) / 10;
      var cvs = dv > 0 ? ' pos' : (dv < 0 ? ' neg' : '');
      var svs = dv > 0 ? '▲' : (dv < 0 ? '▼' : '=');
      var mn = Number(mesAnt.mes.slice(5, 7)) - 1;
      return '<div class="kbox">' +
        '<div class="klbl">vs. ' + esc(MESES_CURTO[mn]) + ' fechado</div>' +
        '<div class="kval' + cvs + '">' + (dv === 0 ? '=' : svs + ' ' + nf(Math.abs(dv), 1) + '%') + '</div>' +
        '<div class="kfaixa">lucro projetado vs. fechado</div>' +
        '<div class="kmini" title="' + esc(MESES_LONGO[mn]) +
          ' fechou com ' + esc(fmtRS(mesAnt.lucro)) + ' em ' + mesAnt.dias + ' dia(s) com dado.">' +
          'fechou em ' + fmtRS(mesAnt.lucro) + '</div>' +
      '</div>';
    }
    var mesNum = Number(hojeISO().slice(5, 7));
    return '<div class="kbox">' +
      '<div class="klbl">vs. mês anterior</div>' +
      '<div class="kval">—</div>' +
      '<div class="kmini">' +
        (!mesAnt
          ? (mesNum === 1
              ? 'janeiro: não há mês fechado neste ano'
              : 'nenhum mês anterior tem dado importado')
          : (!proj ? 'sem projeção do mês para comparar' : 'mês anterior fechou em zero')) +
      '</div>' +
    '</div>';
  }

  // AVISO do rodapé da aba. OBRIGATÓRIO: montado sempre, com tudo que a
  // projeção assume. Extraído do render para não se perder no meio dele.
  function avisoProjecao(hoje, nDias, proj, base3, fechados) {
    var itens = [];
    itens.push('A projeção do mês usa <b>' + nDias + ' dia(s) com dado</b> de ' +
      diasNoMes(hoje) + ' do mês' +
      (proj ? ' — média diária × ' + proj.diasDoMes + ' dias, sem sazonalidade nem tendência.'
            : ' — menos de ' + MIN_DIAS_PROJ + ', então a projeção do mês está OMITIDA.'));
    itens.push(base3
      ? 'A projeção dos meses futuros é a <b>média simples dos últimos ' + base3.n +
        ' mês(es) fechado(s)</b> (' +
        base3.meses.map(function (m) { return MESES_CURTO[Number(m.slice(5, 7)) - 1]; }).join(', ') +
        ')' + (base3.n < 3 ? ' — menos de 3, porque só há esses com dado.' : '.')
      : 'Não há <b>nenhum mês fechado com dado</b> neste ano, então não há projeção anual.');
    itens.push('<b>Margem % não é somada nem tirada por média de margens</b>: venda e custo ' +
      'são projetados separados e só então divididos. Margem é razão — a média das margens ' +
      'mensais daria peso igual a um mês grande e a um mês pequeno.');
    itens.push('<b>Litros</b> conta as categorias medidas em litro — COMBUSTIVEIS e as ' +
      'vendidas a granel. As outras são vendidas por unidade e ficam FORA dessa soma: ' +
      'somar as duas não produziria grandeza nenhuma. "FILTRO DE COMBUSTIVEL" tem a ' +
      'palavra no nome mas é unidade, e não entra.');
    itens.push('O custo vem de <b>planilha importada à mão</b> (o .xls de categoria da TecnoX): ' +
      'dia sem importação NÃO entra em nenhuma conta desta aba — nem no numerador, nem na ' +
      'contagem de dias. Mês fechado sem importação aparece sem barra, não como zero.');
    itens.push('<b>Lucro aqui é BRUTO</b>: venda líquida − custo de compra. Não existe no banco ' +
      'despesa operacional, taxa de cartão nem frete, e esta tela não estima nenhum dos três.');
    if (proj && proj.faixa !== null) {
      itens.push('A faixa <b>±</b> é o desvio padrão do que foi observado nos dias com dado, ' +
        'projetado no mês — cada métrica com a dispersão da SUA grandeza: margem para o ' +
        'lucro, venda líquida para o faturamento, litragem para os litros. É dispersão ' +
        'observada, <b>não</b> intervalo de confiança: ela supõe o desvio persistindo o mês ' +
        'inteiro, que é o caso pessimista.');
    }
    var lacTotal = (_dadosPAno.totais && _dadosPAno.totais.custo_desconhecido) || null;
    if (lacTotal && lacTotal.linhas) {
      itens.push(lacTotal.linhas + ' lançamento(s) do ano vieram <b>sem custo</b> no arquivo (' +
        fmtRS(lacTotal.venda_liquida) + ' de venda líquida). A venda deles conta; o custo não, ' +
        'então o lucro acima é otimista nessa medida.');
    }
    // Litragem ausente. Hoje o único motivo plausível é a API ainda não
    // devolver o campo `litros` (deploy pendente) — e nesse caso falta em
    // TODOS os meses de uma vez. Onde falta, sai "—" e os totais também, em
    // vez de um número menor que a realidade.
    var semLitro = fechados.filter(function (m) { return numOuNull(m.litros) === null; }).length;
    if (semLitro) {
      itens.push('<b>Litragem indisponível</b> em ' + semLitro + ' mês(es) — a rota não ' +
        'devolveu o campo `litros` para eles. Onde falta, o litro sai como "—", e os ' +
        'totais também, em vez de um número menor que a realidade. Os valores em ' +
        'dinheiro não são afetados.');
    }
    return '<div class="dre-aviso-proj">' +
      '<b>Como estes números foram calculados</b>' +
      '<ul>' + itens.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
    '</div>';
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
