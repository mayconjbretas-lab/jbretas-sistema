// ================================================================
// JBRETAS SISTEMA — shared/js/gerente-nav.js
// Rodapé de navegação (bnav) compartilhado pelos módulos do GERENTE
// (fechamento, coleta-precos, copasa). Substitui o antigo menu de 3
// pontinhos. Injeta um <nav class="bnav"> fixo + o CSS necessário
// (via <style>, sem tocar no base.css) e marca a aba do módulo atual.
//
// 4 botões: Fechamento · Coleta · Copasa (navegam com location.href,
// páginas separadas como antes) + Ranking (abre o overlay de mix,
// definido em ranking-mix.js — NÃO navega).
//
// CSS: clone do .bnav/.nbtn do admin.css, com os tokens curtos
// (--sf/--bd/--ac/--acd/--tx3/--mono) traduzidos pros longos do
// base.css (--surface/--border/--accent/--accent-dim/--text3/--mono).
// ================================================================
(function () {
  // Módulos do rodapé: chave = pasta em /modulos/, usada tanto na
  // detecção da aba ativa (location.pathname) quanto no destino.
  const MODULOS = [
    { key: 'fechamento',    ni: '📋', nl: 'Fechamento', href: '../fechamento/' },
    { key: 'coleta-precos', ni: '💰', nl: 'Coleta',     href: '../coleta-precos/' },
    { key: 'copasa',        ni: '💧', nl: 'Copasa',     href: '../copasa/' },
  ];

  function injetarEstilo() {
    if (document.getElementById('gerente-nav-style')) return;
    const st = document.createElement('style');
    st.id = 'gerente-nav-style';
    st.textContent =
      // ── Bottom nav (clone do admin.css, tokens traduzidos p/ base.css) ──
      '.bnav{position:fixed;bottom:0;left:0;right:0;background:var(--surface);' +
        'border-top:1px solid var(--border);display:flex;z-index:100;' +
        'padding-bottom:env(safe-area-inset-bottom);height:calc(60px + env(safe-area-inset-bottom))}' +
      '.nbtn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:3px;cursor:pointer;background:transparent;border:none;' +
        'border-top:2px solid transparent;transition:all .15s;padding:5px 2px}' +
      '.nbtn.active{border-top-color:var(--accent);background:var(--accent-dim)}' +
      '.nbtn .ni{font-size:17px;line-height:1;transition:filter .15s}' +
      '.nbtn:not(.active) .ni{filter:grayscale(.35) opacity(.7)}' +
      '.nbtn .nl{font-size:.52rem;font-family:var(--mono);color:var(--text3);' +
        'letter-spacing:.02em;text-transform:uppercase;transition:color .15s}' +
      '.nbtn.active .nl{color:var(--accent)}' +
      // ── Folga p/ o conteúdo não ficar atrás do bnav fixo ──
      '.app-main{padding-bottom:calc(70px + env(safe-area-inset-bottom))}' +
      // ── save-bar (sticky) sobe pra ficar ACIMA do bnav ──
      '.save-bar{bottom:calc(60px + env(safe-area-inset-bottom))}' +
      // ── Guard de overflow-x (bug iPhone: faixa vazia à direita) ──
      // A topbar do gerente pode transbordar alguns px na horizontal; o
      // base.css só tem overflow-x:hidden no BODY, que o iOS Safari não
      // recorta de forma confiável → o excesso vira zoom-out. Recortamos no
      // #screen-app com overflow:clip (NÃO cria scroll-container, então o
      // position:sticky da topbar continua funcionando — overflow:hidden aqui
      // ou no <html> quebraria o sticky). Só no <style> injetado; base.css intacto.
      '#screen-app{overflow-x:clip}' +
      // ── Mobile ≤480px: emagrece a topbar p/ o SAIR não cortar (o clip acima
      //    vira só rede de segurança). SAIR só ícone (⏻), some o subtítulo do
      //    posto, gaps/padding menores. base.css intacto — tudo aqui. ──
      '@media (max-width:480px){' +
        '.topbar{padding-left:.9rem;padding-right:.9rem}' +
        '.topbar-right{gap:.5rem}' +
        '.topbar-user{gap:7px}' +
        '.topbar-posto{display:none}' +
        '.topbar .menu-dots{font-size:1.15rem;padding:4px 7px}' +
        '.btn-logout{font-size:0;padding:6px 9px;line-height:1}' +
        '.btn-logout::before{content:"\\23FB";font-size:1rem}' +
      '}';
    document.head.appendChild(st);
  }

  function injetarNav() {
    if (document.getElementById('gerente-bnav')) return;
    // Aba ativa = módulo cuja pasta aparece no caminho atual.
    const path = location.pathname;
    const nav = document.createElement('nav');
    nav.className = 'bnav';
    nav.id = 'gerente-bnav';
    const botoesMod = MODULOS.map(m => {
      const ativo = path.indexOf('/' + m.key + '/') !== -1;
      return '<button class="nbtn' + (ativo ? ' active' : '') + '" onclick="location.href=\'' + m.href + '\'">' +
             '<span class="ni">' + m.ni + '</span><span class="nl">' + m.nl + '</span></button>';
    }).join('');
    // Ranking: abre o overlay (ranking-mix.js), não navega.
    const botaoRanking =
      '<button class="nbtn" onclick="abrirRankingMix()">' +
      '<span class="ni">🥇</span><span class="nl">Ranking</span></button>';
    nav.innerHTML = botoesMod + botaoRanking;
    document.body.appendChild(nav);
  }

  function init() { injetarEstilo(); injetarNav(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
