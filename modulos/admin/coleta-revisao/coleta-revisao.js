// ================================================================
// JBRETAS SISTEMA — modulos/admin/coleta-revisao/coleta-revisao.js
// Port FIEL da "Coleta de Preços — Visão Auditora com Swipe de Fotos"
// do AppPainel (AppPainel/js/app.js ~1724-2557), adaptado ao sistema
// novo:
//   • Fonte de dados: buscarColetasAgrupadas() (shared/js/coletas-service.js)
//     — deriva "meu hoje" + "meu ontem" no próprio módulo (Opção A),
//     igual ao csCarregar original, sem tocar no serviço compartilhado.
//   • Lista dos 37 postos: MAP_POSTOS (shared/js/postos-mapa.js), join
//     por .k — mesma convenção da aba Mapa (coletasPorPosto[posto.k]).
//   • Fotos: <img src> direto de registro.foto (Supabase Storage) —
//     sem pipeline do Google Drive (csDriveId/thumbnail removidos).
//
// ETAPA 1 (visual/dados). O status pend/ok/flag é client-side efêmero
// (persistência = Etapa 2). Sem lápis de editar preço (Etapa 3). Sem
// integração na navegação/RANKING (Etapa 4).
// ================================================================

const CS_FUEL_NAMES = { GC:'Gasolina C', ET:'Etanol', GA:'G. Aditivada', S10:'Diesel S10', S500:'Diesel S500' };

// ── estado global ────────────────────────────────────────────────
let CS_POSTOS     = [];  // 37 postos (MAP_POSTOS) + dados de coleta agregados
let CS_FILTRADOS  = [];  // postos após filtros
let CS_ESTADOS    = {};  // { postoKey: 'pend'|'ok'|'flag' } — efêmero nesta etapa
let CS_POSTO_IDX  = -1;  // índice do posto ativo em CS_FILTRADOS
let CS_CONC_IDX   = 0;   // índice do concorrente ativo (slide atual)
let CS_MODO_DIFF  = 'hoje';
let CS_FILTRO_SUP = '';
let CS_SWIPE_INIT = false;
let CS_REVISOES   = {};  // { postoKey: { combustivel: linha } } — o que o ADM já editou hoje (chave = mp.k)
let csSX = 0, csDragging = false, csDelta = 0, csHintShown = false;

// ── Ponto de entrada ──────────────────────────────────────────────
function renderColetaRevisao(ctx) {
  CS_POSTO_IDX = -1;
  CS_CONC_IDX  = 0;
  CS_FILTRO_SUP = '';
  CS_MODO_DIFF  = 'hoje';
  csHintShown   = false;
  window._csPillAtivo = 'todos';

  ctx.innerHTML = `
    <div id="cs-shell">
      <div id="cs-topbar">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="color:var(--ac);font-weight:600;font-size:13px">Coleta de Preços</span>
          <span class="cs-chip">Data: <b id="cs-data">—</b></span>
          <span class="cs-chip"><b id="cs-qtd-postos">—</b> postos</span>
        </div>
      </div>
      <div id="cs-prog"><div id="cs-prog-fill" style="width:0%"></div></div>
      <div id="cs-filtros">
        <select class="cs-sel" id="cs-flt-sup" onchange="csAplicarFiltros()">
          <option value="">Todos supervisores</option>
        </select>
        <span class="cs-pill active" id="cspill-todos" onclick="csSetPill('todos',this)">Todos</span>
        <span class="cs-pill" id="cspill-pend"  onclick="csSetPill('pend',this)">⏳ Pendentes</span>
        <span class="cs-pill" id="cspill-ok"    onclick="csSetPill('ok',this)">✓ Ok</span>
        <span class="cs-pill danger" id="cspill-flag" onclick="csSetPill('flag',this)">⚠ Margem</span>
        <select class="cs-sel" id="cs-flt-dias" onchange="csCarregar()">
          <option value="1" selected>Hoje</option>
          <option value="3">3 dias</option>
          <option value="7">7 dias</option>
          <option value="15">15 dias</option>
        </select>
      </div>

      <!-- LISTA DOS 37 POSTOS -->
      <div id="cs-lista">
        <div class="cs-estado"><div class="cs-spin"></div>Carregando...</div>
      </div>

      <!-- DETALHE: concorrentes do posto em swipe -->
      <div id="cs-detalhe">
        <div id="cs-dhdr">
          <div class="cs-nav-row">
            <button class="cs-btn-back" onclick="csVoltarLista()">← Postos</button>
            <span class="cs-counter" id="cs-counter"></span>
            <button class="cs-btn-nav" onclick="csPosAnterior()">‹ Posto ant.</button>
            <button class="cs-btn-nav" onclick="csPosProximo()">Próximo posto ›</button>
          </div>
          <!-- Nome do posto próprio (fixo) -->
          <div class="cs-dtitle">
            <span id="cs-d-posto">—</span>
            <span class="cs-badge" id="cs-d-badge">pendente</span>
          </div>
          <!-- Nome do concorrente atual (muda com o slide) -->
          <div id="cs-d-conc-nome">—</div>
          <div class="cs-dsub">Supervisor: <span id="cs-d-sup">—</span> · <span id="cs-d-data">—</span></div>
          <div class="cs-meta-row">
            <div class="cs-mc">👤 <b id="cs-d-ger">—</b></div>
            <div class="cs-mc">🕐 <b id="cs-d-hora">—</b></div>
            <div class="cs-mc" id="cs-d-concs-total">—</div>
          </div>
        </div>

        <!-- fotos: concorrente | meu posto -->
        <div class="cs-fotos-outer" id="cs-fotos-outer">
          <div class="cs-fotos-wrap" id="cs-fotos-wrap">
            <div class="cs-fotos-track" id="cs-fotos-track"></div>
            <div class="cs-hint" id="cs-hint">← arrasta para ver próximo concorrente →</div>
          </div>
          <button class="cs-arr cs-arr-l" id="cs-arr-l" onclick="csConcNav(-1)">‹</button>
          <button class="cs-arr cs-arr-r" id="cs-arr-r" onclick="csConcNav(1)">›</button>
        </div>
        <!-- dots + nome do concorrente em miniatura -->
        <div class="cs-dots-row" id="cs-dots-row">
          <span id="cs-slide-lbl"></span>
        </div>

        <div id="cs-dados">
          <div class="cs-alerta" id="cs-alerta" style="display:none">
            <span>⚠</span><div id="cs-alerta-txt"></div>
          </div>
          <div class="cs-toggle-row">
            <span class="cs-toggle-lbl">Diferença calculada</span>
            <div class="cs-toggle-btns">
              <button class="cs-tbtn on" id="cs-tbtn-hoje"  onclick="csSetToggle('hoje')">vs Hoje</button>
              <button class="cs-tbtn"    id="cs-tbtn-ontem" onclick="csSetToggle('ontem')">vs Ontem</button>
            </div>
          </div>
          <table class="cs-preco-table">
            <thead>
              <tr>
                <th>Combustível</th>
                <th>Concorrente</th>
                <th>Meu</th>
                <th style="text-align:right">Diferença</th>
              </tr>
            </thead>
            <tbody id="cs-tbody"></tbody>
          </table>
        </div>

        <div id="cs-acoes">
          <button class="cs-btn-ant"  onclick="csPosAnterior()">← Posto ant.</button>
          <button class="cs-btn-flag" onclick="csSinalizar()" title="Sinalizar">⚠</button>
          <button class="cs-btn-ok"   onclick="csConfirmar()">✓ Ok e próximo posto</button>
        </div>
      </div>
    </div>
    <div id="cs-zoom"><button id="cs-zoom-close" aria-label="Fechar">✕</button><img id="cs-zoom-img" src="" alt="Zoom" draggable="false"></div>
  `;

  csIniciarSwipe();
  csCarregar();
}

