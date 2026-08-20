// JBRETAS SISTEMA — shared/js/mascara-litros.js
// Máscara de LITROS (inteiro, separador de milhar) + parse. Extraída do
// modulos/fechamento/app.js (criada p/ o bug do ×1000) para reuso SEM duplicar:
// o Fechamento e o editor de pedido da Logística usam a MESMA. Globais porque
// os handlers inline legados (oninput="mascararVenda(this)") dependem disso.
(function () {
  'use strict';

  // Litro é INTEIRO: só dígitos, ponto é milhar (removido), decimal descartado.
  function parseLitros(str) {
    const d = String(str == null ? '' : str).replace(/\D/g, '');
    return Math.round(Number(d)) || 0;
  }

  // Máscara ao vivo: mantém só dígitos e reinsere o ponto de milhar a cada 3;
  // preserva o cursor pela distância até o fim (digitar não "pula").
  function mascararVenda(el) {
    const distFim = el.value.length - el.selectionStart;
    let v = el.value;
    const iVirg = v.indexOf(',');
    if (iVirg !== -1) v = v.slice(0, iVirg);
    v = v.replace(/\D/g, '');
    v = v.replace(/^0+/, '');
    if (v.length > 6) v = v.slice(0, 6);
    v = v.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    el.value = v;
    const pos = Math.max(0, v.length - distFim);
    try { el.setSelectionRange(pos, pos); } catch (e) { /* input pode não estar focado */ }
  }

  window.parseLitros = parseLitros;
  window.mascararVenda = mascararVenda;
})();
