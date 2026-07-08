// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/medicao.js
// Aba MEDIÇÃO do Painel ADM (desktop). ADITIVO: expõe
// window.renderMedicao(section), chamado pelo setTab (mesmo padrão
// do renderColetaRevisao da Coleta).
//
// O ADM define o PRÉ-PEDIDO (único campo editável) por posto/dia/
// combustível. Salva via POST /medicao (campo 'pre_pedido'), que
// cai SOMENTE LEITURA na Logística e é gravado no histórico `pedidos`.
// Lê via GET /medicao/:posto (mês atual). NENHUM cálculo muda aqui —
// medição/venda/carga/diferença são só apresentados; a data mostra HOJE.
// ================================================================
(function () {
  let _shellPronto = false;
  let _postoAtual  = null;
  let _dados       = null;             // resposta do GET /medicao
  const _dirty     = new Map();        // "data|comb" -> { data, comb, valor }

  function hojeInfo() {
    const d = new Date();
    return {
      dd:   String(d.getDate()).padStart(2, '0'),
      mm:   String(d.getMonth() + 1).padStart(2, '0'),
      aaaa: d.getFullYear(),
      dia:  d.getDate(),
    };
  }

  const fmt = (n) => (n === null || n === undefined || n === '')
    ? '' : Number(n).toLocaleString('pt-BR');

  // "15.000" (pt-BR) / "15000,5" -> número; vazio -> null
  function parseNum(str) {
    const raw = String(str).replace(/\./g, '').replace(',', '.').trim();
    return raw === '' ? null : Number(raw);
  }

  function difClass(v) {
    if (v === null || v === undefined) return 'cell-vazia';
    return v > 0 ? 'm-dif-pos' : (v < 0 ? 'm-dif-neg' : 'm-dif-zero');
  }
  function difTxt(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + Number(v).toLocaleString('pt-BR');
  }

  // ── Shell da aba (barra + frame + legenda), montado uma vez ──────
  function montarShell(sec) {
    const postos = [...MAP_POSTOS].map(p => p.ap).sort((a, b) => a.localeCompare(b));
    const h = hojeInfo();
    sec.innerHTML =
      '<div class="med-wrap">' +
        '<div class="med-bar">' +
          '<div class="med-bar-left">' +
            '<span class="med-lbl">Posto</span>' +
            '<select class="sel" id="med-posto"></select>' +
            '<span class="med-data" id="med-data">📅 Referência: hoje · ' + h.dd + '/' + h.mm + '/' + h.aaaa + '</span>' +
          '</div>' +
          '<div class="med-bar-right">' +
            '<button class="med-undo" id="med-undo" disabled onclick="__medUndo()">↶ Desfazer</button>' +
            '<button class="med-salvar" id="med-salvar" disabled onclick="__medSalvar()">💾 Salvar pré-pedido</button>' +
          '</div>' +
        '</div>' +
        '<div class="med-frame" id="med-frame">' +
          '<div class="med-msg">Selecione um posto para carregar a medição.</div>' +
        '</div>' +
        '<div class="med-legenda">' +
          '<span><span class="dot" style="background:var(--c-med)"></span>Medição</span>' +
          '<span><span class="dot" style="background:var(--c-ven)"></span>Venda</span>' +
          '<span><span class="dot" style="background:var(--c-carga)"></span>Carga</span>' +
          '<span><span class="dot" style="background:var(--c-pre)"></span>Pré-pedido (editável)</span>' +
          '<span><span class="dot" style="background:var(--c-dif)"></span>Diferença</span>' +
        '</div>' +
      '</div>';
    const sel = sec.querySelector('#med-posto');
    sel.innerHTML = '<option value="">Selecione…</option>' +
      postos.map(p => '<option value="' + p + '">' + p + '</option>').join('');
    sel.onchange = () => carregar(sel.value);
    _shellPronto = true;
  }

  // ── Carrega os dados de um posto (GET /medicao/:posto, mês atual) ─
  async function carregar(postoAp) {
    _postoAtual = postoAp;
    _dirty.clear();
    atualizarBotoes();
    const frame = document.getElementById('med-frame');
    if (!postoAp) { frame.innerHTML = '<div class="med-msg">Selecione um posto para carregar a medição.</div>'; return; }
    frame.innerHTML = '<div class="med-msg">Carregando…</div>';
    try {
      _dados = await apiFetch('/medicao/' + encodeURIComponent(postoAp));
      renderGrade();
    } catch (err) {
      frame.innerHTML = '<div class="med-erro">Erro ao carregar: ' + (err.message || err) + '</div>';
    }
  }

  // ── Monta a grade (mensal, dia a dia) ────────────────────────────
  // Ordem das colunas pedida pelo ADM: Medição · Venda · Carga · Pré-pedido · Diferença.
  function renderGrade() {
    const d = _dados;
    const frame = document.getElementById('med-frame');
    if (!d || !d.grupos || !d.grupos.length) {
      frame.innerHTML = '<div class="med-msg">Sem combustíveis cadastrados para este posto.</div>';
      return;
    }
    const fuels = d.grupos; // [{ comb, abv, idx }] na ordem de combustiveis_posto.ordem
    const cats = [
      { k: 'medicao',   lbl: 'Medição',      cls: 'h-med',   edit: false },
      { k: 'venda',     lbl: 'Venda',        cls: 'h-ven',   edit: false },
      { k: 'carga',     lbl: 'Carga',        cls: 'h-carga', edit: false },
      { k: 'prePedido', lbl: 'Pré-pedido ✎', cls: 'h-pre',   edit: true  },
      { k: 'diferenca', lbl: 'Diferença',    cls: 'h-dif',   edit: false },
    ];
    const h = hojeInfo();

    // Cabeçalho de 2 linhas (categoria em cima, combustível embaixo)
    let thead = '<tr><th class="sticky-col" rowspan="2">DIA</th>';
    cats.forEach((c, ci) => {
      thead += '<th class="' + c.cls + (ci < cats.length - 1 ? ' grp-end' : '') + '" colspan="' + fuels.length + '">' + c.lbl + '</th>';
    });
    thead += '</tr><tr>';
    cats.forEach((c, ci) => {
      fuels.forEach((f, fi) => {
        thead += '<th class="' + ((fi === fuels.length - 1 && ci < cats.length - 1) ? 'grp-end' : '') + '">' + f.abv + '</th>';
      });
    });
    thead += '</tr>';

    // Corpo (uma linha por dia do mês)
    let body = '';
    d.dias.forEach(dia => {
      const ddp = dia.data.split('/')[0];
      const ehHoje = parseInt(ddp, 10) === h.dia;
      body += '<tr class="' + (ehHoje ? 'row-hoje' : '') + '" id="med-row-' + ddp + '">';
      body += '<td class="sticky-col">' + ddp + '</td>';
      cats.forEach((c, ci) => {
        fuels.forEach((f, fi) => {
          const grp = (fi === fuels.length - 1 && ci < cats.length - 1) ? 'grp-end' : '';
          const val = dia[c.k] ? dia[c.k][f.idx] : null;
          if (c.edit) {
            body += '<td class="cel-pre ' + grp + '">' +
              '<input class="med-in" inputmode="decimal" value="' + (val == null ? '' : fmt(val)) + '" ' +
              'data-data="' + dia.data + '" data-comb="' + f.comb + '" ' +
              'oninput="__medDirty(this)" onfocus="this.select()"></td>';
          } else if (c.k === 'diferenca') {
            body += '<td class="' + grp + '"><span class="' + difClass(val) + ' cell-diff">' + difTxt(val) + '</span></td>';
          } else {
            body += '<td class="' + grp + '"><span class="' + (val == null ? 'cell-vazia' : 'cell-val') + '">' + (val == null ? '—' : fmt(val)) + '</span></td>';
          }
        });
      });
      body += '</tr>';
    });

    frame.innerHTML = '<table class="med-table"><thead id="med-thead">' + thead + '</thead><tbody>' + body + '</tbody></table>';

    // Rola até o dia de hoje
    const rowHoje = document.getElementById('med-row-' + h.dd);
    if (rowHoje) rowHoje.scrollIntoView({ block: 'center' });
  }

  // ── Edição / salvamento (só pré-pedido) ──────────────────────────
  window.__medDirty = function (inp) {
    inp.classList.add('med-in-dirty');
    const key = inp.dataset.data + '|' + inp.dataset.comb;
    _dirty.set(key, { data: inp.dataset.data, comb: inp.dataset.comb, valor: parseNum(inp.value) });
    atualizarBotoes();
  };

  window.__medUndo = function () {
    _dirty.clear();
    if (_postoAtual) carregar(_postoAtual); // recarrega do banco, descarta edições
  };

  function atualizarBotoes() {
    const has = _dirty.size > 0;
    const bs = document.getElementById('med-salvar');
    const bu = document.getElementById('med-undo');
    if (bs) bs.disabled = !has;
    if (bu) bu.disabled = !has;
  }

  window.__medSalvar = async function () {
    if (!_dirty.size || !_postoAtual) return;
    const btn = document.getElementById('med-salvar');
    btn.disabled = true;
    const txtOrig = '💾 Salvar pré-pedido';
    btn.textContent = 'Salvando…';
    const itens = [..._dirty.values()].map(e => ({
      data: e.data, combustivel: e.comb, campo: 'pre_pedido', valor: e.valor,
    }));
    try {
      await apiFetch('/medicao', {
        method: 'POST',
        body: JSON.stringify({ posto: _postoAtual, itens }),
      });
      _dirty.clear();
      document.querySelectorAll('.med-in-dirty').forEach(i => i.classList.remove('med-in-dirty'));
      btn.textContent = '✓ Salvo';
      setTimeout(() => { btn.textContent = txtOrig; }, 1500);
      atualizarBotoes();
    } catch (err) {
      btn.textContent = txtOrig;
      atualizarBotoes();
      alert('Erro ao salvar o pré-pedido: ' + (err.message || err));
    }
  };

  // ── Entrada pública (chamada pelo setTab) ────────────────────────
  window.renderMedicao = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('#med-posto')) montarShell(sec);
    const sel = sec.querySelector('#med-posto');
    if (_postoAtual) { sel.value = _postoAtual; carregar(_postoAtual); }
  };
})();