// ── Carregamento (Opção A: deriva hoje+ontem no módulo) ───────────
async function csCarregar() {
  const diasEl = document.getElementById('cs-flt-dias');
  const dias   = diasEl ? parseInt(diasEl.value) : 1;
  const listaEl = document.getElementById('cs-lista');
  if (listaEl) listaEl.innerHTML = '<div class="cs-estado"><div class="cs-spin"></div>Carregando...</div>';

  try {
    const dataISO = hojeISO();
    // precisa de >=2 dias pra ter "ontem" na comparação do toggle.
    // Em paralelo, carrega as revisões já salvas hoje. O backend resolve
    // nome->id no POST, então o frontend não precisa lidar com posto_id.
    const [porPosto, respRev] = await Promise.all([
      buscarColetasAgrupadas({ dias: Math.max(dias, 2) }),
      apiFetch('/coleta-revisao?data=' + dataISO).catch(err => {
        console.warn('Não foi possível carregar revisões salvas:', err.message);
        return { linhas: [] };
      }),
    ]);
    const hoje  = hojeBR();
    const ontem = ontemBR();

    // revisões já gravadas hoje, indexadas pela MESMA chave de posto do
    // módulo (normalizarNomePosto(nome) === mp.k). O GET devolve posto_nome.
    CS_REVISOES = {};
    (respRev.linhas || []).forEach(l => {
      const chave = normalizarNomePosto(l.posto_nome || '');
      if (!chave) return;
      if (!CS_REVISOES[chave]) CS_REVISOES[chave] = {};
      CS_REVISOES[chave][l.combustivel] = l;
    });

    // Monta os 37 postos a partir de MAP_POSTOS (fonte canônica), join por .k
    CS_POSTOS = MAP_POSTOS.slice()
      .sort((a, b) => a.ap.localeCompare(b.ap))
      .map(mp => {
        const grupo = porPosto[mp.k] || { proprio: [], concorrentes: [] };

        // ── meu preço hoje / ontem (grupo.proprio vem desc por data/hora) ──
        const proprioHoje   = grupo.proprio.find(r => r.data === hoje) || null;
        const proprioUltimo = grupo.proprio[0] || null;
        const proprio       = proprioHoje || proprioUltimo;
        const proprioOntem  = grupo.proprio.find(r => r.data === ontem) || null;
        const proprioDesatualizado = !!proprio && proprio.data !== hoje;

        // ── concorrentes agrupados por nome (mais recente + ontem) ──
        const porConc = {};
        grupo.concorrentes.forEach(r => {
          const nome = r.postoAlvo;
          if (!nome || nome === '-') return;
          if (!porConc[nome]) porConc[nome] = [];
          porConc[nome].push(r);
        });
        const concs = Object.keys(porConc).map(nome => {
          const regs = porConc[nome]; // desc por data/hora
          const ultimo = regs[0];
          return {
            PostoAlvo:     nome,
            Bandeira:      (ultimo.bandeira && ultimo.bandeira !== '-') ? ultimo.bandeira : '',
            Foto:          ultimo.foto || '',
            registro:      ultimo,
            registroOntem: regs.find(r => r.data === ontem) || null,
            desatualizado: ultimo.data !== hoje,
          };
        });

        return {
          key:        mp.k,
          nome:       mp.ap,
          sup:        mp.sup || (proprio && proprio.supervisor !== '-' ? proprio.supervisor : ''),
          banda:      mp.banda || '',
          gerente:    (proprio && proprio.gerente && proprio.gerente !== '-') ? proprio.gerente : '',
          data:       (proprio && proprio.data) || '',
          hora:       (proprio && proprio.hora) || '',
          fotoMeu:    (proprio && proprio.foto) || '',
          proprio:    proprio || null,
          proprioOntem: proprioOntem || null,
          proprioDesatualizado,
          concs:      concs,
          qtdConcs:   concs.length,
          temColeta:  grupo.proprio.some(r => r.data === hoje) || grupo.concorrentes.some(r => r.data === hoje),
        };
      });

    CS_ESTADOS = {};
    CS_POSTOS.forEach(p => {
      const rev = CS_REVISOES[p.key] || {};
      const conferido = rev['GERAL'] && rev['GERAL'].status === 'conferido';
      // editado = qualquer linha de combustível (não-GERAL) com preço editado ou status 'sinalizado'
      const editado = Object.keys(rev).some(comb =>
        comb !== 'GERAL' &&
        ((rev[comb].preco_editado !== null && rev[comb].preco_editado !== undefined) || rev[comb].status === 'sinalizado')
      );
      // verde (='ok') para conferido OU editado — mesma cor pros dois (decisão do Maycon)
      CS_ESTADOS[p.key] = (conferido || editado) ? 'ok' : 'pend';
    });

    csPopularFiltros();
    csAplicarFiltros();

    // data mais recente entre os registros próprios
    const datas = CS_POSTOS.map(p => p.data).filter(Boolean);
    const dataEl = document.getElementById('cs-data');
    if (dataEl) dataEl.textContent = datas.length ? (datas.includes(hoje) ? hoje : datas.sort().pop()) : '—';

  } catch (e) {
    const el = document.getElementById('cs-lista');
    if (el) el.innerHTML = `<div class="cs-estado">
      <span style="color:#f87171">⚠ Erro ao carregar</span>
      <span style="font-size:11px">${e.message}</span>
      <button onclick="csCarregar()" style="background:var(--sf2);border:none;border-radius:6px;color:var(--tx);padding:6px 12px;font-size:12px;cursor:pointer">↻ Tentar novamente</button>
    </div>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────
// Data de hoje em YYYY-MM-DD a partir do horário LOCAL (evita o drift
// de um dia que new Date().toISOString() causa à noite no fuso BR).
// É a data usada pra gravar/ler coleta_revisao.
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function csFmt(v) {
  if (v === null || v === undefined) return '—';
  return parseFloat(v).toFixed(2).replace('.', ',');
}
function csCorBanda(b) {
  if (!b) return { bg:'var(--sf2)', txt:'var(--tx3)' };
  const bl = b.toLowerCase();
  if (bl.includes('shell'))    return { bg:'#92600020', txt:'#fcd34d' };
  if (bl.includes('ipiranga')) return { bg:'#d6400020', txt:'#f87171' };
  if (bl.includes('br') || bl.includes('petrobras')) return { bg:'#00562020', txt:'#4ade80' };
  if (bl.includes('ale'))      return { bg:'#1e3a8a20', txt:'#93c5fd' };
  return { bg:'var(--sf2)', txt:'var(--tx2)' };
}

// ── Filtros ───────────────────────────────────────────────────────
function csPopularFiltros() {
  const sups = [...new Set(CS_POSTOS.map(p => p.sup).filter(Boolean))].sort();
  const el = document.getElementById('cs-flt-sup');
  if (el) el.innerHTML = '<option value="">Todos supervisores</option>' + sups.map(s => `<option>${s}</option>`).join('');
}

function csAplicarFiltros() {
  const sup = (document.getElementById('cs-flt-sup') || {}).value || '';
  CS_FILTRO_SUP = sup;
  CS_FILTRADOS = CS_POSTOS.filter(p => {
    if (sup && p.sup !== sup) return false;
    const est = CS_ESTADOS[p.key] || 'pend';
    if (window._csPillAtivo === 'pend' && est !== 'pend') return false;
    if (window._csPillAtivo === 'ok'   && est !== 'ok')   return false;
    if (window._csPillAtivo === 'flag' && est !== 'flag') return false;
    return true;
  });
  csRenderLista();
  csAtualizarProg();
}

function csSetPill(tipo, el) {
  window._csPillAtivo = tipo;
  document.querySelectorAll('.cs-pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  csAplicarFiltros();
}

// ── Lista dos 37 postos ───────────────────────────────────────────
function csRenderLista() {
  const el = document.getElementById('cs-lista');
  if (!el) return;

  const qtdEl = document.getElementById('cs-qtd-postos');
  if (qtdEl) qtdEl.textContent = CS_FILTRADOS.length;

  if (!CS_FILTRADOS.length) {
    el.innerHTML = '<div class="cs-estado">Nenhum posto encontrado</div>';
    return;
  }

  el.innerHTML = CS_FILTRADOS.map((p, i) => {
    const est = CS_ESTADOS[p.key] || 'pend';
    const sdCls = est === 'ok' ? 'cs-sd-ok' : est === 'flag' ? 'cs-sd-flag' : 'cs-sd-pend';
    const liCls = est === 'ok' ? 'cs-ok' : est === 'flag' ? 'cs-flag' : '';
    const icon  = p.temColeta ? '📍' : '⏳';
    const bc = csCorBanda(p.banda || '');
    const revP = CS_REVISOES[p.key] || {};
    const conferido = !!(revP['GERAL'] && revP['GERAL'].status === 'conferido');
    return `<div class="cs-posto-item ${liCls}" onclick="csAbrirPosto(${i})">
      <div class="cs-posto-icon">${icon}</div>
      <div class="cs-posto-body">
        <div class="cs-posto-nome">${p.nome}</div>
        <div class="cs-posto-sub">
          <span style="color:var(--ac);font-size:10px">${p.sup}</span>
          <span class="cs-band-pill" style="background:${bc.bg};color:${bc.txt}">${p.banda || ''}</span>
        </div>
      </div>
      <div class="cs-posto-right">
        ${conferido ? '<span class="cs-conf-check" title="Conferido pelo ADM">✓ conferido</span>' : ''}
        <span class="cs-qtd-badge">${p.qtdConcs} conc.</span>
        <span class="cs-sd ${sdCls}"></span>
      </div>
    </div>`;
  }).join('');
}

// ── Detalhe do posto ──────────────────────────────────────────────
function csAbrirPosto(i) {
  CS_POSTO_IDX = i;
  CS_CONC_IDX  = 0;
  const lista   = document.getElementById('cs-lista');
  const detalhe = document.getElementById('cs-detalhe');
  if (lista)   lista.style.display   = 'none';
  if (detalhe) { detalhe.style.display = 'flex'; detalhe.classList.add('cs-on'); }
  csRenderDetalhe();
}

function csVoltarLista() {
  CS_POSTO_IDX = -1;
  const lista   = document.getElementById('cs-lista');
  const detalhe = document.getElementById('cs-detalhe');
  if (detalhe) { detalhe.style.display = 'none'; detalhe.classList.remove('cs-on'); }
  if (lista)   lista.style.display   = 'flex';
  csRenderLista();
}

function csRenderDetalhe() {
  if (CS_POSTO_IDX < 0 || CS_POSTO_IDX >= CS_FILTRADOS.length) return;
  const posto = CS_FILTRADOS[CS_POSTO_IDX];

  const counter = document.getElementById('cs-counter');
  if (counter) counter.textContent = 'Posto ' + (CS_POSTO_IDX + 1) + ' / ' + CS_FILTRADOS.length;

  const dPostoEl = document.getElementById('cs-d-posto');
  if (dPostoEl) dPostoEl.textContent = posto.nome;

  const dSupEl = document.getElementById('cs-d-sup');
  if (dSupEl) dSupEl.textContent = posto.sup || '—';
  const dDataEl = document.getElementById('cs-d-data');
  if (dDataEl) dDataEl.textContent = posto.data || '—';

  const dGerEl = document.getElementById('cs-d-ger');
  if (dGerEl) dGerEl.textContent = posto.gerente || '—';
  const dHoraEl = document.getElementById('cs-d-hora');
  if (dHoraEl) dHoraEl.textContent = posto.hora || '—';

  const totEl = document.getElementById('cs-d-concs-total');
  if (totEl) totEl.innerHTML = `📋 <b>${posto.qtdConcs} concorrente(s)</b>`;

  const est   = CS_ESTADOS[posto.key] || 'pend';
  const badge = document.getElementById('cs-d-badge');
  if (badge) {
    badge.textContent = est === 'ok' ? '✓ ok' : est === 'flag' ? '⚠ sinalizado' : 'pendente';
    badge.className   = 'cs-badge ' + (est === 'ok' ? 'cs-badge-ok' : est === 'flag' ? 'cs-badge-flag' : 'cs-badge-pend');
  }

  csConstruirCarrossel(posto);
  csAtualizarCarrossel(false);
  csRenderPrecos();
}

// ── Carrossel de concorrentes ─────────────────────────────────────
function csConstruirCarrossel(posto) {
  const wrap  = document.getElementById('cs-fotos-wrap');
  const track = document.getElementById('cs-fotos-track');
  if (!wrap || !track) return;
  const W = wrap.offsetWidth || window.innerWidth;

  if (!posto.concs.length) {
    // sem coleta de concorrentes — mostra só a foto do meu posto
    track.innerHTML = `<div class="cs-slide" style="width:${W}px">
      <div class="cs-fhalf" style="background:#0a0d12;justify-content:center;flex-direction:column;align-items:center;gap:8px">
        <span style="font-size:30px">⏳</span>
        <span style="font-size:12px;color:var(--tx3)">Sem coleta de concorrentes hoje</span>
      </div>
      <div class="cs-fhalf" style="border-left:1px solid rgba(0,229,160,.2)">
        ${csFotoHalfInner(posto.fotoMeu, 'meu', posto.nome)}
      </div>
    </div>`;
    const dotsRow = document.getElementById('cs-dots-row');
    if (dotsRow) dotsRow.innerHTML = '<span id="cs-slide-lbl" style="font-size:9px;color:var(--tx3)">0 concorrentes coletados</span>';
    const al = document.getElementById('cs-arr-l');
    const ar = document.getElementById('cs-arr-r');
    if (al) al.style.display = 'none';
    if (ar) ar.style.display = 'none';
    return;
  }

  track.innerHTML = posto.concs.map((conc) => {
    return `<div class="cs-slide" style="width:${W}px">
      ${csFotoHalf(conc.Foto, 'conc', conc.PostoAlvo || 'Concorrente')}
      <div class="cs-fhalf" style="border-left:1px solid rgba(0,229,160,.2)">
        ${csFotoHalfInner(posto.fotoMeu, 'meu', posto.nome)}
      </div>
    </div>`;
  }).join('');

  const dotsRow = document.getElementById('cs-dots-row');
  if (dotsRow) {
    const dotsHtml = posto.concs.map((_, i) =>
      `<div class="cs-dot${i === CS_CONC_IDX ? ' on' : ''}" onclick="csConcGoTo(${i})"></div>`
    ).join('');
    const nomeConcAtual = (posto.concs[CS_CONC_IDX] && posto.concs[CS_CONC_IDX].PostoAlvo) || '—';
    dotsRow.innerHTML = dotsHtml + `<span id="cs-slide-lbl">${nomeConcAtual}</span>`;
  }

  const al = document.getElementById('cs-arr-l');
  const ar = document.getElementById('cs-arr-r');
  if (al) al.style.display = posto.concs.length > 1 ? 'flex' : 'none';
  if (ar) ar.style.display = posto.concs.length > 1 ? 'flex' : 'none';

  const hint = document.getElementById('cs-hint');
  if (hint) {
    hint.style.opacity = (posto.concs.length > 1 && !csHintShown) ? '1' : '0';
    if (posto.concs.length > 1 && !csHintShown) {
      setTimeout(() => { const h = document.getElementById('cs-hint'); if (h) h.style.opacity = '0'; csHintShown = true; }, 1800);
    }
  }

  csAtualizarNomeConc();
}

function csAtualizarNomeConc() {
  if (CS_POSTO_IDX < 0 || CS_POSTO_IDX >= CS_FILTRADOS.length) return;
  const posto = CS_FILTRADOS[CS_POSTO_IDX];
  const conc  = posto.concs[CS_CONC_IDX];
  const nomeEl = document.getElementById('cs-d-conc-nome');
  if (nomeEl) {
    if (conc) {
      const bc = csCorBanda(conc.Bandeira);
      nomeEl.innerHTML = `${conc.PostoAlvo || '—'} <span class="cs-band-pill" style="background:${bc.bg};color:${bc.txt}">${conc.Bandeira || ''}</span>`;
    } else {
      nomeEl.textContent = 'Sem concorrentes coletados';
    }
  }
}

function csAtualizarCarrossel(animate) {
  const wrap  = document.getElementById('cs-fotos-wrap');
  const track = document.getElementById('cs-fotos-track');
  if (!wrap || !track) return;
  const W = wrap.offsetWidth || window.innerWidth;
  track.style.transition = animate ? 'transform .28s cubic-bezier(.4,0,.2,1)' : 'none';
  track.style.transform  = `translateX(${-CS_CONC_IDX * W}px)`;

  document.querySelectorAll('.cs-dot').forEach((d, i) => d.classList.toggle('on', i === CS_CONC_IDX));

  if (CS_POSTO_IDX >= 0 && CS_POSTO_IDX < CS_FILTRADOS.length) {
    const posto = CS_FILTRADOS[CS_POSTO_IDX];
    const nomeConcAtual = (posto.concs[CS_CONC_IDX] && posto.concs[CS_CONC_IDX].PostoAlvo) || '';
    const lbl = document.getElementById('cs-slide-lbl');
    if (lbl) lbl.textContent = nomeConcAtual;
  }

  const al = document.getElementById('cs-arr-l');
  const ar = document.getElementById('cs-arr-r');
  if (CS_POSTO_IDX >= 0 && CS_POSTO_IDX < CS_FILTRADOS.length) {
    const n = CS_FILTRADOS[CS_POSTO_IDX].concs.length;
    if (al) al.style.opacity = CS_CONC_IDX === 0 ? '.3' : '1';
    if (ar) ar.style.opacity = CS_CONC_IDX >= n - 1 ? '.3' : '1';
  }
}

function csConcGoTo(i) {
  if (CS_POSTO_IDX < 0 || CS_POSTO_IDX >= CS_FILTRADOS.length) return;
  const n = CS_FILTRADOS[CS_POSTO_IDX].concs.length;
  CS_CONC_IDX = Math.max(0, Math.min(n - 1, i));
  csAtualizarCarrossel(true);
  csAtualizarNomeConc();
  csRenderPrecos();
}

function csConcNav(dir) { csConcGoTo(CS_CONC_IDX + dir); }

// ── Swipe touch + mouse ───────────────────────────────────────────
function csIniciarSwipe() {
  if (CS_SWIPE_INIT) return; // evita empilhar listeners em re-renders
  CS_SWIPE_INIT = true;
  document.addEventListener('touchstart',  csOnTS, { passive:true });
  document.addEventListener('touchmove',   csOnTM, { passive:true });
  document.addEventListener('touchend',    csOnTE);
  document.addEventListener('mousedown',   csOnMS);
  document.addEventListener('mousemove',   csOnMM);
  document.addEventListener('mouseup',     csOnME);
  document.addEventListener('mouseleave',  csOnME);
}
function csIsInWrap(e) {
  const w = document.getElementById('cs-fotos-wrap');
  return w && w.contains(e.target);
}
function csApplyDrag(delta) {
  const wrap = document.getElementById('cs-fotos-wrap');
  const track = document.getElementById('cs-fotos-track');
  if (!wrap || !track) return;
  track.style.transition = 'none';
  track.style.transform = `translateX(${-CS_CONC_IDX * (wrap.offsetWidth || window.innerWidth) + delta}px)`;
}
function csFinishDrag() {
  if (Math.abs(csDelta) > 50) csConcNav(csDelta < 0 ? 1 : -1);
  else csAtualizarCarrossel(true);
  csDelta = 0;
}
function csOnTS(e){ if(!csIsInWrap(e)) return; csSX=e.touches[0].clientX; csDragging=true; }
function csOnTM(e){ if(!csDragging||!csIsInWrap(e)) return; csDelta=e.touches[0].clientX-csSX; csApplyDrag(csDelta); }
function csOnTE(){ if(!csDragging) return; csDragging=false; csFinishDrag(); }
function csOnMS(e){ if(!csIsInWrap(e)) return; csSX=e.clientX; csDragging=true; }
function csOnMM(e){ if(!csDragging) return; csDelta=e.clientX-csSX; csApplyDrag(csDelta); }
function csOnME(){ if(!csDragging) return; csDragging=false; csFinishDrag(); }

// ── Foto helpers (URL direta do Supabase — sem pipeline do Drive) ──
function csFotoHalf(url, tipo, labelTxt) {
  return `<div class="cs-fhalf">${csFotoHalfInner(url, tipo, labelTxt)}</div>`;
}
function csFotoHalfInner(url, tipo, labelTxt) {
  const lblCls  = tipo === 'conc' ? 'cs-flabel conc' : 'cs-flabel meu';
  const icon    = tipo === 'conc' ? '📷' : '🏠';
  const short   = (labelTxt || '').substring(0, 18);
  const strokeC = tipo === 'meu' ? 'rgba(0,229,160,.3)' : '#8b949e';
  const phColor = tipo === 'meu' ? 'rgba(0,229,160,.5)' : 'var(--tx3)';
  const svg = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${strokeC}" stroke-width="1.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  if (url && url !== '-') {
    const safe = String(url).replace(/'/g, '%27');
    return `<img src="${url}" alt="${labelTxt}" onclick="csZoom('${safe}')"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="cs-foto-ph" style="display:none">
              ${svg}
              <span style="color:${phColor}">foto indisponível</span>
            </div>
            <div class="${lblCls}">${icon} ${short}</div>`;
  }
  return `<div class="cs-foto-ph">
    ${svg}
    <span style="color:${phColor}">sem foto</span>
  </div>
  <div class="${lblCls}">${icon} ${short}</div>`;
}

// ── Tabela de preços / diferença ──────────────────────────────────
function csSetToggle(modo) {
  CS_MODO_DIFF = modo;
  const bh = document.getElementById('cs-tbtn-hoje');
  const bo = document.getElementById('cs-tbtn-ontem');
  if (bh) bh.classList.toggle('on', modo === 'hoje');
  if (bo) bo.classList.toggle('on', modo === 'ontem');
  csRenderPrecos();
}

function csRenderPrecos() {
  if (CS_POSTO_IDX < 0 || CS_POSTO_IDX >= CS_FILTRADOS.length) return;
  const posto = CS_FILTRADOS[CS_POSTO_IDX];
  const conc  = posto.concs[CS_CONC_IDX] || null;

  const meuHoje  = posto.proprio      || {};
  const meuOntem = posto.proprioOntem || {};
  const meuBase  = CS_MODO_DIFF === 'hoje' ? meuHoje : meuOntem;

  if (!conc) {
    const tbody = document.getElementById('cs-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="padding:16px;text-align:center;opacity:.4">Sem concorrentes coletados para este posto hoje</td></tr>`;
    const ab = document.getElementById('cs-alerta');
    if (ab) ab.style.display = 'none';
    return;
  }

  const alertas = [];
  const revPosto   = CS_REVISOES[posto.key] || {};
  const podeEditar = CS_MODO_DIFF === 'hoje'; // edição/lápis só no contexto "hoje"
  let html = '';

  ['GC','ET','GA','S10','S500'].forEach(k => {
    const concVal = conc.registro[k];
    if (concVal === null || concVal === undefined) return;

    // preço editado (revisão) tem prioridade sobre o coletado, no modo "hoje"
    const rev = revPosto[k];
    const editado = podeEditar && rev && rev.preco_editado !== null && rev.preco_editado !== undefined;

    const meuVal = editado
      ? Number(rev.preco_editado)
      : ((meuBase[k] !== undefined && meuBase[k] !== null) ? meuBase[k] : null);
    const meuHojeV = (meuHoje[k] !== undefined && meuHoje[k] !== null) ? meuHoje[k] : null;
    let rowCls = '', diffHtml = '', deltaHtml = '';

    if (meuVal !== null) {
      const d = meuVal - concVal;
      if (d > 0.005) {
        rowCls   = 'cs-tr-bad';
        diffHtml = `<span class="cs-dif-bad">▲ ${csFmt(Math.abs(d))}</span><span class="cs-dif-sub">eu mais caro</span>`;
        alertas.push(`${CS_FUEL_NAMES[k] || k}: conc. R$${csFmt(concVal)} vs meu R$${csFmt(meuVal)}`);
      } else if (d < -0.005) {
        rowCls   = 'cs-tr-ok';
        diffHtml = `<span class="cs-dif-ok">▼ ${csFmt(Math.abs(d))}</span><span class="cs-dif-sub">eu mais barato</span>`;
      } else {
        rowCls   = 'cs-tr-eq';
        diffHtml = `<span class="cs-dif-eq">= igual</span>`;
      }
      if (CS_MODO_DIFF === 'ontem' && meuHojeV !== null && meuOntem[k] !== undefined && meuOntem[k] !== null) {
        const delta = meuHojeV - meuOntem[k];
        if (Math.abs(delta) >= 0.005) {
          const cls  = delta > 0 ? 'cs-delta-up' : 'cs-delta-dn';
          const seta = delta > 0 ? '↑' : '↓';
          deltaHtml = `<span class="cs-delta ${cls}">${seta} ${Math.abs(delta).toFixed(2).replace('.', ',')} vs ontem</span>`;
        } else {
          deltaHtml = `<span class="cs-delta cs-delta-eq">= sem mudança</span>`;
        }
      }
    } else {
      diffHtml = `<span class="cs-dif-eq" style="opacity:.4">—</span>`;
    }

    // SÓ o combustível editado fica vermelho (linha + valor + selo).
    // Não editados seguem o realce de diferença normal ("continuam como estão").
    if (editado) rowCls = 'cs-tr-bad';

    const pen = podeEditar
      ? ` <span class="cs-edit-pen" onclick="csEditarPreco('${k}')" title="Editar nosso preço">✏️</span>`
      : '';
    let meuCell;
    if (meuVal !== null) {
      const corMeu = editado ? ' style="color:#f87171"' : '';
      const selo   = editado ? `<span class="cs-dif-sub" style="color:#f87171">✏️ editado</span>` : deltaHtml;
      meuCell = `<span class="cs-v-meu"${corMeu}>R$${csFmt(meuVal)}</span>${pen}${selo}`;
    } else {
      meuCell = `<span style="opacity:.4">—</span>${pen}`;
    }

    html += `<tr class="${rowCls}">
      <td><span class="cs-fuel-nm">${CS_FUEL_NAMES[k] || k}</span></td>
      <td><span class="cs-v-conc">R$${csFmt(concVal)}</span></td>
      <td id="cs-meucell-${k}">${meuCell}</td>
      <td class="cs-diff-col">${diffHtml}</td>
    </tr>`;
  });

  const tbody = document.getElementById('cs-tbody');
  if (tbody) tbody.innerHTML = html || `<tr><td colspan="4" style="padding:14px;text-align:center;opacity:.4">Sem preços</td></tr>`;

  const ab  = document.getElementById('cs-alerta');
  const abt = document.getElementById('cs-alerta-txt');
  if (ab && abt) {
    if (alertas.length) { abt.innerHTML = alertas.join(' · '); ab.style.display = 'flex'; }
    else ab.style.display = 'none';
  }
}

