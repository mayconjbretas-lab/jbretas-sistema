// JBRETAS SISTEMA — shared/js/mascara-litros.js
// Máscara de LITROS (inteiro, separador de milhar) + parse. Extraída do
// modulos/fechamento/app.js (criada p/ o bug do ×1000) para reuso SEM duplicar:
// o Fechamento e o editor de pedido da Logística usam a MESMA. Globais porque
// os handlers inline legados (oninput="mascararVenda(this)") dependem disso.
(function () {
  'use strict';

  // ════════ CARGA: OU NADA, OU PELO MENOS 1.000 L ════════
  // Um caminhão não descarrega 1 litro. Valor entre 1 e 999 nunca é entrega:
  // é marcador de quem está tentando passar por uma trava — e foi o que
  // aconteceu (a Logística vinha corrigindo `carga` de 1 para 5.000/10.000
  // dia após dia, e o 1 L entrava na Diferença como perda de estoque).
  //
  // MORA AQUI porque este arquivo é o único que o Fechamento (gerente), a
  // Logística e a Logística mobile já carregam os três. A mesma regra num
  // arquivo novo exigiria três <script> a mais e três chances de esquecer um.
  // A trava DE VERDADE é a da API (CARGA_MIN_LITROS no server.js); esta aqui
  // avisa antes da viagem, no campo em que a pessoa ainda está.
  const CARGA_MIN_LITROS = 1000;
  const CARGA_MIN_MSG = 'Carga mínima: 1.000 litros. Deixe vazio se não recebeu carga.';

  // O que a regra RECUSA: maior que zero e menor que o mínimo.
  function cargaAbaixoDoMinimo(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < CARGA_MIN_LITROS;
  }
  // O que se GRAVA: nulo para vazio/zero/negativo — "não chegou etanol" e
  // "não recebi carga" são a mesma coisa para a conta da Diferença, e guardar
  // 0 mostrava um número onde não houve evento.
  function cargaParaGravar(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

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

  window.CARGA_MIN_LITROS     = CARGA_MIN_LITROS;
  window.CARGA_MIN_MSG        = CARGA_MIN_MSG;
  window.cargaAbaixoDoMinimo  = cargaAbaixoDoMinimo;
  window.cargaParaGravar      = cargaParaGravar;
  window.parseLitros = parseLitros;
  window.mascararVenda = mascararVenda;
})();
