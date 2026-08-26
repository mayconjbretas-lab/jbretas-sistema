// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/mercado.js
// Mercado de custo de compra (bandeira branca). Tela PRÓPRIA do
// painel-adm, 5ª entrada do seletor nav-custo.js. Padrão do
// fornecedores.js: IIFE, CSS injetado escopado (.mrc-*) e tokens
// CURTOS (--sf/--bd/--ac/--tx/--dg/--wn/--ok/--rl), resolvidos pela
// camada de alias do painel-adm.css.
// Expõe window.renderMercado(sec).
//
// PARTE (a): só o LANÇAMENTO. O painel (gráfico + termômetro +
// ranking) entra na parte (b), no lugar marcado por #mrc-painel.
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
  const MIN_LARGURA = 900;
  const SLOTS_MIN = 4;          // 4 distribuidoras por combustível (3 a 4 no uso real)
  const PERFIS_EDITAM = ['ADM', 'LOGISTICA'];

  // Rótulo de exibição dos 5 códigos. A lista AUTORITATIVA de códigos e de
  // distribuidoras vem do GET /custos-mercado (fonte única, no backend) —
  // isto aqui é só o nome bonito.
  const NOME_COMB = {
    GC: 'Gasolina comum', GA: 'Gasolina aditivada', ET: 'Etanol',
    S10: 'Diesel S-10', S500: 'Diesel S-500',
  };

  let _shellPronto = false;
  let _dataISO     = null;
  let _combs       = [];        // códigos, do backend
  let _distrs      = [];        // distribuidoras canônicas, do backend
  let _grade       = {};        // { GC: [{distr, preco, prefill, cheio}], ... }
  let _originais   = new Set(); // "COMB|DISTR" que existiam no dia carregado
  let _lancando    = false;     // form de lançamento aberto?
  let _salvando    = false;

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
  const fmtTela  = (v) => fmtN(v, 2, 2);   // 2 casas NA TELA (pedido do negócio)
  const fmtCheio = (v) => fmtN(v, 2, 4);   // 4 casas — só no title, p/ conferência
  function hojeISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }
  function brData(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || '');
  }
  function podeEditar() {
    const u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    return !!(u && PERFIS_EDITAM.indexOf(u.perfil) >= 0);
  }

  // ── CSS (escopo .mrc-*, tokens curtos) ───────────────────────────
  function injetarEstilo() {
    if (document.getElementById('mercado-style')) return;
    const st = document.createElement('style');
    st.id = 'mercado-style';
    st.textContent =
      '#s-mercado{height:auto;min-height:100%}' +
      '#s-mercado.active{display:block}' +
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
      // Grade de lançamento: rótulo do combustível + N slots (--mrc-slots).
      '.mrc-linha{display:grid;grid-template-columns:150px repeat(var(--mrc-slots,4),1fr);gap:.5rem;align-items:center;padding:.45rem 0;border-top:1px solid var(--bd)}' +
      '.mrc-linha:first-of-type{border-top:none}' +
      '.mrc-comb{display:flex;flex-direction:column;gap:1px;min-width:0}' +
      '.mrc-comb-cod{font-family:var(--mono);font-size:.78rem;font-weight:700;color:var(--tx)}' +
      '.mrc-comb-nome{font-size:.6rem;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mrc-slot{display:flex;gap:.3rem;min-width:0}' +
      '.mrc-sel{flex:1;min-width:0;font-family:var(--sans);font-size:.72rem;color:var(--tx);background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:.3rem .25rem;outline:none}' +
      '.mrc-sel:focus{border-color:var(--ac)}' +
      '.mrc-inp{width:68px;flex:none;background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:.3rem .35rem;color:var(--tx);font-family:var(--mono);font-size:.76rem;text-align:right;outline:none}' +
      '.mrc-inp:focus{border-color:var(--ac)}' +
      '.mrc-inp.sujo{border-color:var(--wn)}' +
      '.mrc-inp.erro,.mrc-sel.erro{border-color:var(--dg)}' +
      '.mrc-hint{font-size:.66rem;color:var(--tx3);margin-top:.8rem;border-top:1px solid var(--bd);padding-top:.7rem;line-height:1.5}' +
      '.mrc-msg{font-size:.74rem;font-family:var(--mono);padding:.5rem 0}' +
      '.mrc-msg.erro{color:var(--dg)}' +
      '.mrc-msg.ok{color:var(--ok)}' +
      '.mrc-resumo{font-size:.72rem;font-family:var(--mono);color:var(--tx2)}' +
      '.mrc-resumo .menor{color:var(--ok);font-weight:700}' +
      '.mrc-vazio{text-align:center;color:var(--tx3);padding:2rem;font-size:.82rem;line-height:1.6}' +
      '.mrc-placeholder{text-align:center;color:var(--tx3);padding:2.4rem 1rem;font-size:.8rem;border:1px dashed var(--bd);border-radius:var(--rl)}';
    document.head.appendChild(st);
  }

  // ── Shell ────────────────────────────────────────────────────────
  function montarShell(sec) {
    injetarEstilo();
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
    _shellPronto = true;
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
    renderPainel();
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
        const opcoes = '<option value=""></option>' + _distrs.map(d =>
          '<option value="' + esc(d) + '"' + (d === s.distr ? ' selected' : '') + '>' + esc(d) + '</option>'
        ).join('');
        // title com as 4 casas: a tela mostra 2 (pedido do negócio), mas o valor
        // cheio fica conferível sem abrir o banco.
        const title = (s.cheio != null) ? ' title="Gravado: ' + esc(fmtCheio(s.cheio)) + '"' : '';
        cels.push(
          '<div class="mrc-slot">' +
            '<select class="mrc-sel" data-cb="' + esc(cb) + '" data-i="' + i + '" onchange="__mrcSlot(this)">' +
              opcoes +
            '</select>' +
            '<input class="mrc-inp" data-cb="' + esc(cb) + '" data-i="' + i + '" inputmode="decimal" ' +
              'placeholder="0,00" value="' + esc(s.preco) + '"' + title + ' oninput="__mrcSlot(this)">' +
          '</div>'
        );
      }
      return '<div class="mrc-linha">' +
        '<div class="mrc-comb">' +
          '<div class="mrc-comb-cod">' + esc(cb) + '</div>' +
          '<div class="mrc-comb-nome">' + esc(NOME_COMB[cb] || '') + '</div>' +
        '</div>' + cels.join('') +
      '</div>';
    }).join('');

    box.innerHTML =
      '<div class="mrc-card" style="--mrc-slots:' + total + '">' +
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
      if (!slots.length) return '';
      const ordenados = slots.slice().sort((a, b) => (Number(a.cheio) || 0) - (Number(b.cheio) || 0));
      const txt = ordenados.map((s, i) =>
        '<span class="' + (i === 0 ? 'menor' : '') + '">' + esc(s.distr) + ' ' + esc(fmtTela(s.cheio)) + '</span>'
      ).join(' · ');
      return '<div class="mrc-linha" style="--mrc-slots:1">' +
        '<div class="mrc-comb"><div class="mrc-comb-cod">' + esc(cb) + '</div></div>' +
        '<div class="mrc-resumo">' + txt + '</div>' +
      '</div>';
    }).join('');
    return '<div class="mrc-card">' +
      '<div class="mrc-card-title">Lançado em ' + esc(brData(_dataISO)) + ' — menor em verde</div>' +
      linhas +
    '</div>';
  }

  // Lugar do painel (parte b).
  function renderPainel() {
    const el = document.getElementById('mrc-painel');
    if (!el) return;
    el.innerHTML = '<div class="mrc-placeholder">Painel de mercado (gráfico · termômetro · ranking) — próxima etapa.</div>';
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
        if (vistos.has(s.distr)) {
          return { erro: s.distr + ' aparece duas vezes em ' + cb + '. Cada distribuidora entra uma vez por combustível.' };
        }
        vistos.add(s.distr);
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
        itens.push({ combustivel: cb, distribuidora: s.distr, preco: s.preco });
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
    carregar();
  };
  window.__mrcLancar = function () {
    if (!podeEditar()) return;
    _lancando = true; msg(''); renderAcoes(); renderLancamento();
  };
  window.__mrcCancelar = function () {
    _lancando = false; msg('');
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
    if (el.tagName === 'SELECT') {
      s.distr = el.value;
    } else {
      s.preco = el.value;
      el.classList.toggle('sujo', String(s.preco).trim() !== String(s.prefill).trim());
    }
    el.classList.remove('erro');
  };
  window.__mrcSalvar = async function () {
    if (!podeEditar() || _salvando) return;
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

  // ── Entrada pública ──────────────────────────────────────────────
  window.renderMercado = function (sec) {
    if (!sec) return;
    injetarEstilo();
    // Guard de largura: a grade de lançamento não cabe em tela estreita.
    if (window.innerWidth < MIN_LARGURA) {
      sec.innerHTML = '<div class="mrc-wrap">' +
        (window.navCustoHTML ? window.navCustoHTML('mercado') : '') +
        '<div class="mrc-vazio">O Mercado é só na versão desktop — são 20 preços por dia.<br>' +
        'Abra o painel num computador para lançar e ver o painel.</div>' +
      '</div>';
      _shellPronto = false;   // força remontar o shell ao voltar pro desktop
      return;
    }
    if (!_shellPronto || !sec.querySelector('.mrc-wrap')) montarShell(sec);
    if (!_dataISO) _dataISO = hojeISO();
    carregar();
  };
})();
