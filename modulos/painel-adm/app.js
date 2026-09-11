// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/app.js
// Painel ADM desktop (esqueleto). Tela de escolha Desktop/Mobile +
// navegação por abas (placeholders). SEM lógica de dados ainda.
// Depende de: config.js, api.js, auth.js (carregados antes).
// ================================================================

// ── Proteção de rota ────────────────────────────────────────────
const USUARIO = exigirSessao(['ADM']);

const CHAVE_VERSAO = 'jb_adm_versao'; // 'desktop' | 'mobile'

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

// ── Topbar ──────────────────────────────────────────────────────
function preencherTopbar() {
  if (!USUARIO) return;
  const nome = USUARIO.nome || USUARIO.email || '—';
  document.getElementById('app-usuario').textContent = nome;
  document.getElementById('app-perfil').textContent  = USUARIO.perfil || '—';
  document.getElementById('app-avatar').textContent   = nome.trim().slice(0, 2).toUpperCase();
}

// ── Escolha Desktop/Mobile ──────────────────────────────────────
function irParaMobile() {
  // Atualiza a escolha só se o usuário já tinha pedido pra lembrar.
  if (localStorage.getItem(CHAVE_VERSAO)) localStorage.setItem(CHAVE_VERSAO, 'mobile');
  window.location.href = caminhoRaiz() + 'modulos/admin/';
}

// Chamada pelos botões da tela de escolha.
function escolherVersao(versao) {
  const lembrar = document.getElementById('chk-lembrar')?.checked;
  if (lembrar) localStorage.setItem(CHAVE_VERSAO, versao);
  if (versao === 'mobile') {
    window.location.href = caminhoRaiz() + 'modulos/admin/';
    return;
  }
  abrirPainelDesktop();
}

function abrirPainelDesktop() {
  document.getElementById('tela-escolha').style.display = 'none';
  document.getElementById('screen-app').style.display = 'flex';
  preencherTopbar();
  // Comparação é a aba ativa por padrão — carrega já e liga o auto-refresh.
  carregarDadosComparar();
  iniciarAutoRefreshComparar();
}

// ── Navegação por abas ──────────────────────────────────────────
function setTab(btn, tab) {
  document.querySelectorAll('.bnav .nbtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.pa-main .scr').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('s-' + tab)?.classList.add('active');
  if (tab === 'comp' && !comparaCarregado) carregarDadosComparar();
  // Coleta (revisão) — mesmo render do painel mobile (coleta-revisao.js).
  if (tab === 'coleta') renderColetaRevisao(document.getElementById('s-coleta'));
  // Medição — ADM define o pré-pedido (medicao.js expõe renderMedicao em window).
  if (tab === 'medicao') renderMedicao(document.getElementById('s-medicao'));
  // Relatórios — hospeda DUAS vistas (relatórios da rede e DRE). Ver
  // renderRelatArea: o setTab acabou de limpar o `active` de TODAS as .scr,
  // e o #s-dre é uma delas (está aninhado dentro do #s-relat), então quem
  // repõe o estado da vista escolhida é ela.
  if (tab === 'relat') renderRelatArea();
  // Custo & Margem — mesmo JS da Logística; ADM entra em modo só-leitura (sem edição).
  if (tab === 'custo') renderCustoMargem(document.getElementById('s-custo'));
  // Mais+ — aba KPI (sugestão de pedido; kpi.js expõe renderKpi em window).
  if (tab === 'mais') renderKpi(document.getElementById('s-mais'));
  // Demais abas (mapa/histórico) entram nos próximos blocos.
}

// ── Aba RELATÓRIOS: duas vistas, uma área ────────────────────────
// O DRE era aba do topo e passou a ser uma vista aqui dentro. NADA do DRE
// mudou: mesmo dre.js, mesmo renderDre, mesma section #s-dre (com o id
// preservado, porque os ~210 seletores de CSS dele são `#s-dre .algo`), e o
// mesmo arquivo continua servindo o admin mobile.
// AS VISTAS DA ABA, num MAPA e não num if/else: o terceiro relatório
// (Mercado) entra como uma linha aqui, e o resto da função não muda.
// 'relat' (a lista de PDFs) não está no mapa de propósito — ela é o que
// aparece quando NENHUMA vista está aberta, não uma vista a mais.
const REL_VISTAS = {
  dre: { sec: 's-dre', botao: 'rel-btn-dre', render: (el) => renderDre(el) },
  mov: { sec: 's-movmes', botao: 'rel-btn-mov', render: (el) => renderMovMes(el) },
  mercado: { sec: 's-mercado', botao: 'rel-btn-mercado', render: (el) => renderMercado(el) },
};
let _relatVista = 'relat';

