// ================================================================
// JBRETAS SISTEMA — modulos/caixas/app.js
// Tela única: espelho da Maquininha (caixa_operadora) por posto + data.
// Read-only neste bloco: NÃO há coluna Lançado editável nem botão conferir.
// Depende de: config.js, api.js, auth.js (carregados antes).
// ================================================================

// ── Proteção de rota ────────────────────────────────────────────
const USUARIO = exigirSessao(['CAIXAS', 'ADM']);

// ── Estado ──────────────────────────────────────────────────────
let ESPELHO = null;          // resposta de /caixa/espelho
let TURNO_ATIVO = 'todos';   // 'todos' ou um turno (0..3)
const EXPANDIDOS = new Set(); // chaves operadora|tipo expandidas

// ── Helpers ─────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
function moedaBR(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function numBR(v) { return Number(v || 0).toLocaleString('pt-BR'); }
function turnoLabel(t) { return Number(t) === 0 ? 'Sem turno' : 'Turno ' + t; }
function hojeISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// ── Topbar / tema (mesmo padrão dos outros módulos) ─────────────
function preencherTopbar() {
  if (!USUARIO) return;
  const nome = USUARIO.nome || USUARIO.email || '—';
  document.getElementById('app-usuario').textContent = nome;
  document.getElementById('app-perfil').textContent = USUARIO.perfil || '—';
  document.getElementById('app-avatar').textContent = nome.trim().slice(0, 2).toUpperCase();
}
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

// ── Postos (GET /caixa/postos) ──────────────────────────────────
async function carregarPostos() {
  const sel = document.getElementById('cx-posto');
  try {
    const resp = await apiFetch('/caixa/postos');
    const postos = resp.postos || [];
    if (!postos.length) {
      sel.innerHTML = '<option value="">Nenhum posto na sua carteira</option>';
      mostrarVazio('Você não tem postos na carteira. Fale com o TI.');
      return;
    }
    sel.innerHTML = postos
      .map(p => `<option value="${esc(p.id)}">${esc(p.codigo ? p.codigo + ' · ' : '')}${esc(p.nome)}</option>`)
      .join('');
    sel.value = postos[0].id;
    carregarEspelho();
  } catch (err) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
    mostrarVazio('Erro ao carregar postos: ' + err.message, true);
  }
}

function onFiltroChange() { carregarEspelho(); }

// ── Espelho (GET /caixa/espelho) ────────────────────────────────
async function carregarEspelho() {
  const postoId = document.getElementById('cx-posto').value;
  const data = document.getElementById('cx-data').value;
  if (!postoId || !data) {
    mostrarVazio('Selecione um posto e uma data.');
    return;
  }
  mostrarVazio('Carregando…');
  try {
    ESPELHO = await apiFetch(`/caixa/espelho?posto_id=${encodeURIComponent(postoId)}&data=${encodeURIComponent(data)}`);
  } catch (err) {
    ESPELHO = null;
    resetTopo();
    mostrarVazio(err.message || 'Falha ao carregar o espelho.', true);
    return;
  }
  TURNO_ATIVO = 'todos';
  EXPANDIDOS.clear();
  if (!ESPELHO.linhas || !ESPELHO.linhas.length) {
    resetTopo();
    document.getElementById('cx-tabs').innerHTML = '';
    mostrarVazio('Sem coleta para esta data.');
    return;
  }
  renderTabs();
  renderCards();
  renderTabela();
}

function mostrarVazio(msg, erro) {
  document.getElementById('cx-conteudo').innerHTML =
    `<div class="cx-vazio ${erro ? 'cx-erro' : ''}">${esc(msg)}</div>`;
}
function resetTopo() {
  document.getElementById('card-maq').textContent = '—';
  document.getElementById('card-maq-sub').textContent = 'operadora (Getnet)';
}

