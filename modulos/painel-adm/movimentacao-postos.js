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

  // Início REAL das duas fontes, medido no banco em 16/09/2026: a
  // tecnox_venda_dia e a tecnox_categoria_dia começam as duas em 01/01/2026,
  // sem buraco de mês (38.208 e 47.059 linhas, jan→15/09). O 2026-06-25 que
  // estava aqui era do começo do rollup e ficou para trás: ele só alimenta o
  // `min` dos dois <input type="date">, e estava barrando no seletor cinco
  // meses e meio de dado que existe.
  var PRIMEIRO_DIA = '2026-01-01';
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
  var _prodAberto = false;   // seção "Produtos vendidos" do posto aberto
  var _prodOrdem = 'valor';  // 'valor' | 'az'
  // null = botao parado. { fase, i, n, nome, ok, falhas } enquanto roda e
  // nos 5s do ✓ depois. Ver __mpRollup().
  var _roll = null;

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

  // ════════ PROVISÃO DE DESPESA ════════
  // SÓ EM PROJEÇÃO. Fora dela esta tela não sabe que despesa existe: cards,
  // colunas e grade continuam os de sempre, byte por byte.
  //
  // A DESPESA É DE UM MÊS, O LUCRO É DE OUTRO, e isso é regra do negócio, não
  // atalho: a despesa de um mês só fecha depois que ele fecha, então o mês T é
  // provisionado com a despesa do mês M = T−1. A tela escreve os dois meses
  // lado a lado ("PROVISÃO JUL/2026 · despesa base JUN/2026") para ninguém ler
  // os dois números como sendo do mesmo mês.
  //
  // DOIS REGIMES, e o seletor é que escolhe:
  //   T < mês corrente → o mês JÁ FECHOU: venda e lucro são reais, fator 1.
  //                      Não há o que projetar, e chamar de "projeção" um mês
  //                      fechado multiplicado por 1 seria mentira de rótulo.
  //   T = mês corrente → o de sempre: 01→ontem com a regra de três.
  //
  // O GET /despesas/meses só devolve mês FECHADO (o corrente está sempre pela
  // metade) e uma vez por sessão basta — despesa importada não muda no meio da
  // tarde. Cache em memória, sem revalidar.
  var _despMeses = null;      // resposta do GET /despesas/meses (só mês fechado)
  var _despErro = '';
  var _provT = null;          // mês provisionado (YYYY-MM)

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
  // A POST /tecnox/rollup-dia e ehAdm no servidor. Guarda propria aqui para
  // o botao nao aparecer para quem levaria 403 — este arquivo tambem serve o
  // painel de LOGISTICA, que le a mesma rota de movimentacao.
  function ehAdmAqui() {
    var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    return !!(u && u.perfil === 'ADM');
  }

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
  // Mês ± n, em YYYY-MM. Aritmética de componentes, não de Date somado em
  // dias: "31/01 + 1 mês" com Date daria 03/03.
  function mesSoma(ym, n) {
    var a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
    a += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return a + '-' + String(m + 1).padStart(2, '0');
  }
  function mesCorrente() { return hojeISO().slice(0, 7); }
  function ultimoDiaDoMes(ym) { return ym + '-' + String(diasNoMes(ym + '-01')).padStart(2, '0'); }

  // ── Provisão: meses, totais e mapa por posto ─────────────────────
  // O mês do lucro é T; o da despesa é sempre M = T−1.
  function mesBase(t) { return t ? mesSoma(t, -1) : null; }
  function despesaDe(m) {
    if (!m || !_despMeses || !_despMeses.meses) return null;
    for (var i = 0; i < _despMeses.meses.length; i++) {
      if (_despMeses.meses[i].mes === m) return _despMeses.meses[i];
    }
    return null;
  }
  // Mapa posto_id → valor do mês M. Posto que não está na lista NÃO entra:
  // ausência é "não sei", e um zero aqui viraria "despesa zero" na coluna e
  // um lucro líquido igual ao bruto — que lê como posto sem custo nenhum.
  function despesaPorPosto(m) {
    var mp = {};
    var d = despesaDe(m);
    if (!d) return mp;
    (d.postos || []).forEach(function (p) { mp[p.posto_id] = p.valor; });
    return mp;
  }
  // Opções do seletor "Provisão de:". TODO mês T cujo M = T−1 tem despesa
  // importada, mais o mês corrente — que entra sempre, porque é a projeção
  // que a tela já fazia antes desta mudança e ela não pode sumir por falta de
  // despesa. Nada é filtrado por cobertura de movimentação: o mês da DESPESA
  // é quem manda na lista, e escolher um mês sem venda no rollup mostra a
  // despesa com a venda zerada — que é informação, não defeito.
  // Com jan–jun importado e set/2026 corrente: FEV, MAR, ABR, MAI, JUN, JUL
  // (de jan…jun) e SET (corrente). AGO fica de fora porque jul não tem
  // despesa e ago não é o mês corrente.
  function mesesProvisao() {
    var corr = mesCorrente();
    var vistos = {}, out = [];
    ((_despMeses && _despMeses.meses) || []).forEach(function (m) {
      var t = mesSoma(m.mes, 1);
      if (t <= corr && !vistos[t]) { vistos[t] = 1; out.push(t); }
    });
    if (!vistos[corr]) out.push(corr);
    // A resposta vem do mais recente para o mais antigo; o seletor lê de cima
    // para baixo em ordem de calendário.
    out.sort();
    return out;
  }
  function temAlgumaDespesa() {
    return !!(_despMeses && _despMeses.meses && _despMeses.meses.length);
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
  // 'despesa' e 'lucroliq' só existem em Projeção — os cards que os disparam
  // não são renderizados fora dela, então _cardAberto nunca os assume.
  var ORDENAVEIS = ['total', 'SOUTAG', '99', 'produto', 'mix', 'lucro', 'despesa', 'lucroliq'];
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
    // Mesma regra do lucro bruto: sem dado afunda, porque despesa e lucro
    // líquido também podem ser negativos e um -1 poria o posto sem despesa
    // importada acima de quem teve prejuízo real.
    if (qual === 'despesa') { var dv = despesaDoPosto(p); return dv === null ? -Infinity : dv; }
    if (qual === 'lucroliq') { var nv = lucroLiqDe(p); return nv === null ? -Infinity : nv; }
    return (p.por_canal[qual] && p.por_canal[qual].litros) || 0;
  }
  // ── Despesa e lucro líquido do posto (só valem em Projeção) ──────
  // null, e não zero: posto fora da lista do mês M é "não sei quanto gastou",
  // e um zero viraria lucro líquido igual ao bruto — posto sem custo nenhum.
  function despesaDoPosto(p) {
    if (!_projecao) return null;
    var mp = despesaPorPosto(mesBase(_provT));
    var v = mp[p.posto_id];
    return (v === undefined || v === null) ? null : v;
  }
  function lucroLiqDe(p) {
    var d = despesaDoPosto(p);
    var l = lucroDe(p);
    if (d === null || l === null) return null;
    return l - d;
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

    // MÊS FECHADO: os números JÁ SÃO os do mês. Sai sem escalar nada — não
    // por economia, mas porque `_vista === _dados` é o que garante que o
    // valor exibido é o medido, sem passar por multiplicação nenhuma.
    if (_provT && _provT < mesCorrente()) {
      _proj = { real: true, mes: mesRotulo(_provT + '-01'), t: _provT,
                diasMes: diasNoMes(_provT + '-01'), fator: 1, fatorLucro: 1 };
      return;
    }

    var diasV = diasComVenda(_dados);
    if (!diasV) return;
    var dreRede = _dados.rede.dre || {};
    var diasL = dreRede.dias_com_dado || 0;
    var diasM = diasNoMes(_inicio);
    var f = diasM / diasV;
    var fL = diasL > 0 ? diasM / diasL : null;
    _proj = { real: false, t: _inicio.slice(0, 7),
              diasMes: diasM, diasVenda: diasV, diasLucro: diasL,
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

  // ── Carga da despesa (uma vez por sessão) ────────────────────────
  // NÃO É FATAL: se a rota falhar, a Projeção continua funcionando como antes
  // — sem seletor, sem os dois cards e sem as duas colunas. Perder a provisão
  // é melhor que perder a tela.
  async function carregarDespesas() {
    if (_despMeses || _despErro) return;
    try {
      _despMeses = await apiFetch('/despesas/meses');
    } catch (e) {
      _despMeses = null;
      _despErro = (e && e.message) ? e.message : 'falha ao carregar despesas';
    }
  }

  // ── Carga ────────────────────────────────────────────────────────
  // seVazio: dia de reserva. Se o período pedido voltar SEM POSTO NENHUM, busca
  // esse dia na mesma carga e o adota — sem pintar o "Sem dado" no meio. Só a
  // abertura da tela usa (hoje, com ontem de reserva); erro não cai na reserva.
  async function carregar(seVazio) {
    _carregando = true; _erro = ''; pintar();
    // Trocar o período duas vezes depressa dispara duas buscas; sem o selo a
    // PRIMEIRA resposta a chegar pinta, e ela pode ser a do período antigo.
    var meu = ++_seq;
    try {
      var buscar = function () {
        return apiFetch('/tecnox/movimentacao-postos?inicio=' + encodeURIComponent(_inicio) +
                        '&fim=' + encodeURIComponent(_fim));
      };
      var r = await buscar();
      if (meu !== _seq) return;
      if (seVazio && !(r && r.postos && r.postos.length)) {
        _inicio = seVazio; _fim = seVazio;
        r = await buscar();
        if (meu !== _seq) return;
      }
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
  // Ajusta o período ao mês T escolhido. Mês corrente: 01→ontem (a projeção
  // de sempre). Mês fechado: 01→último dia, o mês inteiro e real.
  function periodoDoT(t) {
    if (t === mesCorrente()) {
      var ontem = somaDias(hojeISO(), -1);
      _inicio = t + '-01';
      _fim = (_fim && _fim.slice(0, 7) === t && _fim <= ontem) ? _fim : ontem;
    } else {
      _inicio = t + '-01';
      _fim = ultimoDiaDoMes(t);
    }
  }
  window.__mpProjecao = async function () {
    if (_projecao) { _projecao = false; _cardAberto = null; pintar(); return; }
    // A despesa vem ANTES de escolher o T: o padrão é o T mais recente da
    // lista, e a lista depende de quais meses têm despesa importada.
    _carregando = true; pintar();
    await carregarDespesas();
    // PADRÃO = o T mais recente QUE TEM DESPESA BASE, e não simplesmente o
    // último da lista. O mês corrente entra na lista sempre, mesmo sem M
    // importado; abrir nele mostraria dois cards com "—" logo de cara, que é
    // a tela vazia justamente no clique que pede a provisão. Com jan–jun
    // importado e set corrente, isto abre em JUL/2026.
    var opcoes = mesesProvisao();
    var comBase = opcoes.filter(function (t) { return !!despesaDe(mesBase(t)); });
    _provT = comBase.length ? comBase[comBase.length - 1]
           : (opcoes.length ? opcoes[opcoes.length - 1] : mesCorrente());
    periodoDoT(_provT);
    _projecao = true;
    _cardAberto = null; _postoAberto = null;
    carregar();
  };
  // Troca só o mês provisionado. NÃO desliga a projeção — é o único controle
  // da tela que mexe no período sem desfazer a amarração, porque é ele quem
  // define qual amarração vale.
  window.__mpProvisao = function (t) {
    if (!t || t === _provT) return;
    _provT = t;
    periodoDoT(t);
    _cardAberto = null; _postoAberto = null;
    carregar();
  };
  // UM PAR POSTO x DIA POR CHAMADA, em serie. A rota aceita posto_id nulo
  // para varrer a rede inteira numa requisicao so, mas aquilo sao ~17min de
  // HTTP aberto por dia: morre no proxy antes de responder e ninguem sabe
  // quanto andou. Em serie, cada chamada dura ~27s, o progresso e real e um
  // par que falha nao leva os outros.
  //
  // DIA POR FORA, POSTO POR DENTRO. A ordem importa para quem esta olhando:
  // assim cada dia fica INTEIRO antes do proximo comecar, e interromper no
  // meio (fechar a aba) deixa dias completos atras e nada pela metade a nao
  // ser o ultimo. Com posto por fora, uma interrupcao deixaria TODOS os dias
  // parciais.
  //
  // NAO ESPACA entre chamadas: a exigencia da TecnoX e de ritmo, e uma
  // requisicao a cada 27s ja e mais lenta que os 3s do cron.
  //
  // A LISTA E A QUE A TELA JA TEM (_dados.postos): os postos com venda no
  // periodo, na ordem que a tela mostra. Buscar /postos de novo traria
  // tambem os sem movimentacao e a contagem do botao nao casaria com a lista
  // logo abaixo dele. CONSEQUENCIA ACEITA: num periodo longo, um posto que
  // vendeu em algum dia do periodo e recoletado em TODOS eles — inclusive nos
  // dias em que estava fechado, onde a TecnoX devolve 0 cupons e o rollup
  // grava um dia vazio, que e o que ele ja faz no cron.
  function rollDias(de, ate) {
    var out = [];
    // Comparacao de string serve para ISO, e o teto de 62 dias e o MAX_DIAS
    // que o proprio filtro ja recusa — este `out.length` e so cinto.
    for (var d = de; d <= ate && out.length <= MAX_DIAS; d = somaDias(d, 1)) out.push(d);
    return out;
  }
  window.__mpRollup = async function () {
    if (_roll) return;                       // rodando, ou nos 5s do ✓
    if (!ehAdmAqui()) return;
    var postos = (_dados && _dados.postos) ? _dados.postos.slice() : [];
    var n = postos.length;
    if (!n) return;
    if (!_inicio || !_fim || _inicio > _fim) return;
    var dias = rollDias(_inicio, _fim);
    var nd = dias.length;
    if (!nd) return;
    var total = nd * n;
    // 27s medidos por posto x dia na rota (P. BOMBOM MATRIZ, 14/09/2026, 196
    // cupons) — quase tudo esperando a TecnoX paginar. O numero sai da CONTA e
    // nao cravado: com meia rede no filtro, ou com 14 dias em vez de um, um
    // aviso fixo estaria errado por varias vezes.
    var min = Math.max(1, Math.round(total * 27 / 60));
    // ACIMA DE UMA HORA E MEIA O NUMERO EM MINUTOS PARA DE INFORMAR: "~233
    // min" nao se sente, "3,9 h" se sente. E e justamente nesse tamanho que a
    // pessoa precisa sentir antes de confirmar.
    var prazo = '~' + min + ' min' + (min > 90 ? ' (' + nf(min / 60, 1) + ' h)' : '');
    var pergunta = (nd === 1)
      // UM DIA SO: a pergunta de sempre, palavra por palavra. Com de = ate a
      // varredura e a mesma de antes, e "de 14/09 a 14/09, 1 dias" seria uma
      // frase pior dizendo o mesmo.
      ? 'Atualizar dados de ' + diaMes(_fim) + '? Demora ' + prazo + ' para ' + n + ' postos.'
      : 'Atualizar dados de ' + diaMes(_inicio) + ' a ' + diaMes(_fim) + '? São ' + nd +
        ' dias × ' + n + ' postos, ' + prazo + '.';
    if (!window.confirm(pergunta)) return;
    _roll = { fase: 'rodando', di: 0, nd: nd, i: 0, n: n, nome: '',
              feitos: 0, total: total, ok: 0, falhas: [] };
    rollPintar();
    for (var t = 0; t < nd; t++) {
      _roll.di = t + 1;
      for (var k = 0; k < n; k++) {
        _roll.i = k + 1;
        _roll.nome = postos[k].posto_nome || '';
        rollPintar();
        try {
          var r = await apiFetch('/tecnox/rollup-dia', {
            method: 'POST',
            body: JSON.stringify({ data: dias[t], posto_id: postos[k].posto_id }),
          });
          // A rota responde 200 com ok:false quando o posto nao reconcilia:
          // isso e falha daquele par, nao da varredura.
          if (r && r.ok) _roll.ok++;
          else _roll.falhas.push(rollQuem(postos[k], dias[t]) + ': ' +
            ((((r || {}).detalhe || [])[0] || {}).erro || 'não fechou'));
        } catch (e) {
          _roll.falhas.push(rollQuem(postos[k], dias[t]) + ': ' + ((e && e.message) ? e.message : 'falhou'));
        }
        _roll.feitos++;
      }
    }
    _roll.fase = 'fim';
    rollPintar();
    // O MOTIVO de cada falha vai para o title do botao e para o console: a
    // tela nao ganha area nova, e "515/518" sem o porque nao serve para agir.
    if (_roll.falhas.length && window.console) console.warn('Atualizar rollup — falhas:\n' + _roll.falhas.join('\n'));
    carregar();     // o pintar() dele redesenha a barra com o ✓ ainda de pe
    setTimeout(function () { _roll = null; pintar(); }, 5000);
  };
  // O DIA ENTRA NO MOTIVO DA FALHA. Com um dia so ele era obvio; com 14, uma
  // lista de "P. ITAPOA: timeout" repetida quatro vezes nao diria em quais
  // dias o posto falhou — e e isso que decide o que rerrodar.
  function rollQuem(p, dia) {
    return (dia ? diaMes(dia) + ' ' : '') + (p.posto_nome || p.posto_id);
  }

  window.__mpCard = function (id) {
    _cardAberto = (_cardAberto === id) ? null : id;
    pintar();
  };
  window.__mpPosto = function (id) {
    _postoAberto = (_postoAberto === id) ? null : id;
    _prodAberto = false;   // "Produtos vendidos" sempre abre FECHADA
    pintar();
  };
  window.__mpProdutos = function () {
    _prodAberto = !_prodAberto;
    pintar();
  };
  window.__mpProdOrdem = function (o) {
    _prodOrdem = o;
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
        htmlRoll() +
      '</div>' +
    '</div>';
  }

  // ════════ ATUALIZAR ROLLUP ════════
  // O unico controle da barra que ESCREVE. Os outros tres atalhos trocam
  // recorte do que ja veio e desfazem-se num clique; este chama a TecnoX
  // posto a posto e regrava o dia no banco. Por isso pede confirmacao, tem
  // cor propria (nao e .mp-atalho) e diz o prazo antes de comecar.
  //
  // A BARRA DE PROGRESSO E O PROPRIO BOTAO: um gradiente inline cuja parada
  // anda com os PARES posto x dia concluidos, e o rotulo virando
  // "Atualizando dia 3/14… 13/37 P. ITAPOA". Nenhuma area nova na tela — e
  // nenhum pintar() no meio do laco, senao a tela inteira se redesenharia uma
  // vez por par e fecharia o card que estivesse aberto. O laco escreve direto
  // no no do botao (rollPintar).
  //
  // O verde e cravado em hex, sem variavel de tema, de proposito: e o unico
  // elemento da barra que nao e filtro, e a cor e o que diz isso nos dois
  // temas. O tom do preenchimento e a propria cor da borda com alfa — nao ha
  // quarta cor inventada aqui.
  var ROLL_PREENCHE = 'rgba(15, 110, 86, .22)';

  function cortarNome(s, n) {
    s = String(s === null || s === undefined ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function rollTexto() {
    if (!_roll) return '⟳ Atualizar rollup';
    if (_roll.fase === 'fim') return 'Atualizado ✓ ' + _roll.ok + '/' + _roll.total;
    // O nome cortado em 16: "P. LOURA EMPREENDIMENTOS" dobrava a largura do
    // botao no meio do laco e empurrava a barra de filtros.
    var quem = cortarNome(_roll.nome, 16);
    // UM DIA SO: o rotulo de sempre. Com de = ate a varredura e a mesma de
    // antes, e "dia 1/1" seria ruido dizendo que nao ha o que contar.
    if (_roll.nd === 1) return 'Atualizando ' + _roll.i + '/' + _roll.n + '… ' + quem;
    return 'Atualizando dia ' + _roll.di + '/' + _roll.nd + '… ' +
           _roll.i + '/' + _roll.n + ' ' + quem;
  }
  // Sobre os PARES concluidos, nao sobre os dias: com 14 dias a barra andaria
  // aos saltos de 7%, parada por 17 min a cada salto. `feitos` e incrementado
  // ao fim de cada chamada, entao a parada nunca conta o par em curso.
  function rollGradiente() {
    if (!_roll) return '';
    var pct = (_roll.fase === 'fim') ? 100
            : Math.max(0, Math.min(100, Math.round(_roll.feitos / _roll.total * 100)));
    return 'linear-gradient(to right, ' + ROLL_PREENCHE + ' ' + pct + '%, ' +
           'rgba(0,0,0,0) ' + pct + '%)';
  }
  function htmlRoll() {
    if (!ehAdmAqui()) return '';
    var g = rollGradiente();
    return '<button type="button" id="mp-roll" class="mp-roll' + (_roll ? ' mp-roll-on' : '') + '"' +
      (_roll ? ' disabled aria-busy="true"' : '') +
      ((_roll && _roll.falhas.length) ? ' title="' + esc(_roll.falhas.join(' | ')) + '"' : '') +
      (g ? ' style="background-image:' + g + '"' : '') +
      ' onclick="__mpRollup()">' + esc(rollTexto()) + '</button>';
  }
  // Escreve no no que ja esta na tela. MESMAS funcoes do htmlRoll acima —
  // duas copias do rotulo divergiriam no primeiro ajuste de texto.
  function rollPintar() {
    var btn = _sec ? _sec.querySelector('#mp-roll') : null;
    if (!btn) return;
    btn.textContent = rollTexto();
    btn.className = 'mp-roll' + (_roll ? ' mp-roll-on' : '');
    btn.disabled = !!_roll;
    if (_roll) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    if (_roll && _roll.falhas.length) btn.title = _roll.falhas.join(' | ');
    else btn.removeAttribute('title');
    btn.style.backgroundImage = rollGradiente();
  }

  // O MÊS PROJETADO E A BASE DO LUCRO, e mais nada. A régra de três da venda
  // saiu daqui: ela continua escrita, inteira, na conta de cada card aberto
  // ("5.911.405 L ÷ 13 × 30 = 13.641.703 L"), que é onde alguém a procura
  // quando quer conferir. Repeti-la no alto da tela gastava uma linha inteira
  // para dizer de novo o que os cards já dizem um a um.
  //
  // A BASE DO LUCRO FICA, mesmo igual à da venda: ela é a única das duas que
  // NÃO aparece em card nenhum — vem de uma segunda fonte, a
  // tecnox_categoria_dia, que anda dessincronizada da venda. Sem esta linha,
  // um lucro projetado sobre 11 dias apareceria do lado de uma litragem
  // projetada sobre 13 sem nada avisando.
  // O seletor fica NESTA linha, ao lado do texto, e não na barra de filtros
  // lá em cima: a barra é dos controles que existem sempre, e este só existe
  // com a Projeção ligada. Posto entre os chips e as datas, ele apareceria e
  // sumiria empurrando os vizinhos.
  function htmlSeletorProv() {
    if (!temAlgumaDespesa()) return '';
    var opcoes = mesesProvisao();
    if (!opcoes.length) return '';
    return '<label class="mp-prov-sel">Provisão de:' +
      '<select onchange="__mpProvisao(this.value)">' +
        opcoes.map(function (t) {
          return '<option value="' + esc(t) + '"' + (t === _provT ? ' selected' : '') + '>' +
            esc(mesRotulo(t + '-01')) + '</option>';
        }).join('') +
      '</select></label>';
  }

  function htmlProjInfo() {
    if (!_proj) return '';
    var txt;
    if (_proj.real) {
      // Mês fechado: NÃO diz "projeção". O número é o que aconteceu.
      txt = 'PROVISÃO ' + _proj.mes + ' · venda real';
    } else {
      txt = 'PROJEÇÃO ' + _proj.mes;
      if (_proj.fatorLucro === null) {
        txt += ' · sem lucro no arquivo, sem projeção de lucro';
      } else {
        txt += ' · lucro base ' + _proj.diasLucro + ' dia' + (_proj.diasLucro === 1 ? '' : 's');
      }
    }
    // O mês da despesa entra SEMPRE que a projeção está ligada, inclusive
    // para dizer que ele falta: o card mostrando "—" sem explicação faria
    // procurar defeito na tela em vez de importação faltando.
    var m = mesBase(_provT || _proj.t);
    if (_despErro) {
      // "não carregou" NÃO é "não existe": dizer "sem despesa importada" numa
      // falha de rede mandaria alguém importar de novo o que já está lá.
      txt += ' · despesa indisponível';
    } else if (!temAlgumaDespesa()) {
      txt += ' · sem despesa importada';
    } else if (despesaDe(m)) {
      txt += ' · despesa base ' + mesRotulo(m + '-01');
    } else {
      txt += ' · sem despesa de ' + MES_ABREV[Number(m.slice(5, 7)) - 1] + ' importada';
    }
    return '<div class="mp-proj">' + esc(txt) + htmlSeletorProv() + '</div>';
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

    // ── Provisão: dois cards, SÓ em Projeção ──────────────────────
    // Mesmos 150×96 dos outros — nada de card destacado, porque eles entram
    // na mesma régua que alinha card com coluna lá embaixo.
    //
    // A DESPESA NÃO É PROJETADA. Ela é o total FECHADO do mês M, um número
    // que já aconteceu; multiplicá-lo por fator nenhum é o certo. Quem é
    // projetado (ou real, conforme o T) é só o lucro do outro lado da conta.
    var mBase = mesBase(_provT);
    var dMes = despesaDe(mBase);
    var despRede = dMes ? dMes.total : null;
    var luLiq = (despRede !== null && temLu) ? (lu.lucro - despRede) : null;
    var cardsProv = '';
    if (_projecao) {
      cardsProv =
        '<button type="button" class="mp-card mp-card-desp' +
          (_cardAberto === 'despesa' ? ' aberto' : '') + '"' +
          ' aria-expanded="' + (_cardAberto === 'despesa' ? 'true' : 'false') + '"' +
          ' onclick="__mpCard(\'despesa\')">' + setaOrd('despesa') +
          '<div class="mp-rot">PROJ. DESPESA</div>' +
          '<div class="mp-num mp-card-valor">' + (despRede !== null ? reaisCard(despRede) : '—') + '</div>' +
          '<div class="mp-sub">' + (mBase ? 'base ' + esc(mesRotulo(mBase + '-01')) : '—') + '</div>' +
        '</button>' +
        '<button type="button" class="mp-card mp-card-liq' +
          (_cardAberto === 'lucroliq' ? ' aberto' : '') + '"' +
          ' aria-expanded="' + (_cardAberto === 'lucroliq' ? 'true' : 'false') + '"' +
          ' onclick="__mpCard(\'lucroliq\')">' + setaOrd('lucroliq') +
          '<div class="mp-rot">PROJ. LUCRO LÍQUIDO</div>' +
          '<div class="mp-num mp-card-valor">' + (luLiq !== null ? reaisCard(luLiq) : '—') + '</div>' +
          // Margem LÍQUIDA sobre a venda líquida, o mesmo denominador da
          // margem bruta do card ao lado: trocar a base faria as duas
          // margens ficarem lado a lado sem serem comparáveis.
          '<div class="mp-sub">' + ((luLiq !== null && lu && lu.venda_liquida > 0)
            ? 'margem líq. ' + nf(luLiq / lu.venda_liquida * 100, 2) + '%' : '—') + '</div>' +
        '</button>';
    }

    return '<div class="mp-cards">' +
      cardTotal + cardAbast + cardConvenio('SOUTAG') + cardConvenio('99') +
      // ORDEM = A DAS COLUNAS DA LISTA, nao a de criacao. A grade embaixo e
      // POSTO BARRA LITRAGEM COMBUSTIVEL APP MIX PRODUTO LUCRO, e os cards
      // tem a mesma largura e o mesmo gap — entao o card 6 fica exatamente
      // sobre a coluna 6. Com Produto antes de Mix, a coluna MIX caia sob o
      // card VENDA DE PRODUTO: alinhado ao pixel e trocado no rotulo, que e
      // pior do que nao alinhar nada.
      cardTicket + cardMix + cardProduto + cardLucro + cardsProv +
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
      // A despesa é mês fechado: não passa por fator. Dizer isso é o que
      // impede alguém de procurar a regra de três que não existe aqui.
      else if (_cardAberto === 'despesa' || _cardAberto === 'lucroliq') return '';
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
    } else if (_cardAberto === 'despesa' || _cardAberto === 'lucroliq') {
      // A SUBTRAÇÃO ESCRITA, com os dois meses nomeados em cada parcela: é
      // o ponto onde alguém confere se o que está sendo subtraído é mesmo o
      // que ele acha que é.
      var mB = mesBase(_provT);
      var dM = despesaDe(mB);
      var uL = r.dre || null;
      var temL = !!(uL && uL.lucro !== null && uL.lucro !== undefined);
      if (!dM) {
        corpo += linha('Sem despesa', 'o mês ' + (mB ? mesRotulo(mB + '-01') : '—') +
          ' não tem despesa importada — sem base para a provisão');
      } else if (!temL) {
        corpo += linha('Despesa da rede em ' + mesRotulo(mB + '-01'), reais(dM.total)) +
                 linha('Sem lucro', 'o arquivo TecnoX não cobre este período');
      } else {
        var liq = uL.lucro - dM.total;
        corpo +=
          linha('Lucro ' + (_proj && _proj.real ? 'real' : 'projetado') + ' de ' + _proj.mes, reais(uL.lucro)) +
          linha('Despesa de ' + mesRotulo(mB + '-01'), '− ' + reais(dM.total)) +
          linha('Lucro líquido', reais(liq)) +
          linha('Margem líquida', uL.venda_liquida > 0
            ? nf(liq / uL.venda_liquida * 100, 2) + '%  (sobre a venda líquida)' : '—') +
          linha('Lançamentos', nf(dM.lancamentos, 0) + ' na despesa de ' + mesRotulo(mB + '-01'));
        // O buraco NOMEADO: empresa sem posto no cadastro entra no total da
        // rede mas não em posto nenhum, então a soma das 37 colunas não
        // fecha com o card. Sem esta linha, a diferença vira erro aparente.
        if (dM.sem_posto) {
          corpo += linha('Sem posto no cadastro', reais(dM.sem_posto.valor) + ' em ' +
            nf(dM.sem_posto.lancamentos, 0) + ' lançamento(s) — entra na rede, não nas colunas');
        }
        corpo += linha('Fonte', 'despesas_lancamento, mês pela emissão — a mesma do Importar despesas');
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
      // As duas só existem em Projeção — fora dela o cabeçalho tem 8 colunas,
      // como sempre teve.
      (_projecao ? h('mp-p-desp', 'DESPESA', 'despesa') +
                   h('mp-p-liq', 'LUCRO LÍQ.', 'lucroliq') : '') +
    '</div>';
  }

  // ════════ PRODUTOS VENDIDOS (fim do detalhe do posto) ════════
  // Fonte: produto.itens da rota, de tecnox_venda_produto_dia — o rollup,
  // então vale para o dia corrente também (não espera o .xls de categoria).
  //
  // CADA LINHA É UMA DESCRIÇÃO COMO VEIO DA TECNOX. O ARLA a granel e o ARLA
  // em galão ficam separados; quantidade de linhas diferentes nunca é somada
  // nem convertida. Total e subtotais são R$, sempre.
  //
  // SEMPRE O MEDIDO: lê de `_dados`, não de `_vista`. A projeção multiplica
  // o faturamento de produto (e o escalarBloco descarta a lista), e projetar
  // um produto vendido duas vezes no mês inventaria venda.
  //
  // UNIDADE: fracionário é litro (granel); inteiro é unidade. "GRANEL" na
  // descrição é litro sempre — 20,000 L somados no período não viram "20 un".
  function htmlProdutos(p) {
    var med = null;
    var ps = (_dados && _dados.postos) || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].posto_id === p.posto_id) { med = ps[i]; break; }
    var pr = (med && med.produto) || {};
    var itens = pr.itens || [];
    if (!itens.length) {
      return '<div class="mp-det-sec mp-prod"><div class="mp-det-rot">Produtos vendidos · sem produto vendido</div></div>';
    }
    var cab = 'Produtos vendidos · ' + reais(pr.faturamento || 0) + ' · ' +
      nf(itens.length, 0) + (itens.length === 1 ? ' item' : ' itens');
    var h = '<div class="mp-det-sec mp-prod">' +
      '<button type="button" class="mp-det-rot mp-prod-cab" aria-expanded="' + (_prodAberto ? 'true' : 'false') + '"' +
        ' onclick="__mpProdutos()"><span class="mp-prod-seta">' + (_prodAberto ? '▾' : '▸') + '</span>' + esc(cab) + '</button>';
    if (!_prodAberto) return h + '</div>';

    var qtd = function (it) {
      var q = Number(it.quantidade) || 0;
      var litro = /GRANEL/i.test(it.descricao) || Math.abs(q - Math.round(q)) > 1e-6;
      return litro ? nf(q, 1) + ' L' : nf(q, 0) + ' un';
    };
    var ordena = function (a, b) {
      if (_prodOrdem === 'az') return String(a.descricao).localeCompare(String(b.descricao), 'pt-BR', { sensitivity: 'base' });
      return (Number(b.valor_liquido) || 0) - (Number(a.valor_liquido) || 0);
    };
    var bloco = function (rot, subtotal, lista) {
      if (!lista.length) return '';
      return '<div class="mp-prod-grupo">' + esc(rot) + ' · ' + reais(subtotal) + '</div>' +
        lista.slice().sort(ordena).map(function (it) {
          return '<div class="mp-prod-lin">' +
            '<span class="mp-prod-nome" title="' + esc(it.descricao) + '">' + esc(it.descricao) + '</span>' +
            '<span class="mp-prod-q">' + qtd(it) + '</span>' +
            '<b class="mp-prod-v">' + reais(it.valor_liquido) + '</b>' +
          '</div>';
        }).join('');
    };
    var lub = itens.filter(function (it) { return String(it.grupo).toUpperCase() === 'LUBRIFICANTE'; });
    var out = itens.filter(function (it) { return String(it.grupo).toUpperCase() !== 'LUBRIFICANTE'; });
    var bt = function (o, rot) {
      return '<button type="button" class="mp-prod-ob' + (_prodOrdem === o ? ' on' : '') + '"' +
        ' aria-pressed="' + (_prodOrdem === o ? 'true' : 'false') + '"' +
        ' onclick="__mpProdOrdem(\'' + o + '\')">' + rot + '</button>';
    };
    return h + '<div class="mp-prod-corpo">' +
      // Só quando os OUTROS números do detalhe estão multiplicados. Mês
      // fechado em projeção (_proj.real) já mostra o medido em tudo.
      (_proj && !_proj.real ? '<div class="mp-prod-nota">valores medidos, sem projeção</div>' : '') +
      '<div class="mp-prod-ord">' + bt('valor', 'por R$') + bt('az', 'A-Z') + '</div>' +
      bloco('Lubrificantes', pr.lubrificante || 0, lub) +
      bloco('Outros produtos', pr.outros || 0, out) +
    '</div></div>';
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
      // ════════ CINCO SEÇÕES ROTULADAS ════════
      // Eram catorze linhas seguidas, do canal à margem, com uma faixa de
      // "Lucro bruto" no meio. A ordem e os números são os MESMOS; o que
      // mudou é que cada assunto ganhou rótulo e régua embaixo, porque ler
      // "Ticket médio" logo abaixo de "Venda de produto" e logo acima de
      // "Venda bruta" não dizia a qual pergunta cada linha responde.
      //
      // A COR É POR ORIGEM DO NÚMERO, não decoração: roxo é Soutag e âmbar
      // é o 99 — as mesmas duas cores que a tela App usa para os canais, e
      // as mesmas dos chips daqui. Verde é lucro e margem. Desconto ZERO sai
      // apagado: "R$ 0,00" em destaque faz procurar desconto que não houve.
      var secao = function (rot, corpo) {
        return '<div class="mp-det-sec"><div class="mp-det-rot">' + esc(rot) + '</div>' + corpo + '</div>';
      };
      var lin = function (rot, val, cls) {
        return '<div class="mp-det-linha"><span>' + esc(rot) + '</span><b' +
          (cls ? ' class="' + cls + '"' : '') + '>' + val + '</b></div>';
      };
      var CORCANAL = { SOUTAG: 'mp-v-so', '99': 'mp-v-99', NORMAL: '' };
      det = '<div class="mp-p-det">' +
        secao('Canais', CANAIS.map(function (c) {
          var x = p.por_canal[c] || { litros: 0, faturamento: 0, abastecimentos: 0 };
          return lin(ROTULO[c],
            litros(x.litros) + '  ·  ' + pctTxt(x.litros, p.litros) + '  ·  ' +
            nf(x.abastecimentos, 0) + ' abast.  ·  ' + reais(x.faturamento),
            CORCANAL[c]);
        }).join('')) +
        secao('Mix e produto',
          lin('Mix g. aditivada', pctTxt(g.litros_aditivada, g.litros_total) + '  ·  ' +
            litros(g.litros_aditivada) + ' de ' + litros(g.litros_total)) +
          lin('Venda de produto', reais(prod) +
            (ab > 0 ? '  ·  ' + reais(prod / ab) + ' por carro' : ''))) +
        secao('Ticket',
          lin('Ticket médio',
            (ab > 0 ? nf(p.litros / ab, 1) + ' L  ·  ' + reais(p.faturamento / ab) : '—'))) +
        // O rótulo da LINHA virou "Faturamento": com a seção já dizendo
        // "Venda de combustível", repetir a frase dentro dela era eco.
        secao('Venda de combustível',
          lin('Faturamento', reais(p.faturamento) +
            (p.litros > 0 ? '  ·  ' + reais(p.faturamento / p.litros) + '/L' : ''))) +
        // LUCRO BRUTO na ordem do arquivo, uma linha cada: é assim que se
        // confere contra o "Total Empresa" impresso, de cima para baixo.
        secao('Lucro bruto', ul
          ? lin('Venda bruta', reais(ul.venda_bruta)) +
            lin('Desconto', reais(ul.desconto), Number(ul.desconto) ? '' : 'mp-v-zero') +
            lin('Venda líquida', reais(ul.venda_liquida)) +
            lin('Custo total', reais(ul.custo_total)) +
            lin('Lucro', reais(ul.lucro), 'mp-v-lucro') +
            lin('Margem', pctDec(ul.margem_pct), 'mp-v-lucro')
          : lin('Lucro', '—')) +
        // No MOBILE as duas colunas não entram na linha — é aqui que elas
        // aparecem. No desktop repetem a coluna de propósito, como já fazem
        // Mix, Produto e Ticket logo acima.
        (_projecao ? (function () {
          var mB = mesBase(_provT);
          var dv = despesaDoPosto(p);
          var lq = lucroLiqDe(p);
          var vl = (ul && ul.venda_liquida) || 0;
          return secao('Provisão',
            lin('Despesa (base ' + (mB ? MES_ABREV[Number(mB.slice(5, 7)) - 1] : '—') + ')',
              (dv !== null ? reais(dv) + (vl > 0 ? '  ·  ' + nf(dv / vl * 100, 2) + '% da venda líquida' : '') : '—')) +
            lin('Lucro líquido',
              (lq !== null ? reais(lq) + (vl > 0 ? '  ·  margem líq. ' + nf(lq / vl * 100, 2) + '%' : '') : '—'),
              'mp-v-lucro'));
        })() : '') +
        htmlProdutos(p) +
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
        (_projecao ? colunasProv(p, ul) : '') +
      '</button>' + det +
    '</div>';
  }

  // As duas colunas da provisão, na linha do posto. Sublinha da DESPESA é o
  // peso dela sobre a venda líquida do posto — é o número que diz se uma
  // despesa grande é grande de verdade ou só acompanha um posto grande.
  function colunasProv(p, ul) {
    var d = despesaDoPosto(p);
    var liq = lucroLiqDe(p);
    var vl = (ul && ul.venda_liquida) || 0;
    return '<span class="mp-p-desp">' + (d !== null ? reaisSemPrefixo(d) : '—') +
        '<span class="mp-p-mini">' + ((d !== null && vl > 0)
          ? nf(d / vl * 100, 2) + '% da venda' : '—') + '</span></span>' +
      '<span class="mp-p-liq">' + (liq !== null ? reaisSemPrefixo(liq) : '—') +
        '<span class="mp-p-mini">' + ((liq !== null && vl > 0)
          ? nf(liq / vl * 100, 2) + '%' : '—') + '</span></span>';
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
      // REDE usa o TOTAL da rede (que inclui a despesa sem posto no
      // cadastro), não a soma das 37 colunas: a linha REDE tem de bater com
      // o card, e é o card que o pessoal confere contra o relatório.
      (_projecao ? (function () {
        var dM = despesaDe(mesBase(_provT));
        var dv = dM ? dM.total : null;
        var lq = (dv !== null && ul) ? ul.lucro - dv : null;
        var vl = (ul && ul.venda_liquida) || 0;
        return '<span class="mp-p-desp">' + (dv !== null ? reaisSemPrefixo(dv) : '—') +
            '<span class="mp-p-mini">' + ((dv !== null && vl > 0) ? nf(dv / vl * 100, 2) + '% da venda' : '—') + '</span></span>' +
          '<span class="mp-p-liq">' + (lq !== null ? reaisSemPrefixo(lq) : '—') +
            '<span class="mp-p-mini">' + ((lq !== null && vl > 0) ? nf(lq / vl * 100, 2) + '%' : '—') + '</span></span>';
      })() : '') +
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
    // A classe `proj` é o ÚNICO gatilho da grade de 10 colunas no CSS. Sem
    // ela a lista fica nas 8 de sempre — é o que garante que desligar a
    // Projeção devolve a largura de 1256px sem nenhuma outra regra.
    return '<div class="mp-lista' + (_projecao ? ' proj' : '') + '">' + htmlCabecalho() +
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
      // PADRÃO AO ABRIR: HOJE, com ontem de reserva. A tela é "Movimentação
      // do dia"; o dia corrente só tem dado depois de um rollup do dia (botão
      // ou agendamento) — antes disso a carga cai em ontem sozinha, em vez de
      // abrir em branco. hojeISO() é a data LOCAL (getDate), não toISOString.
      var hoje = hojeISO();
      _inicio = hoje; _fim = hoje;
      carregar(somaDias(hoje, -1));
      return;
    }
    pintar();     // reabertura: não refaz a chamada
  };
})();
