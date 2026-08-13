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

// ── Matriz / Medição (usa window.matrizMedicao do shared) ───────
// O seletor de posto vive aqui; a matriz recebe o posto via carregar().
let POSTO_ATUAL = '';

// Mesma rota do logistica/app.js (GET /postos).
async function carregarPostosMobile() {
  const sel = document.getElementById('mb-posto');
  try {
    const resp = await apiFetch('/postos');
    const postos = resp.postos || [];
    if (!postos.length) { sel.innerHTML = '<option value="">Nenhum posto</option>'; return; }
    sel.innerHTML = postos.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('');
    POSTO_ATUAL = postos[0].nome;
    sel.value = POSTO_ATUAL;
    window.matrizMedicao.carregar(POSTO_ATUAL);
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

function onPostoChangeMobile() {
  POSTO_ATUAL = document.getElementById('mb-posto').value;
  if (POSTO_ATUAL) window.matrizMedicao.carregar(POSTO_ATUAL);
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
