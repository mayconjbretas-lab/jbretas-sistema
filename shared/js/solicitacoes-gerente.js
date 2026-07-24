// ================================================================
// JBRETAS SISTEMA — shared/js/solicitacoes-gerente.js
// Ciclo de preço (lado GERENTE). Carregado pelos 3 módulos do gerente
// (fechamento, coleta-precos, copasa). Só age se o perfil for GERENTE.
//
// Faz:
//  1) Polling a cada 60s de GET /solicitacoes-preco?status=pendente
//     (o backend já devolve SÓ as do posto do gerente) → badge vermelho
//     no botão "Coleta" do bnav + beep quando a contagem AUMENTA.
//  2) No módulo Coleta: faixa de aviso clicável no topo (reusa
//     .coleta-aviso/.visivel do coleta-precos.css).
//  3) Bottom-sheet de confirmação (molde do ranking-mix.js): lista as
//     pendências, anexa foto (câmera/galeria, comprimida no cliente) e
//     confirma via POST /solicitacoes-preco/:id/confirmar { foto }.
//
// Expõe window.solicitacoesGerente = { refresh, abrir }.
// CSS injetado via <style> com os tokens LONGOS do base.css (dual-theme).
// ================================================================
(function () {
  const INTERVALO_MS = 20000;
  const FUEL_LABEL = {
    GC: 'Gasolina Comum', GA: 'Gasolina Aditivada', ET: 'Etanol',
    S10: 'Diesel S10', S500: 'Diesel S500',
  };

  let _pendentes = [];        // último snapshot de pendências
  let _ultimaContagem = null; // p/ detectar aumento (beep). null = 1º poll
  let _fotoPorId = {};        // id da solicitação -> base64 comprimido
  let _montado = false;
  let _timer = null;
  let _ctx = null;            // AudioContext único/persistente (lazy)
  let _somPendente = false;   // poll tocou com áudio travado → toca no 1º gesto

  function ehGerente() {
    try { return (getUsuarioLogado() || {}).perfil === 'GERENTE'; }
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

  // ── Compressão (cópia de modulos/coleta-precos/app.js — canvas 1600px,
  //    JPEG 0.7). SEM OCR: aqui a foto é só prova da confirmação. ──
  function comprimirFoto(dataUrlOriginal, cb) {
    try {
      const MAX = 1600;
      const img = new Image();
      img.onload = () => {
        try {
          const escala = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.round(img.width * escala);
          const h = Math.round(img.height * escala);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return cb(dataUrlOriginal);
          ctx.drawImage(img, 0, 0, w, h);
          const comprimida = canvas.toDataURL('image/jpeg', 0.7);
          cb(comprimida && comprimida.startsWith('data:image/jpeg') ? comprimida : dataUrlOriginal);
        } catch (e) { cb(dataUrlOriginal); }
      };
      img.onerror = () => cb(dataUrlOriginal);
      img.src = dataUrlOriginal;
    } catch (e) { cb(dataUrlOriginal); }
  }

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

  // ── Estilo (tokens longos do base.css; dual-theme) ──────────────
  function injetarEstilo() {
    if (document.getElementById('solic-gerente-style')) return;
    const st = document.createElement('style');
    st.id = 'solic-gerente-style';
    st.textContent =
      // badge vermelho no botão Coleta do bnav
      '#gerente-bnav .nbtn{position:relative}' +
      '#gerente-bnav .nbadge{position:absolute;top:3px;left:calc(50% + 5px);' +
        'min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--danger);' +
        'color:#fff;font-family:var(--mono);font-size:.56rem;font-weight:700;line-height:16px;' +
        'text-align:center;box-shadow:0 0 0 2px var(--surface)}' +
      // overlay + sheet (molde ranking-mix)
      '.sg-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:flex-end;' +
        'justify-content:center;background:rgba(0,0,0,.6)}' +
      '.sg-overlay.open{display:flex}' +
      '@media(min-width:600px){.sg-overlay{align-items:center;padding:1.5rem}}' +
      '.sg-sheet{background:var(--surface);border:1px solid var(--border);' +
        'border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;' +
        'padding:1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));position:relative}' +
      '@media(min-width:600px){.sg-sheet{border-radius:16px}}' +
      '.sg-close{position:absolute;top:.8rem;right:.8rem;background:var(--surface2);' +
        'border:1px solid var(--border);border-radius:8px;padding:4px 10px;color:var(--text3);' +
        'cursor:pointer;font-size:.9rem}' +
      '.sg-title{font-family:var(--mono);font-size:.9rem;font-weight:700;color:var(--text);padding-right:2.5rem}' +
      '.sg-sub{font-size:.64rem;color:var(--text3);font-family:var(--mono);text-transform:uppercase;' +
        'letter-spacing:.05em;margin:.15rem 0 .9rem}' +
      '.sg-list{display:flex;flex-direction:column;gap:.8rem}' +
      '.sg-item{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:.9rem}' +
      '.sg-item.done{opacity:.45;transition:opacity .3s}' +
      '.sg-item-head{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem}' +
      '.sg-fuel{font-weight:700;color:var(--text);font-size:.92rem}' +
      '.sg-quando{font-family:var(--mono);font-size:.62rem;color:var(--text3);white-space:nowrap}' +
      '.sg-precos{font-family:var(--mono);font-size:1rem;margin:.5rem 0 .7rem;color:var(--text3)}' +
      '.sg-novo{color:var(--accent);font-weight:700}' +
      '.sg-foto-botoes{display:flex;gap:.5rem}' +
      '.sg-btn-foto{flex:1;background:var(--surface3);border:1px solid var(--border);border-radius:8px;' +
        'padding:.6rem;color:var(--text);font-family:var(--mono);font-size:.72rem;font-weight:600;cursor:pointer}' +
      '.sg-btn-foto:active{transform:scale(.98)}' +
      '.sg-preview{display:none;width:100%;max-height:180px;object-fit:contain;border-radius:8px;' +
        'margin-bottom:.6rem;background:var(--bg)}' +
      '.sg-confirmar{width:100%;margin-top:.7rem;background:var(--accent);color:#0a0d0f;border:none;' +
        'border-radius:8px;padding:.8rem;font-family:var(--mono);font-size:.78rem;font-weight:700;' +
        'letter-spacing:.05em;text-transform:uppercase;cursor:pointer}' +
      '.sg-confirmar:disabled{background:var(--surface3);color:var(--text3);cursor:not-allowed;' +
        'opacity:.65;border:1px dashed var(--border2)}' +
      '.sg-erro{color:var(--danger);font-size:.72rem;margin-top:.5rem;display:none}' +
      '.sg-erro.on{display:block}' +
      '.sg-msg{text-align:center;color:var(--text3);font-size:.82rem;padding:1.5rem}';
    document.head.appendChild(st);
  }

  // ── Badge no bnav ───────────────────────────────────────────────
  function acharBotaoColeta() {
    const bnav = document.getElementById('gerente-bnav');
    if (!bnav) return null;
    let btn = null;
    bnav.querySelectorAll('.nbtn').forEach(b => {
      if ((b.getAttribute('onclick') || '').indexOf('coleta-precos') !== -1) btn = b;
    });
    return btn;
  }
  function updateBadge(count) {
    injetarEstilo(); // garante o CSS do .nbadge ANTES de injetar o span (idempotente)
    const btn = acharBotaoColeta();
    if (!btn) return;
    let badge = btn.querySelector('.nbadge');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'nbadge'; btn.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : String(count);
    } else if (badge) {
      badge.remove();
    }
  }
  // O bnav é injetado pelo gerente-nav.js (também no load) — se ainda não
  // existe, tenta de novo por alguns segundos.
  function esperarBnav(tentativas) {
    if (document.getElementById('gerente-bnav')) { updateBadge(_pendentes.length); return; }
    if (tentativas <= 0) return;
    setTimeout(() => esperarBnav(tentativas - 1), 200);
  }

  // ── Faixa de aviso (SÓ no módulo Coleta) ────────────────────────
  function updateFaixa(count) {
    if (location.pathname.indexOf('/coleta-precos/') === -1) return;
    let faixa = document.getElementById('sg-faixa');
    if (count > 0) {
      if (!faixa) {
        const ph = document.querySelector('.page-header');
        if (!ph || !ph.parentNode) return;
        faixa = document.createElement('div');
        faixa.id = 'sg-faixa';
        faixa.className = 'coleta-aviso';
        faixa.style.cursor = 'pointer';
        faixa.addEventListener('click', () => abrir());
        ph.parentNode.insertBefore(faixa, ph.nextSibling);
      }
      const plural = count === 1 ? 'alteração de preço aguardando' : 'alterações de preço aguardando';
      faixa.textContent = `⚠️ ${count} ${plural} sua confirmação — TOCAR AQUI`;
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
    ov.className = 'sg-overlay';
    ov.id = 'sg-overlay';
    ov.innerHTML =
      '<div class="sg-sheet">' +
        '<button class="sg-close" id="sg-close">✕</button>' +
        '<div class="sg-title">📌 Alterações de preço</div>' +
        '<div class="sg-sub">Anexe a foto da bomba e confirme</div>' +
        '<div id="sg-body"><div class="sg-msg">Carregando…</div></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#sg-close').onclick = fechar;
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    // Delegação de clique (botões de foto e confirmar).
    ov.addEventListener('click', onSheetClick);
    // Delegação de change (inputs de arquivo — change borbulha).
    ov.addEventListener('change', onSheetChange);
    _montado = true;
  }

  function itemHtml(s) {
    const fuel = FUEL_LABEL[s.combustivel] || s.combustivel;
    return (
      '<div class="sg-item" data-id="' + s.id + '">' +
        '<div class="sg-item-head">' +
          '<span class="sg-fuel">' + fuel + '</span>' +
          '<span class="sg-quando">' + fmtQuando(s.criado_em) + '</span>' +
        '</div>' +
        '<div class="sg-precos">' + fmtBRL(s.preco_antigo) +
          ' → <span class="sg-novo">' + fmtBRL(s.preco_novo) + '</span></div>' +
        '<img class="sg-preview" data-prev="' + s.id + '">' +
        '<div class="sg-foto-botoes">' +
          '<button class="sg-btn-foto" data-cam="' + s.id + '">📷 Câmera</button>' +
          '<button class="sg-btn-foto" data-gal="' + s.id + '">🖼️ Galeria</button>' +
        '</div>' +
        '<input type="file" accept="image/*" capture="environment" data-inp="' + s.id + '" hidden>' +
        '<input type="file" accept="image/*" data-inp="' + s.id + '" hidden>' +
        '<div class="sg-erro" data-erro="' + s.id + '"></div>' +
        '<button class="sg-confirmar" data-confirm="' + s.id + '" disabled>🔒 ANEXE A FOTO</button>' +
      '</div>'
    );
  }

  function renderLista() {
    const body = document.getElementById('sg-body');
    if (!body) return;
    if (!_pendentes.length) {
      body.innerHTML = '<div class="sg-msg">Nenhuma alteração pendente. 🎉</div>';
      return;
    }
    body.innerHTML = '<div class="sg-list">' + _pendentes.map(itemHtml).join('') + '</div>';
  }

  function inputsDoItem(id) {
    const ov = document.getElementById('sg-overlay');
    return ov ? ov.querySelectorAll('input[data-inp="' + id + '"]') : [];
  }
  function onSheetClick(e) {
    const cam = e.target.closest && e.target.closest('[data-cam]');
    if (cam) { const i = inputsDoItem(cam.getAttribute('data-cam'))[0]; if (i) i.click(); return; }
    const gal = e.target.closest && e.target.closest('[data-gal]');
    if (gal) { const i = inputsDoItem(gal.getAttribute('data-gal'))[1]; if (i) i.click(); return; }
    const conf = e.target.closest && e.target.closest('[data-confirm]');
    if (conf) { confirmar(conf.getAttribute('data-confirm')); return; }
  }
  function onSheetChange(e) {
    const inp = e.target;
    if (!inp || !inp.matches || !inp.matches('input[data-inp]')) return;
    const id = inp.getAttribute('data-inp');
    const file = inp.files && inp.files[0];
    inp.value = ''; // permite reescolher o mesmo arquivo depois
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      comprimirFoto(reader.result, (comprimida) => {
        _fotoPorId[id] = comprimida;
        const ov = document.getElementById('sg-overlay');
        if (!ov) return;
        const prev = ov.querySelector('img[data-prev="' + id + '"]');
        if (prev) { prev.src = comprimida; prev.style.display = 'block'; }
        const btn = ov.querySelector('button[data-confirm="' + id + '"]');
        if (btn) { btn.disabled = false; btn.textContent = '✅ CONFIRMAR PREÇO'; }
      });
    };
    reader.readAsDataURL(file);
  }

  function mostrarErroItem(id, msg) {
    const ov = document.getElementById('sg-overlay');
    if (!ov) return;
    const el = ov.querySelector('[data-erro="' + id + '"]');
    if (el) { el.textContent = msg; el.classList.add('on'); }
  }

  async function confirmar(id) {
    const foto = _fotoPorId[id];
    const ov = document.getElementById('sg-overlay');
    const btn = ov && ov.querySelector('button[data-confirm="' + id + '"]');
    if (!foto) { mostrarErroItem(id, 'Anexe a foto antes de confirmar.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
    const erroEl = ov && ov.querySelector('[data-erro="' + id + '"]');
    if (erroEl) erroEl.classList.remove('on');
    try {
      await apiFetch('/solicitacoes-preco/' + id + '/confirmar', {
        method: 'POST', body: JSON.stringify({ foto }),
      });
      // Sucesso: some da lista com fade, atualiza badge/faixa, fecha se vazio.
      delete _fotoPorId[id];
      const item = ov && ov.querySelector('.sg-item[data-id="' + id + '"]');
      if (item) { item.classList.add('done'); setTimeout(() => { item.remove(); fecharSeVazio(); }, 320); }
      await refresh();
    } catch (err) {
      const raw = (err && err.message) || 'Erro ao confirmar';
      const msg = /não está pendente/i.test(raw)
        ? 'Esta alteração já foi confirmada ou cancelada.'
        : raw;
      mostrarErroItem(id, msg);
      if (btn) { btn.disabled = false; btn.textContent = '✅ CONFIRMAR PREÇO'; }
    }
  }

  function fecharSeVazio() {
    const ov = document.getElementById('sg-overlay');
    if (ov && !ov.querySelector('.sg-item')) fechar();
  }
  function fechar() {
    const ov = document.getElementById('sg-overlay');
    if (ov) ov.classList.remove('open');
  }

  // ── Dados ───────────────────────────────────────────────────────
  async function refresh() {
    if (!ehGerente()) return;
    try {
      const resp = await apiFetch('/solicitacoes-preco?status=pendente');
      _pendentes = (resp && resp.solicitacoes) || [];
    } catch (e) {
      // rede/sessão: não mexe no snapshot atual, tenta no próximo poll
      return;
    }
    const n = _pendentes.length;
    if (_ultimaContagem !== null && n > _ultimaContagem) tocarNotificacao();
    _ultimaContagem = n;
    updateBadge(n);
    updateFaixa(n);
  }

  async function abrir() {
    if (!ehGerente()) return;
    montarSheet();
    const ov = document.getElementById('sg-overlay');
    ov.classList.add('open');
    document.getElementById('sg-body').innerHTML = '<div class="sg-msg">Carregando…</div>';
    await refresh();
    renderLista();
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (!ehGerente()) return;
    injetarEstilo();      // CSS do badge/sheet no <head> ANTES do 1º updateBadge
    // Destrava o áudio a cada gesto (autoplay policy). Listener PERSISTENTE (NÃO
    // once): se um som ficar pendente depois do 1º gesto, o próximo gesto toca.
    // destravarAudio tem guard de custo zero quando o áudio já está liberado.
    ['pointerdown', 'keydown', 'click', 'touchend'].forEach(ev =>
      document.addEventListener(ev, destravarAudio, { capture: true }));
    esperarBnav(15);      // badge assim que o bnav do gerente-nav existir
    refresh();            // 1º poll (sem beep)
    _timer = setInterval(refresh, INTERVALO_MS);
  }

  window.solicitacoesGerente = { refresh, abrir };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
