// ================================================================
// JBRETAS SISTEMA — shared/js/solicitacoes-logistica.js
// Ciclo de preço (lado LOGÍSTICA). Molde estrutural: solicitacoes-gerente.js.
// Só age se o perfil for LOGISTICA.
//
// Faz:
//  1) Polling a cada 20s de GET /solicitacoes-preco?status=aguardando_logistica
//     (a Logística é central: vê a REDE toda) → beep quando a contagem AUMENTA.
//  2) Faixa de aviso clicável no topo (inserida após a .topbar da Logística).
//  3) Bottom-sheet AGRUPADO POR POSTO: um card por posto, uma linha por
//     combustível, e um botão "APROVAR TODOS (n)" que chama, em sequência,
//     POST /solicitacoes-preco/:id/aprovar (SEM corpo, SEM foto).
//
// Diferente do gerente: aqui NÃO há foto/preview/compressão nem gate de foto —
// aprovar é a etapa que libera a troca na bomba e só então o gerente é avisado.
//
// Expõe window.solicitacoesLogistica = { refresh, abrir }.
// CSS injetado via <style> com os tokens LONGOS do base.css (dual-theme).
// ================================================================
(function () {
  const INTERVALO_MS = 20000;
  const FUEL_LABEL = {
    GC: 'Gasolina Comum', GA: 'Gasolina Aditivada', ET: 'Etanol',
    S10: 'Diesel S10', S500: 'Diesel S500',
  };
  const FUEL_ORDER = ['GC', 'GA', 'ET', 'S10', 'S500'];

  let _solicitacoes = [];     // último snapshot (rede toda), 1 item por solicitação
  let _ultimaContagem = null; // p/ detectar aumento (beep). null = 1º poll
  let _montado = false;
  let _timer = null;
  let _ctx = null;            // AudioContext único/persistente (lazy)
  let _somPendente = false;   // poll tocou com áudio travado → toca no 1º gesto

  function ehLogistica() {
    try { return (getUsuarioLogado() || {}).perfil === 'LOGISTICA'; }
    catch (e) { return false; }
  }

  // ── Formatação ──────────────────────────────────────────────────
  function fmtBRL(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtQuando(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Cria (lazy) o AudioContext único do módulo. Retorna null se indisponível.
  function garantirCtx() {
    if (!_ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) _ctx = new AC();
      } catch (e) { _ctx = null; }
    }
    return _ctx;
  }

  // Destrava o áudio (autoplay policy). Listener PERSISTENTE no init — guard de
  // custo zero quando já está tudo ok.
  function destravarAudio() {
    if (_ctx && _ctx.state === 'running' && !_somPendente) return;
    try {
      const ctx = garantirCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended' && ctx.resume) {
        ctx.resume().then(() => {
          if (_somPendente && ctx.state === 'running') { _somPendente = false; tocarNotificacao(); }
        }).catch(() => {});
      } else if (ctx.state === 'running' && _somPendente) {
        _somPendente = false;
        tocarNotificacao();
      }
    } catch (e) { /* silencioso */ }
  }

  // ── Notificação (WebAudio): tri-tone E5→A5→C#6 repetido 2× + vibração.
  //    (mesma máquina do lado gerente.) ──
  function tocarNotificacao() {
    const agendar = (ctx) => {
      const seq = [659.25, 880, 1108.73]; // E5, A5, C#6
      const passo = 0.18;
      const gapSeq = 0.35;
      const nota = (freq, t0, dur) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(ctx.destination);
        const o1 = ctx.createOscillator();
        o1.type = 'sine'; o1.frequency.value = freq; o1.connect(g);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t0);
        g2.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g2.connect(ctx.destination);
        const o2 = ctx.createOscillator();
        o2.type = 'triangle'; o2.frequency.value = freq * 2; o2.connect(g2);
        o1.start(t0); o1.stop(t0 + dur);
        o2.start(t0); o2.stop(t0 + dur);
      };
      const base = ctx.currentTime + 0.03;
      const durSeq = seq.length * passo;
      for (let rep = 0; rep < 2; rep++) {
        const ini = base + rep * (durSeq + gapSeq);
        seq.forEach((f, i) => nota(f, ini + i * passo, passo));
      }
    };
    try {
      const ctx = garantirCtx();
      if (ctx && ctx.state === 'running') {
        _somPendente = false;
        agendar(ctx);
      } else {
        _somPendente = true;
        if (ctx && ctx.state === 'suspended' && ctx.resume) {
          ctx.resume().then(() => {
            if (_somPendente && ctx.state === 'running') { _somPendente = false; agendar(ctx); }
          }).catch(() => {});
        }
      }
    } catch (e) { _somPendente = true; }
    try {
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    } catch (e) { /* iOS/sem suporte — silencioso */ }
  }

  // ── Estilo (tokens longos do base.css; dual-theme) ──────────────
  function injetarEstilo() {
    if (document.getElementById('solic-logistica-style')) return;
    const st = document.createElement('style');
    st.id = 'solic-logistica-style';
    st.textContent =
      // faixa de aviso no topo (a Logística não tem bnav → sem badge)
      '.sl-faixa{display:none;cursor:pointer;margin:0;padding:.7rem 1rem;background:var(--surface2);' +
        'border-bottom:2px solid var(--accent);color:var(--accent);font-family:var(--mono);' +
        'font-size:.8rem;font-weight:700;text-align:center}' +
      '.sl-faixa.visivel{display:block}' +
      // overlay + sheet (molde ranking-mix)
      '.sl-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:flex-end;' +
        'justify-content:center;background:rgba(0,0,0,.6)}' +
      '.sl-overlay.open{display:flex}' +
      '@media(min-width:600px){.sl-overlay{align-items:center;padding:1.5rem}}' +
      '.sl-sheet{background:var(--surface);border:1px solid var(--border);' +
        'border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;' +
        'padding:1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));position:relative}' +
      '@media(min-width:600px){.sl-sheet{border-radius:16px}}' +
      '.sl-close{position:absolute;top:.8rem;right:.8rem;background:var(--surface2);' +
        'border:1px solid var(--border);border-radius:8px;padding:4px 10px;color:var(--text3);' +
        'cursor:pointer;font-size:.9rem}' +
      '.sl-title{font-family:var(--mono);font-size:.9rem;font-weight:700;color:var(--text);padding-right:2.5rem}' +
      '.sl-sub{font-size:.64rem;color:var(--text3);font-family:var(--mono);text-transform:uppercase;' +
        'letter-spacing:.05em;margin:.15rem 0 .9rem}' +
      '.sl-list{display:flex;flex-direction:column;gap:.8rem}' +
      '.sl-card{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:.9rem}' +
      '.sl-card.done{opacity:.45;transition:opacity .3s}' +
      '.sl-posto{font-family:var(--mono);font-weight:700;color:var(--text);font-size:.9rem;margin-bottom:.6rem}' +
      '.sl-linhas{display:flex;flex-direction:column;gap:.45rem}' +
      '.sl-linha{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;flex-wrap:wrap}' +
      '.sl-fuel{font-weight:600;color:var(--text);font-size:.82rem}' +
      '.sl-precos{font-family:var(--mono);font-size:.86rem;color:var(--text3)}' +
      '.sl-novo{color:var(--accent);font-weight:700}' +
      '.sl-quando{font-family:var(--mono);font-size:.62rem;color:var(--text3);white-space:nowrap}' +
      '.sl-aprovar{width:100%;margin-top:.8rem;background:var(--accent);color:#0a0d0f;border:none;' +
        'border-radius:8px;padding:.8rem;font-family:var(--mono);font-size:.78rem;font-weight:700;' +
        'letter-spacing:.05em;text-transform:uppercase;cursor:pointer}' +
      '.sl-aprovar:disabled{background:var(--surface3);color:var(--text3);cursor:not-allowed;' +
        'opacity:.65;border:1px dashed var(--border2)}' +
      '.sl-erro{color:var(--danger);font-size:.72rem;margin-top:.5rem;display:none}' +
      '.sl-erro.on{display:block}' +
      '.sl-msg{text-align:center;color:var(--text3);font-size:.82rem;padding:1.5rem}';
    document.head.appendChild(st);
  }

  // ── Faixa de aviso (inserida após a .topbar da Logística) ───────
  function updateFaixa(count) {
    let faixa = document.getElementById('sl-faixa');
    if (count > 0) {
      if (!faixa) {
        const host = document.querySelector('.topbar');
        if (!host || !host.parentNode) return;
        faixa = document.createElement('div');
        faixa.id = 'sl-faixa';
        faixa.className = 'sl-faixa';
        faixa.addEventListener('click', () => abrir());
        host.parentNode.insertBefore(faixa, host.nextSibling);
      }
      const plural = count === 1 ? 'alteração de preço aguardando aprovação'
                                 : 'alterações de preço aguardando aprovação';
      faixa.textContent = '⚠️ ' + count + ' ' + plural + ' — TOCAR AQUI';
      faixa.classList.add('visivel');
    } else if (faixa) {
      faixa.classList.remove('visivel');
    }
  }

  // ── Bottom-sheet ────────────────────────────────────────────────
  function montarSheet() {
    if (_montado) return;
    injetarEstilo();
    const ov = document.createElement('div');
    ov.className = 'sl-overlay';
    ov.id = 'sl-overlay';
    ov.innerHTML =
      '<div class="sl-sheet">' +
        '<button class="sl-close" id="sl-close">✕</button>' +
        '<div class="sl-title">📌 Alterações a aprovar</div>' +
        '<div class="sl-sub">Aprove a troca na bomba — libera o gerente</div>' +
        '<div id="sl-body"><div class="sl-msg">Carregando…</div></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#sl-close').onclick = fechar;
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.addEventListener('click', onSheetClick);
    _montado = true;
  }

  // Agrupa as solicitações por posto (ordena postos por nome; itens por combustível).
  function agrupar() {
    const map = {};
    _solicitacoes.forEach(s => {
      const pid = s.posto_id;
      if (!map[pid]) map[pid] = { posto_id: pid, posto_nome: s.posto_nome || String(pid), itens: [] };
      map[pid].itens.push(s);
    });
    const arr = Object.keys(map).map(k => map[k]);
    arr.forEach(g => g.itens.sort((a, b) =>
      FUEL_ORDER.indexOf(a.combustivel) - FUEL_ORDER.indexOf(b.combustivel)));
    arr.sort((a, b) => String(a.posto_nome).localeCompare(String(b.posto_nome)));
    return arr;
  }

  function cardHtml(grupo) {
    const linhas = grupo.itens.map(s => {
      const fuel = FUEL_LABEL[s.combustivel] || s.combustivel;
      return '<div class="sl-linha">' +
        '<span class="sl-fuel">' + escapeHtml(fuel) + '</span>' +
        '<span class="sl-precos">' + fmtBRL(s.preco_antigo) +
          ' → <span class="sl-novo">' + fmtBRL(s.preco_novo) + '</span></span>' +
        '<span class="sl-quando">' + fmtQuando(s.criado_em) + '</span>' +
      '</div>';
    }).join('');
    const n = grupo.itens.length;
    return '<div class="sl-card" data-posto="' + escapeHtml(grupo.posto_id) + '">' +
        '<div class="sl-posto">' + escapeHtml(grupo.posto_nome) + '</div>' +
        '<div class="sl-linhas">' + linhas + '</div>' +
        '<div class="sl-erro" data-erro="' + escapeHtml(grupo.posto_id) + '"></div>' +
        '<button class="sl-aprovar" data-aprovar="' + escapeHtml(grupo.posto_id) + '">✅ APROVAR TODOS (' + n + ')</button>' +
      '</div>';
  }

  function renderLista() {
    const body = document.getElementById('sl-body');
    if (!body) return;
    if (!_solicitacoes.length) {
      body.innerHTML = '<div class="sl-msg">Nenhuma alteração aguardando aprovação. 🎉</div>';
      return;
    }
    body.innerHTML = '<div class="sl-list">' + agrupar().map(cardHtml).join('') + '</div>';
  }

  function onSheetClick(e) {
    const ap = e.target.closest && e.target.closest('[data-aprovar]');
    if (ap) { aprovarPosto(ap.getAttribute('data-aprovar')); return; }
  }

  function mostrarErroPosto(postoId, msg) {
    const ov = document.getElementById('sl-overlay');
    if (!ov) return;
    const el = ov.querySelector('[data-erro="' + postoId + '"]');
    if (el) { el.textContent = msg; el.classList.add('on'); }
  }

  // Aprova, em SEQUÊNCIA, todas as solicitações do posto. As que dão certo
  // somem (o backend tira do status aguardando_logistica); as que falham ficam,
  // e o erro aparece no card. Recarrega do servidor no fim.
  async function aprovarPosto(postoId) {
    const itens = _solicitacoes.filter(s => String(s.posto_id) === String(postoId));
    if (!itens.length) return;
    const ov = document.getElementById('sl-overlay');
    const btn = ov && ov.querySelector('button[data-aprovar="' + postoId + '"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Aprovando…'; }
    let falhas = 0;
    for (const s of itens) {
      try {
        await apiFetch('/solicitacoes-preco/' + s.id + '/aprovar', { method: 'POST' });
      } catch (e) {
        falhas++;
      }
    }
    await refresh();        // puxa o estado real (aprovadas somem, falhas ficam)
    renderLista();          // reconstrói a lista já sem as aprovadas
    if (falhas > 0) {
      mostrarErroPosto(postoId, falhas + ' alteração(ões) não aprovada(s). Tente novamente.');
    }
    fecharSeVazio();
  }

  function fecharSeVazio() {
    const ov = document.getElementById('sl-overlay');
    if (ov && !ov.querySelector('.sl-card')) fechar();
  }
  function fechar() {
    const ov = document.getElementById('sl-overlay');
    if (ov) ov.classList.remove('open');
  }

  // ── Dados ───────────────────────────────────────────────────────
  async function refresh() {
    if (!ehLogistica()) return;
    try {
      const resp = await apiFetch('/solicitacoes-preco?status=aguardando_logistica');
      _solicitacoes = (resp && resp.solicitacoes) || [];
    } catch (e) {
      // rede/sessão: não mexe no snapshot atual, tenta no próximo poll
      return;
    }
    const n = _solicitacoes.length;
    if (_ultimaContagem !== null && n > _ultimaContagem) tocarNotificacao();
    _ultimaContagem = n;
    updateFaixa(n);
  }

  async function abrir() {
    if (!ehLogistica()) return;
    montarSheet();
    const ov = document.getElementById('sl-overlay');
    ov.classList.add('open');
    document.getElementById('sl-body').innerHTML = '<div class="sl-msg">Carregando…</div>';
    await refresh();
    renderLista();
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (!ehLogistica()) return;
    injetarEstilo();      // CSS da faixa/sheet no <head> ANTES do 1º updateFaixa
    // Destrava o áudio a cada gesto (autoplay policy). Listener PERSISTENTE (NÃO once).
    ['pointerdown', 'keydown', 'click', 'touchend'].forEach(ev =>
      document.addEventListener(ev, destravarAudio, { capture: true }));
    refresh();            // 1º poll (sem beep)
    _timer = setInterval(refresh, INTERVALO_MS);
  }

  window.solicitacoesLogistica = { refresh, abrir };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
