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

// Categorias editáveis neste bloco (2A). Pré-pedido/Pedido virão depois.
const EDITAVEIS = ['medicao', 'venda', 'carga'];

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
  atualizarBotoesSalvar();
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
          // Célula editável (Medição/Venda/Carga) — mesmo padrão do app antigo.
          const combAttr = String(col.comb).replace(/"/g, '&quot;');
          html += '<td class="' + grpEnd + '"><input type="text" inputmode="numeric" class="cell-in"' +
            ' data-dia="' + diaIdx + '" data-campo="' + cat.chave + '" data-comb="' + combAttr + '"' +
            ' value="' + fmtL(val).replace('—', '') + '"' +
            ' onfocus="onCelulaFocus(this)" oninput="onCelulaDigito(this)"' +
            ' onkeydown="onCelulaTecla(event,this)" onblur="onCelulaBlur(this)"></td>';
        } else {
          // Pré-pedido / Pedido — read-only neste bloco.
          const vazia = (val === null || val === undefined || val === '') ? ' cell-vazia' : '';
          html += '<td class="' + grpEnd + '"><span class="cell-val' + vazia + '">' +
            fmtL(val) + '</span></td>';
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
  const raw = input.value.replace(/\./g, '').replace(/[^0-9]/g, '');
  if (!raw || raw === '0') input.value = '0';
  requestAnimationFrame(() => input.select());
}

function onCelulaDigito(input) {
  const cursorPos = input.selectionStart;
  const raw = input.value.replace(/\./g, '').replace(/[^0-9]/g, '');
  const num = parseInt(raw) || 0;
  const formatado = num === 0 ? '0' : num.toLocaleString('pt-BR');
  const diff = formatado.length - input.value.length;
  input.value = formatado;
  try { input.setSelectionRange(cursorPos + diff, cursorPos + diff); } catch (e) {}
  _salvarCelula(input, num === 0 ? null : num);
}

function onCelulaTecla(e, input) {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.ctrlKey) {
    e.preventDefault();
    const passo = e.shiftKey ? 100 : (e.altKey ? 10 : 1000);
    const delta = e.key === 'ArrowUp' ? passo : -passo;
    const raw   = input.value.replace(/\./g, '').replace(/[^0-9]/g, '');
    const atual = parseInt(raw) || 0;
    const novo  = Math.max(0, atual + delta);
    input.value = novo === 0 ? '0' : novo.toLocaleString('pt-BR');
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
  const raw = input.value.replace(/\./g, '').replace(/[^0-9]/g, '');
  const num = parseInt(raw) || 0;
  input.value = num > 0 ? num.toLocaleString('pt-BR') : '';
  _salvarCelula(input, num > 0 ? num : null);
}

// Grava a edição no estado + EDICOES_PENDENTES e recalcula os dias afetados.
function _salvarCelula(input, valor) {
  if (!DADOS_ATUAIS) return;
  const diaIdx = parseInt(input.dataset.dia);
  const campo  = input.dataset.campo;
  const comb   = input.dataset.comb;
  input.classList.add('cell-dirty');
  const diaObj = DADOS_ATUAIS.dias[diaIdx];
  const cols = campo === 'venda' ? DADOS_ATUAIS.combustiveisVenda : DADOS_ATUAIS.grupos;
  const idx = cols.findIndex(c => c.comb === comb);
  if (idx === -1) return;
  diaObj[campo][idx] = valor;
  EDICOES_PENDENTES[diaIdx + '|' + campo + '|' + comb] = { dia: diaIdx, campo, comb, valor };

  // A medição de hoje é a "med_ontem" de amanhã → recalcula os dias afetados.
  if (campo === 'medicao') {
    _atualizarDiffDia(diaIdx);
    recalcularPrevisaoEDiff(diaIdx + 1);
  } else if (campo === 'carga' || campo === 'venda') {
    recalcularPrevisaoEDiff(diaIdx);
    _atualizarDiffDia(diaIdx + 1);
  }
  atualizarBotoesSalvar();
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
    EDICOES_PENDENTES = {};
    limparDestaqueEdicoes();
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

// Injeta o botão "Salvar Alterações" na barra de ações da matriz
// (antes do #btn-refresh, que já existe no HTML — mantém index.html intacto).
function montarBotaoSalvar() {
  if (document.getElementById('btn-salvar-matriz')) return;
  const ref = document.getElementById('btn-refresh');
  if (!ref) return;
  const btn = document.createElement('button');
  btn.id = 'btn-salvar-matriz';
  btn.className = 'btn-salvar';
  btn.disabled = true;
  btn.textContent = '💾 Salvar Alterações';
  btn.addEventListener('click', salvarAlteracoesMatriz);
  ref.parentNode.insertBefore(btn, ref);
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return; // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');
  preencherTopbar();
  montarBotaoSalvar();
  carregarPostos();
});
