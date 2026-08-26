// shared/js/nav-custo.js
// Seletor unico compartilhado pelas telas Custo · Compra · Fornecedores ·
// Simulador. Substitui os botoes de ida-e-volta que cada tela tinha.
// Botao fica DESABILITADO enquanto a tela correspondente nao existir.
(function () {
  'use strict';

  var TELAS = [
    { id: 'custo',     sec: 's-custo',     icone: '\u{1F4B0}', rotulo: 'Custo',        render: 'renderCustoMargem' },
    { id: 'compra',    sec: 's-compra',    icone: '\u{1F9FE}', rotulo: 'Compra',       render: 'renderCompra', glow: true },
    { id: 'forn',      sec: 's-forn',      icone: '\u{1F4CA}', rotulo: 'Fornecedores', render: 'renderFornecedores' },
    { id: 'simulador', sec: 's-simulador', icone: '\u2696\uFE0F', rotulo: 'Simulador', render: 'renderSimulador' },
    // Mercado de custo de compra (bandeira branca). desktopOnly: lancar 20 precos
    // por dia nao cabe em celular, entao no admin mobile o botao nem e renderizado
    // (em vez de ficar um botao morto). Ver modulos/painel-adm/mercado.js.
    { id: 'mercado',   sec: 's-mercado',   icone: '\u{1F3F7}\uFE0F', rotulo: 'Mercado', render: 'renderMercado', desktopOnly: true },
  ];

  // Largura minima para as telas marcadas desktopOnly. Casa com o MIN_LARGURA
  // do mercado.js, que tem o mesmo guard na entrada. 800: janela nao-maximizada
  // de ~835px util precisa passar (900 bloqueava), e a grade de lancamento cabe
  // em 800 porque os slots quebram em duas linhas (.mrc-slots e auto-fit).
  var MIN_DESKTOP = 800;

  var estiloInjetado = false;
  function injetarEstilo() {
    if (estiloInjetado) return;
    estiloInjetado = true;
    var st = document.createElement('style');
    st.textContent =
      '.navc{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}' +
      '.navc-btn{font-family:inherit;font-size:.75rem;padding:6px 14px;' +
        'border-radius:999px;border:1px solid var(--bd);background:transparent;' +
        'color:var(--tx);cursor:pointer;white-space:nowrap;' +
        'transition:color .15s,border-color .15s}' +
      '.navc-btn:hover:not(:disabled){border-color:var(--ac);color:var(--ac)}' +
      '.navc-btn.on{border-color:var(--ac);color:var(--ac);font-weight:600}' +
      '.navc-btn:disabled{opacity:.4;cursor:not-allowed}' +
      '.navc-ico-glow{filter:drop-shadow(0 0 1px var(--ac)) drop-shadow(0 0 3px var(--acd))}';
    document.head.appendChild(st);
  }

  // HTML do seletor. `ativa` = id da tela atual.
  window.navCustoHTML = function (ativa) {
    injetarEstilo();
    return '<div class="navc">' + TELAS.map(function (t) {
      // Tela so-desktop em viewport estreita: nao renderiza o botao.
      if (t.desktopOnly && window.innerWidth < MIN_DESKTOP) return '';
      var pronta = (typeof window[t.render] === 'function');
      return '<button class="navc-btn' + (t.id === ativa ? ' on' : '') + '"' +
        (pronta ? '' : ' disabled') +
        ' onclick="__navCusto(\'' + t.id + '\')">' +
        (t.glow ? '<span class="navc-ico-glow">' + t.icone + '</span>' : t.icone) + ' ' + t.rotulo + '</button>';
    }).join('') + '</div>';
  };

  window.__navCusto = function (id) {
    var t = null;
    for (var i = 0; i < TELAS.length; i++) if (TELAS[i].id === id) t = TELAS[i];
    if (!t) return;
    var fn = window[t.render];
    if (typeof fn !== 'function') return;
    var sec = document.getElementById(t.sec);
    if (!sec) return;
    document.querySelectorAll('.scr').forEach(function (x) { x.classList.remove('active'); });
    sec.classList.add('active');
    // Sincroniza o rodape do mobile: antes a secao trocava e o botao do bnav
    // continuava aceso na aba errada.
    var bnav = document.querySelectorAll('.nbtn');
    if (bnav.length) {
      bnav.forEach(function (b) { b.classList.remove('active'); });
      bnav.forEach(function (b) {
        var oc = b.getAttribute('onclick') || '';
        if (oc.indexOf("'" + id + "'") >= 0) b.classList.add('active');
      });
    }
    fn(sec);
  };
})();