function renderRelatArea() {
  const lista = document.getElementById('s-relat-lista');
  const aberta = REL_VISTAS[_relatVista] || null;
  if (lista) lista.hidden = !!aberta;

  Object.keys(REL_VISTAS).forEach((k) => {
    const v = REL_VISTAS[k];
    const sec = document.getElementById(v.sec);
    const btn = document.getElementById(v.botao);
    const ativa = (k === _relatVista);
    // As sections são .scr: quem manda na visibilidade é a classe `active`
    // (.scr{display:none} / #s-dre.active{display:block}, injetada pelo próprio
    // dre.js; a gêmea do #s-movmes vem do shared/css/mov-mes.css). `hidden` não
    // bastaria aqui — o seletor de id com classe vence o atributo.
    if (sec) sec.classList.toggle('active', ativa);
    // O botão fica ACESO enquanto o relatório está aberto, e é por ele que se
    // volta. aria-pressed, e não aria-expanded: é botão de estado numa barra.
    if (btn) {
      btn.classList.toggle('active', ativa);
      btn.setAttribute('aria-pressed', ativa ? 'true' : 'false');
    }
    // Render SOB DEMANDA e SÓ da vista visível: cada relatório faz o próprio
    // GET e não deve disparar para quem abriu o outro. Todos são idempotentes
    // (guardam o próprio shell), então reentrar não remonta nada.
    if (ativa && sec) v.render(sec);
  });

  if (!aberta) renderRelatorios(lista);
}

// Um botão por relatório, e o MESMO botão fecha. NÃO mexe na .bnav:
// continua-se na aba Relatórios.
function relAbrir(vista) {
  _relatVista = (_relatVista === vista) ? 'relat' : vista;
  renderRelatArea();
}

// ================================================================
// ABA COMPARAÇÃO — clonada da Compara mobile (modulos/admin/app.js),
// mesma fonte de dados (shared/js/coletas-service.js → GET /coletas)
// e MAP_POSTOS/SUPCOR_MAP (shared/js/postos-mapa.js). Layout desktop.
// ================================================================
let G_COMPARACAO = {};
let G_MEDIA_DETALHE = null;
let comparaCarregado = false;
const INTERVALO_ATUALIZACAO = 5 * 60 * 1000;
let _cmpRefreshTimer = null;

const CMP_FUELS = [
  { key: 'ET',   label: 'Etanol' },
  { key: 'GC',   label: 'Comum' },
  { key: 'GA',   label: 'Aditiv.' },
  { key: 'S10',  label: 'Diesel S10' },
];
const CMP_STRATS = [
  { key: 'agg',  label: 'Agressivo', desc: '1 centavo abaixo do concorrente mais barato — ganha volume.' },
  { key: 'avg',  label: 'Na média',  desc: 'Média dos concorrentes coletados — equilíbrio.' },
  { key: 'prem', label: 'Premium',   desc: '1 centavo acima do mais caro — protege margem.' },
];
let G_CMP_FUEL = 'GC';
let G_CMP_STRAT = 'avg';
let G_CMP_REG = '';
let G_CMP_BAND = '';
let G_CMP_REDE = '';   // filtro de REDE do concorrente ('' = todas)
let G_CMP_POSTO = '';
let G_CMP_SO_MUDOU = false;
let G_CMP_ABAIXO = false; // chip "abaixo do nosso" (independente do "acima")
let G_CMP_ACIMA  = false; // chip "acima do nosso"  (independente do "abaixo")
let G_CMP_ORD = ''; // '' = alfabético | 'barato' = preço Você asc | 'caro' = desc

// Estado dos filtros no formato que o shared/js/comparacao-card.js espera.
// Montado na hora da chamada, não guardado: estes let mudam a cada clique
// de chip e um snapshot velho renderizaria o card com o filtro anterior.
function cmpOpcoes() {
  return {
    fuel:    G_CMP_FUEL,
    strat:   G_CMP_STRAT,
    ord:     G_CMP_ORD,
    abaixo:  G_CMP_ABAIXO,
    acima:   G_CMP_ACIMA,
    soMudou: G_CMP_SO_MUDOU,
  };
}

async function carregarDadosComparar() {
  document.getElementById('upd-txt').textContent = 'Buscando dados...';
  try {
    G_COMPARACAO = await buscarComparacaoDoDia({ dias: 15 });
    await cmpAplicarRevisoes(G_COMPARACAO); // sobrepõe os preços editados de hoje no "Você"
    comparaCarregado = true;
    if (!document.getElementById('cmp-posto').dataset.populado) popularFiltrosComparar();
    processarKPIsComparar();
    renderComparar();
    const agora = new Date();
    document.getElementById('upd-txt').textContent =
      `Atualizado às ${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')} · próxima em 5min`;
  } catch (err) {
    console.error('Erro ao carregar dados da Compara:', err);
    document.getElementById('upd-txt').textContent = 'Erro ao carregar — tenta de novo (↻)';
  }
}

