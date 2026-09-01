// ================================================================
// JBRETAS SISTEMA — modulos/conciliacao/app.js
// Portal da CONCILIACAO. Hoje so o Calibrador: a lista do que os
// supervisores recolheram, o detalhe de cada coleta (leituras + fotos)
// e o cadastro de equipamento.
//
// GUARD: CONCILIACAO e ADM, o mesmo par que ehConciliacao() aceita no
// backend. TI NAO entra por aqui: as rotas de lista e detalhe recusam
// quem nao e CONCILIACAO/ADM, entao um TI veria a tela montar e todas
// as chamadas falharem. O TI que precisar cadastrar equipamento entra
// pelo "Acessar como" do painel dele — a rota de cadastro aceita a
// flag ti, e a tela e a mesma.
//
// A coluna de STATUS vem calculada da API (statusCalibrador, derivado
// das fotos). O front NAO recalcula: duas definicoes de status seria o
// mesmo erro do mix.
// ================================================================

let usuarioAtual = null;
let coletasAtuais = [];
let postosCache = [];

// Passados 2 dias do lancamento sem foto, a linha grita. O prazo foi
// definido junto com a decisao de deixar salvar sem foto: sem um limite
// visivel, PENDENTE_FOTO vira estado permanente e ninguem cobra.
const DIAS_ALERTA_FOTO = 2;

// ── Tema ────────────────────────────────────────────────────────
// Cada modulo tem a sua copia destas duas (nao estao no shared). Mesmo
// corpo do painel-ti, de proposito: divergir aqui faria o sol/lua desta
// tela se comportar diferente do resto.
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

