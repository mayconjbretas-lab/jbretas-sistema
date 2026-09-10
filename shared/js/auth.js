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
    // Só limpa a sessão quando o refresh foi REJEITADO (401/403).
    // 429, 5xx e queda de rede são transitórios — mantém o refresh salvo
    // para tentar de novo, senão o app desloga o gerente por rate-limit
    // ou por instabilidade momentânea da API.
    if (resp.status === 401 || resp.status === 403) {
      jbretasClearSessao();
      return false;
    }
    if (!resp.ok || !json.success || !json.token) {
      return false;   // falha transitória: NÃO limpa
    }
    localStorage.setItem('jbretas_token', json.token);
    if (json.refresh_token) localStorage.setItem('jbretas_refresh', json.refresh_token);
    if (json.expira != null) localStorage.setItem('jbretas_expira', String(json.expira));
    return true;
  } catch (e) {
    return false;     // offline ou API fora: NÃO limpa
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
  // A flag `ti` (ADM + flag, NÃO um perfil do enum) tem prioridade: manda pro
  // Painel TI antes do lookup por perfil. Um alvo impersonado (ti !== true)
  // sempre cai no portal do próprio perfil.
  if (usuario && usuario.ti === true) {
    const rotaTI = window.JBRETAS_CONFIG.ROTAS_POR_PERFIL.TI || '/modulos/painel-ti/';
    window.location.href = caminhoRaiz() + rotaTI.replace(/^\//, '');
    return;
  }
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

// ================================================================
// FAIXA "VENDO COMO" — impersonação do Painel TI.
// auth.js é carregado por TODAS as páginas de módulo, então a faixa
// aparece em qualquer tela quando jbretas_visao_ti existe. Mesmo padrão
// self-executável do gerente-nav.js: injeta a barra + o CSS via <style>
// (sem tocar no base.css nem no HTML de nenhum módulo).
// ================================================================
(function () {
  const FAIXA_H = 40; // px

  function lerVisao() {
    try {
      const raw = localStorage.getItem('jbretas_visao_ti');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // Restaura a sessão TID original (as 4 chaves salvas em jbretas_ti_backup),
  // limpa backup + flag e volta pro Painel TI.
  function voltarAoTI() {
    let backup = null;
    try { backup = JSON.parse(localStorage.getItem('jbretas_ti_backup') || 'null'); } catch (e) { backup = null; }
    if (typeof jbretasClearSessao === 'function') jbretasClearSessao();
    if (backup && backup.token) {
      // A sessão TI original era persistente (login) → restaura no localStorage.
      localStorage.setItem('jbretas_token', backup.token);
      if (backup.usuario) localStorage.setItem('jbretas_usuario', backup.usuario);
      if (backup.refresh) localStorage.setItem('jbretas_refresh', backup.refresh);
      if (backup.expira)  localStorage.setItem('jbretas_expira', backup.expira);
    }
    localStorage.removeItem('jbretas_ti_backup');
    localStorage.removeItem('jbretas_visao_ti');
    const raiz = (typeof caminhoRaiz === 'function') ? caminhoRaiz() : '/';
    window.location.href = raiz + 'modulos/painel-ti/';
  }

  function injetar() {
    const visao = lerVisao();
    if (!visao) return;
    if (document.getElementById('faixa-visao-ti')) return;

    // CSS: faixa fixa acima da topbar (z-index 9999 > topbar 100). Empurra o
    // body com padding-top, ENCOLHE o #screen-app e reposiciona a topbar
    // sticky (top:0 → top:FAIXA_H). Tudo aqui; base.css intacto.
    //
    // O #screen-app É O CONSERTO PRINCIPAL. A logistica e o painel-adm o
    // definem com `height:100vh`, e 100vh é a viewport INTEIRA — ele ignora o
    // padding-top do body. Nos dois o body é um bloco comum (base.css), então
    // o #screen-app fica 40px mais alto que o espaço disponível; e com
    // `html,body{overflow:hidden}` esses 40px NÃO viravam scroll: eram
    // CORTADOS, e o rodapé da tela (última linha da matriz, paginação, botão
    // de ação) ficava fora de alcance enquanto a faixa estivesse ligada.
    //
    // O ADMIN JÁ CABIA, e não por causa do `height:100%` dele: é porque o
    // admin.css põe `body{display:flex;flex-direction:column}` (linha 81), o
    // que faz do #screen-app um ITEM FLEX — e o flex-shrink padrão o encolhe
    // para o content box do body, seja qual for a altura declarada. Medido:
    // forçando `height:100vh !important` lá, a altura USADA continua saindo
    // 378px numa janela de 418. Para ele esta regra é redundante e inofensiva
    // (dá o mesmo 378px); quem ela conserta são os outros dois.
    //
    // AS CORES SÃO FIXAS, e não var(--warning), por dois motivos medidos:
    // o token vale #f9c74f no base.css e #f0a444 no admin.css (que não carrega
    // o base.css), então a faixa mudava de amarelo conforme o módulo; e no
    // tema claro ele vira #d97706, um laranja escuro que com o texto #1a1200
    // deixava o aviso difícil de ler. A faixa é um aviso de estado perigoso —
    // tem de ser o mesmo amarelo em toda tela e nos dois temas.
    const st = document.createElement('style');
    st.id = 'faixa-visao-ti-style';
    st.textContent =
      '#faixa-visao-ti{position:fixed;top:0;left:0;right:0;height:' + FAIXA_H + 'px;z-index:9999;' +
        'background:#f9c74f;color:#1a1200;display:flex;align-items:center;justify-content:center;' +
        'gap:12px;font-family:var(--mono, \'JetBrains Mono\'),monospace;font-size:.76rem;font-weight:700;' +
        'letter-spacing:.02em;padding:0 12px;box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
      // O .fvt-txt sobrevive: o span continua ganhando essa classe logo abaixo,
      // e sem a regra um nome longo empurraria o botão para fora da faixa.
      '#faixa-visao-ti .fvt-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#faixa-visao-ti button{background:#1a1200;color:#f9c74f;border:none;border-radius:6px;' +
        'font-family:var(--mono, \'JetBrains Mono\'),monospace;font-size:.7rem;font-weight:700;' +
        'padding:5px 12px;cursor:pointer;flex-shrink:0;letter-spacing:.04em}' +
      '#faixa-visao-ti button:hover{opacity:.88}' +
      'body{padding-top:' + FAIXA_H + 'px}' +
      // FAIXA_H interpolado, e não "40px" escrito à mão: a constante existe só
      // para este CSS, e fixar o número aqui a deixaria morta e livre para
      // divergir das quatro regras que dependem dela.
      '#screen-app{height:calc(100vh - ' + FAIXA_H + 'px) !important;' +
        'max-height:calc(100vh - ' + FAIXA_H + 'px)}' +
      '.topbar{top:' + FAIXA_H + 'px !important}';
    document.head.appendChild(st);

    const alvo = visao.posto || visao.perfil || '';
    const bar = document.createElement('div');
    bar.id = 'faixa-visao-ti';

    const txt = document.createElement('span');
    txt.className = 'fvt-txt';
    // textContent (não innerHTML): o nome vem do banco, evita injeção.
    txt.textContent = '👁️ Vendo como ' + (visao.nome || '?') + (alvo ? ' (' + alvo + ')' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '↩ Voltar ao TI';
    btn.addEventListener('click', voltarAoTI);

    bar.appendChild(txt);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  window.voltarAoTI = voltarAoTI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injetar);
  } else {
    injetar();
  }
})();
