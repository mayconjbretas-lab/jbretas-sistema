// ================================================================
// JBRETAS SISTEMA — modulos/admin/app.js
// Porte do shell do AppPainel (bottom nav de 6 abas) pro stack novo.
// Camada de dados trocada: em vez de G_DADOS.prop (Apps Script), usa
// shared/js/coletas-service.js (Supabase, via GET /coletas).
//
// Só a aba MAPA está implementada nesta entrega — as outras (Compara,
// Ranking, Regional, Histórico, Mais+) ficam com placeholder "Em
// construção" até a vez delas, na ordem combinada.
// ================================================================

let usuarioAtual = null;
let leafletMap = null;
let markerCluster = null;
let mapMarkers = [];
let G_MAPA_SUP = 'todos';
let G_MAPA_FUEL = 'GC';
let G_MAPA_COLETA = 'todos'; // 'todos' | 'coletados' | 'semcoleta'
let coletasPorPosto = {}; // { [posto.k]: { proprio: [...], concorrentes: [...] } }

const INTERVALO_ATUALIZACAO = 5 * 60 * 1000;
let _autoRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  usuarioAtual = exigirSessao(['ADM']);
  if (!usuarioAtual) return;

  const temaSalvo = localStorage.getItem('jb_theme') || 'dark';
  aplicarTema(temaSalvo);

  await carregarColetas();
  initLeafletInstance();
  iniciarAutoRefresh();
});

function iniciarAutoRefresh() {
  if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
  _autoRefreshTimer = setInterval(() => {
    if (!document.hidden && document.getElementById('s-comp')?.classList.contains('active')) {
      carregarDadosComparar();
    }
  }, INTERVALO_ATUALIZACAO);
}

// ── TEMA CLARO/ESCURO (portado direto do AppPainel) ───────────────
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.className = tema === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  localStorage.setItem('jb_theme', tema);
}
function toggleTheme() {
  const atual = document.documentElement.getAttribute('data-theme') || 'dark';
  aplicarTema(atual === 'dark' ? 'light' : 'dark');
}

// Vai pro Painel ADM desktop. Atualiza a preferência salva (se existir),
// pra manter coerência com o botão "Versão Mobile" do desktop.
function irParaDesktop() {
  if (localStorage.getItem('jb_adm_versao')) localStorage.setItem('jb_adm_versao', 'desktop');
  window.location.href = caminhoRaiz() + 'modulos/painel-adm/';
}

// ── TABS ────────────────────────────────────────────────────────
let comparaCarregado = false;

function setTab(btn, tab) {
  document.querySelectorAll('.nbtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  const sec = document.getElementById('s-' + tab);
  if (sec) sec.classList.add('active');
  if (tab === 'mapa') setTimeout(() => { initLeafletInstance(); }, 150);
  if (tab === 'comp' && !comparaCarregado) carregarDadosComparar();
  if (tab === 'hist') carregarHistorico();
  if (tab === 'coleta') renderColetaRevisao(document.getElementById('s-coleta'));
  // Relatórios — mesmo JS do painel-adm desktop (renderRelatorios em window), sem fork.
  if (tab === 'relat') renderRelatorios(document.getElementById('s-relat'));
  // Fornecedores — dashboard (fornecedores.js expõe renderFornecedores), agora aba do rodapé.
  if (tab === 'forn') renderFornecedores(document.getElementById('s-forn'));
}

function abrirMais() { document.getElementById('modal-mais').classList.add('open'); }

// Custo & Margem (mesmo JS da Logística, sem fork) — aberto pelo item do Mais+.
// Fecha o modal e ativa a section s-custo (não é aba do bnav). ADM = só leitura.
function abrirCustoMobile() {
  document.getElementById('modal-mais').classList.remove('open');
  document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nbtn').forEach(x => x.classList.remove('active'));
  document.getElementById('s-custo').classList.add('active');
  renderCustoMargem(document.getElementById('s-custo'));
}

// Regional — agora acessada pelo Mais+ (o rodapé passou a ter Fornecedores no
// lugar). Sem render/fetch próprio: a section é placeholder, só ativada.
function abrirRegionalMobile() {
  document.getElementById('modal-mais').classList.remove('open');
  document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nbtn').forEach(x => x.classList.remove('active'));
  document.getElementById('s-regional').classList.add('active');
}
function fecharMais(e) { if (e.target.id === 'modal-mais') fecharMaisBtn(); }
function fecharMaisBtn() { document.getElementById('modal-mais').classList.remove('open'); }

// ── DADOS (coletas-service) ────────────────────────────────────────
async function carregarColetas() {
  try {
    coletasPorPosto = await buscarColetasAgrupadas({ dias: 2 });
  } catch (err) {
    console.error('Erro ao carregar coletas:', err);
    coletasPorPosto = {};
  }
}

// ── MAPA (portado de AppPainel/js/app.js renderMapa/initLeafletInstance) ──
function initLeafletInstance() {
  if (leafletMap !== null) { leafletMap.invalidateSize(); return; }
  leafletMap = L.map('leaflet-map', { zoomControl: false }).setView([-19.92, -43.96], 11);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '©OSM ©CARTO', subdomains: 'abcd', maxZoom: 19
  }).addTo(leafletMap);
  markerCluster = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true, showCoverageOnHover: false, removeOutsideVisibleBounds: false })
    : null;
  if (markerCluster) leafletMap.addLayer(markerCluster);
  renderMapa();
}