function popularFiltrosComparar() {
  const selPosto = document.getElementById('cmp-posto');
  const selReg = document.getElementById('cmp-sup'); // id mantido; agora é filtro de REGIÃO
  const selBand = document.getElementById('cmp-band');
  const selRede = document.getElementById('cmp-rede');
  // Bandeira e rede saem dos CONCORRENTES carregados (banco, via /coletas →
  // concorrentes), NÃO do MAP_POSTOS estático. Só valores realmente presentes.
  const conc = Object.values(G_COMPARACAO).flatMap(d => (d && d.concorrentes) || []);
  const bandas = [...new Set(conc.map(c => c.bandeira).filter(Boolean))].sort();
  const redes  = [...new Set(conc.map(c => c.rede).filter(Boolean))].sort();
  selPosto.innerHTML = '<option value="">Todos os postos</option>' +
    MAP_POSTOS.slice().sort((a, b) => a.ap.localeCompare(b.ap)).map(p => `<option value="${p.k}">${p.ap}</option>`).join('');
  selReg.innerHTML = '<option value="">Todas regiões</option>'
    + '<option value="metro">Metropolitana</option>'
    + '<option value="sjdr">São João del Rei</option>';
  selBand.innerHTML = '<option value="">Todas bandeiras</option>' + bandas.map(b => `<option value="${b}">${b}</option>`).join('');
  if (selRede) selRede.innerHTML = '<option value="">Todas redes</option>' + redes.map(r => `<option value="${r}">${r}</option>`).join('');
  selPosto.dataset.populado = '1';
}

function processarKPIsComparar() {
  const hoje = hojeBR();
  let lancaramHoje = 0, concorrentesHoje = 0;
  let somaGcProprio = 0, contGcProprio = 0;

  MAP_POSTOS.forEach(posto => {
    const dado = G_COMPARACAO[posto.k];
    if (!dado) return;
    if (dado.proprio && !dado.proprioDesatualizado) lancaramHoje++;
    if (dado.proprio && dado.proprio.GC !== null && dado.proprio.GC !== undefined) {
      somaGcProprio += Number(dado.proprio.GC); contGcProprio++;
    }
    dado.concorrentes.forEach(c => { if (!c.desatualizado) concorrentesHoje++; });
  });

  const totalPostos = MAP_POSTOS.length;
  document.getElementById('kv-proprios').textContent = lancaramHoje;
  const faltam = totalPostos - lancaramHoje;
  document.getElementById('kv-proprios-sub').textContent =
    faltam > 0 ? `de ${totalPostos} · faltam ${faltam}` : `de ${totalPostos} · completo ✓`;
  document.getElementById('kv-concs').textContent = concorrentesHoje;

  const mediaGc = calcularMediaHierarquica(MAP_POSTOS, 'GC');
  document.getElementById('kv-gc').textContent = mediaGc !== null ? fmtPrecoBRL(mediaGc) : '--';
  document.getElementById('kv-mgc').textContent = contGcProprio > 0 ? fmtPrecoBRL(somaGcProprio / contGcProprio) : '--';

  void hoje;
}

function calcularMediaHierarquica(postosArr, fuel) {
  const porPosto = [];
  postosArr.forEach(posto => {
    const dado = G_COMPARACAO[posto.k];
    if (!dado) return;
    const valores = dado.concorrentes
      .map(c => c.registro[fuel])
      .filter(v => v !== null && v !== undefined);
    if (!valores.length) return;
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    porPosto.push({ posto: posto.ap, sup: posto.sup, media });
  });
  const porSupervisor = {};
  porPosto.forEach(p => {
    if (!porSupervisor[p.sup]) porSupervisor[p.sup] = [];
    porSupervisor[p.sup].push(p);
  });
  const mediaPorSupervisor = {};
  Object.keys(porSupervisor).forEach(sup => {
    const arr = porSupervisor[sup];
    const media = arr.reduce((s, x) => s + x.media, 0) / arr.length;
    mediaPorSupervisor[sup] = { media, postos: arr };
  });
  const supKeys = Object.keys(mediaPorSupervisor);
  if (!supKeys.length) { G_MEDIA_DETALHE = null; return null; }
  const mediaGeral = supKeys.reduce((s, k) => s + mediaPorSupervisor[k].media, 0) / supKeys.length;
  G_MEDIA_DETALHE = { mediaPorSupervisor, mediaGeral };
  return mediaGeral;
}

function abrirDetalheMedia() {
  document.getElementById('modal-media').classList.add('open');
  renderDetalheMedia();
}
function fecharMedia(e) { if (e.target.id === 'modal-media') fecharMediaBtn(); }
function fecharMediaBtn() { document.getElementById('modal-media').classList.remove('open'); }

// ── Modal "Lançaram | Faltam" (rede toda, ignora filtros) ─────────
function abrirFaltam() {
  renderFaltam();
  document.getElementById('modal-faltam').classList.add('open');
}
function fecharFaltam(e) { if (e.target.id === 'modal-faltam') fecharFaltamBtn(); }
function fecharFaltamBtn() { document.getElementById('modal-faltam').classList.remove('open'); }

