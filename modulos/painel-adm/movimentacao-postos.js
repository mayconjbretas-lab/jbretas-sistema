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
  function lucroDe(p) { return (p.lucro && p.lucro.valor) || 0; }
  // Quanto dos litros com custo usou o custo de um dia anterior. É o que vira
  // o "~" na coluna: o número é bom, mas o custo não é o do dia.
  function pctDefasado(u) {
    return (u && u.litros_com_custo > 0) ? (u.litros_custo_defasado / u.litros_com_custo * 100) : 0;
  }
  // O sinal e o title da coluna/linha REDE, num lugar só. "~" = custo de outro
  // dia; "*" = litro que ficou fora da conta por não ter custo nenhum.
  function marcaLucro(u) {
    if (!u) return { sinal: '', title: '' };
    var partes = [];
    if (u.litros_custo_defasado > 0) partes.push('custo do último dia disponível em ' + nf(pctDefasado(u), 1) + '% dos litros');
    if (u.litros_sem_custo > 0) partes.push(litros(u.litros_sem_custo) + ' sem custo, fora da conta');
    var sinal = (u.litros_sem_custo > 0 ? '*' : '') + (u.litros_custo_defasado > 0 ? '~' : '');
    return { sinal: sinal, title: partes.join(' · ') };
  }
  function appDe(p) {
    var quais = modoPista() ? ['SOUTAG', '99'] : canaisLigados().filter(function (c) { return c !== 'NORMAL'; });
    return quais.reduce(function (s, c) { return s + ((p.por_canal[c] && p.por_canal[c].litros) || 0); }, 0);
  }
  function valorOrdem(p, qual) {
    if (qual === 'total') return p.litros;
    if (qual === 'produto') return produtoDe(p);
    if (qual === 'mix') { var m = mixDe(p); return m === null ? -1 : m; }
    if (qual === 'lucro') return lucroDe(p);
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
  window.__mpCanal = function (c) {
    _filtro[c] = !_filtro[c];
    _cardAberto = null;
    pintar();     // filtro é recorte do que já veio: NÃO refaz a chamada
  };
  window.__mpPeriodo = function (qual, valor) {
    if (qual === 'inicio') _inicio = valor;
    if (qual === 'fim') _fim = valor;
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
      '</div>' +
    '</div>';
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
    var r = _dados.rede;
    var x = r.por_canal[c] || { litros: 0, faturamento: 0, abastecimentos: 0 };
    var ligado = !!_filtro[c];
    // COM o filtro ligado o número grande é o PERCENTUAL — é a pergunta que
    // o chip fez ("quanto do volume passou por aqui?"). Desligado, o card vira
    // informativo e mostra litros, para não competir com o total.
    var grande = ligado
      ? '<div class="mp-num">' + pctTxt(x.litros, r.litros) + '</div>' +
        '<div class="mp-ao-lado">' + litros(x.litros) + '</div>'
      : '<div class="mp-num">' + litros(x.litros) + '</div>';
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
    var r = _dados.rede;
    var ab = r.abastecimentos || 0;
    var prod = (r.produto && r.produto.faturamento) || 0;
    var gas = r.gasolina || { litros_total: 0, litros_aditivada: 0 };

    var cardTotal = '<button type="button" class="mp-card mp-card-total' +
      (_cardAberto === 'total' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'total' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'total\')">' + setaOrd('total') +
      '<div class="mp-rot">REDE · TOTAL PISTA</div>' +
      '<div class="mp-num">' + litros(r.litros) + '</div>' +
      '<div class="mp-sub">' + nf(ab, 0) + ' abast.</div>' +
    '</button>';

    var cardAbast = '<button type="button" class="mp-card mp-card-abast' +
      (_cardAberto === 'abast' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'abast' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'abast\')">' +
      '<div class="mp-rot">ABASTECIMENTOS</div>' +
      '<div class="mp-num">' + nf(ab, 0) + '</div>' +
      '<div class="mp-sub">' + porAbast(r.litros, ab) + '</div>' +
    '</button>';

    // TICKET: três medidas do MESMO denominador (abastecimentos), empilhadas.
    // Não ordena a lista — ver o comentário do ORDENAVEIS.
    var tk = function (rot, val) {
      return '<div class="mp-tk"><span>' + esc(rot) + '</span><b>' + val + '</b></div>';
    };
    var cardTicket = '<button type="button" class="mp-card mp-card-ticket' +
      (_cardAberto === 'ticket' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'ticket' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'ticket\')">' +
      '<div class="mp-rot">TICKET MÉDIO · POR CARRO</div>' +
      tk('vol', ab > 0 ? nf(r.litros / ab, 1) + ' L' : '—') +
      tk('R$', ab > 0 ? nf(r.faturamento / ab, 2) : '—') +
      tk('produto', ab > 0 ? reais(prod / ab) : '—') +
    '</button>';

    var cardProduto = '<button type="button" class="mp-card mp-card-prod' +
      (_cardAberto === 'produto' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'produto' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'produto\')">' + setaOrd('produto') +
      '<div class="mp-rot">VENDA DE PRODUTO</div>' +
      '<div class="mp-num">' + reais(prod) + '</div>' +
      '<div class="mp-sub">' + (ab > 0 ? reais(prod / ab) + ' por carro' : '—') + '</div>' +
    '</button>';

    // MIX: a MESMA definição do Relatórios (aditivada ÷ gasolina), agora
    // vinda pronta da rota — GA, Octapro e Podium contam como aditivada.
    var cardMix = '<button type="button" class="mp-card mp-card-mix' +
      (_cardAberto === 'mix' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'mix' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'mix\')">' + setaOrd('mix') +
      '<div class="mp-rot">MIX G. ADITIVADA</div>' +
      '<div class="mp-num">' + pctTxt(gas.litros_aditivada, gas.litros_total) + '</div>' +
      '<div class="mp-sub">' + litros(gas.litros_aditivada) + ' de ' + litros(gas.litros_total) + ' de gasolina</div>' +
    '</button>';

    // LUCRO ESTIMADO, e não "lucro bruto": é valor_liquido − litros ×
    // custo_avista, não a conta do DRE (que sai de tecnox_categoria_dia, por
    // categoria contábil e com o custo da própria TecnoX). Medido em 10/09,
    // dia limpo dos dois lados, os dois ficaram a 0,2% um do outro — perto,
    // mas não é o mesmo número, e o rótulo não pode prometer que é.
    var lu = _dados.rede.lucro || null;
    var cardLucro = '<button type="button" class="mp-card mp-card-lucro' +
      (_cardAberto === 'lucro' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'lucro' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'lucro\')">' + setaOrd('lucro') +
      '<div class="mp-rot">LUCRO ESTIMADO</div>' +
      '<div class="mp-num">' + (lu ? reais(lu.valor) : '—') + '</div>' +
      '<div class="mp-sub">' + (lu && lu.margem_litro !== null
        ? reais(lu.margem_litro) + ' por litro' : '—') + '</div>' +
    '</button>';

    return '<div class="mp-cards">' +
      cardTotal + cardAbast + cardConvenio('SOUTAG') + cardConvenio('99') +
      cardTicket + cardProduto + cardMix + cardLucro +
    '</div>' + htmlDetalheCard();
  }

  function htmlDetalheCard() {
    if (!_cardAberto) return '';
    var r = _dados.rede;
    var ab = r.abastecimentos || 0;
    var linha = function (rot, val) {
      return '<div class="mp-det-linha"><span>' + esc(rot) + '</span><b>' + val + '</b></div>';
    };
    var corpo = '';
    if (_cardAberto === 'total') {
      corpo = CANAIS.map(function (c) {
        var x = r.por_canal[c] || { litros: 0 };
        return linha(ROTULO[c], litros(x.litros) + '  ·  ' + pctTxt(x.litros, r.litros));
      }).join('') +
      '<div class="mp-det-sep">Litros por combustível</div>' +
      (r.por_combustivel || []).map(function (k2) {
        return linha(k2.rotulo, litros(k2.litros) + '  ·  ' + pctTxt(k2.litros, r.litros));
      }).join('');
    } else if (_cardAberto === 'abast') {
      corpo = CANAIS.map(function (c) {
        var x = r.por_canal[c] || { litros: 0, abastecimentos: 0 };
        return linha(ROTULO[c], nf(x.abastecimentos, 0) + ' abast.  ·  ' + porAbast(x.litros, x.abastecimentos));
      }).join('');
    } else if (_cardAberto === 'ticket') {
      corpo =
        linha('Litros ÷ abastecimentos', litros(r.litros) + ' ÷ ' + nf(ab, 0) + ' = ' + (ab > 0 ? nf(r.litros / ab, 2) + ' L' : '—')) +
        linha('Faturamento ÷ abastecimentos', reais(r.faturamento) + ' ÷ ' + nf(ab, 0) + ' = ' + (ab > 0 ? reais(r.faturamento / ab) : '—')) +
        linha('Produto ÷ abastecimentos', reais((r.produto && r.produto.faturamento) || 0) + ' ÷ ' + nf(ab, 0) + ' = ' + (ab > 0 ? reais(((r.produto && r.produto.faturamento) || 0) / ab) : '—'));
    } else if (_cardAberto === 'produto') {
      var prod = (r.produto && r.produto.faturamento) || 0;
      corpo =
        linha('Venda de produto no período', reais(prod)) +
        linha('Por abastecimento', ab > 0 ? reais(prod / ab) : '—') +
        linha('Sobre o faturamento de pista', pctTxt(prod, r.faturamento)) +
        linha('Fonte', 'tecnox_venda_produto_dia — mesma do Consolidado');
    } else if (_cardAberto === 'lucro') {
      var u = r.lucro || { valor: 0, litros_com_custo: 0, litros_sem_custo: 0, litros_custo_defasado: 0, margem_litro: null };
      corpo =
        linha('A conta', 'valor_liquido − litros × custo = ' + reais(u.valor)) +
        linha('Margem por litro', u.margem_litro !== null ? reais(u.margem_litro) + ' / L' : '—') +
        linha('Litros com custo', litros(u.litros_com_custo));
      if (u.litros_custo_defasado > 0) {
        corpo += linha('Custo do dia anterior',
          nf(pctDefasado(u), 1) + '% dos litros (' + litros(u.litros_custo_defasado) + ')');
      }
      if (u.litros_sem_custo > 0) {
        corpo += linha('Sem custo (fora da conta)', litros(u.litros_sem_custo));
      }
      corpo += linha('Fonte do custo', 'custos_precos.custo_avista — não é a conta do DRE');
    } else if (_cardAberto === 'mix') {
      var g = r.gasolina || { litros_total: 0, litros_aditivada: 0 };
      corpo =
        linha('Aditivada ÷ gasolina', litros(g.litros_aditivada) + ' ÷ ' + litros(g.litros_total) + ' = ' + pctTxt(g.litros_aditivada, g.litros_total)) +
        linha('Gasolina comum', litros(g.litros_total - g.litros_aditivada)) +
        linha('Definição', 'aditivada = GA + Octapro + Podium (igual ao Relatórios)');
    } else {
      var x2 = r.por_canal[_cardAberto] || { litros: 0, faturamento: 0, abastecimentos: 0 };
      corpo =
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
    var ul = p.lucro || null;
    var mk = marcaLucro(ul);

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
        '<div class="mp-det-linha"><span>Lucro estimado</span><b>' +
          (ul ? reais(ul.valor) + (ul.margem_litro !== null ? '  ·  ' + reais(ul.margem_litro) + '/L' : '') +
            (mk.title ? '  ·  ' + esc(mk.title) : '') : '—') + '</b></div>' +
      '</div>';
    }

    return '<div class="mp-posto' + (aberto ? ' aberto' : '') + '">' +
      '<button type="button" class="mp-p-linha" aria-expanded="' + (aberto ? 'true' : 'false') + '"' +
        ' onclick="__mpPosto(\'' + esc(p.posto_id) + '\')">' +
        '<span class="mp-p-nome">' + esc(p.posto_nome || '—') + '</span>' +
        htmlBarra(p, maior) +
        numero +
        '<span class="mp-p-pct">' + pctTxt(appDe(p), p.litros) + '</span>' +
        '<span class="mp-p-mix">' + pctTxt(g.litros_aditivada, g.litros_total) +
          '<span class="mp-p-mini">' + litros(g.litros_aditivada) + ' adit.</span></span>' +
        '<span class="mp-p-prod">' + reais(prod) +
          '<span class="mp-p-mini">' + (ab > 0 ? reais(prod / ab) + '/carro' : '—') + '</span></span>' +
        '<span class="mp-p-lucro"' + (mk.title ? ' title="' + esc(mk.title) + '"' : '') + '>' +
          (ul ? mk.sinal + reais(ul.valor) : '—') +
          '<span class="mp-p-mini">' + (ul && ul.margem_litro !== null ? reais(ul.margem_litro) + '/L' : '—') + '</span></span>' +
      '</button>' + det +
    '</div>';
  }

  // ── Linha REDE, no rodapé da lista (o CSS a esconde no mobile) ──
  function htmlRede() {
    var r = _dados.rede;
    var g = r.gasolina || { litros_total: 0, litros_aditivada: 0 };
    var ul = r.lucro || null;
    var mk = marcaLucro(ul);
    var appRede = modoPista()
      ? ['SOUTAG', '99'].reduce(function (s, c) { return s + ((r.por_canal[c] && r.por_canal[c].litros) || 0); }, 0)
      : canaisLigados().filter(function (c) { return c !== 'NORMAL'; })
          .reduce(function (s, c) { return s + ((r.por_canal[c] && r.por_canal[c].litros) || 0); }, 0);
    return '<div class="mp-rede">' +
      '<span class="mp-p-nome">REDE</span>' +
      '<span class="mp-barra-cab"></span>' +
      '<span class="mp-p-litros">' + litros(r.litros) + '</span>' +
      '<span class="mp-p-pct">' + pctTxt(appRede, r.litros) + '</span>' +
      '<span class="mp-p-mix">' + pctTxt(g.litros_aditivada, g.litros_total) + '</span>' +
      '<span class="mp-p-prod">' + reais((r.produto && r.produto.faturamento) || 0) + '</span>' +
      '<span class="mp-p-lucro"' + (mk.title ? ' title="' + esc(mk.title) + '"' : '') + '>' +
        (ul ? mk.sinal + reais(ul.valor) : '—') + '</span>' +
    '</div>';
  }

  function htmlLista() {
    // Ordem: pelo card ativo quando há um ordenável; senão a regra de sempre
    // (litros do convênio marcado, ou total no modo pista).
    var qual = ordemAtiva();
    var lista = _dados.postos.slice().sort(qual
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
    var cab = htmlFiltros();
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