function mapaFuelChange(val) { G_MAPA_FUEL = val; renderMapa(); }
function mapaSetSup(btn, sup) {
  document.querySelectorAll('#s-mapa .map-ftag[id^="mbtn-"]').forEach(x => x.classList.remove('on'));
  btn.classList.add('on');
  G_MAPA_SUP = sup;
  renderMapa();
}
function mapaSetColeta(btn, val) {
  document.querySelectorAll('[id^="mfiltro-"]').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  G_MAPA_COLETA = val;
  renderMapa();
}

// Preço sempre com 2 casas decimais e vírgula (R$5,89) — correção
// pedida sobre o app antigo, que às vezes mostrava 3 casas com ponto.
function fmtPrecoBRL(v) {
  if (v === null || v === undefined || v === '' || v === '-') return '--';
  return 'R$' + Number(v).toFixed(2).replace('.', ',');
}

// SUPCOR_MAP já vem de shared/js/postos-mapa.js (carregado antes deste
// script) — não redeclarar aqui.

function renderMapa() {
  if (!leafletMap) return;
  if (markerCluster) markerCluster.clearLayers();
  else mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];

  let precosValidos = [], contColetados = 0, contSemColeta = 0;
  const hoje = hojeBR();

  MAP_POSTOS.forEach(posto => {
    if (G_MAPA_SUP !== 'todos' && posto.sup !== G_MAPA_SUP) return;

    const grupo = coletasPorPosto[posto.k] || { proprio: [] };
    const ultimaPropria = grupo.proprio[0] || null; // mais recente primeiro
    const temColeta = !!ultimaPropria && ultimaPropria.data === hoje;

    if (temColeta) contColetados++; else contSemColeta++;
    if (G_MAPA_COLETA === 'coletados' && !temColeta) return;
    if (G_MAPA_COLETA === 'semcoleta'  &&  temColeta) return;

    const latColeta = (temColeta && ultimaPropria.lat) ? corrigirCoordenada(ultimaPropria.lat) : NaN;
    const lngColeta = (temColeta && ultimaPropria.lng) ? corrigirCoordenada(ultimaPropria.lng) : NaN;
    const lat = (!isNaN(latColeta) && latColeta !== 0) ? latColeta : corrigirCoordenada(posto.lat);
    const lng = (!isNaN(lngColeta) && lngColeta !== 0) ? lngColeta : corrigirCoordenada(posto.lng);
    if (!lat || !lng) return;

    const sup = (temColeta && ultimaPropria.supervisor && ultimaPropria.supervisor !== '-') ? ultimaPropria.supervisor : posto.sup;
    const cor = SUPCOR_MAP[sup] || '#8892a4';
    let iconHtml, preco;
    if (temColeta) {
      preco = ultimaPropria[G_MAPA_FUEL];
      if (preco && preco !== '-') precosValidos.push(Number(preco));
      iconHtml = `<div class="custom-marker" style="border-color:${cor};background:#0d1a12">
        <div class="m-name" style="color:${cor}">${posto.ap}</div>
        <div class="m-price" style="color:#fff">${fmtPrecoBRL(preco)}</div>
      </div>`;
    } else {
      iconHtml = `<div class="custom-marker" style="border-color:#333;background:#0d0f12;opacity:.6">
        <div class="m-name" style="color:#5a6478">${posto.ap}</div>
        <div class="m-price" style="color:#3a4355;font-size:9px">⏳ aguardando</div>
      </div>`;
    }

    const cIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [72, 34], iconAnchor: [36, 17] });
    const marker = L.marker([lat, lng], { icon: cIcon });
    if (markerCluster) markerCluster.addLayer(marker); else marker.addTo(leafletMap);

    marker.on('click', () => {
      // data/hora são texto puro (já formatados por GET /coletas) —
      // nunca construir Date() a partir disso, evita bug "Sat Dec 30 1899".
      const dtxt = temColeta ? ` · ${ultimaPropria.data} ${ultimaPropria.hora || ''}` : '';
      let dHtml = `<div class="card" style="margin-top:.5rem"><div class="chdr">
        <div class="ctitle" style="color:${cor}">${posto.ap}</div>
        <div class="csub">Sup: ${sup}${dtxt}</div>
      </div><div class="cbody">`;
      if (temColeta) {
        dHtml += `<div class="pr"><span class="prc">G. Comum</span><span class="prv gc">${fmtPrecoBRL(ultimaPropria.GC)}</span></div>`;
        dHtml += `<div class="pr"><span class="prc">G. Aditivada</span><span class="prv ga">${fmtPrecoBRL(ultimaPropria.GA)}</span></div>`;
        dHtml += `<div class="pr"><span class="prc">Etanol</span><span class="prv et">${fmtPrecoBRL(ultimaPropria.ET)}</span></div>`;
        dHtml += `<div class="pr"><span class="prc">Diesel S10</span><span class="prv s10">${fmtPrecoBRL(ultimaPropria.S10)}</span></div>`;
        if (ultimaPropria.S500 && ultimaPropria.S500 !== '-') {
          dHtml += `<div class="pr"><span class="prc">Diesel S500</span><span class="prv s10">${fmtPrecoBRL(ultimaPropria.S500)}</span></div>`;
        }
      } else {
        dHtml += `<div class="empty" style="padding:.5rem;font-size:.72rem">⏳ Sem coleta hoje.</div>`;
      }
      dHtml += `</div></div>`;
      document.getElementById('mapa-detail').innerHTML = dHtml;
    });

    mapMarkers.push(marker);
  });

  const contador = document.getElementById('mapa-contador');
  if (contador) contador.innerHTML = `<span style="color:var(--ac)">✅ ${contColetados}</span> coletados &nbsp;·&nbsp; <span style="color:var(--tx3)">⏳ ${contSemColeta}</span> aguardando`;

  const legend = document.getElementById('map-legend');
  if (precosValidos.length > 0) {
    precosValidos.sort((a, b) => a - b);
    const min = precosValidos[0], max = precosValidos[precosValidos.length - 1];
    legend.innerHTML = `<span style="color:var(--ok)">Mín: ${fmtPrecoBRL(min)}</span><span style="color:var(--wn)">Filtro: ${G_MAPA_FUEL}</span><span style="color:var(--dg)">Máx: ${fmtPrecoBRL(max)}</span>`;
  } else {
    legend.innerHTML = `<span>Nenhum preço real carregado para ${G_MAPA_FUEL}</span>`;
  }

  if (mapMarkers.length > 0) {
    const grupo = L.featureGroup(mapMarkers);
    const bounds = grupo.getBounds();
    if (bounds.isValid()) leafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
  }
}