function renderFaltam(){
  const lancaram = [];
  const faltam = [];
  MAP_POSTOS.slice().sort((a,b)=>a.ap.localeCompare(b.ap)).forEach(p => {
    const d = G_COMPARACAO[p.k];
    const ok = d && d.proprio && !d.proprioDesatualizado;
    if (ok) lancaram.push({ p, ger: (d.proprio && d.proprio.gerente) ? d.proprio.gerente : '' });
    else faltam.push({ p });
  });
  const linha = (nome, sub) =>
    `<div style="background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:8px;margin-bottom:5px">
       <div style="font-size:12px;font-weight:600;color:var(--tx)">${nome}</div>
       <div style="font-size:11px;color:var(--tx2)">${sub}</div>
     </div>`;
  const colL = lancaram.map(x => linha(x.p.ap, x.ger ? `${x.ger} · ${x.p.sup}` : x.p.sup)).join('') || '<div style="font-size:11px;color:var(--tx3)">nenhum</div>';
  const colF = faltam.map(x => linha(x.p.ap, x.p.sup)).join('') || '<div style="font-size:11px;color:var(--tx3)">nenhum ✓</div>';
  document.getElementById('faltam-body').innerHTML =
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
       <div>
         <div style="font-size:11px;font-weight:600;color:var(--ok);margin-bottom:6px">✓ LANÇARAM (${lancaram.length})</div>
         ${colL}
       </div>
       <div>
         <div style="font-size:11px;font-weight:600;color:var(--wn);margin-bottom:6px">⏳ FALTAM (${faltam.length})</div>
         ${colF}
       </div>
     </div>`;
}

function renderDetalheMedia() {
  const body = document.getElementById('media-detalhe-body');
  if (!G_MEDIA_DETALHE) { body.innerHTML = '<div class="empty">Sem dados de concorrentes coletados.</div>'; return; }
  const { mediaPorSupervisor, mediaGeral } = G_MEDIA_DETALHE;
  let html = `<div class="ccard" style="margin-bottom:.6rem;text-align:center">
    <div class="cclbl">MÉDIA GERAL DA REDE</div>
    <div style="font-family:var(--mono);font-size:1.4rem;font-weight:700;color:var(--inf)">${fmtPrecoBRL(mediaGeral)}</div>
    <div style="font-size:.62rem;color:var(--tx3)">Média das ${Object.keys(mediaPorSupervisor).length} médias regionais abaixo</div>
  </div>`;
  Object.keys(mediaPorSupervisor).forEach(sup => {
    const { media, postos } = mediaPorSupervisor[sup];
    const cor = SUPCOR_MAP[sup] || '#8892a4';
    html += `<div class="reg-sup" style="margin-bottom:.5rem">
      <div class="reg-sup-hdr">
        <div class="reg-sup-nome" style="color:${cor}">${sup}</div>
        <div style="font-family:var(--mono);font-weight:700;color:${cor}">${fmtPrecoBRL(media)}</div>
      </div><div class="reg-posto-list">`;
    postos.forEach(p => {
      html += `<div class="reg-posto"><span>${p.posto}</span><span style="font-family:var(--mono)">${fmtPrecoBRL(p.media)}</span></div>`;
    });
    html += `</div></div>`;
  });
  body.innerHTML = html;
}

function montarFuelTabsComparar() {
  const wrap = document.getElementById('cmp-fuel-tabs');
  wrap.innerHTML = CMP_FUELS.map(f =>
    `<button class="fueltab${f.key === G_CMP_FUEL ? ' active' : ''}" onclick="cmpSetFuel('${f.key}')">${f.label}</button>`
  ).join('');
}
function montarStratTabsComparar() {
  const wrap = document.getElementById('cmp-strat-tabs');
  wrap.innerHTML = CMP_STRATS.map(s =>
    `<button class="strat-tab${s.key === G_CMP_STRAT ? ' active' : ''}" onclick="cmpSetStrat('${s.key}')">${s.label}</button>`
  ).join('');
  const atual = CMP_STRATS.find(s => s.key === G_CMP_STRAT);
  document.getElementById('cmp-strat-desc').textContent = atual ? atual.desc : '';
}

function cmpSetFuel(key)  { G_CMP_FUEL  = key; renderComparar(); }
function cmpSetStrat(key) { G_CMP_STRAT = key; renderComparar(); }
function cmpSetReg(val)   { G_CMP_REG   = val; renderComparar(); }
function cmpSetBand(val)  { G_CMP_BAND  = val; renderComparar(); }
function cmpSetRede(val)  { G_CMP_REDE  = val; renderComparar(); }
function cmpSetPosto(val) { G_CMP_POSTO = val; renderComparar(); }
// Toggle: clicar no botão ativo desliga (volta pro alfabético).
function cmpSetOrd(val)   { G_CMP_ORD = (G_CMP_ORD === val) ? '' : val; renderComparar(); }

// Renderiza os 2 botões de ordenação por preço no container #cmp-ord-btns.
// Cores do tema: verde (--ok) p/ "mais barato", vermelho (--dg) p/ "mais caro".
// Ativo = fundo levemente preenchido + borda na cor cheia.
function cmpMontarOrdBtns() {
  const wrap = document.getElementById('cmp-ord-btns');
  if (!wrap) return;
  const bAtivo = G_CMP_ORD === 'barato';
  const cAtivo = G_CMP_ORD === 'caro';
  wrap.innerHTML =
      `<button class="ftag" onclick="cmpSetOrd('barato')" style="color:var(--ok);`
    + `border-color:${bAtivo ? 'var(--ok)' : 'rgba(0,229,160,.35)'};`
    + `background:${bAtivo ? 'rgba(0,229,160,.15)' : 'transparent'}">↓ Mais barato</button>`
    + `<button class="ftag" onclick="cmpSetOrd('caro')" style="color:var(--dg);`
    + `border-color:${cAtivo ? 'var(--dg)' : 'rgba(255,107,107,.35)'};`
    + `background:${cAtivo ? 'rgba(255,107,107,.15)' : 'transparent'}">↑ Mais caro</button>`;
}
function cmpToggleSoMudou(chk) { G_CMP_SO_MUDOU = chk.checked; renderComparar(); }

