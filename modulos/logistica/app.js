// ================================================================
// JBRETAS SISTEMA — modulos/logistica/app.js
// Passo 0: shell (sessão, seletor de posto, navegação de abas).
// Passo 1: Matriz / Medição Diária lendo GET /medicao/:posto
//          (read-only — sem edição ainda).
// Depende de: config.js, api.js, auth.js (carregados antes).
// ================================================================

// ── Proteção de rota ────────────────────────────────────────────
const USUARIO = exigirSessao(['LOGISTICA', 'ADM']);

// ── Estado global ───────────────────────────────────────────────
let DADOS_ATUAIS = null;
let POSTO_ATUAL  = '';
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
  { chave: 'carga',     titulo: '🚚 CARGA RECEBIDA (L)',          classe: 'h-carga' },
  { chave: 'diferenca', titulo: 'Δ DIFERENÇA (Real − Prev)',      classe: 'h-dif'   },
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

// ── Topbar ──────────────────────────────────────────────────────
function preencherTopbar() {
  if (!USUARIO) return;
  const nome = USUARIO.nome || USUARIO.email || '—';
  document.getElementById('app-usuario').textContent = nome;
  document.getElementById('app-perfil').textContent  = USUARIO.perfil || '—';
  document.getElementById('app-avatar').textContent   =
    nome.trim().slice(0, 2).toUpperCase();
}

// ── Navegação de abas ───────────────────────────────────────────
function switchMainTab(tabId, el) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  if (el) el.classList.add('active');
}

// ── Seletor de posto (GET /postos) ──────────────────────────────
async function carregarPostos() {
  const sel = document.getElementById('sel-posto');
  try {
    const resp = await apiFetch('/postos');
    const postos = resp.postos || [];
    if (!postos.length) {
      sel.innerHTML = '<option value="">Nenhum posto</option>';
      return;
    }
    sel.innerHTML = postos
      .map(p => `<option value="${p.nome}">${p.nome}</option>`)
      .join('');
    POSTO_ATUAL = postos[0].nome;
    sel.value = POSTO_ATUAL;
    carregarMatriz(POSTO_ATUAL);
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarErroMatriz('Erro ao carregar postos: ' + err.message);
  }
}

function onPostoChange() {
  POSTO_ATUAL = document.getElementById('sel-posto').value;
  if (POSTO_ATUAL) carregarMatriz(POSTO_ATUAL);
}

// Botão ↻ — rechama o posto atual.
function atualizarMatriz() {
  if (POSTO_ATUAL) carregarMatriz(POSTO_ATUAL);
}

// ── Tema claro/escuro (mesma chave jb_theme dos outros módulos) ──
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = tema === 'light' ? '☀️' : '🌙';
  localStorage.setItem('jb_theme', tema);
}
function toggleTheme() {
  const atual = document.documentElement.getAttribute('data-theme') || 'dark';
  aplicarTema(atual === 'dark' ? 'light' : 'dark');
}

// ── Matriz (Passo 1 — read-only) ────────────────────────────────
async function carregarMatriz(posto) {
  const subtitle = document.getElementById('matriz-subtitle');
  const tbody    = document.getElementById('matriz-corpo');
  const thead    = document.getElementById('medicao-thead');
  subtitle.innerHTML = '• Carregando ' + posto + '...';
  thead.innerHTML = '';
  tbody.innerHTML =
    '<tr><td style="padding:2rem;color:var(--text3);text-align:center;">Conectando ao servidor…</td></tr>';
  EDICOES_PENDENTES = {};
  BASELINE = {};
  HISTORICO_UNDO = [];
  atualizarBotoesSalvar();
  atualizarBotaoUndo();
  try {
    const dados = await apiFetch('/medicao/' + encodeURIComponent(posto));
    DADOS_ATUAIS = dados;
    subtitle.innerHTML = '• ' + dados.posto + ' — ' + dados.mes + '/' + dados.ano;
    montarCabecalhoMedicao(dados.grupos, dados.combustiveisVenda);
    montarLinhasMedicao(dados);
    requestAnimationFrame(ajustarSticky);
  } catch (err) {
    subtitle.innerHTML = '• <span style="color:var(--danger)">Falha ao conectar</span>';
    tbody.innerHTML =
      '<tr><td class="matriz-erro">⚠ ' + err.message + '</td></tr>';
  }
}

