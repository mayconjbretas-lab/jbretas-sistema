// ================================================================
// JBRETAS SISTEMA — shared/js/api.js
// Wrapper único para chamadas à API. Toda chamada autenticada deve
// passar por apiFetch() — ele já injeta o token e trata erro 401
// (token expirado/inválido) jogando o usuário de volta pro login.
// ================================================================

// ── Storage unificado ─────────────────────────────────────────────
// "Lembrar de mim" MARCADO grava no localStorage (persiste); DESMARCADO
// grava no sessionStorage (cai ao fechar). A leitura tenta localStorage
// primeiro, senão sessionStorage — assim o resto do código não precisa
// saber onde a sessão mora.
const JB_CHAVES_SESSAO = ['jbretas_token', 'jbretas_usuario', 'jbretas_refresh', 'jbretas_expira'];
function jbretasGetItem(chave) {
  const v = localStorage.getItem(chave);
  return v !== null ? v : sessionStorage.getItem(chave);
}
function jbretasSetItem(chave, valor, persistente) {
  (persistente ? localStorage : sessionStorage).setItem(chave, valor);
}
function jbretasClearSessao() {
  JB_CHAVES_SESSAO.forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
}

async function apiFetch(path, options = {}, _jaTentouRefresh = false) {
  const token = jbretasGetItem('jbretas_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(window.JBRETAS_CONFIG.API_URL + path, {
    ...options,
    headers,
  });

  if (resp.status === 401) {
    // 401 nas próprias rotas de auth = credenciais/refresh inválidos:
    // não renova nem redireciona, só propaga o erro pra quem chamou tratar
    // (ex.: login com senha errada mostra a mensagem certa).
    if (path.startsWith('/auth/login') || path.startsWith('/auth/refresh')) {
      const jsonErr = await resp.json().catch(() => ({}));
      throw new Error(jsonErr.erro || `Erro ${resp.status}`);
    }
    // Access vencido: tenta renovar UMA única vez e repete a chamada.
    if (!_jaTentouRefresh && typeof window.jbretasRefresh === 'function') {
      const renovou = await window.jbretasRefresh();
      if (renovou) return apiFetch(path, options, true);
    }
    // Sem refresh possível (ou refresh falhou): limpa tudo e vai pro login.
    jbretasClearSessao();
    window.location.href = caminhoRaiz() + 'index.html?expirado=1';
    throw new Error('Sessão expirada');
  }

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json.erro || `Erro ${resp.status}`);
  }
  return json;
}

// Calcula o caminho relativo até a raiz do site a partir de qualquer
// módulo (ex: /modulos/fechamento/ → '../../'), pra redirecionar pro
// login sem depender de domínio fixo (funciona local e em produção).
function caminhoRaiz() {
  const partes = window.location.pathname.split('/').filter(Boolean);
  // Remove o nome do arquivo se houver (ex: index.html)
  const semArquivo = partes.filter(p => !p.includes('.'));
  // Se está em /modulos/algo/, sobe 2 níveis; ajusta conforme profundidade real
  const profundidade = semArquivo.length;
  if (profundidade === 0) return './';
  return '../'.repeat(profundidade);
}

window.apiFetch = apiFetch;
window.jbretasGetItem = jbretasGetItem;
window.jbretasSetItem = jbretasSetItem;
window.jbretasClearSessao = jbretasClearSessao;
window.caminhoRaiz = caminhoRaiz;
