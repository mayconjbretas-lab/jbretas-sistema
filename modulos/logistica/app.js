// ================================================================
// JBRETAS SISTEMA — modulos/logistica/app.js
// Shell do desktop: sessão, topbar, navegação de abas, seletor de posto,
// tema e escolha Desktop/Mobile. A Matriz/Medição foi EXTRAÍDA para
// shared/js/matriz-medicao.js (window.matrizMedicao); aqui só montamos a
// matriz no container da aba e a alimentamos com o posto selecionado.
// Depende de: config.js, api.js, auth.js, matriz-medicao.js (antes deste).
// ================================================================

// ── Proteção de rota ────────────────────────────────────────────
const USUARIO = exigirSessao(['LOGISTICA', 'ADM']);

// Preferência Desktop/Mobile da LOGÍSTICA (independente do painel ADM).
const CHAVE_VERSAO = 'jb_logi_versao'; // 'desktop' | 'mobile'

// Posto atualmente selecionado (o seletor vive aqui; a matriz recebe via carregar()).
let POSTO_ATUAL = '';

// ── Topbar ──────────────────────────────────────────────────────
function preencherTopbar() {
  if (!USUARIO) return;
  const nome = USUARIO.nome || USUARIO.email || '—';
  document.getElementById('app-usuario').textContent = nome;
  document.getElementById('app-perfil').textContent  = USUARIO.perfil || '—';
  document.getElementById('app-avatar').textContent   =
    nome.trim().slice(0, 2).toUpperCase();
}

// ── Navegação de abas ───────────────────────────────────────────
function switchMainTab(tabId, el) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  if (el) el.classList.add('active');
  // Custo & Margem — render próprio (custo-margem.js expõe renderCustoMargem).
  if (tabId === 'tab-custo' && window.renderCustoMargem) renderCustoMargem(document.getElementById('tab-custo'));
}

// ── Seletor de posto (GET /postos) ──────────────────────────────
async function carregarPostos() {
  const sel = document.getElementById('sel-posto');
  try {
    const resp = await apiFetch('/postos');
    const postos = resp.postos || [];
    if (!postos.length) {
      sel.innerHTML = '<option value="">Nenhum posto</option>';
      return;
    }
    sel.innerHTML = postos
      .map(p => `<option value="${p.nome}">${p.nome}</option>`)
      .join('');
    POSTO_ATUAL = postos[0].nome;
    sel.value = POSTO_ATUAL;
    window.matrizMedicao.carregar(POSTO_ATUAL);
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarErroMatriz('Erro ao carregar postos: ' + err.message);
  }
}

function onPostoChange() {
  POSTO_ATUAL = document.getElementById('sel-posto').value;
  if (POSTO_ATUAL) window.matrizMedicao.carregar(POSTO_ATUAL);
}

// Recarrega o posto atual na matriz (a topbar usa location.reload();
// mantido por compatibilidade com chamadas eventuais).
function atualizarMatriz() {
  if (POSTO_ATUAL) window.matrizMedicao.carregar(POSTO_ATUAL);
}

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

// ── Escolha Desktop/Mobile ──────────────────────────────────────
// Chamada pelos botões da tela de escolha. Só grava a chave se o usuário
// pediu pra lembrar; senão a escolha vale só para esta visita.
function escolherVersao(versao) {
  const lembrar = document.getElementById('chk-lembrar')?.checked;
  if (lembrar) localStorage.setItem(CHAVE_VERSAO, versao);
  if (versao === 'mobile') {
    window.location.href = caminhoRaiz() + 'modulos/logistica-mobile/';
    return;
  }
  // Desktop: o app já está rodando atrás; só fecha a tela de escolha.
  const te = document.getElementById('tela-escolha');
  if (te) te.style.display = 'none';
}
// Botão "Mobile" do topbar. Só reescreve a chave se ela JÁ existir (quem
// escolheu "lembrar" tem a preferência atualizada; os demais só navegam).
function irParaMobile() {
  if (localStorage.getItem(CHAVE_VERSAO)) localStorage.setItem(CHAVE_VERSAO, 'mobile');
  window.location.href = caminhoRaiz() + 'modulos/logistica-mobile/';
}

// Erro no subtítulo da matriz (falha ao carregar a lista de postos). A matriz
// em si é montada por window.matrizMedicao dentro do #tab-matriz.
function mostrarErroMatriz(msg) {
  const sub = document.querySelector('#tab-matriz .mm-subtitle');
  if (sub) sub.innerHTML = '• <span style="color:var(--danger)">' + msg + '</span>';
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return; // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');

  const escolha = localStorage.getItem(CHAVE_VERSAO);
  if (escolha === 'mobile') {
    // Escolha lembrada: vai direto pro mobile, sem inicializar o desktop.
    window.location.href = caminhoRaiz() + 'modulos/logistica-mobile/';
    return;
  }
  // Desktop OU sem preferência: inicializa o painel normalmente.
  preencherTopbar();

  // Botões Salvar/Desfazer são criados e possuídos pelo desktop; a matriz
  // recebe as referências (posiciona-os e controla habilitar/contagem).
  const btnUndo = document.createElement('button');
  btnUndo.id = 'btn-undo';
  btnUndo.className = 'btn-undo';
  btnUndo.disabled = true;
  btnUndo.textContent = '↶ Desfazer';
  btnUndo.addEventListener('click', () => window.matrizMedicao.desfazer());

  const btnSalvar = document.createElement('button');
  btnSalvar.id = 'btn-salvar-matriz';
  btnSalvar.className = 'btn-salvar';
  btnSalvar.disabled = true;
  btnSalvar.textContent = '💾 Salvar Alterações';
  btnSalvar.addEventListener('click', () => window.matrizMedicao.salvar());

  window.matrizMedicao.montar(document.getElementById('tab-matriz'), { btnSalvar, btnUndo });

  carregarPostos();
  if (escolha !== 'desktop') {
    // Sem preferência salva: mostra a tela de escolha por cima do app.
    document.getElementById('tela-escolha').style.display = 'flex';
  }
});
