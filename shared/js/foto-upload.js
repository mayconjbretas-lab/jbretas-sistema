// ================================================================
// JBRETAS SISTEMA — shared/js/foto-upload.js
// Compressao de foto antes do upload. Expoe window.jbComprimirFoto.
//
// POR QUE EXISTE: esta funcao ja estava DUPLICADA em dois lugares —
// modulos/coleta-precos/app.js e shared/js/solicitacoes-gerente.js —
// com o mesmo corpo. O Calibrador seria a terceira copia. Aqui ela fica
// uma vez so.
//
// As duas copias antigas continuam onde estao POR ENQUANTO: apontar as
// duas telas para ca e mexer em fluxo que funciona, e merece commit
// proprio, com a verificacao de que cada modulo que as usa carrega este
// arquivo. Ate la, este arquivo e a copia canonica e a unica que o
// codigo novo deve usar.
//
// O QUE FAZ: redimensiona via canvas para no maximo 1600px no lado
// maior (sem AUMENTAR imagem menor) e reexporta como JPEG qualidade
// 0.7. Em qualquer falha devolve o dataURL ORIGINAL — comprimir e
// otimizacao, nao pode ser o motivo de o lancamento se perder.
//
// 1600px/0.7 vem da coleta de precos e ficou como esta de proposito: a
// foto do protocolo assinado e comprovante, e precisa continuar legivel
// depois de comprimida. Nao aperte sem olhar um protocolo de verdade.
// ================================================================
(function () {
  'use strict';

  const MAX = 1600;

  window.jbComprimirFoto = function (dataUrlOriginal, cb) {
    try {
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
        } catch (e) {
          cb(dataUrlOriginal);
        }
      };
      img.onerror = () => cb(dataUrlOriginal);
      img.src = dataUrlOriginal;
    } catch (e) {
      cb(dataUrlOriginal);
    }
  };
})();
