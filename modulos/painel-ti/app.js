// ================================================================
// JBRETAS SISTEMA — modulos/painel-ti/app.js
// Painel TI · aba "Acessar como". Lista usuários (GET /ti/usuarios),
// filtra por modalidade (chips) + busca (nome/posto) e entra na
// sessão de um usuário via POST /ti/entrar-como (impersonação).
//
// Guard: só entra quem tem a flag `ti` (ADM + flag). Qualquer outro é
// mandado pro portal do próprio perfil.
// ================================================================

let usuarioAtual   = null;
let todosUsuarios  = [];
let modalidadeAtiva = '';   // '' = todos; senão o perfil (GERENTE/SUPERVISOR/ADM/LOGISTICA)
let buscaAtual      = '';

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

// Normaliza pra busca: minúsculo, sem acento.
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const u = exigirSessao();
  if (!u) return;                       // exigirSessao já mandou pro login
  if (u.ti !== true) {                  // não é TI → portal do próprio perfil
    redirecionarPorPerfil(u);
    return;
  }
  usuarioAtual = u;

  aplicarTema(localStorage.getItem('jb_theme') || 'dark');
  montarTopbar();
  ligarControles();
  await carregarUsuarios();
});

function montarTopbar() {
  const nome = usuarioAtual?.nome || '—';
  document.getElementById('app-nome').textContent = nome;
  const iniciais = nome.split(' ').slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '--';
  document.getElementById('app-avatar').textContent = iniciais;
}

// Liga os chips de modalidade, a busca e a delegação do botão "Entrar".
function ligarControles() {
  const chips = document.getElementById('ti-chips');
  if (chips) chips.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-chip') : null;
    if (!btn) return;
    modalidadeAtiva = btn.getAttribute('data-modalidade') || '';
    Array.prototype.forEach.call(chips.querySelectorAll('.ti-chip'),
      c => c.classList.toggle('active', c === btn));
    renderLista();
  });

  const busca = document.getElementById('ti-busca');
  if (busca) busca.addEventListener('input', (e) => {
    buscaAtual = e.target.value || '';
    renderLista();
  });

  const lista = document.getElementById('ti-lista');
  if (lista) lista.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-entrar') : null;
    if (!btn) return;
    entrarComo(btn.getAttribute('data-id'), btn);
  });
}

async function carregarUsuarios() {
  const lista = document.getElementById('ti-lista');
  try {
    const resp = await apiFetch('/ti/usuarios');
    todosUsuarios = (resp && resp.usuarios) || [];
    renderLista();
  } catch (err) {
    if (lista) lista.innerHTML = '<div class="empty-state">⚠ Falha ao carregar usuários: ' + escapeHtml(err.message) + '</div>';
  }
  return todosUsuarios;
}

// Aplica modalidade + busca sobre todosUsuarios (função pura de estado —
// usada tanto pelo render quanto pelos testes).
function aplicarFiltros() {
  const q = norm(buscaAtual);
  return todosUsuarios.filter(u => {
    if (modalidadeAtiva && u.perfil !== modalidadeAtiva) return false;
    if (!q) return true;
    return norm(u.nome).indexOf(q) !== -1 || norm(u.posto_nome).indexOf(q) !== -1;
  });
}

function renderLista() {
  const lista = document.getElementById('ti-lista');
  const contador = document.getElementById('ti-contador');
  const filtrados = aplicarFiltros();

  if (contador) contador.textContent = filtrados.length + '/' + todosUsuarios.length;

  if (!filtrados.length) {
    if (lista) lista.innerHTML = '<div class="empty-state">Nenhum usuário para este filtro.</div>';
    return;
  }

  const html = filtrados.map(u => {
    const nome = u.nome || '—';
    const iniciais = escapeHtml(nome.split(' ').slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '--');
    const sub = u.posto_nome ? u.posto_nome : (u.email || '');
    return '' +
      '<div class="ti-user">' +
        '<div class="ti-user-avatar">' + iniciais + '</div>' +
        '<div class="ti-user-info">' +
          '<div class="ti-user-nome">' + escapeHtml(nome) + '</div>' +
          '<div class="ti-user-meta">' +
            '<span class="ti-user-perfil">' + escapeHtml(u.perfil || '?') + '</span>' +
            escapeHtml(sub) +
          '</div>' +
        '</div>' +
        '<button class="ti-entrar" type="button" data-id="' + escapeHtml(u.id) + '">Entrar</button>' +
      '</div>';
  }).join('');

  if (lista) lista.innerHTML = html;
}

// Entra na sessão do alvo: guarda backup da sessão TI atual, troca as chaves
// pela sessão do alvo (persistente), seta a flag da faixa e vai pro portal dele.
async function entrarComo(userId, btn) {
  if (!userId) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  // 1) backup da sessão TI ATUAL (as 4 chaves, onde quer que morem hoje).
  const backup = {
    token:   jbretasGetItem('jbretas_token'),
    usuario: jbretasGetItem('jbretas_usuario'),
    refresh: jbretasGetItem('jbretas_refresh'),
    expira:  jbretasGetItem('jbretas_expira'),
  };

  let resp;
  try {
    resp = await apiFetch('/ti/entrar-como', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
    alert('Falha ao entrar como esse usuário: ' + err.message);
    return;
  }

  // 2) guarda o backup e a flag da faixa (nome/perfil/posto do alvo).
  localStorage.setItem('jbretas_ti_backup', JSON.stringify(backup));
  localStorage.setItem('jbretas_visao_ti', JSON.stringify({
    nome:   resp.usuario.nome,
    perfil: resp.usuario.perfil,
    posto:  resp.usuario.nomePosto || (resp.usuario.posto && resp.usuario.posto.nome) || null,
  }));

  // 3) troca a sessão pela do alvo — PERSISTENTE (localStorage), igual ao
  //    login com "lembrar" (a sessão do alvo tem refresh_token).
  jbretasClearSessao();
  jbretasSetItem('jbretas_token', resp.token, true);
  jbretasSetItem('jbretas_usuario', JSON.stringify(resp.usuario), true);
  if (resp.refresh_token) jbretasSetItem('jbretas_refresh', resp.refresh_token, true);
  if (resp.expira != null) jbretasSetItem('jbretas_expira', String(resp.expira), true);

  // 4) portal do alvo (ti !== true → cai no perfil dele).
  redirecionarPorPerfil(resp.usuario);
}

// Expostos p/ onclick do HTML e p/ o harness de testes.
window.toggleTheme      = toggleTheme;
window.entrarComo       = entrarComo;
window.aplicarFiltros   = aplicarFiltros;
window.carregarUsuarios = carregarUsuarios;
window.renderLista      = renderLista;