// ── COMPARA (portado de AppPainel/js/app.js renderComparar e afins) ─
// Camada de dados: coletas-service.buscarComparacaoDoDia() em vez de
// G_DADOS.prop/conc (Apps Script). Requisito crítico (Fase 2, item 1
// da spec original): NUNCA zerar à meia-noite — cada valor mostrado
// usa o último dado conhecido com selo "desatualizado DD/MM" quando
// não é de hoje, em vez de sumir/zerar.
const CMP_FUELS = [
  { key: 'ET',   label: 'Etanol' },
  { key: 'GC',   label: 'Comum' },
  { key: 'GA',   label: 'Aditiv.' },
  { key: 'S10',  label: 'Diesel S10' },
  { key: 'S500', label: 'Diesel S500' },
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
let G_CMP_POSTO = '';
let G_CMP_SO_MUDOU = false;
let G_CMP_ABAIXO = false; // chip "abaixo do nosso" (independente do "acima")
let G_CMP_ACIMA  = false; // chip "acima do nosso"  (independente do "abaixo")
let G_CMP_ORD = ''; // '' = alfabético | 'barato' = preço Você asc | 'caro' = desc
let G_COMPARACAO = {}; // vem de buscarComparacaoDoDia()
let G_MEDIA_DETALHE = null;

async function carregarDadosComparar() {
  document.getElementById('upd-txt').textContent = 'Buscando dados...';
  try {
    G_COMPARACAO = await buscarComparacaoDoDia({ dias: 15 });
    await cmpAplicarRevisoes(); // sobrepõe os preços editados de hoje no "Você"
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
  const bandas = [...new Set(MAP_POSTOS.map(p => p.banda))].sort();
  selPosto.innerHTML = '<option value="">Todos os postos</option>' +
    MAP_POSTOS.slice().sort((a, b) => a.ap.localeCompare(b.ap)).map(p => `<option value="${p.k}">${p.ap}</option>`).join('');
  selReg.innerHTML = '<option value="">Todas regiões</option>'
    + '<option value="metro">Metropolitana</option>'
    + '<option value="sjdr">São João del Rei</option>';
  selBand.innerHTML = '<option value="">Todas bandeiras</option>' + bandas.map(b => `<option value="${b}">${b}</option>`).join('');
  selPosto.dataset.populado = '1';
}

// KPIs são sempre da rede inteira (37 postos), independente dos
// filtros do Monitor de Preços abaixo.
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

  void hoje; // reservado — hoje já embutido no fallback de G_COMPARACAO
}

// Média posto → supervisor → geral (cada nível conta 1x). No AppPainel
// original a hierarquia era bloco→supervisor→geral; aqui cada posto já
// é a unidade (não existe o conceito de "bloco" no schema relacional).
// Usa o preço EFETIVO (com fallback) de cada concorrente, não só hoje.
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

function cmpCalcularSugerido(min, avg, max) {
  if (G_CMP_STRAT === 'agg')  return min - 0.01;
  if (G_CMP_STRAT === 'prem') return max + 0.01;
  return avg;
}

// Selo pra valor que não é de hoje — não esconde o dado, só avisa.
function seloDesatualizado(registro) {
  if (!registro || !registro.data) return '';
  return ` <span style="font-size:.6rem;color:var(--wn)">· dado de ${registro.data}</span>`;
}

// ════════════════════════════════════════════════════════════════
// MATRIZ da Comparação — portada verbatim do painel-adm (desktop).
// Colunas GC·GA·ET·S10·S500; linhas Você/concorrentes/Sugerido;
// lápis (POST /coleta-revisao), regra GA=GC+0,30, overlay de revisões
// e filtros por posto. Reaproveita fmtPrecoBRL/seloDesatualizado/
// cmpCalcularSugerido/CMP_FUELS/G_CMP_* que este arquivo já tem.
// ════════════════════════════════════════════════════════════════
function cmpCalcCard(dado, f) {
  const ownVal = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined)
    ? Number(dado.proprio[f]) : null;
  const competidores = dado.concorrentes
    .map(c => ({
      nome: c.nome,
      preco: (c.registro[f] !== null && c.registro[f] !== undefined) ? Number(c.registro[f]) : null,
      desatualizado: c.desatualizado,
      registro: c.registro,
      ontem: (c.registroOntem && c.registroOntem[f] !== null && c.registroOntem[f] !== undefined)
        ? Number(c.registroOntem[f]) : null,
    }))
    .filter(c => c.preco !== null)
    .filter(c => !G_CMP_SO_MUDOU || (!c.desatualizado && c.ontem !== null && Math.abs(c.preco - c.ontem) >= 0.005))
    .sort((a, b) => a.preco - b.preco);
  return { ownVal, competidores };
}

