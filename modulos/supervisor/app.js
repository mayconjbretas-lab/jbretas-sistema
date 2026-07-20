// ================================================================
// JBRETAS SISTEMA — modulos/supervisor/app.js
// Portal do Supervisor (mobile-first). Abas: Regional, Mix, Mapa.
// Consome GET /classificacao-regional e /postos-regional. Coordenadas
// vêm do MAP_POSTOS (postos-mapa.js). pct/mix são FRAÇÃO (×100 na tela).
// ================================================================

let USUARIO = null;
let _dados = null;            // /classificacao-regional
let _pos = null;              // {lat,lng} do supervisor (geolocation)
let _mapPronto = false;
let _map = null, _userMarker = null;
let _postosMapa = [];         // [{id,nome,lat,lng}] da regional (com coords)

// ── Tema ─────────────────────────────────────────────────────────
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

// ── Helpers de formatação ────────────────────────────────────────
function titulo(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());
}
function nomeExib(nome) { return titulo(String(nome || '').replace(/^P\.\s*/i, '')); }
function fmtPctFr(v) {   // fração → "125,78%"
  if (v === null || v === undefined) return '—';
  const n = Number(v); if (isNaN(n)) return '—';
  return (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}
function fmtRS(v) {       // R$ pt-BR sem centavos
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v); if (isNaN(n)) return '—';
  return 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}
function fmtRS2(v) {      // R$ pt-BR com 2 casas
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v); if (isNaN(n)) return '—';
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Célula de comissão: >0 vira R$ verde; null/zero vira travessão.
function comissaoCel(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || isNaN(n) || n <= 0) return { txt: '—', cls: '' };
  return { txt: fmtRS2(n), cls: 'com-pos' };
}
function semaforoFr(v) {  // fração: >=1 ok | 0.85–0.99 info | <0.85 wn
  const n = Number(v); if (isNaN(n)) return '';
  return n >= 1 ? 'sem-ok' : (n >= 0.85 ? 'sem-inf' : 'sem-wn');
}
function normNome(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^P\.\s*/i, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  USUARIO = exigirSessao(['SUPERVISOR', 'ADM']);
  if (!USUARIO) return;
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');
  montarTopbar();
  carregar();
});

function montarTopbar() {
  const nome = USUARIO.nome || USUARIO.email || '—';
  document.getElementById('app-usuario').textContent = nome;
  document.getElementById('app-avatar').textContent = (nome || '??').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
  document.getElementById('app-regional').textContent = 'Regional';
}

function setTab(btn, tab) {
  document.querySelectorAll('.bnav .nbtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.app-main .scr').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('s-' + tab)?.classList.add('active');
  if (tab === 'mapa') iniciarMapa();
}

// ── Carrega classificação + mix da regional ──────────────────────
async function carregar() {
  try {
    _dados = await apiFetch('/classificacao-regional');
    const reg = _dados.supervisor_alvo ? titulo(_dados.supervisor_alvo) : 'Rede (ADM)';
    document.getElementById('app-regional').textContent = reg;
    renderRegional();
    renderMix();
    renderComissao();
  } catch (err) {
    const msg = '<div class="sup-erro">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    document.getElementById('s-regional').innerHTML = msg;
    document.getElementById('s-mix').innerHTML = msg;
    document.getElementById('s-comissao').innerHTML = msg;
  }
}

function fmtCiclo(c) {
  if (!c || (!c.inicio && !c.fim)) return '';
  const dm = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : iso; };
  return dm(c.inicio) + ' a ' + dm(c.fim);
}

