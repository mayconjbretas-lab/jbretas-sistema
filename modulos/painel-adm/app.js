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
  // Demais abas (medição/mapa/histórico/mais) entram nos próximos blocos.
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
let G_CMP_SUP = '';
let G_CMP_BAND = '';
let G_CMP_POSTO = '';
let G_CMP_SO_MUDOU = false;
let G_CMP_FAIXA_PRECO = 'todos';

function fmtPrecoBRL(v) {
  if (v === null || v === undefined || v === '' || v === '-') return '--';
  return 'R$' + Number(v).toFixed(2).replace('.', ',');
}

async function carregarDadosComparar() {
  document.getElementById('upd-txt').textContent = 'Buscando dados...';
  try {
    G_COMPARACAO = await buscarComparacaoDoDia({ dias: 15 });
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
  const selSup = document.getElementById('cmp-sup');
  const selBand = document.getElementById('cmp-band');
  const sups = [...new Set(MAP_POSTOS.map(p => p.sup))].sort();
  const bandas = [...new Set(MAP_POSTOS.map(p => p.banda))].sort();
  selPosto.innerHTML = '<option value="">Todos os postos</option>' +
    MAP_POSTOS.slice().sort((a, b) => a.ap.localeCompare(b.ap)).map(p => `<option value="${p.k}">${p.ap}</option>`).join('');
  selSup.innerHTML = '<option value="">Todos supervisores</option>' + sups.map(s => `<option value="${s}">${s}</option>`).join('');
  selBand.innerHTML = '<option value="">Todas bandeiras</option>' + bandas.map(b => `<option value="${b}">${b}</option>`).join('');
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
function cmpSetSup(val)   { G_CMP_SUP   = val; renderComparar(); }
function cmpSetBand(val)  { G_CMP_BAND  = val; renderComparar(); }
function cmpSetPosto(val) { G_CMP_POSTO = val; renderComparar(); }
function cmpToggleSoMudou(chk) { G_CMP_SO_MUDOU = chk.checked; renderComparar(); }

function cmpSetFaixaPreco(btn, faixa) {
  G_CMP_FAIXA_PRECO = faixa;
  ['flt-abaixo', 'flt-acima', 'flt-todos-preco'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.style.display = id === 'flt-todos-preco' ? 'none' : ''; }
  });
  if (faixa !== 'todos') {
    btn.classList.add('active');
    const limpar = document.getElementById('flt-todos-preco');
    if (limpar) limpar.style.display = '';
  }
  renderComparar();
}

function cmpCalcularSugerido(min, avg, max) {
  if (G_CMP_STRAT === 'agg')  return min - 0.01;
  if (G_CMP_STRAT === 'prem') return max + 0.01;
  return avg;
}

function seloDesatualizado(registro) {
  if (!registro || !registro.data) return '';
  return ` <span style="font-size:.6rem;color:var(--wn)">· dado de ${registro.data}</span>`;
}