// id seguro pra usar em id="" de célula (mesma regra do id do card).
function idSafe(k) { return String(k).replace(/[^a-zA-Z0-9]/g, '_'); }

// Data de hoje YYYY-MM-DD a partir do horário LOCAL (evita drift de UTC).
function cmpHojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// min/avg/max dos concorrentes de um posto para um combustível.
function cmpStatsFuel(dado, f) {
  const precos = dado.concorrentes
    .map(c => (c.registro[f] !== null && c.registro[f] !== undefined) ? Number(c.registro[f]) : null)
    .filter(v => v !== null);
  if (!precos.length) return null;
  return { min: Math.min(...precos), max: Math.max(...precos), avg: precos.reduce((a, b) => a + b, 0) / precos.length };
}

// Sugerido por combustível: GC/ET/S10/S500 pela estratégia global sobre os
// próprios concorrentes; GA = alvoGC + 0,30 FIXO (ignora concorrentes de GA).
function cmpSugeridoMatriz(dado) {
  const out = {};
  const gc = cmpStatsFuel(dado, 'GC');
  const alvoGC = gc ? cmpCalcularSugerido(gc.min, gc.avg, gc.max) : null;
  out.GC = alvoGC;
  out.GA = (alvoGC !== null) ? alvoGC + 0.30 : null;
  ['ET', 'S10', 'S500'].forEach(f => {
    const s = cmpStatsFuel(dado, f);
    out[f] = s ? cmpCalcularSugerido(s.min, s.avg, s.max) : null;
  });
  return out;
}

