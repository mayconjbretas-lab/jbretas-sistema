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
  // Sugestão de Pedido (KPI) — componente compartilhado do painel-adm (kpi.js
  // expõe renderKpi), sem fork. Mesmo padrão de Custo/Escala.
  if (tabId === 'tab-kpi' && window.renderKpi) renderKpi(document.getElementById('tab-kpi'));
  // FABs da Medição só aparecem na aba Medição (#tab-matriz).
  if (window.medicaoFabs) window.medicaoFabs.setVisivel(tabId === 'tab-matriz');
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
  // Com "Todos os postos", a área da matriz vira a GRADE de cards (mesmo fetch,
  // mesmo escopo/bandeira). O #matriz-vazio é reaproveitado como host da grade.
  const grade = document.getElementById('matriz-vazio');
  if (!POSTO_ATUAL && grade) { grade.classList.remove('grade-host'); grade.innerHTML = '<div class="grade-vazia">Carregando pedidos…</div>'; }
  try {
    const resp = await apiFetch(q);
    // No escopo posto a rota devolve posto_nome; senão cai no título do escopo.
    renderFaixa(host, (resp && resp.posto_nome) || titulo, data, resp);
    if (!POSTO_ATUAL) renderGrade(resp, data);   // grade só quando "Todos"
  } catch (err) {
    host.innerHTML = faixaHead(titulo, data) +
      '<div class="fx-sub" style="color:var(--danger)">Erro: ' + esc(err.message) + '</div>';
    if (!POSTO_ATUAL && grade) grade.innerHTML =
      '<div class="grade-vazia" style="color:var(--danger)">Erro: ' + esc(err.message) + '</div>';
  }
}

// Estado da grade: guardo os postos e a data p/ recomputar os totais no clique
// (sem refetch) e p/ o modo reduzido usar os dados já em mão.
let _gradePostos = [];
let _gradeData = '';
let _reduzidaNome = '';   // posto aberto na matriz reduzida (p/ o lápis re-renderizar)

// Marcação "montado" POR DATA em localStorage (jb_logi_montado_<data>) — é
// marcação de trabalho, não dado de negócio (sem tabela/rota). Trocar a data usa
// outra chave, então cada dia tem a sua (a visual zera sozinha).
function montadoKey(dataISO) { return 'jb_logi_montado_' + dataISO; }
function lerMontado(dataISO) {
  try { const a = JSON.parse(localStorage.getItem(montadoKey(dataISO))); return new Set(Array.isArray(a) ? a.map(String) : []); }
  catch (e) { return new Set(); }
}
function salvarMontado(dataISO, set) {
  try { localStorage.setItem(montadoKey(dataISO), JSON.stringify([...set])); } catch (e) {}
}