// ── Abas de turno (dinâmicas a partir de ESPELHO.turnos) ────────
function renderTabs() {
  const abas = ['todos', ...ESPELHO.turnos];
  document.getElementById('cx-tabs').innerHTML = abas.map(t => {
    const label = t === 'todos' ? 'Todos' : turnoLabel(t);
    const on = String(t) === String(TURNO_ATIVO) ? ' active' : '';
    return `<button class="cx-tab${on}" onclick="selecionarTurno('${t}')">${esc(label)}</button>`;
  }).join('');
}
function selecionarTurno(t) {
  TURNO_ATIVO = (t === 'todos') ? 'todos' : Number(t);
  EXPANDIDOS.clear();
  renderTabs();
  renderCards();
  renderTabela();
}

function linhasFiltradas() {
  if (!ESPELHO) return [];
  if (TURNO_ATIVO === 'todos') return ESPELHO.linhas;
  return ESPELHO.linhas.filter(l => Number(l.turno) === Number(TURNO_ATIVO));
}

// ── Cartões ─────────────────────────────────────────────────────
function renderCards() {
  const linhas = linhasFiltradas();
  const totalMaq = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  document.getElementById('card-maq').textContent = moedaBR(totalMaq);
  const ops = [...new Set(linhas.map(l => l.operadora))].join(', ');
  const escopo = TURNO_ATIVO === 'todos' ? 'todos os turnos' : turnoLabel(TURNO_ATIVO);
  document.getElementById('card-maq-sub').textContent = `${ops || '—'} · ${escopo}`;
  // Lançado e Divergência permanecem vazios (aguardando integração TecnoX).
  document.getElementById('card-lanc').textContent = '—';
  document.getElementById('card-div').textContent = '—';
}

// ── Tabela: 1 linha por operadora+tipo; expande por bandeira+modalidade ──
function renderTabela() {
  const linhas = linhasFiltradas();
  const grupos = {};
  for (const l of linhas) {
    const chave = l.operadora + '|' + l.tipo;
    const g = grupos[chave] || (grupos[chave] = { operadora: l.operadora, tipo: l.tipo, qtd: 0, valor: 0, itens: [] });
    g.qtd += Number(l.qtd || 0);
    g.valor += Number(l.valor || 0);
    g.itens.push(l);
  }
  const chaves = Object.keys(grupos).sort();
  let html = `<table class="cx-tabela"><thead><tr>
      <th>Operadora · Tipo</th><th class="num">Qtd</th><th class="num">Maquininha</th>
    </tr></thead><tbody>`;
  for (const chave of chaves) {
    const g = grupos[chave];
    const aberto = EXPANDIDOS.has(chave);
    html += `<tr class="cx-grupo" onclick="toggleGrupo('${esc(chave)}')">
        <td><span class="cx-caret">${aberto ? '▾' : '▸'}</span>
            <span class="cx-op">${esc(g.operadora)}</span> · ${esc(g.tipo)}</td>
        <td class="num">${numBR(g.qtd)}</td>
        <td class="num cx-val">${moedaBR(g.valor)}</td>
      </tr>`;
    if (aberto) {
      const det = g.itens.slice().sort((a, b) =>
        String(a.bandeira).localeCompare(String(b.bandeira)) ||
        String(a.modalidade).localeCompare(String(b.modalidade)));
      for (const d of det) {
        const band = d.bandeira || '(sem bandeira)';
        const mod = d.modalidade || '(sem modalidade)';
        html += `<tr class="cx-det">
            <td>${esc(band)} · ${esc(mod)}</td>
            <td class="num">${numBR(d.qtd)}</td>
            <td class="num cx-val">${moedaBR(d.valor)}</td>
          </tr>`;
      }
    }
  }
  html += `</tbody></table>`;
  document.getElementById('cx-conteudo').innerHTML = html;
}
function toggleGrupo(chave) {
  if (EXPANDIDOS.has(chave)) EXPANDIDOS.delete(chave); else EXPANDIDOS.add(chave);
  renderTabela();
}

// ── Boot ────────────────────────────────────────────────────────
(function init() {
  if (!USUARIO) return; // exigirSessao já redirecionou
  preencherTopbar();
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = (document.documentElement.getAttribute('data-theme') === 'light') ? '☀️' : '🌙';
  document.getElementById('cx-data').value = hojeISO();
  carregarPostos();
})();
