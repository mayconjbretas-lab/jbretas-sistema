// ================================================================
// JBRETAS SISTEMA — shared/js/push-inscricao.js
// Registra o service worker (/sw.js) e inscreve o aparelho no Web Push.
// Só age pra GERENTE/ADM/LOGISTICA em navegador com suporte. iOS exige que o
// requestPermission saia de um GESTO do usuário → quando a permissão ainda
// está 'default', mostramos uma faixa discreta e só pedimos no clique.
// Backend (6A): GET /push/vapid-public-key, POST /push/inscrever.
// CSS injetado com CADEIA de fallback de tokens (long → short → literal),
// pra valer no base.css (gerente/painel-adm) E no admin.css (mobile).
// ================================================================
(function () {
  function elegivel() {
    try {
      const u = getUsuarioLogado();
      if (!u || (u.perfil !== 'GERENTE' && u.perfil !== 'ADM' && u.perfil !== 'LOGISTICA')) return false;
      return ('serviceWorker' in navigator) && ('PushManager' in window);
    } catch (e) { return false; }
  }

  // base64url (VAPID) → Uint8Array (formato exigido pelo applicationServerKey).
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  // Inscreve (ou re-POSTa a inscrição existente pra garantir usuario_id atual).
  async function inscrever() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const resp = await apiFetch('/push/vapid-public-key');
      const publicKey = resp && resp.publicKey;
      if (!publicKey) return; // backend sem VAPID → aborta silencioso
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await apiFetch('/push/inscrever', {
        method: 'POST',
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
    } catch (e) {
      console.warn('push: inscrição falhou:', e && e.message);
    }
  }

  // ── Faixa "Ativar notificações" (só quando a permissão está 'default') ──
  function injetarEstilo() {
    if (document.getElementById('push-inscricao-style')) return;
    const st = document.createElement('style');
    st.id = 'push-inscricao-style';
    st.textContent =
      '#push-faixa{position:fixed;left:10px;right:10px;z-index:2000;' +
        'bottom:calc(72px + env(safe-area-inset-bottom));' +
        'display:flex;align-items:center;justify-content:center;gap:.5rem;' +
        'padding:.7rem 1rem;cursor:pointer;text-align:center;' +
        'font-family:var(--mono, monospace);font-size:.8rem;font-weight:700;' +
        'color:var(--accent, var(--ac, #f4c66a));' +
        'background:var(--surface, var(--sf, #141a33));' +
        'border:1.5px solid var(--accent, var(--ac, #f4c66a));' +
        'border-radius:12px;box-shadow:0 6px 24px -8px rgba(0,0,0,.5)}' +
      '@media(min-width:600px){#push-faixa{left:auto;right:16px;max-width:360px}}';
    document.head.appendChild(st);
  }
  function removerFaixa() {
    const f = document.getElementById('push-faixa');
    if (f && f.parentNode) f.parentNode.removeChild(f);
  }
  function mostrarFaixa() {
    if (document.getElementById('push-faixa')) return;
    injetarEstilo();
    const f = document.createElement('div');
    f.id = 'push-faixa';
    f.textContent = '🔔 Ativar notificações de preço — TOCAR AQUI';
    f.addEventListener('click', () => {
      // requestPermission SÓ no gesto (exigência do iOS).
      try {
        Notification.requestPermission().then(p => {
          removerFaixa();
          if (p === 'granted') inscrever();
        }).catch(() => removerFaixa());
      } catch (e) { removerFaixa(); }
    });
    document.body.appendChild(f);
  }

  async function init() {
    if (!elegivel()) return;
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (e) {
      console.warn('push: registro do SW falhou:', e && e.message);
      return;
    }
    const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
    if (perm === 'granted') inscrever();
    else if (perm === 'denied') return;      // usuário já negou → não insiste
    else mostrarFaixa();                      // 'default' → pede no clique
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
