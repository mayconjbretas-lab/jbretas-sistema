// ================================================================
// JBRETAS SISTEMA — modulos/caixas/app.js
// Fila de conferência de caixa por posto + data.
//   Fonte de verdade dos números: /caixa/espelho e /caixa/pendencias.
//   NUNCA inventa valor: coluna sem fonte mostra "aguardando", nunca 0,00.
//   Única gravação = STATUS de conferência (conferir/desconferir). Nenhum
//   botão apaga dado de venda.
// Depende de: config.js, api.js, auth.js (carregados antes).
// ================================================================

// ── Proteção de rota ────────────────────────────────────────────
const USUARIO = exigirSessao(['CAIXAS', 'ADM']);

// ── Constantes editáveis (mapa fixo no topo do arquivo) ─────────
// Prazo de repasse por operadora|modalidade. Sem match → "—".
const PRAZOS = {
  'GETNET|pix':     'D+1',
  'GETNET|cartao':  'D+30',
  'GETNET|voucher': 'D+30',
  'ALELO':          'D+45',
  'ECX':            'D+45',
  'VALE CARD':      'D+45',
};
// Operadoras conhecidas que AINDA não têm coleta — aparecem como linhas âmbar
// "sem coleta" para deixar visível o que o módulo ainda não cobre. Não inventa
// valor nenhum; o prazo vem do mapa acima.
const OPERADORAS_SEM_COLETA = [
  { nome: 'ALELO',     prazo: 'D+45' },
  { nome: 'ECX CARD',  prazo: 'D+45' },
  { nome: 'VALE CARD', prazo: 'D+45' },
];
const AGUARDANDO = 'aguardando';

