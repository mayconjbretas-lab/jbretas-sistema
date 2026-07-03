// ================================================================
// JBRETAS SISTEMA — modulos/admin/coleta-precos/app.js
// Visibilidade simples pro ADM: lista bruta de GET /coletas (sem
// filtro de posto = retorna todos), com filtros client-side por
// posto próprio e por concorrente. Sem cores/comparação — isso é
// Fase 2 (aba Comparar do painel completo).
// ================================================================

let usuarioAtual = null;
let coletas = [];

document.addEventListener('DOMContentLoaded', async () => {
  usuarioAtual = exigirSessao(['ADM']);
  if (!usuarioAtual) return;

  document.getElementById('app-gerente').textContent = usuarioAtual.nome || '—';
  const iniciais = (usuarioAtual.nome || '??').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
  document.getElementById('app-avatar').textContent = iniciais;

  await carregarColetas();
});

async function carregarColetas() {
  const dias = document.getElementById('filtro-dias').value;
  const container = document.getElementById('tabela-coletas');
  container.innerHTML = '<div class="empty-state">Carregando...</div>';
  try {
    const resp = await apiFetch(`/coletas?dias=${encodeURIComponent(dias)}`);
    coletas = resp.registros || [];
    renderTabela();
  } catch (err) {
    container.innerHTML = `<div class="empty-state">⚠ Erro ao carregar coletas: ${err.message}</div>`;
  }
}

function renderTabela() {
  const container = document.getElementById('tabela-coletas');
  const filtroPosto = document.getElementById('filtro-posto').value.trim().toUpperCase();
  const filtroConc  = document.getElementById('filtro-concorrente').value.trim().toUpperCase();

  const lista = coletas.filter(r =>
    (!filtroPosto || (r.posto || '').toUpperCase().includes(filtroPosto)) &&
    (!filtroConc  || (r.postoAlvo || '').toUpperCase().includes(filtroConc))
  );

  if (!lista.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma coleta encontrada com esses filtros.</div>';
    return;
  }

  const linhas = lista.map(r => `
    <tr>
      <td>${r.data} ${r.hora}</td>
      <td>${r.posto}</td>
      <td>${r.gerente}</td>
      <td>${r.postoAlvo}${r.bandeira && r.bandeira !== '-' ? ' — ' + r.bandeira : ''}</td>
      <td>${['GC','GA','ET','S10','S500'].filter(k => r[k]).map(k => `${k}: R$ ${Number(r[k]).toFixed(2).replace('.', ',')}`).join(' · ') || '—'}</td>
      <td>${r.foto && r.foto !== '-' ? `<a href="${r.foto}" target="_blank" rel="noopener">📷 ver</a>` : '—'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <table class="admin-tabela">
      <thead><tr><th>Data/Hora</th><th>Posto</th><th>Gerente</th><th>Concorrente</th><th>Preços</th><th>Foto</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div class="tabela-contador">${lista.length} coleta(s) exibida(s)</div>
  `;
}
