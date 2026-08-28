// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/mercado.js
// Mercado de custo de compra (bandeira branca). Tela PRÓPRIA do
// painel-adm, 5ª entrada do seletor nav-custo.js. Padrão do
// fornecedores.js: IIFE, CSS injetado escopado (.mrc-*) e tokens
// CURTOS (--sf/--bd/--ac/--tx/--dg/--wn/--ok/--rl), resolvidos pela
// camada de alias do painel-adm.css.
// Expõe window.renderMercado(sec).
//
// Duas metades: LANÇAMENTO dos preços de bandeira branca do dia, e
// PAINEL (#mrc-painel) com um velocímetro por combustível + ranking.
// Sem lib de gráfico — os velocímetros são SVG inline.
//
// GUARD PRÓPRIO (não reusa o do custo-margem): o custo-margem decide
// leitura por HOST (readonly fora de /logistica/), o que tornaria esta
// tela somente-leitura justamente no painel-adm, onde ela PRECISA
// gravar. Aqui o critério é o PERFIL, igual ao backend
// (POST /custos-mercado aceita ADM + LOGISTICA). custo-margem.js
// NÃO é tocado.
// ================================================================
(function () {
  'use strict';

  // Largura mínima. Lançar 20 preços não cabe em tela de celular; o
  // nav-custo já esconde o botão abaixo disto (flag desktopOnly), este
  // guard cobre quem chegar por __navCusto direto ou redimensionando.
  // 800 (era 900): janela não-maximizada de ~835px útil precisa passar. A grade
  // cabe porque os slots quebram em 2 linhas (.mrc-slots é auto-fit).
  const MIN_LARGURA = 800;
  const SLOTS_MIN = 4;          // 4 distribuidoras por combustível (3 a 4 no uso real)
  const PERFIS_EDITAM = ['ADM', 'LOGISTICA'];

  // ── Painel (parte b) ─────────────────────────────────────────────
  // Ids reservados — espelham o backend. As derivadas são as 3 referências de
  // mercado; MRC_PFX_BAND prefixa a série de BANDEIRA PRÓPRIA, porque
  // 'RIO BRANCO' é bandeira nossa E nome de distribuidora de mercado: sem o
  // prefixo as duas origens cairiam na mesma série.
  const MRC_MENOR      = '__MENOR__';
  const MRC_MEDIA3     = '__MEDIA3__';
  const MRC_MEDIATODAS = '__MEDIATODAS__';
  const MRC_PFX_BAND   = '__B__';
  // Faixas do termômetro, em CENTAVOS. Regra do negócio: verde até 10, âmbar de
  // 10 a 15, vermelho acima de 15. MAX = fim de escala do velocímetro.
  const FAIXA_OK  = 10;
  const FAIXA_ATN = 15;
  const GAUGE_MAX = 25;

  // Rótulo de exibição. A lista AUTORITATIVA de códigos e de distribuidoras vem
  // do GET /custos-mercado (fonte única, no backend) — isto aqui é só o nome
  // bonito. Sem GA: aditivada não é cotada no mercado de bandeira branca (o
  // corte é só deste painel; o GA segue normal no resto do sistema).
  const NOME_COMB = {
    GC: 'Gasolina comum', ET: 'Etanol',
    S10: 'Diesel S-10', S500: 'Diesel S-500',
  };

  let _shellPronto = false;
  let _modo        = null;      // 'completo' (lançamento+painel) | 'painel' (leitura)
  let _dataISO     = null;
  let _combs       = [];        // códigos, do backend
  let _distrs      = [];        // distribuidoras canônicas, do backend
  let _grade       = {};        // { GC: [{distr, preco, prefill, cheio}], ... }
  let _originais   = new Set(); // "COMB|DISTR" que existiam no dia carregado
  let _lancando    = false;     // form de lançamento aberto?
  let _salvando    = false;
  // Nomes NOVOS que o usuário confirmou nesta sessão de lançamento, por chave de
  // comparação. Só o que está aqui vai com `permitir_nova` no POST — o backend
  // recusa nome desconhecido sem essa flag (409), então esquecer de preencher
  // isto não grava lixo em silêncio: dá erro.
  let _novasOk     = new Set();
  // Confirmação pendente: { cb, i, nome, similar, anterior }. `anterior` é pra o
  // Cancelar devolver a célula ao que estava, sem re-render da grade toda.
  let _pendNova    = null;
  // Painel (parte b)
  let _pData  = null;           // resposta de GET /mercado-dashboard
  let _pComb  = null;           // combustível ativo — controla gráfico, termômetro e ranking
  let _pA     = MRC_MENOR;                     // esquerda: o piso do mercado
  let _pB     = MRC_PFX_BAND + 'IPIRANGA';     // direita: minha bandeira

  // ── Helpers ──────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Mesma convenção do custo-margem.js: até 4 casas, vírgula decimal BR.
  function parseCustoBR(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = parseFloat(norm.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : Math.round(n * 10000) / 10000;
  }
  function fmtN(v, min, max) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (isNaN(n)) return '';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
  }
  // 4 casas NA TELA. Era 2, e 2 escondia diferença que decide negociação: em
  // 28/08 a IPIRANGA teve 5,9747 em 11 postos, 5,9755 no ESPAÇO REAL e 5,9745
  // no SÃO LUIZ RL — os três aparecem como "5,97" com 2 casas. O banco guarda
  // numeric(8,4), então 4 é a precisão real da fonte.
  // min 2 de propósito: valor redondo sai "5,90" e não "5,9".
  const fmtTela  = (v) => fmtN(v, 2, 4);
  // Mesma precisão que fmtTela — segue existindo porque o title tem outro
  // sentido: mostra o valor GRAVADO ao lado do que está sendo digitado.
  const fmtCheio = fmtTela;
  const fmtCent  = (v) => fmtN(v, 1, 1);   // centavos, 1 casa
  // Diferença em CENTAVOS, arredondada. OBRIGATÓRIO arredondar: (5.94-5.79)*100
  // dá 15.000000000000009 em float, e uma diferença de exatamente 15¢ cairia no
  // VERMELHO em vez do âmbar — a regra é "vermelho ACIMA de 15". Preço tem 4
  // casas, então centavo tem 2: *10000 e /100.
  const centavos = (a, b) => Math.round((a - b) * 10000) / 100;
  function hojeISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }
  function brData(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || '');
  }
  // ── Nome de distribuidora ────────────────────────────────────────
  // ESPELHO de chaveDistr()/DISTR_SUFIXO_IGNORADO do server.js. Duplicado de
  // propósito: o aviso "já existe RODOIL" tem que aparecer na hora em que a
  // célula perde o foco, sem ida ao servidor. O backend continua sendo a
  // autoridade — ele revalida e devolve 409 se isto aqui divergir. Mexeu num,
  // mexe no outro.
  const DISTR_SUFIXO_IGNORADO = ['LTDA', 'SA', 'ME', 'MEI', 'EIRELI', 'EPP', 'EI', 'CIA',
    'DISTRIBUIDORA', 'DISTRIBUIDORAS', 'DISTRIB', 'DIST',
    'COMBUSTIVEIS', 'COMBUSTIVEL', 'DERIVADOS', 'PETROLEO', 'COMERCIO'];
  const DISTR_LIGACAO_FINAL = ['DE', 'DO', 'DA', 'DOS', 'DAS', 'E'];

  // Grafia que vai pro banco: UPPER, espaço colapsado, ACENTO PRESERVADO
  // (TORRÃO segue TORRÃO). Espelha normDistribuidora() do server.js — sem a
  // tabela de apelidos, que é decisão do backend.
  function nomeDistr(v) {
    return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
  }
  // Chave só de COMPARAÇÃO — nunca gravada.
  function chaveDistr(v) {
    let toks = String(v == null ? '' : v)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[.\/\-]/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').filter(Boolean);
    let mexeu = true;
    while (mexeu && toks.length > 1) {
      mexeu = false;
      if (toks.length > 2 && toks[toks.length - 2] === 'S' && toks[toks.length - 1] === 'A') {
        toks.pop(); toks.pop(); mexeu = true; continue;
      }
      if (DISTR_SUFIXO_IGNORADO.indexOf(toks[toks.length - 1]) >= 0) { toks.pop(); mexeu = true; continue; }
      if (DISTR_LIGACAO_FINAL.indexOf(toks[toks.length - 1]) >= 0) { toks.pop(); mexeu = true; }
    }
    return toks.join(' ');
  }
  function distEdicao(a, b, teto) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > teto) return teto + 1;
    let ant = new Array(lb + 1), atu = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) ant[j] = j;
    for (let i = 1; i <= la; i++) {
      atu[0] = i;
      let melhor = atu[0];
      for (let j = 1; j <= lb; j++) {
        const custo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        atu[j] = Math.min(ant[j] + 1, atu[j - 1] + 1, ant[j - 1] + custo);
        if (atu[j] < melhor) melhor = atu[j];
      }
      if (melhor > teto) return teto + 1;
      const t = ant; ant = atu; atu = t;
    }
    return ant[lb];
  }
  // Nome já cadastrado que se pareça com `chave`, ou null. Prefixo (mínimo 4,
  // pra 'RDP' não casar com tudo) + distância curta.
  function distrParecida(chave) {
    if (!chave) return null;
    for (let n = 0; n < _distrs.length; n++) {
      const k = chaveDistr(_distrs[n]);
      if (k === chave) continue;
      const menor = Math.min(k.length, chave.length);
      if (menor >= 4 && (k.indexOf(chave) === 0 || chave.indexOf(k) === 0)) return _distrs[n];
      const teto = menor <= 6 ? 1 : 2;
      if (distEdicao(k, chave, teto) <= teto) return _distrs[n];
    }
    return null;
  }
  // Nome canônico já na lista para essa chave, ou null.
  function distrConhecida(chave) {
    for (let n = 0; n < _distrs.length; n++) {
      if (chaveDistr(_distrs[n]) === chave) return _distrs[n];
    }
    return null;
  }

  function podeEditar() {
    const u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    return !!(u && PERFIS_EDITAM.indexOf(u.perfil) >= 0);
  }

  // ── CSS (escopo .mrc-*, tokens curtos) ───────────────────────────
  function injetarEstilo() {
    if (document.getElementById('mercado-style')) return;
    // No admin mobile o .scr já tem padding próprio (.7rem); somado ao do wrap
    // sobrariam ~320px dos 380. Detecta o host pela AUSÊNCIA do token LONGO: o
    // admin.css não declara --surface global (só escopado em #s-medicao/#s-kpi),
    // o painel-adm.css declara via alias. Mesmo truque do fornecedores.js.
    // NÃO declaramos alias nenhum aqui: este módulo usa só tokens CURTOS
    // (--sf/--bd/--ac/--tx…), que o admin.css já tem no :root — nada a vazar.
    const emAdmin = getComputedStyle(document.documentElement)
      .getPropertyValue('--surface').trim() === '';
    const st = document.createElement('style');
    st.id = 'mercado-style';
    st.textContent =
      '#s-mercado{height:auto;min-height:100%}' +
      '#s-mercado.active{display:block}' +
      (emAdmin ? '.scr .mrc-wrap{padding:.2rem 0}' : '') +
      '.mrc-wrap{flex:1;min-height:0;padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:1rem}' +
      '.mrc-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}' +
      '.mrc-title{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--tx)}' +
      '.mrc-acoes{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}' +
      '.mrc-btn{background:var(--acd);border:1px solid var(--ac);color:var(--ac);font-family:var(--mono);font-size:.72rem;font-weight:700;padding:.5rem .9rem;border-radius:8px;cursor:pointer}' +
      '.mrc-btn:hover:not(:disabled){filter:brightness(1.15)}' +
      '.mrc-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.mrc-btn.ghost{background:var(--sf2);border-color:var(--bd);color:var(--tx2)}' +
      '.mrc-btn.ghost:hover{border-color:var(--ac);color:var(--ac)}' +
      '.mrc-data{display:flex;align-items:center;gap:.4rem;font-family:var(--mono);font-size:.68rem;color:var(--tx3)}' +
      '.mrc-data input{font-family:var(--mono);font-size:.78rem;color:var(--tx);background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:.35rem .5rem;outline:none}' +
      '.mrc-data input:focus{border-color:var(--ac)}' +
      '.mrc-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:1rem 1.1rem}' +
      '.mrc-card-title{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--ac);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.9rem}' +
      // Grade de lançamento: rótulo do combustível + área de slots. A área é um
      // grid auto-fit, então os slots QUEBRAM em vez de comprimir — é o que faz
      // os 4 caberem em 800px (antes eram 4 colunas fixas, que esmagavam o select).
      '.mrc-linha{display:grid;grid-template-columns:122px 1fr;gap:.5rem;align-items:center;padding:.5rem 0;border-top:1px solid var(--bd)}' +
      '.mrc-linha:first-of-type{border-top:none}' +
      '.mrc-slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(146px,1fr));gap:.4rem}' +
      '.mrc-pend{color:var(--tx3);font-style:italic}' +
      '.mrc-comb{display:flex;flex-direction:column;gap:1px;min-width:0}' +
      '.mrc-comb-cod{font-family:var(--mono);font-size:.78rem;font-weight:700;color:var(--tx)}' +
      '.mrc-comb-nome{font-size:.6rem;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mrc-slot{display:flex;gap:.3rem;min-width:0}' +
      '.mrc-sel{flex:1;min-width:0;font-family:var(--sans);font-size:.72rem;color:var(--tx);background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:.3rem .25rem;outline:none}' +
      '.mrc-sel:focus{border-color:var(--ac)}' +
      '.mrc-inp{width:62px;flex:none;background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:.3rem .35rem;color:var(--tx);font-family:var(--mono);font-size:.76rem;text-align:right;outline:none}' +
      '.mrc-inp:focus{border-color:var(--ac)}' +
      '.mrc-inp.sujo{border-color:var(--wn)}' +
      '.mrc-inp.erro,.mrc-sel.erro{border-color:var(--dg)}' +
      '.mrc-hint{font-size:.66rem;color:var(--tx3);margin-top:.8rem;border-top:1px solid var(--bd);padding-top:.7rem;line-height:1.5}' +
      '.mrc-msg{font-size:.74rem;font-family:var(--mono);padding:.5rem 0}' +
      '.mrc-msg.erro{color:var(--dg)}' +
      '.mrc-msg.ok{color:var(--ok)}' +
      // Barra de confirmacao de nome novo. Fica no fluxo (nao e modal) pra nao
      // tampar a grade: quem confirma quer ver em que celula esta mexendo.
      '.mrc-conf{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;font-size:.74rem;font-family:var(--mono);color:var(--tx);background:var(--sf2);border:1px solid var(--wn);border-radius:8px;padding:.6rem .7rem;margin:.5rem 0;line-height:1.5}' +
      '.mrc-conf b{color:var(--ac)}' +
      '.mrc-conf .mrc-btn{padding:.3rem .6rem;font-size:.68rem}' +
      '.mrc-resumo{font-size:.72rem;font-family:var(--mono);color:var(--tx2)}' +
      '.mrc-resumo .menor{color:var(--ok);font-weight:700}' +
      '.mrc-vazio{text-align:center;color:var(--tx3);padding:2rem;font-size:.82rem;line-height:1.6}' +
      '.mrc-placeholder{text-align:center;color:var(--tx3);padding:2.4rem 1rem;font-size:.8rem;border:1px dashed var(--bd);border-radius:var(--rl)}' +

      // ── Painel: seletores de comparação ──────────────────────────
      '.mrc-cmp{display:flex;align-items:flex-end;gap:.7rem;flex-wrap:wrap}' +
      '.mrc-cmp-box{display:flex;flex-direction:column;gap:.25rem;min-width:190px;flex:1}' +
      '.mrc-cmp-lbl{font-family:var(--mono);font-size:.58rem;color:var(--tx3);letter-spacing:.06em;text-transform:uppercase}' +
      '.mrc-cmp-box select{font-family:var(--sans);font-size:.8rem;color:var(--tx);background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:.4rem .5rem;outline:none}' +
      '.mrc-cmp-box select:focus{border-color:var(--ac)}' +
      '.mrc-cmp-x{font-family:var(--mono);font-size:1rem;color:var(--tx3);padding-bottom:.45rem}' +
      // Nota sob os seletores: a dupla vale pros 5 velocímetros + legenda das faixas.
      '.mrc-cmp-nota{font-size:.66rem;color:var(--tx3);margin-top:.7rem}' +
      // Chips de combustível — controlam SÓ o ranking. Vivem no cabeçalho do
      // card de ranking, não no topo (ver comentário no renderPainel).
      '.mrc-fuels{display:flex;gap:6px;flex-wrap:wrap}' +
      '.mrc-chip{background:var(--sf2);border:1px solid var(--bd);border-radius:20px;padding:5px 14px;font-size:.7rem;font-family:var(--mono);font-weight:700;color:var(--tx3);cursor:pointer;transition:all .15s}' +
      '.mrc-chip:hover{border-color:var(--bd2);color:var(--tx2)}' +
      '.mrc-chip.on{background:var(--acd);border-color:var(--ac);color:var(--ac)}' +
      '.mrc-rank-hdr{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.9rem}' +
      // ── Velocímetros: um por combustível, todos na mesma tela ────
      // auto-fit: todos em linha no desktop largo, quebra sozinho em telas
      // menores sem esmagar o SVG. Não depende da quantidade — a lista vem do
      // backend (hoje 4: GC, ET, S10, S500).
      '.mrc-gauges{display:grid;grid-template-columns:repeat(auto-fit,minmax(206px,1fr));gap:.9rem}' +
      '.mrc-gcard{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:.8rem .7rem 1rem;display:flex;flex-direction:column}' +
      '.mrc-gcard-hdr{display:flex;flex-direction:column;gap:1px;margin-bottom:.3rem;text-align:center}' +
      '.mrc-gcard-cod{font-family:var(--mono);font-size:.82rem;font-weight:700;color:var(--tx)}' +
      '.mrc-gcard-nome{font-size:.58rem;color:var(--tx3)}' +
      // Estado vazio DENTRO do card: o combustível não some da tela.
      '.mrc-gvazio{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;font-family:var(--mono);font-size:.66rem;color:var(--tx3);padding:1.8rem .4rem;line-height:1.5}' +
      '.mrc-gauge-wrap{display:flex;flex-direction:column;align-items:center;gap:.2rem}' +
      '.mrc-gauge svg{display:block;width:100%;height:auto;max-width:230px}' +
      '.mrc-g-val{font-family:var(--mono);font-size:1.5rem;font-weight:700;line-height:1.1}' +
      '.mrc-g-precos{display:flex;gap:.5rem;width:100%;margin-top:.6rem;border-top:1px solid var(--bd);padding-top:.6rem}' +
      '.mrc-g-p{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}' +
      '.mrc-g-p-nome{font-size:.6rem;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mrc-g-p-val{font-family:var(--mono);font-size:.95rem;font-weight:700;color:var(--tx)}' +
      // ── Ranking ──────────────────────────────────────────────────
      '.mrc-rank{display:flex;flex-direction:column}' +
      '.mrc-rank-l{display:grid;grid-template-columns:26px 1fr auto 74px;gap:.6rem;align-items:center;padding:.4rem .5rem;border-radius:6px;font-size:.78rem}' +
      '.mrc-rank-l.band{background:var(--sf2);border:1px solid var(--ac)}' +
      '.mrc-rank-pos{font-family:var(--mono);font-size:.68rem;color:var(--tx3);text-align:right}' +
      // Origem do custo da bandeira: 'ref: LOURA EMPREENDIMENTOS' quando veio
      // do posto de referencia, ou o aviso de fallback. Discreta de proposito:
      // e contexto do numero, nao o numero. Fica em .mrc-rank-nome (que
      // empilha) e sob o valor do velocimetro.
      '.mrc-cob{font-family:var(--mono);font-size:.6rem;color:var(--tx3);white-space:nowrap}' +
      '.mrc-cob.alerta{color:var(--wn);font-weight:700}' +
      // Empilha nome + cobertura; o ellipsis segue valendo para o nome longo.
      '.mrc-rank-nome{display:flex;flex-direction:column;gap:0;overflow:hidden;color:var(--tx2)}' +
      '.mrc-rank-nome>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mrc-rank-l.band .mrc-rank-nome{color:var(--ac);font-weight:700}' +
      '.mrc-rank-preco{font-family:var(--mono);font-weight:700;color:var(--tx)}' +
      '.mrc-rank-d{font-family:var(--mono);font-size:.68rem;text-align:right;color:var(--tx3)}' +

      // ── Estreito (admin mobile, ~380px) ──────────────────────────
      // Único bloco específico de mobile. Nada de JS: o shell só-painel é o
      // mesmo componente, só mais apertado.
      '@media(max-width:520px){' +
        // Velocímetros 2×2 (GC ET / S10 S500, na ordem do backend). O auto-fit
        // com minmax(206px) daria 1 coluna em 380px e empilharia os 4.
        '.mrc-gauges{grid-template-columns:1fr 1fr;gap:.5rem}' +
        '.mrc-gcard{padding:.6rem .4rem .7rem}' +
        '.mrc-gauge svg{max-width:150px}' +
        '.mrc-g-val{font-size:1.15rem}' +
        '.mrc-g-precos{gap:.3rem;margin-top:.45rem;padding-top:.45rem}' +
        '.mrc-g-p-nome{font-size:.52rem}' +
        '.mrc-g-p-val{font-size:.8rem}' +
        '.mrc-gvazio{padding:1.1rem .3rem;font-size:.6rem}' +
        // Os dois seletores lado a lado com o × entre eles: o min-width de 190px
        // somava 380+ e os jogava em linhas separadas.
        '.mrc-cmp{gap:.4rem;flex-wrap:nowrap}' +
        '.mrc-cmp-box{min-width:0}' +
        '.mrc-cmp-box select{font-size:.72rem;padding:.35rem .3rem}' +
        '.mrc-cmp-x{padding-bottom:.4rem;font-size:.8rem}' +
        // Ranking: aperta colunas e gap em vez de esconder o Δ — o delta em ¢ é
        // metade da informação da linha. O nome corta com ellipsis (já tem).
        '.mrc-rank-l{grid-template-columns:20px 1fr auto 52px;gap:.35rem;padding:.35rem .3rem;font-size:.72rem}' +
        '.mrc-rank-hdr{gap:.5rem}' +
        '.mrc-chip{padding:4px 10px;font-size:.64rem}' +
      '}';
    document.head.appendChild(st);
  }

  // ── Shells ───────────────────────────────────────────────────────
  // DOIS shells, UM núcleo. Tudo abaixo dos shells (carregarPainel, opcoesHtml,
  // entidadesGlobais, gaugeCard, gaugeHtml, rankHtml, corFaixa, centavos, os
  // handlers e o estado) é compartilhado sem uma linha duplicada — o que muda é
  // só QUAIS blocos entram no DOM.

  // COMPLETO (painel-adm em tela larga): lançamento + painel.
  function montarShellCompleto(sec) {
    sec.innerHTML =
      '<div class="mrc-wrap">' +
        '<div class="mrc-head">' +
          '<div class="mrc-title">Mercado — custo de compra</div>' +
        '</div>' +
        (window.navCustoHTML ? window.navCustoHTML('mercado') : '') +
        '<div class="mrc-head">' +
          '<div class="mrc-data">DIA ' +
            '<input type="date" id="mrc-data" onchange="__mrcData(this.value)">' +
          '</div>' +
          '<div class="mrc-acoes" id="mrc-acoes"></div>' +
        '</div>' +
        '<div id="mrc-msg"></div>' +
        '<div id="mrc-lanc"></div>' +
        '<div id="mrc-painel"></div>' +
      '</div>';
  }

  // SÓ-PAINEL (tela estreita — admin mobile): leitura.
  // SEM seletor de data: é tela de bater o olho de manhã, e o painel já mostra o
  // último dia COM dado de cada combustível. Outro dia se vê no desktop.
  // SEM botão de lançar e SEM grade: o lançamento segue exclusivo do painel-adm
  // em tela larga (são 16 preços — não se digita isso no celular).
  function montarShellPainel(sec) {
    sec.innerHTML =
      '<div class="mrc-wrap">' +
        '<div class="mrc-head"><div class="mrc-title">Mercado</div></div>' +
        (window.navCustoHTML ? window.navCustoHTML('mercado') : '') +
        '<div id="mrc-painel"></div>' +
      '</div>';
  }

  function msg(texto, classe) {
    const el = document.getElementById('mrc-msg');
    if (!el) return;
    el.innerHTML = texto
      ? '<div class="mrc-msg ' + (classe || '') + '">' + esc(texto) + '</div>'
      : '';
  }

  // ── Carga do dia ─────────────────────────────────────────────────
  async function carregar() {
    const inp = document.getElementById('mrc-data');
    if (inp) inp.value = _dataISO;
    msg('Carregando…');
    try {
      const r = await apiFetch('/custos-mercado?data=' + encodeURIComponent(_dataISO));
      _combs  = r.combustiveis || [];
      _distrs = r.distribuidoras || [];
      montarGrade(r.itens || []);
      msg('');
    } catch (err) {
      msg('Erro ao carregar: ' + (err.message || err), 'erro');
    }
    renderAcoes();
    renderLancamento();
    // Painel depois do lançamento: lançar um preço muda o gráfico e o ranking,
    // então salvar → carregar() → o painel reflete na hora.
    await carregarPainel();
  }

  // Monta _grade a partir das linhas do dia: um slot por linha existente +
  // slots vazios até SLOTS_MIN. Se um combustível tiver MAIS linhas que
  // SLOTS_MIN, a linha CRESCE — nunca esconde lançamento que já existe.
  function montarGrade(itens) {
    const porComb = {};
    itens.forEach(i => {
      const cb = String(i.combustivel || '').toUpperCase();
      if (!porComb[cb]) porComb[cb] = [];
      porComb[cb].push(i);
    });
    _grade = {};
    _originais = new Set();
    _combs.forEach(cb => {
      const existentes = (porComb[cb] || []).slice()
        .sort((a, b) => String(a.distribuidora).localeCompare(String(b.distribuidora)));
      const slots = existentes.map(i => {
        _originais.add(cb + '|' + i.distribuidora);
        const prefill = fmtTela(i.preco);
        return { distr: i.distribuidora, preco: prefill, prefill: prefill, cheio: i.preco };
      });
      while (slots.length < SLOTS_MIN) slots.push({ distr: '', preco: '', prefill: '', cheio: null });
      _grade[cb] = slots;
    });
  }

  // Nº de colunas da grade = o maior nº de slots entre os combustíveis.
  function nSlots() {
    let n = SLOTS_MIN;
    _combs.forEach(cb => { const q = (_grade[cb] || []).length; if (q > n) n = q; });
    return n;
  }

  // ── Ações do header ──────────────────────────────────────────────
  function renderAcoes() {
    const el = document.getElementById('mrc-acoes');
    if (!el) return;
    if (!podeEditar()) {
      el.innerHTML = '<span class="mrc-msg">Somente leitura para este perfil.</span>';
      return;
    }
    el.innerHTML = _lancando
      ? '<button class="mrc-btn" onclick="__mrcSalvar()"' + (_salvando ? ' disabled' : '') + '>' +
          (_salvando ? 'Salvando…' : 'Salvar') + '</button>' +
        '<button class="mrc-btn ghost" onclick="__mrcCancelar()"' + (_salvando ? ' disabled' : '') + '>Cancelar</button>'
      : '<button class="mrc-btn" onclick="__mrcLancar()">+ Lançar preços do dia</button>';
  }

  // ── Grade de lançamento ──────────────────────────────────────────
  function renderLancamento() {
    const box = document.getElementById('mrc-lanc');
    if (!box) return;
    if (!_lancando) { box.innerHTML = resumoDoDia(); return; }

    const total = nSlots();
    const linhas = _combs.map(cb => {
      const slots = _grade[cb] || [];
      const cels = [];
      for (let i = 0; i < total; i++) {
        const s = slots[i] || { distr: '', preco: '', prefill: '', cheio: null };
        // title com as 4 casas: a tela mostra 2 (pedido do negócio), mas o valor
        // cheio fica conferível sem abrir o banco.
        const title = (s.cheio != null) ? ' title="Gravado: ' + esc(fmtCheio(s.cheio)) + '"' : '';
        // <input list> em vez de <select>: aceita nome que ainda não existe (o
        // mercado muda), e o autocomplete nativo do datalist é o que evita a maior
        // parte do erro de digitação. O `oninput` só espelha o estado (sem
        // re-render, pra não perder o cursor); a validação de nome novo é no
        // `onchange`, que dispara ao sair da célula ou escolher da lista.
        cels.push(
          '<div class="mrc-slot">' +
            '<input class="mrc-sel" list="mrc-dl" data-k="d" autocomplete="off" ' +
              'data-cb="' + esc(cb) + '" data-i="' + i + '" placeholder="Distribuidora" ' +
              // data-ant = último nome ACEITO nesta célula, pro Cancelar restaurar.
              // Não serve olhar _grade: o oninput já sobrescreveu s.distr com o
              // texto cru a cada tecla, antes do onchange validar.
              'data-ant="' + esc(s.distr) + '" ' +
              'value="' + esc(s.distr) + '" oninput="__mrcSlot(this)" onchange="__mrcDistr(this)">' +
            '<input class="mrc-inp" data-k="p" data-cb="' + esc(cb) + '" data-i="' + i + '" inputmode="decimal" ' +
              'placeholder="0,00" value="' + esc(s.preco) + '"' + title + ' oninput="__mrcSlot(this)">' +
          '</div>'
        );
      }
      return '<div class="mrc-linha">' +
        '<div class="mrc-comb">' +
          '<div class="mrc-comb-cod">' + esc(cb) + '</div>' +
          '<div class="mrc-comb-nome">' + esc(NOME_COMB[cb] || '') + '</div>' +
        '</div>' +
        '<div class="mrc-slots">' + cels.join('') + '</div>' +
      '</div>';
    }).join('');

    // UM datalist para a grade toda (os ~20 inputs apontam pro mesmo id).
    const datalist = '<datalist id="mrc-dl">' +
      _distrs.map(d => '<option value="' + esc(d) + '"></option>').join('') +
      '</datalist>';

    box.innerHTML =
      '<div class="mrc-card">' +
        datalist +
        '<div class="mrc-card-title">Lançar preços — ' + esc(brData(_dataISO)) + '</div>' +
        linhas +
        '<div class="mrc-hint">' +
          'Preço em R$/L, 2 casas na tela (o banco guarda 4). Passe o mouse num preço já gravado para ver o valor cheio.<br>' +
          'Campo <b>não alterado</b> não é reenviado — o valor de 4 casas fica intacto. ' +
          'Apagar o preço de uma linha já lançada <b>remove</b> aquela distribuidora do dia.' +
        '</div>' +
      '</div>';
  }

  // Resumo do que está lançado (fora do modo de edição). Menor em verde —
  // mesma convenção visual do card de Fornecedores.
  function resumoDoDia() {
    if (!_originais.size) {
      return '<div class="mrc-vazio">Nenhum preço de mercado lançado em ' + esc(brData(_dataISO)) + '.</div>';
    }
    const linhas = _combs.map(cb => {
      const slots = (_grade[cb] || []).filter(s => s.distr && _originais.has(cb + '|' + s.distr));
      // Combustível SEM lançamento aparece como "não lançado" em vez de sumir da
      // lista. Sumir dá a impressão de bug e, pior, esconde o esquecimento — que
      // é exatamente o que uma tela de lançamento diário tem que deixar visível.
      const txt = slots.length
        ? slots.slice()
            .sort((a, b) => (Number(a.cheio) || 0) - (Number(b.cheio) || 0))
            .map((s, i) => '<span class="' + (i === 0 ? 'menor' : '') + '">' +
              esc(s.distr) + ' ' + esc(fmtTela(s.cheio)) + '</span>')
            .join(' · ')
        : '<span class="mrc-pend">não lançado</span>';
      return '<div class="mrc-linha">' +
        '<div class="mrc-comb"><div class="mrc-comb-cod">' + esc(cb) + '</div></div>' +
        '<div class="mrc-resumo">' + txt + '</div>' +
      '</div>';
    }).join('');
    return '<div class="mrc-card">' +
      '<div class="mrc-card-title">Lançado em ' + esc(brData(_dataISO)) + ' — menor em verde</div>' +
      linhas +
    '</div>';
  }

  // ══════════════════════════════════════════════════════════════════
  // PAINEL DE MERCADO (parte b) — gráfico · termômetro · ranking.
  // O COMBUSTÍVEL ATIVO (_pComb) controla os três, e reordena os dois
  // seletores pelo preço daquele combustível no último dia com dado.
  // ══════════════════════════════════════════════════════════════════
  async function carregarPainel() {
    const el = document.getElementById('mrc-painel');
    if (el) el.innerHTML = '<div class="mrc-placeholder">Carregando painel…</div>';
    try {
      _pData = await apiFetch('/mercado-dashboard');
    } catch (err) {
      _pData = null;
      if (el) {
        el.innerHTML = '<div class="mrc-placeholder" style="color:var(--dg)">Erro ao carregar o painel: ' +
          esc(err.message || err) + '</div>';
      }
      return;
    }
    const combs = Object.keys(_pData.combustiveis || {});
    if (!_pComb || combs.indexOf(_pComb) < 0) {
      // Abre no primeiro combustível QUE TEM dado; se nenhum tiver, no primeiro.
      _pComb = null;
      for (const c of combs) {
        if ((_pData.combustiveis[c].ranking || []).length) { _pComb = c; break; }
      }
      if (!_pComb) _pComb = combs[0] || null;
    }
    renderPainel();
  }

  function combAtual() {
    return (_pData && _pComb && _pData.combustiveis) ? _pData.combustiveis[_pComb] : null;
  }
  // Bandeira própria se reconhece pelo PREFIXO do id — não depende de _pData
  // já ter carregado nem de varrer a lista.
  const ehBandeira = (id) => String(id || '').indexOf(MRC_PFX_BAND) === 0;
  // Id RESERVADO do protocolo (__ALGO__): as referências derivadas. Nunca vai
  // pra tela como texto. Se a API passar a mandar uma referência que ESTE front
  // não conhece, ela é ignorada na lista em vez de virar rótulo cru — foi
  // exatamente esse vazamento (__MEDIATODAS__ aparecendo escrito) que surgiu
  // quando o JS servido estava mais antigo que a API.
  const ehIdReservado = (id) => /^__.+__$/.test(String(id || ''));

  // Rótulo de exibição de uma entidade. Derivada e bandeira têm id != nome (a
  // bandeira vem prefixada); distribuidora de mercado usa o próprio nome como id.
  // O fallback do prefixo é a rede de segurança: se _pData.bandeiras não trouxer
  // o id (payload de uma versão diferente da API), ainda mostra 'IPIRANGA' e não
  // '__B__IPIRANGA'.
  function nomeEnt(id) {
    for (const d of ((_pData && _pData.derivadas) || [])) if (d.id === id) return d.nome;
    for (const b of ((_pData && _pData.bandeiras) || [])) if (b.id === id) return b.nome;
    if (ehBandeira(id)) return String(id).slice(MRC_PFX_BAND.length);
    return id;
  }
  const ehDerivada = (id) =>
    ((_pData && _pData.derivadas) || []).some(d => d.id === id);
  // Rótulo COM a marca de bandeira própria. Necessário porque 'RIO BRANCO'
  // existe nos dois lados (mercado e bandeira nossa): sem a marca, o ranking
  // mostraria duas linhas "RIO BRANCO" idênticas e o seletor duas opções de
  // mesmo nome. SÓ texto — não muda ordenação, valor nem id.
  const rotuloEnt = (id) => nomeEnt(id) + (ehBandeira(id) ? ' ·minha·' : '');
  // Valor de uma entidade no último dia COM dado de UM combustível. Recebe o
  // combustível por parâmetro (não usa _pComb): os 5 velocímetros da tela leem
  // combustíveis diferentes com a MESMA dupla selecionada.
  function valorEm(comb, id) {
    const c = (_pData && _pData.combustiveis) ? _pData.combustiveis[comb] : null;
    if (!c || c.ultimo_idx == null || c.ultimo_idx < 0) return null;
    const s = c.series[id];
    return s ? s[c.ultimo_idx] : null;
  }
  // Entidades de TODOS os combustíveis (união). A dupla dos seletores vale para
  // os 5 velocímetros, então precisa ser escolhível mesmo que só exista em
  // alguns — onde não existir, aquele velocímetro mostra estado vazio.
  function entidadesGlobais() {
    const vistos = new Set();
    Object.keys((_pData && _pData.combustiveis) || {}).forEach(cb => {
      const c = _pData.combustiveis[cb];
      Object.keys((c && c.series) || {}).forEach(id => {
        if (!ehDerivada(id) && !ehIdReservado(id)) vistos.add(id);
      });
    });
    return vistos;
  }

  // Opções dos seletores: derivadas num optgroup (são referência, não empresa) e
  // as demais ORDENADAS DO MENOR PARA O MAIOR preço do combustível EM FOCO
  // (_pComb, o do ranking). SÓ O NOME no rótulo — sem preço: os preços estão no
  // ranking abaixo e nos velocímetros.
  // A lista sai da UNIÃO de todos os combustíveis, não só do que está em foco:
  // a dupla vale para os 5 velocímetros, então uma distribuidora que só tem
  // preço no ET precisa ser escolhível com o GC em foco. Quem não aparece no
  // ranking do foco entra no fim, em ordem alfabética.
  function opcoesHtml(selecionado) {
    if (!_pData) return '';
    const c = combAtual();
    const ranking = (c && c.ranking) || [];
    // filter(r.id): linha de ranking sem id (payload de outra versão da API) não
    // vira <option value="undefined">.
    const ranked = ranking.filter(r => r && r.id).map(r => r.id);
    const todas = entidadesGlobais();
    const resto = [...todas]
      .filter(id => ranked.indexOf(id) < 0)
      .sort((a, b) => nomeEnt(a).localeCompare(nomeEnt(b)));
    const opt = (id, rotulo) => '<option value="' + esc(id) + '"' +
      (id === selecionado ? ' selected' : '') + '>' + esc(rotulo) + '</option>';
    return '<optgroup label="Referências">' +
        ((_pData.derivadas || []).map(d => opt(d.id, d.nome)).join('')) +
      '</optgroup>' +
      '<optgroup label="Distribuidoras e bandeiras">' +
        ranked.concat(resto).map(id => opt(id, rotuloEnt(id))).join('') +
      '</optgroup>';
  }

  // ── Termômetro (SVG puro, sem lib) ───────────────────────────────
  function corFaixa(cent) {
    const a = Math.abs(cent);
    if (a <= FAIXA_OK)  return 'var(--ok)';
    if (a <= FAIXA_ATN) return 'var(--wn)';
    return 'var(--dg)';
  }
  function ptArco(cx, cy, r, ang) {
    const rad = ang * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  }
  function arco(cx, cy, r, a1, a2) {
    const p1 = ptArco(cx, cy, r, a1), p2 = ptArco(cx, cy, r, a2);
    return 'M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) +
      ' A' + r + ' ' + r + ' 0 0 1 ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
  }
  // 0¢ = 180° (esquerda) … GAUGE_MAX¢ = 0° (direita).
  const angDe = (cent) => 180 - (Math.min(GAUGE_MAX, Math.max(0, cent)) / GAUGE_MAX) * 180;

  // UM velocímetro para UM combustível, com a dupla global (_pA × _pB). Card
  // sempre renderiza: combustível sem preço dos dois lados mostra estado vazio
  // em vez de sumir — a ausência é informação (não lancei ainda).
  function gaugeCard(comb) {
    const cab = '<div class="mrc-gcard-hdr">' +
        '<span class="mrc-gcard-cod">' + esc(comb) + '</span>' +
        '<span class="mrc-gcard-nome">' + esc(NOME_COMB[comb] || '') + '</span>' +
      '</div>';
    return '<div class="mrc-gcard">' + cab + gaugeHtml(comb) + '</div>';
  }

  function gaugeHtml(comb) {
    const vA = valorEm(comb, _pA), vB = valorEm(comb, _pB);
    if (vA == null || vB == null) {
      const qual = (vA == null && vB == null) ? 'nenhum dos dois lados'
                 : (vA == null ? rotuloEnt(_pA) : rotuloEnt(_pB));
      return '<div class="mrc-gvazio">sem preço de ' + esc(qual) + '</div>';
    }
    // diff = quanto o lado DIREITO está acima do ESQUERDO. A ordem dos exemplos
    // do negócio é "branca × minha bandeira", então positivo = minha bandeira
    // mais cara, que é a leitura que interessa.
    const cent = centavos(vB, vA);
    const cx = 135, cy = 130, R = 96, W = 17;
    const ponta = ptArco(cx, cy, R - W - 8, angDe(Math.abs(cent)));
    const cor = corFaixa(cent);
    const tick = (v, txt) => {
      const p = ptArco(cx, cy, R + 13, angDe(v));
      return '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 3).toFixed(1) + '" fill="var(--tx3)" ' +
        'font-size="9" text-anchor="middle" font-family="monospace">' + txt + '</text>';
    };
    const svg =
      '<svg viewBox="0 0 270 150" role="img" aria-label="diferença de ' + esc(fmtCent(cent)) + ' centavos">' +
        '<path d="' + arco(cx, cy, R, 180, angDe(FAIXA_OK)) + '" fill="none" stroke="var(--ok)" stroke-width="' + W + '"/>' +
        '<path d="' + arco(cx, cy, R, angDe(FAIXA_OK), angDe(FAIXA_ATN)) + '" fill="none" stroke="var(--wn)" stroke-width="' + W + '"/>' +
        '<path d="' + arco(cx, cy, R, angDe(FAIXA_ATN), 0) + '" fill="none" stroke="var(--dg)" stroke-width="' + W + '"/>' +
        tick(0, '0') + tick(FAIXA_OK, String(FAIXA_OK)) + tick(FAIXA_ATN, String(FAIXA_ATN)) + tick(GAUGE_MAX, GAUGE_MAX + '+') +
        '<line x1="' + cx + '" y1="' + cy + '" x2="' + ponta[0].toFixed(1) + '" y2="' + ponta[1].toFixed(1) +
          '" stroke="' + cor + '" stroke-width="4" stroke-linecap="round"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + cor + '"/>' +
      '</svg>';
    // Sinal no valor: '+' quando o lado DIREITO está mais caro, '−' quando mais
    // barato. Com 5 velocímetros na tela a legenda longa ("X está Y acima de Z")
    // repetiria 5 vezes a mesma frase — quem compara com quem já está nos dois
    // seletores do topo. rotuloEnt (não nomeEnt) nos nomes dos preços: sem a
    // marca ·minha·, mercado e bandeira RIO BRANCO ficariam idênticos.
    const sinal = (cent > 0 ? '+' : (cent < 0 ? '−' : ''));
    return '<div class="mrc-gauge-wrap">' +
      '<div class="mrc-gauge">' + svg + '</div>' +
      '<div class="mrc-g-val" style="color:' + cor + '">' +
        sinal + esc(fmtCent(Math.abs(cent))) + '¢</div>' +
      '<div class="mrc-g-precos">' +
        '<div class="mrc-g-p"><div class="mrc-g-p-nome">' + esc(rotuloEnt(_pA)) + '</div>' +
          '<div class="mrc-g-p-val">' + esc(fmtTela(vA)) + '</div>' + cobHtml(_pA) + '</div>' +
        '<div class="mrc-g-p"><div class="mrc-g-p-nome">' + esc(rotuloEnt(_pB)) + '</div>' +
          '<div class="mrc-g-p-val">' + esc(fmtTela(vB)) + '</div>' + cobHtml(_pB) + '</div>' +
      '</div>' +
    '</div>';
  }

  // ── Ranking (Ipiranga/Vibra destacadas) ──────────────────────────
  function rankHtml() {
    const c = combAtual();
    const lista = (c && c.ranking) || [];
    if (!lista.length) {
      return '<div class="mrc-vazio">Sem preço para ' + esc(_pComb || '') + ' no período.</div>';
    }
    const menor = lista[0].preco;
    return '<div class="mrc-rank">' + lista.map((r, i) => {
      const d = centavos(r.preco, menor);
      return '<div class="mrc-rank-l' + (r.tipo === 'bandeira' ? ' band' : '') + '">' +
        '<div class="mrc-rank-pos">' + (i + 1) + '</div>' +
        '<div class="mrc-rank-nome"><span>' + esc(rotuloEnt(r.id)) + '</span>' + cobHtml(r.id) + '</div>' +
        '<div class="mrc-rank-preco">' + esc(fmtTela(r.preco)) + '</div>' +
        '<div class="mrc-rank-d">' + (d < 0.05 ? 'menor' : '+' + esc(fmtCent(d)) + '¢') + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  // Renderiza a origem do custo ao lado do preco, ou '' quando nao se aplica.
  function cobHtml(id) {
    const c = cobDe(id);
    if (!c) return '';
    return '<span class="mrc-cob' + (c.alerta ? ' alerta' : '') + '" title="' + esc(c.title) + '">' +
      esc(c.texto) + '</span>';
  }

  // Origem do custo de uma bandeira propria. SO bandeira tem: o custo dela vem
  // de custos_precos, que e POR POSTO, e o backend escolhe UM valor. Distribuidora
  // de mercado nao tem — custos_mercado ja e um preco por distribuidora.
  //
  // Dois casos, e o alerta e SO no segundo:
  //  · origem='referencia' — veio do posto fixo da bandeira. Mostra o NOME dele.
  //    A contagem de quantos postos pagam o mesmo vai no title, NAO como alerta:
  //    a VIBRA da '1 de 14' porque o P. SANTA INES - JOAQUIM e o unico naquele
  //    valor, e isso e o comportamento pretendido, nao problema.
  //  · origem='moda' — a referencia nao tinha custo no dia (ou nao esta
  //    configurada). AI e alerta: o numero nao e o de referencia.
  // Devolve { texto, alerta, title } ou null.
  function cobDe(id) {
    const c = combAtual();
    const r = ((c && c.ranking) || []).find(x => x.id === id);
    if (!r || !r.origem) return null;
    const cobertura = (r.postos_no_valor != null && r.postos_com_custo != null)
      ? r.postos_no_valor + ' de ' + r.postos_com_custo + ' postos pagam este valor'
      : null;
    const naBand = r.postos_na_bandeira ? '; a bandeira tem ' + r.postos_na_bandeira + ' postos ativos' : '';
    const distintos = r.valores_distintos ? '; ' + r.valores_distintos + ' valores distintos no dia' : '';
    if (r.origem === 'referencia') {
      // Nome curto: 'P. LOURA EMPREENDIMENTOS' -> 'LOURA EMPREENDIMENTOS'.
      const curto = String(r.posto_referencia || '').replace(/^P\.\s*/i, '');
      return {
        texto: curto ? 'ref: ' + curto : 'referencia',
        alerta: false,
        title: 'Custo do posto de referencia da bandeira' +
          (r.posto_referencia ? ' (' + r.posto_referencia + ')' : '') + '. ' +
          (cobertura ? cobertura + naBand + distintos : ''),
      };
    }
    // fallback
    return {
      texto: '⚠ sem referencia' + (cobertura ? ' · ' + r.postos_no_valor + ' de ' + r.postos_com_custo : ''),
      alerta: true,
      title: 'FALLBACK: o posto de referencia da bandeira nao tem custo lancado neste dia' +
        (r.posto_referencia ? ' (' + r.posto_referencia + ')' : ' (referencia nao configurada)') +
        '. Exibindo o valor mais frequente da bandeira. ' +
        (cobertura ? cobertura + naBand + distintos : ''),
    };
  }

  function renderPainel() {
    const el = document.getElementById('mrc-painel');
    if (!el) return;
    if (!_pData) { el.innerHTML = '<div class="mrc-placeholder">Painel indisponível.</div>'; return; }
    const c = combAtual();
    if (!c) { el.innerHTML = '<div class="mrc-vazio">Sem dados de mercado no período.</div>'; return; }

    // A dupla vale para os 5 velocímetros, então a validade é GLOBAL (união de
    // todos os combustíveis), não por combustível: uma distribuidora que só tem
    // preço no ET continua escolhível com o GC em foco — o velocímetro do GC
    // mostra estado vazio, que é informação, não erro.
    const validos = entidadesGlobais();
    const derivOk = (id) => ehDerivada(id);
    if (!validos.has(_pA) && !derivOk(_pA)) _pA = MRC_MENOR;
    if (!validos.has(_pB) && !derivOk(_pB)) {
      _pB = null;
      for (const b of (_pData.bandeiras || [])) if (validos.has(b.id)) { _pB = b.id; break; }
      if (!_pB) _pB = MRC_MEDIA3;
    }

    // Chips no CABEÇALHO DO RANKING, não no topo: eles controlam SÓ o ranking
    // agora que os 5 velocímetros aparecem juntos. No topo, ao lado dos
    // seletores, iam ser lidos como "filtra os velocímetros" e o clique pareceria
    // não fazer nada.
    const combs = Object.keys(_pData.combustiveis || {});
    const nComb = combs.length;
    const chips = combs.map(k =>
      '<button class="mrc-chip' + (k === _pComb ? ' on' : '') + '" onclick="__mrcComb(\'' + esc(k) + '\')">' +
      esc(k) + '</button>'
    ).join('');
    const ultima = c.ultima_data ? ' — ' + brData(c.ultima_data) : '';

    el.innerHTML =
      '<div class="mrc-card">' +
        '<div class="mrc-cmp">' +
          '<div class="mrc-cmp-box">' +
            '<div class="mrc-cmp-lbl">Comparar</div>' +
            '<select onchange="__mrcCmp(\'a\', this.value)">' + opcoesHtml(_pA) + '</select>' +
          '</div>' +
          '<div class="mrc-cmp-x">×</div>' +
          '<div class="mrc-cmp-box">' +
            '<div class="mrc-cmp-lbl">Com</div>' +
            '<select onchange="__mrcCmp(\'b\', this.value)">' + opcoesHtml(_pB) + '</select>' +
          '</div>' +
        '</div>' +
        // Contagem dinâmica: a lista de combustíveis vem do backend, então o
        // texto não pode dizer "cinco" fixo (o GA saiu em 26/08).
        '<div class="mrc-cmp-nota">Vale para os ' + nComb + ' combustíveis abaixo. ' +
          'Verde até ' + FAIXA_OK + '¢ · âmbar ' + FAIXA_OK + '–' + FAIXA_ATN + '¢ · vermelho acima de ' + FAIXA_ATN + '¢.</div>' +
      '</div>' +
      // Um velocímetro por combustível, na ordem do backend (GC ET S10 S500).
      '<div class="mrc-gauges">' +
        combs.map(gaugeCard).join('') +
      '</div>' +
      '<div class="mrc-card">' +
        '<div class="mrc-rank-hdr">' +
          '<div class="mrc-card-title" style="margin:0">Ranking ' + esc(_pComb) + esc(ultima) + '</div>' +
          '<div class="mrc-fuels">' + chips + '</div>' +
        '</div>' +
        rankHtml() +
      '</div>';
  }

  // ── Coleta do payload ────────────────────────────────────────────
  // Regras:
  //  • slot inalterado (preco === prefill)  → NÃO entra (preserva as 4 casas)
  //  • slot com valor novo/alterado         → upsert
  //  • slot esvaziado que existia           → preco null = remover
  //  • par que existia e saiu de todo slot  → preco null = remover
  function coletarItens() {
    const itens = [];
    const atuais = new Set();
    for (let ci = 0; ci < _combs.length; ci++) {
      const cb = _combs[ci];
      const vistos = new Set();
      const slots = _grade[cb] || [];
      for (let si = 0; si < slots.length; si++) {
        const s = slots[si];
        if (!s.distr) continue;
        // Compara pela CHAVE: com campo de texto livre, 'RODOIL' e 'RODOIL LTDA'
        // são a mesma distribuidora e tinham que colidir aqui — comparar o texto
        // cru deixaria as duas passarem e o upsert estouraria no ON CONFLICT.
        const kdup = chaveDistr(s.distr);
        if (vistos.has(kdup)) {
          return { erro: s.distr + ' aparece duas vezes em ' + cb + '. Cada distribuidora entra uma vez por combustível.' };
        }
        vistos.add(kdup);
        const chave = cb + '|' + s.distr;
        atuais.add(chave);
        const existia = _originais.has(chave);
        const inalterado = String(s.preco).trim() === String(s.prefill).trim();
        if (existia && inalterado) continue;              // nada a escrever
        const v = parseCustoBR(s.preco);
        if (v === null) {
          if (existia) itens.push({ combustivel: cb, distribuidora: s.distr, preco: null });
          continue;                                        // slot vazio novo: ignora
        }
        if (v < 0.5 || v > 20) {
          return { erro: 'Preço fora da faixa (0,50–20,00): ' + s.distr + ' em ' + cb + '.' };
        }
        // permitir_nova só no item cujo nome o usuário confirmou. O backend recusa
        // nome desconhecido sem a flag, então um nome novo que escapou da
        // confirmação volta como erro em vez de virar série nova em silêncio.
        const item = { combustivel: cb, distribuidora: s.distr, preco: s.preco };
        if (_novasOk.has(chaveDistr(s.distr))) item.permitir_nova = true;
        itens.push(item);
      }
    }
    // Par que existia e não está mais em nenhum slot (distribuidora trocada).
    _originais.forEach(chave => {
      if (atuais.has(chave)) return;
      const corte = chave.indexOf('|');
      itens.push({
        combustivel:   chave.slice(0, corte),
        distribuidora: chave.slice(corte + 1),
        preco:         null,
      });
    });
    return { itens: itens };
  }

  // Remonta a grade a partir do que veio do servidor (guardado em `cheio`) —
  // usado pelo Cancelar, pra descartar edições sem refazer o fetch.
  function remontarDoServidor() {
    const itens = [];
    _combs.forEach(cb => (_grade[cb] || []).forEach(s => {
      if (s.distr && _originais.has(cb + '|' + s.distr) && s.cheio != null) {
        itens.push({ combustivel: cb, distribuidora: s.distr, preco: s.cheio });
      }
    }));
    montarGrade(itens);
  }

  // ── Ações públicas ───────────────────────────────────────────────
  window.__mrcData = function (valor) {
    const iso = String(valor || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    _dataISO = iso;
    _lancando = false;
    fecharConf(); _novasOk = new Set();
    carregar();
  };
  // Abrir o lançamento zera as confirmações de nome novo: a pergunta vale por
  // sessão de lançamento, senão um nome errado confirmado às 9h continuaria
  // valendo à tarde sem ninguém revisar.
  window.__mrcLancar = function () {
    if (!podeEditar()) return;
    fecharConf(); _novasOk = new Set();
    _lancando = true; msg(''); renderAcoes(); renderLancamento();
  };
  window.__mrcCancelar = function () {
    _lancando = false; msg('');
    fecharConf(); _novasOk = new Set();
    remontarDoServidor();
    renderAcoes(); renderLancamento();
  };
  // Espelha input/select no estado SEM re-render — re-renderizar aqui perderia
  // o foco e a posição do cursor a cada tecla.
  window.__mrcSlot = function (el) {
    const cb = el.dataset.cb;
    const i  = Number(el.dataset.i);
    if (!_grade[cb]) return;
    while (_grade[cb].length <= i) _grade[cb].push({ distr: '', preco: '', prefill: '', cheio: null });
    const s = _grade[cb][i];
    // Agora os DOIS campos são <input> (o de nome virou datalist), então a
    // distinção é por data-k e não mais por tagName.
    if (el.dataset.k === 'd') {
      s.distr = el.value;
    } else {
      s.preco = el.value;
      el.classList.toggle('sujo', String(s.preco).trim() !== String(s.prefill).trim());
    }
    el.classList.remove('erro');
  };
  // Sai da célula de nome (ou escolheu do datalist): canoniza e decide se precisa
  // de confirmação. É o guard de duplicata — 'RODOIL LTDA' digitado de cabeça não
  // pode virar uma segunda série ao lado de 'RODOIL'.
  window.__mrcDistr = function (el) {
    const cb = el.dataset.cb;
    const i  = Number(el.dataset.i);
    const s  = (_grade[cb] || [])[i];
    if (!s) return;
    fecharConf();
    // Aceitar um nome atualiza o data-ant: é ele que o Cancelar restaura.
    const aceitar = (valor) => { s.distr = valor; el.value = valor; el.dataset.ant = valor; };
    const nome = nomeDistr(el.value);
    if (!nome) { aceitar(''); return; }
    const k = chaveDistr(nome);
    // Já cadastrada: adota a grafia CANÔNICA. É o que faz 'rodoil' e
    // 'RODOIL LTDA' caírem os dois em 'RODOIL' sem perguntar nada.
    const conhecida = distrConhecida(k);
    if (conhecida) { aceitar(conhecida); return; }
    // Nome novo já confirmado antes nesta sessão: não pergunta de novo.
    if (_novasOk.has(k)) { aceitar(nome); return; }
    // Pendente: mostra o digitado na célula, mas SEM mexer no data-ant — se
    // cancelar, é pro nome anterior voltar.
    s.distr = nome; el.value = nome;
    _pendNova = { cb: cb, i: i, nome: nome, similar: distrParecida(k), anterior: el.dataset.ant || '' };
    renderConf();
  };

  function fecharConf() {
    if (!_pendNova) return;
    _pendNova = null;
    const el = document.getElementById('mrc-conf');
    if (el) el.remove();
  }
  // Barra inline no topo da área de lançamento. Dois formatos: com parecido
  // (3 saídas) e sem parecido (criar/cancelar).
  function renderConf() {
    const box = document.getElementById('mrc-lanc');
    if (!box || !_pendNova) return;
    const p = _pendNova;
    const antigo = document.getElementById('mrc-conf');
    if (antigo) antigo.remove();
    const div = document.createElement('div');
    div.id = 'mrc-conf';
    div.className = 'mrc-conf';
    div.innerHTML = p.similar
      ? '<span>Já existe <b>' + esc(p.similar) + '</b> — quis dizer essa? ' +
          'Se <b>' + esc(p.nome) + '</b> for outra distribuidora mesmo, crie.</span>' +
        '<button class="mrc-btn" onclick="__mrcNovaUsar()">Usar ' + esc(p.similar) + '</button>' +
        '<button class="mrc-btn ghost" onclick="__mrcNovaCriar()">Criar ' + esc(p.nome) + '</button>' +
        '<button class="mrc-btn ghost" onclick="__mrcNovaCancelar()">Cancelar</button>'
      : '<span>Criar nova distribuidora <b>' + esc(p.nome) + '</b>?</span>' +
        '<button class="mrc-btn" onclick="__mrcNovaCriar()">Criar</button>' +
        '<button class="mrc-btn ghost" onclick="__mrcNovaCancelar()">Cancelar</button>';
    box.insertBefore(div, box.firstChild);
  }
  // Aponta a célula pendente de volta pro input, pra escrever nela sem re-render
  // (re-render da grade perderia o que já foi digitado nas outras células).
  function celulaPend() {
    if (!_pendNova) return null;
    return document.querySelector('.mrc-sel[data-k="d"][data-cb="' + _pendNova.cb +
      '"][data-i="' + _pendNova.i + '"]');
  }
  window.__mrcNovaUsar = function () {
    if (!_pendNova || !_pendNova.similar) return;
    const p = _pendNova, s = (_grade[p.cb] || [])[p.i];
    if (s) s.distr = p.similar;
    const el = celulaPend();
    if (el) { el.value = p.similar; el.dataset.ant = p.similar; }
    fecharConf();
  };
  window.__mrcNovaCriar = function () {
    if (!_pendNova) return;
    // Confirmado: entra em _novasOk e o POST vai com permitir_nova nesse item.
    _novasOk.add(chaveDistr(_pendNova.nome));
    const el = celulaPend();
    if (el) el.dataset.ant = _pendNova.nome;
    fecharConf();
  };
  window.__mrcNovaCancelar = function () {
    if (!_pendNova) return;
    const p = _pendNova, s = (_grade[p.cb] || [])[p.i];
    if (s) s.distr = p.anterior;
    const el = celulaPend();
    if (el) { el.value = p.anterior; el.dataset.ant = p.anterior; el.focus(); }
    fecharConf();
  };

  window.__mrcSalvar = async function () {
    if (!podeEditar() || _salvando) return;
    // Confirmação aberta = o usuário ainda não decidiu o nome. Salvar agora
    // gravaria a grafia pendente (ou tomaria 409 do backend).
    if (_pendNova) {
      msg('Resolva a distribuidora ' + _pendNova.nome + ' antes de salvar.', 'erro');
      return;
    }
    const r = coletarItens();
    if (r.erro) { msg(r.erro, 'erro'); return; }
    if (!r.itens.length) {
      _lancando = false; msg('Nada mudou.', 'ok');
      renderAcoes(); renderLancamento();
      return;
    }
    _salvando = true; renderAcoes(); msg('Salvando…');
    try {
      const resp = await apiFetch('/custos-mercado', {
        method: 'POST',
        body: JSON.stringify({ data: _dataISO, itens: r.itens }),
      });
      _salvando = false; _lancando = false;
      await carregar();
      const partes = [];
      if (resp.salvos)    partes.push(resp.salvos + ' preço(s) gravado(s)');
      if (resp.removidos) partes.push(resp.removidos + ' removido(s)');
      msg(partes.join(' · ') || 'Nada mudou.', 'ok');
    } catch (err) {
      _salvando = false;
      renderAcoes();
      msg('Erro ao salvar: ' + (err.message || err), 'erro');
    }
  };

  // Chips de combustível: controlam gráfico, termômetro E ranking de uma vez.
  window.__mrcComb = function (k) {
    if (!_pData || !_pData.combustiveis || !_pData.combustiveis[k]) return;
    _pComb = k;
    renderPainel();
  };
  window.__mrcCmp = function (lado, valor) {
    if (lado === 'a') _pA = valor; else _pB = valor;
    renderPainel();
  };

  // ── Entrada pública ──────────────────────────────────────────────
  // Entrada única dos DOIS hosts (painel-adm desktop e admin mobile). O modo sai
  // da LARGURA, não do host: o lançamento precisa de tela larga, o painel não.
  // Em tela estreita entra o shell só-leitura — antes era uma tela de bloqueio,
  // que virava beco sem saída no celular.
  window.renderMercado = function (sec) {
    if (!sec) return;
    injetarEstilo();
    const modo = (window.innerWidth >= MIN_LARGURA) ? 'completo' : 'painel';
    // Remonta quando o MODO muda (girar o aparelho, redimensionar a janela): os
    // dois shells têm DOM diferente, então reaproveitar o anterior deixaria
    // #mrc-lanc órfão num sentido e ausente no outro.
    if (!_shellPronto || _modo !== modo || !sec.querySelector('.mrc-wrap')) {
      (modo === 'completo' ? montarShellCompleto : montarShellPainel)(sec);
      _modo = modo;
      _shellPronto = true;
    }
    if (modo === 'completo') {
      if (!_dataISO) _dataISO = hojeISO();
      carregar();          // dia (lançamento) + painel
    } else {
      carregarPainel();    // só o painel
    }
  };
})();
