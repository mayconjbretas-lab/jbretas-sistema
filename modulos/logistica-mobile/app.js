// ================================================================
// JBRETAS SISTEMA — modulos/logistica-mobile/app.js
// Mobile da Logística (esqueleto). Espelha a ESTRUTURA do admin
// (bnav + sections .scr + modal Mais+), mas no ambiente base.css
// (tokens longos). SEM render de conteúdo ainda: as 3 telas ficam
// vazias — só a navegação do shell funciona.
// ================================================================

// Guard: só LOGISTICA e ADM. Sem sessão ou perfil fora → exigirSessao
// redireciona para a raiz (index.html do login).
const USUARIO = exigirSessao(['LOGISTICA', 'ADM']);

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

// ── Navegação por abas (idêntica ao admin) ──────────────────────
// Limpa .active de todas as .scr e .nbtn, ativa a section #s-<tab> e o
// botão clicado. Sem render de conteúdo ainda.
function setTab(btn, tab) {
  document.querySelectorAll('.nbtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  const sec = document.getElementById('s-' + tab);
  if (sec) sec.classList.add('active');
  // FABs da Medição só aparecem na aba Medição.
  if (window.medicaoFabs) window.medicaoFabs.setVisivel(tab === 'medicao');
  // Reserva do bnav no .main é dobra na Medição (o frame já reserva) → tira lá,
  // mantém nas outras (que rolam livres).
  document.querySelector('.main')?.classList.toggle('sem-reserva-bnav', tab === 'medicao');
  // Preços: monta o render da Logística no container próprio. Pode chamar
  // toda vez — o módulo tem guarda de idempotência (_ultimoRenderSig/_slLigado).
  if (tab === 'precos' && window.solicitacoesLogistica) {
    window.solicitacoesLogistica.montarEm(document.getElementById('mb-precos'));
  }
  // Escala: render próprio no #mb-escala (escala.js já carregado).
  if (tab === 'escala' && window.renderEscala) {
    window.renderEscala(document.getElementById('mb-escala'));
  }
}

// Custo & Margem — aberto pelo Mais+ (NÃO é aba do bnav). Espelha o
// modulos/admin/app.js: fecha o modal, limpa .active de .scr/.nbtn, ativa
// #s-custo e renderiza. LOGISTICA edita; o read-only é por perfil no módulo.
function abrirCustoMobile() {
  document.getElementById('modal-mais').classList.remove('open');
  document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nbtn').forEach(x => x.classList.remove('active'));
  document.getElementById('s-custo').classList.add('active');
  if (window.medicaoFabs) window.medicaoFabs.setVisivel(false);   // saiu da Medição
  document.querySelector('.main')?.classList.remove('sem-reserva-bnav');   // Custo rola livre → volta a reserva
  if (window.renderCustoMargem) renderCustoMargem(document.getElementById('s-custo'));
}

// Volta pra versão desktop da Logística. Só reescreve a preferência se a
// chave JÁ existir (quem escolheu "lembrar" tem a preferência atualizada;
// os demais só navegam) — mesma regra do admin.
function irParaDesktop() {
  if (localStorage.getItem('jb_logi_versao')) localStorage.setItem('jb_logi_versao', 'desktop');
  window.location.href = caminhoRaiz() + 'modulos/logistica/';
}

// ── Modal "Mais+" ───────────────────────────────────────────────
function abrirMais() { document.getElementById('modal-mais').classList.add('open'); }
function fecharMais(e) { if (e.target.id === 'modal-mais') fecharMaisBtn(); }
function fecharMaisBtn() { document.getElementById('modal-mais').classList.remove('open'); }

// ── Matriz / Medição + filtro bandeira→posto + faixa de pedido ──
// Mesma lógica do logistica/app.js (desktop), adaptada aos ids do mobile.
// NÃO extraído pra shared: os dois shells diferem e a duplicação aqui é menor
// que o risco de mexer no desktop.
let POSTO_ATUAL    = '';   // '' = "Todos os postos" (não carrega matriz)
let BANDEIRA_ATUAL = '';   // '' = "Todas"
let TODOS_POSTOS   = [];   // lista completa do GET /postos (com .nome, .id, .bandeira)
let FAIXA_DATA     = '';   // data da faixa (YYYY-MM-DD); '' → hoje

function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function fmtDataBR(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso); }
function fmtNum(v) { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// GET /postos → guarda a lista completa e cai no estado inicial "Todos".
async function carregarPostosMobile() {
  const sel = document.getElementById('mb-posto');
  try {
    const resp = await apiFetch('/postos');
    TODOS_POSTOS = resp.postos || [];      // já vem com p.bandeira e p.id
    if (!TODOS_POSTOS.length) { sel.innerHTML = '<option value="">Nenhum posto</option>'; return; }
    popularSelPostoMobile();   // "Todos os postos" + os da bandeira atual
    onPostoChangeMobile();     // Todos → sem matriz + mensagem + faixa da REDE
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

// #mb-posto = "Todos os postos" + postos da BANDEIRA_ATUAL (ou todos). Reseta pra Todos.
function popularSelPostoMobile() {
  const sel = document.getElementById('mb-posto');
  const lista = BANDEIRA_ATUAL
    ? TODOS_POSTOS.filter(p => p.bandeira === BANDEIRA_ATUAL)
    : TODOS_POSTOS;
  sel.innerHTML = '<option value="">Todos os postos</option>' +
    lista.map(p => '<option value="' + esc(p.nome) + '">' + esc(p.nome) + '</option>').join('');
  sel.value = '';
  POSTO_ATUAL = '';
}

function onBandeiraChangeMobile() {
  BANDEIRA_ATUAL = document.getElementById('mb-bandeira').value;   // '' = Todas
  popularSelPostoMobile();
  onPostoChangeMobile();
}

// "Todos os postos" NÃO carrega matriz: esconde a tabela e mostra a mensagem
// (nunca deixa a matriz de um posto junto com o total de outra seleção).
function onPostoChangeMobile() {
  POSTO_ATUAL = document.getElementById('mb-posto').value;
  const host  = document.getElementById('mb-matriz');
  const vazio = document.getElementById('mb-matriz-vazio');
  // Sai de qualquer modo reduzido ao trocar posto/bandeira: esconde a faixa da
  // reduzida e devolve a faixa de pedido normal (o desktop se recupera sozinho
  // via atualizarFaixa; aqui é explícito porque a #mb-faixa foi ocultada).
  const red = document.getElementById('mb-reduzida');
  if (red) red.style.display = 'none';
  const fx = document.getElementById('mb-faixa');
  if (fx) fx.style.display = '';
  if (!POSTO_ATUAL) {
    if (host)  host.style.display  = 'none';
    if (vazio) vazio.style.display = '';
  } else {
    if (vazio) vazio.style.display = 'none';
    if (host)  host.style.display  = '';
    window.matrizMedicao.carregar(POSTO_ATUAL);
  }
  atualizarFaixaMobile();
  requestAnimationFrame(medirAlturas);   // matriz apareceu/sumiu → remede o topo do #mb-matriz
}

// ── Faixa de PEDIDO FINAL do dia (GET /medicao/pedido-dia) ──────
// Escopo: posto (posto_id) > bandeira > REDE. Cabeçalho recolhido mostra sempre
// o total + a data; o corpo (data + grid de blocos) abre no toque.
async function atualizarFaixaMobile() {
  const resumo = document.getElementById('mb-fx-resumo');
  if (!resumo) return;
  const data = FAIXA_DATA || hojeISO();
  let q = '/medicao/pedido-dia?data=' + encodeURIComponent(data);
  if (POSTO_ATUAL) {
    const posto = TODOS_POSTOS.find(p => p.nome === POSTO_ATUAL);
    if (posto && posto.id) q += '&posto_id=' + encodeURIComponent(posto.id);
  } else if (BANDEIRA_ATUAL) {
    q += '&bandeira=' + encodeURIComponent(BANDEIRA_ATUAL);
  }
  resumo.textContent = '… · ' + fmtDataBR(data);
  // Com "Todos os postos", a área da matriz vira a GRADE de cards (mesmo fetch).
  // #mb-matriz-vazio é reaproveitado como host da grade.
  const grade = document.getElementById('mb-matriz-vazio');
  if (!POSTO_ATUAL && grade) { grade.classList.remove('grade-host'); grade.innerHTML = '<div class="grade-vazia">Carregando pedidos…</div>'; }
  try {
    const resp = await apiFetch(q);
    renderFaixaMobile(resp, data);
    if (!POSTO_ATUAL) renderGradeMobile(resp, data);   // grade só quando "Todos"
  } catch (err) {
    resumo.textContent = 'erro · ' + fmtDataBR(data);
    const corpo = document.getElementById('mb-faixa-corpo');
    if (corpo) corpo.innerHTML = '<div class="mb-fx-erro">Erro: ' + esc(err.message) + '</div>';
    if (!POSTO_ATUAL && grade) grade.innerHTML =
      '<div class="grade-vazia" style="color:var(--danger)">Erro: ' + esc(err.message) + '</div>';
  }
}

// Estado da grade + marcação "montado" POR DATA (localStorage jb_logi_montado_
// <data>) — marcação de trabalho, sem tabela/rota. Trocar a data usa outra chave.
let _gradePostos = [];
let _gradeData = '';
let _reduzidaNome = '';
function montadoKey(dataISO) { return 'jb_logi_montado_' + dataISO; }
function lerMontado(dataISO) {
  try { const a = JSON.parse(localStorage.getItem(montadoKey(dataISO))); return new Set(Array.isArray(a) ? a.map(String) : []); }
  catch (e) { return new Set(); }
}
function salvarMontado(dataISO, set) {
  try { localStorage.setItem(montadoKey(dataISO), JSON.stringify([...set])); } catch (e) {}
}

// Grade de cards (1 coluna no mobile) quando "Todos os postos". Usa resp.postos
// (aditivo da /medicao/pedido-dia): já ordenado por total desc e recortado pela
// bandeira. Mesmo conteúdo/comportamento do desktop; layout de 1 coluna no matriz.css.
function renderGradeMobile(resp, dataISO) {
  const grade = document.getElementById('mb-matriz-vazio');
  if (!grade) return;
  _gradePostos = (resp && resp.postos) || [];
  _gradeData = dataISO;
  if (!_gradePostos.length) {
    grade.classList.remove('grade-host');
    grade.innerHTML = '<div class="grade-vazia">Nenhum posto com pedido em ' + fmtDataBR(dataISO) + '.</div>';
    return;
  }
  grade.classList.add('grade-host');
  const montado = lerMontado(dataISO);
  const cards = _gradePostos.map(p => {
    const pc = p.por_combustivel || {};
    const linhas = Object.keys(pc).filter(k => Number(pc[k]) > 0).map(k =>
      '<div class="grade-cl"><span class="grade-cl-cod">' + esc(k) + '</span>' +
      '<span class="grade-cl-val">' + fmtNum(pc[k]) + '</span></div>').join('');
    const band = p.bandeira ? '<span class="grade-band">' + esc(p.bandeira) + '</span>' : '';
    const on = montado.has(String(p.posto_id)) ? ' grade-card--montado' : '';
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
  // head (dois totais) sticky no topo (mobile: página rola); cards em .grade-scroll.
  grade.innerHTML = head + '<div class="grade-scroll"><div class="grade-cards">' + cards + '</div></div>';
  recomputarTotais();
}

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

function __gradeToggle(cardEl) {
  const pid = cardEl.getAttribute('data-pid');
  if (!pid) return;
  const montado = lerMontado(_gradeData);
  if (montado.has(pid)) montado.delete(pid); else montado.add(pid);
  salvarMontado(_gradeData, montado);
  cardEl.classList.toggle('grade-card--montado', montado.has(pid));
  recomputarTotais();
}
function __gradeAbrir(ev, nomeEl) {
  ev.stopPropagation();
  const nome = nomeEl.getAttribute('data-nome');
  if (nome) abrirReduzida(nome);
}

// Lápis do card (mobile): edita o pedido ali, total recalcula ao digitar;
// salvar recarrega a grade; cancelar/erro voltam ao valor anterior.
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
      if (ok) { atualizarFaixaMobile(); }
      else { renderGradeMobile({ postos: _gradePostos }, _gradeData); if (err) window.alert('Erro ao salvar: ' + err); }
    },
  });
}

// Refetch do pedido do dia (escopo Todos/bandeira) p/ atualizar _gradePostos sem
// re-render (usado ao salvar dentro da matriz reduzida).
async function recarregarGradeData() {
  const data = FAIXA_DATA || hojeISO();
  let q = '/medicao/pedido-dia?data=' + encodeURIComponent(data);
  if (BANDEIRA_ATUAL) q += '&bandeira=' + encodeURIComponent(BANDEIRA_ATUAL);
  try { const resp = await apiFetch(q); _gradePostos = (resp && resp.postos) || []; _gradeData = data; } catch (e) {}
}

// Matriz REDUZIDA (Medição · Venda · Previsão) no #mb-matriz. Acima, uma faixa
// #mb-reduzida (pedido do dia do posto + Voltar), inserida antes do #mb-matriz;
// a faixa de pedido normal (#mb-faixa) some enquanto isso. Matriz completa
// (escolher posto no filtro) não muda.
function abrirReduzida(nomePosto) {
  _reduzidaNome = nomePosto;
  const p = _gradePostos.find(x => (x.posto_nome || '') === nomePosto);
  const grade = document.getElementById('mb-matriz-vazio');
  const host  = document.getElementById('mb-matriz');
  const faixa = document.getElementById('mb-faixa');
  if (grade) grade.style.display = 'none';
  if (faixa) faixa.style.display = 'none';
  if (host)  host.style.display  = '';
  let red = document.getElementById('mb-reduzida');
  if (!red) {
    red = document.createElement('div');
    red.id = 'mb-reduzida';
    red.className = 'mb-reduzida';
    host.parentNode.insertBefore(red, host);   // logo acima da matriz
  }
  red.style.display = '';
  const pc = (p && p.por_combustivel) || {};
  const blocos = Object.keys(pc).filter(k => Number(pc[k]) > 0).map(k =>
    '<div class="red-bl"><div class="red-bl-lbl">' + esc(k) + '</div><div class="red-bl-val">' + fmtNum(pc[k]) + '</div></div>').join('');
  red.innerHTML =
    '<div class="red-head">' +
      '<button type="button" class="red-voltar" onclick="voltarAosCards()">← Voltar aos cards</button>' +
      '<span class="red-posto">' + esc((p && p.posto_nome) || nomePosto) + '</span>' +
      '<button type="button" class="red-lapis" onclick="__redLapis()" title="Editar pedido">✏️ Editar</button>' +
    '</div>' +
    '<div class="red-blocos">' + blocos +
      '<div class="red-bl red-bl-total"><div class="red-bl-lbl">TOTAL</div><div class="red-bl-val">' + fmtNum((p && p.total) || 0) + ' L</div></div>' +
    '</div>';
  window.matrizMedicao.carregar(nomePosto, { grupos: ['medicao', 'venda', 'previsao'] });
  requestAnimationFrame(medirAlturas);   // topo do #mb-matriz mudou (faixa acima)
}

// Lápis da matriz reduzida (mobile): edita o pedido na faixa; salvar recarrega
// faixa + matriz. host = as .red-blocos dentro do #mb-reduzida.
function __redLapis() {
  const red = document.getElementById('mb-reduzida');
  const host = red && red.querySelector('.red-blocos');
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
  const grade = document.getElementById('mb-matriz-vazio');
  const host  = document.getElementById('mb-matriz');
  const faixa = document.getElementById('mb-faixa');
  const red   = document.getElementById('mb-reduzida');
  if (red)   red.style.display   = 'none';
  if (host)  host.style.display  = 'none';
  if (faixa) faixa.style.display = '';
  if (grade) grade.style.display = '';
  atualizarFaixaMobile();               // restaura a faixa de pedido + re-render da grade
  requestAnimationFrame(medirAlturas);
}

// Blocos a partir de resp.combustiveis (o que o escopo vende); valor =
// por_combustivel[cod] || 0; total = resp.total (nada é somado no front).
function renderFaixaMobile(resp, data) {
  const pc   = (resp && resp.por_combustivel) || {};
  const cods = (resp && resp.combustiveis) || [];
  const total = (resp && resp.total) || 0;
  document.getElementById('mb-fx-resumo').textContent = fmtNum(total) + ' L · ' + fmtDataBR(data);
  const blocos = cods.map(k => mbBloco(k, pc[k], false)).join('');
  const corpo = document.getElementById('mb-faixa-corpo');
  corpo.innerHTML =
    '<input type="date" class="mb-fx-data" value="' + esc(data) + '" onchange="onFaixaDataMobile(this)">' +
    '<div class="mb-fx-grid">' + blocos + mbBloco('TOTAL', total, true) + '</div>';
}
function mbBloco(label, val, isTotal) {
  return '<div class="mb-fx-bloco' + (isTotal ? ' mb-fx-bloco-total' : '') + '">' +
    '<div class="mb-fx-bl-lbl">' + esc(label) + '</div>' +
    '<div class="mb-fx-bl-val">' + fmtNum(val) + '</div></div>';   // val ausente → '0'
}
function onFaixaDataMobile(input) { FAIXA_DATA = input.value || hojeISO(); atualizarFaixaMobile(); }

// Mede as alturas reais do shell e publica em CSS vars — o frame da matriz, a
// .mb-actions e o padding do .main se dimensionam sem número mágico. Só grava
// quando o elemento está visível (>0): assim uma medição feita em outra aba
// (onde a matriz/actions ficam display:none) não zera a var — mantém o último
// valor bom. --mb-topo-h = topo da viewport até o topo do .spreadsheet-frame
// (cobre topbar + padding do main + filtros + faixa + o CABEÇALHO da matriz de
// uma vez). Ancorar no FRAME (e não no #mb-matriz) faz o cabeçalho entrar no top
// automaticamente — sem variável nova e sem remedir quando ele muda de altura.
// Fallback no #mb-matriz caso o frame ainda não exista (antes do montar).
function medirAlturas() {
  const root = document.documentElement;
  const bnav    = document.querySelector('.bnav');
  const actions = document.querySelector('.mb-actions');
  const topoEl  = document.querySelector('#mb-matriz .spreadsheet-frame') || document.getElementById('mb-matriz');
  if (bnav)    { const h = bnav.getBoundingClientRect().height;    if (h > 0) root.style.setProperty('--mb-bnav-h',    Math.round(h) + 'px'); }
  if (actions) { const h = actions.getBoundingClientRect().height; if (h > 0) root.style.setProperty('--mb-actions-h', Math.round(h) + 'px'); }
  if (topoEl)  { const t = topoEl.getBoundingClientRect().top;     if (t > 0) root.style.setProperty('--mb-topo-h',    Math.round(t) + 'px'); }
}

// Toque no cabeçalho abre/fecha o corpo e troca o chevron. A faixa muda de
// altura → o topo do #mb-matriz muda → remede (rAF, após o layout aplicar).
function toggleFaixaMobile() {
  const corpo = document.getElementById('mb-faixa-corpo');
  const chev  = document.getElementById('mb-fx-chev');
  const aberto = corpo.style.display !== 'none';
  corpo.style.display = aberto ? 'none' : 'block';
  if (chev) chev.textContent = aberto ? '▸' : '▾';
  requestAnimationFrame(medirAlturas);
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return;   // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');

  // Matriz: liga os botões da barra fixa e monta no container. Os botões já
  // estão no DOM (barra fixa acima do bnav) — matrizMedicao só controla estado.
  const btnUndo   = document.getElementById('mb-undo');
  const btnSalvar = document.getElementById('mb-salvar');
  if (btnUndo)   btnUndo.addEventListener('click', () => window.matrizMedicao.desfazer());
  if (btnSalvar) btnSalvar.addEventListener('click', () => window.matrizMedicao.salvar());
  window.matrizMedicao.montar(document.getElementById('mb-matriz'), { btnSalvar, btnUndo });
  // Medição é a aba ativa no load → matriz montada, tira a reserva do bnav do .main.
  document.querySelector('.main')?.classList.add('sem-reserva-bnav');

  // FABs da Medição (🧮/📋) — mesmo componente shared do desktop. Lê o posto do
  // filtro (POSTO_ATUAL). Visível só na aba Medição (#s-medicao), a ativa no load.
  if (window.medicaoFabs) window.medicaoFabs.montar({ getPosto: () => POSTO_ATUAL, getPostos: () => TODOS_POSTOS });

  // Faixa de alterações de medição no topo da aba Medição (#s-medicao).
  if (window.medicaoAlteracoes) window.medicaoAlteracoes.montar(document.getElementById('s-medicao'));

  carregarPostosMobile();
  requestAnimationFrame(medirAlturas);   // 1ª medição depois de montar o shell
});

// Remede quando a geometria muda por fora dos fluxos acima. Listeners
// registrados UMA vez no nível do módulo — não empilham a cada render.
window.addEventListener('resize', () => requestAnimationFrame(medirAlturas));
window.addEventListener('orientationchange', () => requestAnimationFrame(medirAlturas));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(medirAlturas);