// ── Ações (status client-side efêmero — persistência é Etapa 2) ───
async function csConfirmar() {
  if (CS_POSTO_IDX < 0) return;
  const posto = CS_FILTRADOS[CS_POSTO_IDX];
  if (!posto) return;
  try {
    await apiFetch('/coleta-revisao/conferir', {
      method: 'POST',
      body: JSON.stringify({ posto_nome: posto.nome, data: hojeISO() }),
    });
    // marca conferido localmente (mesma forma do GET: sentinela GERAL) pro ✓ aparecer já
    if (!CS_REVISOES[posto.key]) CS_REVISOES[posto.key] = {};
    CS_REVISOES[posto.key]['GERAL'] = { status: 'conferido' };
    CS_ESTADOS[posto.key] = 'ok';
    csToast('✓ posto conferido');
  } catch (err) {
    csToast('⚠ erro ao conferir: ' + err.message);
    return; // NÃO avança se não salvou (o ADM percebe)
  }
  csAtualizarProg();
  if (CS_POSTO_IDX < CS_FILTRADOS.length - 1) { CS_POSTO_IDX++; CS_CONC_IDX = 0; csRenderDetalhe(); }
  else csVoltarLista();
}
function csSinalizar() {
  if (CS_POSTO_IDX < 0) return;
  CS_ESTADOS[CS_FILTRADOS[CS_POSTO_IDX].key] = 'flag';
  csAtualizarProg();
  csRenderDetalhe();
}
function csPosProximo()  { if (CS_POSTO_IDX < CS_FILTRADOS.length - 1) { CS_POSTO_IDX++; CS_CONC_IDX = 0; csRenderDetalhe(); } }
function csPosAnterior() { if (CS_POSTO_IDX > 0)                       { CS_POSTO_IDX--; CS_CONC_IDX = 0; csRenderDetalhe(); } }
function csAtualizarProg() {
  const tot = CS_POSTOS.length;
  const ok  = CS_POSTOS.filter(p => (CS_ESTADOS[p.key] || 'pend') !== 'pend').length;
  const el  = document.getElementById('cs-prog-fill');
  if (el) el.style.width = tot > 0 ? Math.round(ok / tot * 100) + '%' : '0%';
}

