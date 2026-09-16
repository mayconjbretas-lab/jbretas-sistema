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
  // Matriz — re-mede o offset do cabeçalho sticky (--thead-row1-h). A medida pode
  // ter saído 0 enquanto a aba estava oculta (ex.: troca de posto na Sugestão
  // dispara carregar→ajustarSticky com #tab-matriz display:none). O .active acima
  // já aplicou display:flex; o rAF garante medir com a matriz VISÍVEL. NÃO chama
  // carregar (não refaz o fetch à toa) — só re-mede.
  if (tabId === 'tab-matriz' && window.matrizMedicao && window.matrizMedicao.ajustarSticky) {
    requestAnimationFrame(() => window.matrizMedicao.ajustarSticky());
  }
  // FABs da Medição só aparecem na aba Medição (#tab-matriz).
  if (window.medicaoFabs) window.medicaoFabs.setVisivel(tabId === 'tab-matriz');
  // Por último: a URL guarda onde a pessoa está. Ver o bloco do hash.
  gravarHash();
}

// ── A ABA MORA NA URL ───────────────────────────────────────────
// Mesma regra do painel-adm. Sem isto, F5 e link colado devolviam sempre
// a aba Matriz: quem estava no meio de uma conferência perdia o lugar a
// cada recarga.
//
// replaceState, e NÃO pushState: trocar de aba não é navegar. A troca é
// declarada — o voltar/avançar não percorre as abas visitadas, porque não
// há entrada de histórico para percorrer. O hashchange abaixo cobre o
// resto: hash editado à mão e link colado na mesma página.
//
// O guard do nome não é decoração: o valor vem do hash, que é do usuário,
// e entra num seletor CSS. Sem ele, um hash com apóstrofo quebraria o
// querySelector — ou casaria um elemento que ninguém pediu. Aceita dígito
// porque há aba que começa com um.
//
// AQUI O BOTÃO É ACHADO PELO data-tab, que os .nav-item já têm — não
// pelo onclick, como nos módulos de bnav. Atributo existindo, é ele.
//
// O POSTO TAMBÉM ENTRA NO HASH, e só na aba que o usa: a Matriz sem posto
// é uma tela vazia com um aviso, então "#matriz" sozinho não devolve
// ninguém ao lugar onde estava. Vai URL-encoded porque nome de posto tem
// espaço e acento.
function itemDaAba(nome) {
  if (!nome || !/^[a-z0-9-]+$/.test(nome)) return null;
  return document.querySelector('.nav-item[data-tab="tab-' + nome + '"]');
}
function hashAtual() {
  const ativo = document.querySelector('.nav-item.active');
  const nome = ativo ? String(ativo.dataset.tab || '').replace(/^tab-/, '') : '';
  if (!nome) return '';
  const sel = document.getElementById('sel-posto');
  const posto = (nome === 'matriz' && sel && sel.value) ? sel.value : '';
  return '#' + nome + (posto ? '/posto=' + encodeURIComponent(posto) : '');
}
function gravarHash() {
  const novo = hashAtual();
  // Reescrever o mesmo hash não muda nada e ainda assim mexe na URL.
  if (novo && location.hash !== novo) history.replaceState(null, '', novo);
}
// O posto pedido pela URL espera aqui: o <select> só tem opções depois do
// GET /postos, e aplicá-lo antes seria escrever num select vazio.
let _postoDoHash = '';
function aplicarPostoDoHash() {
  const sel = document.getElementById('sel-posto');
  if (!sel || !_postoDoHash) return false;
  // Só aceita posto que EXISTA no select: o valor vem da URL, e um nome
  // inventado deixaria o select num estado que nenhuma opção representa.
  const existe = [...sel.options].some(o => o.value === _postoDoHash);
  const alvo = existe ? _postoDoHash : '';
  _postoDoHash = '';
  if (!alvo) return false;
  sel.value = alvo;
  return true;
}
// Abre o que o hash pedir. false quando não casa com aba nenhuma: hash
// inválido não é erro, é ausência de instrução — e aí o padrão do HTML
// fica como está.
function aplicarHash() {
  const partes = String(location.hash || '').replace(/^#/, '').split('/');
  const el = itemDaAba(partes[0]);
  if (!el) return false;
  switchMainTab('tab-' + partes[0], el);
  const m = /^posto=(.*)$/.exec(partes[1] || '');
  _postoDoHash = m ? decodeURIComponent(m[1]) : '';
  // Com a tela já carregada (hash trocado à mão), aplica agora; no boot
  // quem aplica é o carregarPostos, na ordem certa.
  if (_postoDoHash && TODOS_POSTOS.length && aplicarPostoDoHash()) onPostoChange();
  return true;
}
window.addEventListener('hashchange', aplicarHash);

// ── Filtro encadeado bandeira → posto (GET /postos) ─────────────
async function carregarPostos() {
  const sel = document.getElementById('sel-posto');
  try {
    const resp = await apiFetch('/postos');
    TODOS_POSTOS = resp.postos || [];       // já vem com p.bandeira
    if (!TODOS_POSTOS.length) { sel.innerHTML = '<option value="">Nenhum posto</option>'; return; }
    popularSelBandeira();   // opções de bandeira do BANCO (case exata) — não hardcoded
    popularSelPosto();   // "Todos os postos" + os da bandeira atual; reseta pra "Todos"
    // O posto da URL entra AQUI, antes do onPostoChange: assim a matriz é
    // carregada UMA vez, já com o posto certo. Aplicá-lo depois faria o
    // onPostoChange rodar duas vezes — a primeira só para desenhar
    // "selecione um posto" e jogar fora, com a faixa indo ao banco à toa.
    aplicarPostoDoHash();
    onPostoChange();     // estado inicial: Todos → sem matriz + mensagem + faixa da REDE
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarErroMatriz('Erro ao carregar postos: ' + err.message);
  }
}

// Opções de bandeira vindas do BANCO (postos.bandeira), não hardcoded no HTML.
// Assim o value casa EXATAMENTE com o DB (hoje em MAIÚSCULO) e o filtro
// client-side (p.bandeira === BANDEIRA_ATUAL) volta a bater. Preserva a seleção
// atual se ainda existir; senão cai em "Todas".
function popularSelBandeira() {
  const sel = document.getElementById('sel-bandeira');
  if (!sel) return;
  const bandeiras = [...new Set(TODOS_POSTOS.map(p => p.bandeira).filter(Boolean))].sort();
  if (BANDEIRA_ATUAL && !bandeiras.includes(BANDEIRA_ATUAL)) BANDEIRA_ATUAL = '';
  sel.innerHTML = '<option value="">Todas</option>' +
    bandeiras.map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join('');
  sel.value = BANDEIRA_ATUAL;
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
  // A lista acabou de ser (re)montada — é aqui, e só aqui, que a busca
  // guarda a cópia íntegra dela. Ver pbCapturar().
  pbCapturar();
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
  gravarHash();
  // O campo de busca espelha o select DAQUI: é o ponto por onde passam
  // boot, hash, troca de bandeira e escolha pelo próprio campo.
  pbSincronizar();
}

// ── BUSCA DE POSTO ──────────────────────────────────────────────
// São 37 postos num <select>: achar "P. SANTA INES - JOAQUIM" pedia rolar
// a lista inteira, e o teclado nativo do select só casa pelo COMEÇO do
// nome — digitar "ana" não leva a "P. ANA LUCIA" porque todos começam com
// "P. ". O campo filtra por TRECHO, que é como alguém lembra de um posto.
//
// O CAMPO NÃO SUBSTITUI O SELECT. São dois controles empilhados e visíveis
// ao mesmo tempo: busca em cima, lista embaixo. O campo só ENCURTA as
// opções do select — quem não digitar nada usa a lista como sempre usou.
// (A versão anterior cobria o select com o input e desenhava uma lista
// própria em <ul>; virava um controle novo para uma tarefa que o select
// já fazia, e escondia de quem só queria abrir e rolar.)
//
// O <select> segue sendo a fonte de verdade: é o value dele que o app lê
// (POSTO_ATUAL) e o onchange dele que aciona a carga da matriz, a faixa e o
// hash. Este bloco NUNCA chama onPostoChange nem dispara change — ele só
// reescreve as <option>. Sem segundo caminho para o mesmo efeito.
function pbSemAcento(v) {
  return String(v == null ? '' : v).normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toUpperCase();
}
// Cópia ÍNTEGRA das opções, tirada quando o select é populado. Filtrar
// lendo o próprio select não funcionaria: a primeira filtragem já teria
// jogado fora as opções que a segunda precisa de volta.
let _pbTodas = [];
function pbEl() {
  return {
    inp:   document.getElementById('pb-input'),
    sel:   document.getElementById('sel-posto'),
    x:     document.getElementById('pb-x'),
    conta: document.getElementById('pb-conta'),
  };
}
// Chamado pelo popularSelPosto, que é quem monta a lista (no boot e a cada
// troca de bandeira). ZERA o termo de propósito: a lista mudou debaixo do
// campo, e um termo velho que não casa com a bandeira nova deixaria o
// select vazio sem explicação.
function pbCapturar() {
  const { sel, inp } = pbEl();
  if (!sel) return;
  _pbTodas = [...sel.options].map(o => ({ valor: o.value, texto: o.textContent }));
  if (inp) inp.value = '';
  pbAplicar();
}
// Reescreve as <option> do select com o que casa com o termo.
//
// DUAS OPÇÕES NUNCA SOMEM, e as duas por motivo de não deixar o usuário sem
// saída:
//   • "Todos os postos" (value "") é como se desfaz a escolha. Escondê-la
//     atrás de um termo tiraria a volta.
//   • A opção SELECIONADA. Sem ela o select perderia o value ao filtrar, e
//     o posto em tela mudaria sozinho por causa de uma letra digitada.
function pbAplicar() {
  const { inp, sel, x, conta } = pbEl();
  if (!inp || !sel || !_pbTodas.length) return;
  const termo = inp.value.trim();
  const t = pbSemAcento(termo);
  const atual = sel.value;
  const casa = (o) => o.valor === '' || o.valor === atual ||
                      !t || pbSemAcento(o.texto).indexOf(t) >= 0;
  const visiveis = _pbTodas.filter(casa);
  sel.innerHTML = visiveis.map(o =>
    '<option value="' + esc(o.valor) + '">' + esc(o.texto) + '</option>').join('');
  // Reposto DEPOIS do innerHTML: trocar as opções zera o value do select.
  // Não dispara change (atribuição programática não dispara), então a
  // matriz não recarrega por causa de uma busca.
  sel.value = atual;
  if (x) x.hidden = !termo;
  // Quantos sobraram, e só quando há termo. "37 postos" o tempo todo vira
  // ruído; "nenhum posto" é o único caso em que a lista curta precisa se
  // explicar.
  if (conta) {
    const n = visiveis.filter(o => o.valor !== '').length;
    conta.hidden = !termo;
    conta.textContent = !termo ? ''
      : (n === 0 ? 'nenhum posto com esse trecho'
                 : n + (n === 1 ? ' posto' : ' postos') + ' com esse trecho');
    conta.classList.toggle('pb-conta-zero', !!termo && n === 0);
  }
}
// Nome mantido: é por ele que o onPostoChange avisa a busca de que a
// seleção mudou (pelo hash, pelo boot ou pela própria lista). Reaplicar o
// filtro aqui é o que mantém a opção selecionada visível quando ela só
// entrou na lista por ser a selecionada.
function pbSincronizar() { pbAplicar(); }
function pbMontar() {
  const { inp, x } = pbEl();
  if (!inp) return;
  inp.addEventListener('input', pbAplicar);
  // Esc limpa em vez de fechar coisa nenhuma — não há mais lista flutuante
  // para fechar, e limpar é o que sobra de útil na tecla.
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); pbLimpar(); }
  });
  if (x) x.addEventListener('click', pbLimpar);
}
// O foco volta para o campo: quem limpou vai digitar outro trecho, e
// mandar o foco para o nada obrigaria a clicar de novo.
function pbLimpar() {
  const { inp } = pbEl();
  if (!inp) return;
  inp.value = '';
  pbAplicar();
  inp.focus();
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

// Grade de cards (um por posto do escopo), quando "Todos os postos". Usa
// resp.postos (aditivo da /medicao/pedido-dia): já vem TODO o escopo, ordenado
// (sem pedido primeiro, depois por volume desc) e recortado pela bandeira. Posto
// específico não passa por aqui. Quem não tem pedido vira card "sem pedido"
// (total 0, sem linhas de combustível) — à espera do lápis.
function renderGrade(resp, dataISO) {
  const grade = document.getElementById('matriz-vazio');
  if (!grade) return;
  _gradePostos = (resp && resp.postos) || [];
  _gradeData = dataISO;
  if (!_gradePostos.length) {
    grade.classList.remove('grade-host');   // mensagem centralizada (host original)
    grade.innerHTML = '<div class="grade-vazia">Nenhum posto ativo neste escopo.</div>';
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
    const semPed = (Number(p.total) || 0) <= 0 ? ' grade-card--sem-pedido' : '';   // borda tracejada/apagado
    // Card inteiro alterna "montado"; o NOME abre a matriz reduzida; o lápis edita.
    return '<div class="grade-card' + on + semPed + '" data-pid="' + esc(String(p.posto_id)) + '" data-nome="' + esc(p.posto_nome || '') + '" onclick="__gradeToggle(this)">' +
      '<div class="grade-card-top">' +
        '<span class="grade-posto" data-nome="' + esc(p.posto_nome || '') + '" onclick="__gradeAbrir(event, this)">' + esc(p.posto_nome || '—') + '</span>' +
        '<span class="grade-top-r"><span class="grade-check">✓</span>' + band +
          '<span class="grade-lapis" title="Editar pedido" onclick="__gradeLapis(event, this)">✏️</span></span>' +
      '</div>' +
      '<div class="grade-total">' + fmtNum(p.total) + ' L</div>' +
      '<div class="grade-cls">' + (linhas || '<span class="grade-sem-tag">sem pedido</span>') + '</div>' +
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
// (não marcados de verde) e JÁ MONTADO (marcados). "Falta montar" agrega dois
// casos: posto SEM pedido (total 0) e posto COM pedido ainda não confirmado — os
// dois "ainda não fechados". Litros somam só o pedido (sem-pedido entra com 0),
// e destaco entre parênteses quantos dos que faltam são "sem pedido".
function recomputarTotais() {
  const montado = lerMontado(_gradeData);
  let fL = 0, fN = 0, fSem = 0, mL = 0, mN = 0;
  _gradePostos.forEach(p => {
    const t = Number(p.total) || 0;
    if (montado.has(String(p.posto_id))) { mL += t; mN++; }
    else { fL += t; fN++; if (t <= 0) fSem++; }
  });
  const elF = document.getElementById('grade-tot-falta');
  const elM = document.getElementById('grade-tot-montado');
  if (elF) elF.textContent = fmtNum(fL) + ' L · ' + fN + ' posto' + (fN === 1 ? '' : 's') +
    (fSem ? ' (' + fSem + ' sem pedido)' : '');
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
  // Botão de imprimir a folha do posto (frente: medição · verso: venda e pedido).
  // Mesmo contrato dos FABs, mas arquivo DAQUI: o medicao-fabs.js é carregado
  // também pelo logistica-mobile, e a folha é só do desktop.
  // getMes: a folha segue o mês navegado na matriz (setas/seletor do
  // cabeçalho). Imprimir sempre o mês corrente enquanto a tela mostra julho
  // entregaria um papel que não bate com o que está na frente do usuário.
  if (window.medicaoPdf) window.medicaoPdf.montar({
    getPosto:  () => POSTO_ATUAL,
    getPostos: () => TODOS_POSTOS,
    getMes:    () => (window.matrizMedicao ? window.matrizMedicao.mesAtual() : null),
  });

  // Faixa de alterações de medição no topo da aba Medição (#tab-matriz).
  if (window.medicaoAlteracoes) window.medicaoAlteracoes.montar(document.getElementById('tab-matriz'));

  // A URL MANDA, quando ela diz algo. Antes do carregarPostos porque ela
  // pode trazer um posto, e o carregarPostos é quem sabe a hora de
  // aplicá-lo sem dobrar a chamada.
  pbMontar();   // campo de busca por cima do <select> de posto
  if (!aplicarHash()) gravarHash();
  carregarPostos();
  if (escolha !== 'desktop') {
    // Sem preferência salva: mostra a tela de escolha por cima do app.
    document.getElementById('tela-escolha').style.display = 'flex';
  }
});
