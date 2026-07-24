// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/solicitacoes-adm.js
// Ciclo de preço (lado ADM). Compartilhado pelos 2 painéis ADM
// (painel-adm desktop e admin mobile) — SEM fork, igual relatorios.js.
//
// Faz:
//  1) Chip "📸 Solicitações (N)" dentro da aba Comparação, acima dos
//     cards (irmão de #cmp-regions — o renderComparar só reescreve o
//     innerHTML de #cmp-regions, então o chip sobrevive aos re-renders).
//     Clicar abre o painel.
//  2) Painel (bottom-sheet no mobile / card centralizado no desktop,
//     mesmo molde responsivo do ranking-mix): pendentes (borda âmbar,
//     com Cancelar + confirmação inline, sem confirm() nativo) e
//     confirmadas de hoje (borda verde, com thumbnail clicável).
//  3) Polling 60s (só perfil ADM): GET ?status=pendente e ?status=
//     confirmada. Quando as CONFIRMADAS de hoje AUMENTAM entre polls
//     (e não no 1º), toca a notificação (tri-tone + vibração) e atualiza ao vivo.
//
// CSS injetado via <style> com os tokens CURTOS (--ac/--tx3/--sf/--bd/
// --dg/--ok/--wn/--mono...): no admin.css são a fonte original; no
// painel-adm.css têm alias pros longos → valem nos 2 (dual-theme).
// Expõe window.solicitacoesAdm = { refresh, abrir }.
// ================================================================
(function () {
  const INTERVALO_MS = 20000;
  const FUEL_LABEL = {
    GC: 'Gasolina Comum', GA: 'Gasolina Aditivada', ET: 'Etanol',
    S10: 'Diesel S10', S500: 'Diesel S500',
  };

  let _pend = [];        // pendentes (todas — ADM vê a rede toda)
  let _confHoje = [];    // confirmadas de HOJE (Brasília)
  let _ultConf = null;   // contagem anterior de confirmadas hoje (beep). null = 1º poll
  let _timer = null;
  let _montado = false;  // overlay/sheet já criado?
  let _ctx = null;       // AudioContext único/persistente (lazy)
  let _somPendente = false; // poll tocou com áudio travado → toca no 1º gesto

  function ehAdm() {
    try { return (getUsuarioLogado() || {}).perfil === 'ADM'; }
    catch (e) { return false; }
  }

  // ── Datas / formatação ──────────────────────────────────────────
  function hojeISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }
  function diaISOde(iso) {
    try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
    catch (e) { return ''; }
  }
  function fmtHora(iso) {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }
  function fmtDiaHora(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }
  function fmtBRL(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fuelLabel(c) { return FUEL_LABEL[c] || c; }

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

  // Destrava o áudio (autoplay policy): garante o _ctx e chama resume(). Se
  // havia som pendente (poll tocou antes de um gesto), toca ele agora. Listener
  // PERSISTENTE no init — com guard de custo zero quando já está tudo ok.
  function destravarAudio() {
    if (_ctx && _ctx.state === 'running' && !_somPendente) return; // nada a fazer
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

  // ── Notificação (WebAudio): tri-tone E5→A5→C#6 repetido 2×, com corpo
  //    (triangle 1 oitava acima) + vibração. Usa o _ctx PERSISTENTE. Se o áudio
  //    ainda está travado (sem _ctx, ou 'suspended' que não retomou), marca
  //    _somPendente=true — o próximo gesto do usuário toca o som atrasado. A
  //    vibração não depende de gesto: tenta sempre. Falha = silêncio (sem log). ──
  function tocarNotificacao() {
    const agendar = (ctx) => {
      const seq = [659.25, 880, 1108.73]; // E5, A5, C#6
      const passo = 0.18;                  // duração de cada nota
      const gapSeq = 0.35;                 // pausa entre as 2 repetições
      const nota = (freq, t0, dur) => {
        // sine principal (0.5) + triangle 1 oitava acima (0.15) pra dar corpo.
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
      const durSeq = seq.length * passo;   // 0,54s por sequência
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
        // Travado: guarda pro próximo gesto. Tentativa oportunista de resume()
        // (sem gesto normalmente NÃO destrava); se destravar, toca na hora.
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

  // ── Estilo (tokens CURTOS — valem no admin.css e no painel-adm.css) ──
  function injetarEstilo() {
    if (document.getElementById('solic-adm-style')) return;
    const st = document.createElement('style');
    st.id = 'solic-adm-style';
    st.textContent =
      // chip acima dos cards
      '.sga-chip{display:inline-flex;align-items:center;gap:.4rem;margin:0 0 .7rem;' +
        'background:var(--sf2);border:1px solid var(--bd);border-radius:999px;' +
        'padding:.4rem .8rem;color:var(--tx);font-family:var(--mono);font-size:.72rem;' +
        'font-weight:700;cursor:pointer}' +
      '.sga-chip.tem{border-color:var(--wn);color:var(--wn)}' +
      '.sga-chip:active{transform:scale(.98)}' +
      // overlay + painel (bottom-sheet mobile / card centralizado desktop)
      '.sga-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:flex-end;' +
        'justify-content:center;background:rgba(0,0,0,.6)}' +
      '.sga-overlay.open{display:flex}' +
      '@media(min-width:600px){.sga-overlay{align-items:center;padding:1.5rem}}' +
      '.sga-sheet{background:var(--sf);border:1px solid var(--bd);border-radius:16px 16px 0 0;' +
        'width:100%;max-width:540px;max-height:85vh;overflow-y:auto;position:relative;' +
        'padding:1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom))}' +
      '@media(min-width:600px){.sga-sheet{border-radius:16px}}' +
      '.sga-close{position:absolute;top:.8rem;right:.8rem;background:var(--sf2);border:1px solid var(--bd);' +
        'border-radius:8px;padding:4px 10px;color:var(--tx3);cursor:pointer;font-size:.9rem}' +
      '.sga-title{font-family:var(--mono);font-size:.9rem;font-weight:700;color:var(--tx);padding-right:2.5rem}' +
      '.sga-secao{font-family:var(--mono);font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;' +
        'color:var(--tx3);margin:1rem 0 .5rem}' +
      '.sga-vazio{color:var(--tx3);font-size:.78rem;padding:.4rem 0}' +
      '.sga-item{border:1px solid var(--bd);border-radius:10px;background:var(--sf2);' +
        'padding:.7rem .8rem;margin-bottom:.6rem}' +
      '.sga-pend{border-left:3px solid var(--wn)}' +
      '.sga-conf{border-left:3px solid var(--ok)}' +
      '.sga-item-top{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem}' +
      '.sga-posto{font-weight:700;color:var(--tx);font-size:.82rem}' +
      '.sga-quando{font-family:var(--mono);font-size:.6rem;color:var(--tx3);white-space:nowrap}' +
      '.sga-linha{margin-top:.35rem;font-size:.8rem;color:var(--tx2);display:flex;gap:.5rem;' +
        'align-items:baseline;flex-wrap:wrap}' +
      '.sga-fuel{font-weight:600;color:var(--tx)}' +
      '.sga-precos{font-family:var(--mono)}' +
      '.sga-novo{color:var(--ac)}' +
      '.sga-actions{margin-top:.6rem;display:flex;gap:.5rem;align-items:center}' +
      '.sga-cancel{background:transparent;border:1px solid var(--bd);border-radius:8px;padding:.4rem .8rem;' +
        'color:var(--dg);font-family:var(--mono);font-size:.68rem;font-weight:700;cursor:pointer}' +
      '.sga-confirmando{font-size:.7rem;color:var(--tx2)}' +
      '.sga-yes{background:var(--dg);border:none;border-radius:8px;padding:.4rem .8rem;color:#fff;' +
        'font-family:var(--mono);font-size:.68rem;font-weight:700;cursor:pointer}' +
      '.sga-no{background:var(--sf3);border:1px solid var(--bd);border-radius:8px;padding:.4rem .8rem;' +
        'color:var(--tx);font-family:var(--mono);font-size:.68rem;font-weight:700;cursor:pointer}' +
      '.sga-thumb{margin-top:.5rem;height:56px;border-radius:8px;border:1px solid var(--bd);cursor:pointer;' +
        'object-fit:cover;background:var(--bg)}' +
      '.sga-erro{color:var(--dg);font-size:.7rem;margin-top:.4rem;display:none}' +
      '.sga-erro.on{display:block}';
    document.head.appendChild(st);
  }

  // ── Chip na aba Comparação (irmão, ANTES de #cmp-regions) ───────
  function montarChip(tentativas) {
    if (document.getElementById('sga-chip')) return;
    const cards = document.getElementById('cmp-regions');
    if (cards && cards.parentNode) {
      injetarEstilo();
      const chip = document.createElement('button');
      chip.id = 'sga-chip';
      chip.className = 'sga-chip';
      chip.type = 'button';
      chip.innerHTML = '📸 Solicitações (<span id="sga-chip-n">0</span>)';
      chip.addEventListener('click', abrir);
      cards.parentNode.insertBefore(chip, cards);
      updateChip(_pend.length);
      return;
    }
    if (tentativas > 0) setTimeout(() => montarChip(tentativas - 1), 200);
  }
  function updateChip(n) {
    const el = document.getElementById('sga-chip-n');
    if (el) el.textContent = String(n);
    const chip = document.getElementById('sga-chip');
    if (chip) chip.classList.toggle('tem', n > 0);
  }

  // ── Painel ──────────────────────────────────────────────────────
  function montarSheet() {
    if (_montado) return;
    injetarEstilo();
    const ov = document.createElement('div');
    ov.className = 'sga-overlay';
    ov.id = 'sga-overlay';
    ov.innerHTML =
      '<div class="sga-sheet">' +
        '<button class="sga-close" id="sga-close">✕</button>' +
        '<div class="sga-title">📸 Solicitações de preço</div>' +
        '<div id="sga-body"><div class="sga-vazio">Carregando…</div></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#sga-close').onclick = fechar;
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.addEventListener('click', onSheetClick);
    _montado = true;
  }
  function fechar() {
    const ov = document.getElementById('sga-overlay');
    if (ov) ov.classList.remove('open');
  }

  function pendItemHtml(s) {
    return (
      '<div class="sga-item sga-pend" data-id="' + s.id + '">' +
        '<div class="sga-item-top">' +
          '<span class="sga-posto">' + (s.posto_nome || '—') + '</span>' +
          '<span class="sga-quando">' + fmtDiaHora(s.criado_em) + '</span>' +
        '</div>' +
        '<div class="sga-linha"><span class="sga-fuel">' + fuelLabel(s.combustivel) + '</span>' +
          '<span class="sga-precos">' + fmtBRL(s.preco_antigo) +
          ' → <b class="sga-novo">' + fmtBRL(s.preco_novo) + '</b></span></div>' +
        '<div class="sga-actions" data-actions="' + s.id + '">' +
          '<button class="sga-cancel" data-cancel="' + s.id + '">Cancelar</button>' +
        '</div>' +
        '<div class="sga-erro" data-erro="' + s.id + '"></div>' +
      '</div>'
    );
  }
  function confItemHtml(s) {
    const thumb = s.foto
      ? '<img class="sga-thumb" src="' + s.foto + '" data-foto="' + s.foto + '" alt="foto da bomba">'
      : '';
    return (
      '<div class="sga-item sga-conf">' +
        '<div class="sga-item-top">' +
          '<span class="sga-posto">' + (s.posto_nome || '—') + '</span>' +
          '<span class="sga-quando">' + fmtHora(s.confirmado_em) + '</span>' +
        '</div>' +
        '<div class="sga-linha"><span class="sga-fuel">' + fuelLabel(s.combustivel) + '</span>' +
          '<span class="sga-precos">' + fmtBRL(s.preco_antigo) +
          ' → <b class="sga-novo">' + fmtBRL(s.preco_novo) + '</b></span></div>' +
        thumb +
      '</div>'
    );
  }
  function render() {
    const body = document.getElementById('sga-body');
    if (!body) return;
    let html = '';
    html += '<div class="sga-secao">Pendentes (' + _pend.length + ')</div>';
    html += _pend.length ? _pend.map(pendItemHtml).join('') : '<div class="sga-vazio">Nenhuma solicitação pendente.</div>';
    html += '<div class="sga-secao">Confirmadas hoje (' + _confHoje.length + ')</div>';
    html += _confHoje.length ? _confHoje.map(confItemHtml).join('') : '<div class="sga-vazio">Nenhuma confirmação hoje ainda.</div>';
    body.innerHTML = html;
  }

  function onSheetClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const foto = t.closest('[data-foto]');
    if (foto) { window.open(foto.getAttribute('data-foto'), '_blank'); return; }
    const cancel = t.closest('[data-cancel]');
    if (cancel) { pedirConfirmacaoCancel(cancel.getAttribute('data-cancel')); return; }
    const no = t.closest('[data-cancelno]');
    if (no) { restaurarCancel(no.getAttribute('data-cancelno')); return; }
    const yes = t.closest('[data-cancelyes]');
    if (yes) { doCancel(yes.getAttribute('data-cancelyes')); return; }
  }

  // Confirmação inline (sem confirm() nativo): troca o botão Cancelar por
  // "Cancelar mesmo? [Sim] [Não]".
  function pedirConfirmacaoCancel(id) {
    const ov = document.getElementById('sga-overlay');
    const box = ov && ov.querySelector('[data-actions="' + id + '"]');
    if (!box) return;
    box.innerHTML =
      '<span class="sga-confirmando">Cancelar mesmo?</span>' +
      '<button class="sga-yes" data-cancelyes="' + id + '">Sim</button>' +
      '<button class="sga-no" data-cancelno="' + id + '">Não</button>';
  }
  function restaurarCancel(id) {
    const ov = document.getElementById('sga-overlay');
    const box = ov && ov.querySelector('[data-actions="' + id + '"]');
    if (box) box.innerHTML = '<button class="sga-cancel" data-cancel="' + id + '">Cancelar</button>';
  }
  function mostrarErro(id, msg) {
    const ov = document.getElementById('sga-overlay');
    const el = ov && ov.querySelector('[data-erro="' + id + '"]');
    if (el) { el.textContent = msg; el.classList.add('on'); }
  }

  async function doCancel(id) {
    const ov = document.getElementById('sga-overlay');
    const errEl = ov && ov.querySelector('[data-erro="' + id + '"]');
    if (errEl) errEl.classList.remove('on');
    try {
      await apiFetch('/solicitacoes-preco/' + id + '/cancelar', { method: 'POST' });
      const item = ov && ov.querySelector('.sga-item[data-id="' + id + '"]');
      if (item) item.remove();
      await refresh(); // atualiza chip + listas sem reload
    } catch (err) {
      const raw = (err && err.message) || 'Erro ao cancelar';
      const msg = /não está pendente/i.test(raw) ? 'Já confirmada ou cancelada.' : raw;
      mostrarErro(id, msg);
      restaurarCancel(id);
    }
  }

  // ── Dados ───────────────────────────────────────────────────────
  async function refresh() {
    if (!ehAdm()) return;
    let pend, conf;
    try {
      const [rp, rc] = await Promise.all([
        apiFetch('/solicitacoes-preco?status=pendente'),
        apiFetch('/solicitacoes-preco?status=confirmada'),
      ]);
      pend = (rp && rp.solicitacoes) || [];
      conf = (rc && rc.solicitacoes) || [];
    } catch (e) {
      return; // rede/sessão: mantém snapshot, tenta no próximo poll
    }
    const hoje = hojeISO();
    _pend = pend;
    _confHoje = conf.filter(s => diaISOde(s.confirmado_em) === hoje);

    const nConf = _confHoje.length;
    if (_ultConf !== null && nConf > _ultConf) tocarNotificacao();
    _ultConf = nConf;

    updateChip(_pend.length);
    const ov = document.getElementById('sga-overlay');
    if (ov && ov.classList.contains('open')) render(); // ao vivo se aberto
  }

  async function abrir() {
    if (!ehAdm()) return;
    montarSheet();
    const ov = document.getElementById('sga-overlay');
    ov.classList.add('open');
    document.getElementById('sga-body').innerHTML = '<div class="sga-vazio">Carregando…</div>';
    await refresh();
    render();
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (!ehAdm()) return;
    injetarEstilo();
    // Destrava o áudio a cada gesto (autoplay policy). Listener PERSISTENTE (NÃO
    // once): se um som ficar pendente depois do 1º gesto, o próximo gesto toca.
    // destravarAudio tem guard de custo zero quando o áudio já está liberado.
    ['pointerdown', 'keydown', 'click', 'touchend'].forEach(ev =>
      document.addEventListener(ev, destravarAudio, { capture: true }));
    montarChip(25);   // #cmp-regions é HTML estático; retry por segurança
    refresh();        // 1º poll (sem beep)
    _timer = setInterval(refresh, INTERVALO_MS);
  }

  window.solicitacoesAdm = { refresh, abrir };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