// Monta o card no formato MATRIZ (colunas = fuels; linhas = Você / cada
// concorrente / Sugerido).
function cmpCardMatriz(posto, dado, pos) {
  const cols = CMP_FUELS_CARD; // GC, GA, ET, S10, S500
  // Prefixo de posição (dourado) só quando a lista está ordenada por preço.
  const posPrefix = pos ? `<span style="color:var(--accent)">${pos}º </span>` : '';
  const idk = idSafe(posto.k);
  const kSafe = String(posto.k).replace(/'/g, "\\'");

  // preço próprio por fuel (já com overlay de revisão aplicado em proprio)
  const own = {};
  cols.forEach(f => {
    const v = (dado.proprio && dado.proprio[f.key] !== null && dado.proprio[f.key] !== undefined) ? Number(dado.proprio[f.key]) : null;
    own[f.key] = v;
  });

  const thead = `<tr><th class="cmpm-rowlbl"></th>${cols.map(f => `<th><span class="cmpm-colh">${f.btn}</span></th>`).join('')}</tr>`;

  // linha Você — lápis só nos fuels com valor
  const voceCells = cols.map(f => {
    const v = own[f.key];
    if (v === null) return `<td class="cmpm-cell" id="cmpm-voce-${idk}-${f.key}"><span class="cmpm-na">—</span></td>`;
    return `<td class="cmpm-cell cmpm-voce" id="cmpm-voce-${idk}-${f.key}">`
      + `<span class="cmpm-preco">${fmtPrecoBRL(v)}</span>`
      + ` <span class="cmpm-pen" title="Editar nosso preço" onclick="cmpEditarVoce('${kSafe}','${f.key}')">✏️</span></td>`;
  }).join('');
  const desatSelo = dado.proprioDesatualizado ? seloDesatualizado(dado.proprio) : '';
  const voceRow = `<tr class="cmpm-row-voce"><th class="cmpm-rowlbl">Você${desatSelo}</th>${voceCells}</tr>`;

  // linhas de concorrentes (preço + diferença vs Você na mesma célula),
  // ordenadas por GC decrescente com desempate em cascata GC→GA→ET→S10→S500
  // (todos decrescentes; sem valor conta como -Infinity, vai pro fim).
  // slice() pra não mutar o array original (agregados leem dado.concorrentes).
  const ORDEM_DESEMPATE = ['GC', 'GA', 'ET', 'S10', 'S500'];
  const ordenados = dado.concorrentes.slice().sort((a, b) => {
    for (const f of ORDEM_DESEMPATE) {
      const va = (a.registro && a.registro[f] != null) ? Number(a.registro[f]) : -Infinity;
      const vb = (b.registro && b.registro[f] != null) ? Number(b.registro[f]) : -Infinity;
      if (vb !== va) return vb - va;
    }
    return 0;
  });
  const concRows = ordenados.map(c => {
    const cells = cols.map(f => {
      const cv = (c.registro[f.key] !== null && c.registro[f.key] !== undefined) ? Number(c.registro[f.key]) : null;
      if (cv === null) return `<td class="cmpm-cell"><span class="cmpm-na">—</span></td>`;
      const ov = own[f.key];
      let diff = '';
      if (ov !== null) {
        const d = cv - ov;
        const igual = Math.abs(d) < 0.005;
        const cor = igual ? 'var(--wn)' : (d < 0 ? 'var(--dg)' : 'var(--ok)');
        const txt = igual ? 'igual' : (d > 0 ? '+' : '') + Math.round(d * 100) + 'c';
        diff = ` <span class="cmpm-diff" style="color:${cor}">${txt}</span>`;
      }
      // Destaque de filtro: SÓ na coluna do combustível ativo (G_CMP_FUEL) e
      // só com o filtro correspondente ligado. Mesmo critério do esconder.
      let hl = '';
      if (f.key === G_CMP_FUEL) {
        if (G_CMP_SO_MUDOU && cmpConcMudou(c, f.key)) hl += ' cmpm-hl-mudou';
        if (ov !== null) {
          const d = cv - ov;
          if (G_CMP_ABAIXO && d < -0.005)     hl += ' cmpm-hl-abaixo';
          else if (G_CMP_ACIMA && d > 0.005)  hl += ' cmpm-hl-acima';
        }
      }
      return `<td class="cmpm-cell${hl}"><span class="cmpm-preco">${fmtPrecoBRL(cv)}</span>${diff}</td>`;
    }).join('');
    const nome = c.nome + (c.desatualizado ? seloDesatualizado(c.registro) : '');
    return `<tr><th class="cmpm-rowlbl cmpm-conc" title="${c.nome}">${nome}</th>${cells}</tr>`;
  }).join('');
  const concHtml = concRows || `<tr><td class="cmpm-vazio" colspan="${cols.length + 1}">Sem concorrente coletado</td></tr>`;

  // linha Sugerido (GA mostra "(GC+30)")
  const sug = cmpSugeridoMatriz(dado);
  const sugCells = cols.map(f => {
    const s = sug[f.key];
    if (s === null || s === undefined) return `<td class="cmpm-cell"><span class="cmpm-na">—</span></td>`;
    const hint = f.key === 'GA' ? ` <span class="cmpm-hint">(GC+30)</span>` : '';
    return `<td class="cmpm-cell cmpm-sug"><span class="cmpm-preco">${fmtPrecoBRL(s)}</span>${hint}</td>`;
  }).join('');
  const sugRow = `<tr class="cmpm-row-sug"><th class="cmpm-rowlbl">Sugerido</th>${sugCells}</tr>`;

  return `<div class="region-card" id="cmp-card-${idk}">
    <div class="region-hdr"><span class="region-nome">${posPrefix}${posto.ap}</span></div>
    <div class="cmpm-wrap"><table class="cmpm-table">
      <thead>${thead}</thead>
      <tbody>${voceRow}${concHtml}${sugRow}</tbody>
    </table></div>
  </div>`;
}

// ── Edição inline do "Você" na matriz (mesma rota da aba Coleta) ──
function cmpEditarVoce(k, f) {
  const cell = document.getElementById(`cmpm-voce-${idSafe(k)}-${f}`);
  if (!cell) return;
  const dado = G_COMPARACAO[k];
  const orig = (dado && dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined) ? Number(dado.proprio[f]) : null;
  const val = orig !== null ? orig.toFixed(2).replace('.', ',') : '';
  const kSafe = String(k).replace(/'/g, "\\'");
  cell.innerHTML = `<input class="cmpm-input" id="cmpm-inp-${idSafe(k)}-${f}" type="text" inputmode="decimal"
    value="${val}"
    onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
    onblur="cmpConfirmarVoce('${kSafe}','${f}')">`;
  const inp = document.getElementById(`cmpm-inp-${idSafe(k)}-${f}`);
  if (inp) { inp.focus(); inp.select(); }
}

// "619" → 6.19 (só dígitos = centavos); "6,19"/"6.19" → 6.19 (decimal direto).
function cmpParsePreco(str) {
  const s = String(str || '').trim();
  if (!s) return NaN;
  if (/[.,]/.test(s)) return parseFloat(s.replace(',', '.'));
  const digits = s.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) / 100 : NaN;
}

async function cmpConfirmarVoce(k, f) {
  const inp = document.getElementById(`cmpm-inp-${idSafe(k)}-${f}`);
  if (!inp || inp.dataset.saving === '1') return;
  const dado = G_COMPARACAO[k];
  const posto = MAP_POSTOS.find(p => p.k === k);
  if (!dado || !posto) { renderComparar(); return; }

  const novo = cmpParsePreco(inp.value);
  const orig = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined) ? Number(dado.proprio[f]) : null;

  // inválido/vazio ou sem mudança → cancela sem salvar
  if (isNaN(novo) || novo <= 0) { renderComparar(); return; }
  if (orig !== null && Math.abs(novo - orig) < 0.005) { renderComparar(); return; }

  inp.dataset.saving = '1';
  const ok = await cmpSalvarPrecoProprio(posto.ap, f, novo, orig);
  if (ok) {
    if (!dado.proprio) dado.proprio = {};
    dado.proprio[f] = novo; // overlay local (reflete na hora + persiste no reload via cmpAplicarRevisoes)
  }

  // Regra do GA — NUNCA automático: ao salvar GC, oferece GA = GC + 0,30.
  if (ok && f === 'GC') {
    const alvoGA = novo + 0.30;
    if (window.confirm(`Aplicar também GA (aditivada) = GC + 0,30 = R$ ${alvoGA.toFixed(2).replace('.', ',')}?`)) {
      const origGA = (dado.proprio && dado.proprio['GA'] !== null && dado.proprio['GA'] !== undefined) ? Number(dado.proprio['GA']) : null;
      const okGA = await cmpSalvarPrecoProprio(posto.ap, 'GA', alvoGA, origGA);
      if (okGA) dado.proprio['GA'] = alvoGA;
    }
  }
  renderComparar();
}

