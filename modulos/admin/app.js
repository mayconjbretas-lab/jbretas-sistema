// ================================================================
// JBRETAS SISTEMA — modulos/admin/mapa-precos/app.js
// Mapa de postos com Leaflet, adaptado do AppPainel (js/app.js,
// funções initLeafletInstance/renderMapa/mapaSetSup), removendo a
// dependência de G_DADOS (preços via Apps Script) — mostra só os
// 37 postos com coordenadas e supervisor. A comparação de preços
// entra numa etapa seguinte, integrada ao Supabase.
// ================================================================

let usuarioAtual = null;
let leafletMap = null;
let markerCluster = null;
let mapMarkers = [];
let G_MAPA_SUP = 'todos';

document.addEventListener('DOMContentLoaded', async () => {
  usuarioAtual = exigirSessao(['ADM']);
  if (!usuarioAtual) return;

  document.getElementById('app-gerente').textContent = usuarioAtual.nome || '—';
  const iniciais = (usuarioAtual.nome || '??').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
  document.getElementById('app-avatar').textContent = iniciais;

  initLeafletInstance();
});

function initLeafletInstance() {
  if (leafletMap !== null) { leafletMap.invalidateSize(); return; }
  leafletMap = L.map('leaflet-map', { zoomControl: false })
    .setView([-19.92, -43.96], 10);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '©OSM ©CARTO', subdomains: 'abcd', maxZoom: 19
  }).addTo(leafletMap);
  markerCluster = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true, showCoverageOnHover: false, removeOutsideVisibleBounds: false })
    : null;
  if (markerCluster) leafletMap.addLayer(markerCluster);
  renderMapa();
}

function mapaSetSup(btn, sup) {
  document.querySelectorAll('.map-ftag').forEach(x => x.classList.remove('on'));
  btn.classList.add('on');
  G_MAPA_SUP = sup;
  renderMapa();
}

function renderMapa() {
  if (!leafletMap) return;
  if (markerCluster) markerCluster.clearLayers();
  else mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];

  let contVisiveis = 0;

  MAP_POSTOS.forEach(posto => {
    if (G_MAPA_SUP !== 'todos' && posto.sup !== G_MAPA_SUP) return;

    const lat = corrigirCoordenada(posto.lat);
    const lng = corrigirCoordenada(posto.lng);
    if (!lat || !lng) return;

    const cor = SUPCOR_MAP[posto.sup] || '#8892a4';
    const iconHtml = `<div class="custom-marker" style="border-color:${cor}">
      <div class="m-name" style="color:${cor}">${posto.ap.replace('P. ', '')}</div>
    </div>`;
    const cIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [76, 26], iconAnchor: [38, 13] });
    const marker = L.marker([lat, lng], { icon: cIcon });
    if (markerCluster) markerCluster.addLayer(marker); else marker.addTo(leafletMap);

    marker.on('click', () => {
      document.getElementById('mapa-detail').innerHTML = `
        <div class="section" style="margin-top:1rem;">
          <div class="section-header">
            <span class="section-icon">📍</span>
            <span class="section-title" style="color:${cor}">${posto.ap}</span>
          </div>
          <div class="section-body">
            <div class="info-grid" style="margin-bottom:0;">
              <div class="info-card">
                <div class="info-card-label">Supervisor</div>
                <div class="info-card-value">${posto.sup}</div>
              </div>
              <div class="info-card">
                <div class="info-card-label">Bandeira</div>
                <div class="info-card-value">${posto.banda}</div>
              </div>
              <div class="info-card">
                <div class="info-card-label">Coordenadas</div>
                <div class="info-card-value" style="font-family:var(--mono);font-size:0.78rem;">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
              </div>
            </div>
            <div class="carga-status-msg" style="text-align:left;color:var(--text3);margin-top:0.75rem;">
              ⏳ Comparação de preços com concorrentes ainda não conectada
            </div>
          </div>
        </div>`;
    });

    mapMarkers.push(marker);
    contVisiveis++;
  });

  const contador = document.getElementById('mapa-contador');
  if (contador) contador.textContent = `${contVisiveis} posto(s) exibido(s)`;

  if (mapMarkers.length > 0) {
    const grupo = L.featureGroup(mapMarkers);
    const bounds = grupo.getBounds();
    if (bounds.isValid()) leafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
  }
}