// Chips de distância (Abaixo/Acima do nosso + Limpar) ficam INERTES com o filtro
// "Só quem mudou" ligado — a distância até o nosso preço sai da tela. Botão que
// não responde é pior que ausente: desabilita visualmente (.chip-inerte =
// opacidade + cursor default + pointer-events none) e reabilita ao desligar.
function cmpAtualizarChipsFaixa() {
  const inerte = G_CMP_SO_MUDOU;
  ['flt-abaixo', 'flt-acima', 'flt-todos-preco'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('chip-inerte', inerte);
  });
}

// Chips independentes: 'abaixo' e 'acima' alternam sozinhos (podem os 2
// ativos ao mesmo tempo); 'todos' = limpar os dois. `btn` não é mais usado
// (o estado manda no visual), mantido só p/ compat com o onclick do HTML.
function cmpSetFaixaPreco(btn, faixa) {
  if (faixa === 'abaixo')      G_CMP_ABAIXO = !G_CMP_ABAIXO;
  else if (faixa === 'acima')  G_CMP_ACIMA  = !G_CMP_ACIMA;
  else                         { G_CMP_ABAIXO = false; G_CMP_ACIMA = false; } // 'todos' = limpar
  const bA = document.getElementById('flt-abaixo');
  const bC = document.getElementById('flt-acima');
  const bL = document.getElementById('flt-todos-preco');
  if (bA) bA.classList.toggle('active', G_CMP_ABAIXO);
  if (bC) bC.classList.toggle('active', G_CMP_ACIMA);
  if (bL) bL.style.display = (G_CMP_ABAIXO || G_CMP_ACIMA) ? '' : 'none';
  renderComparar();
}

// ════════════════════════════════════════════════════════════════
// O CARD DA COMPARAÇÃO MUDOU DE CASA: shared/js/comparacao-card.js.
// De lá vêm cmpCardMatriz, cmpCalcCard, cmpStatsFuel, cmpSugeridoMatriz
// e os auxiliares CMP_FUELS_CARD, fmtPrecoBRL, seloDesatualizado e
// idSafe — este arquivo os consome pelo window, e o <script> do módulo
// carrega ANTES deste. Vivia duplicado aqui e no outro painel.
//
// O LÁPIS FICOU: cmpEditarVoce / cmpConfirmarVoce / cmpSalvarPrecoProprio
// / cmpCriarSolicitacao falam com a API e mexem no estado desta tela.
//
// Os filtros viraram parâmetro do card (ele não lê mais os G_CMP_* por
// escopo global); cmpOpcoes(), lá em cima junto dos let, é quem os empacota.
// ════════════════════════════════════════════════════════════════

// ── Ganchos do lápis (shared/js/comparacao-card.js) ──────────────
// O cmpEditarVoce/cmpConfirmarVoce vivem no módulo compartilhado, e o que
// eles não podem saber é (a) onde esta tela guarda a comparação e (b) o que
// esta tela faz depois de salvar. As duas coisas entram por aqui.
//
// O corpo do cmpAposSalvarPreco é a CAUDA ORIGINAL do cmpConfirmarVoce,
// movida sem alterar: o convite do GA, o re-render e o ✓ por combustível.
// Nos caminhos de desistência (preço inválido, preço igual) ele é chamado
// com salvou:false e flashFuels vazio, o que executa só o renderComparar()
// — exatamente o que aquelas linhas faziam antes.
window.cmpDadoDoPosto = (k) => G_COMPARACAO[k];

window.cmpAposSalvarPreco = async (ctx) => {
  // Regra do GA — NUNCA automático: ao salvar GC, oferece GA = GC + diferencial
  // do posto (dado.diferencial_ga, padrão 0,30).
  if (ctx.salvou && ctx.fuel === 'GC') {
    const dado = ctx.dado;
    const difGa = (dado && dado.diferencial_ga != null) ? Number(dado.diferencial_ga) : 0.30;
    const alvoGA = ctx.novo + difGa;
    if (window.confirm(`Aplicar também GA (aditivada) = GC + ${difGa.toFixed(2).replace('.', ',')} = R$ ${alvoGA.toFixed(2).replace('.', ',')}?`)) {
      const origGA = (dado.proprio && dado.proprio['GA'] !== null && dado.proprio['GA'] !== undefined) ? Number(dado.proprio['GA']) : null;
      const okGA = await cmpSalvarPrecoProprio(ctx.posto.ap, 'GA', alvoGA, origGA);
      if (okGA) {
        dado.proprio['GA'] = alvoGA;
        // GA também SEMPRE gera solicitação — só pula se o valor não mudou.
        if ((origGA === null || Math.abs(alvoGA - origGA) >= 0.005)
            && await cmpCriarSolicitacao(ctx.posto.ap, 'GA', origGA, alvoGA)) ctx.flashFuels.push('GA');
      }
    }
  }
  renderComparar();
  ctx.flashFuels.forEach(ff => cmpFlashCheck(ctx.k, ff));
};