async function cmpSalvarPrecoProprio(postoNome, combustivel, precoEditado, precoOriginal) {
  try {
    await apiFetch('/coleta-revisao', {
      method: 'POST',
      body: JSON.stringify({
        posto_nome: postoNome,
        data: cmpHojeISO(),
        combustivel,
        preco_editado: precoEditado,
        preco_original: precoOriginal,
      }),
    });
    return true;
  } catch (err) {
    alert('Erro ao salvar preço: ' + (err && err.message ? err.message : 'tente de novo'));
    return false;
  }
}

// Sobrepõe os preços editados de hoje (coleta_revisao) no proprio de cada
// posto — mesma fonte da aba Coleta, pra o "Você" bater e não sumir ao
// recarregar. Silencioso se a rota falhar (a matriz funciona sem overlay).
async function cmpAplicarRevisoes() {
  try {
    const resp = await apiFetch('/coleta-revisao?data=' + cmpHojeISO());
    (resp.linhas || []).forEach(l => {
      if (l.preco_editado === null || l.preco_editado === undefined) return;
      const chave = normalizarNomePosto(l.posto_nome || '');
      const dado = G_COMPARACAO[chave];
      if (!dado) return;
      if (!dado.proprio) dado.proprio = {};
      dado.proprio[l.combustivel] = Number(l.preco_editado);
    });
  } catch (err) {
    console.warn('Não foi possível aplicar revisões na matriz:', err && err.message);
  }
}

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

const CMP_FUELS_CARD = [
  { key: 'GC',   btn: 'GC',   nome: 'comum' },
  { key: 'GA',   btn: 'GA',   nome: 'aditivada' },
  { key: 'ET',   btn: 'ET',   nome: 'etanol' },
  { key: 'S10',  btn: 'S10',  nome: 'diesel S10' },
  { key: 'S500', btn: 'S500', nome: 'diesel S500' },
];

