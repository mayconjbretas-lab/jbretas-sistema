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
  let _postoAtual  = '';               // nome do posto ('' = Todos os postos)
  let _dados       = null;             // resposta do GET /medicao
  const _dirty     = new Map();        // "data|comb" -> { data, comb, valor }
  let TODOS_POSTOS = [];               // GET /postos (id, nome, bandeira) — fonte do filtro e do posto_id da faixa
  let _postosPront = false;            // /postos já carregado
  let _bandeira    = '';               // bandeira selecionada ('' = todas)
  let _campoFaixa  = 'pedido';         // toggle da faixa: 'pedido' (Logística) | 'pre_pedido' (Meus pedidos)

  // Escapa texto para inserção em HTML (nomes de posto/bandeira nas options e blocos).
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Número pt-BR para a faixa (valor sempre presente: por_combustivel[cod] || 0).
  const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR');

  // A faixa é SEMPRE D+1 (o agendamento só existe para o dia seguinte). Usa Date
  // local (o usuário está no fuso de SP, como o resto do arquivo já assume).
  function amanha() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return { iso: d.getFullYear() + '-' + mm + '-' + dd, dd, mm };
  }

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

  // Soma da Venda de um dia (null-aware): ignora vazios; se nenhum combustível
  // tem valor, devolve null (célula TOTAL fica "—"). Espelha somaVendaDia da
  // matriz da Logística.
  function somaVenda(arr) {
    if (!Array.isArray(arr)) return null;
    let algum = false, soma = 0;
    arr.forEach(v => { if (v !== null && v !== undefined && v !== '') { algum = true; soma += Number(v) || 0; } });
    return algum ? soma : null;
  }

  function difClass(v) {
    if (v === null || v === undefined) return 'cell-vazia';
    return v > 0 ? 'm-dif-pos' : (v < 0 ? 'm-dif-neg' : 'm-dif-zero');
  }
  function difTxt(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + Number(v).toLocaleString('pt-BR');
  }

  // ── Shell da aba (barra + faixa + frame + legenda), montado uma vez ─
  // Selects começam vazios; carregarPostos() (GET /postos) popula bandeira/posto,
  // define o default e dispara a 1ª carga da grade + faixa.
  function montarShell(sec) {
    const h = hojeInfo();
    sec.innerHTML =
      '<div class="med-wrap">' +
        '<div class="med-bar">' +
          '<div class="med-bar-left">' +
            '<span class="med-lbl">Bandeira</span>' +
            '<select class="sel" id="med-bandeira"></select>' +
            '<span class="med-lbl">Posto</span>' +
            '<select class="sel" id="med-posto"></select>' +
            '<span class="med-data" id="med-data">📅 Referência: hoje · ' + h.dd + '/' + h.mm + '/' + h.aaaa + '</span>' +
          '</div>' +
          '<div class="med-bar-right">' +
            '<button class="med-undo" id="med-undo" disabled onclick="__medUndo()">↶ Desfazer</button>' +
            '<button class="med-salvar" id="med-salvar" disabled onclick="__medSalvar()">💾 Salvar pré-pedido</button>' +
          '</div>' +
        '</div>' +
        '<div class="med-fx" id="med-fx"></div>' +
        '<div class="med-frame" id="med-frame">' +
          '<div class="med-msg">Selecione um posto para ver a medição.</div>' +
        '</div>' +
        '<div class="med-legenda">' +
          '<span><span class="dot" style="background:var(--c-med)"></span>Medição</span>' +
          '<span><span class="dot" style="background:var(--c-ven)"></span>Venda</span>' +
          '<span><span class="dot" style="background:var(--c-carga)"></span>Carga</span>' +
          '<span><span class="dot" style="background:var(--c-pre)"></span>Pré-pedido (editável)</span>' +
          '<span><span class="dot" style="background:var(--c-dif)"></span>Diferença</span>' +
        '</div>' +
      '</div>';
    sec.querySelector('#med-bandeira').onchange = onBandeiraChange;
    sec.querySelector('#med-posto').onchange    = onPostoChange;
    _shellPronto = true;
  }

  // ── Filtro encadeado bandeira → posto (GET /postos) ──────────────
  async function carregarPostos() {
    const selP = document.getElementById('med-posto');
    const selB = document.getElementById('med-bandeira');
    try {
      const resp = await apiFetch('/postos');
      TODOS_POSTOS = resp.postos || [];       // já vem com p.bandeira e p.id
      _postosPront = true;
      if (!TODOS_POSTOS.length) { selP.innerHTML = '<option value="">Nenhum posto</option>'; return; }
      // Bandeiras distintas dos postos ATIVOS — casam com o filtro da pedido-dia
      // (postos.bandeira), diferente da taxonomia do MAP_POSTOS.
      const bandeiras = [...new Set(TODOS_POSTOS.map(p => p.bandeira).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      selB.innerHTML = '<option value="">Todas as bandeiras</option>' +
        bandeiras.map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join('');
      selB.value = _bandeira;
      popularSelPosto();
      // Default: 1º posto da lista (abre com a grade carregada; ver histórico da
      // tela — pedido explícito de não abrir em "Selecione…").
      _postoAtual = TODOS_POSTOS[0].nome;
      selP.value = _postoAtual;
      onPostoChange();
    } catch (err) {
      selP.innerHTML = '<option value="">Erro ao carregar</option>';
      const frame = document.getElementById('med-frame');
      if (frame) frame.innerHTML = '<div class="med-erro">Erro ao carregar postos: ' + esc(err.message || err) + '</div>';
    }
  }

  // Popula #med-posto com "Todos os postos" + os postos da bandeira atual
  // (ou todos, se Todas). Sempre volta a seleção para "Todos os postos".
  function popularSelPosto() {
    const sel = document.getElementById('med-posto');
    const lista = _bandeira ? TODOS_POSTOS.filter(p => p.bandeira === _bandeira) : TODOS_POSTOS;
    sel.innerHTML = '<option value="">Todos os postos</option>' +
      lista.map(p => '<option value="' + esc(p.nome) + '">' + esc(p.nome) + '</option>').join('');
    sel.value = '';
    _postoAtual = '';
  }

  // Trocar a bandeira: refiltra os postos e volta pra "Todos os postos".
  function onBandeiraChange() {
    _bandeira = document.getElementById('med-bandeira').value;   // '' = Todas
    popularSelPosto();
    onPostoChange();   // Todos → esconde grade + mensagem; recarrega a faixa (bandeira)
  }

  // Trocar o posto. "Todos os postos" (value '') NÃO carrega a grade: mostra a
  // mensagem — nunca deixa a grade de um posto junto com o total de outra seleção.
  function onPostoChange() {
    _postoAtual = document.getElementById('med-posto').value;
    _dirty.clear();
    atualizarBotoes();
    const frame = document.getElementById('med-frame');
    if (!_postoAtual) {
      frame.innerHTML = '<div class="med-msg">Selecione um posto para ver a medição.</div>';
    } else {
      carregarGrade(_postoAtual);
    }
    atualizarFaixa();
  }

  // ── Carrega os dados de um posto (GET /medicao/:posto, mês atual) ─
  async function carregarGrade(postoNome) {
    const frame = document.getElementById('med-frame');
    frame.innerHTML = '<div class="med-msg">Carregando…</div>';
    try {
      _dados = await apiFetch('/medicao/' + encodeURIComponent(postoNome));
      renderGrade();
    } catch (err) {
      frame.innerHTML = '<div class="med-erro">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    }
  }

  // ── Faixa de PEDIDO do dia seguinte (GET /medicao/pedido-dia) ────
  // Data fixa = D+1 (sem seletor). Escopo (mais específico → menos): posto
  // (posto_id) > bandeira > REDE. campo = toggle Logística/Meus pedidos.
  async function atualizarFaixa() {
    const host = document.getElementById('med-fx');
    if (!host) return;
    const a = amanha();
    let q = '/medicao/pedido-dia?data=' + encodeURIComponent(a.iso) +
            '&campo=' + encodeURIComponent(_campoFaixa);
    if (_postoAtual) {
      const p = TODOS_POSTOS.find(x => x.nome === _postoAtual);
      if (p && p.id) q += '&posto_id=' + encodeURIComponent(p.id);
    } else if (_bandeira) {
      q += '&bandeira=' + encodeURIComponent(_bandeira);
    }
    host.innerHTML = faixaHead(a) + '<div class="med-fx-sub">carregando…</div>';
    try {
      const resp = await apiFetch(q);
      renderFaixa(host, a, resp);
    } catch (err) {
      host.innerHTML = faixaHead(a) +
        '<div class="med-fx-sub" style="color:var(--danger)">Erro: ' + esc(err.message || err) + '</div>';
    }
  }

  // Rótulo fixo "PEDIDO PARA DD/MM" + toggle de dois estados (Logística/Meus pedidos).
  function faixaHead(a) {
    return '<div class="med-fx-head">' +
        '<div class="med-fx-title">PEDIDO PARA ' + a.dd + '/' + a.mm + '</div>' +
        '<div class="med-fx-toggle">' +
          '<button class="med-fx-tgl' + (_campoFaixa === 'pedido' ? ' on' : '') + '" ' +
            'onclick="__medFaixaCampo(\'pedido\')">Logística</button>' +
          '<button class="med-fx-tgl' + (_campoFaixa === 'pre_pedido' ? ' on' : '') + '" ' +
            'onclick="__medFaixaCampo(\'pre_pedido\')">Meus pedidos</button>' +
        '</div>' +
      '</div>';
  }

  // Blocos a partir de resp.combustiveis (o que o escopo vende); valor =
  // por_combustivel[cod] || 0; TOTAL destacado no fim (resp.total).
  function renderFaixa(host, a, resp) {
    const pc    = (resp && resp.por_combustivel) || {};
    const cods  = (resp && resp.combustiveis) || [];
    const total = (resp && resp.total) || 0;
    const n     = (resp && resp.postos_com_pedido) || 0;
    const blocos = cods.map(k => fxBloco(k, pc[k], false)).join('') + fxBloco('TOTAL', total, true);
    host.innerHTML =
      faixaHead(a) +
      '<div class="med-fx-sub">' + n + ' postos com pedido</div>' +
      '<div class="med-fx-grid">' + blocos + '</div>';
  }
  function fxBloco(label, val, isTotal) {
    return '<div class="med-fx-bloco' + (isTotal ? ' med-fx-bloco-total' : '') + '">' +
      '<div class="med-fx-bl-lbl">' + esc(label) + '</div>' +
      '<div class="med-fx-bl-val">' + fmtNum(val) + '</div></div>';   // val ausente → '0'
  }

  window.__medFaixaCampo = function (campo) {
    if (campo !== 'pedido' && campo !== 'pre_pedido') return;
    if (_campoFaixa === campo) return;
    _campoFaixa = campo;
    atualizarFaixa();   // re-consulta com o novo campo e repinta
  };

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
    // Medição de ONTEM (mesmo mês) para a projeção da linha de hoje. No dia 1
    // não existe no array do mês → sem projeção (tratado adiante).
    const diaOntem = d.dias.find(x => x.dia === h.dia - 1) || null;

    // Cabeçalho de 2 linhas (categoria em cima, combustível embaixo). A Venda
    // ganha uma coluna TOTAL extra no fim do grupo.
    let thead = '<tr><th class="sticky-col" rowspan="2">DIA</th>';
    cats.forEach((c, ci) => {
      const nCols = fuels.length + (c.k === 'venda' ? 1 : 0);
      thead += '<th class="' + c.cls + (ci < cats.length - 1 ? ' grp-end' : '') + '" colspan="' + nCols + '">' + c.lbl + '</th>';
    });
    thead += '</tr><tr>';
    cats.forEach((c, ci) => {
      const ehVenda = c.k === 'venda';
      const ultima  = ci === cats.length - 1;
      fuels.forEach((f, fi) => {
        // Na Venda o grp-end vai pro TOTAL (após o loop), não no último combustível.
        const grpEnd = (fi === fuels.length - 1 && !ultima && !ehVenda) ? 'grp-end' : '';
        thead += '<th class="' + grpEnd + '">' + f.abv + '</th>';
      });
      if (ehVenda) thead += '<th class="grp-end">TOTAL</th>';
    });
    thead += '</tr>';

    // Corpo: uma linha por dia, cada dia na SUA PRÓPRIA data (sem deslocamento).
    let body = '';
    d.dias.forEach(dia => {
      const dd = String(dia.dia).padStart(2, '0');
      const ehHoje = dia.dia === h.dia;
      body += '<tr class="' + (ehHoje ? 'row-hoje' : '') + '" id="med-row-' + dd + '">';
      body += '<td class="sticky-col">' + dd + '</td>';
      cats.forEach((c, ci) => {
        const ehVenda = c.k === 'venda';
        const ultima  = ci === cats.length - 1;
        fuels.forEach((f, fi) => {
          const grp = (fi === fuels.length - 1 && !ultima && !ehVenda) ? 'grp-end' : '';
          const val = dia[c.k] ? dia[c.k][f.idx] : null;
          if (c.edit) {
            // Pré-pedido: salva na própria data da linha (data real do dia).
            body += '<td class="cel-pre ' + grp + '">' +
              '<input class="med-in" inputmode="decimal" value="' + (val == null ? '' : fmt(val)) + '" ' +
              'data-data="' + dia.data + '" data-comb="' + f.comb + '" ' +
              'oninput="__medDirty(this)" onfocus="this.select()"></td>';
          } else if (c.k === 'diferenca') {
            body += '<td class="' + grp + '"><span class="' + difClass(val) + ' cell-diff">' + difTxt(val) + '</span></td>';
          } else if (c.k === 'medicao' && ehHoje && val == null) {
            // Projeção do dia de hoje (célula ainda VAZIA — se o gerente já lançou,
            // o valor real manda). Puro DISPLAY: calculado aqui, não guardado nem
            // relido por cálculo nenhum.
            //  • COM pedido:  medicao(ontem) + pedido(hoje) → itálico COM fundo
            //    (--c-med-d): há carga prevista somada.
            //  • SEM pedido:  só medicao(ontem) → cinza itálico SEM fundo: é só o
            //    tanque de ontem (mesmo tratamento da .prev-sem-pedido da Logística).
            //  • SEM medicao(ontem): não mostra nada (não inventa).
            const ontem = diaOntem && diaOntem.medicao ? diaOntem.medicao[f.idx] : null;
            const ped   = dia.pedido ? dia.pedido[f.idx] : null;
            if (ontem == null) {
              body += '<td class="' + grp + '"><span class="cell-vazia">—</span></td>';
            } else if (ped != null) {
              body += '<td class="' + grp + ' med-cel-proj"><span class="med-proj">' + fmt(Number(ontem) + Number(ped)) + '</span></td>';
            } else {
              body += '<td class="' + grp + '"><span class="med-proj-sem-pedido">' + fmt(Number(ontem)) + '</span></td>';
            }
          } else {
            body += '<td class="' + grp + '"><span class="' + (val == null ? 'cell-vazia' : 'cell-val') + '">' + (val == null ? '—' : fmt(val)) + '</span></td>';
          }
        });
        if (ehVenda) {
          const tot = somaVenda(dia.venda);
          body += '<td class="grp-end"><span class="' + (tot == null ? 'cell-vazia' : 'med-vtot') + '">' +
            (tot == null ? '—' : fmt(tot)) + '</span></td>';
        }
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
    if (_postoAtual) carregarGrade(_postoAtual); // recarrega do banco, descarta edições
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
    // 1ª vez (ou seção recriada): monta o shell e carrega os postos (async →
    // popula selects, define default e dispara grade + faixa).
    if (!_shellPronto || !sec.querySelector('#med-posto')) { montarShell(sec); carregarPostos(); return; }
    // Re-entrada: shell e selects persistem no DOM — só repinta o escopo atual.
    onPostoChange();
  };
})();
