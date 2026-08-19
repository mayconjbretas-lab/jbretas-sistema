// JBRETAS SISTEMA — shared/js/clipboard.js
// Cópia para a área de transferência com feedback no botão. Núcleo extraído do
// __relCopiar (painel-adm/relatorios.js) para reuso sem duplicar: Relatórios e a
// faixa de alterações de medição usam a MESMA função.
// Uso: window.jbCopiar(texto, btn) — btn opcional (mostra "✓ Copiado!" 2s).
(function () {
  'use strict';
  function jbCopiar(texto, btn) {
    const feedback = () => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = '✓ Copiado!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(feedback).catch(() => {
        window.prompt('Copie o texto abaixo:', texto);
      });
    } else {
      window.prompt('Copie o texto abaixo:', texto);
    }
  }
  window.jbCopiar = jbCopiar;
})();