// O overlay de revisões (cmpAplicarRevisoes) e as duas chamadas do lápis
// (cmpSalvarPrecoProprio / cmpCriarSolicitacao) também moraram aqui e hoje
// vêm do shared/js/comparacao-card.js, junto do cmpHojeISO que as três
// usam. O que ficou neste arquivo é só a parte que mexe em DOM e em estado
// desta tela: cmpEditarVoce, cmpConfirmarVoce e cmpFlashCheck.

// Concorrente `c` mudou de preço no combustível `f` entre ontem e hoje?
// Fonte de ontem = c.registroOntem (mesma origem que o filtro antigo usava).
// Só conta se o dado de hoje NÃO está desatualizado, tem leitura de ontem e
// |Δ| >= 0,5 centavo. Sem preço em algum lado → não conta.
function cmpConcMudou(c, f) {
  if (!c || c.desatualizado) return false;
  const h = c.registro ? c.registro[f] : undefined;
  const o = c.registroOntem ? c.registroOntem[f] : undefined;
  return h !== null && h !== undefined && o !== null && o !== undefined
    && Math.abs(Number(h) - Number(o)) >= 0.005;
}

// Filtros por POSTO na matriz, SEMPRE relativos ao combustível ativo
// (G_CMP_FUEL). AND lógico entre eles + com região/posto/bandeira. O mesmo
// critério pinta as células em cmpCardMatriz (esconder + destacar).
function cmpPostoPassaFiltros(dado) {
  const f = G_CMP_FUEL;
  const concs = dado.concorrentes || [];

  // 1) Só quem mudou de ontem→hoje: passa se ALGUM concorrente mudou no
  //    combustível ATIVO.
  if (G_CMP_SO_MUDOU && !concs.some(c => cmpConcMudou(c, f))) return false;

  // 2) Abaixo/Acima do nosso (chips independentes): passa se ALGUM
  //    concorrente estiver abaixo (ou acima) do nosso proprio[f] no
  //    combustível ativo. Sem proprio (sem base) → esconde se algum chip on.
  if (G_CMP_ABAIXO || G_CMP_ACIMA) {
    const ov = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined) ? Number(dado.proprio[f]) : null;
    if (ov === null) return false;
    const algum = concs.some(c => {
      const cv = (c.registro && c.registro[f] !== null && c.registro[f] !== undefined) ? Number(c.registro[f]) : null;
      if (cv === null) return false;
      const d = cv - ov;
      return (G_CMP_ABAIXO && d < -0.005) || (G_CMP_ACIMA && d > 0.005);
    });
    if (!algum) return false;
  }

  return true;
}

// Melhor preço do card inteiro no fuel `f`, sob a ótica da ordenação: menor
// (ord 'barato') ou maior (ord 'caro') entre a linha Você e TODOS os
// concorrentes. null se ninguém tem preço no fuel (card vai pro fim da lista).
function cmpMelhorPrecoCard(dado, f, ord) {
  if (!dado) return null;
  const precos = [];
  if (dado.proprio && dado.proprio[f] != null) precos.push(Number(dado.proprio[f]));
  (dado.concorrentes || []).forEach(c => {
    if (c.registro && c.registro[f] != null) precos.push(Number(c.registro[f]));
  });
  if (!precos.length) return null;
  return ord === 'caro' ? Math.max(...precos) : Math.min(...precos);
}