function renderComparar() {
  montarFuelTabsComparar();
  montarStratTabsComparar();

  const fuel = G_CMP_FUEL;
  const fuelLabel = (CMP_FUELS.find(f => f.key === fuel) || {}).label || fuel;

  const postos = MAP_POSTOS.filter(p => {
    if (G_CMP_POSTO && p.k !== G_CMP_POSTO) return false;
    if (G_CMP_SUP  && p.sup  !== G_CMP_SUP)  return false;
    if (G_CMP_BAND && p.banda !== G_CMP_BAND) return false;
    return true;
  }).sort((a, b) => a.ap.localeCompare(b.ap));

  let somaMinha = 0, contMinha = 0, somaConc = 0, contConc = 0;
  let cardsHtml = '';

  postos.forEach(posto => {
    const dado = G_COMPARACAO[posto.k] || { proprio: null, proprioDesatualizado: false, concorrentes: [] };
    const ownVal = (dado.proprio && dado.proprio[fuel] !== null && dado.proprio[fuel] !== undefined)
      ? Number(dado.proprio[fuel]) : null;

    const competidores = dado.concorrentes
      .map(c => ({
        nome: c.nome,
        preco: (c.registro[fuel] !== null && c.registro[fuel] !== undefined) ? Number(c.registro[fuel]) : null,
        desatualizado: c.desatualizado,
        registro: c.registro,
        ontem: (c.registroOntem && c.registroOntem[fuel] !== null && c.registroOntem[fuel] !== undefined)
          ? Number(c.registroOntem[fuel]) : null,
      }))
      .filter(c => c.preco !== null)
      .filter(c => !G_CMP_SO_MUDOU || (!c.desatualizado && c.ontem !== null && Math.abs(c.preco - c.ontem) >= 0.005))
      .sort((a, b) => a.preco - b.preco);

    if (ownVal === null && competidores.length === 0) return;
    if (ownVal !== null) { somaMinha += ownVal; contMinha++; }
    competidores.forEach(c => { somaConc += c.preco; contConc++; });

    const precos = competidores.map(c => c.preco);
    const min = precos.length ? Math.min(...precos) : null;
    const max = precos.length ? Math.max(...precos) : null;
    const avg = precos.length ? precos.reduce((a, b) => a + b, 0) / precos.length : null;
    const perdendo = ownVal !== null && min !== null && ownVal > min;

    const badgeHtml = ownVal !== null
      ? `<span class="region-badge ${perdendo ? 'perdendo' : 'ganhando'}">Você: ${fmtPrecoBRL(ownVal)}</span>${dado.proprioDesatualizado ? seloDesatualizado(dado.proprio) : ''}`
      : '';

    let listHtml = '';
    if (competidores.length) {
      competidores.forEach(c => {
        const d = c.preco - (ownVal || 0);
        const igual = Math.abs(d) < 0.005;

        if (G_CMP_FAIXA_PRECO === 'abaixo' && ownVal !== null && !(d < -0.004)) return;
        if (G_CMP_FAIXA_PRECO === 'acima'  && ownVal !== null && !(d >  0.004)) return;

        let diffHtml = '';
        if (ownVal !== null) {
          const cor = igual ? 'var(--wn)' : (d < 0 ? 'var(--dg)' : 'var(--ok)');
          const txt = igual ? 'igual' : (d > 0 ? '+' : '') + Math.round(d * 100) + 'c';
          diffHtml = `<span class="complist-diff" style="color:${cor}">${txt}</span>`;
        }
        let vsOntemHtml = '';
        if (!c.desatualizado && c.ontem !== null) {
          const dOntem = c.preco - c.ontem;
          if (Math.abs(dOntem) >= 0.005) {
            const corOntem = dOntem > 0 ? 'var(--dg)' : 'var(--ok)';
            const seta = dOntem > 0 ? '↑' : '↓';
            vsOntemHtml = ` <span style="font-size:.62rem;color:${corOntem}">${seta}${Math.abs(Math.round(dOntem * 100))}c vs ontem</span>`;
          }
        }
        listHtml += `<div class="complist-row"><span class="complist-nome">${c.nome}${c.desatualizado ? seloDesatualizado(c.registro) : vsOntemHtml}</span><span><span class="complist-preco">${fmtPrecoBRL(c.preco)}</span>${diffHtml}</span></div>`;
      });
      if (!listHtml) {
        listHtml = `<div class="empty" style="padding:.4rem 0;font-size:.74rem;text-align:left">Nenhum concorrente para esse filtro.</div>`;
      }
    } else {
      const msgVazio = G_CMP_SO_MUDOU
        ? `Nenhum concorrente mudou de preço desde ontem para ${fuelLabel.toLowerCase()}`
        : `Sem concorrente coletado para ${fuelLabel.toLowerCase()}`;
      listHtml = `<div class="empty" style="padding:.4rem 0;font-size:.74rem;text-align:left">${msgVazio}</div>`;
    }

    let sugeridoHtml = '';
    if (ownVal !== null && precos.length) {
      const alvo = cmpCalcularSugerido(min, avg, max);
      const mover = alvo - ownVal;
      const moverIgual = Math.abs(mover) < 0.005;
      const corMover = moverIgual ? 'var(--tx3)' : (mover < 0 ? 'var(--dg)' : 'var(--ok)');
      const txtMover = moverIgual ? 'manter' : (mover > 0 ? '+' : '') + Math.round(mover * 100) + 'c';
      sugeridoHtml = `<div class="sugerido-row"><span class="sugerido-lbl">Sugerido</span><span><span class="sugerido-val">${fmtPrecoBRL(alvo)}</span><span class="sugerido-move" style="color:${corMover}">${txtMover}</span></span></div>`;
    }

    cardsHtml += `<div class="region-card" id="cmp-card-${posto.k.replace(/[^a-zA-Z0-9]/g, '_')}">
      <div class="region-hdr"><span class="region-nome">${posto.ap}</span>${badgeHtml}</div>
      ${listHtml}
      ${sugeridoHtml}
    </div>`;
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

  renderHeatmapComparar();
}

function renderHeatmapComparar() {
  const body = document.getElementById('heatmap-body');
  const valores = MAP_POSTOS
    .map(p => G_COMPARACAO[p.k]?.proprio?.GC)
    .filter(v => v !== null && v !== undefined)
    .map(Number);
  if (!valores.length) { body.innerHTML = '<div class="empty">Sem dados</div>'; return; }
  valores.sort((a, b) => a - b);
  const min = valores[0], max = valores[valores.length - 1], dif = (max - min) || 1;
  body.innerHTML = '';
  MAP_POSTOS.forEach(posto => {
    const dado = G_COMPARACAO[posto.k];
    const val = dado?.proprio?.GC;
    if (val === null || val === undefined) return;
    const pct = (Number(val) - min) / dif;
    let cor = 'var(--ok)';
    if (pct > 0.35 && pct <= 0.7) cor = 'var(--wn)';
    else if (pct > 0.7) cor = 'var(--dg)';
    const cell = document.createElement('div');
    cell.className = 'hcell';
    cell.style.background = cor;
    cell.title = `${posto.ap}: ${fmtPrecoBRL(val)}${dado.proprioDesatualizado ? ' (dado de ' + dado.proprio.data + ')' : ''}`;
    cell.onclick = () => {
      const btnComp = document.querySelectorAll('.nbtn')[0];
      setTab(btnComp, 'comp');
      G_CMP_SUP = ''; G_CMP_BAND = ''; G_CMP_POSTO = ''; G_CMP_FUEL = 'GC';
      document.getElementById('cmp-sup').value = '';
      document.getElementById('cmp-band').value = '';
      document.getElementById('cmp-posto').value = '';
      renderComparar();
      setTimeout(() => {
        const alvo = document.getElementById('cmp-card-' + posto.k.replace(/[^a-zA-Z0-9]/g, '_'));
        if (alvo) { alvo.scrollIntoView({ behavior: 'smooth', block: 'center' }); alvo.style.borderColor = 'var(--ac)'; }
      }, 80);
    };
    body.appendChild(cell);
  });
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
