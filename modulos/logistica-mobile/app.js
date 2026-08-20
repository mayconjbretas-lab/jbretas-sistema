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

// Grade de cards (1 coluna no mobile) quando "Todos os postos". Usa resp.postos
// (aditivo da /medicao/pedido-dia): já ordenado por total desc e recortado pela
// bandeira. Mesmo conteúdo do desktop; o layout de 1 coluna vem do matriz.css.
function renderGradeMobile(resp, dataISO) {
  const grade = document.getElementById('mb-matriz-vazio');
  if (!grade) return;
  const postos = (resp && resp.postos) || [];
  if (!postos.length) {
    grade.classList.remove('grade-host');
    grade.innerHTML = '<div class="grade-vazia">Nenhum posto com pedido em ' + fmtDataBR(dataISO) + '.</div>';
    return;
  }
  grade.classList.add('grade-host');
  const n = (resp && resp.postos_com_pedido) || postos.length;
  const total = (resp && resp.total) || 0;
  const head = '<div class="grade-head">Pedido do dia · ' + fmtDataBR(dataISO) + ' · ' +
    n + ' posto' + (n === 1 ? '' : 's') + ' com pedido · total ' + fmtNum(total) + ' L</div>';
  const cards = postos.map(p => {
    const pc = p.por_combustivel || {};
    const linhas = Object.keys(pc).filter(k => Number(pc[k]) > 0).map(k =>
      '<div class="grade-cl"><span class="grade-cl-cod">' + esc(k) + '</span>' +
      '<span class="grade-cl-val">' + fmtNum(pc[k]) + '</span></div>').join('');
    const band = p.bandeira ? '<span class="grade-band">' + esc(p.bandeira) + '</span>' : '';
    return '<div class="grade-card">' +
      '<div class="grade-card-top"><span class="grade-posto">' + esc(p.posto_nome || '—') + '</span>' + band + '</div>' +
      '<div class="grade-total">' + fmtNum(p.total) + ' L</div>' +
      '<div class="grade-cls">' + linhas + '</div>' +
    '</div>';
  }).join('');
  grade.innerHTML = head + '<div class="grade-cards">' + cards + '</div>';
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
  if (window.medicaoFabs) window.medicaoFabs.montar({ getPosto: () => POSTO_ATUAL });

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