function renderComparar() {
  montarFuelTabsComparar();
  montarStratTabsComparar();
  cmpMontarOrdBtns();

  const fuel = G_CMP_FUEL;
  const fuelLabel = (CMP_FUELS.find(f => f.key === fuel) || {}).label || fuel;

  const ordAtivo = (G_CMP_ORD === 'barato' || G_CMP_ORD === 'caro');
  // Preço "Você" do posto no combustível GLOBAL selecionado (null se sem preço).
  const precoVoce = (p) => {
    const d = G_COMPARACAO[p.k];
    return d ? cmpCalcCard(d, fuel).ownVal : null;
  };

  const postos = MAP_POSTOS.filter(p => {
    if (G_CMP_POSTO && p.k !== G_CMP_POSTO) return false;
    if (G_CMP_REG  && p.reg  !== G_CMP_REG)  return false;
    if (G_CMP_BAND && p.banda !== G_CMP_BAND) return false;
    return true;
  });
  if (ordAtivo) {
    // Postos sem preço "Você" vão SEMPRE pro fim; entre eles, alfabético.
    postos.sort((a, b) => {
      const pa = precoVoce(a), pb = precoVoce(b);
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

  postos.forEach(posto => {
    const dado = G_COMPARACAO[posto.k] || { proprio: null, proprioDesatualizado: false, concorrentes: [] };

    // Agregados do rodapé (Minha média / Média concorrência) continuam no
    // combustível GLOBAL (G_CMP_FUEL) — a matriz não altera isso.
    const glob = cmpCalcCard(dado, fuel);
    if (glob.ownVal !== null) { somaMinha += glob.ownVal; contMinha++; }
    glob.competidores.forEach(c => { somaConc += c.preco; contConc++; });

    // Card visível se o posto tem QUALQUER dado (próprio ou concorrente)
    // E passar nos filtros "só quem mudou" / "abaixo-acima do nosso".
    if (!dado.proprio && !dado.concorrentes.length) return;
    if (!cmpPostoPassaFiltros(dado)) return;

    posOrd += 1;
    cardsHtml += cmpCardMatriz(posto, dado, ordAtivo ? posOrd : null);
  });

  document.getElementById('cmp-regions').innerHTML = cardsHtml || '<div class="empty">Nenhum posto para esse filtro.</div>';

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

// ── HISTÓRICO (portado de AppPainel/js/app.js carregarHistorico e afins) ──
// Fonte: GET /coletas cru (não passa pelo agrupamento do coletas-service —
// aqui a lista plana, com `tipo` já classificado, é exatamente o formato
// que essas funções esperam). Outliers (fora de R$2–10, erro de digitação
// tipo "R$ 55,00" já visto na base) são filtrados SÓ no gráfico e no resumo
// — a lista de registros mostra tudo cru, sem esconder dado real.
let G_HISTORICO = [];

function precoPlausivelHistorico(v) {
  const n = Number(v);
  return v !== null && v !== undefined && !isNaN(n) && n >= 2 && n <= 10;
}

function povoarHistPosto() {
  const sel = document.getElementById('hist-posto');
  if (!sel || sel.options.length > 1) return;
  MAP_POSTOS.slice().sort((a, b) => a.ap.localeCompare(b.ap)).forEach(p => {
    const o = document.createElement('option');
    o.value = p.ap; o.textContent = p.ap;
    sel.appendChild(o);
  });
}

async function carregarHistorico() {
  povoarHistPosto();
  const posto  = document.getElementById('hist-posto').value;
  const dias   = document.getElementById('hist-dias').value;
  const subEl  = document.getElementById('hist-sub');
  const loadEl = document.getElementById('hist-loading');
  loadEl.classList.remove('hidden');
  subEl.textContent = 'Carregando...';
  G_HISTORICO = [];
  try {
    // Sem posto selecionado + período longo pode passar de 500 linhas
    // (37 postos × vários concorrentes × dias) — sobe o limite pra não
    // truncar o gráfico/resumo silenciosamente.
    const limite = (!posto && Number(dias) >= 30) ? 5000 : 500;
    const params = new URLSearchParams({ dias, limit: limite });
    if (posto) params.set('posto', posto);
    const resp = await apiFetch(`/coletas?${params.toString()}`);
    G_HISTORICO = resp.registros || [];
    subEl.textContent = `${posto || 'Todos os postos'} — últimos ${dias} dias (${G_HISTORICO.length} registros)`;
  } catch (err) {
    console.error('Erro ao carregar histórico:', err);
    subEl.textContent = 'Sem conexão com o servidor.';
  } finally {
    loadEl.classList.add('hidden');
    renderGrafico();
    renderResumoHistorico();
    renderListaHistorico();
  }
}

function renderGrafico() {
  const fuel = document.getElementById('hist-fuel').value;
  const canvas = document.getElementById('hist-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pontos = G_HISTORICO.filter(r => r.tipo === 'Próprio' && precoPlausivelHistorico(r[fuel]));
  if (pontos.length === 0) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  const porData = {};
  pontos.forEach(r => { if (!porData[r.data]) porData[r.data] = []; porData[r.data].push(parseFloat(r[fuel])); });
  const datas = Object.keys(porData).sort((a, b) => {
    const pa = a.split('/'), pb = b.split('/');
    return new Date(pa[2], pa[1] - 1, pa[0]) - new Date(pb[2], pb[1] - 1, pb[0]);
  });
  const valores = datas.map(d => { const arr = porData[d]; return arr.reduce((s, v) => s + v, 0) / arr.length; });
  const W = canvas.offsetWidth || 340, H = 200;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  const pad = { t: 20, r: 10, b: 30, l: 50 };
  const gW = W - pad.l - pad.r, gH = H - pad.t - pad.b;
  const minV = Math.min(...valores) - 0.05, maxV = Math.max(...valores) + 0.05, rV = maxV - minV || 0.1;
  const xOf = i => pad.l + (i / (datas.length - 1 || 1)) * gW;
  const yOf = v => pad.t + (1 - (v - minV) / rV) * gH;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (i / 4) * gH;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#5a6478'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    ctx.fillText('R$' + (maxV - (i / 4) * rV).toFixed(2), pad.l - 4, y + 3);
  }
  ctx.strokeStyle = '#00e5a0'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  valores.forEach((v, i) => { i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)); });
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,229,160,0.08)'; ctx.beginPath();
  valores.forEach((v, i) => { i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)); });
  ctx.lineTo(xOf(valores.length - 1), pad.t + gH); ctx.lineTo(xOf(0), pad.t + gH); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#00e5a0';
  valores.forEach((v, i) => { ctx.beginPath(); ctx.arc(xOf(i), yOf(v), 3, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = '#5a6478'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(datas.length / 5));
  datas.forEach((d, i) => {
    if (i % step !== 0 && i !== datas.length - 1) return;
    const parts = d.split('/');
    ctx.fillText(parts[0] + '/' + parts[1], xOf(i), H - 8);
  });
}

function renderResumoHistorico() {
  const fuel = document.getElementById('hist-fuel').value;
  const body = document.getElementById('hist-resumo');
  const todosProp = G_HISTORICO.filter(r => r.tipo === 'Próprio' && r[fuel]);
  const todosConc = G_HISTORICO.filter(r => r.tipo !== 'Próprio' && r[fuel]);
  const prop = todosProp.filter(r => precoPlausivelHistorico(r[fuel]));
  const conc = todosConc.filter(r => precoPlausivelHistorico(r[fuel]));
  const ignoradosProp = todosProp.length - prop.length;
  const ignoradosConc = todosConc.length - conc.length;
  if (!prop.length && !conc.length) { body.innerHTML = '<div class="empty">Sem dados suficientes para resumo.</div>'; return; }
  const media = arr => arr.length ? (arr.reduce((s, r) => s + parseFloat(r[fuel]), 0) / arr.length) : null;
  const min_r = arr => arr.length ? Math.min(...arr.map(r => parseFloat(r[fuel]))) : null;
  const max_r = arr => arr.length ? Math.max(...arr.map(r => parseFloat(r[fuel]))) : null;
  const mp = media(prop), mc = media(conc);
  const fmt = v => v !== null ? fmtPrecoBRL(v) : '--';
  body.innerHTML = `
    <div class="bgrid" style="grid-template-columns:1fr 1fr;gap:.5rem">
      <div class="bbox"><div class="bbnome" style="color:var(--ac)">Nossos Postos${ignoradosProp ? ` <span style="font-size:.56rem;color:var(--tx3);font-weight:400">(${ignoradosProp} ignorados)</span>` : ''}</div>
        <div class="dbitem"><span>Média</span><span class="dbval">${fmt(mp)}</span></div>
        <div class="dbitem"><span>Mínimo</span><span class="dbval">${fmt(min_r(prop))}</span></div>
        <div class="dbitem"><span>Máximo</span><span class="dbval">${fmt(max_r(prop))}</span></div>
        <div class="dbitem"><span>Registros</span><span class="dbval">${prop.length}</span></div></div>
      <div class="bbox"><div class="bbnome" style="color:var(--wn)">Concorrentes${ignoradosConc ? ` <span style="font-size:.56rem;color:var(--tx3);font-weight:400">(${ignoradosConc} ignorados)</span>` : ''}</div>
        <div class="dbitem"><span>Média</span><span class="dbval">${fmt(mc)}</span></div>
        <div class="dbitem"><span>Mínimo</span><span class="dbval">${fmt(min_r(conc))}</span></div>
        <div class="dbitem"><span>Máximo</span><span class="dbval">${fmt(max_r(conc))}</span></div>
        <div class="dbitem"><span>Registros</span><span class="dbval">${conc.length}</span></div></div>
    </div>
    ${mp && mc ? `<div style="margin-top:.5rem;padding:.6rem;background:${mp < mc ? 'rgba(0,229,160,.08)' : 'rgba(255,77,109,.08)'};border-radius:8px;font-size:.78rem">
      ${mp < mc ? `✅ Nosso preço médio está <strong style="color:var(--ok)">${fmtPrecoBRL(mc - mp)} abaixo</strong> da concorrência.`
               : `⚠️ Nosso preço médio está <strong style="color:var(--dg)">${fmtPrecoBRL(mp - mc)} acima</strong> da concorrência.`}
    </div>` : ''}`;
}

function renderListaHistorico() {
  const body = document.getElementById('hist-lista');
  const qtd = document.getElementById('hist-qtd');
  const fuel = document.getElementById('hist-fuel').value;
  const lista = G_HISTORICO.filter(r => r[fuel]).slice(-50).reverse();
  qtd.textContent = lista.length + ' registros (mais recentes)';
  if (!lista.length) { body.innerHTML = '<div class="empty">Sem registros no período.</div>'; return; }
  body.innerHTML = lista.map(r => {
    const isProp = r.tipo === 'Próprio', cor = isProp ? 'var(--ac)' : 'var(--tx3)';
    return `<div class="ritem">
      <div class="rinfo"><div class="rnome" style="color:${cor}">${r.postoAlvo}</div>
      <div class="rbanda">${r.data} ${r.hora ? r.hora.substring(0, 5) : ''} · ${r.tipo} · ${r.bandeira || ''}</div></div>
      <div class="rpreco" style="color:${cor}">${fmtPrecoBRL(r[fuel])}</div>
    </div>`;
  }).join('');
}
