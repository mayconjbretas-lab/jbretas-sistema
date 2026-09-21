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
  // O RESULTADO VEM DO SERVIDOR (GET /app/soutag-comparar), não da memória:
  // a planilha agora é gravada, e quem abre a tela sem importar vê a última
  // comparação. _sgChave é o recorte que está em _sgSrv — período + so_app —
  // e é o que diz se o que está na tela ainda vale.
  var _sgSrv = null;
  var _sgChave = '';
  var _sgCarregando = false;
  var _sgPasso = '';         // texto do passo em curso ('' = parado)
  // Resumo do POST desta sessão. É a ÚNICA fonte do "importado por": a
  // tabela não guarda quem importou enquanto a coluna opcional não for
  // criada (ver o fim de sql/soutag_transacao.sql), e mostrar o nome de quem
  // está OLHANDO seria informação errada — o Felipe veria "importado por
  // Felipe" numa planilha que outra pessoa subiu.
  var _sgImportou = null;

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
      '.ap-cab-cup{grid-template-columns:64px 230px 128px 110px 110px 120px}' +
      '.ap-linha-cup{cursor:default}' +
      '.ap-linha-cup:hover{background:color-mix(in srgb,var(--ac) 5%,transparent)}' +
      '.ap-c-data{font:.72rem var(--mono);color:var(--tx3)}' +
      '.ap-c-posto{overflow:hidden}' +
      // O badge herda a cor do canal (roxo Soutag / âmbar 99), inline: a cor
      // é dado, e vive no mapa CANAIS.
      '.ap-badge{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;border-radius:20px;padding:2px 9px;font:700 .66rem var(--mono)}' +
      '.ap-cchip{display:inline-block;border:1px solid var(--bd);border-radius:5px;padding:1px 7px;font:700 .64rem var(--mono);color:var(--tx2);background:var(--sf2)}' +
      // A célula de combustível agora pode ter DOIS OU MAIS chips (o cupom de
      // GC+ET é uma linha só), então ela é flex e envolve. A coluna foi de 104
      // para 128px: dois chips com o ponto no meio medem ~86px e a terceira
      // cabe na segunda linha da célula sem empurrar as colunas de número.
      '.ap-c-comb{display:flex;flex-wrap:wrap;align-items:center;gap:3px}' +
      '.ap-cdot{color:var(--tx3);font:.66rem var(--mono)}' +
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
      '.ap-sg-topo{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:16px}' +
      '.ap-sg-imp{background:var(--sf2);color:var(--tx)}' +
      '.ap-sg-imp:disabled{opacity:.6;cursor:progress}' +
      '.ap-sg-arq{font:.7rem var(--mono);color:var(--tx3)}' +
      // A linha da última importação. Acima de tudo e discreta: ela responde
      // "estou olhando dado de quando?", que é a primeira pergunta de quem
      // abre a tela sem ter importado.
      '.ap-sg-ultima{font:.72rem var(--mono);color:var(--tx3);margin:-6px 0 14px}' +
      '.ap-sg-ultima b{color:var(--tx2)}' +
      // OS DOIS BLOCOS, lado a lado. flex:1 1 320px e nenhuma media query: em
      // tela larga os dois dividem a faixa; abaixo de ~700px o basis não cabe
      // duas vezes e cada um pega a linha inteira sozinho.
      // A BORDA ESQUERDA de 4px é o que identifica a fonte — roxo Soutag,
      // azul TecnoX, as mesmas cores dos badges de canal da tela.
      '.ap-sg-blocos{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}' +
      '.ap-sg-bloco{flex:1 1 320px;box-sizing:border-box;background:var(--sf2);border:1px solid var(--bd);border-left:4px solid var(--bd);border-radius:10px;padding:14px 18px}' +
      '.ap-sg-bloco--sg{border-left-color:#3C3489}' +
      '.ap-sg-bloco--tx{border-left-color:#185FA5}' +
      '.ap-sg-bl-rot{font:700 .62rem var(--mono);letter-spacing:.08em;text-transform:uppercase}' +
      '.ap-sg-bloco--sg .ap-sg-bl-rot{color:#3C3489}' +
      '.ap-sg-bloco--tx .ap-sg-bl-rot{color:#185FA5}' +
      '.ap-sg-bl-v{font:700 1.5rem var(--sans);line-height:1.2;margin-top:4px}' +
      '.ap-sg-bl-l{display:flex;flex-wrap:wrap;gap:4px 20px;margin-top:8px}' +
      '.ap-sg-bl-i{font:.7rem var(--mono);color:var(--tx3)}' +
      '.ap-sg-bl-i b{color:var(--tx);font-weight:600}' +
      '.ap-sg-bl-s{font:.64rem var(--mono);color:var(--tx3);font-style:italic;margin-top:8px}' +
      // Cards de diferença e de status: a mesma caixa, 150px de piso como os
      // cards da Movimentação. Os de status são BOTÃO (filtram a lista); os de
      // diferença não, e por isso não têm cursor de mão.
      '.ap-sg-cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px}' +
      '.ap-sg-cd{flex:0 0 auto;box-sizing:border-box;min-width:150px;text-align:left;background:var(--sf2);border:1px solid var(--bd);border-radius:10px;padding:10px 14px;font:inherit;color:var(--tx)}' +
      '.ap-sg-cd-r{font:700 .58rem var(--mono);letter-spacing:.06em;color:var(--tx3);text-transform:uppercase}' +
      '.ap-sg-cd-v{font:700 1.05rem var(--sans);line-height:1.2;margin-top:3px}' +
      '.ap-sg-cd-s{font:.6rem var(--mono);color:var(--tx3)}' +
      '.ap-sg-cd--bt{cursor:pointer}' +
      '.ap-sg-cd--bt:hover{border-color:var(--ac)}' +
      '.ap-sg-cd.on{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 10%,var(--sf2))}' +
      // O NÚMERO em vermelho junto com a borda: a borda sozinha num card de
      // número não diz o que está errado.
      '.ap-sg-cd--dif.diverge{border-color:#A32D2D}' +
      '.ap-sg-cd--dif.diverge .ap-sg-cd-v{color:#A32D2D}' +
      '.ap-sg-cd--dif.igual .ap-sg-cd-v{color:#0F6E56}' +
      '.ap-sg-cd--ok .ap-sg-cd-v{color:#0F6E56}' +
      '.ap-sg-cd--tx .ap-sg-cd-v{color:#185FA5}' +
      '.ap-sg-cd--sg .ap-sg-cd-v{color:#3C3489}' +
      '.ap-sg-cd--dv .ap-sg-cd-v{color:#A32D2D}' +
      // TABELA DETALHADA (modo por hora) — oito colunas fixas.
      // 96+150+64+92+92+92+96+80 = 762px de conteúdo.
      // AS DUAS HORAS LADO A LADO são o ponto da vista: é com elas que se
      // confere o par com o olho, em vez de confiar na conta.
      '.ap-cab-sgh{display:grid;grid-template-columns:96px 150px 64px 92px 92px 92px 96px 80px;' +
        'justify-content:start;align-items:center;gap:.6rem 8px;width:100%;padding:8px 0;' +
        'background:transparent;border:0;text-align:left;font:inherit;color:var(--tx)}' +
      '.ap-cab.ap-cab-sgh{padding:0 0 5px;border-bottom:1px solid var(--bd)}' +
      '.ap-sgh-linha{border-bottom:1px solid var(--bd);font:.72rem var(--mono)}' +
      '.ap-sgh-h{font:.7rem var(--mono);color:var(--tx2)}' +
      '.ap-sgh-h small{color:var(--tx3)}' +
      // A etiqueta de status, nas quatro cores que a vista tinha antes de o
      // cruzamento virar por totais.
      '.ap-sgh-tag{display:inline-block;min-width:74px;text-align:center;' +
        'font:700 .6rem var(--mono);border-radius:20px;padding:2px 8px}' +
      '.ap-sgh-tag--conferido{color:#0F6E56;background:#E1F5EE}' +
      '.ap-sgh-tag--divergente{color:#A32D2D;background:#FBE9E9}' +
      '.ap-sgh-tag--tecnox{color:#185FA5;background:#E7F0FA}' +
      '.ap-sgh-tag--soutag{color:#3C3489;background:#EEEDFE}' +
      '@media (max-width:1100px){.ap-cab-sgh{grid-template-columns:1fr auto}' +
        '.ap-cab.ap-cab-sgh{display:none}}' +
      // TABELA DE TOTAIS — oito colunas fixas, como todas as listas desta
      // tela. 210+112+102+124+124+124+82+78 = 956px de conteúdo, dentro do
      // teto de 1400 do .ap-wrap.
      // SEM 1fr, mesma razão da Movimentação: com fração os números espalham
      // até a borda do monitor e ficam longe do nome do posto.
      '.ap-cab-sgt{display:grid;grid-template-columns:210px 112px 102px 124px 124px 124px 82px 78px;' +
        'justify-content:start;align-items:center;gap:.7rem 8px;width:100%;padding:9px 0;' +
        'background:transparent;border:0;text-align:left;font:inherit;color:var(--tx)}' +
      '.ap-cab.ap-cab-sgt{padding:0 0 5px;border-bottom:1px solid var(--bd)}' +
      '.ap-sgt-linha{border-bottom:1px solid var(--bd)}' +
      // A REDE lê como cabeçalho de totais, não como o primeiro posto: fundo
      // próprio, negrito e uma borda de 2px separando-a da lista.
      '.ap-sgt-rede{border-bottom:2px solid var(--bd);font-weight:700;' +
        'background:color-mix(in srgb,var(--ac) 6%,transparent);padding:10px 0 12px}' +
      '.ap-sgt-rede .ap-nome{letter-spacing:.06em}' +
      '.ap-sgp-badge{font:700 .62rem var(--mono);border-radius:20px;padding:2px 9px;text-align:center}' +
      '.ap-sgp-ok{color:#0F6E56;background:#E1F5EE}' +
      '.ap-sgp-dv{color:#A32D2D;background:#FBE9E9}' +
      '.ap-sg-dif--dv{color:#A32D2D;font-weight:700}' +
      // O CSS do detalhe por posto (.ap-sg-det, .ap-cab-sgc, .ap-sg-tag--*)
      // saiu junto com ele: a tabela de totais não expande, e as quatro
      // etiquetas de status que essas classes pintavam não existem mais.
      '.ap-sg-legenda{font:.64rem var(--mono);color:var(--tx3);font-style:italic;padding:.7rem 0 0;line-height:1.6}' +
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
        // TOTAIS no celular: duas colunas (posto à esquerda, o número à
        // direita) e o cabeçalho some, como nas outras listas.
        '.ap-cab-sgt{grid-template-columns:1fr auto}' +
        '.ap-cab.ap-cab-sgt{display:none}' +
        '.ap-sg-bl-v{font-size:1.25rem}' +
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
  // ── Soutag × TecnoX: o cruzamento vem pronto do servidor ────────
  // A chave NÃO inclui o canal: a comparação é sempre contra o canal SOUTAG
  // (a rota fixa isso), porque comparar a planilha da Soutag com os cupons do
  // 99 acusaria divergência em 100% das linhas. Trocar o canal da tela não
  // invalida esta vista.
  function chaveSoutag() { return _de + '|' + _ate + '|' + (_soApp ? '1' : '0'); }
  function invalidarSoutag() { _sgSrv = null; _sgChave = ''; }
  // CONTADOR PROPRIO, e nao o _seq das outras duas chamadas. Elas usam o _seq
  // para descartar resposta de clique anterior, e o descarte e "meu !== _seq"
  // — inclusive no finally que desliga o "carregando".
  //
  // Compartilhar o contador com esta aqui travava a tela: importar troca o
  // periodo, chama carregar() e logo em seguida carregarSoutag(). A segunda
  // incrementa o _seq, a primeira volta com o numero velho, cai no descarte e
  // NUNCA desliga o _carregando dela — a tela fica em "Carregando…" para
  // sempre, sem erro nenhum no console. Pegado pelo testes/app-cupons.html.
  var _seqSg = 0;
  async function carregarSoutag(forcar) {
    var chave = chaveSoutag();
    if (!forcar && _sgSrv && _sgChave === chave) { pintar(); return; }
    _sgCarregando = true; _sgErro = ''; pintar();
    var meu = ++_seqSg;
    try {
      var r = await apiFetch('/app/soutag-comparar?de=' + encodeURIComponent(_de) +
        '&ate=' + encodeURIComponent(_ate) + '&so_app=' + (_soApp ? '1' : '0'));
      if (meu !== _seqSg) return;
      _sgSrv = r; _sgChave = chave;
    } catch (e) {
      if (meu !== _seqSg) return;
      _sgSrv = null; _sgChave = '';
      _sgErro = (e && e.message) ? e.message : 'Falha ao carregar a comparação';
    } finally {
      if (meu === _seqSg) { _sgCarregando = false; pintar(); }
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
    // A vista Soutag NÃO depende mais do _det: o cruzamento inteiro vem da
    // /app/soutag-comparar, que lê os dois lados no servidor.
    if (v === 'soutag') carregarSoutag();
    else if (v === 'cupom') carregarDetalhe();
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
    invalidarSoutag();
    if (_vista === 'cupom') carregarDetalhe();
    if (_vista === 'soutag') carregarSoutag();
  };
  window.__apAtalho = function (qual) {
    var ontem = somaDias(hojeISO(), -1);
    if (qual === 'ontem') { _de = ontem; _ate = ontem; }
    if (qual === '7')  { _ate = ontem; _de = somaDias(ontem, -6); }
    if (qual === '30') { _ate = ontem; _de = somaDias(ontem, -29); }
    _postoAberto = null;
    invalidarDetalhe();
    carregar();
    invalidarSoutag();
    if (_vista === 'cupom') carregarDetalhe();
    if (_vista === 'soutag') carregarSoutag();
  };
  // Recorte LOCAL, como o chip de combustível: o JSON já tem os dois blocos.
  window.__apSoApp = function () {
    if (!temFiltro()) return;
    _soApp = !_soApp;
    _postoAberto = null;
    // A vista Por posto tem os dois blocos em mão e só troca; a Por cupom
    // depende do filtro ter sido feito no servidor, então rebusca.
    invalidarDetalhe();
    // O so_app É PARÂMETRO DA ROTA na vista Soutag: o preço de placa não é
    // coluna, é agregado da venda de pista, e o corte é feito no servidor.
    // Por isso aqui rebusca, ao contrário da vista Por posto, que tem os dois
    // blocos em mão.
    invalidarSoutag();
    if (_vista === 'cupom') carregarDetalhe();
    else if (_vista === 'soutag') carregarSoutag();
    else pintar();
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
  // UMA LINHA POR CUPOM, não por item. A rota devolve ITEM — uma linha por
  // combustível, que é como a tecnox_cupom_app guarda — e a tela agrupa por
  // posto|data|id_cupom, porque cupom é o que o cliente levou na mão: quem
  // abasteceu GC e ET no mesmo atendimento pagou UM cupom, e duas linhas
  // faziam esse atendimento parecer dois.
  //
  // O CHIP FILTRA POR CONTER: o cupom de GC+ET aparece no filtro GC e também
  // no ET. Nos dois casos os litros, o valor e o R$/litro da linha são do
  // CUPOM INTEIRO — a linha é o cupom, não o pedaço dele que o chip escolheu.
  // É a única leitura coerente com "uma linha por cupom", e tem uma
  // consequência que a tela precisa dizer em voz alta: com o chip GC aceso, a
  // REDE soma litros de ET dos cupons mistos. A nota embaixo da lista conta
  // quantos cupons são, senão o total não fecharia com o litro de GC do dia e
  // pareceria erro de conta.
  function agruparCupons(itens) {
    var mapa = {}, ordem = [];
    itens.forEach(function (i) {
      var ck = chaveCupom(i);
      var g = mapa[ck];
      if (!g) {
        g = mapa[ck] = { chave: ck, data: i.data, posto_id: i.posto_id,
          nome_posto: i.nome_posto, canal: i.canal, id_cupom: i.id_cupom,
          combs: [], litros: 0, valor: 0, itens: [] };
        ordem.push(g);
      }
      g.itens.push(i);
      g.litros += Number(i.litros) || 0;
      g.valor += Number(i.valor_liquido) || 0;
      // DISTINTOS e na ordem em que aparecem: cupom com dois itens de ET
      // (existe — 14/09/2026 tem 151 cupons de mais de um item, e o primeiro
      // deles é ET+ET) mostra UM chip, porque o combustível é o mesmo.
      if (i.combustivel && g.combs.indexOf(i.combustivel) < 0) g.combs.push(i.combustivel);
    });
    ordem.forEach(function (g) {
      // PONDERADO pelos litros, e não a média dos preços dos itens: 5 L de GC
      // a 6,00 com 40 L de ET a 4,00 dá média simples 5,00 e o cupom custou
      // 4,22/L. O ponderado é o que o cliente pagou por litro.
      g.preco = g.litros > 0 ? (g.valor / g.litros) : null;
      g.combs_rot = g.combs.join('·');
    });
    return ordem;
  }
  // Agrupar 3.740 itens a cada pintar() é trabalho jogado fora; a memória é
  // pela IDENTIDADE do array de itens, que só muda quando a rota responde de
  // novo. Trocar chip, ordem ou abrir cupom reusa o mesmo agrupamento.
  var _grupos = null, _gruposDe = null;
  function cuponsDoDet() {
    var itens = (_det && _det.itens) || [];
    if (_gruposDe !== itens) { _grupos = agruparCupons(itens); _gruposDe = itens; }
    return _grupos;
  }
  function cuponsDaVista() {
    var todos = cuponsDoDet();
    var so = (_comb === COMB_TODOS)
      ? todos.slice()
      : todos.filter(function (g) { return g.combs.indexOf(_comb) >= 0; });
    var dir = (_ordemDet.dir === 'asc') ? 1 : -1;
    var campo = _ordemDet.campo;
    var valor = function (g) {
      if (campo === 'data') return g.data;
      if (campo === 'posto') return String(g.nome_posto || '');
      if (campo === 'comb') return g.combs_rot;
      if (campo === 'litros') return g.litros;
      if (campo === 'valor') return g.valor;
      // O preço da ordenação é o PONDERADO do cupom, o mesmo que a coluna
      // mostra. Cupom sem litro (não deve haver) vai para o fim.
      return g.preco === null ? Infinity : g.preco;
    };
    // slice() antes do sort: ordenar no lugar mexeria no array memorizado, e
    // a próxima troca de chip herdaria a ordem da anterior.
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
      h('ap-c-comb', 'Combustíveis', 'comb') +
      h('ap-n', 'Litros', 'litros') +
      h('ap-n', 'R$/litro', 'preco') +
      h('ap-n', 'Valor', 'valor') +
    '</div>';
  }
  // Os chips da célula: um por combustível distinto do cupom, separados pelo
  // ponto — "GC · ET".
  function chipsComb(combs) {
    if (!combs || !combs.length) return '<span class="ap-cchip">—</span>';
    return combs.map(function (c) {
      return '<span class="ap-cchip">' + esc(c) + '</span>';
    }).join('<span class="ap-cdot">·</span>');
  }
  function htmlListaCupom() {
    if (_detCarregando) return '<div class="ap-estado">Carregando cupons…</div>';
    if (_detErro) return '<div class="ap-erro">' + esc(_detErro) + '</div>';
    if (!_det) return '<div class="ap-estado">—</div>';
    var cor = CANAIS[_canal].cor, fundo = CANAIS[_canal].fundo;
    var cupons = cuponsDaVista();
    if (!cupons.length) {
      return htmlCabCupom() + '<div class="ap-vazio">Nenhum cupom de ' + esc(nomeComb(_comb)) +
        ' neste recorte.</div>';
    }
    // REDE no topo: a soma DO QUE ESTÁ NA LISTA, não do dia inteiro — é o que
    // fecha com as linhas abaixo dela. O preço é PONDERADO (valor/litros da
    // lista), o mesmo critério das linhas; a média das médias dos cupons daria
    // um número que não é o preço de nada.
    var nL = 0, nV = 0, mistos = 0;
    cupons.forEach(function (g) {
      nL += g.litros; nV += g.valor;
      if (g.combs.length > 1) mistos++;
    });
    var rede = '<div class="ap-rede ap-cab-cup">' +
      '<span class="ap-c-data">REDE</span>' +
      // "cupons", não "cupom"+"s": o plural troca a letra. Um `+ 's'` dava
      // "cupoms" na tela. E são cupons DISTINTOS, porque a linha é o cupom.
      '<span class="ap-c-posto">' + nf(cupons.length, 0) +
        (cupons.length === 1 ? ' cupom' : ' cupons') + '</span>' +
      '<span class="ap-c-comb">' + esc(rotComb(_comb)) + '</span>' +
      '<span class="ap-n">' + litros(nL) + '</span>' +
      '<span class="ap-n" style="color:' + cor + ';font-weight:700">' +
        (nL > 0 ? preco(nV / nL) : '—') + '</span>' +
      '<span class="ap-n">' + reais(nV) + '</span>' +
    '</div>';
    var linhas = cupons.map(function (g) {
      var aberto = (_cupomAberto === g.chave);
      return '<div class="ap-linha ap-cab-cup ap-linha-cup' + (aberto ? ' aberto' : '') + '"' +
        ' role="button" tabindex="0" aria-expanded="' + (aberto ? 'true' : 'false') + '"' +
        ' onclick="__apCupom(\'' + esc(g.chave) + '\')">' +
        '<span class="ap-c-data">' + esc(diaCurto(g.data)) + '</span>' +
        '<span class="ap-c-posto"><span class="ap-badge" style="background:' + fundo +
          ';color:' + cor + '">' + esc(g.nome_posto || '—') + '</span></span>' +
        '<span class="ap-c-comb">' + chipsComb(g.combs) + '</span>' +
        '<span class="ap-n">' + litros(g.litros) + '</span>' +
        '<span class="ap-n" style="color:' + cor + ';font-weight:700">' + preco(g.preco) + '</span>' +
        '<span class="ap-n">' + reais(g.valor) + '</span>' +
      '</div>' + (aberto ? htmlCupomDet(g) : '');
    }).join('');
    // A nota dos mistos só aparece quando há chip de combustível aceso E há
    // cupom misto na lista: é aí que o total da REDE passa a contar litro de
    // outro combustível. No chip TODOS não há o que avisar.
    // CLASSE PRÓPRIA além do .ap-aviso: esta lista pode ter DUAS notas ao mesmo
    // tempo (esta e a do teto da rota), e com uma classe só nada no DOM
    // distingue uma da outra — quem lê a tela por seletor pega a errada.
    var notaMista = (_comb !== COMB_TODOS && mistos)
      ? '<div class="ap-aviso ap-aviso--misto">' + nf(mistos, 0) + (mistos === 1 ? ' cupom desta lista tem' : ' cupons desta lista têm') +
        ' mais de um combustível — litros, valor e R$/litro da linha são do cupom inteiro, ' +
        'não só de ' + esc(_comb) + '.</div>'
      : '';
    // O aviso do teto vem da ROTA, com o número dela — repetir 2000 aqui
    // seria uma segunda cópia do limite.
    var aviso = _det.aviso
      ? '<div class="ap-aviso ap-aviso--teto">' + esc(_det.aviso) + ' (' + nf(_det.total, 0) +
        ' itens no recorte)</div>'
      : '';
    return '<div class="ap-lista">' + htmlCabCupom() + rede + linhas + '</div>' + notaMista + aviso;
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
  // Recebe o GRUPO que a lista já montou — o mesmo objeto da linha clicada.
  // Antes refiltrava _det.itens pela chave; com o agrupamento isso seria a
  // segunda volta no mesmo conjunto para chegar ao que já estava em mão.
  function htmlCupomDet(g) {
    var itens = g.itens || [];
    if (!itens.length) return '';
    var i0 = itens[0];
    var cfg = CANAIS[i0.canal] || CANAIS[_canal] || { rot: i0.canal, cor: '', fundo: '' };
    var somaL = g.litros, somaV = g.valor;

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

  // ── O cruzamento MORA NO SERVIDOR ───────────────────────────────
  // Ele vivia aqui: 190 linhas que casavam nome de posto (Levenshtein contra
  // os 37) e cruzavam a planilha contra os itens da TecnoX, tudo em memória,
  // sobre um arquivo que nunca saía desta máquina.
  //
  // Saiu inteiro para lib/soutag.js, atrás da GET /app/soutag-comparar, porque
  // o pedido mudou o que a tela é: a planilha passa a ser GRAVADA, e quem
  // abre depois tem de ver a mesma comparação sem ter o arquivo. Uma conta
  // que decide o que está conferido não pode existir em duas cópias — a do
  // navegador e a do servidor divergiriam na primeira correção feita só de um
  // lado, e ninguém veria.
  //
  // O QUE FICOU AQUI é só a leitura do .xlsx (lerPlanilha, acima): o SheetJS
  // não sobe para a API por causa de um upload de arquivo. O front lê a
  // planilha, manda as linhas para a POST /app/soutag-importar e desenha o
  // que a GET /app/soutag-comparar devolver.
  //
  // A NORMALIZAÇÃO DE NOME também foi junto (lib/soutag.js: nucleo/resolver),
  // e lá ela ganhou o mapa fixo dos nomes que a razão social não entrega —
  // BARBOSA→DUDU, VF→BIANCA, CRS→OURO BRANCO, PAIVA→BEATRIZ. O harness dela é
  // jbretas-api/teste-soutag.js.

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
  // ════════ A HORA DA MESMA CÉLULA ════════
  // A coluna da planilha chama-se "Data/Hora" e SEMPRE teve a hora — o
  // diaDaCelula acima é que a descartava, porque o cruzamento era por dia.
  // Agora a TecnoX manda `hra_inicio` e o cruzamento pode ser por instante;
  // sem esta leitura, o lado Soutag entraria no banco em 00:00:00 e o
  // cruzamento por hora nunca ligaria (ver `horaUtil` em lib/soutag.js).
  //
  // DEVOLVE ISO SEM FUSO ('2026-09-18T04:30:05'), a hora LOCAL do posto, que
  // é como a TecnoX manda a dela. Os dois lados carregando a mesma hora local
  // é o que faz a diferença entre eles fechar sem nenhum dos dois precisar
  // declarar fuso.
  //
  // SERIAL DO EXCEL: a parte fracionária é a hora do dia. `(v % 1) * 86400`
  // dá os segundos. Arredonda ao SEGUNDO antes de formatar porque o serial é
  // float e 04:30:05 costuma chegar como 04:30:04,9999.
  //
  // SEM HORA DEVOLVE '' — e não meia-noite. Meia-noite cravada é o sinal de
  // "só o dia" do outro lado; devolvê-la aqui faria uma planilha sem hora
  // parecer uma planilha de transações à 00:00:00.
  function horaDaCelula(v) {
    if (v === null || v === undefined || v === '') return '';
    var dia = diaDaCelula(v);
    if (!dia) return '';
    var hh, mm, ss;
    if (typeof v === 'number' && isFinite(v)) {
      var frac = v - Math.floor(v);
      if (frac <= 0) return '';                 // serial sem parte de hora
      var seg = Math.round(frac * 86400) % 86400;
      hh = Math.floor(seg / 3600); mm = Math.floor((seg % 3600) / 60); ss = seg % 60;
    } else {
      var m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v));
      if (!m) return '';
      hh = Number(m[1]); mm = Number(m[2]); ss = Number(m[3] || 0);
      if (hh > 23 || mm > 59 || ss > 59) return '';
    }
    var p2 = function (n) { return ('0' + n).slice(-2); };
    return dia + 'T' + p2(hh) + ':' + p2(mm) + ':' + p2(ss);
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
    // OPCIONAL: a planilha da Soutag pode ou não trazer o volume. Quando não
    // traz, os litros do lado Soutag ficam em travessão e o card de diferença
    // de litros diz por quê — em vez de mostrar zero e acusar a TecnoX de
    // inventar volume.
    litros: ['LITROS', 'QUANTIDADE', 'QTD', 'QTDE', 'VOLUME', 'LITRAGEM'],
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
        // ADITIVO: '' quando a planilha não traz hora. O `data` acima segue
        // sendo o dia e continua sendo quem manda no recorte — a hora é
        // informação a mais, exatamente como do lado da TecnoX.
        data_hora: horaDaCelula(r[de.data]),
        valor: numeroDaCelula(r[de.valor]),
        combustivel: codComb(r[de.combustivel]),
        usuario: de.usuario ? String(r[de.usuario] == null ? '' : r[de.usuario]).trim() : '',
        id: de.id ? String(r[de.id] == null ? '' : r[de.id]).trim() : '',
        litros: de.litros ? numeroDaCelula(r[de.litros]) : NaN,
      };
    }).filter(function (l) { return l.data && isFinite(l.valor); });
    if (!linhas.length) throw new Error('nenhuma linha da planilha tem data e valor legíveis');
    return { linhas: linhas, colunas: de, abas: wb.SheetNames.length, aba: aba,
             cruas: cru.length, temLitros: !!de.litros };
  }

  // ── Render da vista ─────────────────────────────────────────────
  // ── Render da vista ─────────────────────────────────────────────
  // ════════ OS QUATRO STATUS SAÍRAM ════════
  // Havia aqui um cartão-botão por status — conferidos, só TecnoX, só Soutag,
  // valor divergente — e um detalhe que abria a lista de cupons do posto.
  // Tudo isso lia o cruzamento CUPOM A CUPOM, que foi removido: a API da
  // TecnoX não devolve HORA, só o dia, e sem hora dois abastecimentos do
  // mesmo posto, dia e combustível com valores próximos são indistinguíveis.
  // "Conferido" não provava que os dois lados falavam da mesma bomba.
  //
  // No lugar, a tela compara TOTAIS por posto — ver o htmlSoutag abaixo e o
  // totalizar() de jbretas-api/lib/soutag.js.
  // O sinal ANTES da moeda: reais(-3) escreve "R$ -3,00" e o menos se perde
  // no meio da linha. Aqui sai "−R$ 3,00", que se lê de longe.
  function comSinal(v, fmt) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : (v < 0 ? '−' : '')) + fmt(Math.abs(v));
  }
  // Card de diferença: verde quando fecha, vermelho quando não. O `null` em
  // `diverge` é para a diferença de litros quando a planilha não traz volume —
  // ali não há divergência a apontar, há dado que não veio.
  function cardDif(rot, texto, diverge, sub) {
    return '<div class="ap-sg-cd ap-sg-cd--dif ' + (diverge === null ? '' : (diverge ? 'diverge' : 'igual')) + '">' +
      '<div class="ap-sg-cd-r">' + esc(rot) + '</div>' +
      '<div class="ap-sg-cd-v">' + texto + '</div>' +
      (sub ? '<div class="ap-sg-cd-s">' + esc(sub) + '</div>' : '') +
    '</div>';
  }
  // "Última importação: DD/MM/AAAA às HH:MM · N transações · importado por X"
  //
  // `por` vem da coluna importado_por de soutag_transacao; _sgImportou, desta
  // sessão. Nesta ordem, porque a coluna vale para todo mundo e a sessão só
  // para quem importou. Sem nenhum dos dois, a frase sai SEM essa parte — pôr
  // ali o nome de quem está OLHANDO faria a tela afirmar algo falso
  // justamente para quem abre sem ter importado.
  function htmlUltima() {
    var u = _sgSrv && _sgSrv.ultima_importacao;
    if (!u) return '';
    var d = new Date(u.quando);
    var quando = isNaN(d.getTime()) ? String(u.quando).slice(0, 16).replace('T', ' ')
      : (d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' às ' +
         d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo',
                                         hour: '2-digit', minute: '2-digit' }));
    var por = u.por || (_sgImportou && _sgImportou.importado_por) || '';
    return '<div class="ap-sg-ultima">Última importação: <b>' + esc(quando) + '</b> · ' +
      nf(u.transacoes, 0) + ' transações' +
      (por ? ' · importado por ' + esc(por) : '') +
      (u.arquivo ? ' · <span class="ap-mini">' + esc(u.arquivo) + '</span>' : '') +
    '</div>';
  }

  // ════════ VISTA DETALHADA (cruzamento por hora) ════════
  // Os quatro baldes de volta, agora com base: cada linha mostra a hora dos
  // DOIS lados e a diferença entre elas, que é o que permite conferir o par
  // sem acreditar na conta.
  var ROT_SGH = { conferido: 'conferido', divergente: 'valor divergente',
                  tecnox: 'só TecnoX', soutag: 'só Soutag' };
  // Filtro por status: clicar no cartão recorta a lista, clicar de novo solta.
  // Sem isso os quatro números seriam quatro números; com ele, cada um é a
  // porta para as linhas que conta.
  var _sghStatus = '';
  function hhmm(iso) {
    if (!iso) return '—';
    var m = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(iso));
    return m ? (m[1] + ':' + m[2] + (m[3] ? ':' + m[3] : '')) : '—';
  }
  function htmlSgHora(c) {
    var R = c.rede, q = c.consulta;
    var cardSgh = function (chave, rot, n, cls) {
      var on = (_sghStatus === chave);
      return '<button type="button" class="ap-sg-cd ap-sg-cd--bt ' + cls + (on ? ' on' : '') + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '" onclick="__apSghStatus(\'' + chave + '\')">' +
        '<div class="ap-sg-cd-r">' + esc(rot) + '</div>' +
        '<div class="ap-sg-cd-v">' + nf(n, 0) + '</div></button>';
    };
    var status = '<div class="ap-sg-cards">' +
      cardSgh('conferido', 'conferidos', R.conferido, 'ap-sg-cd--ok') +
      cardSgh('divergente', 'valor divergente', R.divergente, 'ap-sg-cd--dv') +
      cardSgh('tecnox', 'só TecnoX', R.so_tecnox, 'ap-sg-cd--tx') +
      cardSgh('soutag', 'só Soutag', R.so_soutag, 'ap-sg-cd--sg') +
    '</div>';

    var blocos = '<div class="ap-sg-blocos">' +
      '<div class="ap-sg-bloco ap-sg-bloco--sg">' +
        '<div class="ap-sg-bl-rot">Soutag · planilha</div>' +
        '<div class="ap-sg-bl-v">' + reais(R.sg_v) + '</div>' +
        '<div class="ap-sg-bl-l"><span class="ap-sg-bl-i"><b>' + nf(R.sg_n, 0) + '</b> transações</span>' +
          '<span class="ap-sg-bl-i"><b>' + nf(q.hora.soutag_com_hora, 0) + '</b> com hora</span></div>' +
        (R.sem_posto_n ? '<div class="ap-sg-bl-s">inclui ' + nf(R.sem_posto_n, 0) +
          ' de posto não reconhecido (' + reais(R.sem_posto_v) + ')</div>' : '') +
      '</div>' +
      '<div class="ap-sg-bloco ap-sg-bloco--tx">' +
        '<div class="ap-sg-bl-rot">TecnoX · Soutag</div>' +
        '<div class="ap-sg-bl-v">' + reais(R.tx_v) + '</div>' +
        '<div class="ap-sg-bl-l"><span class="ap-sg-bl-i"><b>' + nf(R.tx_itens, 0) + '</b> itens</span>' +
          '<span class="ap-sg-bl-i"><b>' + nf(q.hora.tecnox_com_hora, 0) + '</b> com hora</span></div>' +
      '</div>' +
    '</div>';

    // Uma lista só, com os quatro baldes juntos e ordenada por hora: é assim
    // que se lê o dia. Separar em quatro listas obrigaria a saltar entre elas
    // para entender uma sequência de abastecimentos.
    var todas = []
      .concat(c.conferido || [], c.divergente || [], c.soSoutag || [], c.soTecnox || []);
    if (_sghStatus) todas = todas.filter(function (l) { return l.status === _sghStatus; });
    todas.sort(function (a, b) {
      var ha = a.hora || a.hora_tecnox || '', hb = b.hora || b.hora_tecnox || '';
      if (ha !== hb) return ha < hb ? -1 : 1;
      return String(a.posto || '').localeCompare(String(b.posto || ''));
    });

    var cab = '<div class="ap-cab ap-cab-sgh">' +
      '<span>Hora SG</span><span>Posto</span><span>Comb.</span>' +
      '<span class="ap-n">R$ Soutag</span><span class="ap-n">R$ TecnoX</span>' +
      '<span class="ap-n">Dif R$</span><span>Hora TecnoX</span><span></span>' +
    '</div>';
    var CORTE = 400;
    var linhas = todas.slice(0, CORTE).map(function (l) {
      return '<div class="ap-cab-sgh ap-sgh-linha">' +
        '<span class="ap-sgh-h">' + esc(hhmm(l.hora)) + '</span>' +
        '<span class="ap-nome" title="' + esc(l.posto || l.posto_planilha || '') + '">' +
          esc(l.posto || l.posto_planilha || '(não reconhecido)') + '</span>' +
        '<span>' + esc(l.comb || '—') + '</span>' +
        '<span class="ap-n">' + (l.valor === undefined ? '—' : reais(l.valor)) + '</span>' +
        '<span class="ap-n">' + (l.valor_tecnox === undefined ? '—' : reais(l.valor_tecnox)) + '</span>' +
        '<span class="ap-n' + ((l.dif !== undefined && Math.abs(l.dif) > 0.004) ? ' ap-sg-dif--dv' : '') + '">' +
          (l.dif === undefined ? '—' : comSinal(l.dif, reais)) + '</span>' +
        '<span class="ap-sgh-h">' + esc(hhmm(l.hora_tecnox)) +
          // A diferença entre as duas horas, em minutos: é ela que diz se o
          // par está no limite da janela de 5 min ou folgado no meio dela.
          (l.dif_min === null || l.dif_min === undefined ? ''
            : ' <small>' + comSinal(l.dif_min, function (x) { return nf(x, 1) + ' min'; }) + '</small>') +
        '</span>' +
        '<span><span class="ap-sgh-tag ap-sgh-tag--' + l.status + '">' +
          esc(ROT_SGH[l.status]) + '</span></span>' +
      '</div>';
    }).join('');
    var corte = todas.length > CORTE
      ? '<div class="ap-aviso">mostrando ' + CORTE + ' de ' + nf(todas.length, 0) + ' linhas</div>' : '';

    var avisoNome = c.naoCasou.length
      ? '<div class="ap-aviso">' + nf(c.naoCasou.length, 0) +
        (c.naoCasou.length === 1 ? ' nome da planilha não casou' : ' nomes da planilha não casaram') +
        ' com nenhum posto: ' +
        c.naoCasou.slice(0, 8).map(function (x) {
          return esc(x.nome) + ' (' + nf(x.n, 0) + ')';
        }).join(' · ') + (c.naoCasou.length > 8 ? ' …' : '') + '</div>'
      : '';

    var legenda = '<div class="ap-sg-legenda">' +
      'Comparação <b>transação a transação</b>, pelo horário: o par é o mesmo posto e ' +
      'combustível dentro de <b>' + nf(q.tolerancia_min, 0) + ' min</b>, e o valor é o que se ' +
      'CONFERE — dentro de ' + reais(q.tolerancia_valor) + ' é conferido, fora é valor divergente.<br>' +
      'O valor não entra na chave de propósito: se entrasse, uma transação com valor errado não ' +
      'acharia par e viraria "só Soutag", escondendo justamente a divergência que esta tela procura.<br>' +
      '<b>só TecnoX</b>: saiu cupom e não há linha na planilha. <b>só Soutag</b>: há linha e ' +
      'nenhum cupom dentro da janela — inclusive as de posto não reconhecido.<br>' +
      (q.so_app
        ? '<b>Só preço de app</b> LIGADO: ' + nf(q.itens_placa, 0) + ' itens saíram no preço da placa e ' +
          'ficaram de fora. É esta a comparação que fecha.'
        : '<b>Só preço de app</b> DESLIGADO: o lado TecnoX inclui o convênio cobrado no preço da ' +
          'placa, que nunca esteve na planilha — some em "só TecnoX". Ligue o filtro para a ' +
          'comparação real.') +
    '</div>';

    return blocos + status + avisoNome +
      '<div class="ap-lista">' + cab +
      (linhas || '<div class="ap-vazio">Nada neste status.</div>') + '</div>' + corte +
      legenda;
  }

  function htmlSoutag() {
    var ocupado = _sgLendo || !!_sgPasso;
    var topo = '<div class="ap-sg-topo">' +
      '<button type="button" class="ap-cbtn ap-sg-imp" onclick="__apSgAbrir()"' +
        (ocupado ? ' disabled' : '') + '>' +
        (ocupado ? (_sgPasso || 'Lendo a planilha…') : 'Importar planilha Soutag') + '</button>' +
      '<input type="file" id="ap-sg-file" accept=".xlsx,.xls" hidden onchange="__apSgArquivo(this)">' +
      // Recarregar sem importar: a tabela é compartilhada, e outra pessoa pode
      // ter subido uma planilha enquanto esta tela estava aberta.
      '<button type="button" class="ap-atalho" onclick="__apSgRecarregar()"' +
        (ocupado || _sgCarregando ? ' disabled' : '') + '>↻ Atualizar</button>' +
    '</div>';
    topo += htmlUltima();
    if (_sgErro) topo += '<div class="ap-erro">' + esc(_sgErro) + '</div>';
    // O resumo do POST desta sessão: janela apagada e linhas recusadas não
    // podem ser silenciosas — a importação APAGA o período do lote.
    if (_sgImportou) {
      var im = _sgImportou;
      topo += '<div class="ap-aviso">Gravadas ' + nf(im.gravadas, 0) + ' de ' +
        nf(im.recebidas, 0) + ' linhas · período ' + esc(diaCurto(im.periodo.de)) + ' a ' +
        esc(diaCurto(im.periodo.ate)) + ' (substituiu ' + nf(im.apagadas, 0) + ')' +
        (im.recusadas ? ' · ' + nf(im.recusadas, 0) + ' sem data/valor legíveis' : '') +
        (im.sem_posto ? ' · ' + nf(im.sem_posto, 0) + ' de posto não reconhecido' : '') +
        // A HORA É O QUE DECIDE O MODO do cruzamento, então ela aparece aqui,
        // no momento em que ainda dá para trocar de arquivo.
        (im.com_hora === undefined ? ''
          : (im.com_hora ? ' · ' + nf(im.com_hora, 0) + ' com hora'
                         : ' · <b>sem hora na planilha</b> — a comparação fica por totais')) +
      '</div>';
    }
    if (_sgCarregando && !_sgSrv) {
      return topo + '<div class="ap-estado">Carregando a comparação…</div>';
    }
    if (!_sgSrv) return topo + '<div class="ap-estado">—</div>';
    var c = _sgSrv;
    if (!c.rede.sg_n) {
      return topo + '<div class="ap-estado">Nenhuma transação da Soutag gravada neste período.' +
        '<br><span class="ap-sub">Importe a planilha para comparar com os ' +
        nf(c.rede.tx_itens, 0) + ' itens que a TecnoX tem aqui. ' +
        'Colunas esperadas: Posto · Data/Hora · Valor · Combustível. ' +
        'Usuário e ID entram se existirem.' +
        '<br>A planilha é lida no navegador e GRAVADA: quem abrir esta tela depois ' +
        'vê a mesma comparação sem precisar do arquivo.</span></div>';
    }

    // ── Os dois lados ──
    var sgL = (c.rede.sg_l === null) ? '—' : litros(c.rede.sg_l);
    var blocos = '<div class="ap-sg-blocos">' +
      '<div class="ap-sg-bloco ap-sg-bloco--sg">' +
        '<div class="ap-sg-bl-rot">Soutag · planilha</div>' +
        '<div class="ap-sg-bl-v">' + reais(c.rede.sg_v) + '</div>' +
        '<div class="ap-sg-bl-l">' +
          '<span class="ap-sg-bl-i"><b>' + nf(c.rede.sg_n, 0) + '</b> transações</span>' +
          '<span class="ap-sg-bl-i"><b>' + sgL + '</b>' +
            (c.rede.sg_l === null ? ' litros (a planilha não traz a coluna)' : '') + '</span>' +
        '</div>' +
        // O TOTAL É DA PLANILHA INTEIRA, inclusive as linhas cujo posto não
        // casou — é o número que fecha com o Excel de quem importou. O peso
        // delas fica aqui, para ninguém procurar a diferença no lugar errado.
        (c.rede.sem_posto_n ? '<div class="ap-sg-bl-s">inclui ' + nf(c.rede.sem_posto_n, 0) +
          ' de posto não reconhecido (' + reais(c.rede.sem_posto_v) + ')</div>' : '') +
      '</div>' +
      '<div class="ap-sg-bloco ap-sg-bloco--tx">' +
        '<div class="ap-sg-bl-rot">TecnoX · ' + esc(CANAIS[_canal].rot) + '</div>' +
        '<div class="ap-sg-bl-v">' + reais(c.rede.tx_v) + '</div>' +
        '<div class="ap-sg-bl-l">' +
          '<span class="ap-sg-bl-i"><b>' + nf(c.rede.tx_cupons, 0) + '</b> cupons</span>' +
          '<span class="ap-sg-bl-i"><b>' + nf(c.rede.tx_itens, 0) + '</b> itens</span>' +
          '<span class="ap-sg-bl-i"><b>' + litros(c.rede.tx_l) + '</b></span>' +
        '</div>' +
        // CUPONS E ITENS, os dois: o cruzamento casa ITEM com linha da
        // planilha (o cupom de GC+ET é uma linha da Soutag para cada
        // combustível), e é o item que a diferença de transações compara.
        // CUPOM E ITEM, os dois: um cupom de GC+ET tem dois itens, e a
        // planilha da Soutag traz uma linha por combustível. A comparação
        // que decide o selo é a de DINHEIRO, que não depende disso.
        '<div class="ap-sg-bl-s">um cupom pode ter vários itens; a planilha traz um por combustível</div>' +
      '</div>' +
    '</div>';

    // ════════ DOIS DESENHOS, UM POR MODO ════════
    // `consulta.modo` vem da rota: 'hora' quando os dois lados têm hora
    // utilizável, 'totais' quando não. A vista detalhada — conferidos, só
    // TecnoX, só Soutag, valor divergente — voltou com o modo por hora, que é
    // o que a torna confiável: o par é achado pelo INSTANTE e o valor é o que
    // se confere, não a chave.
    if ((c.consulta || {}).modo === 'hora') return topo + htmlSgHora(c);

    // ── As três diferenças da rede ──
    var R = c.rede;
    var dL = (R.sg_l === null) ? null : Math.round(R.sg_l - R.tx_l);
    var difs = '<div class="ap-sg-cards">' +
      cardDif('Diferença R$', comSinal(R.dif, reais), !R.ok,
        R.dif_pct === null ? 'sem base de comparação' : comSinal(R.dif_pct, function (x) { return nf(x, 2) + '%'; }) + ' sobre a TecnoX') +
      cardDif('Diferença litros', comSinal(dL, litros),
        dL === null ? null : Math.abs(dL) >= 1,
        dL === null ? 'a planilha não traz litros' : 'Soutag − TecnoX') +
      cardDif('Postos que divergem', nf(R.postos_divergentes, 0), R.postos_divergentes > 0,
        'de ' + nf(R.postos, 0) + ' com movimento') +
    '</div>';

    var avisoNome = c.naoCasou.length
      ? '<div class="ap-aviso">' + nf(c.naoCasou.length, 0) +
        (c.naoCasou.length === 1 ? ' nome da planilha não casou' : ' nomes da planilha não casaram') +
        ' com nenhum posto: ' +
        c.naoCasou.slice(0, 8).map(function (x) {
          return esc(x.nome) + ' (' + nf(x.n, 0) + ')';
        }).join(' · ') + (c.naoCasou.length > 8 ? ' …' : '') + '</div>'
      : '';

    // ── A TABELA POR POSTO ──
    // Sete colunas fixas, sem 1fr: mesma razão das outras listas desta tela —
    // com fração os números fogem para a borda do monitor e ficam longe do
    // nome do posto.
    //
    // A ORDEM VEM DO SERVIDOR (diferença em módulo, quem mais diverge
    // primeiro). A tela não reordena: o critério é o mesmo que decide o selo,
    // e tê-lo em dois lugares é tê-lo divergindo um dia.
    //
    // A LINHA REDE NÃO É UM POSTO e por isso não é clicável nem entra na
    // ordenação: ela é o total, fica no topo e tem borda própria — o mesmo
    // desenho da REDE na lista Por posto.
    var pct = function (v) { return v === null || v === undefined ? '—' : comSinal(v, function (x) { return nf(x, 2) + '%'; }); };
    var cab = '<div class="ap-cab ap-cab-sgt">' +
      '<span>Posto</span>' +
      '<span class="ap-n">Transações SG</span><span class="ap-n">Cupons TX</span>' +
      '<span class="ap-n">R$ Soutag</span><span class="ap-n">R$ TecnoX</span>' +
      '<span class="ap-n">Diferença R$</span><span class="ap-n">Dif %</span>' +
      '<span></span>' +
    '</div>';
    var linhaRede = '<div class="ap-cab-sgt ap-sgt-rede">' +
      '<span class="ap-nome">REDE</span>' +
      '<span class="ap-n">' + nf(R.sg_n, 0) + '</span>' +
      '<span class="ap-n">' + nf(R.tx_cupons, 0) +
        '<span class="ap-mini">' + nf(R.tx_itens, 0) + ' itens</span></span>' +
      '<span class="ap-n">' + reais(R.sg_v) + '</span>' +
      '<span class="ap-n">' + reais(R.tx_v) + '</span>' +
      '<span class="ap-n' + (R.ok ? '' : ' ap-sg-dif--dv') + '">' + comSinal(R.dif, reais) + '</span>' +
      '<span class="ap-n' + (R.ok ? '' : ' ap-sg-dif--dv') + '">' + pct(R.dif_pct) + '</span>' +
      '<span class="ap-sgp-badge ' + (R.ok ? 'ap-sgp-ok' : 'ap-sgp-dv') + '">' +
        (R.ok ? 'ok' : 'diverge') + '</span>' +
    '</div>';
    var linhas = (c.postos || []).map(function (p) {
      return '<div class="ap-cab-sgt ap-sgt-linha">' +
        '<span class="ap-nome" title="' + esc(p.nome) + '">' + esc(p.nome) + '</span>' +
        '<span class="ap-n">' + nf(p.sg_n, 0) + '</span>' +
        '<span class="ap-n">' + nf(p.tx_cupons, 0) +
          '<span class="ap-mini">' + nf(p.tx_itens, 0) + ' itens</span></span>' +
        '<span class="ap-n">' + reais(p.sg_v) + '</span>' +
        '<span class="ap-n">' + reais(p.tx_v) + '</span>' +
        '<span class="ap-n' + (p.ok ? '' : ' ap-sg-dif--dv') + '">' + comSinal(p.dif, reais) + '</span>' +
        '<span class="ap-n' + (p.ok ? '' : ' ap-sg-dif--dv') + '">' + pct(p.dif_pct) + '</span>' +
        '<span class="ap-sgp-badge ' + (p.ok ? 'ap-sgp-ok' : 'ap-sgp-dv') + '">' +
          (p.ok ? 'ok' : 'diverge') + '</span>' +
      '</div>';
    }).join('');

    var legenda = '<div class="ap-sg-legenda">' +
      'Comparação por <b>totais de cada posto</b>, não transação a transação: a API da ' +
      'TecnoX devolve o dia, não a hora, e sem hora dois abastecimentos do mesmo posto, ' +
      'dia e combustível com valores próximos são indistinguíveis — casar por valor seria ' +
      'sorteio.<br>' +
      '<b>ok</b> = diferença abaixo de ' + nf(c.consulta.tolerancia_pct, 0) + '% sobre a TecnoX. ' +
      '<b>diverge</b> = ' + nf(c.consulta.tolerancia_pct, 0) + '% ou mais. ' +
      'Posto sem cupom nenhum na TecnoX nunca é ok: não há denominador, e ' +
      'chamá-lo de ok por falta de base esconderia justamente o caso mais grave.<br>' +
      // O toggle é o que torna a comparação honesta — ver o comentário da rota.
      (c.consulta.so_app
        ? '<b>Só preço de app</b> está LIGADO: dos ' + nf(c.consulta.tecnox_itens_total, 0) +
          ' itens do convênio, ' + nf(c.consulta.itens_placa, 0) + ' saíram no preço da placa ' +
          'e ficaram de fora. É esta a comparação que fecha — a planilha da Soutag só traz ' +
          'transação em que o app mudou o preço.'
        : '<b>Só preço de app</b> está DESLIGADO: o lado TecnoX inclui os abastecimentos do ' +
          'convênio cobrados no preço da placa, que nunca estiveram na planilha da Soutag. ' +
          'A diferença tende a sair negativa em todo posto, e isso não é erro de ninguém — ' +
          'ligue o filtro para a comparação real.') +
    '</div>';

    return topo + blocos + difs + avisoNome +
      '<div class="ap-lista">' + cab + linhaRede +
      (linhas || '<div class="ap-vazio">Nenhum posto com movimento no período.</div>') + '</div>' +
      legenda;
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
    // TRÊS PASSOS, e cada um aparece no botão: ler o .xlsx, GRAVAR e comparar.
    // Antes era um só (ler), e a planilha morria na aba. O passo do meio é o
    // que torna a comparação compartilhada.
    //
    // O PARSE CONTINUA NO NAVEGADOR: o SheetJS não sobe para a API só por
    // causa de um upload de arquivo. O que vai para a rota são as linhas já
    // lidas — e é a rota que resolve o posto, apaga o período e grava.
    _sgLendo = true; _sgErro = ''; _sgImportou = null; pintar();
    var r;
    try {
      var XLSX = await carregarXlsx();
      var buf = new Uint8Array(await file.arrayBuffer());
      r = lerPlanilha(XLSX, buf);
      _sg = { linhas: r.linhas, arquivo: file.name, quando: new Date(),
              colunas: r.colunas, cruas: r.cruas, temLitros: r.temLitros };
    } catch (e) {
      _sg = null;
      _sgErro = 'Não foi possível ler a planilha: ' + ((e && e.message) ? e.message : e);
      _sgLendo = false; pintar();
      return;
    }
    _sgLendo = false;
    _sgPasso = 'Gravando ' + nf(r.linhas.length, 0) + ' transações…';
    pintar();
    try {
      var resp = await apiFetch('/app/soutag-importar', { method: 'POST', body: JSON.stringify({
        arquivo: file.name,
        transacoes: r.linhas.map(function (l) {
          // `litros` vai mesmo sem a coluna existir: a rota o descarta
          // sozinho enquanto ela não estiver lá (ver o bloco OPCIONAL em
          // sql/soutag_transacao.sql). Assim, criar a coluna basta.
          return { posto_nome: l.posto_planilha, data: l.data,
                   // `data_hora` vai mesmo vazia: a rota decide entre gravar o
                   // instante e gravar o dia à meia-noite, e é lá que essa
                   // regra mora — uma só, em vez de uma em cada tela.
                   data_hora: l.data_hora || null,
                   valor: l.valor,
                   combustivel: l.combustivel, usuario: l.usuario, id_soutag: l.id,
                   litros: isFinite(l.litros) ? l.litros : null };
        }),
      }) });
      _sgImportou = resp;
      // O PERÍODO DA TELA PASSA A SER O DO ARQUIVO quando eles não batem.
      // Sem isto, importar a planilha de agosto com a tela em setembro gravava
      // certo e mostrava a comparação de setembro — vazia — e pareceria que a
      // importação não funcionou.
      if (resp.periodo && (resp.periodo.de !== _de || resp.periodo.ate !== _ate)) {
        _de = resp.periodo.de; _ate = resp.periodo.ate;
        invalidarDetalhe();
        carregar();
      }
    } catch (e) {
      _sgErro = 'A planilha foi lida, mas não foi gravada: ' + ((e && e.message) ? e.message : e);
      _sgPasso = ''; pintar();
      return;
    }
    _sgPasso = 'Comparando…'; pintar();
    // forcar: o recorte pode ser o mesmo de antes, e o que mudou foi o banco.
    await carregarSoutag(true);
    _sgPasso = ''; pintar();
  };
  // Relê do banco sem importar nada.
  window.__apSgRecarregar = function () { carregarSoutag(true); };
  // Filtro por status na vista detalhada. Recorte LOCAL: os quatro baldes já
  // estão na memória, e clicar não refaz chamada. Clicar no cartão aceso
  // solta o filtro — sem isso, quem clica num dos quatro fica preso nele e
  // vai procurar um botão "todos" que não existe.
  window.__apSghStatus = function (v) {
    _sghStatus = (_sghStatus === v) ? '' : (v || '');
    pintar();
  };
  // __apSgPosto e __apSgStatus saíram junto com o detalhe por posto e os
  // quatro cartões de status: a tabela de totais não expande nem filtra.
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
    // Reabrir NA VISTA SOUTAG busca a comparação se ela não estiver em mão.
    // É o caminho do Felipe: ele abre a tela, não importa nada, e tem de ver
    // o que a última importação gravou. Sem isto, a vista abriria vazia até
    // alguém clicar em algo.
    if (_vista === 'soutag' && !_sgSrv && !_sgCarregando) { carregarSoutag(); return; }
    pintar();     // reabertura: não refaz a chamada
  };
})();