// ── ABA REGIONAL ─────────────────────────────────────────────────
function renderRegional() {
  const d = _dados;
  const alvo = d.supervisor_alvo;
  const ciclo = fmtCiclo(d.ciclo);

  // Card 1: ranking das regionais
  const linhasReg = (d.regionais || []).map(r => {
    const eu = alvo && String(r.supervisor).toUpperCase() === String(alvo).toUpperCase();
    return '<li' + (eu ? ' class="rk-voce"' : '') + '>' +
      '<span class="rk-pos">' + r.posicao + '.</span>' +
      '<span class="rk-nome">' + titulo(r.supervisor) + (eu ? '<span class="rk-badge">VOCÊ</span>' : '') + '</span>' +
      '<span class="rk-val">' + fmtPctFr(r.pct) + '</span></li>';
  }).join('');
  const cardReg = '<div class="sup-card"><div class="sup-card-title">🏆 Ranking das Regionais</div>' +
    (ciclo ? '<div class="sup-sub">Ciclo ' + ciclo + ' · % da meta</div>' : '') +
    (linhasReg ? '<ul class="sup-rank">' + linhasReg + '</ul>' : '<div class="sup-empty">Sem dados.</div>') + '</div>';

  // Card 2: meus postos (tabela completa)
  const linhasPostos = (d.postos || []).map(p =>
    '<tr>' +
      '<td>' + nomeExib(p.posto) + '</td>' +
      '<td>' + fmtRS(p.ven) + '</td>' +
      '<td>' + fmtRS(p.meta) + '</td>' +
      '<td>' + fmtRS(p.proj) + '</td>' +
      '<td class="' + semaforoFr(p.pct) + '">' + fmtPctFr(p.pct) + '</td>' +
    '</tr>'
  ).join('');
  const cardPostos = '<div class="sup-card"><div class="sup-card-title">📊 Meus Postos</div>' +
    (linhasPostos
      ? '<div class="sup-tbl-wrap"><table class="sup-tbl"><thead><tr><th>Posto</th><th>Ven</th><th>Meta</th><th>Proj</th><th>%</th></tr></thead><tbody>' + linhasPostos + '</tbody></table></div>'
      : '<div class="sup-empty">Nenhum posto na regional.</div>') + '</div>';

  document.getElementById('s-regional').innerHTML = cardReg + cardPostos;
}

// ── ABA MIX ──────────────────────────────────────────────────────
function renderMix() {
  const d = _dados;
  const alvo = d.supervisor_alvo;
  const ciclo = fmtCiclo(d.ciclo);

  const linhasReg = (d.mix_regionais || []).map(r => {
    const eu = alvo && String(r.supervisor).toUpperCase() === String(alvo).toUpperCase();
    return '<li' + (eu ? ' class="rk-voce"' : '') + '>' +
      '<span class="rk-pos">' + (r.posicao != null ? r.posicao : '–') + '.</span>' +
      '<span class="rk-nome">' + titulo(r.supervisor) + (eu ? '<span class="rk-badge">VOCÊ</span>' : '') + '</span>' +
      '<span class="rk-val">' + fmtPctFr(r.mix) + '</span></li>';
  }).join('');
  const cardReg = '<div class="sup-card"><div class="sup-card-title">🥇 Mix por Regional</div>' +
    (ciclo ? '<div class="sup-sub">Ciclo ' + ciclo + ' · % do volume de gasolina</div>' : '') +
    (linhasReg ? '<ul class="sup-rank">' + linhasReg + '</ul>' : '<div class="sup-empty">Sem dados.</div>') + '</div>';

  const linhasPostos = (d.mix_postos || []).map(r =>
    '<li><span class="rk-pos">' + (r.posicao != null ? r.posicao : '–') + '.</span>' +
      '<span class="rk-nome">' + nomeExib(r.posto) + '</span>' +
      '<span class="rk-val">' + fmtPctFr(r.mix) + '</span></li>'
  ).join('');
  const cardPostos = '<div class="sup-card"><div class="sup-card-title">Mix dos Meus Postos</div>' +
    (linhasPostos ? '<ul class="sup-rank">' + linhasPostos + '</ul>' : '<div class="sup-empty">Sem dados de mix.</div>') + '</div>';

  document.getElementById('s-mix').innerHTML = cardReg + cardPostos;
}

// ── ABA COMISSÃO ─────────────────────────────────────────────────
function renderComissao() {
  const c = (_dados && _dados.comissao) || { periodo: null, postos: [], gerente: null, supervisor: null };
  const box = document.getElementById('s-comissao');
  const temAlgo = (c.postos && c.postos.length) || c.gerente || c.supervisor;
  if (!temAlgo) {
    box.innerHTML = '<div class="sup-card"><div class="sup-card-title">💰 Comissão</div><div class="sup-empty">Aguardando preenchimento da planilha.</div></div>';
    return;
  }
  const periodo = c.periodo ? '<div class="sup-sub">Período ' + esc(c.periodo) + '</div>' : '';

  // Card 1: comissionamento dos gerentes (por posto)
  const linhas = (c.postos || []).map(p => {
    const com = comissaoCel(p.comissao);
    return '<tr>' +
      '<td>' + nomeExib(p.nome) + '</td>' +
      '<td>' + fmtRS2(p.tm) + '</td>' +
      '<td>' + fmtPctFr(p.perc_meta) + '</td>' +
      '<td class="' + com.cls + '">' + com.txt + '</td>' +
    '</tr>';
  }).join('');
  const cardPostos = '<div class="sup-card"><div class="sup-card-title">💰 Comissionamento · gerentes da regional</div>' + periodo +
    (linhas
      ? '<div class="sup-tbl-wrap"><table class="sup-tbl"><thead><tr><th>Posto</th><th>TM</th><th>%Meta</th><th>Comissão</th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
      : '<div class="sup-empty">Sem postos.</div>') + '</div>';

  // Card 2: gerente (projeção) — se vier tipo='gerente'
  const cardLinha = (titulo, item) => {
    const com = comissaoCel(item.comissao);
    return '<div class="sup-card"><div class="sup-card-title">' + titulo + '</div>' +
      '<div class="sup-com-linha"><span class="sup-com-nome">' + nomeExib(item.nome) + '</span>' +
      '<span class="sup-com-val ' + com.cls + '">' + com.txt + '</span></div></div>';
  };
  const cardGerente = c.gerente ? cardLinha('📈 Vendas Gerente · projeção', c.gerente) : '';
  const cardSup = c.supervisor ? cardLinha('🧭 Supervisor', c.supervisor) : '';

  box.innerHTML = cardPostos + cardGerente + cardSup;
}

