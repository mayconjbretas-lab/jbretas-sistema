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
  // Valor que ordena a lista e que a linha mostra: litros do(s) convênio(s)
  // ligado(s), ou o total do posto quando nenhum está.
  function valorDe(p) {
    if (modoPista()) return p.litros;
    return canaisLigados().reduce(function (s, c) {
      return s + ((p.por_canal[c] && p.por_canal[c].litros) || 0);
    }, 0);
  }
  function valorRede() {
    if (!_dados) return 0;
    if (modoPista()) return _dados.rede.litros;
    return canaisLigados().reduce(function (s, c) {
      var x = _dados.rede.por_canal[c];
      return s + ((x && x.litros) || 0);
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
      ' onclick="__mpCard(\'' + c + '\')">' +
      '<div class="mp-rot">' + esc(ROTULO[c]).toUpperCase() + '</div>' +
      grande +
      '<div class="mp-sub">' + nf(x.abastecimentos, 0) + ' abast.</div>' +
    '</button>';
  }

  function htmlCards() {
    var r = _dados.rede;
    var cardTotal = '<button type="button" class="mp-card mp-card-total' +
      (_cardAberto === 'total' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'total' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'total\')">' +
      '<div class="mp-rot">REDE · TOTAL PISTA</div>' +
      '<div class="mp-num">' + litros(r.litros) + '</div>' +
      '<div class="mp-sub">' + nf(r.abastecimentos, 0) + ' abast.</div>' +
    '</button>';
    var cardAbast = '<button type="button" class="mp-card mp-card-abast' +
      (_cardAberto === 'abast' ? ' aberto' : '') + '"' +
      ' aria-expanded="' + (_cardAberto === 'abast' ? 'true' : 'false') + '"' +
      ' onclick="__mpCard(\'abast\')">' +
      '<div class="mp-rot">ABASTECIMENTOS</div>' +
      '<div class="mp-num">' + nf(r.abastecimentos, 0) + '</div>' +
      '<div class="mp-sub">' + porAbast(r.litros, r.abastecimentos) + '</div>' +
    '</button>';
    return '<div class="mp-cards">' + cardTotal + cardAbast + cardConvenio('SOUTAG') + cardConvenio('99') + '</div>' +
      htmlDetalheCard();
  }

  function htmlDetalheCard() {
    if (!_cardAberto) return '';
    var r = _dados.rede;
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
      (r.por_combustivel || []).map(function (k) {
        return linha(k.rotulo, litros(k.litros) + '  ·  ' + pctTxt(k.litros, r.litros));
      }).join('');
    } else if (_cardAberto === 'abast') {
      corpo = CANAIS.map(function (c) {
        var x = r.por_canal[c] || { litros: 0, abastecimentos: 0 };
        return linha(ROTULO[c], nf(x.abastecimentos, 0) + ' abast.  ·  ' + porAbast(x.litros, x.abastecimentos));
      }).join('');
    } else {
      var x = r.por_canal[_cardAberto] || { litros: 0, faturamento: 0, abastecimentos: 0 };
      corpo =
        linha('Litros ÷ total da rede', litros(x.litros) + ' ÷ ' + litros(r.litros) + ' = ' + pctTxt(x.litros, r.litros)) +
        linha('Abastecimentos', nf(x.abastecimentos, 0)) +
        linha('Litros por abastecimento', porAbast(x.litros, x.abastecimentos)) +
        linha('Faturamento do canal', reais(x.faturamento));
    }
    return '<div class="mp-detalhe">' + corpo + '</div>';
  }

  // ── Lista por posto ──────────────────────────────────────────────
  function htmlBarra(p) {
    var ligados = canaisLigados();
    // A barra é SEMPRE a venda total do posto — é o que dá noção de tamanho
    // relativo entre postos. O filtro apaga os segmentos de fora (opacidade
    // .2) em vez de removê-los: a barra encolher mudaria a leitura de
    // "quanto este posto vende" para "quanto ele vende no convênio", e as
    // duas perguntas convivem na mesma tela.
    return '<div class="mp-barra" role="presentation">' + CANAIS.map(function (c) {
      var x = p.por_canal[c] || { litros: 0 };
      var w = pct(x.litros, p.litros);
      if (w === null || w <= 0) return '';
      var apagado = (!modoPista() && ligados.indexOf(c) < 0) ? ' fora' : '';
      return '<span class="mp-seg mp-seg-' + (c === '99' ? '99' : c === 'SOUTAG' ? 'so' : 'pi') + apagado + '"' +
        ' style="width:' + w.toFixed(3) + '%" title="' + esc(ROTULO[c]) + ': ' + litros(x.litros) + '"></span>';
    }).join('') + '</div>';
  }

  function htmlPosto(p) {
    var v = valorDe(p);
    var total = valorRede();
    var aberto = _postoAberto === p.posto_id;
    var numero = modoPista()
      ? '<span class="mp-p-litros">' + litros(p.litros) + '</span>'
      : '<span class="mp-p-litros">' + litros(v) + '<span class="mp-p-de"> / ' + litros(p.litros) + '</span></span>';
    var det = '';
    if (aberto) {
      det = '<div class="mp-p-det">' + CANAIS.map(function (c) {
        var x = p.por_canal[c] || { litros: 0, faturamento: 0, abastecimentos: 0 };
        return '<div class="mp-det-linha"><span>' + esc(ROTULO[c]) + '</span><b>' +
          litros(x.litros) + '  ·  ' + pctTxt(x.litros, p.litros) + '  ·  ' +
          nf(x.abastecimentos, 0) + ' abast.  ·  ' + reais(x.faturamento) + '</b></div>';
      }).join('') + '</div>';
    }
    return '<div class="mp-posto' + (aberto ? ' aberto' : '') + '">' +
      '<button type="button" class="mp-p-linha" aria-expanded="' + (aberto ? 'true' : 'false') + '"' +
        ' onclick="__mpPosto(\'' + esc(p.posto_id) + '\')">' +
        '<span class="mp-p-nome">' + esc(p.posto_nome || '—') + '</span>' +
        htmlBarra(p) +
        numero +
        '<span class="mp-p-pct">' + pctTxt(v, total) + '</span>' +
      '</button>' + det +
    '</div>';
  }

  function htmlLista() {
    // Ordena pelo valor MOSTRADO: com Soutag ligado, a lista é o ranking de
    // Soutag. Ordenar sempre por total faria o primeiro da lista ser um posto
    // com o menor número da coluna.
    var lista = _dados.postos.slice().sort(function (a, b) { return valorDe(b) - valorDe(a); });
    if (!lista.length) return '<div class="mp-vazio">Sem venda no período.</div>';
    return '<div class="mp-lista">' + lista.map(htmlPosto).join('') + '</div>';
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
