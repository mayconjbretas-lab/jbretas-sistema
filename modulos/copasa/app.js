// ================================================================
// JBRETAS SISTEMA — modulos/copasa/app.js
// Consumo de água (Copasa): registra leitura do hidrômetro, calcula
// consumo (leitura atual − leitura anterior) no backend, e mostra
// KPIs + gráfico de 14 dias + tabelas por período.
// ================================================================

let usuarioAtual = null;
let registros = []; // desc por data — vem direto de GET /copasa/:posto
let abaAtual = 'resumo';

document.addEventListener('DOMContentLoaded', async () => {
  usuarioAtual = exigirSessao(['GERENTE']);
  if (!usuarioAtual) return;

  montarTopbar();

  if (!usuarioAtual.posto?.nome) {
    document.getElementById('kpi-grid').innerHTML =
      '<div class="empty-state">⚠ Este usuário não tem posto vinculado. Contate o administrador.</div>';
    return;
  }

  await carregarDados();
});

function toggleMenu(event) {
  event.stopPropagation();
  document.getElementById('dropdown-menu').classList.toggle('hidden');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('dropdown-menu');
  if (menu && !menu.classList.contains('hidden') && !e.target.closest('#btn-menu')) {
    menu.classList.add('hidden');
  }
});

function montarTopbar() {
  document.getElementById('app-gerente').textContent = usuarioAtual.nome || '—';
  document.getElementById('app-posto').textContent = usuarioAtual.posto?.nome || '—';
  const iniciais = (usuarioAtual.nome || '??').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
  document.getElementById('app-avatar').textContent = iniciais;

  const hoje = new Date();
  document.getElementById('page-date').textContent = hoje.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
}

function setTab(tab) {
  abaAtual = tab;
  document.querySelectorAll('.copasa-tab').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  ['resumo', '2dias', 'semanal', 'mensal', 'trimestral'].forEach(t => {
    document.getElementById('tab-' + t).style.display = (t === tab) ? 'block' : 'none';
  });
  if (tab !== 'resumo') renderTabela(tab);
}

async function carregarDados() {
  try {
    const resp = await apiFetch(`/copasa/${encodeURIComponent(usuarioAtual.posto.nome)}`);
    registros = resp.registros || [];
    renderResumo();
    if (abaAtual !== 'resumo') renderTabela(abaAtual);
  } catch (err) {
    document.getElementById('kpi-grid').innerHTML =
      `<div class="empty-state">⚠ Erro ao carregar dados: ${err.message}</div>`;
  }
}

