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
  // Os cinco da barra. A resposta traz mais (S500, ETAD, POD) — esses
  // aparecem no DETALHE do posto, que mostra tudo que o posto teve; na barra
  // ficam de fora de propósito, porque ela é de escolha rápida.
  //
  // GNV ENTROU em 16/09/2026: ele existe na tecnox_cupom_app e tem volume de
  // convênio (14/09, Soutag: 53 itens, 30 deles no preço de app), e três
  // postos da rede o vendem. Sem o chip, o único jeito de ver o preço de GNV
  // era abrir posto por posto no detalhe.
  var COMBS = ['GC', 'GA', 'ET', 'S10', 'GNV'];

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
  // ════════ SÓ PREÇO DE APP ════════
  // LIGADO POR PADRÃO, como pedido. Parte dos cupons do convênio é cobrada
  // no PREÇO DA PLACA — o mesmo da pista, sem desconto nenhum. Medido em
  // 14/09/2026, Soutag/GC: 558 dos 1.390 itens, 40%. Eles puxam a média para
  // cima e mandam o preço MÁXIMO para o preço de bomba, que é justamente o
  // número que a tela não deveria estar mostrando como "preço de app".
  //
  // O FILTRO NÃO É FEITO AQUI, e não por preguiça: esta tela recebe o
  // AGREGADO (média, mínimo, máximo, distinto de cupom por nível), e de uma
  // média não se subtrai um subconjunto nem se recupera o mínimo que saiu com
  // ele. A rota manda a conta PRONTA nas duas versões, calculada pela mesma
  // função; aqui se troca de bloco na memória. O clique é instantâneo e NÃO
  // refaz chamada, que era o ponto do pedido — ver o bloco "POR QUE A
  // AGREGAÇÃO VEM DUAS VEZES" na GET /app/cupons.
  var _soApp = true;

  // ════════ VISTA: POR POSTO | POR CUPOM ════════
  // "Por posto" é a lista de sempre (agregado por posto, da /app/cupons).
  // "Por cupom" é o item a item, da /app/cupons-detalhe — uma rota separada
  // porque o agregado não guarda a linha e a linha não cabe no agregado.
  //
  // CACHE POR CHAVE, e é o que faz a troca de vista não rebuscar: a chave é
  // período + canal + so_app, tudo que muda o conjunto. Trocar de vista com a
  // mesma chave desenha do que está na memória; trocar período ou canal muda
  // a chave e a próxima abertura da vista busca.
  var _vista = 'posto';
  var _det = null;          // resposta da /app/cupons-detalhe
  var _detChave = '';       // a chave do que está em _det
  var _detCarregando = false;
  var _detErro = '';
  // Ordenação da lista de cupons. O padrão é o da rota (preço crescente):
  // a pergunta da vista é quem pagou mais barato.
  var _ordemDet = { campo: 'preco', dir: 'asc' };

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
      // display:block e NÃO flex na seção: a .scr do painel é flex com
      // height:100% no desktop, e nesta aba o conteúdo tem altura própria.
      // Quem centraliza é o .ap-wrap, com margin auto.
      '#s-app.active{display:block}' +
      // TETO DE 1400px E CENTRADO. A lista tem sete colunas fixas de 150px
      // (1.098px de conteúdo): num monitor largo, sem teto, a borda inferior
      // de cada linha atravessava a tela inteira e deixava os números
      // ilhados à esquerda de um metro de vazio. Com o teto, a faixa branca
      // fica nas DUAS laterais e a lista para onde o conteúdo para.
      // SEM GAP AQUI, e a razão importa: o .ap-wrap tem UM filho só, o
      // #ap-corpo. Barra, cards e lista são filhos DELE, não do wrap, então um
      // gap no wrap não separa nada — media 0px entre a barra e os cards com
      // `gap:16px` declarado. O espaçamento dos três blocos vive nas margens
      // de cada um, logo abaixo, e é lá que se mexe.
      '.ap-wrap{display:flex;flex-direction:column;max-width:1400px;margin:0 auto}' +
      // Barra de controles: sub-canal, datas, atalhos e chips.
      // 20px até os cards. O gap interno de .5rem continua sendo o espaço
      // ENTRE os controles da barra; o margin-bottom é o que a separa do
      // bloco de baixo.
      '.ap-barra{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:20px}' +
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
      '.ap-chips{display:flex;gap:12px;flex-wrap:wrap}' +
      '.ap-chip{background:var(--sf2);border:1px solid var(--bd);border-radius:6px;color:var(--tx2);' +
        'padding:.25rem .6rem;font:700 .68rem var(--mono);cursor:pointer}' +
      '.ap-chip.on{background:var(--ac);border-color:var(--ac);color:#0a0d0f}' +
      // Os dois botões de vista: .ap-atalho com estado, porque são escolha
      // de UMA entre duas — não são atalho de período como os vizinhos.
      '.ap-vbtn.on{background:var(--acd);border-color:var(--ac);color:var(--ac)}' +
      // O toggle: verde quando ligado, para não ser confundido com um chip de
      // combustível selecionado (amarelo do --ac). Desativado quando a
      // resposta não traz o bloco filtrado.
      '.ap-so{margin-left:.3rem}' +
      '.ap-so.on{background:#E1F5EE;border-color:#0F6E56;color:#085041}' +
      '.ap-so[disabled]{opacity:.45;cursor:not-allowed}' +
      // CARDS — 150×96 e gap 8, as medidas da Movimentação.
      // gap 12: o card segue 150×96 (a medida compartilhada com a
      // Movimentação), só o espaço entre eles aumentou. Ver o mobile abaixo:
      // o calc() de "dois por linha" desconta METADE deste gap, e os dois
      // números têm de andar juntos.
      '.ap-cards{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:12px;margin-bottom:20px}' +
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
      // margin-top ZERO: os .2rem que havia aqui somavam 3,2px aos 20px do
      // margin-bottom dos cards e o vão media 23,2px. Quem manda no
      // espaçamento é o bloco de cima, um lugar só.
      '.ap-lista{display:flex;flex-direction:column;margin-top:0}' +
      // 10px em cima e embaixo (era 7): a lista tem 30+ linhas de números
      // monoespaçados, e o respiro é o que separa uma leitura de linha da
      // vizinha sem precisar de zebra.
      '.ap-cab,.ap-linha,.ap-rede{display:grid;grid-template-columns:repeat(7,150px);' +
        'justify-content:start;align-items:center;gap:.7rem 8px;width:100%;padding:10px 0;' +
        'background:transparent;border:0;text-align:left;font:inherit;color:var(--tx)}' +
      '.ap-cab{padding:0 0 5px;border-bottom:1px solid var(--bd)}' +
      '.ap-cab span{font:700 .58rem var(--mono);letter-spacing:.05em;color:var(--tx3);text-transform:uppercase}' +
      '.ap-linha{cursor:pointer;border-bottom:1px solid var(--bd)}' +
      '.ap-linha:hover{background:color-mix(in srgb,var(--ac) 7%,transparent)}' +
      // 4px a mais embaixo que as linhas de posto. A borda de 2px já separa;
      // o respiro extra é o que faz a REDE ler como cabeçalho de totais em
      // vez de como o primeiro posto da lista.
      // padding-top de 8px, como pedido. ATENÇÃO AO NÚMERO: a regra
      // compartilhada acima dá 10px a todas as linhas, então isto ENCOLHE o
      // topo da REDE de 10 para 8 — o vão entre o cabeçalho e ela sai de 15px
      // (5 do cabeçalho + 10) para 13px. Se a intenção era 8px A MAIS, o
      // número aqui é 18px.
      '.ap-rede{border-bottom:2px solid var(--bd);font-weight:700;padding-top:8px;padding-bottom:14px}' +
      '.ap-rede span{font:700 .74rem var(--mono)}' +
      '.ap-nome{font-size:.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      // Numéricas à direita, como na Movimentação.
      '.ap-n{text-align:right;font:.74rem var(--mono)}' +
      '.ap-mini{display:block;font:.6rem var(--mono);color:var(--tx3)}' +
      // Indentado 20px: o detalhe pertence à linha de cima, e alinhado com
      // ela parecia mais uma linha da lista.
      '.ap-det{padding:.4rem 0 .8rem 20px;border-bottom:1px solid var(--bd)}' +
      '.ap-det table{border-collapse:collapse;width:auto}' +
      '.ap-det th{font:700 .58rem var(--mono);letter-spacing:.05em;color:var(--tx3);' +
        'text-transform:uppercase;padding:.3rem .7rem .3rem 0;text-align:right}' +
      '.ap-det th:first-child{text-align:left}' +
      '.ap-det td{font:.72rem var(--mono);color:var(--tx);padding:.28rem .7rem .28rem 0;text-align:right}' +
      '.ap-det td:first-child{text-align:left;font-weight:600}' +
      // ── Lista POR CUPOM ──
      // Seis colunas: as três primeiras com largura própria (data curta, nome
      // de posto e código) e as três de número com os mesmos 110px. Fixas, e
      // não 1fr, pela razão de sempre nesta tela: com fração os números
      // espalham até a borda e param longe do nome.
      '.ap-cab-cup{grid-template-columns:64px 230px 104px 110px 110px 120px}' +
      '.ap-linha-cup{cursor:default}' +
      '.ap-linha-cup:hover{background:color-mix(in srgb,var(--ac) 5%,transparent)}' +
      '.ap-c-data{font:.72rem var(--mono);color:var(--tx3)}' +
      '.ap-c-posto{overflow:hidden}' +
      // O badge herda a cor do canal (roxo Soutag / âmbar 99), inline: a cor
      // é dado, e vive no mapa CANAIS.
      '.ap-badge{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;border-radius:20px;padding:2px 9px;font:700 .66rem var(--mono)}' +
      '.ap-cchip{display:inline-block;border:1px solid var(--bd);border-radius:5px;padding:1px 7px;font:700 .64rem var(--mono);color:var(--tx2);background:var(--sf2)}' +
      // Cabeçalho clicável: é botão de verdade (ordena), então tem cursor e
      // hover. O resto do visual é o do .ap-cab span, para a linha não mudar
      // de peso só porque virou botão.
      '.ap-th{background:transparent;border:0;padding:0;text-align:inherit;cursor:pointer;font:700 .58rem var(--mono);letter-spacing:.05em;color:var(--tx3);text-transform:uppercase}' +
      '.ap-th:hover{color:var(--tx)}' +
      '.ap-seta-in{color:var(--ac);margin-left:3px}' +
      '.ap-aviso{font:.7rem var(--mono);color:var(--wn,var(--ac));padding:.5rem 0 0}' +
      '.ap-estado,.ap-vazio{font:.75rem var(--mono);color:var(--tx3);padding:1rem 0}' +
      '.ap-erro{font:.75rem var(--mono);color:var(--dg);padding:1rem 0}' +
      // MOBILE: cards 2 por linha e as colunas de preço saem da linha — elas
      // vivem no detalhe do posto, que no celular é a visão completa.
      '@media (max-width:699px){' +
        // METADE do gap de 12 do .ap-cards. Com o 4px de quando o gap era 8,
        // os dois cards somavam 100% + 4px e o segundo caía para a linha de
        // baixo, um por linha.
        '.ap-card{width:calc(50% - 6px)}' +
        '.ap-cab{display:none}' +
        '.ap-linha,.ap-rede{grid-template-columns:1fr auto;gap:4px .7rem}' +
        '.ap-c-med,.ap-c-min,.ap-c-max,.ap-c-valor{display:none}' +
        // POR CUPOM no celular: duas colunas (o que identifica à esquerda, o
        // número à direita) e as três de número viram linhas dentro da célula.
        // Esconder colunas aqui não serve — todas as seis são o dado.
        '.ap-cab-cup{grid-template-columns:1fr auto}' +
        '.ap-cab.ap-cab-cup{display:none}' +
        '.ap-linha-cup .ap-c-comb,.ap-rede.ap-cab-cup .ap-c-comb{display:none}' +
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

  // O bloco que a tela está mostrando: o filtrado ou o cheio. Tolera resposta
  // SEM so_app (API antiga no ar por alguns minutos depois do deploy do
  // front): cai no cheio e o toggle fica desativado, em vez de a tela zerar.
  function vista() {
    if (!_dados) return null;
    return (_soApp && _dados.so_app) ? _dados.so_app : _dados;
  }
  function temFiltro() { return !!(_dados && _dados.so_app); }
  // posto_id -> o posto NA VISTA. A lista percorre os postos do bloco CHEIO
  // (para o posto não desaparecer quando todos os cupons dele são de placa) e
  // lê os números daqui.
  function idxVista() {
    var m = {}, v = vista();
    ((v && v.postos) || []).forEach(function (p) { m[p.posto_id] = p; });
    return m;
  }
  var _idx = {};

  function chaveDet() {
    return _de + '|' + _ate + '|' + _canal + '|' + (_soApp ? '1' : '0');
  }
  async function carregarDetalhe() {
    var chave = chaveDet();
    // ACERTO DE CACHE AINDA PINTA. Sem o pintar() aqui, voltar para a vista
    // de cupom com os dados já em mão trocava o _vista e não redesenhava —
    // a tela ficava na lista por posto. Não rebuscar não é não desenhar.
    if (_det && _detChave === chave) { pintar(); return; }
    _detCarregando = true; _detErro = ''; pintar();
    var meu = ++_seq;
    try {
      var url = '/app/cupons-detalhe?de=' + encodeURIComponent(_de) +
                '&ate=' + encodeURIComponent(_ate) +
                '&canal=' + encodeURIComponent(_canal) +
                (_soApp ? '&so_app=1' : '');
      var r = await apiFetch(url);
      if (meu !== _seq) return;
      _det = r; _detChave = chave;
    } catch (e) {
      if (meu !== _seq) return;
      _det = null; _detChave = '';
      _detErro = (e && e.message) ? e.message : 'Falha ao carregar os cupons';
    } finally {
      if (meu === _seq) { _detCarregando = false; pintar(); }
    }
  }
  // Período, canal e o toggle mudam a chave: o que está em _det fica velho.
  // Zerado aqui em vez de refetchado, para não buscar uma vista fechada.
  function invalidarDetalhe() { _det = null; _detChave = ''; _detErro = ''; }

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
    invalidarDetalhe();
    gravarHashApp();
    carregar();       // canal é outro recorte no servidor
    if (_vista === 'cupom') carregarDetalhe();
  };
  window.__apVista = function (v) {
    if (v !== 'posto' && v !== 'cupom') return;
    if (v === _vista) return;
    _vista = v;
    _postoAberto = null;
    if (v === 'cupom') carregarDetalhe();   // busca só se a chave mudou
    else pintar();
  };
  // Clique no cabeçalho ordena. Mesma coluna inverte o sentido; coluna nova
  // começa no sentido que a pergunta dela pede — preço e litros do menor para
  // o maior, data e valor do maior para o menor.
  window.__apOrdemDet = function (campo) {
    var PADRAO = { data: 'desc', posto: 'asc', comb: 'asc', litros: 'desc', preco: 'asc', valor: 'desc' };
    if (!PADRAO[campo]) return;
    if (_ordemDet.campo === campo) _ordemDet.dir = (_ordemDet.dir === 'asc' ? 'desc' : 'asc');
    else _ordemDet = { campo: campo, dir: PADRAO[campo] };
    pintar();
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
    invalidarDetalhe();
    carregar();
    if (_vista === 'cupom') carregarDetalhe();
  };
  window.__apAtalho = function (qual) {
    var ontem = somaDias(hojeISO(), -1);
    if (qual === 'ontem') { _de = ontem; _ate = ontem; }
    if (qual === '7')  { _ate = ontem; _de = somaDias(ontem, -6); }
    if (qual === '30') { _ate = ontem; _de = somaDias(ontem, -29); }
    _postoAberto = null;
    invalidarDetalhe();
    carregar();
    if (_vista === 'cupom') carregarDetalhe();
  };
  // Recorte LOCAL, como o chip de combustível: o JSON já tem os dois blocos.
  window.__apSoApp = function () {
    if (!temFiltro()) return;
    _soApp = !_soApp;
    _postoAberto = null;
    // A vista Por posto tem os dois blocos em mão e só troca; a Por cupom
    // depende do filtro ter sido feito no servidor, então rebusca.
    invalidarDetalhe();
    if (_vista === 'cupom') carregarDetalhe(); else pintar();
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
    var vbtn = function (v, rot) {
      var on = (_vista === v);
      return '<button type="button" class="ap-atalho ap-vbtn' + (on ? ' on' : '') + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
        ' onclick="__apVista(\'' + v + '\')">' + esc(rot) + '</button>';
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
        // AS DUAS VISTAS DA LISTA. Substituíram o botão "Por motorista", que
        // era um desativado à espera de dado de cliente que a TecnoX não
        // manda (99,6% dos cupons vêm com o mesmo cod_cliente "1"). O item a
        // item responde a mesma curiosidade sem depender daquele campo.
        vbtn('posto', 'Por posto') + vbtn('cupom', 'Por cupom') +
        '<div class="ap-chips">' + COMBS.map(chip).join('') + '</div>' +
        htmlSoApp() +
      '</div>';
  }

  // O toggle. Estilo do .ap-chip — é um recorte local como eles —, mas fora
  // do .ap-chips: aquele grupo é de escolha ÚNICA (um combustível), e este é
  // um liga/desliga. Juntos, pareceria um quinto combustível.
  function htmlSoApp() {
    var on = _soApp && temFiltro();
    var q = (_dados && _dados.consulta) || {};
    // O title diz quantos itens saem e com que régua. É o que responde
    // "por que o número mudou" sem gastar uma linha da tela.
    var tit = temFiltro()
      ? (q.itens_placa || 0) + ' item(ns) no preço da placa, de ' + (q.linhas || 0) +
        ' — tolerância de ' + nf((q.tolerancia_placa || 0) * 100, 0) +
        ' centavo(s) contra o preço de pista do próprio posto no período'
      : 'a API ainda não manda o bloco filtrado';
    return '<button type="button" class="ap-chip ap-so' + (on ? ' on' : '') + '"' +
      (temFiltro() ? '' : ' disabled aria-disabled="true"') +
      ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
      ' title="' + esc(tit) + '"' +
      ' onclick="__apSoApp()">Só preço de app</button>';
  }

  function seta(id) { return _ordem === id ? '<span class="ap-seta">↓</span>' : ''; }

  function htmlCards() {
    var c = doComb(vista().rede);
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

  // Ordena pelo que a tela MOSTRA: com o filtro ligado, ordenar pelos números
  // cheios poria um posto grande em cupons de placa acima de um posto que
  // realmente vendeu no app.
  function valorOrdem(p) {
    var c = doComb(_idx[p.posto_id]);
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
  function htmlDetalhe(pCheio) {
    var p = _idx[pCheio.posto_id];
    // Com o filtro ligado e o posto inteiro a preço de placa não há tabela a
    // desenhar — e "sem cupom no período" seria falso, porque houve cupom.
    if (!p) {
      return '<div class="ap-det"><div class="ap-vazio">Todos os cupons deste posto no período saíram no preço da placa. ' +
        'Desligue "Só preço de app" para vê-los.</div></div>';
    }
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
    // PERCORRE OS POSTOS DO BLOCO CHEIO, sempre. Com o filtro ligado, um
    // posto cujos cupons foram TODOS a preço de placa não existe no bloco
    // filtrado; percorrer aquele bloco faria a linha desaparecer, e o pedido é
    // que ela fique com travessão. Sumir com a linha leria como "este posto
    // não vendeu no convênio", que é outra coisa.
    var postos = (_dados.postos || []).slice().sort(function (a, b) {
      return valorOrdem(b) - valorOrdem(a);
    });
    if (!postos.length) return '<div class="ap-vazio">Sem cupom de ' + esc(CANAIS[_canal].rot) + ' no período.</div>';
    var redeC = doComb(vista().rede);
    var linhas = postos.map(function (p) {
      var aberto = (_postoAberto === p.posto_id);
      return '<button type="button" class="ap-linha" aria-expanded="' + (aberto ? 'true' : 'false') + '"' +
          ' onclick="__apPosto(\'' + esc(p.posto_id) + '\')">' +
          '<span class="ap-nome">' + esc(p.nome || '—') + '</span>' +
          celulas(doComb(_idx[p.posto_id]), cor) +
        '</button>' + (aberto ? htmlDetalhe(p) : '');
    }).join('');
    return '<div class="ap-lista">' + htmlCab() +
      // REDE no TOPO, como pediu — e é a soma dos postos no combustível do
      // chip, não o total geral da resposta.
      '<div class="ap-rede"><span class="ap-nome">REDE</span>' + celulas(redeC, cor) + '</div>' +
      linhas + '</div>';
  }

  // ── Lista POR CUPOM ─────────────────────────────────────────────
  // Os itens do combustível do chip. O chip é de escolha ÚNICA (é o mesmo da
  // vista Por posto), então a coluna COMBUSTÍVEL mostra sempre o mesmo código
  // — ela fica porque é a linha do abastecimento, e ler uma linha sem saber de
  // que combustível ela é depende de lembrar qual chip está aceso.
  function itensDaVista() {
    var todos = (_det && _det.itens) || [];
    var so = todos.filter(function (i) { return i.combustivel === _comb; });
    var dir = (_ordemDet.dir === 'asc') ? 1 : -1;
    var campo = _ordemDet.campo;
    var valor = function (i) {
      if (campo === 'data') return i.data;
      if (campo === 'posto') return String(i.nome_posto || '');
      if (campo === 'comb') return String(i.combustivel || '');
      if (campo === 'litros') return Number(i.litros) || 0;
      if (campo === 'valor') return Number(i.valor_liquido) || 0;
      return i.preco_litro === null ? Infinity : Number(i.preco_litro);
    };
    // slice() antes do sort: ordenar no lugar mexeria em _det.itens, e a
    // próxima troca de chip herdaria a ordem da anterior.
    return so.slice().sort(function (a, b) {
      var va = valor(a), vb = valor(b);
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
  }
  function setaDet(campo) {
    if (_ordemDet.campo !== campo) return '';
    return '<span class="ap-seta-in">' + (_ordemDet.dir === 'asc' ? '↑' : '↓') + '</span>';
  }
  function htmlCabCupom() {
    var h = function (cls, rot, campo) {
      return '<button type="button" class="' + cls + ' ap-th"' +
        ' onclick="__apOrdemDet(\'' + campo + '\')">' + esc(rot) + setaDet(campo) + '</button>';
    };
    return '<div class="ap-cab ap-cab-cup">' +
      h('ap-c-data', 'Data', 'data') +
      h('ap-c-posto', 'Posto', 'posto') +
      h('ap-c-comb', 'Combustível', 'comb') +
      h('ap-n', 'Litros', 'litros') +
      h('ap-n', 'R$/litro', 'preco') +
      h('ap-n', 'Valor', 'valor') +
    '</div>';
  }
  function htmlListaCupom() {
    if (_detCarregando) return '<div class="ap-estado">Carregando cupons…</div>';
    if (_detErro) return '<div class="ap-erro">' + esc(_detErro) + '</div>';
    if (!_det) return '<div class="ap-estado">—</div>';
    var cor = CANAIS[_canal].cor, fundo = CANAIS[_canal].fundo;
    var itens = itensDaVista();
    if (!itens.length) {
      return htmlCabCupom() + '<div class="ap-vazio">Nenhum cupom de ' + esc(_comb) +
        ' neste recorte.</div>';
    }
    // REDE no topo: a soma DO QUE ESTÁ NA LISTA, não do dia inteiro — é o que
    // fecha com as linhas abaixo dela.
    var nL = 0, nV = 0, soma = 0, comPreco = 0;
    itens.forEach(function (i) {
      nL += Number(i.litros) || 0;
      nV += Number(i.valor_liquido) || 0;
      if (i.preco_litro !== null) { soma += Number(i.preco_litro); comPreco++; }
    });
    var rede = '<div class="ap-rede ap-cab-cup">' +
      '<span class="ap-c-data">REDE</span>' +
      // "cupons", não "cupom"+"s": o plural troca a letra. Um `+ 's'` dava
      // "cupoms" na tela.
      '<span class="ap-c-posto">' + nf(itens.length, 0) +
        (itens.length === 1 ? ' cupom' : ' cupons') + '</span>' +
      '<span class="ap-c-comb">' + esc(_comb) + '</span>' +
      '<span class="ap-n">' + litros(nL) + '</span>' +
      '<span class="ap-n" style="color:' + cor + ';font-weight:700">' +
        (comPreco ? preco(soma / comPreco) : '—') + '</span>' +
      '<span class="ap-n">' + reais(nV) + '</span>' +
    '</div>';
    var linhas = itens.map(function (i) {
      return '<div class="ap-linha ap-cab-cup ap-linha-cup">' +
        '<span class="ap-c-data">' + esc(diaCurto(i.data)) + '</span>' +
        '<span class="ap-c-posto"><span class="ap-badge" style="background:' + fundo +
          ';color:' + cor + '">' + esc(i.nome_posto || '—') + '</span></span>' +
        '<span class="ap-c-comb"><span class="ap-cchip">' + esc(i.combustivel) + '</span></span>' +
        '<span class="ap-n">' + litros(i.litros) + '</span>' +
        '<span class="ap-n" style="color:' + cor + ';font-weight:700">' + preco(i.preco_litro) + '</span>' +
        '<span class="ap-n">' + reais(i.valor_liquido) + '</span>' +
      '</div>';
    }).join('');
    // O aviso do teto vem da ROTA, com o número dela — repetir 2000 aqui
    // seria uma segunda cópia do limite.
    var aviso = _det.aviso
      ? '<div class="ap-aviso">' + esc(_det.aviso) + ' (' + nf(_det.total, 0) +
        ' itens no recorte)</div>'
      : '';
    return '<div class="ap-lista">' + htmlCabCupom() + rede + linhas + '</div>' + aviso;
  }
  // dd/mm: o período está no filtro logo acima; o ano em 2.000 linhas não
  // informa nada.
  function diaCurto(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : String(iso || '');
  }

  function pintar() {
    if (!_sec) return;
    var alvo = _sec.querySelector('#ap-corpo');
    if (!alvo) return;
    // Uma vez por pintura, antes de qualquer html*(): é o índice que a lista,
    // a ordenação e o detalhe leem.
    _idx = idxVista();
    var cab = htmlBarra();
    if (_carregando) { alvo.innerHTML = cab + '<div class="ap-estado">Carregando…</div>'; return; }
    if (_erro) { alvo.innerHTML = cab + '<div class="ap-erro">' + esc(_erro) + '</div>'; return; }
    if (!_dados) { alvo.innerHTML = cab + '<div class="ap-estado">—</div>'; return; }
    // Os CARDS são os mesmos nas duas vistas: eles falam do recorte, não da
    // forma da lista. Só a lista troca.
    alvo.innerHTML = cab + htmlCards() +
      (_vista === 'cupom' ? htmlListaCupom() : htmlLista());
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