// ── Formatacao ──────────────────────────────────────────────────
function fmtDin(v) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtData(iso) {
  if (!iso) return '—';
  const p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function iniciaisDe(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '--';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function toast(msg) {
  const el = document.getElementById('toast-msg');
  const t = document.getElementById('toast');
  if (el) el.textContent = msg;
  if (t) { t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
}

// ── Bootstrap ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const u = exigirSessao();
  if (!u) return;
  if (u.perfil !== 'CONCILIACAO' && u.perfil !== 'ADM') { redirecionarPorPerfil(u); return; }
  usuarioAtual = u;

  aplicarTema(localStorage.getItem('jb_theme') || 'dark');
  montarTopbar();
  ligarControles();
  await carregarPostos();
  await carregarLista();
});

function montarTopbar() {
  const nome = (usuarioAtual && usuarioAtual.nome) ? usuarioAtual.nome : '—';
  const eln = document.getElementById('app-nome'); if (eln) eln.textContent = nome;
  const ela = document.getElementById('app-avatar'); if (ela) ela.textContent = iniciaisDe(nome);
}

function ligarControles() {
  ['f-posto', 'f-de', 'f-ate', 'f-destino', 'f-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', carregarLista);
  });
  document.getElementById('btn-limpar').addEventListener('click', () => {
    ['f-posto', 'f-de', 'f-ate', 'f-destino', 'f-status'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    carregarLista();
  });
  document.getElementById('btn-novo-eq').addEventListener('click', abrirModalEquip);
  document.getElementById('eq-cancelar').addEventListener('click', () => fecharModal('md-equip'));
  document.getElementById('eq-salvar').addEventListener('click', salvarEquipamento);
  document.getElementById('det-fechar').addEventListener('click', () => fecharModal('md-detalhe'));

  // Fecha no clique fora e no ESC — a tela e de conferencia, se navega
  // rapido entre linhas e ter de mirar o botao Fechar cansa.
  ['md-detalhe', 'md-equip'].forEach(id => {
    const ov = document.getElementById(id);
    if (ov) ov.addEventListener('click', e => { if (e.target === ov) fecharModal(id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { fecharModal('md-detalhe'); fecharModal('md-equip'); }
  });
}

function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

// ── Postos ──────────────────────────────────────────────────────
// /calibrador/postos devolve so os que TEM equipamento ativo — 28 dos
// 37. Filtrar por um posto sem equipamento nunca traria coleta, entao
// o seletor nao deve oferecer.
async function carregarPostos() {
  try {
    const r = await apiFetch('/calibrador/postos');
    postosCache = r.postos || [];
  } catch (e) {
    postosCache = [];
    toast('Não consegui carregar os postos: ' + e.message);
  }
  const opcoes = postosCache.map(p =>
    '<option value="' + escapeHtml(p.nome) + '">' + escapeHtml(p.nome) + '</option>').join('');
  const fp = document.getElementById('f-posto');
  if (fp) fp.innerHTML = '<option value="">Todos</option>' + opcoes;
  const ep = document.getElementById('eq-posto');
  // No cadastro a lista e a MESMA (postos que ja tem equipamento). Um
  // posto totalmente novo nao aparece aqui — ver o aviso no modal.
  if (ep) ep.innerHTML = opcoes;
}

// ── Lista ───────────────────────────────────────────────────────
function filtrosAtuais() {
  const v = id => (document.getElementById(id) || {}).value || '';
  const q = [];
  if (v('f-posto'))   q.push('posto=' + encodeURIComponent(v('f-posto')));
  if (v('f-de'))      q.push('de=' + v('f-de'));
  if (v('f-ate'))     q.push('ate=' + v('f-ate'));
  if (v('f-destino')) q.push('destino=' + v('f-destino'));
  if (v('f-status'))  q.push('status=' + v('f-status'));
  return q.length ? '?' + q.join('&') : '';
}

async function carregarLista() {
  const tb = document.getElementById('cc-tbody');
  tb.innerHTML = '<tr><td colspan="8" class="cc-msg">Carregando…</td></tr>';
  const de = (document.getElementById('f-de') || {}).value;
  const ate = (document.getElementById('f-ate') || {}).value;
  if (de && ate && de > ate) {
    tb.innerHTML = '<tr><td colspan="8" class="cc-msg">O "De" é depois do "Até".</td></tr>';
    document.getElementById('cc-resumo').innerHTML = '';
    return;
  }
  try {
    const r = await apiFetch('/calibrador/coletas' + filtrosAtuais());
    coletasAtuais = r.coletas || [];
    renderLista(r);
  } catch (e) {
    coletasAtuais = [];
    tb.innerHTML = '<tr><td colspan="8" class="cc-msg cc-erro">' + escapeHtml(e.message) + '</td></tr>';
    document.getElementById('cc-resumo').innerHTML = '';
  }
}

function renderLista(resp) {
  const tb = document.getElementById('cc-tbody');
  const aviso = document.getElementById('cc-aviso');

  // O teto da API cortou? A tela DIZ — lista que some com registro em
  // silencio faz a pessoa concluir que o mes esta conferido.
  if (resp.truncado) {
    aviso.style.display = '';
    aviso.className = 'cc-aviso cc-aviso-atencao';
    aviso.textContent = 'Mostrando as ' + resp.teto + ' coletas mais recentes — há mais no período. Estreite o filtro.';
  } else {
    aviso.style.display = 'none';
  }

  if (!coletasAtuais.length) {
    tb.innerHTML = '<tr><td colspan="8" class="cc-msg">Nenhuma coleta com esses filtros.</td></tr>';
    document.getElementById('cc-resumo').innerHTML = '';
    return;
  }

  tb.innerHTML = coletasAtuais.map(c => {
    const pend = c.status === 'PENDENTE_FOTO';
    const atrasada = pend && c.dias_sem_foto >= DIAS_ALERTA_FOTO;
    const dif = Number(c.diferenca);
    const clsDif = dif < 0 ? 'cc-neg' : (dif > 0 ? 'cc-pos' : 'cc-zero');
    const selo = pend
      ? '<span class="cc-selo cc-selo-pend">PENDENTE FOTO</span>' +
        (atrasada ? '<span class="cc-selo cc-selo-atraso" title="Lançada há ' + c.dias_sem_foto +
                    ' dias e ainda sem as duas fotos">' + c.dias_sem_foto + 'd</span>' : '')
      : '<span class="cc-selo cc-selo-ok">OK</span>';
    return '<tr class="cc-linha' + (atrasada ? ' cc-linha-atraso' : (pend ? ' cc-linha-pend' : '')) +
      '" data-id="' + c.id + '" tabindex="0">' +
      '<td class="cc-mono">' + fmtData(c.data) + '</td>' +
      '<td>' + escapeHtml(c.posto || '—') + '</td>' +
      '<td class="cc-mono cc-dest">' + escapeHtml((c.destinos || []).join(' / ') || '—') + '</td>' +
      '<td class="num cc-mono">' + fmtDin(c.valor_esperado) + '</td>' +
      '<td class="num cc-mono">' + fmtDin(c.valor_recolhido) + '</td>' +
      '<td class="num cc-mono ' + clsDif + '">' + (dif > 0 ? '+' : '') + fmtDin(dif) + '</td>' +
      '<td>' + selo + '</td>' +
      '<td class="cc-quem">' + escapeHtml(c.usuario_nome || '—') + '</td>' +
      '</tr>';
  }).join('');

  tb.querySelectorAll('.cc-linha').forEach(tr => {
    const abrir = () => abrirDetalhe(tr.getAttribute('data-id'));
    tr.addEventListener('click', abrir);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  });

  renderResumo();
}

// Soma do que esta na tela — e sempre do FILTRO aplicado, nunca do mes
// inteiro, senao o numero contradiz a lista logo abaixo dele.
function renderResumo() {
  const n = coletasAtuais.length;
  const esp = coletasAtuais.reduce((a, c) => a + Number(c.valor_esperado || 0), 0);
  const rec = coletasAtuais.reduce((a, c) => a + Number(c.valor_recolhido || 0), 0);
  const dif = rec - esp;
  const pend = coletasAtuais.filter(c => c.status === 'PENDENTE_FOTO').length;
  const atras = coletasAtuais.filter(c => c.status === 'PENDENTE_FOTO' && c.dias_sem_foto >= DIAS_ALERTA_FOTO).length;
  const clsDif = dif < 0 ? 'cc-neg' : (dif > 0 ? 'cc-pos' : 'cc-zero');
  document.getElementById('cc-resumo').innerHTML =
    '<div class="cc-kpi"><span>Coletas</span><b>' + n + '</b></div>' +
    '<div class="cc-kpi"><span>Esperado</span><b class="cc-mono">' + fmtDin(esp) + '</b></div>' +
    '<div class="cc-kpi"><span>Recolhido</span><b class="cc-mono">' + fmtDin(rec) + '</b></div>' +
    '<div class="cc-kpi"><span>Diferença</span><b class="cc-mono ' + clsDif + '">' +
      (dif > 0 ? '+' : '') + fmtDin(dif) + '</b></div>' +
    '<div class="cc-kpi"><span>Sem foto</span><b class="' + (pend ? 'cc-neg' : '') + '">' + pend +
      (atras ? ' <small>(' + atras + ' há ' + DIAS_ALERTA_FOTO + '+ dias)</small>' : '') + '</b></div>';
}

// ── Detalhe ─────────────────────────────────────────────────────
async function abrirDetalhe(id) {
  const ov = document.getElementById('md-detalhe');
  document.getElementById('det-titulo').textContent = 'Coleta';
  document.getElementById('det-sub').textContent = 'Carregando…';
  document.getElementById('det-corpo').innerHTML = '';
  ov.classList.add('active');
  try {
    const r = await apiFetch('/calibrador/coleta/' + encodeURIComponent(id));
    renderDetalhe(r.coleta);
  } catch (e) {
    document.getElementById('det-sub').textContent = '';
    document.getElementById('det-corpo').innerHTML =
      '<div class="cc-msg cc-erro">' + escapeHtml(e.message) + '</div>';
  }
}

function renderDetalhe(c) {
  document.getElementById('det-titulo').textContent = (c.posto || '—') + ' · ' + fmtData(c.data);
  document.getElementById('det-sub').textContent =
    'Lançada por ' + (c.usuario_nome || '—') +
    (c.gerente_nome ? ' · conferida com ' + c.gerente_nome : '');

  const dif = Number(c.diferenca);
  const clsDif = dif < 0 ? 'cc-neg' : (dif > 0 ? 'cc-pos' : 'cc-zero');

  const linhas = (c.itens || []).map(i =>
    '<tr' + (i.equipamento_ativo ? '' : ' class="cc-eq-inativo"') + '>' +
      '<td>' + escapeHtml(i.nome) + (i.equipamento_ativo ? '' :
        ' <span class="cc-selo cc-selo-inativo" title="Desativado depois desta coleta">inativo</span>') + '</td>' +
      '<td class="num cc-mono">' + i.inicial + '</td>' +
      '<td class="num cc-mono">' + i.final + '</td>' +
      '<td class="num cc-mono">' + i.usos + '</td>' +
      '<td class="num cc-mono">' + fmtDin(i.valor) + '</td>' +
    '</tr>').join('');

  // Soma dos itens conferida contra o valor_esperado GRAVADO. Se um dia
  // divergirem, e porque item foi mexido no banco depois — a tela avisa
  // em vez de mostrar dois numeros e deixar a pessoa escolher.
  const somaItens = (c.itens || []).reduce((a, i) => a + Number(i.valor || 0), 0);
  const bate = Math.abs(somaItens - Number(c.valor_esperado)) < 0.005;

  const foto = (url, rot) => url
    ? '<a class="cc-foto" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
      '<img src="' + escapeHtml(url) + '" alt="' + rot + '"><span>' + rot + '</span></a>'
    : '<div class="cc-foto cc-foto-falta"><span>sem ' + rot + '</span></div>';

  document.getElementById('det-corpo').innerHTML =
    '<table class="cc-det-tab"><thead><tr>' +
      '<th>Equipamento</th><th class="num">Inicial</th><th class="num">Final</th>' +
      '<th class="num">Usos</th><th class="num">Valor</th>' +
    '</tr></thead><tbody>' + (linhas || '<tr><td colspan="5" class="cc-msg">Sem itens.</td></tr>') +
    '</tbody></table>' +
    (bate ? '' : '<div class="cc-aviso cc-aviso-erro">A soma dos itens (' + fmtDin(somaItens) +
      ') não bate com o esperado gravado (' + fmtDin(c.valor_esperado) + ').</div>') +
    '<div class="cc-det-caixa">' +
      '<div class="cc-det-linha"><span>Esperado</span><b class="cc-mono">' + fmtDin(c.valor_esperado) + '</b></div>' +
      '<div class="cc-det-linha"><span>Recolhido</span><b class="cc-mono">' + fmtDin(c.valor_recolhido) + '</b></div>' +
      '<div class="cc-det-linha cc-det-dif"><span>Diferença</span><b class="cc-mono ' + clsDif + '">' +
        (dif > 0 ? '+' : '') + fmtDin(dif) + '</b></div>' +
    '</div>' +
    (c.observacao ? '<div class="cc-obs"><span>Observação</span><p>' + escapeHtml(c.observacao) + '</p></div>' : '') +
    '<div class="cc-fotos">' + foto(c.foto_encerrante, 'encerrante') + foto(c.foto_protocolo, 'protocolo') + '</div>' +
    (c.status === 'PENDENTE_FOTO'
      ? '<div class="cc-aviso cc-aviso-atencao">Coleta sem as duas fotos. O supervisor completa pela tela dele.</div>'
      : '');
}

// ── Cadastro de equipamento ─────────────────────────────────────
function abrirModalEquip() {
  const msg = document.getElementById('eq-msg');
  msg.className = 'modal-msg'; msg.textContent = '';
  document.getElementById('eq-nome').value = '';
  document.getElementById('eq-valor').value = '1,00';
  document.getElementById('eq-destino').value = 'EDUARDO';
  // Herda o destino do posto escolhido: destino e fixo por posto, e
  // deixar o padrao errado convida a criar um equipamento divergente.
  const sel = document.getElementById('eq-posto');
  if (sel) sincronizarDestino();
  if (sel && !sel.__ligado) {
    sel.addEventListener('change', sincronizarDestino);
    sel.__ligado = true;
  }
  const dest = document.getElementById('eq-destino');
  if (dest && !dest.__ligado) {
    dest.addEventListener('change', avisarDestinoDivergente);
    dest.__ligado = true;
  }
  document.getElementById('md-equip').classList.add('active');
}

function sincronizarDestino() {
  const nome = document.getElementById('eq-posto').value;
  const p = postosCache.find(x => x.nome === nome);
  const dest = document.getElementById('eq-destino');
  if (p && p.destinos && p.destinos.length === 1) dest.value = p.destinos[0];
  avisarDestinoDivergente();
}

// Destino e fixo POR POSTO — o backend guarda no equipamento, mas o
// supervisor le um destino so no cabecalho da tela dele. Cadastrar um
// equipamento com destino diferente do que o posto ja tem produz o caso
// que a API chama de "cadastro errado": a tela mostra um e esconde o
// outro. Nao BLOQUEIA (pode ser uma mudanca real de rota do dinheiro),
// mas nao deixa passar calado.
function avisarDestinoDivergente() {
  const nome = document.getElementById('eq-posto').value;
  const p = postosCache.find(x => x.nome === nome);
  const escolhido = document.getElementById('eq-destino').value;
  const msg = document.getElementById('eq-msg');
  const jaTem = (p && p.destinos) ? p.destinos : [];
  // So fala quando ha divergencia de verdade. Nao pisa numa mensagem de
  // erro ou de sucesso que ja esteja na tela.
  if (msg.classList.contains('err') || msg.classList.contains('ok')) return;
  if (jaTem.length && !jaTem.includes(escolhido)) {
    msg.className = 'modal-msg';
    msg.innerHTML = '<span style="color:var(--warning)">Atenção: ' + escapeHtml(nome) +
      ' hoje é <b>' + escapeHtml(jaTem.join(' / ')) + '</b>. Cadastrar como <b>' +
      escapeHtml(escolhido) + '</b> deixa o posto com dois destinos.</span>';
  } else {
    msg.className = 'modal-msg';
    msg.textContent = '';
  }
}

async function salvarEquipamento() {
  const msg = document.getElementById('eq-msg');
  const btn = document.getElementById('eq-salvar');
  const posto = document.getElementById('eq-posto').value;
  const nome = document.getElementById('eq-nome').value.trim();
  // Aceita vírgula: o teclado do usuário é pt-BR e "1,00" é o que ele digita.
  const valor = Number(String(document.getElementById('eq-valor').value).replace(',', '.'));
  const destino = document.getElementById('eq-destino').value;

  const erro = !posto ? 'Escolha o posto.'
    : !nome ? 'Informe o nome do equipamento.'
    : (!Number.isFinite(valor) || valor <= 0) ? 'Valor por uso deve ser maior que zero.'
    : null;
  if (erro) { msg.className = 'modal-msg err'; msg.textContent = erro; return; }

  btn.disabled = true;
  msg.className = 'modal-msg'; msg.textContent = 'Salvando…';
  try {
    const r = await apiFetch('/calibrador/equipamento', {
      method: 'POST',
      body: JSON.stringify({ posto, nome, valor_uso: valor, destino }),
    });
    msg.className = 'modal-msg ok';
    msg.textContent = 'Cadastrado: ' + r.equipamento.nome + ' em ' + r.posto + '.';
    toast(r.equipamento.nome + ' cadastrado em ' + r.posto);
    document.getElementById('eq-nome').value = '';
    // Recarrega os postos: um posto que nao tinha equipamento pode ter
    // passado a ter, e o seletor de filtro precisa refletir isso.
    await carregarPostos();
  } catch (e) {
    msg.className = 'modal-msg err';
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

// Expostos p/ o onclick do HTML e p/ o harness de testes.
window.toggleTheme    = toggleTheme;
window.carregarLista  = carregarLista;
window.abrirDetalhe   = abrirDetalhe;
