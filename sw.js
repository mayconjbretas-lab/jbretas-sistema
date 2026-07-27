// ================================================================
// JBRETAS SISTEMA — sw.js (Service Worker, scope '/')
// SÓ Web Push — SEM handler de fetch (nada de cache offline agora).
// Consome o payload do backend (6A): { title, body, tag, url }.
// ================================================================
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || 'JBRETAS', {
    body: d.body || '',
    tag: d.tag || 'jbretas',
    renotify: true,                    // re-push com mesmo tag RE-TOCA som/vibração
    icon: '/shared/icon-192.png',
    badge: '/shared/icon-192.png',
    vibrate: [300, 150, 300, 150, 300],
    data: { url: d.url || '/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(list => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      return clients.openWindow(url);
    }));
});