// Grade de cards (um por posto COM pedido na data), quando "Todos os postos".
// Usa resp.postos (aditivo da /medicao/pedido-dia): já vem ordenado por total
// desc e recortado pela bandeira do escopo. Posto específico não passa por aqui.
function renderGrade(resp, dataISO) {
  const grade = document.getElementById('matriz-vazio');
  if (!grade) return;
  _gradePostos = (resp && resp.postos) || [];
  _gradeData = dataISO;
  if (!_gradePostos.length) {
    grade.classList.remove('grade-host');   // mensagem centralizada (host original)
    grade.innerHTML = '<div class="grade-vazia">Nenhum posto com pedido em ' + fmtDataBR(dataISO) + '.</div>';
    return;
  }
  grade.classList.add('grade-host');   // reseta margin:auto/center do .matriz-vazio → grade full-width
  const montado = lerMontado(dataISO);
  const cards = _gradePostos.map(p => {
    const pc = p.por_combustivel || {};
    const linhas = Object.keys(pc).filter(k => Number(pc[k]) > 0).map(k =>
      '<div class="grade-cl"><span class="grade-cl-cod">' + esc(k) + '</span>' +
      '<span class="grade-cl-val">' + fmtNum(pc[k]) + '</span></div>').join('');
    const band = p.bandeira ? '<span class="grade-band">' + esc(p.bandeira) + '</span>' : '';
    const on = montado.has(String(p.posto_id)) ? ' grade-card--montado' : '';
    // Card inteiro alterna "montado"; o NOME abre a matriz reduzida; o lápis edita.
    return '<div class="grade-card' + on + '" data-pid="' + esc(String(p.posto_id)) + '" data-nome="' + esc(p.posto_nome || '') + '" onclick="__gradeToggle(this)">' +
      '<div class="grade-card-top">' +
        '<span class="grade-posto" data-nome="' + esc(p.posto_nome || '') + '" onclick="__gradeAbrir(event, this)">' + esc(p.posto_nome || '—') + '</span>' +
        '<span class="grade-top-r"><span class="grade-check">✓</span>' + band +
          '<span class="grade-lapis" title="Editar pedido" onclick="__gradeLapis(event, this)">✏️</span></span>' +
      '</div>' +
      '<div class="grade-total">' + fmtNum(p.total) + ' L</div>' +
      '<div class="grade-cls">' + linhas + '</div>' +
    '</div>';
  }).join('');
  const head =
    '<div class="grade-head">' +
      '<div class="grade-head-data">Pedido do dia · ' + fmtDataBR(dataISO) + '</div>' +
      '<div class="grade-tots">' +
        '<div class="grade-tot"><span class="grade-tot-lbl">FALTA MONTAR</span><b class="grade-tot-val" id="grade-tot-falta">—</b></div>' +
        '<div class="grade-tot grade-tot--montado"><span class="grade-tot-lbl">JÁ MONTADO</span><b class="grade-tot-val" id="grade-tot-montado">—</b></div>' +
      '</div>' +
    '</div>';
  // head (dois totais) FIXO fora do scroller; só os cards rolam em .grade-scroll.
  grade.innerHTML = head + '<div class="grade-scroll"><div class="grade-cards">' + cards + '</div></div>';
  recomputarTotais();
}

// Dois totais do topo, recomputados a cada clique (sem refetch): FALTA MONTAR
// (não marcados) e JÁ MONTADO (marcados, em verde).
function recomputarTotais() {
  const montado = lerMontado(_gradeData);
  let fL = 0, fN = 0, mL = 0, mN = 0;
  _gradePostos.forEach(p => {
    const t = Number(p.total) || 0;
    if (montado.has(String(p.posto_id))) { mL += t; mN++; } else { fL += t; fN++; }
  });
  const elF = document.getElementById('grade-tot-falta');
  const elM = document.getElementById('grade-tot-montado');
  if (elF) elF.textContent = fmtNum(fL) + ' L · ' + fN + ' posto' + (fN === 1 ? '' : 's');
  if (elM) elM.textContent = fmtNum(mL) + ' L · ' + mN + ' posto' + (mN === 1 ? '' : 's');
}

// Clique no CARD: alterna montado (persiste + recomputa totais). Global p/ o onclick inline.
function __gradeToggle(cardEl) {
  const pid = cardEl.getAttribute('data-pid');
  if (!pid) return;
  const montado = lerMontado(_gradeData);
  if (montado.has(pid)) montado.delete(pid); else montado.add(pid);
  salvarMontado(_gradeData, montado);
  cardEl.classList.toggle('grade-card--montado', montado.has(pid));
  recomputarTotais();
}

// Clique no NOME: abre a matriz reduzida (não alterna o montado — stopPropagation).
function __gradeAbrir(ev, nomeEl) {
  ev.stopPropagation();
  const nome = nomeEl.getAttribute('data-nome');
  if (nome) abrirReduzida(nome);
}

// Lápis do card: edita o pedido ali mesmo (todos os combustíveis). O total do
// card recalcula ao digitar; salvar grava e recarrega a grade; cancelar/erro
// voltam ao valor anterior (re-render do cache) — nunca deixa o número novo.
function __gradeLapis(ev, el) {
  ev.stopPropagation();
  const card = el.closest('.grade-card');
  if (!card) return;
  const nome = card.getAttribute('data-nome');
  const cls = card.querySelector('.grade-cls');
  const totalEl = card.querySelector('.grade-total');
  window.pedidoEditor.abrir({
    posto: nome, dataISO: _gradeData, host: cls,
    onInput: t => { if (totalEl) totalEl.textContent = fmtNum(t) + ' L'; },
    onSalvo: (ok, err) => {
      if (ok) { atualizarFaixa(); }                                   // refetch → grade + totais frescos
      else { renderGrade({ postos: _gradePostos }, _gradeData); if (err) window.alert('Erro ao salvar: ' + err); }
    },
  });
}