// Cabeçalho de 2 linhas: categorias (colspan) + combustíveis por categoria.
function montarCabecalhoMedicao(grupos, combustiveisVenda) {
  const thead = document.getElementById('medicao-thead');
  let row1 = '<tr><th rowspan="2" class="sticky-col">DIA</th>';
  CATEGORIAS_MEDICAO.forEach((cat, ci) => {
    const n = colunasDaCategoria(cat.chave, grupos, combustiveisVenda).length;
    const grpEnd = (ci < CATEGORIAS_MEDICAO.length - 1) ? ' grp-end' : '';
    row1 += '<th colspan="' + n + '" class="' + cat.classe + grpEnd + '">' + cat.titulo + '</th>';
  });
  row1 += '</tr>';
  let row2 = '<tr>';
  CATEGORIAS_MEDICAO.forEach(cat => {
    const cols = colunasDaCategoria(cat.chave, grupos, combustiveisVenda);
    cols.forEach((g, gi) => {
      const grpEnd = (gi === cols.length - 1) ? ' class="grp-end"' : '';
      row2 += '<th' + grpEnd + '>' + g.abv + '</th>';
    });
  });
  row2 += '</tr>';
  thead.innerHTML = row1 + row2;
}

// Uma linha por dia; cada categoria com uma célula por combustível.
// Passo 1: tudo renderizado como texto (read-only).
function montarLinhasMedicao(dados) {
  const tbody     = document.getElementById('matriz-corpo');
  const grupos    = dados.grupos;
  const vendaCols = dados.combustiveisVenda;
  let html = '';
  dados.dias.forEach((d, diaIdx) => {
    html += '<tr><td class="sticky-col">' +
      String(d.dia).padStart(2, '0') + '/' + dados.mes + '</td>';
    CATEGORIAS_MEDICAO.forEach(cat => {
      const cols    = colunasDaCategoria(cat.chave, grupos, vendaCols);
      const valores = d[cat.chave] || [];
      cols.forEach((col, i) => {
        const val    = valores[i];
        const grpEnd = (i === cols.length - 1) ? ' grp-end' : '';
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
    });
    html += '</tr>';
  });
  tbody.innerHTML = html ||
    '<tr><td style="padding:1.5rem;color:var(--text3);">Sem dados.</td></tr>';
  // Calcula Previsão + Diferença de todos os dias (client-side).
  dados.dias.forEach((_, diaIdx) => recalcularPrevisaoEDiff(diaIdx));
}

// Previsão = medição(dia anterior) + carga − venda; Diferença = medição(hoje) − previsão.
// Portado de Logistica-JBretas (recalcularPrevisaoEDiff, ~linha 1017). Read-only.
function recalcularPrevisaoEDiff(diaIdx) {
  if (!DADOS_ATUAIS) return;
  const dias = DADOS_ATUAIS.dias;
  const dia  = dias[diaIdx];
  if (!dia) return;
  const diaOntem  = dias[diaIdx - 1];
  const grupos    = DADOS_ATUAIS.grupos;
  const vendaCols = DADOS_ATUAIS.combustiveisVenda;
  grupos.forEach((g, i) => {
    let prevVal = null;
    if (diaOntem) {
      const medOntem = diaOntem.medicao[i];
      if (medOntem !== null && medOntem !== undefined) {
        const carga    = Number(dia.carga[i]) || 0;
        const idxVenda = vendaCols.findIndex(c => c.comb === g.comb);
        const venda    = (idxVenda === -1 || dia.venda[idxVenda] === null) ? 0 : Number(dia.venda[idxVenda]);
        prevVal = Number(medOntem) + carga - venda;
      }
    }
    dia.previsao[i] = prevVal;
    const medHoje = dia.medicao[i];
    const diffVal = (prevVal !== null && medHoje !== null && medHoje !== undefined)
      ? Number(medHoje) - prevVal : null;
    dia.diferenca[i] = diffVal;

    const prevEl = document.getElementById('prev_' + diaIdx + '_' + i);
    if (prevEl) {
      prevEl.textContent = fmtL(prevVal);
      prevEl.classList.toggle('cell-vazia', prevVal === null);
    }
    const diffEl = document.getElementById('diff_' + diaIdx + '_' + i);
    if (diffEl) {
      const cor = diffVal > 0 ? 'var(--ok)' : (diffVal < 0 ? 'var(--danger)' : 'var(--text3)');
      diffEl.style.color = cor;
      diffEl.textContent = (diffVal === null ? '—' : ((diffVal > 0 ? '+' : '') + fmtL(diffVal)));
    }
  });
}

// Atualiza só a DIFERENÇA de um dia (diff = med_hoje − prev_hoje). Portado do antigo.
function _atualizarDiffDia(diaIdx) {
  if (!DADOS_ATUAIS) return;
  const dia = DADOS_ATUAIS.dias[diaIdx];
  if (!dia) return;
  DADOS_ATUAIS.grupos.forEach((g, i) => {
    const medHoje  = dia.medicao[i];
    const prevHoje = dia.previsao[i];
    let diffVal = null;
    if (medHoje !== null && medHoje !== undefined && prevHoje !== null && prevHoje !== undefined) {
      diffVal = Number(medHoje) - Number(prevHoje);
    }
    dia.diferenca[i] = diffVal;
    const diffEl = document.getElementById('diff_' + diaIdx + '_' + i);
    if (diffEl) {
      const cor = diffVal > 0 ? 'var(--ok)' : (diffVal < 0 ? 'var(--danger)' : 'var(--text3)');
      diffEl.style.color = cor;
      diffEl.textContent = (diffVal === null ? '—' : ((diffVal > 0 ? '+' : '') + fmtL(diffVal)));
    }
  });
}

// ── Edição de célula (Medição/Venda/Carga) — portado de Logistica-JBretas ──
function onCelulaFocus(input) {
  document.querySelectorAll('#matriz-corpo tr.linha-ativa').forEach(tr => tr.classList.remove('linha-ativa'));
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
  const todas = Array.from(document.querySelectorAll('#matriz-corpo .cell-in'));
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

// Recalcula previsão/diferença dos dias afetados por uma mudança em (dia, campo).
// A medição de hoje é a "med_ontem" de amanhã. Pedido não afeta previsão/diferença.
function _recalcAfeta(diaIdx, campo) {
  if (campo === 'medicao') {
    _atualizarDiffDia(diaIdx);
    recalcularPrevisaoEDiff(diaIdx + 1);
  } else if (campo === 'carga' || campo === 'venda') {
    recalcularPrevisaoEDiff(diaIdx);
    _atualizarDiffDia(diaIdx + 1);
  }
}

// Acha o input de uma célula (data-comb pode ter espaços/aspas — busca iterando).
function _acharInput(diaIdx, campo, comb) {
  return Array.from(document.querySelectorAll('#matriz-corpo .cell-in')).find(el =>
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
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = HISTORICO_UNDO.length === 0;
}

function limparDestaqueEdicoes() {
  document.querySelectorAll('#matriz-corpo .cell-in.cell-dirty').forEach(el => el.classList.remove('cell-dirty'));
}

// Botão "Salvar Alterações" com contagem de pendências.
function atualizarBotoesSalvar() {
  const btn = document.getElementById('btn-salvar-matriz');
  if (!btn) return;
  const qtd = Object.keys(EDICOES_PENDENTES).length;
  btn.disabled = qtd === 0;
  btn.textContent = '💾 Salvar Alterações' + (qtd ? ' (' + qtd + ')' : '');
}

// POST /medicao — só Supabase (sem dual-write Apps Script). Upsert por posto_id,data,combustivel.
async function salvarAlteracoesMatriz() {
  const btn = document.getElementById('btn-salvar-matriz');
  const itens = Object.values(EDICOES_PENDENTES).map(e => ({
    data:        DADOS_ATUAIS.dias[e.dia].data,
    campo:       e.campo,
    combustivel: e.comb,
    valor:       e.valor,
  }));
  if (!itens.length || !POSTO_ATUAL) return;
  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';
  try {
    const resp = await apiFetch('/medicao', {
      method: 'POST',
      body: JSON.stringify({ posto: POSTO_ATUAL, itens }),
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
    btn.textContent = '✓ Salvo!';
    setTimeout(atualizarBotoesSalvar, 1800);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '⚠ Erro ao salvar';
    mostrarErroMatriz('Erro ao salvar: ' + err.message);
    setTimeout(atualizarBotoesSalvar, 2500);
  }
}

function mostrarErroMatriz(msg) {
  const sub = document.getElementById('matriz-subtitle');
  if (sub) sub.innerHTML = '• <span style="color:var(--danger)">' + msg + '</span>';
}

// Ajusta o offset da 2ª linha sticky do cabeçalho conforme a altura real da 1ª.
function ajustarSticky() {
  const row1 = document.querySelector('#medicao-thead tr:first-child th');
  if (row1) {
    document.documentElement.style.setProperty('--thead-row1-h', row1.offsetHeight + 'px');
  }
}

// Injeta os botões "↶ Desfazer" e "Salvar Alterações" na barra de ações da
// matriz (antes do #btn-refresh, que já existe no HTML — index.html intacto).
function montarBotoesMatriz() {
  const ref = document.getElementById('btn-refresh');
  if (!ref) return;
  if (!document.getElementById('btn-undo')) {
    const undo = document.createElement('button');
    undo.id = 'btn-undo';
    undo.className = 'btn-undo';
    undo.disabled = true;
    undo.textContent = '↶ Desfazer';
    undo.addEventListener('click', desfazerUltima);
    ref.parentNode.insertBefore(undo, ref);
  }
  if (!document.getElementById('btn-salvar-matriz')) {
    const salvar = document.createElement('button');
    salvar.id = 'btn-salvar-matriz';
    salvar.className = 'btn-salvar';
    salvar.disabled = true;
    salvar.textContent = '💾 Salvar Alterações';
    salvar.addEventListener('click', salvarAlteracoesMatriz);
    ref.parentNode.insertBefore(salvar, ref);
  }
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return; // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');
  preencherTopbar();
  montarBotoesMatriz();
  carregarPostos();
});
