// ================================================================
// JBRETAS SISTEMA — shared/js/auth.js
// Login, logout, e proteção de rota por perfil.
// Depende de api.js (apiFetch) e config.js (JBRETAS_CONFIG) já
// carregados antes deste arquivo.
// ================================================================

async function jbretasLogin(email, senha) {
  const resp = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
  });
  if (resp.success) {
    localStorage.setItem('jbretas_token', resp.token);
    localStorage.setItem('jbretas_usuario', JSON.stringify(resp.usuario));
  }
  return resp;
}

function jbretasLogout() {
  localStorage.removeItem('jbretas_token');
  localStorage.removeItem('jbretas_usuario');
  // apiFetch faz POST /auth/logout em background, mas não bloqueia o redirect
  apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = caminhoRaiz() + 'index.html';
}

function getUsuarioLogado() {
  const raw = localStorage.getItem('jbretas_usuario');
  return raw ? JSON.parse(raw) : null;
}

function getTokenAtual() {
  return localStorage.getItem('jbretas_token');
}

// Redireciona o usuário pro módulo certo conforme o perfil retornado
// no login. Chamado pela tela de login após autenticar com sucesso.
function redirecionarPorPerfil(usuario) {
  const rota = window.JBRETAS_CONFIG.ROTAS_POR_PERFIL[usuario.perfil] || '/modulos/fechamento/';
  window.location.href = caminhoRaiz() + rota.replace(/^\//, '');
}

// Chamado no topo de cada página de módulo protegido. Se não houver
// sessão válida, manda de volta pro login. Não valida o token contra
// o servidor aqui (isso acontece na primeira chamada real via apiFetch,
// que trata 401 automaticamente) — aqui é só a checagem rápida local.
function exigirSessao(perfisPermitidos = null) {
  const usuario = getUsuarioLogado();
  const token   = getTokenAtual();
  if (!usuario || !token) {
    window.location.href = caminhoRaiz() + 'index.html';
    return null;
  }
  if (perfisPermitidos && !perfisPermitidos.includes(usuario.perfil)) {
    alert('Seu perfil não tem acesso a este módulo.');
    window.location.href = caminhoRaiz() + 'index.html';
    return null;
  }
  return usuario;
}

window.jbretasLogin = jbretasLogin;
window.jbretasLogout = jbretasLogout;
window.getUsuarioLogado = getUsuarioLogado;
window.getTokenAtual = getTokenAtual;
window.redirecionarPorPerfil = redirecionarPorPerfil;
window.exigirSessao = exigirSessao;
