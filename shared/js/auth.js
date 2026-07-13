// ================================================================
// JBRETAS SISTEMA — shared/js/auth.js
// Login, logout, e proteção de rota por perfil.
// Depende de api.js (apiFetch) e config.js (JBRETAS_CONFIG) já
// carregados antes deste arquivo.
// ================================================================

// lembrar=true (persistente): token+usuario+refresh+expira no localStorage,
// sessão persistente com renovação automática. lembrar=false: só
// token+usuario no sessionStorage (cai ao fechar), sem refresh_token.
async function jbretasLogin(email, senha, lembrar) {
  const resp = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
  });
  if (resp.success) {
    const persistente = !!lembrar;
    jbretasClearSessao(); // evita cópias antigas no outro storage
    jbretasSetItem('jbretas_token', resp.token, persistente);
    jbretasSetItem('jbretas_usuario', JSON.stringify(resp.usuario), persistente);
    if (persistente) {
      if (resp.refresh_token) jbretasSetItem('jbretas_refresh', resp.refresh_token, true);
      if (resp.expira != null) jbretasSetItem('jbretas_expira', String(resp.expira), true);
    }
  }
  return resp;
}

// Renova a sessão com o refresh_token salvo (só existe no localStorage,
// fluxo "lembrar"). Sucesso → atualiza token/refresh/expira e retorna true.
// Falha (sem refresh, refresh inválido/revogado, erro de rede) → limpa
// tudo e retorna false. Usa fetch cru (não apiFetch) pra não recursar.
async function jbretasRefresh() {
  const refresh = localStorage.getItem('jbretas_refresh');
  if (!refresh) return false;
  try {
    const resp = await fetch(window.JBRETAS_CONFIG.API_URL + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.success || !json.token) {
      jbretasClearSessao();
      return false;
    }
    localStorage.setItem('jbretas_token', json.token);
    if (json.refresh_token) localStorage.setItem('jbretas_refresh', json.refresh_token);
    if (json.expira != null) localStorage.setItem('jbretas_expira', String(json.expira));
    return true;
  } catch (e) {
    jbretasClearSessao();
    return false;
  }
}

function jbretasLogout() {
  // dispara o logout no servidor enquanto o token ainda existe
  apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
  jbretasClearSessao();
  window.location.href = caminhoRaiz() + 'index.html';
}

function getUsuarioLogado() {
  const raw = jbretasGetItem('jbretas_usuario');
  return raw ? JSON.parse(raw) : null;
}

function getTokenAtual() {
  return jbretasGetItem('jbretas_token');
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
window.jbretasRefresh = jbretasRefresh;
window.jbretasLogout = jbretasLogout;
window.getUsuarioLogado = getUsuarioLogado;
window.getTokenAtual = getTokenAtual;
window.redirecionarPorPerfil = redirecionarPorPerfil;
window.exigirSessao = exigirSessao;
