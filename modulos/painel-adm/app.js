// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/app.js
// Painel ADM desktop (esqueleto). Tela de escolha Desktop/Mobile +
// navegação por abas (placeholders). SEM lógica de dados ainda.
// Depende de: config.js, api.js, auth.js (carregados antes).
// ================================================================

// ── Proteção de rota ────────────────────────────────────────────
const USUARIO = exigirSessao(['ADM']);

const CHAVE_VERSAO = 'jb_adm_versao'; // 'desktop' | 'mobile'

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

// ── Topbar ──────────────────────────────────────────────────────
function preencherTopbar() {
  if (!USUARIO) return;
  const nome = USUARIO.nome || USUARIO.email || '—';
  document.getElementById('app-usuario').textContent = nome;
  document.getElementById('app-perfil').textContent  = USUARIO.perfil || '—';
  document.getElementById('app-avatar').textContent   = nome.trim().slice(0, 2).toUpperCase();
}

// ── Escolha Desktop/Mobile ──────────────────────────────────────
function irParaMobile() {
  // Atualiza a escolha só se o usuário já tinha pedido pra lembrar.
  if (localStorage.getItem(CHAVE_VERSAO)) localStorage.setItem(CHAVE_VERSAO, 'mobile');
  window.location.href = caminhoRaiz() + 'modulos/admin/';
}

// Chamada pelos botões da tela de escolha.
function escolherVersao(versao) {
  const lembrar = document.getElementById('chk-lembrar')?.checked;
  if (lembrar) localStorage.setItem(CHAVE_VERSAO, versao);
  if (versao === 'mobile') {
    window.location.href = caminhoRaiz() + 'modulos/admin/';
    return;
  }
  abrirPainelDesktop();
}

function abrirPainelDesktop() {
  document.getElementById('tela-escolha').style.display = 'none';
  document.getElementById('screen-app').style.display = 'flex';
  preencherTopbar();
}

// ── Navegação por abas (placeholders) ───────────────────────────
function setTab(btn, tab) {
  document.querySelectorAll('.bnav .nbtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.pa-main .scr').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('s-' + tab)?.classList.add('active');
  // Lógica de dados por aba entra nos próximos blocos.
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return; // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');

  const escolha = localStorage.getItem(CHAVE_VERSAO);
  if (escolha === 'mobile') {
    // Escolha lembrada: vai direto pro mobile.
    window.location.href = caminhoRaiz() + 'modulos/admin/';
  } else if (escolha === 'desktop') {
    // Escolha lembrada: abre o painel direto, sem a tela de escolha.
    abrirPainelDesktop();
  } else {
    // Sem escolha salva: mostra a tela de escolha.
    document.getElementById('tela-escolha').style.display = 'flex';
  }
});