// Refetch do pedido do dia (escopo Todos/bandeira) só p/ atualizar _gradePostos
// sem re-renderizar a grade (usado ao salvar dentro da matriz reduzida).
async function recarregarGradeData() {
  const data = FAIXA_DATA || hojeISO();
  let q = '/medicao/pedido-dia?data=' + encodeURIComponent(data);
  if (BANDEIRA_ATUAL) q += '&bandeira=' + encodeURIComponent(BANDEIRA_ATUAL);
  try { const resp = await apiFetch(q); _gradePostos = (resp && resp.postos) || []; _gradeData = data; } catch (e) {}
}

// Matriz REDUZIDA (Medição · Venda · Previsão) do posto, no #matriz-host. Acima,
// no #faixa-pedido, a faixa do pedido do dia DAQUELE posto (dados já na grade) +
// "Voltar aos cards". A matriz COMPLETA (escolher posto no filtro) não muda.
function abrirReduzida(nomePosto) {
  _reduzidaNome = nomePosto;
  const p = _gradePostos.find(x => (x.posto_nome || '') === nomePosto);
  const host = document.getElementById('matriz-host');
  const vazio = document.getElementById('matriz-vazio');
  const faixa = document.getElementById('faixa-pedido');
  if (vazio) vazio.style.display = 'none';
  if (host)  host.style.display  = '';
  if (faixa && p) {
    const pc = p.por_combustivel || {};
    const blocos = Object.keys(pc).filter(k => Number(pc[k]) > 0).map(k =>
      '<div class="red-bl"><div class="red-bl-lbl">' + esc(k) + '</div><div class="red-bl-val">' + fmtNum(pc[k]) + '</div></div>').join('');
    faixa.innerHTML =
      '<div class="red-head">' +
        '<button type="button" class="red-voltar" onclick="voltarAosCards()">← Voltar aos cards</button>' +
        '<span class="red-posto">' + esc(p.posto_nome || nomePosto) + '</span>' +
        '<button type="button" class="red-lapis" onclick="__redLapis()" title="Editar pedido">✏️ Editar</button>' +
      '</div>' +
      '<div class="red-blocos">' + blocos +
        '<div class="red-bl red-bl-total"><div class="red-bl-lbl">TOTAL</div><div class="red-bl-val">' + fmtNum(p.total) + ' L</div></div>' +
      '</div>';
  }
  window.matrizMedicao.carregar(nomePosto, { grupos: ['medicao', 'venda', 'previsao'] });
}

// Lápis da matriz reduzida: edita o pedido na própria faixa (vendo medição/venda
// na matriz abaixo). Salvar recarrega faixa + matriz (previsão usa o pedido).
function __redLapis() {
  const faixa = document.getElementById('faixa-pedido');
  const host = faixa && faixa.querySelector('.red-blocos');
  if (!host || !_reduzidaNome) return;
  window.pedidoEditor.abrir({
    posto: _reduzidaNome, dataISO: _gradeData, host: host,
    onSalvo: (ok, err) => {
      if (ok) { recarregarGradeData().then(() => abrirReduzida(_reduzidaNome)); }
      else { abrirReduzida(_reduzidaNome); if (err) window.alert('Erro ao salvar: ' + err); }
    },
  });
}

function voltarAosCards() {
  const host = document.getElementById('matriz-host');
  const vazio = document.getElementById('matriz-vazio');
  if (host)  host.style.display  = 'none';
  if (vazio) vazio.style.display = '';
  atualizarFaixa();   // restaura a faixa de escopo (REDE/bandeira) + re-renderiza a grade
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

  // FABs da Medição (🧮/📋). Lê o posto selecionado no filtro (POSTO_ATUAL).
  // Visível só na aba Medição (#tab-matriz), que já é a ativa no load.
  if (window.medicaoFabs) window.medicaoFabs.montar({ getPosto: () => POSTO_ATUAL, getPostos: () => TODOS_POSTOS });

  // Faixa de alterações de medição no topo da aba Medição (#tab-matriz).
  if (window.medicaoAlteracoes) window.medicaoAlteracoes.montar(document.getElementById('tab-matriz'));

  carregarPostos();
  if (escolha !== 'desktop') {
    // Sem preferência salva: mostra a tela de escolha por cima do app.
    document.getElementById('tela-escolha').style.display = 'flex';
  }
});