// ── Zoom ──────────────────────────────────────────────────────────
function csZoom(src) {
  const z = document.getElementById('cs-zoom');
  const i = document.getElementById('cs-zoom-img');
  if (!z || !i) return;
  i.src = src;
  z.style.display = 'flex';
  csZoomInit(z, i);
}

function csZoomInit(z, i) {
  // estado do zoom/pan
  let scale = 1, tx = 0, ty = 0;
  const apply = () => { i.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  const reset = () => { scale = 1; tx = 0; ty = 0; apply(); };
  reset();

  // fecha só no fundo preto e no ✕ (nunca ao tocar a foto)
  const close = () => { z.style.display = 'none'; reset(); };
  z.onclick = (e) => { if (e.target === z) close(); };
  const btn = document.getElementById('cs-zoom-close');
  if (btn) btn.onclick = close;

  // impede o pinch/scroll da PÁGINA dentro do overlay
  const stop = (e) => e.preventDefault();

  // ---- toque (iPhone): 1 dedo arrasta, 2 dedos dão pinça ----
  let pts = new Map(), startDist = 0, startScale = 1, lastX = 0, lastY = 0;
  i.onpointerdown = (e) => { i.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); lastX = e.clientX; lastY = e.clientY;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); startScale = scale; } };
  i.onpointermove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e);
    if (pts.size === 2) { // pinça
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      scale = Math.min(6, Math.max(1, startScale * (d / startDist)));
      apply();
    } else if (pts.size === 1 && scale > 1) { // arrasta
      tx += e.clientX - lastX; ty += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; apply();
    }
  };
  const up = (e) => { pts.delete(e.pointerId); if (scale <= 1) { tx = 0; ty = 0; apply(); } };
  i.onpointerup = up; i.onpointercancel = up;

  // ---- desktop: scroll dá zoom ----
  i.onwheel = (e) => { e.preventDefault(); scale = Math.min(6, Math.max(1, scale - e.deltaY * 0.002)); if (scale <= 1) { tx = 0; ty = 0; } apply(); };

  // ---- toque duplo / duplo-clique: alterna ajustada <-> 2.5x ----
  i.ondblclick = () => { scale = scale > 1 ? 1 : 2.5; tx = 0; ty = 0; apply(); };

  // trava o gesto nativo da página só aqui dentro
  z.ontouchmove = stop;
}

