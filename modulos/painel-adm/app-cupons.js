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
  // 'TODOS' NÃO É COMBUSTÍVEL: é o sentinela do primeiro chip, e o padrão ao
  // abrir a aba. Com ele, cards e listas mostram o nível INTEIRO — inclusive
  // os combustíveis que não têm chip (S500, ETAD, POD), que antes só apareciam
  // no detalhe do posto. Os números vêm dos total_* da resposta, e não da soma
  // dos por_combustivel: somar `cupons` por combustível conta duas vezes o
  // cupom que levou dois (medido em 14/09/2026: 3.152 contra 2.726 distintos),
  // e média de médias não é a média. Ver os totais() em lib/app-cupons.js.
  var COMB_TODOS = 'TODOS';
  // Os cinco da barra. A resposta traz mais (S500, ETAD, POD) — esses
  // aparecem no DETALHE do posto, que mostra tudo que o posto teve; na barra
  // ficam de fora de propósito, porque ela é de escolha rápida.
  //
  // GNV ENTROU em 16/09/2026: ele existe na tecnox_cupom_app e tem volume de
  // convênio (14/09, Soutag: 53 itens, 30 deles no preço de app), e três
  // postos da rede o vendem. Sem o chip, o único jeito de ver o preço de GNV
  // era abrir posto por posto no detalhe.
  var COMBS = [COMB_TODOS, 'GC', 'GA', 'ET', 'S10', 'GNV'];

  var _sec = null;
  var _pronto = false;
  var _canal = 'SOUTAG';
  var _comb = COMB_TODOS;   // padrão ao abrir: todos os combustíveis
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
  // Cupom aberto na vista Por cupom. A chave é posto|data|id_cupom, e NÃO só
  // o id_cupom: ele é sequencial do PDV de cada posto, então dois postos
  // repetem o mesmo número no mesmo dia. Agrupar só por ele juntaria cupons
  // de postos diferentes num detalhe só — é o mesmo cuidado que o
  // agregarCuponsApp toma para contar cupom distinto (ver lib/app-cupons.js).
  var _cupomAberto = null;

  // ════════ SOUTAG vs TECNOX ════════
  // A planilha da Soutag é lida NO NAVEGADOR e cruzada com os itens que a
  // TecnoX devolveu. Nada vai para o banco e nada sobe para a API: o arquivo
  // não sai da máquina de quem importou, e fechar a aba descarta tudo.
  var _sg = null;            // { linhas, arquivo, quando, colunas }
  var _sgErro = '';
  var _sgLendo = false;
  var _sgPosto = '';         // filtro por posto (vazio = todos)
  var _sgStatus = 'todos';   // todos | conferido | tecnox | soutag

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
      // ── Detalhe do cupom ──
      // Mesmo desenho do detalhe do posto da Movimentação: painel no primeiro
      // nível de superfície, canto de 12px, seções com rótulo e régua, e a
      // última sem régua. Aqui em --sf (o wrap é --bg/--sf2), para o painel
      // ler como embutido na linha que o abriu.
      '.ap-linha-cup.aberto{background:color-mix(in srgb,var(--ac) 8%,transparent)}' +
      '.ap-cd{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:20px 24px;margin:8px 0 12px}' +
      // RÉGUA ENTRE SEÇÕES, por irmão adjacente, e não border-bottom + 
      // :last-of-type: o último DIV do painel é a nota, não a última seção,
      // então o :last-of-type não casava com ela e a régua sobrava embaixo da
      // última — somada à borda da nota. Assim a regra não depende de quem
      // vem depois.
      '.ap-cd-sec{margin-bottom:16px}' +
      '.ap-cd-sec + .ap-cd-sec{border-top:.5px solid var(--bd);padding-top:14px}' +
      '.ap-cd-rot{font:11px var(--mono);letter-spacing:.5px;text-transform:uppercase;color:var(--tx3);margin-bottom:6px}' +
      '.ap-cd-linha{display:flex;justify-content:space-between;gap:.8rem;padding:3px 0;font:.72rem var(--mono);color:var(--tx2)}' +
      '.ap-cd-linha b{color:var(--tx);font-weight:500}' +
      '.ap-cd-nota{font:.64rem var(--mono);color:var(--tx3);font-style:italic;margin-top:12px;padding-top:10px;border-top:.5px solid var(--bd)}' +
      // ── Soutag vs TecnoX ──
      '.ap-sg-topo{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:12px}' +
      '.ap-sg-imp{background:var(--sf2);color:var(--tx)}' +
      '.ap-sg-imp:disabled{opacity:.6;cursor:progress}' +
      '.ap-sg-arq{font:.7rem var(--mono);color:var(--tx3)}' +
      '.ap-sg-resumo{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:12px}' +
      '.ap-sg-n{font:700 .72rem var(--mono);border:1px solid var(--bd);border-radius:20px;padding:4px 12px}' +
      // Verde conferido, azul só TecnoX, âmbar só Soutag, vermelho nome que
      // não casou — as cores dizem de que lado está a pendência.
      '.ap-sg-ok{color:#0F6E56;border-color:#0F6E56}' +
      '.ap-sg-t{color:#185FA5;border-color:#185FA5}' +
      '.ap-sg-s{color:#BA7517;border-color:#BA7517}' +
      '.ap-sg-x{color:#A32D2D;border-color:#A32D2D}' +
      '.ap-sg-filtros{display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:12px;font:.7rem var(--mono);color:var(--tx3)}' +
      '.ap-sg-filtros label{display:flex;align-items:center;gap:.35rem}' +
      '.ap-cab-sg{grid-template-columns:64px 230px 90px 130px 150px}' +
      '.ap-sg-tag{font:700 .64rem var(--mono)}' +
      '.ap-sg-conferido .ap-sg-tag{color:#0F6E56}' +
      '.ap-sg-tecnox .ap-sg-tag{color:#185FA5}' +
      '.ap-sg-soutag .ap-sg-tag{color:#BA7517}' +
      '.ap-sg-sem-posto .ap-sg-tag{color:#A32D2D}' +
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
        '.ap-cab-sg{grid-template-columns:1fr auto}' +
        '.ap-cab.ap-cab-sg{display:none}' +
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
  // Rótulo curto do chip: o sentinela vira uma palavra, não a sigla.
  function rotComb(c) { return c === COMB_TODOS ? 'Todos' : c; }
  // Para as frases ("por litro · GC", "Sem cupom de GC").
  function nomeComb(c) { return c === COMB_TODOS ? 'todos os combustíveis' : c; }

  function doComb(nivel) {
    if (!nivel) return null;
    // TODOS: monta o mesmo formato de um bloco de combustível a partir dos
    // total_* do nível. Assim cards, coluna, ordenação e linha da REDE não
    // precisam saber que existe um estado "todos" — eles só chamam doComb.
    if (_comb === COMB_TODOS) {
      if (nivel.total_itens === undefined) return null;
      if (!nivel.total_itens) return null;
      return {
        combustivel: COMB_TODOS,
        preco_medio: nivel.total_preco_medio,
        preco_min: nivel.total_preco_min,
        preco_max: nivel.total_preco_max,
        preco_medio_ponderado: nivel.total_preco_medio_ponderado,
        cupons: nivel.total_cupons,
        itens: nivel.total_itens,
        litros: nivel.total_litros,
        valor: nivel.total_valor,
      };
    }
    if (!nivel.por_combustivel) return null;
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
    if (v !== 'posto' && v !== 'cupom' && v !== 'soutag') return;
    if (v === _vista) return;
    _vista = v;
    _postoAberto = null;
    // As duas vistas de item precisam do detalhe; a de posto já tem o
    // agregado em mão. carregarDetalhe() pinta no acerto de cache também.
    if (v === 'cupom' || v === 'soutag') carregarDetalhe();
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
        ' onclick="__apComb(\'' + c + '\')">' + esc(rotComb(c)) + '</button>';
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
        vbtn('soutag', 'Soutag vs TecnoX') +
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
      card('medio', 'Preço médio', c ? preco(c.preco_medio) : '—', 'por litro · ' + esc(nomeComb(_comb))) +
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
          return (c && c.preco_medio_ponderado != null) ? preco(c.preco_medio_ponderado) + ' em ' + esc(nomeComb(_comb)) : '—';
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
    // TODOS não filtra: é o conjunto inteiro, e aí a coluna COMBUSTÍVEL passa
    // a variar de linha em linha — que é o que ela sempre prometeu.
    var so = (_comb === COMB_TODOS)
      ? todos.slice()
      : todos.filter(function (i) { return i.combustivel === _comb; });
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
      return htmlCabCupom() + '<div class="ap-vazio">Nenhum cupom de ' + esc(nomeComb(_comb)) +
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
      '<span class="ap-c-comb">' + esc(rotComb(_comb)) + '</span>' +
      '<span class="ap-n">' + litros(nL) + '</span>' +
      '<span class="ap-n" style="color:' + cor + ';font-weight:700">' +
        (comPreco ? preco(soma / comPreco) : '—') + '</span>' +
      '<span class="ap-n">' + reais(nV) + '</span>' +
    '</div>';
    var linhas = itens.map(function (i) {
      var ck = chaveCupom(i);
      var aberto = (_cupomAberto === ck);
      return '<div class="ap-linha ap-cab-cup ap-linha-cup' + (aberto ? ' aberto' : '') + '"' +
        ' role="button" tabindex="0" aria-expanded="' + (aberto ? 'true' : 'false') + '"' +
        ' onclick="__apCupom(\'' + esc(ck) + '\')">' +
        '<span class="ap-c-data">' + esc(diaCurto(i.data)) + '</span>' +
        '<span class="ap-c-posto"><span class="ap-badge" style="background:' + fundo +
          ';color:' + cor + '">' + esc(i.nome_posto || '—') + '</span></span>' +
        '<span class="ap-c-comb"><span class="ap-cchip">' + esc(i.combustivel) + '</span></span>' +
        '<span class="ap-n">' + litros(i.litros) + '</span>' +
        '<span class="ap-n" style="color:' + cor + ';font-weight:700">' + preco(i.preco_litro) + '</span>' +
        '<span class="ap-n">' + reais(i.valor_liquido) + '</span>' +
      '</div>' + (aberto ? htmlCupomDet(i) : '');
    }).join('');
    // O aviso do teto vem da ROTA, com o número dela — repetir 2000 aqui
    // seria uma segunda cópia do limite.
    var aviso = _det.aviso
      ? '<div class="ap-aviso">' + esc(_det.aviso) + ' (' + nf(_det.total, 0) +
        ' itens no recorte)</div>'
      : '';
    return '<div class="ap-lista">' + htmlCabCupom() + rede + linhas + '</div>' + aviso;
  }
  // ── Detalhe do cupom ───────────────────────────────────────────
  // Mostra TUDO o que a tecnox_cupom_app guarda daquele cupom. Os itens saem
  // do que a rota já devolveu — não há segunda chamada.
  //
  // ATENÇÃO AO QUE O 'TUDO' ALCANÇA: com "Só preço de app" LIGADO, a rota já
  // deixou de fora os itens cobrados no preço de placa, e um cupom misto pode
  // aparecer aqui com menos itens do que a tabela tem. O aviso no pé do
  // detalhe diz isso — sem ele, um cupom de GC+ET apareceria com um item só e
  // pareceria que a TecnoX mandou incompleto.
  function chaveCupom(i) {
    return String(i.posto_id) + '|' + String(i.data) + '|' + String(i.id_cupom == null ? '' : i.id_cupom);
  }
  window.__apCupom = function (ck) {
    _cupomAberto = (_cupomAberto === ck) ? null : ck;   // clicar de novo fecha
    pintar();
  };
  // Uma linha rótulo/valor, no formato do detalhe do posto da Movimentação.
  function cdLin(rot, val) {
    return '<div class="ap-cd-linha"><span>' + esc(rot) + '</span><b>' + val + '</b></div>';
  }
  function cdSec(rot, corpo) {
    return '<div class="ap-cd-sec"><div class="ap-cd-rot">' + esc(rot) + '</div>' + corpo + '</div>';
  }
  function htmlCupomDet(ref) {
    var ck = chaveCupom(ref);
    // TODOS os itens do mesmo cupom, inclusive os que o chip de combustível
    // está escondendo na lista: o detalhe é do cupom, não do recorte.
    var itens = ((_det && _det.itens) || []).filter(function (i) { return chaveCupom(i) === ck; });
    if (!itens.length) return '';
    var i0 = itens[0];
    var cfg = CANAIS[i0.canal] || CANAIS[_canal] || { rot: i0.canal, cor: '', fundo: '' };
    var somaL = 0, somaV = 0;
    itens.forEach(function (i) { somaL += Number(i.litros) || 0; somaV += Number(i.valor_liquido) || 0; });

    var cab = cdSec('Cupom',
      cdLin('ID do cupom', esc(i0.id_cupom == null ? '—' : i0.id_cupom)) +
      cdLin('Data', esc(brDataCurta(i0.data))) +
      cdLin('Posto', esc(i0.nome_posto || '—')) +
      cdLin('Canal', '<span class="ap-badge" style="background:' + cfg.fundo + ';color:' + cfg.cor +
        '">' + esc(cfg.rot || i0.canal) + '</span>'));

    // Uma linha por ITEM. Dois do mesmo combustível no mesmo cupom acontecem
    // (medido em 14/09/2026: 151 cupons com mais de um item, e o primeiro
    // deles é ET+ET) — por isso a lista é por item e não por combustível.
    var linsItens = itens.map(function (i, k) {
      return cdLin((itens.length > 1 ? (k + 1) + '. ' : '') + (i.combustivel || '—'),
        litros(i.litros) + '  ·  ' + preco(i.preco_litro) + '/L  ·  ' + reais(i.valor_liquido));
    }).join('');
    var sItens = cdSec(itens.length === 1 ? 'Item' : (itens.length + ' itens'), linsItens);

    // BRUTO E DESCONTO NÃO EXISTEM NESTA TABELA. Ela guarda o líquido do
    // item (ver sql/tecnox_cupom_app.sql); bruto e desconto vivem agregados
    // em tecnox_venda_dia, por posto × dia × combustível, e não por cupom.
    // Dito aqui em vez de omitido: quem abre o detalhe para conferir um
    // desconto precisa saber por que ele não está.
    var sCliente = cdSec('Cliente',
      cdLin('cod_cliente', esc(i0.cod_cliente == null || i0.cod_cliente === '' ? '(vazio)' : i0.cod_cliente)) +
      cdLin('nome_cliente', esc(i0.nome_cliente == null || i0.nome_cliente === '' ? '(vazio)' : i0.nome_cliente)));

    var sTotal = cdSec('Total do cupom',
      cdLin('Litros', litros(somaL)) +
      cdLin('Valor líquido', reais(somaV)) +
      cdLin('R$ por litro', somaL > 0 ? preco(somaV / somaL) : '—'));

    var sBruto = cdSec('Registro',
      cdLin('id na tabela', itens.map(function (i) { return esc(i.id == null ? '—' : i.id); }).join(', ')) +
      cdLin('gravado em', esc(i0.criado_em ? String(i0.criado_em).replace('T', ' ').slice(0, 19) : '—')));

    var nota = '<div class="ap-cd-nota">Bruto e desconto não existem nesta tabela — ela guarda o líquido do item. ' +
      'Eles vivem agregados em tecnox_venda_dia, por posto × dia × combustível.' +
      (_soApp ? '<br>Com "Só preço de app" ligado, itens deste cupom cobrados no preço da placa ficaram fora.' : '') +
      '</div>';
    return '<div class="ap-cd">' + cab + sItens + sCliente + sTotal + sBruto + nota + '</div>';
  }
  // dd/mm/aaaa no detalhe: ali o ano cabe e a data é o que se confere.
  function brDataCurta(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || '');
  }

  // dd/mm: o período está no filtro logo acima; o ano em 2.000 linhas não
  // informa nada.
  function diaCurto(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : String(iso || '');
  }

  // ── SheetJS SOB DEMANDA ─────────────────────────────────────────
  // 860 KB. Carregar no <head> punia todo mundo que abre o painel por causa
  // de uma tela que quase ninguém usa; aqui o script entra no primeiro
  // clique em "Importar" e a promessa fica guardada, então o segundo clique
  // não recarrega.
  //
  // O REPOSITÓRIO NÃO TINHA SheetJS no front: todas as importações de .xlsx
  // daqui mandam o arquivo para a API, que parseia com o pacote `xlsx` do
  // npm. Esta é a primeira que parseia no navegador, e é de propósito — ver
  // o comentário do estado acima.
  var _xlsxPromessa = null;
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  function carregarXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_xlsxPromessa) return _xlsxPromessa;
    _xlsxPromessa = new Promise(function (ok, erro) {
      var sc = document.createElement('script');
      sc.src = XLSX_URL;
      sc.onload = function () {
        if (window.XLSX) ok(window.XLSX);
        else erro(new Error('a biblioteca de planilha carregou sem se registrar'));
      };
      sc.onerror = function () {
        _xlsxPromessa = null;   // deixa tentar de novo depois
        erro(new Error('não foi possível baixar a biblioteca de planilha (precisa de internet)'));
      };
      document.head.appendChild(sc);
    });
    return _xlsxPromessa;
  }

  // ── Nome de posto: dos dois lados para o mesmo núcleo ───────────
  // A Soutag escreve razão social ("POSTO BRUNA LTDA"), a TecnoX escreve o
  // apelido ("P. BRUNA"). Comparar as duas cadeias nunca casaria. O núcleo é
  // o que sobra depois de tirar acento, pontuação e as palavras que não
  // identificam ninguém — POSTO, P, LTDA, ME, EIRELI, S/A, COMERCIO,
  // COMBUSTIVEIS, DERIVADOS, AUTO, DE/DA/DO/E.
  //
  // O QUE SOBRA É COMPARADO INTEIRO, não por prefixo: "SANTA INES MINAS" e
  // "SANTA INES - JOAQUIM" têm o mesmo começo e são postos DIFERENTES.
  var LIXO_POSTO = ['POSTO', 'P', 'AUTO', 'LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S', 'A',
    'COMERCIO', 'COMERCIAL', 'COMBUSTIVEIS', 'COMBUSTIVEL', 'DERIVADOS', 'PETROLEO',
    'DISTRIBUIDORA', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E'];
  function nucleoPosto(nome) {
    var t = String(nome == null ? '' : nome)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w && LIXO_POSTO.indexOf(w) < 0; });
    return t.join(' ');
  }
  // núcleo -> nome da TecnoX. Montado dos itens em mão, então só reconhece
  // posto que teve movimento no recorte — que é exatamente com o que se
  // compara.
  function indicePostos() {
    var m = {};
    ((_det && _det.itens) || []).forEach(function (i) {
      var nc = nucleoPosto(i.nome_posto);
      if (nc) m[nc] = i.nome_posto;
    });
    return m;
  }

  // ── Combustível: nome por extenso -> código ─────────────────────
  // A planilha da Soutag pode trazer o nome ou a sigla. Os itens da TecnoX
  // vêm sempre em código (o rollup grava assim).
  var MAPA_SG_COMB = [
    [/GASOLINA\s*ADITIVAD/, 'GA'], [/GASOLINA\s*COMUM/, 'GC'],
    [/\bGA\b/, 'GA'], [/\bGC\b/, 'GC'],
    [/ETANOL\s*ADITIVAD/, 'ETAD'], [/ETANOL|\bALCOOL\b/, 'ET'], [/\bET\b/, 'ET'],
    [/S\s*-?\s*10|DIESEL\s*S10/, 'S10'], [/S\s*-?\s*500|DIESEL\s*S500/, 'S500'],
    [/\bGNV\b|GAS\s+NATURAL/, 'GNV'],
    [/OCTAPRO/, 'OCT'], [/PODIUM/, 'POD'],
  ];
  function codComb(txt) {
    var t = String(txt == null ? '' : txt).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toUpperCase();
    for (var k = 0; k < MAPA_SG_COMB.length; k++) {
      if (MAPA_SG_COMB[k][0].test(t)) return MAPA_SG_COMB[k][1];
    }
    return t.trim();   // desconhecido entra cru: some no cruzamento, não em silêncio
  }

  // ── Data: a planilha traz Data/Hora; o cruzamento é por DIA ─────
  // Serial do Excel (número) e texto convivem na mesma coluna dependendo de
  // como a planilha foi salva. O serial conta dias desde 1899-12-30 (a base
  // com o ano bissexto fantasma de 1900, que o Excel mantém por compatibilidade).
  function diaDaCelula(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) {
      var ms = Math.round((v - 25569) * 86400000);   // 25569 = 1970-01-01 em serial
      var d = new Date(ms);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    }
    var t = String(v).trim();
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
    if (br) {
      var ano = br[3].length === 2 ? ('20' + br[3]) : br[3];
      return ano + '-' + ('0' + br[2]).slice(-2) + '-' + ('0' + br[1]).slice(-2);
    }
    return '';
  }
  function numeroDaCelula(v) {
    if (typeof v === 'number') return v;
    var t = String(v == null ? '' : v).replace(/[^0-9,.-]/g, '');
    // pt-BR: ponto é milhar e vírgula é decimal. "1.234,56" -> 1234.56
    if (t.indexOf(',') >= 0) t = t.split('.').join('').split(',').join('.');
    var n = Number(t);
    return isFinite(n) ? n : NaN;
  }

  // ── Leitura da planilha ─────────────────────────────────────────
  // Cabeçalho casado sem acento e sem caixa: planilha exportada troca
  // "Combustível" por "COMBUSTIVEL" dependendo de quem exporta.
  var COLUNAS_SG = {
    posto: ['POSTO'],
    data: ['DATA/HORA', 'DATAHORA', 'DATA'],
    valor: ['VALOR'],
    combustivel: ['COMBUSTIVEL', 'PRODUTO'],
    usuario: ['USUARIO'],
    id: ['ID'],
  };
  function chaveCol(nome) {
    return String(nome == null ? '' : nome).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, '');
  }
  function lerPlanilha(XLSX, buffer) {
    var wb = XLSX.read(buffer, { type: 'array' });
    var aba = wb.SheetNames[0];
    if (!aba) throw new Error('a planilha não tem nenhuma aba');
    var cru = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: true });
    if (!cru.length) throw new Error('a primeira aba da planilha está vazia');
    // Mapa cabeçalho-da-planilha -> campo nosso.
    var de = {};
    Object.keys(cru[0]).forEach(function (h) {
      var k = chaveCol(h);
      Object.keys(COLUNAS_SG).forEach(function (campo) {
        if (COLUNAS_SG[campo].indexOf(k) >= 0 && !de[campo]) de[campo] = h;
      });
    });
    var faltando = ['posto', 'data', 'valor', 'combustivel'].filter(function (c) { return !de[c]; });
    if (faltando.length) {
      throw new Error('a planilha não tem a(s) coluna(s): ' + faltando.join(', ') +
        ' — achei: ' + Object.keys(cru[0]).join(', '));
    }
    var linhas = cru.map(function (r, idx) {
      return {
        i: idx,
        posto_planilha: String(r[de.posto] == null ? '' : r[de.posto]).trim(),
        data: diaDaCelula(r[de.data]),
        valor: numeroDaCelula(r[de.valor]),
        combustivel: codComb(r[de.combustivel]),
        usuario: de.usuario ? String(r[de.usuario] == null ? '' : r[de.usuario]).trim() : '',
        id: de.id ? String(r[de.id] == null ? '' : r[de.id]).trim() : '',
      };
    }).filter(function (l) { return l.data && isFinite(l.valor); });
    if (!linhas.length) throw new Error('nenhuma linha da planilha tem data e valor legíveis');
    return { linhas: linhas, colunas: de, abas: wb.SheetNames.length, aba: aba, cruas: cru.length };
  }

  // ── O cruzamento ────────────────────────────────────────────────
  // UM PARA UM, e é o que o bilhete duplicado exige: dois abastecimentos do
  // mesmo posto, dia, combustível e valor são DOIS, e cada um casa com um.
  // Um item da TecnoX já casado sai da mesa (`usado`), senão a segunda linha
  // da Soutag casaria com o mesmo cupom e os dois lados pareceriam conferidos.
  //
  // A TOLERÂNCIA É DE R$ 0,50 no valor, como pedido. Data e combustível têm
  // de ser IGUAIS — afrouxar ali casaria abastecimento de dias diferentes.
  var SG_TOL = 0.50;
  function cruzarSoutag() {
    var itens = ((_det && _det.itens) || []).map(function (i, k) {
      return { k: k, data: i.data, nome: i.nome_posto, nucleo: nucleoPosto(i.nome_posto),
               comb: i.combustivel, valor: Number(i.valor_liquido), litros: Number(i.litros),
               preco: i.preco_litro, id: i.id_cupom, usado: false };
    });
    // Índice por dia|núcleo|combustível: sem ele o cruzamento é n×m e uma
    // planilha de 4.000 linhas contra 4.000 itens daria 16 milhões de voltas.
    var porChave = {};
    itens.forEach(function (it) {
      var c = it.data + '|' + it.nucleo + '|' + it.comb;
      (porChave[c] = porChave[c] || []).push(it);
    });
    var idx = indicePostos();
    var conferido = [], soSoutag = [], semPosto = [];
    ((_sg && _sg.linhas) || []).forEach(function (l) {
      var nc = nucleoPosto(l.posto_planilha);
      var oficial = idx[nc];
      var linha = {
        fonte: 'soutag', data: l.data, posto: oficial || l.posto_planilha,
        posto_planilha: l.posto_planilha, comb: l.combustivel, valor: l.valor,
        usuario: l.usuario, id: l.id,
      };
      if (!oficial) {
        // Posto que a TecnoX não tem NO RECORTE: não é divergência de
        // abastecimento, é nome que não casou. Separado para não inflar o
        // "só Soutag" com erro de cadastro.
        semPosto.push(linha);
        return;
      }
      var cand = porChave[l.data + '|' + nc + '|' + l.combustivel] || [];
      var achou = null, melhor = Infinity;
      for (var k = 0; k < cand.length; k++) {
        if (cand[k].usado) continue;
        var dif = Math.abs(cand[k].valor - l.valor);
        // O MAIS PRÓXIMO entre os candidatos, não o primeiro: com dois cupons
        // dentro da tolerância, casar o primeiro deixaria o par melhor órfão.
        if (dif <= SG_TOL && dif < melhor) { melhor = dif; achou = cand[k]; }
      }
      if (achou) {
        achou.usado = true;
        conferido.push(Object.assign({}, linha, {
          fonte: 'ambos', posto: achou.nome, litros: achou.litros,
          valor_tecnox: achou.valor, dif: Math.round((l.valor - achou.valor) * 100) / 100,
          preco: achou.preco, id_cupom: achou.id,
        }));
      } else {
        soSoutag.push(linha);
      }
    });
    var soTecnox = itens.filter(function (it) { return !it.usado; }).map(function (it) {
      return { fonte: 'tecnox', data: it.data, posto: it.nome, comb: it.comb,
               valor: it.valor, litros: it.litros, preco: it.preco, id_cupom: it.id };
    });
    return { conferido: conferido, soTecnox: soTecnox, soSoutag: soSoutag,
             semPosto: semPosto, itens: itens.length };
  }

  // ── Render da vista ─────────────────────────────────────────────
  function htmlSoutag() {
    var topo = '<div class="ap-sg-topo">' +
      '<button type="button" class="ap-cbtn ap-sg-imp" onclick="__apSgAbrir()"' +
        (_sgLendo ? ' disabled' : '') + '>' +
        (_sgLendo ? 'Lendo a planilha…' : 'Importar planilha Soutag') + '</button>' +
      '<input type="file" id="ap-sg-file" accept=".xlsx,.xls" hidden onchange="__apSgArquivo(this)">' +
      (_sg ? '<span class="ap-sg-arq">' + esc(_sg.arquivo) + ' · ' +
        nf(_sg.linhas.length, 0) + ' linha' + (_sg.linhas.length === 1 ? '' : 's') + '</span>' : '') +
    '</div>';
    if (_sgErro) topo += '<div class="ap-erro">' + esc(_sgErro) + '</div>';
    if (!_det) {
      return topo + '<div class="ap-estado">' +
        (_detCarregando ? 'Carregando os cupons da TecnoX…' : '—') + '</div>';
    }
    if (!_sg) {
      return topo + '<div class="ap-estado">Importe a planilha da Soutag para comparar com os ' +
        nf((_det.itens || []).length, 0) + ' cupons que a TecnoX devolveu neste recorte.' +
        '<br><span class="ap-sub">Colunas esperadas: Posto · Data/Hora · Valor · Combustível · Usuário · ID. ' +
        'O arquivo é lido no navegador e não é enviado nem gravado.</span></div>';
    }
    var c = cruzarSoutag();
    var resumo = '<div class="ap-sg-resumo">' +
      '<span class="ap-sg-n ap-sg-ok">' + nf(c.conferido.length, 0) + ' conferidos</span>' +
      '<span class="ap-sg-n ap-sg-t">' + nf(c.soTecnox.length, 0) + ' só TecnoX</span>' +
      '<span class="ap-sg-n ap-sg-s">' + nf(c.soSoutag.length, 0) + ' só Soutag</span>' +
      (c.semPosto.length ? '<span class="ap-sg-n ap-sg-x">' + nf(c.semPosto.length, 0) +
        ' posto não reconhecido</span>' : '') +
    '</div>';
    // Um só array com o status, para o filtro e a ordenação valerem para os três.
    var todas = []
      .concat(c.conferido.map(function (l) { return Object.assign({ status: 'conferido' }, l); }))
      .concat(c.soTecnox.map(function (l) { return Object.assign({ status: 'tecnox' }, l); }))
      .concat(c.soSoutag.map(function (l) { return Object.assign({ status: 'soutag' }, l); }))
      .concat(c.semPosto.map(function (l) { return Object.assign({ status: 'sem-posto' }, l); }));
    var postos = {};
    todas.forEach(function (l) { if (l.posto) postos[l.posto] = 1; });
    var opcoes = Object.keys(postos).sort();
    var filtros = '<div class="ap-sg-filtros">' +
      '<label>Posto <select class="ap-data" onchange="__apSgPosto(this.value)">' +
        '<option value="">todos (' + opcoes.length + ')</option>' +
        opcoes.map(function (p) {
          return '<option value="' + esc(p) + '"' + (p === _sgPosto ? ' selected' : '') + '>' + esc(p) + '</option>';
        }).join('') +
      '</select></label>' +
      '<label>Status <select class="ap-data" onchange="__apSgStatus(this.value)">' +
        [['todos', 'todos'], ['conferido', 'conferidos'], ['tecnox', 'só TecnoX'],
         ['soutag', 'só Soutag'], ['sem-posto', 'posto não reconhecido']].map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === _sgStatus ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select></label>' +
    '</div>';
    var vis = todas.filter(function (l) {
      if (_sgPosto && l.posto !== _sgPosto) return false;
      if (_sgStatus !== 'todos' && l.status !== _sgStatus) return false;
      return true;
    });
    // Mesma ordem da lista de cupons: dia mais recente primeiro, e dentro do
    // dia por posto, para as divergências do mesmo posto ficarem juntas.
    vis.sort(function (a, b) {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1;
      return String(a.posto || '').localeCompare(String(b.posto || ''));
    });
    var ROT = { conferido: 'conferido', tecnox: 'só TecnoX', soutag: 'só Soutag',
                'sem-posto': 'posto não reconhecido' };
    var cab = '<div class="ap-cab ap-cab-sg">' +
      '<span>Data</span><span>Posto</span><span>Comb.</span>' +
      '<span class="ap-n">Valor</span><span>Fonte</span>' +
    '</div>';
    var linhas = vis.slice(0, 1500).map(function (l) {
      return '<div class="ap-linha ap-cab-sg ap-sg-' + l.status + '">' +
        '<span class="ap-c-data">' + esc(diaCurto(l.data)) + '</span>' +
        '<span class="ap-c-posto">' + esc(l.posto || '—') +
          (l.status === 'sem-posto' ? '<span class="ap-sub"> (' + esc(l.posto_planilha) + ')</span>' : '') +
        '</span>' +
        '<span><span class="ap-cchip">' + esc(l.comb || '—') + '</span></span>' +
        '<span class="ap-n">' + reais(l.valor) +
          // A DIFERENÇA dentro da tolerância vai à vista: "conferido" com R$
          // 0,30 de diferença é conferido, e esconder isso faria o número da
          // Soutag parecer idêntico ao da TecnoX.
          ((l.status === 'conferido' && l.dif) ? '<span class="ap-sub"> (' +
            (l.dif > 0 ? '+' : '') + nf(l.dif, 2) + ')</span>' : '') +
        '</span>' +
        '<span class="ap-sg-tag">' + ROT[l.status] + '</span>' +
      '</div>';
    }).join('');
    var corte = vis.length > 1500
      ? '<div class="ap-aviso">mostrando 1.500 de ' + nf(vis.length, 0) +
        ' linhas — use os filtros</div>'
      : '';
    return topo + resumo + filtros +
      '<div class="ap-lista">' + cab + (linhas || '<div class="ap-vazio">Nada neste filtro.</div>') + '</div>' +
      corte;
  }

  // ── Ações da vista ──────────────────────────────────────────────
  window.__apSgAbrir = function () {
    var el = document.getElementById('ap-sg-file');
    if (el) { el.value = ''; el.click(); }   // value vazio para reimportar o MESMO arquivo
  };
  window.__apSgArquivo = async function (input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    // O SheetJS lê os dois formatos (xlsx é ZIP/OOXML, xls é BIFF/OLE2), e o
    // XLSX.read decide pelos bytes, não pela extensão. O guard acompanha o
    // accept do input: os dois aceitando o mesmo par, senão o picker deixaria
    // escolher um arquivo que o código recusa na linha seguinte.
    if (!/\.xlsx?$/i.test(file.name)) {
      _sgErro = 'Selecione uma planilha do Excel (.xlsx ou .xls).'; pintar(); return;
    }
    _sgLendo = true; _sgErro = ''; pintar();
    try {
      var XLSX = await carregarXlsx();
      var buf = new Uint8Array(await file.arrayBuffer());
      var r = lerPlanilha(XLSX, buf);
      _sg = { linhas: r.linhas, arquivo: file.name, quando: new Date(),
              colunas: r.colunas, cruas: r.cruas };
      _sgPosto = ''; _sgStatus = 'todos';
    } catch (e) {
      _sg = null;
      _sgErro = 'Não foi possível ler a planilha: ' + ((e && e.message) ? e.message : e);
    } finally {
      _sgLendo = false; pintar();
    }
  };
  window.__apSgPosto = function (v) { _sgPosto = v || ''; pintar(); };
  window.__apSgStatus = function (v) { _sgStatus = v || 'todos'; pintar(); };
  // A comparação depende do recorte da TecnoX; trocar período/canal invalida
  // o cruzamento, mas NÃO a planilha — ela é do arquivo, não do recorte.

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
    // A vista Soutag NÃO mostra os cards: eles falam do recorte da TecnoX, e
    // ali a pergunta é o cruzamento com a planilha — o resumo dela é outro.
    if (_vista === 'soutag') { alvo.innerHTML = cab + htmlSoutag(); return; }
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
