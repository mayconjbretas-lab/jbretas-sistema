// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/app-cupons.js
// Aba APP da Movimentação (Relatórios): preço por litro dos convênios
// Soutag e 99, por posto. ADITIVO: expõe window.renderAppCupons(sec),
// chamado pelo relAbrir() — mesmo padrão do renderMovPostos/renderDre.
//
// NADA DO QUE JÁ EXISTIA FOI TOCADO. Bloco novo, CSS próprio injetado uma
// vez (.ap-*), seção própria (#s-app). Movimentação, DRE, Mercado e
// Relatório seguem byte por byte.
//
// FONTE: GET /app/cupons?de&ate&canal, que devolve rede + postos, cada um
// com por_combustivel[]. UMA chamada por (período × canal).
//
// ════════ O CHIP DE COMBUSTÍVEL NÃO REBUSCA ════════
// A resposta já traz TODOS os combustíveis em cada nível. Trocar de GC para
// ET é recorte do que está na memória, não ida ao servidor — é o que faz o
// clique no chip ser instantâneo, e é o que o pedido manda. Só mudar
// período ou canal refaz o fetch.
//
// ════════ CUPOM × ITEM ════════
// A rota devolve os dois: `cupons` é id_cupom distinto, `itens` é linha
// (um cupom com GC e S10 são duas). Medido em 14/09/2026: 4.929 itens para
// 4.021 cupons. A tela mostra CUPONS, que é o que alguém conta; `itens`
// aparece só no detalhe do posto, onde a diferença tem onde ser explicada.
//
// ════════ PREÇO MÉDIO ════════
// Usa `preco_medio` (AVG por item), que é o pedido. A rota também devolve
// `preco_medio_ponderado` (valor ÷ litros) e ele vai no DETALHE: é o número
// que reconcilia com R$ TOTAL ÷ LITROS da mesma linha, e sem ele alguém faz
// essa divisão, acha outro número e abre chamado.
// ================================================================
(function () {
  'use strict';

  var CANAIS = {
    SOUTAG: { rot: 'Soutag', cor: '#3C3489', fundo: '#EEEDFE' },
    '99':   { rot: '99',     cor: '#633806', fundo: '#FAEEDA' },
  };
  // Os quatro do pedido. A resposta traz mais (S500, ETAD, POD, GNV) — eles
  // aparecem no DETALHE do posto, que mostra tudo que o posto teve; nos
  // chips ficam de fora de propósito, porque a barra é de escolha rápida.
  var COMBS = ['GC', 'GA', 'ET', 'S10'];

  var _sec = null;
  var _pronto = false;
  var _canal = 'SOUTAG';
  var _comb = 'GC';
  var _de = '';
  var _ate = '';
  var _dados = null;
  var _carregando = false;
  var _erro = '';
  var _seq = 0;
  var _postoAberto = null;
  var _ordem = 'litros';      // litros | cupons | medio | min | max | valor

  // ── Formatação (reusa o mmFmt, como o movimentacao-postos) ──────
  function nf(v, casas) {
    if (window.mmFmt && window.mmFmt.nf) return window.mmFmt.nf(v, casas);
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  function esc(s) {
    if (window.mmFmt && window.mmFmt.esc) return window.mmFmt.esc(s);
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Preço com 3 casas: a diferença entre postos mora na terceira (6,008 ×
  // 6,010), e 2 casas achataria justamente o que a tela existe para mostrar.
  function preco(v) { return (v === null || v === undefined) ? '—' : 'R$ ' + nf(v, 3); }
  function litros(v) { return (v === null || v === undefined) ? '—' : nf(v, 0) + ' L'; }
  function reais(v) { return (v === null || v === undefined) ? '—' : 'R$ ' + nf(v, 2); }
  function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
  function somaDias(iso, n) {
    var p = String(iso).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ── CSS (injetado uma vez, escopo .ap-*) ────────────────────────
  // Fora do painel-adm.css de propósito: a regra desta tarefa é não tocar no
  // que existe, e uma folha compartilhada é justamente onde um seletor novo
  // encosta no antigo sem querer.
  function injetarEstilo() {
    if (document.getElementById('app-cupons-style')) return;
    var st = document.createElement('style');
    st.id = 'app-cupons-style';
    st.textContent =
      '#s-app.active{display:block}' +
      '.ap-wrap{display:flex;flex-direction:column;gap:.7rem}' +
      // Barra de controles: sub-canal, datas, atalhos e chips.
      '.ap-barra{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}' +
      '.ap-cbtn{flex:0 0 auto;border:1px solid var(--bd);border-radius:8px;padding:.35rem .9rem;' +
        'font:700 .74rem var(--mono);letter-spacing:.04em;cursor:pointer;background:var(--sf2);color:var(--tx2)}' +
      '.ap-cbtn.on{border-color:transparent}' +
      '.ap-datas{display:flex;align-items:center;gap:.35rem;font:.7rem var(--mono);color:var(--tx3)}' +
      '.ap-data{background:var(--sf2);border:1px solid var(--bd);border-radius:6px;color:var(--tx);' +
        'padding:.25rem .4rem;font:.72rem var(--mono)}' +
      '.ap-atalho{background:var(--sf2);border:1px solid var(--bd);border-radius:6px;color:var(--tx2);' +
        'padding:.25rem .6rem;font:.68rem var(--mono);cursor:pointer}' +
      '.ap-atalho:hover{color:var(--tx);border-color:var(--ac)}' +
      // Desativado de verdade: sem cursor de mão e sem hover, para não
      // prometer clique. O title explica por quê.
      '.ap-atalho[disabled],.ap-cbtn[disabled]{opacity:.45;cursor:not-allowed}' +
      '.ap-atalho[disabled]:hover{color:var(--tx2);border-color:var(--bd)}' +
      '.ap-chips{display:flex;gap:.3rem;flex-wrap:wrap}' +
      '.ap-chip{background:var(--sf2);border:1px solid var(--bd);border-radius:6px;color:var(--tx2);' +
        'padding:.25rem .6rem;font:700 .68rem var(--mono);cursor:pointer}' +
      '.ap-chip.on{background:var(--ac);border-color:var(--ac);color:#0a0d0f}' +
      // CARDS — 150×96 e gap 8, as medidas da Movimentação.
      '.ap-cards{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:8px}' +
      '.ap-card{flex:0 0 auto;box-sizing:border-box;width:150px;height:96px;display:flex;' +
        'flex-direction:column;justify-content:center;gap:2px;padding:.5rem .6rem;text-align:left;' +
        'background:var(--sf2);border:1px solid var(--bd);border-radius:10px;cursor:pointer;' +
        'position:relative;font:inherit;color:var(--tx)}' +
      '.ap-card.aberto,.ap-card:hover{border-color:var(--ac)}' +
      '.ap-rot{font:700 .58rem var(--mono);letter-spacing:.06em;color:var(--tx3);text-transform:uppercase}' +
      '.ap-num{font:700 1.05rem var(--sans);line-height:1.1}' +
      '.ap-sub{font:.6rem var(--mono);color:var(--tx3)}' +
      '.ap-seta{position:absolute;top:5px;right:7px;font-size:.7rem;color:var(--ac)}' +
      // LISTA — SETE colunas fixas de 150px, gap 8: 7×150 + 6×8 = 1098px.
      // NADA DE 1fr, mesma razão da Movimentação: com fração a lista espalha
      // os números até a borda do monitor, longe do nome do posto.
      '.ap-lista{display:flex;flex-direction:column;margin-top:.2rem}' +
      '.ap-cab,.ap-linha,.ap-rede{display:grid;grid-template-columns:repeat(7,150px);' +
        'justify-content:start;align-items:center;gap:.7rem 8px;width:100%;padding:7px 0;' +
        'background:transparent;border:0;text-align:left;font:inherit;color:var(--tx)}' +
      '.ap-cab{padding:0 0 5px;border-bottom:1px solid var(--bd)}' +
      '.ap-cab span{font:700 .58rem var(--mono);letter-spacing:.05em;color:var(--tx3);text-transform:uppercase}' +
      '.ap-linha{cursor:pointer;border-bottom:1px solid var(--bd)}' +
      '.ap-linha:hover{background:color-mix(in srgb,var(--ac) 7%,transparent)}' +
      '.ap-rede{border-bottom:2px solid var(--bd);font-weight:700}' +
      '.ap-rede span{font:700 .74rem var(--mono)}' +
      '.ap-nome{font-size:.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      // Numéricas à direita, como na Movimentação.
      '.ap-n{text-align:right;font:.74rem var(--mono)}' +
      '.ap-mini{display:block;font:.6rem var(--mono);color:var(--tx3)}' +
      '.ap-det{padding:.4rem 0 .8rem;border-bottom:1px solid var(--bd)}' +
      '.ap-det table{border-collapse:collapse;width:auto}' +
      '.ap-det th{font:700 .58rem var(--mono);letter-spacing:.05em;color:var(--tx3);' +
        'text-transform:uppercase;padding:.3rem .7rem .3rem 0;text-align:right}' +
      '.ap-det th:first-child{text-align:left}' +
      '.ap-det td{font:.72rem var(--mono);color:var(--tx);padding:.28rem .7rem .28rem 0;text-align:right}' +
      '.ap-det td:first-child{text-align:left;font-weight:600}' +
      '.ap-estado,.ap-vazio{font:.75rem var(--mono);color:var(--tx3);padding:1rem 0}' +
      '.ap-erro{font:.75rem var(--mono);color:var(--dg);padding:1rem 0}' +
      // MOBILE: cards 2 por linha e as colunas de preço saem da linha — elas
      // vivem no detalhe do posto, que no celular é a visão completa.
      '@media (max-width:699px){' +
        '.ap-card{width:calc(50% - 4px)}' +
        '.ap-cab{display:none}' +
        '.ap-linha,.ap-rede{grid-template-columns:1fr auto;gap:4px .7rem}' +
        '.ap-c-med,.ap-c-min,.ap-c-max,.ap-c-valor{display:none}' +
        '.ap-det table{width:100%}' +
      '}';
    document.head.appendChild(st);
  }

  // ── Dados ───────────────────────────────────────────────────────
  // Só período e canal vão à rota. O combustível é recorte local.
  async function carregar() {
    _carregando = true; _erro = ''; pintar();
    var meu = ++_seq;
    try {
      var url = '/app/cupons?de=' + encodeURIComponent(_de) +
                '&ate=' + encodeURIComponent(_ate) +
                '&canal=' + encodeURIComponent(_canal);
      var r = await apiFetch(url);
      if (meu !== _seq) return;     // resposta velha de um clique anterior
      _dados = r;
    } catch (e) {
      if (meu !== _seq) return;
      _dados = null;
      _erro = (e && e.message) ? e.message : 'Falha ao carregar';
    } finally {
      if (meu === _seq) { _carregando = false; pintar(); }
    }
  }

  // O bloco do combustível escolhido dentro de um nível (rede ou posto).
  // null quando o posto não vendeu aquele combustível no período — e null
  // vira travessão na tela, não zero: não vender não é vender zero.
  function doComb(nivel) {
    if (!nivel || !nivel.por_combustivel) return null;
    for (var i = 0; i < nivel.por_combustivel.length; i++) {
      if (nivel.por_combustivel[i].combustivel === _comb) return nivel.por_combustivel[i];
    }
    return null;
  }

  // ── Ações ───────────────────────────────────────────────────────
  window.__apCanal = function (c) {
    if (!CANAIS[c] || c === _canal) return;
    _canal = c; _postoAberto = null;
    gravarHashApp();
    carregar();       // canal é outro recorte no servidor
  };
  window.__apComb = function (c) {
    if (COMBS.indexOf(c) < 0 || c === _comb) return;
    _comb = c; _postoAberto = null;
    pintar();         // recorte LOCAL: o JSON já tem todos os combustíveis
  };
  window.__apData = function (qual, v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return;
    if (qual === 'de') _de = v; else _ate = v;
    if (_ate < _de) { _erro = 'Fim anterior ao início.'; _dados = null; pintar(); return; }
    _postoAberto = null;
    carregar();
  };
  window.__apAtalho = function (qual) {
    var ontem = somaDias(hojeISO(), -1);
    if (qual === 'ontem') { _de = ontem; _ate = ontem; }
    if (qual === '7')  { _ate = ontem; _de = somaDias(ontem, -6); }
    if (qual === '30') { _ate = ontem; _de = somaDias(ontem, -29); }
    _postoAberto = null;
    carregar();
  };
  window.__apCard = function (id) {
    _ordem = (_ordem === id) ? 'litros' : id;   // clicar de novo volta ao padrão
    pintar();
  };
  window.__apPosto = function (id) {
    _postoAberto = (_postoAberto === id) ? null : id;
    pintar();
  };

  // ── Hash ────────────────────────────────────────────────────────
  // #app e #app/soutag. Quem lê é o aplicarHash do app.js; aqui só se
  // escreve, e só quando a aba App está à vista.
  function gravarHashApp() {
    if (typeof window.__apHash === 'function') window.__apHash(_canal);
  }
  // Chamado pelo app.js ao aplicar um hash com canal.
  window.__apSetCanal = function (c) {
    if (CANAIS[c] && c !== _canal) { _canal = c; _dados = null; }
  };
  window.__apCanalAtual = function () { return _canal; };

  // ── Render ──────────────────────────────────────────────────────
  function htmlBarra() {
    var cb = function (c) {
      var on = (_canal === c), cfg = CANAIS[c];
      // A cor do canal é INLINE porque ela é dado, não estilo fixo: os dois
      // hex vêm do pedido e ficam no mapa CANAIS, um lugar só.
      var estilo = on ? ' style="background:' + cfg.fundo + ';color:' + cfg.cor + '"' : '';
      return '<button type="button" class="ap-cbtn' + (on ? ' on' : '') + '"' + estilo +
        ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
        ' onclick="__apCanal(\'' + c + '\')">' + esc(cfg.rot) + '</button>';
    };
    var chip = function (c) {
      return '<button type="button" class="ap-chip' + (_comb === c ? ' on' : '') + '"' +
        ' aria-pressed="' + (_comb === c ? 'true' : 'false') + '"' +
        ' onclick="__apComb(\'' + c + '\')">' + esc(c) + '</button>';
    };
    return '<div class="ap-barra">' +
        cb('SOUTAG') + cb('99') +
        '<div class="ap-datas">' +
          'de <input type="date" class="ap-data" value="' + esc(_de) + '" onchange="__apData(\'de\', this.value)">' +
          'até <input type="date" class="ap-data" value="' + esc(_ate) + '" onchange="__apData(\'ate\', this.value)">' +
        '</div>' +
        '<button type="button" class="ap-atalho" onclick="__apAtalho(\'ontem\')">Ontem</button>' +
        '<button type="button" class="ap-atalho" onclick="__apAtalho(\'7\')">7 dias</button>' +
        '<button type="button" class="ap-atalho" onclick="__apAtalho(\'30\')">30 dias</button>' +
        // Vista por motorista: botão à vista e desativado. O dado de cliente
        // que a TecnoX manda hoje não identifica ninguém — 99,6% dos cupons
        // vêm com o mesmo cod_cliente "1". Sem isso a vista existiria
        // mostrando "todos os clientes do posto" como se fosse um.
        '<button type="button" class="ap-atalho" disabled aria-disabled="true"' +
          ' title="em breve — aguardando dados do convênio">Por motorista</button>' +
        '<div class="ap-chips">' + COMBS.map(chip).join('') + '</div>' +
      '</div>';
  }

  function seta(id) { return _ordem === id ? '<span class="ap-seta">↓</span>' : ''; }

  function htmlCards() {
    var c = doComb(_dados.rede);
    var cor = CANAIS[_canal].cor;
    var card = function (id, rot, valor, sub) {
      return '<button type="button" class="ap-card' + (_ordem === id ? ' aberto' : '') + '"' +
        ' onclick="__apCard(\'' + id + '\')">' + seta(id) +
        '<div class="ap-rot">' + esc(rot) + '</div>' +
        '<div class="ap-num" style="color:' + cor + '">' + valor + '</div>' +
        '<div class="ap-sub">' + sub + '</div>' +
      '</button>';
    };
    return '<div class="ap-cards">' +
      card('medio', 'Preço médio', c ? preco(c.preco_medio) : '—', 'por litro · ' + esc(_comb)) +
      card('min', 'Preço mínimo', c ? preco(c.preco_min) : '—', 'menor praticado') +
      card('max', 'Preço máximo', c ? preco(c.preco_max) : '—', 'maior praticado') +
      card('cupons', 'Cupons', c ? nf(c.cupons, 0) : '—',
        c ? (litros(c.litros) + ' · ' + reais(c.valor)) : '—') +
    '</div>';
  }

  function valorOrdem(p) {
    var c = doComb(p);
    if (!c) return -Infinity;    // posto sem o combustível afunda, não some
    if (_ordem === 'cupons') return c.cupons;
    if (_ordem === 'medio') return c.preco_medio === null ? -Infinity : c.preco_medio;
    if (_ordem === 'min') return c.preco_min === null ? -Infinity : c.preco_min;
    if (_ordem === 'max') return c.preco_max === null ? -Infinity : c.preco_max;
    if (_ordem === 'valor') return c.valor;
    return c.litros;
  }

  function htmlCab() {
    var h = function (cls, rot, id) {
      return '<span class="' + cls + '">' + esc(rot) + (id && _ordem === id ? ' ↓' : '') + '</span>';
    };
    return '<div class="ap-cab">' +
      h('ap-nome', 'Posto') +
      h('ap-n', 'Cupons', 'cupons') +
      h('ap-n', 'Litros', 'litros') +
      h('ap-n ap-c-med', 'Preço méd.', 'medio') +
      h('ap-n ap-c-min', 'Preço mín.', 'min') +
      h('ap-n ap-c-max', 'Preço máx.', 'max') +
      h('ap-n ap-c-valor', 'R$ total', 'valor') +
    '</div>';
  }

  // Célula de preço médio na cor do canal — é a coluna que a tela existe
  // para comparar entre postos.
  function celulas(c, cor) {
    if (!c) {
      return '<span class="ap-n">—</span><span class="ap-n">—</span>' +
        '<span class="ap-n ap-c-med">—</span><span class="ap-n ap-c-min">—</span>' +
        '<span class="ap-n ap-c-max">—</span><span class="ap-n ap-c-valor">—</span>';
    }
    return '<span class="ap-n">' + nf(c.cupons, 0) + '</span>' +
      '<span class="ap-n">' + litros(c.litros) + '</span>' +
      '<span class="ap-n ap-c-med" style="color:' + cor + ';font-weight:700">' + preco(c.preco_medio) + '</span>' +
      '<span class="ap-n ap-c-min">' + preco(c.preco_min) + '</span>' +
      '<span class="ap-n ap-c-max">' + preco(c.preco_max) + '</span>' +
      '<span class="ap-n ap-c-valor">' + reais(c.valor) + '</span>';
  }

  // Detalhe: TODOS os combustíveis do posto, não só o do chip — é o que o
  // clique na linha promete.
  function htmlDetalhe(p) {
    var lin = (p.por_combustivel || []).map(function (c) {
      return '<tr>' +
        '<td>' + esc(c.combustivel) + '</td>' +
        '<td>' + nf(c.cupons, 0) + '</td>' +
        '<td>' + nf(c.itens, 0) + '</td>' +
        '<td>' + litros(c.litros) + '</td>' +
        '<td>' + preco(c.preco_medio) + '</td>' +
        '<td>' + preco(c.preco_min) + '</td>' +
        '<td>' + preco(c.preco_max) + '</td>' +
        '<td>' + reais(c.valor) + '</td>' +
      '</tr>';
    }).join('');
    if (!lin) return '<div class="ap-det"><div class="ap-vazio">Sem cupom deste canal no período.</div></div>';
    return '<div class="ap-det"><table>' +
      '<thead><tr><th>Combustível</th><th>Cupons</th><th>Itens</th><th>Litros</th>' +
      '<th>Preço méd.</th><th>Preço mín.</th><th>Preço máx.</th><th>R$ total</th></tr></thead>' +
      '<tbody>' + lin + '</tbody></table>' +
      // Cupom × item e a média ponderada, explicados onde há espaço.
      '<div class="ap-sub" style="margin-top:.4rem">' +
        'Cupons são notas distintas; itens são linhas (uma nota com dois combustíveis conta nos dois). ' +
        'Preço médio é a média dos itens; R$ total ÷ litros dá ' +
        (function () {
          var c = doComb(p);
          return (c && c.preco_medio_ponderado != null) ? preco(c.preco_medio_ponderado) + ' em ' + esc(_comb) : '—';
        })() + '.' +
      '</div>' +
    '</div>';
  }

  function htmlLista() {
    var cor = CANAIS[_canal].cor;
    var postos = (_dados.postos || []).slice().sort(function (a, b) {
      return valorOrdem(b) - valorOrdem(a);
    });
    if (!postos.length) return '<div class="ap-vazio">Sem cupom de ' + esc(CANAIS[_canal].rot) + ' no período.</div>';
    var redeC = doComb(_dados.rede);
    var linhas = postos.map(function (p) {
      var aberto = (_postoAberto === p.posto_id);
      return '<button type="button" class="ap-linha" aria-expanded="' + (aberto ? 'true' : 'false') + '"' +
          ' onclick="__apPosto(\'' + esc(p.posto_id) + '\')">' +
          '<span class="ap-nome">' + esc(p.nome || '—') + '</span>' +
          celulas(doComb(p), cor) +
        '</button>' + (aberto ? htmlDetalhe(p) : '');
    }).join('');
    return '<div class="ap-lista">' + htmlCab() +
      // REDE no TOPO, como pediu — e é a soma dos postos no combustível do
      // chip, não o total geral da resposta.
      '<div class="ap-rede"><span class="ap-nome">REDE</span>' + celulas(redeC, cor) + '</div>' +
      linhas + '</div>';
  }

  function pintar() {
    if (!_sec) return;
    var alvo = _sec.querySelector('#ap-corpo');
    if (!alvo) return;
    var cab = htmlBarra();
    if (_carregando) { alvo.innerHTML = cab + '<div class="ap-estado">Carregando…</div>'; return; }
    if (_erro) { alvo.innerHTML = cab + '<div class="ap-erro">' + esc(_erro) + '</div>'; return; }
    if (!_dados) { alvo.innerHTML = cab + '<div class="ap-estado">—</div>'; return; }
    alvo.innerHTML = cab + htmlCards() + htmlLista();
  }

  // ── Entrada pública ─────────────────────────────────────────────
  window.renderAppCupons = function (sec) {
    if (!sec) return;
    _sec = sec;
    injetarEstilo();
    if (!_pronto || !sec.querySelector('#ap-corpo')) {
      sec.innerHTML = '<div class="ap-wrap"><div id="ap-corpo"></div></div>';
      _pronto = true;
    }
    if (!_de || !_ate) {
      var ontem = somaDias(hojeISO(), -1);
      _de = ontem; _ate = ontem;    // padrão: ontem
      carregar();
      return;
    }
    if (!_dados && !_carregando) { carregar(); return; }
    pintar();     // reabertura: não refaz a chamada
  };
})();