// ── Estado ──────────────────────────────────────────────────────
let PENDENCIAS = null;        // resposta de /caixa/pendencias (carteira + chips)
let ESPELHO = null;           // resposta de /caixa/espelho (posto+data selecionados)
let POSTO_ATUAL = '';         // posto_id selecionado
let TURNO_ATIVO = null;       // turno selecionado (0..3) — sempre um turno real
const EXPANDIDOS = new Set(); // chaves operadora|tipo expandidas na Zona B

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
function prazoDe(operadora, tipo) {
  const op = String(operadora || '').toUpperCase().trim();
  const tp = String(tipo || '').toLowerCase().trim();
  return PRAZOS[op + '|' + tp] || PRAZOS[op] || '—';
}
// Data de "ontem" (D-1) no fuso de Brasília, independente do fuso do aparelho.
function ontemBrasiliaISO() {
  const hojeBR = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD já em Brasília
  const [y, m, d] = hojeBR.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
function formatDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

// ── Data helpers ────────────────────────────────────────────────
function dataSelecionada() { return document.getElementById('cx-data').value; }
function atualizarSeloD1() {
  const selo = document.getElementById('cx-selo-d1');
  if (!selo) return;
  selo.hidden = (dataSelecionada() !== ontemBrasiliaISO());
}

// ── 1) PENDÊNCIAS: carteira + seletor de posto + chips + contador ─
async function carregarPendencias() {
  const data = dataSelecionada();
  if (!data) return;
  try {
    PENDENCIAS = await apiFetch(`/caixa/pendencias?data=${encodeURIComponent(data)}`);
  } catch (err) {
    PENDENCIAS = null;
    document.getElementById('cx-fila').innerHTML =
      `<div class="cx-vazio cx-erro">${esc(err.message || 'Falha ao carregar pendências.')}</div>`;
    return;
  }
  // cabeçalho da carteira
  const lbl = document.getElementById('cx-carteira');
  lbl.textContent = PENDENCIAS.carteira
    ? 'CARTEIRA ' + PENDENCIAS.carteira.nome
    : 'TODOS OS POSTOS';

  // contador — "postos hoje" = os que tiveram coleta na data
  document.getElementById('cx-resumo').textContent =
    `Meus postos hoje: ${PENDENCIAS.postos_com_coleta} · ` +
    `conferidos ${PENDENCIAS.postos_totalmente_conferidos} · ` +
    `pendentes ${PENDENCIAS.postos_pendentes}`;

  // seletor de posto (fonte única = pendencias.postos)
  const sel = document.getElementById('cx-posto');
  const postos = PENDENCIAS.postos || [];
  if (!postos.length) {
    sel.innerHTML = '<option value="">Nenhum posto na carteira</option>';
    document.getElementById('cx-fila').innerHTML = '';
    POSTO_ATUAL = '';
    return;
  }
  sel.innerHTML = postos
    .map(p => `<option value="${esc(p.posto.id)}">${esc(p.posto.codigo ? p.posto.codigo + ' · ' : '')}${esc(p.posto.nome)}</option>`)
    .join('');

  // mantém o posto atual se ainda existir; senão default = 1º com coleta, senão 1º
  if (!POSTO_ATUAL || !postos.some(p => p.posto.id === POSTO_ATUAL)) {
    const comColeta = postos.find(p => p.tem_coleta);
    POSTO_ATUAL = (comColeta || postos[0]).posto.id;
  }
  sel.value = POSTO_ATUAL;
  renderFila();
}

// ── 2) FILA DE TRABALHO (chips) ─────────────────────────────────
function estadoPosto(p) {
  if (!p.tem_coleta) return 'sem-coleta';
  if (p.total_turnos > 0 && p.total_conferidos === p.total_turnos) return 'conferido';
  return 'pendente';
}
function renderFila() {
  if (!PENDENCIAS) return;
  const html = (PENDENCIAS.postos || []).map(p => {
    const est = estadoPosto(p);
    const sel = p.posto.id === POSTO_ATUAL ? ' cx-chip-sel' : '';
    const check = est === 'conferido' ? ' <span class="cx-chip-check">✓</span>' : '';
    // rótulo curto = nome sem "P. "; código vai pro title/tooltip
    const rotulo = String(p.posto.nome || '').replace(/^P\.\s*/, '') || p.posto.codigo || '';
    const tipTxt = (p.posto.codigo || '') + (est === 'sem-coleta' ? ' · sem coleta nesta data' : '');
    const tip = tipTxt.trim() ? ` title="${esc(tipTxt.trim())}"` : '';
    const cont = p.tem_coleta ? ` <span class="cx-chip-cont">${p.total_conferidos}/${p.total_turnos}</span>` : '';
    return `<button class="cx-chip cx-chip-${est}${sel}"${tip} onclick="selecionarPosto('${esc(p.posto.id)}')">` +
      `${esc(rotulo)}${cont}${check}</button>`;
  }).join('');
  document.getElementById('cx-fila').innerHTML = html;
}
function selecionarPosto(id) {
  POSTO_ATUAL = id;
  document.getElementById('cx-posto').value = id;
  renderFila();          // atualiza o destaque sem recarregar a página
  carregarEspelho();
}

// ── Espelho (GET /caixa/espelho) ────────────────────────────────
async function carregarEspelho() {
  const posto = POSTO_ATUAL;
  const data = dataSelecionada();
  const alvo = document.getElementById('cx-conteudo');
  document.getElementById('cx-parcial').hidden = true;
  if (!posto || !data) {
    document.getElementById('cx-tabs').innerHTML = '';
    alvo.innerHTML = '<div class="cx-vazio">Selecione um posto e uma data.</div>';
    return;
  }
  alvo.innerHTML = '<div class="cx-vazio">Carregando…</div>';
  try {
    ESPELHO = await apiFetch(`/caixa/espelho?posto_id=${encodeURIComponent(posto)}&data=${encodeURIComponent(data)}`);
  } catch (err) {
    ESPELHO = null;
    document.getElementById('cx-tabs').innerHTML = '';
    alvo.innerHTML = `<div class="cx-vazio cx-erro">${esc(err.message || 'Falha ao carregar o espelho.')}</div>`;
    return;
  }
  EXPANDIDOS.clear();

  if (!ESPELHO.turnos || !ESPELHO.turnos.length) {
    document.getElementById('cx-tabs').innerHTML = '';
    alvo.innerHTML = '<div class="cx-vazio">Sem coleta para esta data.</div>';
    return;
  }
  // mantém o turno se ainda existir; senão vai pro primeiro
  if (TURNO_ATIVO === null || !ESPELHO.turnos.some(t => Number(t) === Number(TURNO_ATIVO))) {
    TURNO_ATIVO = ESPELHO.turnos[0];
  }
  // 3) aviso de dia parcial
  const banner = document.getElementById('cx-parcial');
  if (ESPELHO.parcial) {
    banner.textContent = '⚠️ ' + (ESPELHO.parcial_motivo || 'dia parcial');
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  renderTabs();
  renderConteudo();
}

// ── 4) ABAS DE TURNO (dinâmicas; check discreto no turno conferido) ─
function confDoTurno(t) {
  if (!ESPELHO || !ESPELHO.conferencia) return null;
  return ESPELHO.conferencia.find(c => Number(c.turno) === Number(t)) || null;
}
function renderTabs() {
  document.getElementById('cx-tabs').innerHTML = ESPELHO.turnos.map(t => {
    const on = Number(t) === Number(TURNO_ATIVO) ? ' active' : '';
    const c = confDoTurno(t);
    const check = c && c.conferido ? ' <span class="cx-tab-check">✓</span>' : '';
    return `<button class="cx-tab${on}" onclick="selecionarTurno('${t}')">${esc(turnoLabel(t))}${check}</button>`;
  }).join('');
}
function selecionarTurno(t) {
  TURNO_ATIVO = Number(t);
  EXPANDIDOS.clear();
  renderTabs();
  renderConteudo();
}
function linhasDoTurno() {
  if (!ESPELHO || !ESPELHO.linhas) return [];
  return ESPELHO.linhas.filter(l => Number(l.turno) === Number(TURNO_ATIVO));
}

// ── Conteúdo: Zona A + Zona B + Ações ───────────────────────────
function renderConteudo() {
  document.getElementById('cx-conteudo').innerHTML =
    renderZonaA() + renderZonaB() + renderAcoes();
}

// ── 5) ZONA A — "O TURNO FECHA?" ────────────────────────────────
// Estrutura pronta pra receber valor; hoje tudo "aguardando" (TecnoX/Lançado
// ainda não integrados). Não inventamos a soma sem todas as formas de pagamento.
function renderZonaA() {
  const linha = (rotulo, fonte, valor, cls) =>
    `<div class="cx-za-row">
       <div class="cx-za-main">
         <div class="cx-za-val ${cls || ''}">${esc(valor)}</div>
         <div class="cx-za-lbl">${esc(rotulo)}</div>
       </div>
       <div class="cx-za-fonte">${esc(fonte)}</div>
     </div>`;
  return `<section class="cx-zona">
      <h3 class="cx-zona-tit">O turno fecha?</h3>
      <div class="cx-za">
        ${linha('Volume vendido · relatório de bico', 'fonte: TecnoX — não alterável', AGUARDANDO, 'cx-muted')}
        ${linha('Soma das formas de pagamento (dinheiro + cartões + nota a prazo)', 'aguardando integração', AGUARDANDO, 'cx-muted')}
        ${linha('Diferença', 'volume − formas de pagamento', '—', 'cx-muted')}
      </div>
    </section>`;
}

// ── 6) ZONA B — "ONDE O ERRO SE ESCONDE" ────────────────────────
function renderZonaB() {
  const linhas = linhasDoTurno();
  // grupos reais por operadora|tipo (dado de caixa_operadora)
  const grupos = {};
  for (const l of linhas) {
    const chave = l.operadora + '|' + l.tipo;
    const g = grupos[chave] || (grupos[chave] = { operadora: l.operadora, tipo: l.tipo, qtd: 0, valor: 0, itens: [] });
    g.qtd += Number(l.qtd || 0);
    g.valor += Number(l.valor || 0);
    g.itens.push(l);
  }
  const chaves = Object.keys(grupos).sort();
  const opsPresentes = new Set(Object.values(grupos).map(g => String(g.operadora).toUpperCase().trim()));

  let html = `<section class="cx-zona">
      <h3 class="cx-zona-tit">Onde o erro se esconde</h3>
      <div class="cx-tab-wrap"><table class="cx-tabela">
        <thead><tr>
          <th>Operadora</th><th class="num">Lançado</th><th class="num">Operadora informou</th>
          <th class="num">Banco recebeu</th><th class="cen">Prazo</th>
        </tr></thead><tbody>`;

  // linhas reais (com expansão por bandeira+modalidade)
  for (const chave of chaves) {
    const g = grupos[chave];
    const aberto = EXPANDIDOS.has(chave);
    html += `<tr class="cx-grupo" onclick="toggleGrupo('${esc(chave)}')">
        <td><span class="cx-caret">${aberto ? '▾' : '▸'}</span>
            <span class="cx-op">${esc(g.operadora)}</span> · ${esc(g.tipo)}</td>
        <td class="num cx-muted">${AGUARDANDO}</td>
        <td class="num cx-val">${moedaBR(g.valor)}</td>
        <td class="num cx-muted">${AGUARDANDO}</td>
        <td class="cen cx-prazo">${esc(prazoDe(g.operadora, g.tipo))}</td>
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
            <td class="num cx-muted">${AGUARDANDO}</td>
            <td class="num cx-val">${moedaBR(d.valor)}</td>
            <td class="num cx-muted">${AGUARDANDO}</td>
            <td class="cen">—</td>
          </tr>`;
      }
    }
  }

  // operadoras conhecidas SEM coleta (âmbar) — só as que não aparecem no dado
  for (const o of OPERADORAS_SEM_COLETA) {
    if (opsPresentes.has(o.nome.toUpperCase().trim())) continue;
    html += `<tr class="cx-semcoleta">
        <td><span class="cx-op">${esc(o.nome)}</span></td>
        <td class="num">sem coleta</td>
        <td class="num">sem coleta</td>
        <td class="num">sem coleta</td>
        <td class="cen cx-prazo">${esc(o.prazo || '—')}</td>
      </tr>`;
  }

  // linhas FIXAS (sempre presentes): pra onde a diferença costuma ser empurrada
  for (const nome of ['Dinheiro / sangria', 'Nota a prazo']) {
    html += `<tr class="cx-fixa">
        <td><span class="cx-op">${esc(nome)}</span></td>
        <td class="num cx-muted">${AGUARDANDO}</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="cen">—</td>
      </tr>`;
  }

  html += `</tbody></table></div></section>`;
  return html;
}
function toggleGrupo(chave) {
  if (EXPANDIDOS.has(chave)) EXPANDIDOS.delete(chave); else EXPANDIDOS.add(chave);
  renderConteudo();
}

