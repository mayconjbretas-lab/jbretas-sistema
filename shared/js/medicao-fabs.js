// JBRETAS SISTEMA — shared/js/medicao-fabs.js
// Dois botões flutuantes da aba de Medição da Logística (desktop e mobile, sem
// fork): 🧮 Calculadora e 📋 Pedido final. Fixos no canto inferior direito.
// Montado por window.medicaoFabs.montar({ getPosto }) — getPosto() devolve o
// posto selecionado no filtro da Logística ('' = Todos os postos).
//
// - Toggle: clicar abre; clicar de novo fecha; clicar fora fecha; abrir um
//   fecha o outro; botão ativo destacado.
// - Calculadora: painel arrastável (mouse + toque) preso à viewport; parser
//   próprio (SEM eval/Function); posição persistida em localStorage (mesma
//   convenção jb_ do módulo).
// - Pedido final: GET /medicao/:posto (rota que já devolve pedido+carga/mês);
//   cores pela TOLERANCIA_CARGA reaproveitada de window.matrizMedicao.
(function () {
  'use strict';

  const POS_KEY = 'jb_logi_calc_pos';           // {x,y} da calculadora (última posição)
  const TOL = (window.matrizMedicao && window.matrizMedicao.TOLERANCIA_CARGA != null)
    ? window.matrizMedicao.TOLERANCIA_CARGA : 500;   // reuso; fallback só por segurança

  let _getPosto = () => '';
  let _root = null;        // container fixo dos FABs + painéis
  let _aberto = null;      // 'calc' | 'pedido' | null

  // ── Parser de expressão SEM eval/Function ──────────────────────────────
  // Aceita só dígitos, ponto, parênteses e + − × ÷ (× e ÷ e − unicode também).
  // Tokeniza → shunting-yard → avalia RPN. Divisão por zero / entrada inválida
  // → null (a UI mostra travessão, não quebra).
  function avaliar(expr) {
    const s = String(expr == null ? '' : expr)
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').trim();
    if (!s) return null;
    if (!/^[0-9.+\-*/()\s]+$/.test(s)) return null;   // só o vocabulário permitido

    // Tokenizar
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (c >= '0' && c <= '9' || c === '.') {
        let num = '';
        while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || s[i] === '.')) { num += s[i]; i++; }
        if ((num.match(/\./g) || []).length > 1) return null;   // "1.2.3"
        tokens.push({ t: 'num', v: parseFloat(num) });
        continue;
      }
      if ('+-*/'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
      if (c === '(' || c === ')') { tokens.push({ t: c }); i++; continue; }
      return null;
    }
    if (!tokens.length) return null;

    // Menos/mais unário → 0 x  (quando '-'/'+' abre expressão ou vem após '(' ou operador)
    const norm = [];
    for (let k = 0; k < tokens.length; k++) {
      const tk = tokens[k];
      const ant = norm[norm.length - 1];
      const unario = tk.t === 'op' && (tk.v === '-' || tk.v === '+') &&
        (!ant || ant.t === 'op' || ant.t === '(');
      if (unario) norm.push({ t: 'num', v: 0 });
      norm.push(tk);
    }

    // Shunting-yard → RPN
    const prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
    const out = [], ops = [];
    for (const tk of norm) {
      if (tk.t === 'num') {
        if (!isFinite(tk.v)) return null;
        out.push(tk);
      } else if (tk.t === 'op') {
        while (ops.length && ops[ops.length - 1].t === 'op' &&
               prec[ops[ops.length - 1].v] >= prec[tk.v]) out.push(ops.pop());
        ops.push(tk);
      } else if (tk.t === '(') {
        ops.push(tk);
      } else if (tk.t === ')') {
        while (ops.length && ops[ops.length - 1].t !== '(') out.push(ops.pop());
        if (!ops.length) return null;   // parênteses desbalanceados
        ops.pop();
      }
    }
    while (ops.length) { const o = ops.pop(); if (o.t === '(') return null; out.push(o); }

    // Avaliar RPN
    const st = [];
    for (const tk of out) {
      if (tk.t === 'num') { st.push(tk.v); continue; }
      const b = st.pop(), a = st.pop();
      if (a === undefined || b === undefined) return null;
      let r;
      if (tk.v === '+') r = a + b;
      else if (tk.v === '-') r = a - b;
      else if (tk.v === '*') r = a * b;
      else { if (b === 0) return null; r = a / b; }   // ÷0 → travessão
      st.push(r);
    }
    if (st.length !== 1 || !isFinite(st[0])) return null;
    return st[0];
  }

  function fmtNum(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n.toFixed(6)).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
  }
  function fmtL(v) {
    if (v === null || v === undefined || v === '') return '—';
    return Math.round(Number(v)).toLocaleString('pt-BR');
  }
  function temValor(v) { return v !== null && v !== undefined && v !== ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ── Persistência da posição da calculadora (localStorage, convenção jb_) ──
  function lerPos() {
    try { const o = JSON.parse(localStorage.getItem(POS_KEY)); return (o && isFinite(o.x) && isFinite(o.y)) ? o : null; }
    catch (e) { return null; }
  }
  function salvarPos(x, y) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (e) {}
  }

  // ── Montagem ────────────────────────────────────────────────────────────
  function montar(opcoes) {
    opcoes = opcoes || {};
    if (typeof opcoes.getPosto === 'function') _getPosto = opcoes.getPosto;
    if (_root) return;   // idempotente

    _root = document.createElement('div');
    _root.className = 'mfab-root';
    _root.innerHTML =
      '<div class="mfab-btns">' +
        '<button type="button" class="mfab-btn" id="mfab-b-calc"   title="Calculadora"  aria-label="Calculadora">🧮</button>' +
        '<button type="button" class="mfab-btn" id="mfab-b-pedido" title="Pedido final" aria-label="Pedido final">📋</button>' +
      '</div>' +
      montarPainelCalc() +
      montarPainelPedido();
    document.body.appendChild(_root);

    _root.querySelector('#mfab-b-calc').addEventListener('click', e => { e.stopPropagation(); alternar('calc'); });
    _root.querySelector('#mfab-b-pedido').addEventListener('click', e => { e.stopPropagation(); alternar('pedido'); });

    // Clicar fora fecha. Cliques dentro de um painel não fecham (stopPropagation nos painéis).
    document.addEventListener('click', () => { if (_aberto) fechar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && _aberto) fechar(); });

    ligarCalculadora();
  }

  function montarPainelCalc() {
    return '<div class="mfab-panel mfab-calc" id="mfab-p-calc">' +
      '<div class="mfab-handle" id="mfab-calc-handle"><span class="mfab-grip"></span>🧮 Calculadora</div>' +
      '<input type="text" class="mfab-calc-expr" id="mfab-calc-expr" inputmode="text" autocomplete="off" placeholder="0">' +
      '<div class="mfab-calc-res" id="mfab-calc-res">0</div>' +
      '<div class="mfab-calc-keys">' +
        keyBtn('7') + keyBtn('8') + keyBtn('9') + keyBtn('÷', 'op') +
        keyBtn('4') + keyBtn('5') + keyBtn('6') + keyBtn('×', 'op') +
        keyBtn('1') + keyBtn('2') + keyBtn('3') + keyBtn('−', 'op') +
        keyBtn('0') + keyBtn('.') + keyBtn('C', 'clr') + keyBtn('+', 'op') +
      '</div>' +
    '</div>';
  }
  function keyBtn(txt, extra) {
    return '<button type="button" class="mfab-key' + (extra ? ' mfab-key-' + extra : '') +
      '" data-k="' + esc(txt) + '">' + esc(txt) + '</button>';
  }

  function montarPainelPedido() {
    return '<div class="mfab-panel mfab-pedido" id="mfab-p-pedido">' +
      '<div class="mfab-phead">📋 Pedido final <span class="mfab-pmes" id="mfab-ped-mes"></span></div>' +
      '<div class="mfab-ptot" id="mfab-ped-tot"></div>' +
      '<div class="mfab-pbody" id="mfab-ped-body"></div>' +
    '</div>';
  }

  // ── Abrir/fechar ──────────────────────────────────────────────────────────
  function alternar(qual) {
    if (_aberto === qual) { fechar(); return; }
    _aberto = qual;
    render();
    if (qual === 'pedido') carregarPedido();
    if (qual === 'calc') setTimeout(() => { const el = document.getElementById('mfab-calc-expr'); if (el) el.focus(); }, 0);
  }
  function fechar() { _aberto = null; render(); }
  function render() {
    _root.querySelector('#mfab-b-calc').classList.toggle('on', _aberto === 'calc');
    _root.querySelector('#mfab-b-pedido').classList.toggle('on', _aberto === 'pedido');
    _root.querySelector('#mfab-p-calc').classList.toggle('aberto', _aberto === 'calc');
    _root.querySelector('#mfab-p-pedido').classList.toggle('aberto', _aberto === 'pedido');
    if (_aberto === 'calc') posicionarCalc();
  }

  // ── Calculadora: teclado, digitação, arrasto ──────────────────────────────
  function ligarCalculadora() {
    const painel = _root.querySelector('#mfab-p-calc');
    const expr = _root.querySelector('#mfab-calc-expr');
    const res  = _root.querySelector('#mfab-calc-res');
    painel.addEventListener('click', e => e.stopPropagation());   // não fecha ao clicar dentro

    function recalc() {
      const v = avaliar(expr.value);
      res.textContent = (expr.value.trim() === '') ? '0' : fmtNum(v);
      res.classList.toggle('mfab-res-erro', expr.value.trim() !== '' && v === null);
    }
    expr.addEventListener('input', recalc);
    expr.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = avaliar(expr.value); if (v !== null) { expr.value = String(v); recalc(); } } });

    _root.querySelectorAll('#mfab-p-calc .mfab-key').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-k');
        if (k === 'C') { expr.value = ''; }
        else { expr.value += k; }
        recalc();
        expr.focus();
      });
    });

    ligarArrasto(painel, _root.querySelector('#mfab-calc-handle'));
  }

  // Arrasto por mouse E toque; clamp na viewport (não escapa da tela).
  function ligarArrasto(painel, handle) {
    let arrastando = false, offX = 0, offY = 0;
    function ponto(e) { const t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY }; }
    function clamp(x, y) {
      const w = painel.offsetWidth, h = painel.offsetHeight;
      const maxX = Math.max(0, window.innerWidth - w);
      const maxY = Math.max(0, window.innerHeight - h);
      return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
    }
    // Liga/desliga os listeners de MOVIMENTO no document. Registrados SÓ durante o
    // arrasto (em inicio) e removidos ao soltar (em fim/touchcancel). Com a
    // calculadora parada NÃO sobra nenhum listener — em especial nenhum touchmove
    // não-passivo no document, que degradava o momentum do scroll da matriz.
    // Mouse e toque seguem o MESMO esquema (uniforme; e evita mousemove global
    // disparando à toa fora do arrasto).
    function escutar() {
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', fim);
      document.addEventListener('touchmove', mover, { passive: false });   // preventDefault no arrasto
      document.addEventListener('touchend', fim);
      document.addEventListener('touchcancel', fim);   // dedo saiu/cancelou → solta tudo
    }
    function pararEscuta() {
      document.removeEventListener('mousemove', mover);
      document.removeEventListener('mouseup', fim);
      document.removeEventListener('touchmove', mover);
      document.removeEventListener('touchend', fim);
      document.removeEventListener('touchcancel', fim);
    }
    function inicio(e) {
      if (arrastando) return;
      arrastando = true;
      const p = ponto(e);
      const r = painel.getBoundingClientRect();
      offX = p.x - r.left; offY = p.y - r.top;
      painel.classList.add('mfab-arrastando');
      escutar();
      if (e.cancelable) e.preventDefault();
    }
    function mover(e) {
      if (!arrastando) return;
      const p = ponto(e);
      const c = clamp(p.x - offX, p.y - offY);
      painel.style.left = c.x + 'px';
      painel.style.top  = c.y + 'px';
      painel.style.right = 'auto'; painel.style.bottom = 'auto';
      if (e.cancelable) e.preventDefault();
    }
    function fim() {
      if (!arrastando) return;
      arrastando = false;
      painel.classList.remove('mfab-arrastando');
      pararEscuta();
      const r = painel.getBoundingClientRect();
      salvarPos(r.left, r.top);
    }
    // Só o START fica permanente — e no HANDLE (barrinha da calculadora), fora do
    // caminho da matriz. touchstart passivo:false p/ o inicio poder preventDefault.
    handle.addEventListener('mousedown', inicio);
    handle.addEventListener('touchstart', inicio, { passive: false });
  }

  // Aplica a última posição salva (com clamp p/ mudança de tamanho de tela).
  function posicionarCalc() {
    const painel = _root.querySelector('#mfab-p-calc');
    const pos = lerPos();
    if (!pos) { painel.style.left = ''; painel.style.top = ''; painel.style.right = ''; painel.style.bottom = ''; return; }
    const w = painel.offsetWidth || 260, h = painel.offsetHeight || 320;
    const x = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - w));
    const y = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - h));
    painel.style.left = x + 'px'; painel.style.top = y + 'px';
    painel.style.right = 'auto'; painel.style.bottom = 'auto';
  }

  // ── Pedido final: GET /medicao/:posto ─────────────────────────────────────
  async function carregarPedido() {
    const body = _root.querySelector('#mfab-ped-body');
    const tot  = _root.querySelector('#mfab-ped-tot');
    const mesEl = _root.querySelector('#mfab-ped-mes');
    _root.querySelector('#mfab-p-pedido').addEventListener('click', e => e.stopPropagation(), { once: true });
    mesEl.textContent = ''; tot.innerHTML = '';

    const posto = _getPosto();
    if (!posto) {
      body.innerHTML = '<div class="mfab-ped-vazio">Selecione um posto no filtro para ver os pedidos.</div>';
      return;
    }
    body.innerHTML = '<div class="mfab-ped-vazio">Carregando…</div>';
    try {
      const dados = await apiFetch('/medicao/' + encodeURIComponent(posto));
      mesEl.textContent = (dados.mes || '') + (dados.ano ? '/' + dados.ano : '');
      const grupos = dados.grupos || [];
      const linhas = [];
      let totPed = 0, totCarga = 0;
      // Mais RECENTE primeiro: dias vêm do /medicao em ordem crescente; percorre
      // ao contrário (dia mais novo → mais antigo). Sem auto-scroll/timing.
      const dias = (dados.dias || []).slice().reverse();
      dias.forEach(d => {
        grupos.forEach((g, i) => {
          const pedido = d.pedido ? d.pedido[i] : null;
          const carga  = d.carga  ? d.carga[i]  : null;
          if (!temValor(pedido) && !temValor(carga)) return;   // só linhas com pedido ou carga
          if (temValor(pedido)) totPed += Number(pedido);
          if (temValor(carga))  totCarga += Number(carga);
          linhas.push({ dia: d.dia, comb: g.abv || g.comb, pedido, carga });
        });
      });

      tot.innerHTML =
        '<div class="mfab-ped-kpi"><span>Pedido</span><b>' + fmtL(totPed) + ' L</b></div>' +
        '<div class="mfab-ped-kpi"><span>Recebido</span><b>' + fmtL(totCarga) + ' L</b></div>';

      if (!linhas.length) { body.innerHTML = '<div class="mfab-ped-vazio">Sem pedidos neste mês.</div>'; return; }

      let html = '<table class="mfab-ped-tbl"><thead><tr>' +
        '<th>Data</th><th>Comb</th><th>Pedido</th><th>Carga</th><th>Dif</th></tr></thead><tbody>';
      linhas.forEach(l => {
        let cor = 'var(--text3)', dif = '—';
        if (temValor(l.pedido) && temValor(l.carga)) {
          const d = Number(l.carga) - Number(l.pedido);
          cor = d < -TOL ? 'var(--danger)' : (d > TOL ? 'var(--warning)' : 'var(--ok)');
          dif = (d > 0 ? '+' : '') + fmtL(d);
        }
        html += '<tr>' +
          '<td class="mfab-ped-num">' + esc(String(l.dia).padStart(2, '0')) + '</td>' +
          '<td>' + esc(l.comb) + '</td>' +
          '<td class="mfab-ped-num">' + fmtL(l.pedido) + '</td>' +
          '<td class="mfab-ped-num">' + fmtL(l.carga) + '</td>' +
          '<td class="mfab-ped-num" style="color:' + cor + '">' + dif + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = '<div class="mfab-ped-vazio mfab-ped-erro">⚠ ' + esc(err && err.message) + '</div>';
    }
  }

  // Mostra/esconde os FABs — os consumidores chamam conforme a aba ativa
  // (só aparecem na aba de Medição). Esconder também fecha o painel aberto.
  function setVisivel(v) {
    if (!_root) return;
    _root.classList.toggle('mfab-oculto', !v);
    if (!v && _aberto) fechar();
  }

  window.medicaoFabs = { montar: montar, setVisivel: setVisivel, _avaliar: avaliar };   // _avaliar exposto p/ teste
})();
