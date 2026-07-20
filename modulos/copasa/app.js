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

// Navegação entre módulos agora é pelo rodapé (shared/js/gerente-nav.js) —
// o antigo menu de 3 pontinhos (toggleMenu + fechar-ao-clicar-fora) foi removido.

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
function fmtBRcurto(iso) { const p = iso.split('-'); return p[2] + '/' + p[1]; } // dd/mm

// Formata m³ em pt-BR com 2 casas e vírgula; null/undefined/'' → "—".
function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtM3(v) { const s = fmtNum(v); return s === '—' ? '—' : s + ' m³'; }

// Máscara ancorada à direita (estilo moeda): só dígitos, os 2 ÚLTIMOS são os
// decimais (os vermelhos do hidrômetro). "110188" → "1.101,88". Backspace natural.
function mascararLeitura(el) {
  const d = el.value.replace(/\D/g, '');
  if (!d) { el.value = ''; return; }
  el.value = (parseInt(d, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Texto mascarado → número decimal ("1.101,88" → 1101.88). NaN se vazio.
function parseLeituraMascara(str) {
  const d = String(str).replace(/\D/g, '');
  return d ? parseInt(d, 10) / 100 : NaN;
}
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
// Cálculo de consumo com giro do mostrador (rollover). Espelha
// jbretas-api/copasa-calc.js — mantenha os dois em sincronia.
// Retorna { consumo, status }: 'primeira' | 'normal' | 'giro' | 'suspeita'.
function calcularConsumoCopasa(atual, anterior) {
  if (anterior === null || anterior === undefined) return { consumo: null, status: 'primeira' };
  if (atual >= anterior) return { consumo: Math.round((atual - anterior) * 100) / 100, status: 'normal' };
  let M = 10000;
  while (M <= anterior) M *= 10; // menor potência de 10 > anterior, mínimo 10.000
  if (anterior >= 0.9 * M) return { consumo: Math.round(((M - anterior) + atual) * 100) / 100, status: 'giro' };
  return { consumo: null, status: 'suspeita' };
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
  // Último consumo diário registrado (a leitura costuma ser de ontem) — é o
  // número que o gerente/ADM quer ver de cara, com a data explícita.
  const ultimoConsumo = (ultima.consumo === null || ultima.consumo === undefined) ? null : Number(ultima.consumo);
  const consumoAntes = (penultima && penultima.consumo != null) ? Number(penultima.consumo) : null;
  const deltaLeitura = penultima ? Number(ultima.leitura) - Number(penultima.leitura) : null;

  grid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Último Consumo Diário</div>
      <div class="kpi-value">${fmtM3(ultimoConsumo)}</div>
      <div class="kpi-sub">em ${fmtBR(ultima.data)}</div>
      ${ultimoConsumo !== null ? badgeHtml(variacaoPct(ultimoConsumo, consumoAntes)) : ''}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Esta Semana</div>
      <div class="kpi-value">${fmtM3(semanaAtual)}</div>
      ${badgeHtml(variacaoPct(semanaAtual, semanaAnterior))}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Este Mês</div>
      <div class="kpi-value">${fmtM3(mesAtual)}</div>
      ${badgeHtml(variacaoPct(mesAtual, mesAnterior))}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Leitura Atual</div>
      <div class="kpi-value">${fmtM3(ultima.leitura)}</div>
      <div class="kpi-sub">em ${fmtBR(ultima.data)}${deltaLeitura !== null ? ` · +${fmtNum(deltaLeitura)} m³ desde a leitura anterior` : ''}</div>
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
      onclick="mostrarValorBarra('${iso}', ${valores[i]})" title="${fmtBR(iso)}: ${fmtNum(valores[i])} m³"></div>`;
  }).join('');
}

function mostrarValorBarra(iso, valor) {
  document.getElementById('bar-chart-legenda').textContent = `${fmtBR(iso)}: ${fmtNum(valor)} m³`;
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
    const consumoNum = (r.consumo === null || r.consumo === undefined) ? null : Number(r.consumo);
    const antesNum = (anterior && anterior.consumo != null) ? Number(anterior.consumo) : null;
    const pct = (consumoNum !== null && antesNum !== null) ? variacaoPct(consumoNum, antesNum) : null;
    return `
      <tr>
        <td>${fmtBRcurto(r.data)}</td>
        <td>${fmtNum(r.leitura)}</td>
        <td>${fmtNum(consumoNum)}</td>
        <td>${pct !== null ? badgeHtml(pct) : '—'}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="copasa-tabela-wrap">
      <table class="copasa-tabela">
        <thead><tr><th>Data</th><th>Leitura (m³)</th><th>Consumo (m³)</th><th>Variação</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
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
    ? `Última leitura: ${fmtM3(ultima.leitura)} em ${fmtBR(ultima.data)}`
    : 'Nenhuma leitura anterior registrada — esta será a primeira.';

  document.getElementById('modal-registro').classList.add('active');
}

function fecharModalRegistro() {
  document.getElementById('modal-registro').classList.remove('active');
}

async function salvarLeitura() {
  const data = document.getElementById('input-data-leitura').value;
  const leitura = parseLeituraMascara(document.getElementById('input-leitura').value);
  const msg = document.getElementById('modal-msg');
  const btn = document.getElementById('btn-confirmar-leitura');

  if (!data || isNaN(leitura) || leitura < 0) {
    msg.textContent = 'Preencha a data e a leitura corretamente.';
    msg.className = 'modal-msg err';
    return;
  }
  const ultima = registros[0];
  const anteriorNum = ultima ? Number(ultima.leitura) : null;
  const { consumo: consumoPrev, status } = calcularConsumoCopasa(leitura, anteriorNum);
  // Leitura menor e longe do topo do mostrador → provável erro de digitação.
  if (status === 'suspeita') {
    msg.textContent = `Leitura menor que a anterior (${fmtM3(ultima.leitura)} em ${fmtBR(ultima.data)}) — confira. O hidrômetro só soma, salvo giro do mostrador.`;
    msg.className = 'modal-msg err';
    return;
  }
  // Giro do mostrador detectado (rollover): consumo real correto, segue salvando.
  if (status === 'giro') {
    msg.textContent = `Giro do mostrador detectado — consumo calculado: ${fmtM3(consumoPrev)}. Salvando…`;
    msg.className = 'modal-msg';
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await apiFetch('/copasa', { method: 'POST', body: JSON.stringify({ data, leitura }) });
    fecharModalRegistro();
    mostrarToast('✅ Leitura registrada!', `${fmtM3(leitura)} em ${fmtBR(data)}`);
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
