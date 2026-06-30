// ================================================================
// JBRETAS SISTEMA — shared/js/api.js
// Wrapper único para chamadas à API. Toda chamada autenticada deve
// passar por apiFetch() — ele já injeta o token e trata erro 401
// (token expirado/inválido) jogando o usuário de volta pro login.
// ================================================================

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('jbretas_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(window.JBRETAS_CONFIG.API_URL + path, {
    ...options,
    headers,
  });

  // Token inválido/expirado — limpa sessão e manda pro login
  if (resp.status === 401) {
    localStorage.removeItem('jbretas_token');
    localStorage.removeItem('jbretas_usuario');
    const baseUrl = caminhoRaiz();
    window.location.href = baseUrl + 'index.html?expirado=1';
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
window.caminhoRaiz = caminhoRaiz;
