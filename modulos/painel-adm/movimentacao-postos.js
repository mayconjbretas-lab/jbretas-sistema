// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/movimentacao-postos.js
// Vista "Por posto" da aba Relatórios. ADITIVO: expõe
// window.renderMovPostos(section), chamado pelo relAbrir() — mesmo padrão do
// renderMovMes / renderDre.
//
// COMPARTILHADO entre o painel-adm (desktop) e o modulos/admin (celular),
// como o movimentacao-mes.js e o dre.js. Um arquivo, um modo por largura.
//
// FONTE: GET /tecnox/movimentacao-postos?inicio&fim (guard ADM ou LOGISTICA),
// UMA chamada por mudança de período. A rota já devolve posto × dia × canal
// agregado; esta tela só formata. Nada é somado aqui que a rota já tenha
// somado — exceto os recortes do filtro de convênio, que são seleção e não
// re-agregação.
//
// ════════ PERCENTUAL É SEMPRE SOBRE LITROS ════════
// Nunca sobre R$. Soutag e 99 têm preço por litro diferente da pista (é o
// ponto do convênio), então a participação em dinheiro e em volume divergem —
// e "42% da venda" precisa querer dizer uma coisa só. R$ aparece no detalhe,
// rotulado, nunca como base de percentual.
//
// ════════ NÚMEROS SEM ABREVIAR ════════
// O movimentacao-mes.js tem fmtLCurto/fmtRSCurto, que viram "3,7 mi L". Aqui
// NÃO se usa nenhum dos dois: esta tela é de conferência posto a posto, e
// "266 mil L" não fecha com nada quando alguém soma na calculadora. Litros
// saem inteiros com separador pt-BR. Reusa só o nf() e o esc() de lá, via
// window.mmFmt.
// ================================================================
(function () {
  'use strict';

  var PRIMEIRO_DIA = '2026-06-25';   // início do rollup TecnoX
  var MAX_DIAS = 62;                 // mesmo teto da rota
  var CANAIS = ['SOUTAG', '99', 'NORMAL'];
  var ROTULO = { SOUTAG: 'Soutag', '99': 'App 99', NORMAL: 'Pista' };

  var _sec = null;
  var _pronto = false;
  var _dados = null;
  var _carregando = false;
  var _erro = '';
  var _seq = 0;
  var _inicio = '';
  var _fim = '';
  var _filtro = { SOUTAG: false, '99': false };   // nenhum ligado = modo pista
  var _cardAberto = null;    // 'total' | 'abast' | 'SOUTAG' | '99' | null
  var _postoAberto = null;   // posto_id

  // ════════ PROJEÇÃO ════════
  // Regra de três e nada mais: o que o mês já vendeu, dividido pelos dias
  // que venderam, vezes os dias do mês. NÃO é previsão — não olha
  // sazonalidade, nem dia de semana, nem feriado. Um mês que começou com
  // três segundas fracas projeta baixo, e está certo que projete: o número
  // é "neste ritmo, fecha em X", não "vai fechar em X".
  //
  // SÓ VALORES ABSOLUTOS SOBEM. Razão nenhuma é multiplicada — e não por
  // uma lista de exceções, mas porque razão é divisão de dois números que
  // sobem pelo MESMO fator: mix, ticket, R$/L, % de Soutag, todos saem
  // idênticos ao período base. A única razão guardada pronta na resposta é
  // `dre.margem_pct`, e essa fica intocada de propósito.
  //
  // DOIS FATORES, porque são duas fontes com cobertura diferente: a venda
  // vem da tecnox_venda_dia e o lucro da tecnox_categoria_dia, e em
  // 14/09/2026 uma ia até 13/09 e a outra até 14/09. Um fator só faria o
  // lucro projetado usar dias que ele não tem.
  //
  // O FATOR DO LUCRO É O DA REDE, também por posto. Cada posto com o seu
  // daria a 37 linhas 37 bases diferentes, e somá-las não daria a rede.
  var _projecao = false;
  var _proj = null;     // {diasMes, diasVenda, diasLucro, fator, fatorLucro, mes}
  var _vista = null;    // _dados, ou a cópia projetada dele

  // ── Formatação ───────────────────────────────────────────────────
  // nf e esc vêm do movimentacao-mes.js (window.mmFmt). O fallback existe
  // porque a ordem dos <script> é do HTML, e uma tela não pode quebrar por
  // causa de uma tag movida de lugar.
  function nf(v, casas) {
    if (window.mmFmt && window.mmFmt.nf) return window.mmFmt.nf(v, casas);
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  function esc(s) {
    if (window.mmFmt && window.mmFmt.esc) return window.mmFmt.esc(s);
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function brData(iso) {
    if (window.mmFmt && window.mmFmt.brData) return window.mmFmt.brData(iso);
    if (!iso || String(iso).length < 10) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  // Litros INTEIROS com separador. Ver o cabeçalho: nada de "mil"/"mi".
  function litros(v) {
    return Number.isFinite(Number(v)) ? nf(Math.round(Number(v)), 0) + ' L' : '—';
  }
  function reais(v) {
    return Number.isFinite(Number(v)) ? 'R$ ' + nf(Number(v), 2) : '—';
  }
  // SEM o prefixo, só para a COLUNA da lista. Com 70px de largura, o "R$ "
  // empurrava o valor para a segunda linha e a célula ficava mais alta que as
  // vizinhas. O cabeçalho da coluna já diz LUCRO, e o card e o detalhe
  // continuam com o prefixo, onde há espaço.
  // R$ MENOR E COLADO, só nos cards de dinheiro. Com o prefixo no mesmo
  // tamanho do número, "R$ 290.499,01" a 18px não cabia nos 150px do card e
  // quebrava em duas linhas — e card com duas alturas na mesma fila é o que
  // faz a fila inteira parecer desalinhada.
  function reaisCard(v) {
    if (!Number.isFinite(Number(v))) return '—';
    return '<span class="mp-rs">R$</span>' + nf(Number(v), 2);
  }
  function reaisSemPrefixo(v) {
    return Number.isFinite(Number(v)) ? nf(Number(v), 2) : '—';
  }
  // dd/mm, sem o ano. A frase vive dentro de um período que o usuário
  // acabou de escolher no filtro; repetir o ano ali não informa nada.
  function diaMes(iso) {
    if (!iso || String(iso).length < 10) return '';
    return String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7);
  }
  // Margem com DUAS casas, como o relatório TecnoX imprime. O pctTxt tem
  // uma só porque mede litro; aqui o número precisa bater dígito a dígito
  // com a coluna Lucro % do arquivo — 16,02%, não 16,0%.
  function pctDec(v) {
    return Number.isFinite(Number(v)) ? nf(Number(v), 2) + '%' : '—';
  }
  function pct(parte, todo) {
    if (!Number.isFinite(Number(todo)) || Number(todo) <= 0) return null;
    return Number(parte) / Number(todo) * 100;
  }
  function pctTxt(parte, todo) {
    var p = pct(parte, todo);
    return p === null ? '—' : nf(p, 1) + '%';
  }
  // Litros por abastecimento: a medida que diz se o posto vende volume ou
  // movimento. Sem abastecimento não há divisão — devolve travessão, não 0.
  function porAbast(l, n) {
    return (n > 0) ? nf(Number(l) / n, 1) + ' L por abast.' : '—';
  }

  // ── Datas ────────────────────────────────────────────────────────
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function somaDias(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function diasEntre(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
  }
  // Dia 0 do mês seguinte é o último do mês pedido — pega fevereiro
  // bissexto sem tabela.
  function diasNoMes(iso) {
    return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
  }
  var MES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO',
                   'SET', 'OUT', 'NOV', 'DEZ'];
  function mesRotulo(iso) {
    return MES_ABREV[Number(iso.slice(5, 7)) - 1] + '/' + iso.slice(0, 4);
  }

  // ── Seleção do filtro ────────────────────────────────────────────
  // Um lugar só decide o que a tela está mostrando. Sem isto, "modo pista"
  // vira um if espalhado por seis funções e uma delas esquece.
  function canaisLigados() {
    return CANAIS.filter(function (c) { return _filtro[c]; });
  }
  function modoPista() { return canaisLigados().length === 0; }

  // ════════ ORDENAR É A MESMA AÇÃO DE ABRIR A CONTA ════════
  // Um estado só (_cardAberto) faz as duas coisas: o card aberto mostra a
  // conta dele E ordena a lista por aquele valor. Clicar de novo solta os
  // dois. Dois estados separados (um "aberto", um "ordenando") podiam
  // divergir — card de Mix aberto com a lista ordenada por Soutag — e aí a
  // tela mente sobre o que está mostrando.
  //
  // Abastecimentos e Ticket abrem a conta mas NÃO ordenam: os dois são
  // médias da rede, e ranquear posto por média de abastecimento responde uma
  // pergunta que ninguém fez nesta tela.
  var ORDENAVEIS = ['total', 'SOUTAG', '99', 'produto', 'mix', 'lucro'];
  function ordemAtiva() {
    return ORDENAVEIS.indexOf(_cardAberto) >= 0 ? _cardAberto : null;
  }
  // Mix de um posto (fração, não %). Posto sem gasolina devolve null — e no
  // sort ele afunda, em vez de virar 0 e disputar com quem vendeu e não
  // aditivou.
  function mixDe(p) {
    var g = p.gasolina || { litros_total: 0, litros_aditivada: 0 };
    return g.litros_total > 0 ? g.litros_aditivada / g.litros_total : null;
  }
  function produtoDe(p) { return (p.produto && p.produto.faturamento) || 0; }
  // ════════ O LUCRO VEM DO ARQUIVO, NÃO DE UMA ESTIMATIVA ════════
  // Era valor_liquido − litros × custo_avista, sobre a planilha de custo.
  // Agora é o bloco `dre` da rota: venda líquida menos custo, TODAS as
  // categorias, a mesma agregação do GET /dre. Por posto é o "Total
  // Empresa" do relatório TecnoX; na rede, o "Total Geral" — os números
  // que o supervisor tem impressos na mão.
  //
  // Saiu junto tudo que falava de custo defasado: não existe mais custo
  // defasado nesta tela, porque não existe mais planilha nesta tela.
  //
  // NULL, E NÃO ZERO, quando o arquivo ainda não cobre o posto. Zero o
  // poria no meio da lista, entre quem lucrou pouco e quem teve prejuízo;
  // null afunda no sort e a célula mostra travessão.
  function dreDe(p) {
    var d = p.dre || null;
    return (d && d.lucro !== null && d.lucro !== undefined) ? d : null;
  }
  function lucroDe(p) { var d = dreDe(p); return d ? d.lucro : null; }
  function appDe(p) {
    var quais = modoPista() ? ['SOUTAG', '99'] : canaisLigados().filter(function (c) { return c !== 'NORMAL'; });
    return quais.reduce(function (s, c) { return s + ((p.por_canal[c] && p.por_canal[c].litros) || 0); }, 0);
  }
  function valorOrdem(p, qual) {
    if (qual === 'total') return p.litros;
    if (qual === 'produto') return produtoDe(p);
    if (qual === 'mix') { var m = mixDe(p); return m === null ? -1 : m; }
    // -Infinity, e não -1: lucro pode ser NEGATIVO, e -1 poria o posto sem
    // dado acima de quem teve prejuízo de verdade.
    if (qual === 'lucro') { var lv = lucroDe(p); return lv === null ? -Infinity : lv; }
    return (p.por_canal[qual] && p.por_canal[qual].litros) || 0;
  }
  // Valor que ordena a lista e que a linha mostra: litros do(s) convênio(s)
  // ligado(s), ou o total do posto quando nenhum está.
  function valorDe(p) {
    if (modoPista()) return p.litros;
    return canaisLigados().reduce(function (s, c) {
      return s + ((p.por_canal[c] && p.por_canal[c].litros) || 0);
    }, 0);
  }

  // ── Projeção ─────────────────────────────────────────────────────
  // Dias DISTINTOS com litro no período, da rede. Vem do por_dia, que a
  // rota manda e esta tela não desenha — é o único lugar que sabe QUAIS
  // dias venderam. Dividir pelos dias do período contaria o domingo que
  // não abriu como dia fraco, e a projeção sairia baixa.
  function diasComVenda(d) {
    var set = {};
    (d.postos || []).forEach(function (p) {
      (p.por_dia || []).forEach(function (x) { if (x.litros > 0) set[x.data] = 1; });
    });
    return Object.keys(set).length;
  }
  // Copia rasa + os campos absolutos multiplicados. `abastecimentos` NÃO é
  // arredondado aqui: o ticket é faturamento ÷ abastecimentos, e arredondar
  // só um dos dois mexeria numa razão que tem de sair idêntica. Quem
  // arredonda é o nf() na hora de escrever.
  function escalarDre(dre, fL) {
    if (!dre) return dre;
    var o = {}; for (var k in dre) o[k] = dre[k];
    if (fL === null || dre.lucro === null || dre.lucro === undefined) return o;
    // quantidade_comb entra na lista porque é o DENOMINADOR do R$/litro do
    // card. Escalar o lucro e deixar os litros parados mudaria uma razão.
    ['venda_bruta', 'desconto', 'venda_liquida', 'custo_total', 'lucro',
     'quantidade_comb'].forEach(function (k) {
      if (typeof o[k] === 'number') o[k] = o[k] * fL;
    });
    // margem_pct, dias_com_dado, dias_periodo e ultimo_dia ficam como vieram.
    return o;
  }
  function escalarBloco(b, f, fL) {
    var o = {}; for (var k in b) o[k] = b[k];
    o.litros = b.litros * f;
    o.faturamento = b.faturamento * f;
    o.abastecimentos = b.abastecimentos * f;
    o.por_canal = {};
    for (var c in b.por_canal) {
      var x = b.por_canal[c];
      o.por_canal[c] = { litros: x.litros * f, faturamento: x.faturamento * f,
                         abastecimentos: x.abastecimentos * f };
    }
    o.produto = { faturamento: ((b.produto && b.produto.faturamento) || 0) * f };
    var g = b.gasolina || { litros_total: 0, litros_aditivada: 0 };
    o.gasolina = { litros_total: g.litros_total * f, litros_aditivada: g.litros_aditivada * f };
    o.dre = escalarDre(b.dre, fL);
    return o;
  }
  // Define _vista e _proj. Sem dia com venda não há base: a projeção fica
  // desligada em silêncio, porque dividir por zero não é projetar por zero.
  function prepararVista() {
    _vista = _dados; _proj = null;
    if (!_projecao || !_dados || !_dados.postos || !_dados.postos.length) return;
    var diasV = diasComVenda(_dados);
    if (!diasV) return;
    var dreRede = _dados.rede.dre || {};
    var diasL = dreRede.dias_com_dado || 0;
    var diasM = diasNoMes(_inicio);
    var f = diasM / diasV;
    var fL = diasL > 0 ? diasM / diasL : null;
    _proj = { diasMes: diasM, diasVenda: diasV, diasLucro: diasL,
              fator: f, fatorLucro: fL, mes: mesRotulo(_inicio) };
    _vista = {
      success: _dados.success, consulta: _dados.consulta,
      rede: escalarBloco(_dados.rede, f, fL),
      postos: _dados.postos.map(function (p) { return escalarBloco(p, f, fL); }),
    };
    // por_combustivel não é reescalado: ele vive dentro da rede e o
    // escalarBloco o copiou por referência. Sobe junto aqui, para o detalhe
    // do card Total não mostrar litros de combustível menores que o total.
    _vista.rede.por_combustivel = (_dados.rede.por_combustivel || []).map(function (k) {
      return { codigo: k.codigo, rotulo: k.rotulo, litros: k.litros * f };
    });
  }

  // ── Carga ────────────────────────────────────────────────────────
  async function carregar() {
    _carregando = true; _erro = ''; pintar();
    // Trocar o período duas vezes depressa dispara duas buscas; sem o selo a
    // PRIMEIRA resposta a chegar pinta, e ela pode ser a do período antigo.
    var meu = ++_seq;
    try {
      var url = '/tecnox/movimentacao-postos?inicio=' + encodeURIComponent(_inicio) +
                '&fim=' + encodeURIComponent(_fim);
      var r = await apiFetch(url);
      if (meu !== _seq) return;
      _dados = r;
    } catch (e) {
      if (meu !== _seq) return;
      _dados = null;
      _erro = (e && e.message) ? e.message : 'Falha ao carregar';
    } finally {
      if (meu === _seq) { _carregando = false; pintar(); }
    }
  }

  // ── Ações (onclick inline, padrão do módulo) ─────────────────────
  // PROJEÇÃO CAI EM QUALQUER MEXIDA. O botão amarra um período específico
  // (o mês corrente até ontem); mudar chip, data ou atalho desfaz essa
  // amarração, e deixar a projeção ligada mostraria números multiplicados
  // por um fator que não é mais o daquele recorte.
  window.__mpCanal = function (c) {
    _filtro[c] = !_filtro[c];
    _projecao = false;
    _cardAberto = null;
    pintar();     // filtro é recorte do que já veio: NÃO refaz a chamada
  };
  window.__mpPeriodo = function (qual, valor) {
    if (qual === 'inicio') _inicio = valor;
    if (qual === 'fim') _fim = valor;
    _projecao = false;
    if (!_inicio || !_fim) return;
    if (_fim < _inicio) { _erro = 'Fim anterior ao início.'; _dados = null; pintar(); return; }
    if (diasEntre(_inicio, _fim) > MAX_DIAS) {
      _erro = 'Período muito longo: máximo ' + MAX_DIAS + ' dias.'; _dados = null; pintar(); return;
    }
    _cardAberto = null; _postoAberto = null;
    carregar();
  };
  window.__mpAtalho = function (qual) {
    var ontem = somaDias(hojeISO(), -1);
    if (qual === 'ontem') { _inicio = ontem; _fim = ontem; }
    if (qual === '7') { _fim = ontem; _inicio = somaDias(ontem, -6); }
    _projecao = false;
    _cardAberto = null; _postoAberto = null;
    carregar();
  };
  // Liga a projeção E amarra o período ao mês corrente: projetar "os
  // últimos 7 dias" para 30 seria multiplicar uma semana por quatro e
  // chamar de mês. Se o fim já está dentro do mês corrente, é respeitado.
  window.__mpProjecao = function () {
    if (_projecao) { _projecao = false; _cardAberto = null; pintar(); return; }
    var ontem = somaDias(hojeISO(), -1);
    var mesCorr = hojeISO().slice(0, 7);
    _fim = (_fim && _fim.slice(0, 7) === mesCorr && _fim <= ontem) ? _fim : ontem;
    _inicio = mesCorr + '-01';
    _projecao = true;
    _cardAberto = null; _postoAberto = null;
    carregar();
  };
  window.__mpCard = function (id) {
    _cardAberto = (_cardAberto === id) ? null : id;
    pintar();
  };
  window.__mpPosto = function (id) {
    _postoAberto = (_postoAberto === id) ? null : id;
    pintar();
  };

  // ── Shell ────────────────────────────────────────────────────────
  function montarShell(sec) {
    sec.innerHTML = '<div class="mp-wrap"><div id="mp-corpo"></div></div>';
    _pronto = true;
  }

  function htmlFiltros() {
    var chip = function (c) {
      return '<button type="button" class="mp-chip' + (_filtro[c] ? ' on' : '') +
        ' mp-chip-' + (c === '99' ? '99' : 'so') + '"' +
        ' aria-pressed="' + (_filtro[c] ? 'true' : 'false') + '"' +
        ' onclick="__mpCanal(\'' + c + '\')">' + esc(ROTULO[c]) + '</button>';
    };
    return '<div class="mp-filtros">' +
      '<div class="mp-chips">' + chip('SOUTAG') + chip('99') + '</div>' +
      '<div class="mp-datas">' +
        '<label>de <input type="date" class="mp-data" value="' + esc(_inicio) + '"' +
          ' min="' + PRIMEIRO_DIA + '" onchange="__mpPeriodo(\'inicio\', this.value)"></label>' +
        '<label>até <input type="date" class="mp-data" value="' + esc(_fim) + '"' +
          ' min="' + PRIMEIRO_DIA + '" onchange="__mpPeriodo(\'fim\', this.value)"></label>' +
      '</div>' +
      '<div class="mp-atalhos">' +
        '<button type="button" class="mp-atalho" onclick="__mpAtalho(\'ontem\')">Ontem</button>' +
        '<button type="button" class="mp-atalho" onclick="__mpAtalho(\'7\')">7 dias</button>' +
        '<button type="button" class="mp-atalho' + (_projecao ? ' on' : '') + '"' +
          ' aria-pressed="' + (_projecao ? 'true' : 'false') + '"' +
          ' onclick="__mpProjecao()">Projeção</button>' +
      '</div>' +
    '</div>';
  }

  // A CONTA FICA À VISTA. Um número projetado sem a régra de três ao lado é
  // indistinguível de um número medido, e quem abrir a tela no dia 3 vai ler
  // a projeção de dez vezes o que se vendeu como se fosse venda.
  function htmlProjInfo() {
    if (!_proj) return '';
    // Mesmo mês nos dois extremos: o mês é dito UMA vez, no fim — "01–13/09",
    // não "01/09–13/09". A projeção quase sempre roda dentro de um mês só.
    var mesmoMes = _inicio.slice(0, 7) === _fim.slice(0, 7);
    var periodo = (mesmoMes ? _inicio.slice(8, 10) : diaMes(_inicio)) + '–' + diaMes(_fim);
    var txt = 'PROJEÇÃO ' + _proj.mes + ' · base ' + periodo +
      ' (' + _proj.diasVenda + ' dia' + (_proj.diasVenda === 1 ? '' : 's') + ') × ' +
      _proj.diasMes + '/' + _proj.diasVenda;
    // A BASE DO LUCRO É DITA SEMPRE, mesmo quando é a mesma da venda. Omiti-la
    // nesse caso pareceria economia, mas deixaria o leitor sem saber se a
    // ausência quer dizer "mesma base" ou "não foi mostrado" — e são as duas
    // fontes dessincronizadas que tornam a pergunta razoável.
    if (_proj.fatorLucro === null) {
      txt += ' · sem lucro no arquivo, sem projeção de lucro';
    } else {
      txt += ' · lucro base ' + _proj.diasLucro + ' dia' + (_proj.diasLucro === 1 ? '' : 's');
    }
    return '<div class="mp-proj">' + esc(txt) + '</div>';
  }

  // ── Cards da rede ────────────────────────────────────────────────
  // Oito cards, mesmo tamanho e mesmo estilo. Os quatro primeiros são os
  // originais, byte por byte; os quatro novos entram à direita.
  //
  // A SETA "↓" SOZINHA marca o card que está ordenando. Sem texto ("ordenado
  // por…") de propósito: o card já é o rótulo, e a frase repetiria o que a
  // seta diz num espaço que não existe.
  function setaOrd(id) {
    return ordemAtiva() === id ? '<span class="mp-seta">↓</span>' : '';
  }

  function cardConvenio(c) {
    var r = _vista.rede;
    var x = r.por_canal[c] || { litros: 0, faturamento: 0, abastecimentos: 0 };
    var ligado = !!_filtro[c];
    // COM o filtro ligado o número grande é o PERCENTUAL — é a pergunta que
    // o chip fez ("quanto do volume passou por aqui?"). Desligado, o card vira
    // informativo e mostra litros, para não competir com o total.
    var grande = ligado
      ? '<div class="mp-num mp-card-valor">' + pctTxt(x.litros, r.litros) + '</div>' +
        '<div class="mp-ao-lado">' + litros(x.litros) + '</div>'
      : '<div class="mp-num mp-card-valor">' + litros(x.litros) + '</div>';
    return '<button type="button" class="mp-card mp-card-' + (c === '99' ? '99' : 'so') +
      (ligado ? ' on' : '') + (_cardAberto === c ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === c ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'' + c + '\')">' + setaOrd(c) +
      '<div class="mp-rot">' + esc(ROTULO[c]).toUpperCase() + '</div>' +
      grande +
      '<div class="mp-sub">' + nf(x.abastecimentos, 0) + ' abast.</div>' +
    '</button>';
  }

  function htmlCards() {
    var r = _vista.rede;
    var ab = r.abastecimentos || 0;
    var prod = (r.produto && r.produto.faturamento) || 0;
    var gas = r.gasolina || { litros_total: 0, litros_aditivada: 0 };

    var cardTotal = '<button type="button" class="mp-card mp-card-total' +
      (_cardAberto === 'total' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'total' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'total\')">' + setaOrd('total') +
      '<div class="mp-rot">REDE · TOTAL PISTA</div>' +
      '<div class="mp-num mp-card-valor">' + litros(r.litros) + '</div>' +
      '<div class="mp-sub">' + nf(ab, 0) + ' abast.</div>' +
    '</button>';

    var cardAbast = '<button type="button" class="mp-card mp-card-abast' +
      (_cardAberto === 'abast' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'abast' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'abast\')">' +
      '<div class="mp-rot">ABASTECIMENTOS</div>' +
      '<div class="mp-num mp-card-valor">' + nf(ab, 0) + '</div>' +
      '<div class="mp-sub">' + porAbast(r.litros, ab) + '</div>' +
    '</button>';

    // TICKET: três medidas do MESMO denominador (abastecimentos), empilhadas.
    // Não ordena a lista — ver o comentário do ORDENAVEIS.
    var tk = function (rot, val) {
      return '<div class="mp-tk mp-card-valor"><span>' + esc(rot) + '</span><b>' + val + '</b></div>';
    };
    var cardTicket = '<button type="button" class="mp-card mp-card-ticket' +
      (_cardAberto === 'ticket' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'ticket' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'ticket\')">' +
      '<div class="mp-rot">TICKET MÉDIO · CARRO</div>' +
      '<div class="mp-tks">' +
        tk('vol', ab > 0 ? nf(r.litros / ab, 1) + ' L' : '—') +
        tk('R$', ab > 0 ? nf(r.faturamento / ab, 2) : '—') +
        tk('produto', ab > 0 ? reais(prod / ab) : '—') +
      '</div>' +
    '</button>';

    var cardProduto = '<button type="button" class="mp-card mp-card-prod' +
      (_cardAberto === 'produto' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'produto' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'produto\')">' + setaOrd('produto') +
      '<div class="mp-rot">VENDA DE PRODUTO</div>' +
      '<div class="mp-num mp-card-valor">' + reaisCard(prod) + '</div>' +
      '<div class="mp-sub">' + (ab > 0 ? reais(prod / ab) + ' por carro' : '—') + '</div>' +
    '</button>';

    // MIX: a MESMA definição do Relatórios (aditivada ÷ gasolina), agora
    // vinda pronta da rota — GA, Octapro e Podium contam como aditivada.
    var cardMix = '<button type="button" class="mp-card mp-card-mix' +
      (_cardAberto === 'mix' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'mix' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'mix\')">' + setaOrd('mix') +
      '<div class="mp-rot">MIX G. ADITIVADA</div>' +
      '<div class="mp-num mp-card-valor">' + pctTxt(gas.litros_aditivada, gas.litros_total) + '</div>' +
      '<div class="mp-sub">' + litros(gas.litros_aditivada) + ' aditivada</div>' +
    '</button>';

    // LUCRO BRUTO = o "Total Geral" do arquivo TecnoX. Duas linhas
    // empilhadas embaixo, com o mesmo `tk` do Ticket: o número sozinho não
    // diz se o lucro foi bom, e as duas medidas que dizem (por litro e
    // margem) cabem sem tocar nos 150×96 — o card tem altura fixa, e a
    // linha 1fr do meio é que cede o espaço.
    //
    // POR LITRO usa quantidade_comb, e NÃO a litragem da tela: o lucro vem
    // da tecnox_categoria_dia e dividir por litros da tecnox_venda_dia
    // misturaria duas importações no mesmo quociente. As duas divergem em
    // 0,01% num dia e 0,09% em treze — pouco, e ainda assim é a conta errada.
    var lu = _vista.rede.dre || null;
    var temLu = !!(lu && lu.lucro !== null && lu.lucro !== undefined);
    var cardLucro = '<button type="button" class="mp-card mp-card-lucro' +
      (_cardAberto === 'lucro' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'lucro' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'lucro\')">' + setaOrd('lucro') +
      '<div class="mp-rot">LUCRO BRUTO</div>' +
      '<div class="mp-num mp-card-valor">' + (temLu ? reaisCard(lu.lucro) : '—') + '</div>' +
      '<div class="mp-tks">' +
        tk('por litro', (temLu && lu.quantidade_comb > 0)
          ? reais(lu.lucro / lu.quantidade_comb) : '—') +
        tk('margem', temLu ? pctDec(lu.margem_pct) : '—') +
      '</div>' +
    '</button>';

    return '<div class="mp-cards">' +
      cardTotal + cardAbast + cardConvenio('SOUTAG') + cardConvenio('99') +
      // ORDEM = A DAS COLUNAS DA LISTA, nao a de criacao. A grade embaixo e
      // POSTO BARRA LITRAGEM COMBUSTIVEL APP MIX PRODUTO LUCRO, e os cards
      // tem a mesma largura e o mesmo gap — entao o card 6 fica exatamente
      // sobre a coluna 6. Com Produto antes de Mix, a coluna MIX caia sob o
      // card VENDA DE PRODUTO: alinhado ao pixel e trocado no rotulo, que e
      // pior do que nao alinhar nada.
      cardTicket + cardMix + cardProduto + cardLucro +
    '</div>' + htmlDetalheCard();
  }

  function htmlDetalheCard() {
    if (!_cardAberto) return '';
    var r = _vista.rede;
    var ab = r.abastecimentos || 0;
    var linha = function (rot, val) {
      return '<div class="mp-det-linha"><span>' + esc(rot) + '</span><b>' + val + '</b></div>';
    };
    // ── A REGRA DE TRÊS, ESCRITA ───────────────────────────────
    // O valor de partida vem de `_dados` (o medido), não de `_vista` (o
    // projetado): a linha existe para mostrar de onde o número saiu, e
    // partir do número já multiplicado não mostraria nada.
    //
    // Cards de RAZÃO não ganham a linha, ganham a frase — Ticket e Mix não
    // mudam com a projeção, e pôr uma multiplicação ao lado deles sugeriria
    // que mudam.
    var contaProjecao = function () {
      if (!_proj) return '';
      var b = _dados.rede;
      var f = _proj.fator, dias = _proj.diasVenda;
      var base, fmt;
      if (_cardAberto === 'total')      { base = b.litros; fmt = litros; }
      else if (_cardAberto === 'abast') { base = b.abastecimentos; fmt = function (v) { return nf(Math.round(v), 0); }; }
      else if (_cardAberto === 'produto') { base = (b.produto && b.produto.faturamento) || 0; fmt = reais; }
      else if (_cardAberto === 'lucro') {
        var d = b.dre || {};
        if (d.lucro === null || d.lucro === undefined || _proj.fatorLucro === null) {
          return linha('Projeção', 'sem lucro no arquivo — nada a projetar');
        }
        base = d.lucro; fmt = reais; f = _proj.fatorLucro; dias = _proj.diasLucro;
      }
      else if (_cardAberto === 'SOUTAG' || _cardAberto === '99') {
        base = (b.por_canal[_cardAberto] || { litros: 0 }).litros; fmt = litros;
      }
      else if (_cardAberto === 'ticket' || _cardAberto === 'mix') {
        return linha('Projeção', 'não muda: é razão, e as duas partes sobem juntas');
      }
      else return '';
      return linha('Projeção', fmt(base) + ' ÷ ' + dias + ' × ' + _proj.diasMes +
        ' = ' + fmt(base * f));
    };
    var corpo = contaProjecao();
    if (_cardAberto === 'total') {
      corpo += CANAIS.map(function (c) {
        var x = r.por_canal[c] || { litros: 0 };
        return linha(ROTULO[c], litros(x.litros) + '  ·  ' + pctTxt(x.litros, r.litros));
      }).join('') +
      '<div class="mp-det-sep">Litros por combustível</div>' +
      (r.por_combustivel || []).map(function (k2) {
        return linha(k2.rotulo, litros(k2.litros) + '  ·  ' + pctTxt(k2.litros, r.litros));
      }).join('');
    } else if (_cardAberto === 'abast') {
      corpo += CANAIS.map(function (c) {
        var x = r.por_canal[c] || { litros: 0, abastecimentos: 0 };
        return linha(ROTULO[c], nf(x.abastecimentos, 0) + ' abast.  ·  ' + porAbast(x.litros, x.abastecimentos));
      }).join('');
    } else if (_cardAberto === 'ticket') {
      corpo +=
        linha('Litros ÷ abastecimentos', litros(r.litros) + ' ÷ ' + nf(ab, 0) + ' = ' + (ab > 0 ? nf(r.litros / ab, 2) + ' L' : '—')) +
        linha('Faturamento ÷ abastecimentos', reais(r.faturamento) + ' ÷ ' + nf(ab, 0) + ' = ' + (ab > 0 ? reais(r.faturamento / ab) : '—')) +
        linha('Produto ÷ abastecimentos', reais((r.produto && r.produto.faturamento) || 0) + ' ÷ ' + nf(ab, 0) + ' = ' + (ab > 0 ? reais(((r.produto && r.produto.faturamento) || 0) / ab) : '—'));
    } else if (_cardAberto === 'produto') {
      var prod = (r.produto && r.produto.faturamento) || 0;
      corpo +=
        linha('Venda de produto no período', reais(prod)) +
        linha('Por abastecimento', ab > 0 ? reais(prod / ab) : '—') +
        linha('Sobre o faturamento de pista', pctTxt(prod, r.faturamento)) +
        linha('Fonte', 'tecnox_venda_produto_dia — mesma do Consolidado');
    } else if (_cardAberto === 'lucro') {
      // A conta na ORDEM DO ARQUIVO, de cima para baixo, para conferir
      // linha a linha contra o "Total Geral" impresso.
      var u = r.dre || null;
      if (!u || u.lucro === null || u.lucro === undefined) {
        corpo += linha('Sem dado', 'o arquivo TecnoX não cobre nenhum dia deste período');
      } else {
        corpo +=
          linha('Venda bruta', reais(u.venda_bruta)) +
          linha('Desconto', reais(u.desconto)) +
          linha('Venda líquida', reais(u.venda_liquida)) +
          linha('Custo total', reais(u.custo_total)) +
          linha('A conta', 'venda líquida − custo = ' + reais(u.lucro)) +
          linha('Margem', pctDec(u.margem_pct)) +
          linha('Por litro', u.quantidade_comb > 0
            ? reais(u.lucro / u.quantidade_comb) + ' / L  ·  ' + litros(u.quantidade_comb) + ' de combustível' : '—');
        // COBERTURA. Sem isto, um lucro de 1 dia apareceria do lado de uma
        // litragem de 7 como se fossem a mesma janela.
        //
        // A data vem da rota (`ultimo_dia`) e NÃO é deduzida do contador: o
        // buraco nem sempre está no fim. Medido em 01–13/09/2026, os três
        // postos com cobertura incompleta, e o que a dedução diria:
        //   P. ARAPONGA       12/13 dias   até 13/09   dedução diria 12/09
        //   P. BOMBOM MATRIZ  11/13 dias   até 12/09   dedução diria 11/09
        //   P. BAHAMAS        11/13 dias   até 12/09   dedução diria 11/09
        // Errada nos três. O P. ARAPONGA é o caso claro: falta o 11/09, no
        // meio, e o posto tem arquivo até o último dia do período.
        //
        // SOME quando a cobertura é completa: uma linha dizendo "até o último
        // dia do período" em toda tela normal treina o olho a ignorá-la, e aí
        // ela não avisa nada no dia em que importa.
        if (u.dias_com_dado < u.dias_periodo && u.ultimo_dia) {
          corpo += linha('Cobertura', 'dados do arquivo TecnoX até ' + diaMes(u.ultimo_dia));
        }
        corpo += linha('Fonte', 'tecnox_categoria_dia — a mesma conta do DRE');
      }
    } else if (_cardAberto === 'mix') {
      var g = r.gasolina || { litros_total: 0, litros_aditivada: 0 };
      corpo +=
        linha('Aditivada ÷ gasolina', litros(g.litros_aditivada) + ' ÷ ' + litros(g.litros_total) + ' = ' + pctTxt(g.litros_aditivada, g.litros_total)) +
        linha('Gasolina comum', litros(g.litros_total - g.litros_aditivada)) +
        linha('Definição', 'aditivada = GA + Octapro + Podium (igual ao Relatórios)');
    } else {
      var x2 = r.por_canal[_cardAberto] || { litros: 0, faturamento: 0, abastecimentos: 0 };
      corpo +=
        linha('Litros ÷ total da rede', litros(x2.litros) + ' ÷ ' + litros(r.litros) + ' = ' + pctTxt(x2.litros, r.litros)) +
        linha('Abastecimentos', nf(x2.abastecimentos, 0)) +
        linha('Litros por abastecimento', porAbast(x2.litros, x2.abastecimentos)) +
        linha('Faturamento do canal', reais(x2.faturamento));
    }
    return '<div class="mp-detalhe">' + corpo + '</div>';
  }

  // ── Lista por posto ──────────────────────────────────────────────
  // DUAS proporções encaixadas, e é isso que faz a barra dizer alguma coisa:
  //   o PREENCHIMENTO mede o posto contra o MAIOR da lista;
  //   os SEGMENTOS medem cada canal contra o total daquele posto.
  //
  // A barra continua sendo a venda TOTAL do posto, mesmo com convênio
  // filtrado: o filtro só apaga os segmentos de fora (opacidade .2). Encolher
  // a barra mudaria a leitura de "quanto este posto vende" para "quanto ele
  // vende no convênio", e as duas perguntas convivem na mesma tela.
  function htmlBarra(p, maior) {
    var ligados = canaisLigados();
    var cheio = pct(p.litros, maior);
    if (cheio === null) cheio = 0;
    var segs = CANAIS.map(function (c) {
      var x = p.por_canal[c] || { litros: 0 };
      var w = pct(x.litros, p.litros);
      if (w === null || w <= 0) return '';
      var apagado = (!modoPista() && ligados.indexOf(c) < 0) ? ' fora' : '';
      return '<span class="mp-seg mp-seg-' + (c === '99' ? '99' : c === 'SOUTAG' ? 'so' : 'pi') + apagado + '"' +
        ' style="width:' + w.toFixed(3) + '%" title="' + esc(ROTULO[c]) + ': ' + litros(x.litros) + '"></span>';
    }).join('');
    return '<div class="mp-barra" role="presentation">' +
      '<span class="mp-barra-fill" style="width:' + cheio.toFixed(3) + '%">' + segs + '</span>' +
    '</div>';
  }

  // ── Cabeçalho das colunas (só desktop; o CSS o esconde no mobile) ──
  function htmlCabecalho() {
    var h = function (cls, rot, id) {
      return '<span class="' + cls + '">' + esc(rot) + (id && ordemAtiva() === id ? ' ↓' : '') + '</span>';
    };
    return '<div class="mp-cab">' +
      h('mp-p-nome', 'POSTO') +
      h('mp-barra-cab', 'BARRA') +
      h('mp-p-litros', 'LITRAGEM', 'total') +
      h('mp-p-comb', 'COMBUSTÍVEL') +
      h('mp-p-pct', 'APP') +
      h('mp-p-mix', 'MIX', 'mix') +
      h('mp-p-prod', 'PRODUTO', 'produto') +
      h('mp-p-lucro', 'LUCRO', 'lucro') +
    '</div>';
  }

  // ════════ A COLUNA APP É UM NÚMERO SÓ ════════
  // (Soutag + 99) ÷ litros do posto. A quebra por aplicativo saiu da linha e
  // vive no detalhe clicável, que já mostrava Soutag / App 99 / Pista: dois
  // percentuais na linha competiam pelo mesmo lugar e nenhum dos dois era
  // legível de relance numa lista de 37.
  //
  // Sempre sobre o PRÓPRIO posto, nunca sobre a rede — a pergunta da linha é
  // "quanto da venda DESTE posto passou por aplicativo?".
  function htmlPosto(p, maior) {
    var v = valorDe(p);
    var aberto = _postoAberto === p.posto_id;
    var mostrar = modoPista() ? ['SOUTAG', '99'] : canaisLigados().filter(function (c) { return c !== 'NORMAL'; });
    var g = p.gasolina || { litros_total: 0, litros_aditivada: 0 };
    var prod = produtoDe(p);
    var ab = p.abastecimentos || 0;
    var ul = dreDe(p);

    var numero = '<span class="mp-p-litros">' + litros(p.litros) +
      (modoPista() ? '' : '<span class="mp-p-conv">' + litros(v) + ' ' +
        esc(mostrar.map(function (c) { return c === '99' ? '99' : 'Soutag'; }).join('+')) + '</span>') +
      '</span>';

    var det = '';
    if (aberto) {
      // Os três itens do fim existem para o MOBILE, onde as colunas de Mix,
      // Produto e Ticket não entram na linha. No desktop eles repetem a
      // coluna de propósito: o detalhe é a visão completa do posto, e quem o
      // abriu não deveria ter de voltar o olho para a linha.
      det = '<div class="mp-p-det">' + CANAIS.map(function (c) {
        var x = p.por_canal[c] || { litros: 0, faturamento: 0, abastecimentos: 0 };
        return '<div class="mp-det-linha"><span>' + esc(ROTULO[c]) + '</span><b>' +
          litros(x.litros) + '  ·  ' + pctTxt(x.litros, p.litros) + '  ·  ' +
          nf(x.abastecimentos, 0) + ' abast.  ·  ' + reais(x.faturamento) + '</b></div>';
      }).join('') +
        '<div class="mp-det-linha"><span>Mix g. aditivada</span><b>' +
          pctTxt(g.litros_aditivada, g.litros_total) + '  ·  ' + litros(g.litros_aditivada) +
          ' de ' + litros(g.litros_total) + '</b></div>' +
        '<div class="mp-det-linha"><span>Venda de produto</span><b>' + reais(prod) +
          (ab > 0 ? '  ·  ' + reais(prod / ab) + ' por carro' : '') + '</b></div>' +
        '<div class="mp-det-linha"><span>Ticket médio</span><b>' +
          (ab > 0 ? nf(p.litros / ab, 1) + ' L  ·  ' + reais(p.faturamento / ab) : '—') + '</b></div>' +
        '<div class="mp-det-linha"><span>Venda de combustível</span><b>' +
          reais(p.faturamento) + (p.litros > 0 ? '  ·  ' + reais(p.faturamento / p.litros) + '/L' : '') + '</b></div>' +
        // LUCRO BRUTO na ordem do arquivo, uma linha cada: é assim que se
        // confere contra o "Total Empresa" impresso, de cima para baixo.
        '<div class="mp-det-sep">Lucro bruto</div>' +
        (ul
          ? '<div class="mp-det-linha"><span>Venda bruta</span><b>' + reais(ul.venda_bruta) + '</b></div>' +
            '<div class="mp-det-linha"><span>Desconto</span><b>' + reais(ul.desconto) + '</b></div>' +
            '<div class="mp-det-linha"><span>Venda líquida</span><b>' + reais(ul.venda_liquida) + '</b></div>' +
            '<div class="mp-det-linha"><span>Custo total</span><b>' + reais(ul.custo_total) + '</b></div>' +
            '<div class="mp-det-linha"><span>Lucro</span><b>' + reais(ul.lucro) + '</b></div>' +
            '<div class="mp-det-linha"><span>Margem</span><b>' + pctDec(ul.margem_pct) + '</b></div>'
          : '<div class="mp-det-linha"><span>Lucro</span><b>—</b></div>') +
      '</div>';
    }

    return '<div class="mp-posto' + (aberto ? ' aberto' : '') + '">' +
      '<button type="button" class="mp-p-linha" aria-expanded="' + (aberto ? 'true' : 'false') + '"' +
        ' onclick="__mpPosto(\'' + esc(p.posto_id) + '\')">' +
        '<span class="mp-p-nome">' + esc(p.posto_nome || '—') + '</span>' +
        htmlBarra(p, maior) +
        numero +
        '<span class="mp-p-comb">' + reaisSemPrefixo(p.faturamento) +
          '<span class="mp-p-mini">' + (p.litros > 0 ? reais(p.faturamento / p.litros) + '/L' : '—') + '</span></span>' +
        '<span class="mp-p-pct">' + pctTxt(appDe(p), p.litros) + '</span>' +
        '<span class="mp-p-mix">' + pctTxt(g.litros_aditivada, g.litros_total) +
          '<span class="mp-p-mini">' + litros(g.litros_aditivada) + ' adit.</span></span>' +
        '<span class="mp-p-prod">' + reais(prod) +
          '<span class="mp-p-mini">' + (ab > 0 ? reais(prod / ab) + '/carro' : '—') + '</span></span>' +
        '<span class="mp-p-lucro">' +
          (ul ? reaisSemPrefixo(ul.lucro) : '—') +
          '<span class="mp-p-mini">' + (ul ? pctDec(ul.margem_pct) : '—') + '</span></span>' +
      '</button>' + det +
    '</div>';
  }

  // ── Linha REDE, no rodapé da lista (o CSS a esconde no mobile) ──
  function htmlRede() {
    var r = _vista.rede;
    var g = r.gasolina || { litros_total: 0, litros_aditivada: 0 };
    var ul = r.dre && r.dre.lucro !== null && r.dre.lucro !== undefined ? r.dre : null;
    var appRede = modoPista()
      ? ['SOUTAG', '99'].reduce(function (s, c) { return s + ((r.por_canal[c] && r.por_canal[c].litros) || 0); }, 0)
      : canaisLigados().filter(function (c) { return c !== 'NORMAL'; })
          .reduce(function (s, c) { return s + ((r.por_canal[c] && r.por_canal[c].litros) || 0); }, 0);
    return '<div class="mp-rede">' +
      '<span class="mp-p-nome">REDE</span>' +
      '<span class="mp-barra-cab"></span>' +
      '<span class="mp-p-litros">' + litros(r.litros) + '</span>' +
      '<span class="mp-p-comb">' + reaisSemPrefixo(r.faturamento) + '</span>' +
      '<span class="mp-p-pct">' + pctTxt(appRede, r.litros) + '</span>' +
      '<span class="mp-p-mix">' + pctTxt(g.litros_aditivada, g.litros_total) + '</span>' +
      '<span class="mp-p-prod">' + reais((r.produto && r.produto.faturamento) || 0) + '</span>' +
      '<span class="mp-p-lucro">' + (ul ? reaisSemPrefixo(ul.lucro) : '—') +
        '<span class="mp-p-mini">' + (ul ? pctDec(ul.margem_pct) : '—') + '</span></span>' +
    '</div>';
  }

  function htmlLista() {
    // Ordem: pelo card ativo quando há um ordenável; senão a regra de sempre
    // (litros do convênio marcado, ou total no modo pista).
    var qual = ordemAtiva();
    var lista = _vista.postos.slice().sort(qual
      ? function (a, b) { return valorOrdem(b, qual) - valorOrdem(a, qual); }
      : function (a, b) { return valorDe(b) - valorDe(a); });
    if (!lista.length) return '<div class="mp-vazio">Sem venda no período.</div>';
    // Régua da barra = maior TOTAL da lista, qualquer que seja a ordenação: a
    // barra mede venda total, então a referência não pode mudar com o sort.
    var maior = lista.reduce(function (m, p) { return Math.max(m, p.litros || 0); }, 0);
    return '<div class="mp-lista">' + htmlCabecalho() +
      lista.map(function (p) { return htmlPosto(p, maior); }).join('') +
      htmlRede() + '</div>';
  }

  // ── Pintura ──────────────────────────────────────────────────────
  function pintar() {
    if (!_sec) return;
    var alvo = _sec.querySelector('#mp-corpo');
    if (!alvo) return;
    // A vista é preparada ANTES de qualquer html*(): é ela que as funções
    // de render leem, e a linha de projeção depende do _proj que ela define.
    prepararVista();
    var cab = htmlFiltros() + htmlProjInfo();
    if (_carregando) { alvo.innerHTML = cab + '<div class="mp-estado">Carregando…</div>'; return; }
    if (_erro) { alvo.innerHTML = cab + '<div class="mp-erro">' + esc(_erro) + '</div>'; return; }
    if (!_dados) { alvo.innerHTML = cab + '<div class="mp-estado">—</div>'; return; }
    if (!_dados.postos || !_dados.postos.length) {
      alvo.innerHTML = cab + '<div class="mp-vazio">Sem dado de ' + brData(_inicio) + ' a ' + brData(_fim) + '.</div>';
      return;
    }
    alvo.innerHTML = cab + htmlCards() + htmlLista();
  }

  // ── Entrada pública ──────────────────────────────────────────────
  window.renderMovPostos = function (sec) {
    if (!sec) return;
    _sec = sec;
    if (!_pronto || !sec.querySelector('#mp-corpo')) montarShell(sec);
    if (!_inicio || !_fim) {
      var ontem = somaDias(hojeISO(), -1);
      _inicio = ontem; _fim = ontem;     // padrão ao abrir: ontem
      carregar();
      return;
    }
    pintar();     // reabertura: não refaz a chamada
  };
})();