// ── ABA MAPA ─────────────────────────────────────────────────────
function haversine(la1, lo1, la2, lo2) {
  const R = 6371, rad = Math.PI / 180;
  const dLa = (la2 - la1) * rad, dLo = (lo2 - lo1) * rad;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function iniciarMapa() {
  if (_mapPronto) { if (_map) setTimeout(() => _map.invalidateSize(), 100); return; }
  _mapPronto = true;
  try {
    const resp = await apiFetch('/postos-regional');
    // Resolve coords pelo MAP_POSTOS (coordenadas só existem no front).
    const coordPorNome = new Map();
    (typeof MAP_POSTOS !== 'undefined' ? MAP_POSTOS : []).forEach(p => coordPorNome.set(normNome(p.ap), { lat: p.lat, lng: p.lng }));
    _postosMapa = (resp.postos || []).map(p => {
      const c = coordPorNome.get(normNome(p.nome));
      return c ? { id: p.id, nome: p.nome, lat: c.lat, lng: c.lng } : { id: p.id, nome: p.nome, lat: null, lng: null };
    });
    const comCoord = _postosMapa.filter(p => p.lat != null);
    const centro = comCoord.length
      ? [comCoord.reduce((s, p) => s + p.lat, 0) / comCoord.length, comCoord.reduce((s, p) => s + p.lng, 0) / comCoord.length]
      : [-19.92, -43.94];

    _map = L.map('leaflet-map', { zoomControl: true }).setView(centro, 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(_map);
    comCoord.forEach(p => L.marker([p.lat, p.lng]).addTo(_map).bindPopup(nomeExib(p.nome)));
    setTimeout(() => _map.invalidateSize(), 120);

    renderMapaLista();
    iniciarGeo();
  } catch (err) {
    document.getElementById('mapa-lista').innerHTML = '<div class="sup-erro">Erro ao carregar postos: ' + esc(err.message || err) + '</div>';
  }
}

function iniciarGeo() {
  if (!navigator.geolocation) { renderMapaLista(); return; }
  navigator.geolocation.watchPosition(
    (p) => {
      _pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (_map) {
        if (_userMarker) _userMarker.setLatLng([_pos.lat, _pos.lng]);
        else _userMarker = L.circleMarker([_pos.lat, _pos.lng], { radius: 8, color: '#4895ef', fillColor: '#4895ef', fillOpacity: .7, weight: 2 }).addTo(_map).bindPopup('Você');
      }
      renderMapaLista();
    },
    () => { _pos = null; renderMapaLista(); },   // sem permissão: segue sem distâncias
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
  );
}

function renderMapaLista() {
  const box = document.getElementById('mapa-lista');
  if (!_postosMapa.length) { box.innerHTML = '<div class="sup-empty">Nenhum posto na regional.</div>'; return; }
  let lista = _postosMapa.slice();
  if (_pos) {
    lista.forEach(p => { p._dist = (p.lat != null) ? haversine(_pos.lat, _pos.lng, p.lat, p.lng) : Infinity; });
    lista.sort((a, b) => a._dist - b._dist);
  }
  const aviso = _pos ? '' : '<div class="map-aviso">Ative a localização para ver a distância e ordenar por proximidade.</div>';
  const itens = lista.map(p => {
    const dist = (_pos && p._dist !== Infinity) ? '<span class="sup-posto-dist">' + p._dist.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km de você</span>' : '';
    const rota = (p.lat != null)
      ? '<button class="sup-rota" onclick="abrirRota(' + p.lat + ',' + p.lng + ')">🧭 Rota</button>'
      : '';
    return '<div class="sup-posto"><span class="sup-posto-nome">' + nomeExib(p.nome) + '</span>' + dist + rota + '</div>';
  }).join('');
  box.innerHTML = aviso + itens;
}

function abrirRota(lat, lng) {
  window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng, '_blank');
}