// ── 7) AÇÕES (rodapé) ───────────────────────────────────────────
function renderAcoes() {
  const c = confDoTurno(TURNO_ATIVO);
  const conferido = !!(c && c.conferido);
  let principal;
  if (conferido) {
    const quem = c.conferido_por_nome || 'alguém';
    const quando = formatDataHora(c.conferido_em);
    principal = `<div class="cx-acao-info">Conferido por <strong>${esc(quem)}</strong>${quando ? ' em ' + esc(quando) : ''}</div>
      <button class="cx-btn cx-btn-desmarcar" onclick="desmarcarTurno()">Desmarcar</button>`;
  } else {
    principal = `<button class="cx-btn cx-btn-marcar" onclick="marcarTurno()">Marcar turno conferido</button>`;
  }
  return `<div class="cx-acoes">
      ${principal}
      <button class="cx-btn cx-btn-prox" onclick="proximoPostoPendente()">Próximo posto pendente →</button>
    </div>`;
}

async function marcarTurno() {
  if (!POSTO_ATUAL || TURNO_ATIVO === null) return;
  try {
    await apiFetch('/caixa/conferir', {
      method: 'POST',
      body: JSON.stringify({ posto_id: POSTO_ATUAL, data: dataSelecionada(), turno: Number(TURNO_ATIVO) }),
    });
    await recarregarStatus();
  } catch (err) {
    alert('Não foi possível conferir: ' + (err.message || 'erro'));
  }
}
async function desmarcarTurno() {
  if (!POSTO_ATUAL || TURNO_ATIVO === null) return;
  try {
    await apiFetch('/caixa/desconferir', {
      method: 'POST',
      body: JSON.stringify({ posto_id: POSTO_ATUAL, data: dataSelecionada(), turno: Number(TURNO_ATIVO) }),
    });
    await recarregarStatus();
  } catch (err) {
    alert('Não foi possível desmarcar: ' + (err.message || 'erro'));
  }
}
// Atualiza chips + contador + abas + ações SEM recarregar a página.
async function recarregarStatus() {
  await carregarPendencias(); // chips + contador (mantém POSTO_ATUAL)
  await carregarEspelho();    // abas + conferência (mantém TURNO_ATIVO)
}

