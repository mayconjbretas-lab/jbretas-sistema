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

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return;   // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');
});