// ── Helpers de data/consumo ───────────────────────────────────────
function hojeISO() { return new Date().toISOString().split('T')[0]; }
function isoMenosDias(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function fmtBR(iso) { return iso.split('-').reverse().join('/'); }
function porData(iso) { return registros.find(r => r.data === iso) || null; }
function somaConsumo(inicioISO, fimISO) {
  return registros
    .filter(r => r.data >= inicioISO && r.data <= fimISO)
    .reduce((acc, r) => acc + (Number(r.consumo) || 0), 0);
}
function variacaoPct(atual, anterior) {
  if (!anterior || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}
function badgeHtml(pct, { neutro = false } = {}) {
  if (pct === null || pct === undefined || isNaN(pct)) return '<span class="kpi-badge neutro">sem comparação</span>';
  const sobe = pct > 0;
  const classe = neutro ? 'neutro' : (sobe ? 'ruim' : 'bom');
  const seta = sobe ? '↑' : (pct < 0 ? '↓' : '→');
  return `<span class="kpi-badge ${classe}">${seta} ${Math.abs(pct).toFixed(1)}%</span>`;
}

// ── Resumo (KPIs + gráfico) ────────────────────────────────────────
function renderResumo() {
  const grid = document.getElementById('kpi-grid');
  if (!registros.length) {
    grid.innerHTML = '<div class="empty-state">Nenhuma leitura registrada ainda. Toque em "+ REGISTRAR" pra começar.</div>';
    document.getElementById('bar-chart').innerHTML = '';
    return;
  }

  const hoje = hojeISO();
  const ontem = isoMenosDias(hoje, 1);
  const anteontem = isoMenosDias(hoje, 2);

  const regHoje = porData(hoje);
  const regOntem = porData(ontem);
  const consumoHoje = regHoje ? Number(regHoje.consumo) : null;
  const consumoOntem = regOntem ? Number(regOntem.consumo) : null;
  const consumoAnteontem = porData(anteontem)?.consumo ?? null;

  const semanaAtual   = somaConsumo(isoMenosDias(hoje, 6), hoje);
  const semanaAnterior = somaConsumo(isoMenosDias(hoje, 13), isoMenosDias(hoje, 7));

  const inicioMes = hoje.slice(0, 8) + '01';
  const mesAtual = somaConsumo(inicioMes, hoje);
  const dataMesPassado = new Date(hoje + 'T00:00:00');
  dataMesPassado.setMonth(dataMesPassado.getMonth() - 1);
  const anoMesPassado = dataMesPassado.getFullYear();
  const mesMesPassado = String(dataMesPassado.getMonth() + 1).padStart(2, '0');
  const inicioMesPassado = `${anoMesPassado}-${mesMesPassado}-01`;
  const fimMesPassado = new Date(anoMesPassado, dataMesPassado.getMonth() + 1, 0).toISOString().split('T')[0];
  const mesAnterior = somaConsumo(inicioMesPassado, fimMesPassado);

  const ultima = registros[0]; // mais recente (API retorna desc)
  const penultima = registros[1] || null;
  const deltaLeitura = penultima ? Number(ultima.leitura) - Number(penultima.leitura) : null;

  grid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Consumo Hoje</div>
      <div class="kpi-value">${consumoHoje !== null ? consumoHoje.toFixed(3) + ' m³' : '—'}</div>
      ${consumoHoje !== null ? badgeHtml(variacaoPct(consumoHoje, consumoOntem)) : '<div class="kpi-sub">Nenhuma leitura hoje ainda</div>'}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Esta Semana</div>
      <div class="kpi-value">${semanaAtual.toFixed(3)} m³</div>
      ${badgeHtml(variacaoPct(semanaAtual, semanaAnterior))}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Este Mês</div>
      <div class="kpi-value">${mesAtual.toFixed(3)} m³</div>
      ${badgeHtml(variacaoPct(mesAtual, mesAnterior))}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Leitura Atual</div>
      <div class="kpi-value">${Number(ultima.leitura).toFixed(3)} m³</div>
      <div class="kpi-sub">em ${fmtBR(ultima.data)}${deltaLeitura !== null ? ` · +${deltaLeitura.toFixed(3)} m³ desde a leitura anterior` : ''}</div>
    </div>
  `;

  renderGrafico();
}

function renderGrafico() {
  const chart = document.getElementById('bar-chart');
  const hoje = hojeISO();
  const dias = Array.from({ length: 14 }, (_, i) => isoMenosDias(hoje, 13 - i));
  const valores = dias.map(iso => Number(porData(iso)?.consumo) || 0);
  const max = Math.max(...valores, 0.001);

  chart.innerHTML = dias.map((iso, i) => {
    const altura = Math.max(4, Math.round((valores[i] / max) * 100));
    const isHoje = iso === hoje;
    return `<div class="bar ${isHoje ? 'hoje' : ''}" style="height:${altura}%"
      onclick="mostrarValorBarra('${iso}', ${valores[i]})" title="${fmtBR(iso)}: ${valores[i].toFixed(3)} m³"></div>`;
  }).join('');
}

function mostrarValorBarra(iso, valor) {
  document.getElementById('bar-chart-legenda').textContent = `${fmtBR(iso)}: ${valor.toFixed(3)} m³`;
}

// ── Tabelas por período ─────────────────────────────────────────
const DIAS_POR_ABA = { '2dias': 2, semanal: 7, mensal: 30, trimestral: 90 };

function renderTabela(aba) {
  const container = document.getElementById('tabela-' + aba);
  const dias = DIAS_POR_ABA[aba];
  const limite = isoMenosDias(hojeISO(), dias - 1);
  const lista = registros.filter(r => r.data >= limite).slice().sort((a, b) => a.data.localeCompare(b.data));

  if (!lista.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma leitura neste período.</div>';
    return;
  }

  const linhas = lista.map((r, i) => {
    const anterior = lista[i - 1];
    const pct = anterior ? variacaoPct(Number(r.consumo), Number(anterior.consumo)) : null;
    return `
      <tr>
        <td>${fmtBR(r.data)}</td>
        <td>${Number(r.leitura).toFixed(3)} m³</td>
        <td>${Number(r.consumo).toFixed(3)} m³</td>
        <td>${pct !== null ? badgeHtml(pct) : '—'}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="copasa-tabela">
      <thead><tr><th>Data</th><th>Leitura</th><th>Consumo</th><th>Variação</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  `;
}

// ── Modal de registro ─────────────────────────────────────────────
function abrirModalRegistro() {
  const ontem = isoMenosDias(hojeISO(), 1);
  document.getElementById('input-data-leitura').value = ontem;
  document.getElementById('input-leitura').value = '';
  document.getElementById('modal-msg').className = 'modal-msg';
  document.getElementById('modal-msg').textContent = '';

  const ultima = registros[0];
  document.getElementById('modal-ultima-leitura').textContent = ultima
    ? `Última leitura: ${Number(ultima.leitura).toFixed(3)} m³ em ${fmtBR(ultima.data)}`
    : 'Nenhuma leitura anterior registrada — esta será a primeira.';

  document.getElementById('modal-registro').classList.add('active');
}

function fecharModalRegistro() {
  document.getElementById('modal-registro').classList.remove('active');
}

async function salvarLeitura() {
  const data = document.getElementById('input-data-leitura').value;
  const leitura = parseFloat(document.getElementById('input-leitura').value);
  const msg = document.getElementById('modal-msg');
  const btn = document.getElementById('btn-confirmar-leitura');

  if (!data || isNaN(leitura) || leitura < 0) {
    msg.textContent = 'Preencha a data e a leitura corretamente.';
    msg.className = 'modal-msg err';
    return;
  }
  const ultima = registros[0];
  if (ultima && leitura < Number(ultima.leitura)) {
    msg.textContent = `A leitura não pode ser menor que a última registrada (${Number(ultima.leitura).toFixed(3)} m³ em ${fmtBR(ultima.data)}). O hidrômetro só soma.`;
    msg.className = 'modal-msg err';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await apiFetch('/copasa', { method: 'POST', body: JSON.stringify({ data, leitura }) });
    fecharModalRegistro();
    mostrarToast('✅ Leitura registrada!', `${leitura.toFixed(3)} m³ em ${fmtBR(data)}`);
    await carregarDados();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'modal-msg err';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar leitura';
  }
}

function mostrarToast(titulo, msg) {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-title').textContent = titulo;
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}