// ── Edição do NOSSO preço (lápis) ─────────────────────────────────
// Troca a célula "Meu" do combustível k por um input já preenchido com
// o nosso preço atual. Confirma no Enter ou ao sair do campo (blur).
function csEditarPreco(k) {
  if (CS_POSTO_IDX < 0) return;
  const posto = CS_FILTRADOS[CS_POSTO_IDX];
  if (!posto) return;

  const cell = document.getElementById('cs-meucell-' + k);
  if (!cell) return;

  const rev   = (CS_REVISOES[posto.key] || {})[k];
  const orig  = (posto.proprio && posto.proprio[k] !== null && posto.proprio[k] !== undefined) ? Number(posto.proprio[k]) : null;
  const atual = (rev && rev.preco_editado !== null && rev.preco_editado !== undefined) ? Number(rev.preco_editado) : orig;
  const val   = atual !== null ? atual.toFixed(2).replace('.', ',') : '';

  cell.innerHTML = `<input class="cs-edit-input" id="cs-edit-${k}" type="text" inputmode="decimal"
    value="${val}"
    onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
    onblur="csConfirmarEdicao('${k}')">`;
  const inp = document.getElementById('cs-edit-' + k);
  if (inp) { inp.focus(); inp.select(); }
}

async function csConfirmarEdicao(k) {
  const inp = document.getElementById('cs-edit-' + k);
  if (!inp || inp.dataset.saving === '1') return;
  if (CS_POSTO_IDX < 0) return;
  const posto = CS_FILTRADOS[CS_POSTO_IDX];
  if (!posto) return;

  const raw  = inp.value.trim().replace(',', '.');
  const novo = parseFloat(raw);
  const orig = (posto.proprio && posto.proprio[k] !== null && posto.proprio[k] !== undefined) ? Number(posto.proprio[k]) : null;

  // valor inválido/vazio → cancela sem salvar (redesenha)
  if (raw === '' || isNaN(novo) || novo <= 0) { csRenderPrecos(); return; }

  // sem mudança em relação ao já editado (ou ao original) → cancela
  const rev   = (CS_REVISOES[posto.key] || {})[k];
  const atual = (rev && rev.preco_editado !== null && rev.preco_editado !== undefined) ? Number(rev.preco_editado) : orig;
  if (atual !== null && Math.abs(novo - atual) < 0.005) { csRenderPrecos(); return; }

  inp.dataset.saving = '1';
  try {
    const resp = await apiFetch('/coleta-revisao', {
      method: 'POST',
      body: JSON.stringify({
        posto_nome:     posto.nome,
        data:           hojeISO(),
        combustivel:    k,
        preco_editado:  novo,
        preco_original: orig,
      }),
    });
    const linha = resp.linha || { preco_editado: novo, preco_original: orig, status: 'sinalizado' };
    if (!CS_REVISOES[posto.key]) CS_REVISOES[posto.key] = {};
    CS_REVISOES[posto.key][k] = linha;
    csToast('✓ preço salvo');
  } catch (err) {
    csToast('⚠ erro ao salvar: ' + err.message);
  }
  csRenderPrecos();
}

// ── Toast discreto ────────────────────────────────────────────────
function csToast(msg) {
  let t = document.getElementById('cs-toast');
  if (!t) { t = document.createElement('div'); t.id = 'cs-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('cs-toast-on');
  clearTimeout(window._csToastT);
  window._csToastT = setTimeout(() => { const el = document.getElementById('cs-toast'); if (el) el.classList.remove('cs-toast-on'); }, 2200);
}

window.renderColetaRevisao = renderColetaRevisao;
