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

// Posto/bandeira selecionados (os seletores vivem aqui; a matriz recebe via carregar()).
let POSTO_ATUAL    = '';   // '' = "Todos os postos" (não carrega matriz)
let BANDEIRA_ATUAL = '';   // '' = "Todas"
let TODOS_POSTOS   = [];   // lista completa do GET /postos (com .nome e .bandeira)
let FAIXA_DATA     = '';   // data da faixa de total (YYYY-MM-DD); '' → hoje

function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function fmtDataBR(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso); }
// Número em litros: pt-BR, sem casas. undefined/NaN → '0' (nunca renderiza NaN).
function fmtNum(v) { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
  // Escala — render próprio (escala.js expõe renderEscala).
  if (tabId === 'tab-escala' && window.renderEscala) renderEscala(document.getElementById('tab-escala'));
}

// ── Filtro encadeado bandeira → posto (GET /postos) ─────────────
async function carregarPostos() {
  const sel = document.getElementById('sel-posto');
  try {
    const resp = await apiFetch('/postos');
    TODOS_POSTOS = resp.postos || [];       // já vem com p.bandeira
    if (!TODOS_POSTOS.length) { sel.innerHTML = '<option value="">Nenhum posto</option>'; return; }
    popularSelPosto();   // "Todos os postos" + os da bandeira atual; reseta pra "Todos"
    onPostoChange();     // estado inicial: Todos → sem matriz + mensagem + faixa da REDE
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarErroMatriz('Erro ao carregar postos: ' + err.message);
  }
}

// Popula #sel-posto com "Todos os postos" + os postos da BANDEIRA_ATUAL
// (ou todos, se Todas). Sempre volta a seleção para "Todos os postos".
function popularSelPosto() {
  const sel = document.getElementById('sel-posto');
  const lista = BANDEIRA_ATUAL
    ? TODOS_POSTOS.filter(p => p.bandeira === BANDEIRA_ATUAL)
    : TODOS_POSTOS;
  sel.innerHTML = '<option value="">Todos os postos</option>' +
    lista.map(p => '<option value="' + esc(p.nome) + '">' + esc(p.nome) + '</option>').join('');
  sel.value = '';
  POSTO_ATUAL = '';
}

// Trocar a bandeira: refiltra os postos e volta pra "Todos os postos".
function onBandeiraChange() {
  BANDEIRA_ATUAL = document.getElementById('sel-bandeira').value;   // '' = Todas
  popularSelPosto();
  onPostoChange();   // Todos → esconde matriz + mensagem; e recarrega a faixa
}

// Trocar o posto. "Todos os postos" (value '') NÃO carrega matriz: esconde a
// tabela e mostra a mensagem — nunca deixa a matriz de um posto na tela junto
// com o total de outra seleção. Posto específico → carrega a matriz dele.
function onPostoChange() {
  POSTO_ATUAL = document.getElementById('sel-posto').value;
  const host  = document.getElementById('matriz-host');
  const vazio = document.getElementById('matriz-vazio');
  if (!POSTO_ATUAL) {
    if (host)  host.style.display  = 'none';
    if (vazio) vazio.style.display = '';
  } else {
    if (vazio) vazio.style.display = 'none';
    if (host)  host.style.display  = '';
    window.matrizMedicao.carregar(POSTO_ATUAL);
  }
  atualizarFaixa();
}

// ── Faixa de total de PEDIDO FINAL do dia (GET /medicao/pedido-dia) ──
// Tem data PRÓPRIA (independe do mês da matriz). Escopo: posto específico →
// total DAQUELE posto (pendente: a rota agrega por bandeira/rede e não isola
// um posto sem posto_id); senão a bandeira selecionada, ou REDE (Todas).
async function atualizarFaixa() {
  const host = document.getElementById('faixa-pedido');
  if (!host) return;
  const data = FAIXA_DATA || hojeISO();
  // Escopo (mais específico → menos): posto (posto_id) > bandeira > REDE.
  let q = '/medicao/pedido-dia?data=' + encodeURIComponent(data);
  let titulo;
  if (POSTO_ATUAL) {
    const posto = TODOS_POSTOS.find(p => p.nome === POSTO_ATUAL);
    if (posto && posto.id) q += '&posto_id=' + encodeURIComponent(posto.id);
    titulo = POSTO_ATUAL;
  } else if (BANDEIRA_ATUAL) {
    q += '&bandeira=' + encodeURIComponent(BANDEIRA_ATUAL);
    titulo = BANDEIRA_ATUAL;
  } else {
    titulo = 'REDE';
  }
  host.innerHTML = faixaHead(titulo, data) + '<div class="fx-sub">carregando…</div>';
  try {
    const resp = await apiFetch(q);
    // No escopo posto a rota devolve posto_nome; senão cai no título do escopo.
    renderFaixa(host, (resp && resp.posto_nome) || titulo, data, resp);
  } catch (err) {
    host.innerHTML = faixaHead(titulo, data) +
      '<div class="fx-sub" style="color:var(--danger)">Erro: ' + esc(err.message) + '</div>';
  }
}

function faixaHead(titulo, dataISO) {
  return '<div class="fx-head">' +
      '<div class="fx-title">PEDIDO FINAL — ' + esc(titulo) + '</div>' +
      '<input type="date" class="fx-data" value="' + esc(dataISO) + '" onchange="onFaixaData(this)">' +
    '</div>';
}
function onFaixaData(input) { FAIXA_DATA = input.value || hojeISO(); atualizarFaixa(); }

// por_combustivel vem {} quando não há pedido → cada chave ausente vira 0 no
// fmtNum. Ordem canônica GC, GA, ET, S10, S500 e o que mais vier depois; TOTAL
// destacado no fim (usa resp.total, que já soma tudo).
function renderFaixa(host, titulo, dataISO, resp) {
  const pc = (resp && resp.por_combustivel) || {};
  // Blocos = combustíveis que o ESCOPO vende (resp.combustiveis, já canônico),
  // não uma lista fixa: assim a faixa espelha as colunas da Matriz do escopo.
  // Valor de cada bloco vem do por_combustivel (ausente → 0); nada é somado aqui.
  const cods = (resp && resp.combustiveis) || [];
  const blocos = cods.map(k => bloco(k, pc[k])).join('');
  const total = (resp && resp.total) || 0;   // total vem da rota
  const n = (resp && resp.postos_com_pedido) || 0;
  host.innerHTML =
    faixaHead(titulo, dataISO) +
    '<div class="fx-sub">' + n + ' postos com pedido · ' + fmtDataBR(dataISO) + '</div>' +
    '<div class="fx-blocos">' + blocos +
      '<div class="fx-bloco fx-bloco-total"><div class="fx-bl-lbl">TOTAL</div>' +
        '<div class="fx-bl-val">' + fmtNum(total) + '</div></div>' +
    '</div>';
}
function bloco(label, val) {
  return '<div class="fx-bloco"><div class="fx-bl-lbl">' + esc(label) + '</div>' +
    '<div class="fx-bl-val">' + fmtNum(val) + '</div></div>';   // val ausente → '0'
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

  window.matrizMedicao.montar(document.getElementById('matriz-host'), { btnSalvar, btnUndo });

  carregarPostos();
  if (escolha !== 'desktop') {
    // Sem preferência salva: mostra a tela de escolha por cima do app.
    document.getElementById('tela-escolha').style.display = 'flex';
  }
});
