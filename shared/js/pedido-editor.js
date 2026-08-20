// JBRETAS SISTEMA — shared/js/pedido-editor.js
// Editor do PEDIDO (coluna `pedido` da medicao) reutilizável no card da grade e
// na faixa da matriz reduzida (logistica e logistica-mobile). Grava pela MESMA
// rota da matriz completa: POST /medicao { posto, itens:[{data,campo:'pedido',
// combustivel,valor}] } — não cria rota nova. Máscara viva = window.mascararVenda
// (shared/js/mascara-litros.js). REGRA DOS MÚLTIPLOS: arredonda para o milhar mais
// próximo no BLUR (deixa digitar natural e corrige na saída); 0 é válido.
//
// window.pedidoEditor.abrir({ posto, dataISO, host, onInput?, onSalvo? })
//   host   : elemento onde os campos são renderizados (a área some no cancelar/salvar)
//   onInput(totalLitros)          : a cada digitação (o chamador atualiza seu total)
//   onSalvo(ok, erro?, resumo?)   : ok=true → gravou (resumo={total, porCod}); ok=false
//                                   → cancelou (sem erro) ou FALHOU (com erro): o
//                                   chamador re-renderiza o valor ANTERIOR e mostra o erro.
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtMilhar(n) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
  const aoMilhar = (litros) => Math.round((window.parseLitros ? window.parseLitros(litros) : Number(litros) || 0) / 1000) * 1000;

  async function abrir(opts) {
    const host = opts && opts.host;
    if (!host) return;
    const posto = opts.posto, dataISO = opts.dataISO;
    const onInput = opts.onInput || function () {};
    const onSalvo = opts.onSalvo || function () {};

    host.innerHTML = '<div class="ped-edit-msg">Carregando…</div>';
    let dados;
    try {
      const ano = dataISO.slice(0, 4), mes = String(Number(dataISO.slice(5, 7)));
      dados = await apiFetch('/medicao/' + encodeURIComponent(posto) + '?mes=' + mes + '&ano=' + ano);
    } catch (e) {
      host.innerHTML = '<div class="ped-edit-msg ped-edit-erro">Erro: ' + esc(e && e.message) + '</div>';
      return;
    }
    // TODOS os combustíveis do posto (não só os com pedido>0), p/ dar pra
    // acrescentar um zerado. Nome (combustivel) casa com a medicao; abv = código.
    const grupos = dados.grupos || [];
    const [ano, mes, dia] = dataISO.split('-');
    const alvo = (dados.dias || []).find(d => d.data === (dia + '/' + mes + '/' + ano));
    const ped = alvo ? (alvo.pedido || []) : [];

    const linhasHtml = grupos.map((g, i) => {
      const v = ped[i];
      const disp = (v == null || v === '') ? '' : fmtMilhar(Math.round(Number(v)));
      return '<div class="ped-edit-linha">' +
        '<span class="ped-edit-cod">' + esc(g.abv || g.comb) + '</span>' +
        '<input class="ped-edit-in" inputmode="numeric" data-i="' + i + '" value="' + esc(disp) + '">' +
      '</div>';
    }).join('');

    host.innerHTML =
      '<div class="ped-edit">' +
        '<div class="ped-edit-linhas">' + linhasHtml + '</div>' +
        '<div class="ped-edit-nota">múltiplos de 1.000</div>' +
        '<div class="ped-edit-acoes">' +
          '<button type="button" class="ped-edit-cancelar">Cancelar</button>' +
          '<button type="button" class="ped-edit-salvar">Salvar</button>' +
        '</div>' +
      '</div>';

    // Cliques dentro do editor não borbulham (no card, evitam alternar "montado").
    host.querySelector('.ped-edit').addEventListener('click', e => e.stopPropagation());

    const inputs = [].slice.call(host.querySelectorAll('.ped-edit-in'));
    const totalAgora = () => inputs.reduce((s, inp) => s + (window.parseLitros(inp.value) || 0), 0);
    const emitir = () => onInput(totalAgora());
    inputs.forEach(inp => {
      inp.addEventListener('input', () => { window.mascararVenda(inp); emitir(); });
      inp.addEventListener('blur', () => {                 // múltiplo de 1.000 na saída
        const a = aoMilhar(inp.value);
        inp.value = a ? a.toLocaleString('pt-BR') : '';
        emitir();
      });
    });
    emitir();   // total inicial

    host.querySelector('.ped-edit-cancelar').addEventListener('click', () => onSalvo(false));

    host.querySelector('.ped-edit-salvar').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '⏳ Salvando…';
      // Envia TODOS os combustíveis (0 inclusive: 0 = não pedir / limpa o anterior),
      // cada um arredondado ao milhar. Mesma rota/payload da matriz completa.
      const itens = grupos.map((g, i) => ({
        data: dataISO, campo: 'pedido', combustivel: g.comb, valor: aoMilhar(inputs[i].value),
      }));
      try {
        const r = await apiFetch('/medicao', { method: 'POST', body: JSON.stringify({ posto, itens }) });
        if (!r || r.success === false) throw new Error((r && r.erro) || 'Falha ao salvar');
        // resumo p/ o chamador re-render sem refetch, se quiser (por CÓDIGO).
        const porCod = {}; let total = 0;
        grupos.forEach((g, i) => { const val = aoMilhar(inputs[i].value); if (val > 0) porCod[g.abv || g.comb] = val; total += val; });
        onSalvo(true, null, { total, porCod });
      } catch (err) {
        onSalvo(false, (err && err.message) || 'Erro ao salvar');   // chamador reverte + mostra erro
      }
    });
  }

  window.pedidoEditor = { abrir: abrir };
})();