// Card do filtro "Só quem mudou". A unidade passa a ser CONCORRENTE + COMBUSTÍVEL:
// só entra a combinação cujo preço de HOJE difere do de ONTEM, e a coluna "Mudou"
// mostra a variação do PRÓPRIO concorrente (hoje − ontem), não a distância até o
// nosso preço. Concorrente SEM coleta de ontem NÃO aparece (motivo real:
// coleta salva antes da IA ler a foto — vira verificação no Painel TI, não ruído
// aqui); as linhas omitidas são só CONTADAS para o log. Retorna { html:'', ... }
// quando o posto não tem nenhuma mudança → o card some da tela.
// Duas tabelas empilhadas, grades independentes: em cima a linha "Você" (azul,
// 1 coluna por combustível); embaixo as mudanças (5 colunas).
// Cores da tela: verde var(--ok) subiu · vermelho var(--dg) desceu.
function cmpCardMudancas(posto, dado) {
  const num = (v) => (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) ? Number(v) : null;
  const ordFuel = {}; CMP_FUELS_CARD.forEach((f, i) => { ordFuel[f.key] = i; });
  const linhas = [];
  let mudancas = 0, omitidas = 0;

  (dado.concorrentes || []).forEach(c => {
    CMP_FUELS_CARD.forEach(f => {
      const hoje = c.registro ? num(c.registro[f.key]) : null;
      if (hoje === null) return;                          // sem preço hoje → nada a mostrar
      const ontem = c.registroOntem ? num(c.registroOntem[f.key]) : null;
      if (ontem === null) { omitidas++; return; }         // sem base de ontem → NÃO entra (só conta)
      const d = hoje - ontem;
      if (Math.abs(d) < 0.005) return;                    // não mudou → some
      mudancas++;
      linhas.push({ nome: c.nome, comb: f.btn, ordF: ordFuel[f.key], ontem, hoje,
        mudouTxt: (d > 0 ? '+' : '') + Math.round(d * 100) + 'c',
        cor: d > 0 ? 'var(--ok)' : 'var(--dg)' });
    });
  });

  if (!linhas.length) return { html: '', mudancas: 0, omitidas };

  // Concorrente (alfabético) e, dentro, ordem canônica dos combustíveis.
  linhas.sort((a, b) => a.nome.localeCompare(b.nome) || (a.ordF - b.ordF));

  // ── Tabela de cima: linha "Você" em azul (reaproveita cmpm-row-voce/-rowlbl/
  // -preco da matriz — mesmo destaque, sem cor nova). 1 coluna por combustível. ──
  const voceHead = CMP_FUELS_CARD.map(f => `<th><span class="cmpm-colh">${f.btn}</span></th>`).join('');
  const voceCells = CMP_FUELS_CARD.map(f => {
    const v = (dado.proprio && dado.proprio[f.key] != null) ? Number(dado.proprio[f.key]) : null;
    return `<td>${v !== null ? `<span class="cmpm-preco">${fmtPrecoBRL(v)}</span>` : '<span class="cmpm-na">—</span>'}</td>`;
  }).join('');
  const voceTable = `<table class="cmpm-table cmpc-voce-table">
    <thead><tr><th class="cmpm-rowlbl"></th>${voceHead}</tr></thead>
    <tbody><tr class="cmpm-row-voce"><th class="cmpm-rowlbl">Você</th>${voceCells}</tr></tbody>
  </table>`;

  // ── Tabela de baixo: as mudanças (conc + comb) ──
  const rows = linhas.map(l => `<tr>
      <td class="cmpc-nome" title="${l.nome}">${l.nome}</td>
      <td class="cmpc-comb">${l.comb}</td>
      <td class="cmpc-num">${fmtPrecoBRL(l.ontem)}</td>
      <td class="cmpc-num">${fmtPrecoBRL(l.hoje)}</td>
      <td class="cmpc-mudou" style="color:${l.cor}">${l.mudouTxt}</td>
    </tr>`).join('');

  const html = `<div class="region-card cmpc-card" id="cmp-card-${idSafe(posto.k)}">
    <div class="cmpc-hdr">
      <span class="region-nome cmpc-posto">${posto.ap}</span>
      <span class="cmpc-count">${mudancas} mudança${mudancas === 1 ? '' : 's'}</span>
    </div>
    <div class="cmpc-wrap">${voceTable}</div>
    <div class="cmpc-wrap"><table class="cmpc-table">
      <thead><tr><th>Concorrente</th><th>Comb</th><th>Ontem</th><th>Hoje</th><th>Mudou</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
  return { html, mudancas, omitidas };
}

function renderComparar() {
  montarFuelTabsComparar();
  montarStratTabsComparar();
  cmpMontarOrdBtns();
  cmpAtualizarChipsFaixa();

  const fuel = G_CMP_FUEL;

  const ordAtivo = (G_CMP_ORD === 'barato' || G_CMP_ORD === 'caro');

  // Bandeira e REDE recortam os CONCORRENTES (não os nossos postos): o card do
  // meu posto continua, somem as linhas de concorrente fora do grupo; posto sem
  // nenhum concorrente no grupo some inteiro (no loop). Alimenta também as médias
  // e a ordenação, pra comparar meu preço SÓ contra o grupo selecionado.
  const filtroConcAtivo = !!(G_CMP_BAND || G_CMP_REDE);
  const concPassa = (c) => (!G_CMP_BAND || c.bandeira === G_CMP_BAND) && (!G_CMP_REDE || c.rede === G_CMP_REDE);
  const dadoFiltrado = (k) => {
    const d = G_COMPARACAO[k] || { proprio: null, proprioDesatualizado: false, concorrentes: [] };
    return filtroConcAtivo ? { ...d, concorrentes: (d.concorrentes || []).filter(concPassa) } : d;
  };

  const postos = MAP_POSTOS.filter(p => {
    if (G_CMP_POSTO && p.k !== G_CMP_POSTO) return false;
    if (G_CMP_REG  && p.reg  !== G_CMP_REG)  return false;
    return true;
  });
  if (ordAtivo) {
    // Ranking pelo MELHOR preço do card no fuel ativo (min no 'barato', max no
    // 'caro'). Cards sem preço nenhum no fuel vão pro fim; entre eles, alfabético.
    postos.sort((a, b) => {
      const pa = cmpMelhorPrecoCard(dadoFiltrado(a.k), fuel, G_CMP_ORD);
      const pb = cmpMelhorPrecoCard(dadoFiltrado(b.k), fuel, G_CMP_ORD);
      if (pa === null && pb === null) return a.ap.localeCompare(b.ap);
      if (pa === null) return 1;
      if (pb === null) return -1;
      return G_CMP_ORD === 'barato' ? pa - pb : pb - pa;
    });
  } else {
    postos.sort((a, b) => a.ap.localeCompare(b.ap));
  }

  let somaMinha = 0, contMinha = 0, somaConc = 0, contConc = 0;
  let cardsHtml = '';
  let posOrd = 0; // posição só entre os cards efetivamente renderizados
  let totMudancas = 0, totOmitidas = 0; // só usados com o filtro ligado

  postos.forEach(posto => {
    const dado = dadoFiltrado(posto.k);

    // Filtro de grupo ativo e sem NENHUM concorrente no grupo → card some inteiro
    // (e o posto não entra nas médias do rodapé).
    if (filtroConcAtivo && !dado.concorrentes.length) return;

    // Agregados do rodapé (Minha média / Média concorrência) continuam no
    // combustível GLOBAL (G_CMP_FUEL) — a matriz não altera isso. Com filtro
    // ligado, refletem só o grupo selecionado (dado já vem recortado).
    const glob = cmpCalcCard(dado, fuel, cmpOpcoes());
    if (glob.ownVal !== null) { somaMinha += glob.ownVal; contMinha++; }
    glob.competidores.forEach(c => { somaConc += c.preco; contConc++; });

    // Card visível se o posto tem QUALQUER dado (próprio ou concorrente).
    if (!dado.proprio && !dado.concorrentes.length) return;

    if (G_CMP_SO_MUDOU) {
      // Filtro ligado: layout de variações (conc + comb). Some se não há
      // nenhuma linha (nem mudança, nem sem-base). Abaixo/Acima (distância até o
      // nosso preço) não se aplicam aqui — a distância sai da tela.
      const r = cmpCardMudancas(posto, dado);
      totMudancas += r.mudancas; totOmitidas += r.omitidas;   // omitidas conta mesmo se o card sumir
      if (!r.html) return;
      posOrd += 1;
      cardsHtml += r.html;
    } else {
      // Filtro desligado: comportamento atual, intacto.
      if (!cmpPostoPassaFiltros(dado)) return;
      posOrd += 1;
      cardsHtml += cmpCardMatriz(posto, dado, ordAtivo ? posOrd : null, cmpOpcoes());
    }
  });

  document.getElementById('cmp-regions').innerHTML = cardsHtml || '<div class="empty">Nenhum posto para esse filtro.</div>';
  if (G_CMP_SO_MUDOU) {
    console.info(`[Comparação] "só quem mudou": ${totMudancas} mudança(s), ${totOmitidas} omitida(s) por falta de base, ${posOrd} card(s).`);
  }

  const minhaAvg = contMinha ? somaMinha / contMinha : null;
  const concAvg  = contConc  ? somaConc  / contConc  : null;
  let diffTxt = '-', diffCor = 'var(--tx3)';
  if (minhaAvg !== null && concAvg !== null) {
    const d = minhaAvg - concAvg;
    diffCor = d > 0 ? 'var(--dg)' : 'var(--ok)';
    diffTxt = (d > 0 ? '+' : '') + fmtPrecoBRL(Math.abs(d)) + (d > 0 ? ' acima' : ' abaixo');
  }
  document.getElementById('cmp-myavg').innerHTML = `
    <div class="myavg-card mine">
      <div class="myavg-lbl">Minha média</div>
      <div class="myavg-val" style="color:var(--ac)">${minhaAvg !== null ? fmtPrecoBRL(minhaAvg) : '--'}</div>
      <div class="myavg-sub" style="color:var(--ac)">${contMinha} posto(s)</div>
    </div>
    <div class="myavg-card comp">
      <div class="myavg-lbl">Média concorrência</div>
      <div class="myavg-val">${concAvg !== null ? fmtPrecoBRL(concAvg) : '--'}</div>
      <div class="myavg-sub" style="color:${diffCor}">${diffTxt}</div>
    </div>`;

}

// Auto-refresh só quando o painel está aberto e a aba Comparação ativa.
function iniciarAutoRefreshComparar() {
  if (_cmpRefreshTimer) clearInterval(_cmpRefreshTimer);
  _cmpRefreshTimer = setInterval(() => {
    if (!document.hidden && document.getElementById('s-comp')?.classList.contains('active')) {
      carregarDadosComparar();
    }
  }, INTERVALO_ATUALIZACAO);
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return; // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');

  const escolha = localStorage.getItem(CHAVE_VERSAO);
  if (escolha === 'mobile') {
    // Escolha lembrada: vai direto pro mobile.
    window.location.href = caminhoRaiz() + 'modulos/admin/';
  } else if (escolha === 'desktop') {
    // Escolha lembrada: abre o painel direto, sem a tela de escolha.
    abrirPainelDesktop();
  } else {
    // Sem escolha salva: mostra a tela de escolha.
    document.getElementById('tela-escolha').style.display = 'flex';
  }
});
