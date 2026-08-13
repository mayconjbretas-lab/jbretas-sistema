// ================================================================
// JBRETAS SISTEMA — modulos/logistica-mobile/app.js
// Mobile da Logística (esqueleto). Espelha a ESTRUTURA do admin
// (bnav + sections .scr + modal Mais+), mas no ambiente base.css
// (tokens longos). SEM render de conteúdo ainda: as 3 telas ficam
// vazias — só a navegação do shell funciona.
// ================================================================

// Guard: só LOGISTICA e ADM. Sem sessão ou perfil fora → exigirSessao
// redireciona para a raiz (index.html do login).
const USUARIO = exigirSessao(['LOGISTICA', 'ADM']);

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

// ── Navegação por abas (idêntica ao admin) ──────────────────────
// Limpa .active de todas as .scr e .nbtn, ativa a section #s-<tab> e o
// botão clicado. Sem render de conteúdo ainda.
function setTab(btn, tab) {
  document.querySelectorAll('.nbtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  const sec = document.getElementById('s-' + tab);
  if (sec) sec.classList.add('active');
  // Preços: monta o render da Logística no container próprio. Pode chamar
  // toda vez — o módulo tem guarda de idempotência (_ultimoRenderSig/_slLigado).
  if (tab === 'precos' && window.solicitacoesLogistica) {
    window.solicitacoesLogistica.montarEm(document.getElementById('mb-precos'));
  }
  // Custo & Margem: render próprio no #s-custo (custo-margem.js já carregado).
  // Editável aqui (perfil LOGISTICA); o read-only é por perfil dentro do módulo.
  if (tab === 'custo' && window.renderCustoMargem) {
    window.renderCustoMargem(document.getElementById('s-custo'));
  }
}

// Volta pra versão desktop da Logística. Só reescreve a preferência se a
// chave JÁ existir (quem escolheu "lembrar" tem a preferência atualizada;
// os demais só navegam) — mesma regra do admin.
function irParaDesktop() {
  if (localStorage.getItem('jb_logi_versao')) localStorage.setItem('jb_logi_versao', 'desktop');
  window.location.href = caminhoRaiz() + 'modulos/logistica/';
}

// ── Modal "Mais+" ───────────────────────────────────────────────
function abrirMais() { document.getElementById('modal-mais').classList.add('open'); }
function fecharMais(e) { if (e.target.id === 'modal-mais') fecharMaisBtn(); }
function fecharMaisBtn() { document.getElementById('modal-mais').classList.remove('open'); }

// ── Matriz / Medição + filtro bandeira→posto + faixa de pedido ──
// Mesma lógica do logistica/app.js (desktop), adaptada aos ids do mobile.
// NÃO extraído pra shared: os dois shells diferem e a duplicação aqui é menor
// que o risco de mexer no desktop.
let POSTO_ATUAL    = '';   // '' = "Todos os postos" (não carrega matriz)
let BANDEIRA_ATUAL = '';   // '' = "Todas"
let TODOS_POSTOS   = [];   // lista completa do GET /postos (com .nome, .id, .bandeira)
let FAIXA_DATA     = '';   // data da faixa (YYYY-MM-DD); '' → hoje

function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function fmtDataBR(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso); }
function fmtNum(v) { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// GET /postos → guarda a lista completa e cai no estado inicial "Todos".
async function carregarPostosMobile() {
  const sel = document.getElementById('mb-posto');
  try {
    const resp = await apiFetch('/postos');
    TODOS_POSTOS = resp.postos || [];      // já vem com p.bandeira e p.id
    if (!TODOS_POSTOS.length) { sel.innerHTML = '<option value="">Nenhum posto</option>'; return; }
    popularSelPostoMobile();   // "Todos os postos" + os da bandeira atual
    onPostoChangeMobile();     // Todos → sem matriz + mensagem + faixa da REDE
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

// #mb-posto = "Todos os postos" + postos da BANDEIRA_ATUAL (ou todos). Reseta pra Todos.
function popularSelPostoMobile() {
  const sel = document.getElementById('mb-posto');
  const lista = BANDEIRA_ATUAL
    ? TODOS_POSTOS.filter(p => p.bandeira === BANDEIRA_ATUAL)
    : TODOS_POSTOS;
  sel.innerHTML = '<option value="">Todos os postos</option>' +
    lista.map(p => '<option value="' + esc(p.nome) + '">' + esc(p.nome) + '</option>').join('');
  sel.value = '';
  POSTO_ATUAL = '';
}

function onBandeiraChangeMobile() {
  BANDEIRA_ATUAL = document.getElementById('mb-bandeira').value;   // '' = Todas
  popularSelPostoMobile();
  onPostoChangeMobile();
}

// "Todos os postos" NÃO carrega matriz: esconde a tabela e mostra a mensagem
// (nunca deixa a matriz de um posto junto com o total de outra seleção).
function onPostoChangeMobile() {
  POSTO_ATUAL = document.getElementById('mb-posto').value;
  const host  = document.getElementById('mb-matriz');
  const vazio = document.getElementById('mb-matriz-vazio');
  if (!POSTO_ATUAL) {
    if (host)  host.style.display  = 'none';
    if (vazio) vazio.style.display = '';
  } else {
    if (vazio) vazio.style.display = 'none';
    if (host)  host.style.display  = '';
    window.matrizMedicao.carregar(POSTO_ATUAL);
  }
  atualizarFaixaMobile();
}

// ── Faixa de PEDIDO FINAL do dia (GET /medicao/pedido-dia) ──────
// Escopo: posto (posto_id) > bandeira > REDE. Cabeçalho recolhido mostra sempre
// o total + a data; o corpo (data + grid de blocos) abre no toque.
async function atualizarFaixaMobile() {
  const resumo = document.getElementById('mb-fx-resumo');
  if (!resumo) return;
  const data = FAIXA_DATA || hojeISO();
  let q = '/medicao/pedido-dia?data=' + encodeURIComponent(data);
  if (POSTO_ATUAL) {
    const posto = TODOS_POSTOS.find(p => p.nome === POSTO_ATUAL);
    if (posto && posto.id) q += '&posto_id=' + encodeURIComponent(posto.id);
  } else if (BANDEIRA_ATUAL) {
    q += '&bandeira=' + encodeURIComponent(BANDEIRA_ATUAL);
  }
  resumo.textContent = '… · ' + fmtDataBR(data);
  try {
    const resp = await apiFetch(q);
    renderFaixaMobile(resp, data);
  } catch (err) {
    resumo.textContent = 'erro · ' + fmtDataBR(data);
    const corpo = document.getElementById('mb-faixa-corpo');
    if (corpo) corpo.innerHTML = '<div class="mb-fx-erro">Erro: ' + esc(err.message) + '</div>';
  }
}

// Blocos a partir de resp.combustiveis (o que o escopo vende); valor =
// por_combustivel[cod] || 0; total = resp.total (nada é somado no front).
function renderFaixaMobile(resp, data) {
  const pc   = (resp && resp.por_combustivel) || {};
  const cods = (resp && resp.combustiveis) || [];
  const total = (resp && resp.total) || 0;
  document.getElementById('mb-fx-resumo').textContent = fmtNum(total) + ' L · ' + fmtDataBR(data);
  const blocos = cods.map(k => mbBloco(k, pc[k], false)).join('');
  const corpo = document.getElementById('mb-faixa-corpo');
  corpo.innerHTML =
    '<input type="date" class="mb-fx-data" value="' + esc(data) + '" onchange="onFaixaDataMobile(this)">' +
    '<div class="mb-fx-grid">' + blocos + mbBloco('TOTAL', total, true) + '</div>';
}
function mbBloco(label, val, isTotal) {
  return '<div class="mb-fx-bloco' + (isTotal ? ' mb-fx-bloco-total' : '') + '">' +
    '<div class="mb-fx-bl-lbl">' + esc(label) + '</div>' +
    '<div class="mb-fx-bl-val">' + fmtNum(val) + '</div></div>';   // val ausente → '0'
}
function onFaixaDataMobile(input) { FAIXA_DATA = input.value || hojeISO(); atualizarFaixaMobile(); }

// Toque no cabeçalho abre/fecha o corpo e troca o chevron.
function toggleFaixaMobile() {
  const corpo = document.getElementById('mb-faixa-corpo');
  const chev  = document.getElementById('mb-fx-chev');
  const aberto = corpo.style.display !== 'none';
  corpo.style.display = aberto ? 'none' : 'block';
  if (chev) chev.textContent = aberto ? '▸' : '▾';
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return;   // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');

  // Matriz: liga os botões da barra fixa e monta no container. Os botões já
  // estão no DOM (barra fixa acima do bnav) — matrizMedicao só controla estado.
  const btnUndo   = document.getElementById('mb-undo');
  const btnSalvar = document.getElementById('mb-salvar');
  if (btnUndo)   btnUndo.addEventListener('click', () => window.matrizMedicao.desfazer());
  if (btnSalvar) btnSalvar.addEventListener('click', () => window.matrizMedicao.salvar());
  window.matrizMedicao.montar(document.getElementById('mb-matriz'), { btnSalvar, btnUndo });

  carregarPostosMobile();
});
