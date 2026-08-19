// ================================================================
// JBRETAS SISTEMA — shared/js/matriz-medicao.js
// Matriz / Medição Diária (extraída de modulos/logistica/app.js SEM mudar
// comportamento). Self-contained: montar(container) cria thead/tbody/subtitle
// DENTRO do container; não busca #medicao-thead / #matriz-corpo / #matriz-subtitle
// no document. Os botões Salvar/Desfazer chegam via opções (o consumidor é dono).
//
// API pública (padrão do custo-margem.js):
//   window.matrizMedicao = { montar(container, opcoes), carregar(posto),
//                            salvar(), desfazer() }
//   opcoes = { btnSalvar, btnUndo, titulo? }
//
// Os IDs gerados por célula (prev_/diff_/vtot_) continuam via getElementById
// nesta etapa (só existe uma instância por página).
// Depende de: api.js (apiFetch) carregado antes.
// ================================================================
(function () {

  // ── Referências do DOM montado (preenchidas em montar) ──────────
  let _container = null, _thead = null, _tbody = null, _subtitle = null;
  let _btnSalvar = null, _btnUndo = null;

  // ── Estado ──────────────────────────────────────────────────────
  let _postoAtual  = '';       // posto carregado agora (usado no salvar)
  let DADOS_ATUAIS = null;
  // Edições pendentes na matriz, chaveadas por "diaIdx|campo|comb".
  let EDICOES_PENDENTES = {};
  // Valores originais (do load) por "diaIdx|campo|comb" — base pra saber se uma
  // célula ainda difere do que veio do banco (some de EDICOES_PENDENTES se voltar).
  let BASELINE = {};
  // Pilha de undo desta sessão: cada alteração de célula (net, por edição).
  let HISTORICO_UNDO = [];
  // Valor da célula ao ganhar foco (pra registrar o undo no blur).
  let _valorAoFocar = null;

  // Categorias editáveis: Medição/Venda/Carga (2A) + Pedido Final (2B).
  // Pré-pedido continua SOMENTE LEITURA (virá do Painel ADM).
  const EDITAVEIS = ['medicao', 'venda', 'carga', 'pedido'];

  // As 7 categorias da matriz — mesma ordem/semântica do app antigo.
  // classe = cabeçalho colorido (logistica.css); chave = campo vindo do GET.
  const CATEGORIAS_MEDICAO = [
    { chave: 'medicao',   titulo: '🛢️ MEDIÇÃO (L)',                classe: 'h-med'   },
    { chave: 'venda',     titulo: '⛽ VENDA DIÁRIA (L)',            classe: 'h-ven'   },
    { chave: 'diferenca', titulo: 'Δ DIFERENÇA (Real − Prev)',      classe: 'h-dif'   },
    { chave: 'carga',     titulo: '🚚 CARGA RECEBIDA (L)',          classe: 'h-carga' },
    { chave: 'previsao',  titulo: '📐 PREVISÃO MED. (L)',           classe: 'h-prev'  },
    { chave: 'prePedido', titulo: '📦 PRÉ-PEDIDO (LOGÍSTICA) (L)',  classe: 'h-pre'   },
    { chave: 'pedido',    titulo: '📋 PEDIDO FINAL (APROVADO) (L)', classe: 'h-ped'   },
  ];

  // Venda usa combustiveisVenda; as demais categorias usam grupos.
  function colunasDaCategoria(chave, grupos, combustiveisVenda) {
    return chave === 'venda' ? combustiveisVenda : grupos;
  }

  // ── Helpers de formatação ───────────────────────────────────────
  function fmtL(v) {
    if (v === null || v === undefined || v === '') return '—';
    return Math.round(Number(v)).toLocaleString('pt-BR');
  }

  // Parse BR de litros p/ inputs editáveis: se tem vírgula, ela é o decimal e
  // pontos são milhar; se só tem ponto, o ponto é o decimal (mesmo padrão do
  // cmpParsePreco da matriz, sem dividir por 100). Retorna Number ou null.
  function parseLitros(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const limpo = norm.replace(/[^0-9.]/g, '');
    if (!limpo) return null;
    const n = parseFloat(limpo);
    return isNaN(n) ? null : n;
  }

  // Formata litros p/ EDIÇÃO: vírgula decimal, SEM separador de milhar (ponto
  // como milhar seria ambíguo com o decimal). Ex.: 3540.1 → "3540,1".
  function fmtLitrosEdit(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (isNaN(n)) return '';
    return n.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 3 });
  }

  // ── Matriz — carga (GET /medicao/:posto) ────────────────────────
  async function carregarMatriz(posto) {
    if (!_tbody) return;            // montar() ainda não chamado
    _postoAtual = posto;
    _subtitle.innerHTML = '• Carregando ' + posto + '...';
    _thead.innerHTML = '';
    _tbody.innerHTML =
      '<tr><td style="padding:2rem;color:var(--text3);text-align:center;">Conectando ao servidor…</td></tr>';
    EDICOES_PENDENTES = {};
    BASELINE = {};
    HISTORICO_UNDO = [];
    atualizarBotoesSalvar();
    atualizarBotaoUndo();
    try {
      const dados = await apiFetch('/medicao/' + encodeURIComponent(posto));
      DADOS_ATUAIS = dados;
      _subtitle.innerHTML = '• ' + dados.posto + ' — ' + dados.mes + '/' + dados.ano;
      montarCabecalhoMedicao(dados.grupos, dados.combustiveisVenda);
      montarLinhasMedicao(dados);
      requestAnimationFrame(ajustarSticky);
    } catch (err) {
      _subtitle.innerHTML = '• <span style="color:var(--danger)">Falha ao conectar</span>';
      _tbody.innerHTML =
        '<tr><td class="matriz-erro">⚠ ' + err.message + '</td></tr>';
    }
  }

  // Cabeçalho de 2 linhas: categorias (colspan) + combustíveis por categoria.
  function montarCabecalhoMedicao(grupos, combustiveisVenda) {
    let row1 = '<tr><th rowspan="2" class="sticky-col">DIA</th>';
    CATEGORIAS_MEDICAO.forEach((cat, ci) => {
      let n = colunasDaCategoria(cat.chave, grupos, combustiveisVenda).length;
      if (cat.chave === 'venda') n += 1; // + coluna TOTAL
      const grpEnd = (ci < CATEGORIAS_MEDICAO.length - 1) ? ' grp-end' : '';
      row1 += '<th colspan="' + n + '" class="' + cat.classe + grpEnd + '">' + cat.titulo + '</th>';
    });
    row1 += '</tr>';
    let row2 = '<tr>';
    CATEGORIAS_MEDICAO.forEach(cat => {
      const cols = colunasDaCategoria(cat.chave, grupos, combustiveisVenda);
      const ehVenda = cat.chave === 'venda';
      cols.forEach((g, gi) => {
        // na Venda o grp-end vai pro TOTAL (última coluna do grupo)
        const grpEnd = (gi === cols.length - 1 && !ehVenda) ? ' class="grp-end"' : '';
        row2 += '<th' + grpEnd + '>' + g.abv + '</th>';
      });
      if (ehVenda) row2 += '<th class="grp-end col-total-venda">TOTAL</th>';
    });
    row2 += '</tr>';
    _thead.innerHTML = row1 + row2;
  }

  // Uma linha por dia; cada categoria com uma célula por combustível.
  function montarLinhasMedicao(dados) {
    const grupos    = dados.grupos;
    const vendaCols = dados.combustiveisVenda;
    let html = '';
    dados.dias.forEach((d, diaIdx) => {
      html += '<tr><td class="sticky-col">' +
        String(d.dia).padStart(2, '0') + '/' + dados.mes + '</td>';
      CATEGORIAS_MEDICAO.forEach(cat => {
        const cols    = colunasDaCategoria(cat.chave, grupos, vendaCols);
        const valores = d[cat.chave] || [];
        const ehVenda = cat.chave === 'venda';
        cols.forEach((col, i) => {
          const val    = valores[i];
          // na Venda o grp-end vai pro TOTAL (adicionado após este loop)
          const grpEnd = (i === cols.length - 1 && !ehVenda) ? ' grp-end' : '';
          if (cat.chave === 'previsao') {
            // Preenchido por recalcularPrevisaoEDiff após montar as linhas.
            html += '<td class="' + grpEnd + '"><span class="cell-val" id="prev_' + diaIdx + '_' + i + '">—</span></td>';
          } else if (cat.chave === 'diferenca') {
            html += '<td class="' + grpEnd + '"><span class="cell-val cell-diff" id="diff_' + diaIdx + '_' + i + '">—</span></td>';
          } else if (EDITAVEIS.includes(cat.chave)) {
            // Célula editável (Medição/Venda/Carga/Pedido) — mesmo padrão do app antigo.
            BASELINE[diaIdx + '|' + cat.chave + '|' + col.comb] = (val === undefined ? null : val);
            const combAttr = String(col.comb).replace(/"/g, '&quot;');
            html += '<td class="' + grpEnd + '"><input type="text" inputmode="numeric" class="cell-in"' +
              ' data-dia="' + diaIdx + '" data-campo="' + cat.chave + '" data-comb="' + combAttr + '"' +
              ' value="' + fmtLitrosEdit(val) + '"' +
              ' onfocus="onCelulaFocus(this)" oninput="onCelulaDigito(this)"' +
              ' onkeydown="onCelulaTecla(event,this)" onblur="onCelulaBlur(this)"></td>';
          } else {
            // Pré-pedido — SOMENTE LEITURA (preenchido pelo Painel ADM, não aqui).
            const vazia = (val === null || val === undefined || val === '') ? ' cell-vazia' : '';
            html += '<td class="' + grpEnd + ' td-ro" title="Somente leitura — definido no Painel ADM">' +
              '<span class="cell-val cell-ro' + vazia + '">' + fmtL(val) + '</span></td>';
          }
        });
        if (ehVenda) {
          const totalVenda = somaVendaDia(valores);
          const vaziaT = (totalVenda === null) ? ' cell-vazia' : '';
          html += '<td class="grp-end"><span class="cell-val cell-total-venda' + vaziaT + '" id="vtot_' + diaIdx + '">' +
            (totalVenda === null ? '—' : fmtL(totalVenda)) + '</span></td>';
        }
      });
      html += '</tr>';
    });
    _tbody.innerHTML = html ||
      '<tr><td style="padding:1.5rem;color:var(--text3);">Sem dados.</td></tr>';
    // Calcula Previsão + Diferença de todos os dias e colore a Carga vs Pedido.
    dados.dias.forEach((_, diaIdx) => { recalcularPrevisaoEDiff(diaIdx); _recolorirCarga(diaIdx); });
  }

  // "Tem valor" para as fórmulas: null/undefined/'' contam como vazio.
  function temValor(v) { return v !== null && v !== undefined && v !== ''; }

  // PREVISÃO MED.:
  //  • COM pedido:  medição(ontem) + pedido(hoje)   → estilo normal
  //  • SEM pedido:  só medição(ontem)               → cinza + itálico (semPedido)
  //  • SEM medição de ontem: travessão              → valor null
  // `pedido` é a coluna medicao.pedido (Pedido Final). Devolve { valor, semPedido }.
  function _prevCelula(diaIdx, i) {
    const dias = DADOS_ATUAIS.dias;
    const diaOntem   = dias[diaIdx - 1];
    const medOntem   = diaOntem ? diaOntem.medicao[i] : null;
    const pedidoHoje = dias[diaIdx].pedido ? dias[diaIdx].pedido[i] : null;
    if (!temValor(medOntem))   return { valor: null, semPedido: false };
    if (!temValor(pedidoHoje)) return { valor: Number(medOntem), semPedido: true };
    return { valor: Number(medOntem) + Number(pedidoHoje), semPedido: false };
  }

  // Δ DIFERENÇA = medição(hoje) − [ medição(ontem) + carga(hoje) − venda(hoje) ].
  // Calcula SOZINHA (não lê a coluna Previsão). Venda usa combustiveisVenda; as
  // demais categorias usam grupos.
  //   Obrigatórias: SÓ medição(hoje) e medição(ontem) — sem uma delas, vazia.
  //   carga/venda AUSENTES contam como 0: dia sem descarga é normal e a conta
  //   "o tanque só perdeu o que vendeu" continua válida — é justamente ela que
  //   denuncia carga que não desceu (ex.: o +67 do P. ARAPONGA 09/AGO).
  function _diffCelula(diaIdx, i) {
    const dias = DADOS_ATUAIS.dias;
    const dia  = dias[diaIdx];
    const diaOntem = dias[diaIdx - 1];
    const g = DADOS_ATUAIS.grupos[i];
    const medHoje  = dia.medicao[i];
    const medOntem = diaOntem ? diaOntem.medicao[i] : null;
    if (!temValor(medHoje) || !temValor(medOntem)) return null;
    const carga    = temValor(dia.carga[i]) ? Number(dia.carga[i]) : 0;
    const idxVenda = DADOS_ATUAIS.combustiveisVenda.findIndex(c => c.comb === g.comb);
    const venda    = (idxVenda !== -1 && temValor(dia.venda[idxVenda])) ? Number(dia.venda[idxVenda]) : 0;
    return Number(medHoje) - (Number(medOntem) + carga - venda);
  }

  // Pinta a Previsão. Normal (com pedido); cinza+itálico via .prev-sem-pedido
  // quando é só a medição de ontem (sem pedido); travessão + cell-vazia se null.
  function _pintarPrev(diaIdx, i, prevVal, semPedido) {
    const el = document.getElementById('prev_' + diaIdx + '_' + i);
    if (!el) return;
    el.textContent = fmtL(prevVal);
    el.classList.toggle('cell-vazia', prevVal === null);
    el.classList.toggle('prev-sem-pedido', !!semPedido && prevVal !== null);
  }

  // Pinta a Diferença (verde/vermelho/cinza + sinal).
  function _pintarDiff(diaIdx, i, diffVal) {
    const el = document.getElementById('diff_' + diaIdx + '_' + i);
    if (!el) return;
    const cor = diffVal > 0 ? 'var(--ok)' : (diffVal < 0 ? 'var(--danger)' : 'var(--text3)');
    el.style.color = cor;
    el.textContent = (diffVal === null ? '—' : ((diffVal > 0 ? '+' : '') + fmtL(diffVal)));
  }

  // Recalcula Previsão + Diferença de um dia (todas as colunas de combustível).
  function recalcularPrevisaoEDiff(diaIdx) {
    if (!DADOS_ATUAIS) return;
    const dia = DADOS_ATUAIS.dias[diaIdx];
    if (!dia) return;
    DADOS_ATUAIS.grupos.forEach((g, i) => {
      const prev = _prevCelula(diaIdx, i);
      dia.previsao[i] = prev.valor;
      const diffVal = _diffCelula(diaIdx, i);
      dia.diferenca[i] = diffVal;
      _pintarPrev(diaIdx, i, prev.valor, prev.semPedido);
      _pintarDiff(diaIdx, i, diffVal);
    });
  }

  // Soma das vendas do dia (todas as colunas). null se o dia não tem NENHUMA venda.
  function somaVendaDia(vendaArr) {
    if (!Array.isArray(vendaArr)) return null;
    let algum = false, soma = 0;
    vendaArr.forEach(v => {
      if (v !== null && v !== undefined && v !== '') { algum = true; soma += Number(v) || 0; }
    });
    return algum ? soma : null;
  }

  // Atualiza (ao vivo) a coluna TOTAL do grupo Venda de um dia.
  function recalcularTotalVenda(diaIdx) {
    if (!DADOS_ATUAIS) return;
    const dia = DADOS_ATUAIS.dias[diaIdx];
    if (!dia) return;
    const total = somaVendaDia(dia.venda);
    const el = document.getElementById('vtot_' + diaIdx);
    if (el) {
      el.textContent = (total === null ? '—' : fmtL(total));
      el.classList.toggle('cell-vazia', total === null);
    }
  }

  // Atualiza só a DIFERENÇA de um dia. Agora ela calcula sozinha (_diffCelula),
  // sem depender do que está na coluna Previsão.
  function _atualizarDiffDia(diaIdx) {
    if (!DADOS_ATUAIS) return;
    const dia = DADOS_ATUAIS.dias[diaIdx];
    if (!dia) return;
    DADOS_ATUAIS.grupos.forEach((g, i) => {
      const diffVal = _diffCelula(diaIdx, i);
      dia.diferenca[i] = diffVal;
      _pintarDiff(diaIdx, i, diffVal);
    });
  }

  // Colore o TEXTO da célula de CARGA quando ela diverge do PEDIDO do mesmo
  // dia+combustível além da tolerância. Só quando AMBOS existem (falta um → normal).
  // Texto, não fundo — o fundo é da zebra/linha ativa. Aplicado inline (vence a
  // cor da classe .cell-dirty): carga < pedido−500 = vermelho (chegou menos);
  // carga > pedido+500 = âmbar (chegou mais); dentro da tolerância = neutro.
  const TOLERANCIA_CARGA = 500;
  function _recolorirCarga(diaIdx) {
    if (!DADOS_ATUAIS) return;
    const dia = DADOS_ATUAIS.dias[diaIdx];
    if (!dia) return;
    DADOS_ATUAIS.grupos.forEach((g, i) => {
      const input = _acharInput(diaIdx, 'carga', g.comb);
      if (!input) return;
      const carga  = dia.carga[i];
      const pedido = dia.pedido ? dia.pedido[i] : null;
      let cor = '';
      if (temValor(carga) && temValor(pedido)) {
        const diff = Number(carga) - Number(pedido);
        if (diff < -TOLERANCIA_CARGA) cor = 'var(--danger)';
        else if (diff > TOLERANCIA_CARGA) cor = 'var(--warning)';
      }
      input.style.color = cor;
    });
  }

  // ── Edição de célula (Medição/Venda/Carga) — portado de Logistica-JBretas ──
  function onCelulaFocus(input) {
    _tbody.querySelectorAll('tr.linha-ativa').forEach(tr => tr.classList.remove('linha-ativa'));
    input.closest('tr').classList.add('linha-ativa');
    // Guarda o valor de modelo antes de editar (pra montar a entrada de undo no blur).
    _valorAoFocar = _valorCelula(input);
    // Zero chato: se está 0/vazio, limpa pra digitar direto; senão o select()
    // abaixo marca tudo pra sobrescrever.
    const n = parseLitros(input.value);
    if (n === null || n === 0) input.value = '';
    requestAnimationFrame(() => input.select());
  }

  // Lê o valor atual de modelo da célula de um input.
  function _valorCelula(input) {
    const diaIdx = parseInt(input.dataset.dia);
    const campo  = input.dataset.campo;
    const comb   = input.dataset.comb;
    const cols   = campo === 'venda' ? DADOS_ATUAIS.combustiveisVenda : DADOS_ATUAIS.grupos;
    const idx    = cols.findIndex(c => c.comb === comb);
    return idx === -1 ? null : DADOS_ATUAIS.dias[diaIdx][campo][idx];
  }

  function onCelulaDigito(input) {
    // Não reformata durante a digitação (a máscara de milhar comia a vírgula).
    // Só interpreta o valor e salva; a normalização visual acontece no blur.
    const num = parseLitros(input.value);
    _salvarCelula(input, (num && num > 0) ? num : null);
  }

  function onCelulaTecla(e, input) {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.ctrlKey) {
      e.preventDefault();
      const passo = e.shiftKey ? 100 : (e.altKey ? 10 : 1000);
      const delta = e.key === 'ArrowUp' ? passo : -passo;
      const atual = parseLitros(input.value) || 0;
      const novo  = Math.max(0, atual + delta);
      input.value = novo === 0 ? '' : fmtLitrosEdit(novo);
      _salvarCelula(input, novo === 0 ? null : novo);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); input.value = '0'; _salvarCelula(input, null); return; }
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); _moverCelula(input, +1, 0); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _moverCelula(input, -1, 0); return; }
    if (e.key === 'Tab') { e.preventDefault(); _moverCelula(input, 0, e.shiftKey ? -1 : +1); return; }
  }

  function _moverCelula(input, deltaDia, deltaCampo) {
    const diaAtual   = parseInt(input.dataset.dia);
    const combAtual  = input.dataset.comb;
    const campoAtual = input.dataset.campo;
    const todas = Array.from(_tbody.querySelectorAll('.cell-in'));
    const idx = todas.indexOf(input);
    let proximo = null;
    if (deltaDia !== 0 && deltaCampo === 0) {
      const alvo = diaAtual + deltaDia;
      proximo = todas.find(el =>
        parseInt(el.dataset.dia) === alvo &&
        el.dataset.campo === campoAtual &&
        el.dataset.comb === combAtual);
    } else {
      const novoIdx = idx + deltaCampo;
      if (novoIdx >= 0 && novoIdx < todas.length) proximo = todas[novoIdx];
    }
    if (proximo) { proximo.focus(); proximo.select(); }
  }

  function onCelulaBlur(input) {
    const num = parseLitros(input.value);
    const valorNovo = (num && num > 0) ? num : null;
    input.value = valorNovo === null ? '' : fmtLitrosEdit(valorNovo);
    _salvarCelula(input, valorNovo);
    // Registra o net da edição desta célula na pilha de undo (só se mudou).
    if (_valorAoFocar !== valorNovo) {
      HISTORICO_UNDO.push({
        dia:           parseInt(input.dataset.dia),
        data:          DADOS_ATUAIS.dias[parseInt(input.dataset.dia)].data,
        campo:         input.dataset.campo,
        combustivel:   input.dataset.comb,
        valorAnterior: _valorAoFocar,
        valorNovo:     valorNovo,
      });
      atualizarBotaoUndo();
    }
    _valorAoFocar = null;
  }

  // Grava a edição no estado + EDICOES_PENDENTES e recalcula os dias afetados.
  function _salvarCelula(input, valor) {
    if (!DADOS_ATUAIS) return;
    const diaIdx = parseInt(input.dataset.dia);
    const campo  = input.dataset.campo;
    const comb   = input.dataset.comb;
    const cols = campo === 'venda' ? DADOS_ATUAIS.combustiveisVenda : DADOS_ATUAIS.grupos;
    const idx = cols.findIndex(c => c.comb === comb);
    if (idx === -1) return;
    DADOS_ATUAIS.dias[diaIdx][campo][idx] = valor;

    // Pendente só enquanto difere do valor carregado (voltar ao original limpa a pendência).
    const key = diaIdx + '|' + campo + '|' + comb;
    if (valor === BASELINE[key]) {
      delete EDICOES_PENDENTES[key];
      input.classList.remove('cell-dirty');
    } else {
      EDICOES_PENDENTES[key] = { dia: diaIdx, campo, comb, valor };
      input.classList.add('cell-dirty');
    }

    _recalcAfeta(diaIdx, campo);
    atualizarBotoesSalvar();
  }

  // Recalcula Previsão/Diferença dos dias afetados por uma mudança em (dia, campo),
  // segundo as fórmulas novas:
  //   previsão[d]  = med[d-1] + pedido[d]
  //   diferença[d] = med[d] − (med[d-1] + carga[d] − venda[d])
  function _recalcAfeta(diaIdx, campo) {
    if (campo === 'medicao') {
      // med[d] entra na diferença de HOJE e, como med(ontem), na previsão E na
      // diferença de AMANHÃ.
      _atualizarDiffDia(diaIdx);
      recalcularPrevisaoEDiff(diaIdx + 1);
    } else if (campo === 'carga') {
      _atualizarDiffDia(diaIdx);            // carga[d] só entra na diferença de hoje
      _recolorirCarga(diaIdx);              // carga mudou → recolore vs pedido do dia
    } else if (campo === 'venda') {
      _atualizarDiffDia(diaIdx);            // venda[d] só entra na diferença de hoje
      recalcularTotalVenda(diaIdx);
    } else if (campo === 'pedido') {
      recalcularPrevisaoEDiff(diaIdx);      // pedido[d] agora entra na PREVISÃO de hoje
      _recolorirCarga(diaIdx);              // pedido é a referência da carga → recolore
    }
  }

  // Acha o input de uma célula (data-comb pode ter espaços/aspas — busca iterando).
  function _acharInput(diaIdx, campo, comb) {
    return Array.from(_tbody.querySelectorAll('.cell-in')).find(el =>
      parseInt(el.dataset.dia) === diaIdx && el.dataset.campo === campo && el.dataset.comb === comb) || null;
  }

  // Desfaz a última alteração da sessão (LIFO), até esgotar a pilha (estado do load).
  function desfazerUltima() {
    const ult = HISTORICO_UNDO.pop();
    if (!ult) { atualizarBotaoUndo(); return; }
    const { dia, campo, combustivel, valorAnterior } = ult;
    const input = _acharInput(dia, campo, combustivel);
    if (input) {
      input.value = (valorAnterior === null || valorAnterior === undefined) ? '' : Number(valorAnterior).toLocaleString('pt-BR');
      _salvarCelula(input, valorAnterior);  // restaura modelo, ajusta pendência e recalcula
    }
    atualizarBotaoUndo();
  }

  function atualizarBotaoUndo() {
    if (_btnUndo) _btnUndo.disabled = HISTORICO_UNDO.length === 0;
  }

  function limparDestaqueEdicoes() {
    _tbody.querySelectorAll('.cell-in.cell-dirty').forEach(el => el.classList.remove('cell-dirty'));
  }

  // Botão "Salvar Alterações" com contagem de pendências.
  function atualizarBotoesSalvar() {
    if (!_btnSalvar) return;
    const qtd = Object.keys(EDICOES_PENDENTES).length;
    _btnSalvar.disabled = qtd === 0;
    _btnSalvar.textContent = '💾 Salvar Alterações' + (qtd ? ' (' + qtd + ')' : '');
  }

  // POST /medicao — só Supabase (sem dual-write Apps Script). Upsert por posto_id,data,combustivel.
  async function salvarAlteracoesMatriz() {
    const btn = _btnSalvar;
    const itens = Object.values(EDICOES_PENDENTES).map(e => ({
      data:        DADOS_ATUAIS.dias[e.dia].data,
      campo:       e.campo,
      combustivel: e.comb,
      valor:       e.valor,
    }));
    if (!itens.length || !_postoAtual) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
    try {
      const resp = await apiFetch('/medicao', {
        method: 'POST',
        body: JSON.stringify({ posto: _postoAtual, itens }),
      });
      if (!resp.success) throw new Error(resp.erro || 'Erro ao salvar');
      // O estado salvo vira o novo "carregado": funde no BASELINE e zera undo.
      Object.values(EDICOES_PENDENTES).forEach(e => {
        BASELINE[e.dia + '|' + e.campo + '|' + e.comb] = e.valor;
      });
      EDICOES_PENDENTES = {};
      HISTORICO_UNDO = [];
      limparDestaqueEdicoes();
      atualizarBotaoUndo();
      if (btn) btn.textContent = '✓ Salvo!';
      setTimeout(atualizarBotoesSalvar, 1800);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = '⚠ Erro ao salvar'; }
      mostrarErroMatriz('Erro ao salvar: ' + err.message);
      setTimeout(atualizarBotoesSalvar, 2500);
    }
  }

  function mostrarErroMatriz(msg) {
    if (_subtitle) _subtitle.innerHTML = '• <span style="color:var(--danger)">' + msg + '</span>';
  }

  // Ajusta o offset da 2ª linha sticky do cabeçalho conforme a altura REAL da 1ª.
  // Mede a <tr> (não o th DIA, que tem rowspan=2 e abrange as duas linhas) e usa
  // getBoundingClientRect().height p/ pegar o fracionário (ex.: 32,5px) — offsetHeight
  // arredondaria. Grava em :root; o CSS lê via var(--thead-row1-h) no top da 2ª linha.
  function ajustarSticky() {
    const linha1 = _thead && _thead.querySelector('tr:first-child');
    if (linha1) {
      document.documentElement.style.setProperty(
        '--thead-row1-h', linha1.getBoundingClientRect().height + 'px');
    }
  }

  // ── Montagem: cria a estrutura DENTRO do container ──────────────
  function montar(container, opcoes) {
    opcoes = opcoes || {};
    if (!container) return;
    _container = container;
    _btnSalvar = opcoes.btnSalvar || null;
    _btnUndo   = opcoes.btnUndo   || null;
    const titulo = opcoes.titulo || 'Matriz Integrada de Suprimentos';
    container.innerHTML =
      '<div class="table-actions">' +
        '<div class="table-title">' + titulo +
          ' <span class="mm-subtitle">• Carregando posto...</span></div>' +
        '<div class="mm-actions" style="display:flex;align-items:center;gap:1rem;">' +
          '<div class="scroll-indicator">↔ Scroll horizontal para ver tudo</div>' +
        '</div>' +
      '</div>' +
      '<div class="spreadsheet-frame">' +
        '<table class="ss-table">' +
          '<thead class="mm-thead"></thead>' +
          '<tbody class="mm-tbody">' +
            '<tr><td style="padding:2rem;color:var(--text3);text-align:center;">Selecione um posto…</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>';
    _subtitle = container.querySelector('.mm-subtitle');
    _thead    = container.querySelector('.mm-thead');
    _tbody    = container.querySelector('.mm-tbody');
    // O consumidor é dono dos botões; a matriz só controla o estado deles.
    // Se ele JÁ os posicionou (ex.: barra fixa do mobile — o botão já tem
    // parentNode), não realoca; senão (desktop, botões recém-criados sem pai),
    // coloca-os na barra de ações da própria matriz.
    const actions = container.querySelector('.mm-actions');
    if (actions && _btnUndo   && !_btnUndo.parentNode)   actions.appendChild(_btnUndo);
    if (actions && _btnSalvar && !_btnSalvar.parentNode) actions.appendChild(_btnSalvar);
    atualizarBotoesSalvar();
    atualizarBotaoUndo();
    ligarEixoUnico(container.querySelector('.spreadsheet-frame'));
  }

  // Scroll de UM eixo só no toque (mobile): decide o eixo pelo 1º movimento
  // acima do limiar e move só ESSE eixo até o dedo sair — o fling diagonal
  // deixa de arrastar os dois. O frame tem touch-action:none (CSS), então o JS
  // é dono do gesto (sem corrida com o pan nativo) e escreve scrollLeft/scrollTop
  // — o sticky (thead + coluna DIA) reage ao offset normalmente. Tap sem
  // movimento não sofre preventDefault → foco/edição de célula seguem funcionando.
  function ligarEixoUnico(frame) {
    if (!frame || frame._eixoLigado) return;   // idempotente (montar roda 1x, mas guarda)
    frame._eixoLigado = true;
    const LIMIAR = 6;   // px até decidir o eixo
    let x0 = 0, y0 = 0, sl0 = 0, st0 = 0, eixo = null, ativo = false;

    frame.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { ativo = false; return; }   // multitoque (zoom): não interfere
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY;
      sl0 = frame.scrollLeft; st0 = frame.scrollTop;
      eixo = null; ativo = true;
    }, { passive: true });

    frame.addEventListener('touchmove', function (e) {
      if (!ativo || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (!eixo) {
        if (Math.abs(dx) < LIMIAR && Math.abs(dy) < LIMIAR) return;   // ainda não decide
        eixo = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
      if (eixo === 'x') frame.scrollLeft = sl0 - dx;   // horizontal → trava vertical
      else              frame.scrollTop  = st0 - dy;   // vertical → trava horizontal
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    const soltar = function () { ativo = false; eixo = null; };
    frame.addEventListener('touchend', soltar, { passive: true });
    frame.addEventListener('touchcancel', soltar, { passive: true });
  }

  // ── Exposição ───────────────────────────────────────────────────
  // Handlers de célula: as células usam handlers inline (onfocus/oninput/...),
  // então precisam ser globais (o markup é preservado verbatim).
  window.onCelulaFocus  = onCelulaFocus;
  window.onCelulaDigito = onCelulaDigito;
  window.onCelulaTecla  = onCelulaTecla;
  window.onCelulaBlur   = onCelulaBlur;

  // Recalcula --thead-row1-h ao redimensionar. Registrado UMA vez aqui (nível do
  // módulo, fora do montar), então trocar de posto/remontar não acumula listeners.
  // O rAF evita recalcular em excesso durante o arraste; o guard de ajustarSticky
  // (_thead nulo) cobre disparos antes de qualquer montar().
  window.addEventListener('resize', function () { requestAnimationFrame(ajustarSticky); });

  // Fontes (JetBrains Mono/Sora) carregam async e mudam a altura da linha depois
  // do 1º render. Recalcula quando prontas (também registrado uma única vez).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(ajustarSticky);
  }

  // API pública (padrão do custo-margem.js).
  window.matrizMedicao = {
    montar:   montar,
    carregar: carregarMatriz,
    salvar:   salvarAlteracoesMatriz,
    desfazer: desfazerUltima,
    TOLERANCIA_CARGA: TOLERANCIA_CARGA,   // exposto p/ reuso (ex.: painel Pedido Final dos FABs)
  };
})();