// Salta pro próximo posto com coleta ainda pendente (circular).
function proximoPostoPendente() {
  if (!PENDENCIAS) return;
  const pend = (PENDENCIAS.postos || []).filter(p => estadoPosto(p) === 'pendente');
  if (!pend.length) { alert('Nenhum posto pendente nesta data. 🎉'); return; }
  const idxAtual = pend.findIndex(p => p.posto.id === POSTO_ATUAL);
  const prox = pend[(idxAtual + 1) % pend.length];
  TURNO_ATIVO = null; // deixa o espelho escolher o 1º turno do novo posto
  selecionarPosto(prox.posto.id);
}

// ── Eventos dos filtros ─────────────────────────────────────────
function onDataChange() {
  atualizarSeloD1();
  TURNO_ATIVO = null;
  carregarPendencias().then(() => carregarEspelho());
}
function onPostoChange() {
  POSTO_ATUAL = document.getElementById('cx-posto').value;
  TURNO_ATIVO = null;
  renderFila();
  carregarEspelho();
}

// ── Boot ────────────────────────────────────────────────────────
(function init() {
  if (!USUARIO) return; // exigirSessao já redirecionou
  preencherTopbar();
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = (document.documentElement.getAttribute('data-theme') === 'light') ? '☀️' : '🌙';
  document.getElementById('cx-data').value = ontemBrasiliaISO(); // default D-1 (Brasília)
  atualizarSeloD1();
  carregarPendencias().then(() => carregarEspelho());
})();

// expõe handlers usados em onclick inline
window.toggleTheme = toggleTheme;
window.onDataChange = onDataChange;
window.onPostoChange = onPostoChange;
window.selecionarPosto = selecionarPosto;
window.selecionarTurno = selecionarTurno;
window.toggleGrupo = toggleGrupo;
window.marcarTurno = marcarTurno;
window.desmarcarTurno = desmarcarTurno;
window.proximoPostoPendente = proximoPostoPendente;
