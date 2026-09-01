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
// Ultima resposta da lista. Guardada para redesenhar sem ir ao servidor
// (marcar um visto nao deve desfazer rolagem nem filtro) SEM perder o
// aviso de truncamento, que vive na resposta e nao nas coletas.
let ultimaResposta = { coletas: [], truncado: false };
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
// O visto tem HORA — duas pessoas conferindo no mesmo dia precisam saber
// a ordem. Vem em ISO/UTC do banco; o Date converte para o fuso local.
function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit' });
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
  document.getElementById('btn-importar').addEventListener('click', abrirModalImport);
  document.getElementById('imp-conferir').addEventListener('click', conferirImport);
  document.getElementById('imp-gravar').addEventListener('click', gravarImport);
  document.getElementById('imp-fechar').addEventListener('click', () => fecharModal('md-import'));

  // Fecha no clique fora e no ESC — a tela e de conferencia, se navega
  // rapido entre linhas e ter de mirar o botao Fechar cansa.
  ['md-detalhe', 'md-equip', 'md-import'].forEach(id => {
    const ov = document.getElementById(id);
    if (ov) ov.addEventListener('click', e => { if (e.target === ov) fecharModal(id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { fecharModal('md-detalhe'); fecharModal('md-equip'); fecharModal('md-import'); }
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
    ultimaResposta = r;
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
    // Coleta sem recolhido nao tem diferenca — nem zero. Zero seria uma
    // afirmacao ("bateu certinho") sobre uma conta que nao foi feita.
    const dif = c.sem_recolhido ? null : Number(c.diferenca);
    const clsDif = c.sem_recolhido ? 'cc-zero'
      : (dif < 0 ? 'cc-neg' : (dif > 0 ? 'cc-pos' : 'cc-zero'));
    const selo = pend
      ? '<span class="cc-selo cc-selo-pend">PENDENTE FOTO</span>' +
        (atrasada ? '<span class="cc-selo cc-selo-atraso" title="Lançada há ' + c.dias_sem_foto +
                    ' dias e ainda sem as duas fotos">' + c.dias_sem_foto + 'd</span>' : '')
      : '<span class="cc-selo cc-selo-ok">OK</span>';
    // O visto e ORTOGONAL ao status: uma coleta pode estar sem foto E
    // conferida (a conciliação viu e aceitou), ou completa e não olhada.
    // Por isso o ✓ acompanha o selo em vez de substituí-lo.
    const selos = selo + (c.conferido
      ? '<span class="cc-selo cc-selo-conf" title="Conferido por ' +
        escapeHtml(c.conferido_por || '—') + ' em ' + fmtDataHora(c.conferido_em) + '">✓</span>'
      : '');
    // A faixa da esquerda mostra UMA coisa só, na ordem de urgência:
    // atrasada > sem foto > conferida. Quem está atrasada não vira verde
    // por ter sido conferida.
    const clsLinha = atrasada ? ' cc-linha-atraso'
      : (pend ? ' cc-linha-pend' : (c.conferido ? ' cc-linha-conf' : ''));
    return '<tr class="cc-linha' + clsLinha +
      '" data-id="' + c.id + '" tabindex="0">' +
      '<td class="cc-mono">' + fmtData(c.data) + '</td>' +
      '<td>' + escapeHtml(c.posto || '—') + '</td>' +
      '<td class="cc-mono cc-dest">' + escapeHtml((c.destinos || []).join(' / ') || '—') + '</td>' +
      '<td class="num cc-mono">' + fmtDin(c.valor_esperado) + '</td>' +
      '<td class="num cc-mono">' + (c.sem_recolhido
        ? '<span class="cc-falta" title="Importada da planilha sem o valor recolhido">sem recolhido</span>'
        : fmtDin(c.valor_recolhido)) + '</td>' +
      '<td class="num cc-mono ' + clsDif + '">' + (c.sem_recolhido ? '—'
        : (dif > 0 ? '+' : '') + fmtDin(dif)) + '</td>' +
      '<td>' + selos + '</td>' +
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
  // Recolhido e Diferenca somam SO as coletas que tem o valor. Tratar
  // ausente como zero mostraria um rombo do tamanho do esperado dessas
  // coletas — um numero que nunca existiu, no lugar mais visivel da tela.
  const comRec = coletasAtuais.filter(c => !c.sem_recolhido);
  const semRec = coletasAtuais.length - comRec.length;
  const rec = comRec.reduce((a, c) => a + Number(c.valor_recolhido || 0), 0);
  const espComRec = comRec.reduce((a, c) => a + Number(c.valor_esperado || 0), 0);
  const dif = rec - espComRec;
  const pend = coletasAtuais.filter(c => c.status === 'PENDENTE_FOTO').length;
  const conf = coletasAtuais.filter(c => c.conferido).length;
  const atras = coletasAtuais.filter(c => c.status === 'PENDENTE_FOTO' && c.dias_sem_foto >= DIAS_ALERTA_FOTO).length;
  const clsDif = dif < 0 ? 'cc-neg' : (dif > 0 ? 'cc-pos' : 'cc-zero');
  document.getElementById('cc-resumo').innerHTML =
    '<div class="cc-kpi"><span>Coletas</span><b>' + n + '</b></div>' +
    '<div class="cc-kpi"><span>Esperado</span><b class="cc-mono">' + fmtDin(esp) + '</b></div>' +
    '<div class="cc-kpi"><span>Recolhido</span><b class="cc-mono">' + fmtDin(rec) +
      (semRec ? '<small> de ' + comRec.length + '</small>' : '') + '</b></div>' +
    '<div class="cc-kpi"><span>Diferença</span><b class="cc-mono ' + clsDif + '">' +
      (dif > 0 ? '+' : '') + fmtDin(dif) + '</b></div>' +
    (semRec ? '<div class="cc-kpi"><span>Sem recolhido</span><b class="cc-neg">' + semRec +
      '<small> fora da soma</small></b></div>' : '') +
    '<div class="cc-kpi"><span>Sem foto</span><b class="' + (pend ? 'cc-neg' : '') + '">' + pend +
      (atras ? ' <small>(' + atras + ' há ' + DIAS_ALERTA_FOTO + '+ dias)</small>' : '') + '</b></div>' +
    '<div class="cc-kpi"><span>Conferidas</span><b>' + conf + '<small> de ' + n + '</small></b></div>';
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

  const dif = c.sem_recolhido ? null : Number(c.diferenca);
  const clsDif = c.sem_recolhido ? 'cc-zero'
    : (dif < 0 ? 'cc-neg' : (dif > 0 ? 'cc-pos' : 'cc-zero'));

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
      '<div class="cc-det-linha"><span>Recolhido</span><b class="cc-mono">' +
        (c.sem_recolhido ? '<span class="cc-falta">não informado</span>' : fmtDin(c.valor_recolhido)) +
        '</b></div>' +
      '<div class="cc-det-linha cc-det-dif"><span>Diferença</span><b class="cc-mono ' + clsDif + '">' +
        (c.sem_recolhido ? '—' : (dif > 0 ? '+' : '') + fmtDin(dif)) + '</b></div>' +
    '</div>' +
    (c.observacao ? '<div class="cc-obs"><span>Observação</span><p>' + escapeHtml(c.observacao) + '</p></div>' : '') +
    '<div class="cc-fotos">' + foto(c.foto_encerrante, 'encerrante') + foto(c.foto_protocolo, 'protocolo') + '</div>' +
    (c.sem_recolhido
      ? '<div class="cc-aviso cc-aviso-atencao">Importada da planilha <b>sem o valor recolhido</b>. ' +
        'As leituras estão registradas; a diferença não pode ser calculada.</div>'
      : '') +
    (c.status === 'PENDENTE_FOTO'
      ? '<div class="cc-aviso cc-aviso-atencao">Coleta sem as duas fotos. O supervisor completa pela tela dele.</div>'
      : '') +
    '<div class="cc-conf" id="det-conf"></div>';
  renderConferido(c);
}

// ── Visto de conferido ──────────────────────────────────────────
// "Olhei e esta certo". Nao trava nada, nao muda calculo nenhum, e da
// para desfazer. Serve para a conciliacao nao reconferir as mesmas
// coletas todo mes.
function renderConferido(c) {
  const box = document.getElementById('det-conf');
  if (!box) return;
  box.className = 'cc-conf' + (c.conferido ? ' cc-conf-on' : '');
  box.innerHTML = c.conferido
    ? '<div class="cc-conf-txt">✓ Conferido por <b>' + escapeHtml(c.conferido_por || '—') +
      '</b><br><span>' + fmtDataHora(c.conferido_em) + '</span></div>' +
      '<button class="cc-btn" id="btn-conf" type="button">Desmarcar</button>'
    : '<div class="cc-conf-txt">Ainda não conferida.</div>' +
      '<button class="cc-btn cc-btn-conf" id="btn-conf" type="button">✓ Marcar como conferido</button>';
  document.getElementById('btn-conf').onclick = () => alternarConferido(c);
}

async function alternarConferido(c) {
  const btn = document.getElementById('btn-conf');
  const alvo = !c.conferido;
  btn.disabled = true;
  btn.textContent = alvo ? 'Marcando…' : 'Desmarcando…';
  try {
    // Manda o valor EXPLICITO, nao um toggle: dois cliques seguidos, ou
    // duas abas abertas, deixariam o resultado a sorte de qual chega
    // primeiro. Repetir a chamada com o mesmo valor da no mesmo.
    const r = await apiFetch('/calibrador/coleta/' + encodeURIComponent(c.id) + '/conferir', {
      method: 'POST',
      body: JSON.stringify({ conferido: alvo }),
    });
    c.conferido     = r.conferido;
    c.conferido_em  = r.conferido_em;
    c.conferido_por = r.conferido_por;
    renderConferido(c);
    toast(alvo ? 'Marcada como conferida.' : 'Visto removido.');

    // A LISTA ATRAS TAMBEM MUDA. Sem isto o selo da linha continuaria
    // como estava ate o proximo recarregamento, e a pessoa marcaria a
    // mesma coleta de novo achando que nao pegou. Atualiza em memoria e
    // redesenha — sem ir ao servidor, que desfaria a rolagem e os filtros.
    const naLista = coletasAtuais.find(x => String(x.id) === String(c.id));
    if (naLista) {
      naLista.conferido     = r.conferido;
      naLista.conferido_em  = r.conferido_em;
      naLista.conferido_por = r.conferido_por;
      renderLista(ultimaResposta);
    }
  } catch (e) {
    toast('Não consegui salvar o visto: ' + e.message);
    renderConferido(c);
  }
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

// ════════════════════════════════════════════════════════════════
// IMPORTAÇÃO DO HISTÓRICO (colar da planilha)
// ════════════════════════════════════════════════════════════════
// ~100 lançamentos de 2 a 3 meses que hoje vivem numa planilha. Digitar
// um por um seria transcrição — a atividade mais propensa a erro do
// sistema, e a razão de o pré-preenchimento do `inicial` existir.
//
// DOIS FORMATOS, detectados sozinhos:
//
// LARGO (o da planilha atual): um bloco de colunas por equipamento, lado
// a lado, com o nome do posto na linha de cima.
//     P. JA                             P. ITAPOA · BANHEIRO
//     Data  Inicial Final Difer. Valor  Data  Inicial Final Difer. Valor
//     01/07 1000    1300  300    300,00 01/07 500     612   112   112,00
//
// LONGO: uma linha por lançamento, com cabeçalho contendo Posto e
// Equipamento. Aceito para quem preferir reorganizar.
//
// O NOME DO EQUIPAMENTO só é necessário nos 6 postos que têm dois
// (ITAPOA, JOCA, DIFERENCIAL, MANGABEIRAS, TUNEL, AVIVA). Nos outros 22
// a API infere sozinha. No formato largo, escreva no topo do bloco:
//     P. ITAPOA · BANHEIRO      (ou "P. ITAPOA - BANHEIRO")
//
// QUEM VALIDA É A API, não este parser. Aqui só se traduz texto em
// linhas; a prévia mostra o veredito que veio de POST /calibrador/importar
// com confirmar:false — a MESMA rota que grava. Se a tela validasse por
// conta própria, a prévia poderia prometer o que a gravação recusa.
// ════════════════════════════════════════════════════════════════

let _linhasColadas = [];   // o que o parser entendeu
let _previaResp    = null; // resposta da API com confirmar:false

const semAc = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

// "01/07/2026" e "2026-07-01" viram ISO. Ano de 2 dígitos NÃO é aceito:
// "01/07/26" tanto pode ser 2026 quanto 1926, e adivinhar num histórico
// que vai virar registro contábil não vale o risco.
function dataISO(v) {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!m) return t;
  return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

// Separa "P. ITAPOA · BANHEIRO" em posto e equipamento. Sem separador, o
// rótulo inteiro é o posto e o equipamento fica para a API inferir.
function partirRotulo(rot) {
  const m = String(rot || '').split(/\s+[·\-–—|]\s+/);
  return m.length >= 2
    ? { posto: m[0].trim(), equipamento: m.slice(1).join(' ').trim() }
    : { posto: String(rot || '').trim(), equipamento: '' };
}

function parsearColagem(texto) {
  const linhas = String(texto || '').replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (!linhas.length) return { linhas: [], erro: 'Nada colado.' };
  const grade = linhas.map(l => l.split('\t'));

  // Acha o cabeçalho: a primeira linha que tenha "Data" e ("Inicial" ou "Final").
  const iCab = grade.findIndex(c => {
    const s = c.map(semAc);
    return s.includes('DATA') && (s.includes('INICIAL') || s.includes('FINAL'));
  });
  if (iCab === -1) {
    return { linhas: [], erro: 'Não achei o cabeçalho. A colagem precisa incluir a linha com Data, Inicial e Final.' };
  }
  const cab = grade[iCab].map(semAc);

  // LONGO: o cabeçalho tem Posto (e talvez Equipamento) na mesma linha.
  if (cab.includes('POSTO')) return parsearLongo(grade, iCab, cab);
  return parsearLargo(grade, iCab, cab);
}

function parsearLongo(grade, iCab, cab) {
  const col = (nome) => cab.indexOf(nome);
  const iPosto = col('POSTO'), iData = col('DATA');
  const iEq = col('EQUIPAMENTO') !== -1 ? col('EQUIPAMENTO') : col('EQUIP');
  const iIni = col('INICIAL'), iFim = col('FINAL');
  const iRec = col('RECOLHIDO') !== -1 ? col('RECOLHIDO')
             : (col('VALOR RECOLHIDO') !== -1 ? col('VALOR RECOLHIDO') : col('VALOR'));
  if (iIni === -1 || iFim === -1) return { linhas: [], erro: 'Faltam as colunas Inicial e Final.' };

  const out = [];
  for (let r = iCab + 1; r < grade.length; r++) {
    const c = grade[r];
    if (!(c[iPosto] || '').trim() && !(c[iData] || '').trim()) continue;
    out.push({
      ref: r, origem: 'linha ' + (r + 1),
      posto: (c[iPosto] || '').trim(),
      equipamento: iEq !== -1 ? (c[iEq] || '').trim() : '',
      data: dataISO(c[iData]),
      inicial: (c[iIni] || '').trim(),
      final: (c[iFim] || '').trim(),
      valor_recolhido: iRec !== -1 ? (c[iRec] || '').trim() : '',
    });
  }
  return { linhas: out, formato: 'longo' };
}

function parsearLargo(grade, iCab, cab) {
  // Cada "Data" no cabeçalho abre um bloco; o bloco vai até o próximo.
  const inicios = [];
  cab.forEach((v, i) => { if (v === 'DATA') inicios.push(i); });
  if (!inicios.length) return { linhas: [], erro: 'Não achei nenhuma coluna Data.' };

  const blocos = inicios.map((ini, k) => {
    const fim = k + 1 < inicios.length ? inicios[k + 1] : cab.length;
    const mapa = {};
    for (let i = ini; i < fim; i++) {
      const n = cab[i];
      if (n === 'DATA') mapa.data = i;
      else if (n === 'INICIAL') mapa.inicial = i;
      else if (n === 'FINAL') mapa.final = i;
      else if (n === 'VALOR' || n === 'RECOLHIDO' || n === 'VALOR RECOLHIDO') mapa.recolhido = i;
      // "DIFERENCA" é ignorada de propósito: a API recalcula final-inicial.
      // Coluna conferida na planilha não vira fonte — se divergir, quem
      // manda é a leitura.
    }
    // Rótulo do bloco: a célula não vazia mais próxima ACIMA, dentro das
    // colunas do bloco. Célula mesclada no Excel cai na primeira coluna.
    let rot = '';
    for (let r = iCab - 1; r >= 0 && !rot; r--) {
      for (let i = ini; i < fim && !rot; i++) {
        if ((grade[r][i] || '').trim()) rot = grade[r][i].trim();
      }
    }
    return { ini, fim, mapa, rotulo: rot };
  });

  const semRotulo = blocos.filter(b => !b.rotulo).length;
  if (semRotulo === blocos.length) {
    return { linhas: [], erro: 'Nenhum bloco tem o nome do posto acima do cabeçalho. Inclua a linha dos nomes na colagem.' };
  }

  const out = [];
  for (let r = iCab + 1; r < grade.length; r++) {
    blocos.forEach((b, k) => {
      const c = grade[r];
      const d = (c[b.mapa.data] || '').trim();
      if (!d) return;                       // bloco mais curto que o vizinho
      const { posto, equipamento } = partirRotulo(b.rotulo);
      out.push({
        ref: r + ':' + k,
        origem: 'linha ' + (r + 1) + ', bloco ' + (b.rotulo || '?'),
        posto, equipamento, data: dataISO(d),
        inicial: (c[b.mapa.inicial] || '').trim(),
        final: (c[b.mapa.final] || '').trim(),
        valor_recolhido: b.mapa.recolhido !== undefined ? (c[b.mapa.recolhido] || '').trim() : '',
      });
    });
  }
  return { linhas: out, formato: 'largo', blocos: blocos.length };
}

// ── Tela da importação ──────────────────────────────────────────
function abrirModalImport() {
  document.getElementById('imp-texto').value = '';
  document.getElementById('imp-previa').innerHTML = '';
  document.getElementById('imp-info').textContent = '';
  const msg = document.getElementById('imp-msg');
  msg.className = 'modal-msg'; msg.textContent = '';
  document.getElementById('imp-gravar').hidden = true;
  _linhasColadas = []; _previaResp = null;
  document.getElementById('md-import').classList.add('active');
  setTimeout(() => document.getElementById('imp-texto').focus(), 50);
}

// Conferir = mandar para a API com confirmar:false. A prévia é o veredito
// da MESMA rota que grava, não uma segunda opinião desta tela.
async function conferirImport() {
  const msg = document.getElementById('imp-msg');
  const btn = document.getElementById('imp-conferir');
  const prev = document.getElementById('imp-previa');
  document.getElementById('imp-gravar').hidden = true;
  _previaResp = null;

  const r = parsearColagem(document.getElementById('imp-texto').value);
  if (r.erro) {
    msg.className = 'modal-msg err'; msg.textContent = r.erro;
    prev.innerHTML = ''; document.getElementById('imp-info').textContent = '';
    return;
  }
  _linhasColadas = r.linhas;
  document.getElementById('imp-info').textContent =
    'formato ' + r.formato + (r.blocos ? ', ' + r.blocos + ' blocos' : '') +
    ', ' + r.linhas.length + ' linhas lidas';
  if (!r.linhas.length) {
    msg.className = 'modal-msg err';
    msg.textContent = 'Li o cabeçalho mas nenhuma linha de dados.';
    prev.innerHTML = ''; return;
  }

  btn.disabled = true;
  msg.className = 'modal-msg'; msg.textContent = 'Conferindo…';
  try {
    const resp = await apiFetch('/calibrador/importar', {
      method: 'POST',
      body: JSON.stringify({ confirmar: false, linhas: r.linhas }),
    });
    _previaResp = resp;
    renderPrevia(resp);
  } catch (e) {
    msg.className = 'modal-msg err'; msg.textContent = e.message;
    prev.innerHTML = '';
  } finally {
    btn.disabled = false;
  }
}

// `confirmado` = ja gravou. Nesse caso a tabela e redesenhada mas a
// MENSAGEM e de quem gravou: renderPrevia escrevendo por cima diria
// "nada a gravar" logo depois de gravar 4 coletas, que e o oposto do que
// aconteceu.
function renderPrevia(resp) {
  const msg = resp.confirmado ? null : document.getElementById('imp-msg');
  const res = resp.resumo;
  const porRef = new Map((resp.linhas || []).map(l => [String(l.ref), l]));

  const linhas = _linhasColadas.map(orig => {
    const v = porRef.get(String(orig.ref)) || {};
    const estado = v.erro ? 'ERRO' : (v.ja_existe ? 'JA_EXISTE' : 'OK');
    const cls = estado === 'ERRO' ? 'cc-p-erro' : (estado === 'JA_EXISTE' ? 'cc-p-dup' : 'cc-p-ok');
    const selo = estado === 'ERRO' ? '<span class="cc-selo cc-selo-pend">erro</span>'
      : estado === 'JA_EXISTE' ? '<span class="cc-selo cc-selo-inativo">ja existe</span>'
      : '<span class="cc-selo cc-selo-ok">ok</span>';
    return '<tr class="' + cls + '">' +
      '<td class="cc-mono">' + escapeHtml(orig.origem || '') + '</td>' +
      '<td>' + escapeHtml(v.posto || orig.posto || '—') + '</td>' +
      '<td class="cc-mono">' + fmtData(v.data || orig.data) + '</td>' +
      '<td>' + escapeHtml(v.equipamento || orig.equipamento || '—') +
        (v.equipamento_inferido ? '<span class="cc-inf" title="O posto so tem este equipamento ativo">auto</span>' : '') + '</td>' +
      '<td class="num cc-mono">' + (v.inicial != null ? v.inicial : '—') + '</td>' +
      '<td class="num cc-mono">' + (v.final != null ? v.final : '—') + '</td>' +
      '<td class="num cc-mono">' + (v.valor != null ? fmtDin(v.valor) : '—') + '</td>' +
      '<td class="num cc-mono">' + (v.valor_recolhido != null ? fmtDin(v.valor_recolhido) : '—') + '</td>' +
      '<td>' + selo + (v.erro ? ' <span class="cc-p-motivo">' + escapeHtml(v.erro) + '</span>' : '') + '</td>' +
      '</tr>';
  }).join('');

  document.getElementById('imp-previa').innerHTML =
    '<div class="cc-p-resumo">' +
      '<span><b>' + res.coletas_a_gravar + '</b> coletas a gravar</span>' +
      '<span class="' + (res.linhas_com_erro ? 'cc-neg' : '') + '"><b>' + res.linhas_com_erro + '</b> linhas com erro</span>' +
      '<span><b>' + res.coletas_ja_existentes + '</b> ja existentes</span>' +
    '</div>' +
    '<div class="cc-p-wrap"><table class="cc-p-tab"><thead><tr>' +
      '<th>Origem</th><th>Posto</th><th>Data</th><th>Equipamento</th>' +
      '<th class="num">Inicial</th><th class="num">Final</th>' +
      '<th class="num">Esperado</th><th class="num">Recolhido</th><th>Situacao</th>' +
    '</tr></thead><tbody>' + linhas + '</tbody></table></div>';

  const btnG = document.getElementById('imp-gravar');
  if (res.coletas_a_gravar > 0) {
    btnG.hidden = false;
    btnG.textContent = 'Gravar ' + res.coletas_a_gravar + ' coleta' + (res.coletas_a_gravar > 1 ? 's' : '');
    if (msg) msg.className = 'modal-msg';
    // Linha com erro NAO impede gravar o resto: numa carga de 100, exigir
    // zero erros faria refazer a colagem inteira por causa de uma. O que
    // nao pode e gravar em silencio — por isso o botao DIZ quantas entram
    // e o resumo diz quantas ficam de fora.
    if (msg) msg.innerHTML = res.linhas_com_erro
      ? '<span style="color:var(--warning)">As ' + res.linhas_com_erro +
        ' linhas com erro serao ignoradas. Corrija na planilha e cole de novo — o que ja foi gravado aparece como "ja existe".</span>'
      : '';
  } else {
    btnG.hidden = true;
    if (msg) msg.className = 'modal-msg err';
    if (msg) msg.textContent = res.coletas_ja_existentes
      ? 'Nada a gravar: todas essas coletas ja estao no sistema.'
      : 'Nada a gravar: nenhuma linha passou na conferencia.';
  }
}

async function gravarImport() {
  if (!_previaResp || !_linhasColadas.length) return;
  const btn = document.getElementById('imp-gravar');
  const msg = document.getElementById('imp-msg');
  btn.disabled = true; btn.textContent = 'Gravando…';
  try {
    // Manda as MESMAS linhas de novo com confirmar:true. A API refaz a
    // conferencia inteira, inclusive a de ja existir — entre a previa e o
    // clique, alguem pode ter lancado.
    const resp = await apiFetch('/calibrador/importar', {
      method: 'POST',
      body: JSON.stringify({ confirmar: true, linhas: _linhasColadas }),
    });
    const r = resp.resumo;
    msg.className = 'modal-msg ' + (r.falhas ? 'err' : 'ok');
    msg.textContent = r.gravadas + ' coleta(s) gravada(s)' +
      (r.falhas ? '; ' + r.falhas + ' falharam' : '') +
      (r.coletas_ja_existentes ? '; ' + r.coletas_ja_existentes + ' ja existiam' : '') + '.';
    toast(r.gravadas + ' coleta(s) importada(s)');
    _previaResp = resp;
    renderPrevia(resp);
    btn.hidden = true;
    await carregarLista();
  } catch (e) {
    msg.className = 'modal-msg err'; msg.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Gravar';
  }
}

window.abrirModalImport = abrirModalImport;
window.conferirImport   = conferirImport;
window.gravarImport     = gravarImport;
window.parsearColagem   = parsearColagem;
