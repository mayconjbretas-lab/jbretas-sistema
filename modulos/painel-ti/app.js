// ================================================================
// JBRETAS SISTEMA — modulos/painel-ti/app.js
// Painel TI. Duas abas:
//  • "Acessar como": lista usuários ativos e entra na sessão (impersona).
//  • "Usuários": CRUD (criar/editar/desativar/excluir) — guardado por
//    perfil.ti no backend; no front, BLOQUEADO enquanto se está
//    impersonando (jbretas_visao_ti), pois editar a senha de quem você
//    está "vendo como" quebraria sua própria sessão.
//
// Guard: só entra quem tem a flag `ti`. Qualquer outro vai pro portal
// do próprio perfil.
// ================================================================

let usuarioAtual    = null;

// estado — aba Acessar como
let todosUsuarios   = [];
let modalidadeAtiva = '';
let buscaAtual      = '';

// estado — aba Usuários
let usuariosGerenciar  = [];
let postosLista        = [];
let buscaU             = '';
let gerenciarCarregado = false;
let modalUserId        = null;   // null = novo; id = editar

// estado — aba Pendências
let itens = [], itensCarregado = false, itContagem = {}, itFiltro = 'todos';
let itStatus = 'abertos';   // abertos (novo+em_analise) | novo | em_analise | resolvido | ignorado

// ── Tema ──
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

// ── Helpers ──
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function iniciaisDe(nome) {
  return (String(nome || '').split(' ').slice(0, 2).map(p => p[0] || '').join('').toUpperCase()) || '--';
}
function toast(msg) {
  const t = document.getElementById('toast');
  const m = document.getElementById('toast-msg');
  if (m) m.textContent = msg;
  if (t) { t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
}

// Está impersonando? (faixa "vendo como" ativa) → bloqueia escrita.
function estaImpersonando() { return !!localStorage.getItem('jbretas_visao_ti'); }
function podeEscrever() { return !estaImpersonando(); }

document.addEventListener('DOMContentLoaded', async () => {
  const u = exigirSessao();
  if (!u) return;
  if (u.ti !== true) { redirecionarPorPerfil(u); return; }
  usuarioAtual = u;

  aplicarTema(localStorage.getItem('jb_theme') || 'dark');
  montarTopbar();
  ligarControles();
  ligarControlesUsuarios();
  ligarControlesTecnox();
  ligarControlesMov();
  await carregarUsuarios();
});

function montarTopbar() {
  const nome = usuarioAtual && usuarioAtual.nome ? usuarioAtual.nome : '—';
  const eln = document.getElementById('app-nome'); if (eln) eln.textContent = nome;
  const ela = document.getElementById('app-avatar'); if (ela) ela.textContent = iniciaisDe(nome);
}

// ════════════════════════════════════════════════════════════════
// ABAS
// ════════════════════════════════════════════════════════════════
function switchTab(name) {
  ['acessar', 'usuarios', 'pendencias', 'tecnox'].forEach(t => {
    const panel = document.getElementById('tab-' + t);
    if (panel) panel.classList.toggle('active', t === name);
    const btn = document.getElementById('tabbtn-' + t);
    if (btn) btn.classList.toggle('active', t === name);
  });
  if (name === 'usuarios') carregarGerenciar(false);
  if (name === 'pendencias') carregarItens(false);
  // API TecnoX: ao abrir carrega SÓ o histórico (rápido). A sonda (30–60s) só no clique.
  if (name === 'tecnox') txAoAbrir();
}

// ════════════════════════════════════════════════════════════════
// ABA "ACESSAR COMO"
// ════════════════════════════════════════════════════════════════
function ligarControles() {
  const chips = document.getElementById('ti-chips');
  if (chips) chips.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-chip') : null;
    if (!btn) return;
    modalidadeAtiva = btn.getAttribute('data-modalidade') || '';
    Array.prototype.forEach.call(chips.querySelectorAll('.ti-chip'),
      c => c.classList.toggle('active', c === btn));
    renderLista();
  });
  const busca = document.getElementById('ti-busca');
  if (busca) busca.addEventListener('input', (e) => { buscaAtual = e.target.value || ''; renderLista(); });
  const lista = document.getElementById('ti-lista');
  if (lista) lista.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-entrar') : null;
    if (!btn) return;
    entrarComo(btn.getAttribute('data-id'), btn);
  });
}

async function carregarUsuarios() {
  const lista = document.getElementById('ti-lista');
  try {
    const resp = await apiFetch('/ti/usuarios');
    todosUsuarios = (resp && resp.usuarios) || [];
    renderLista();
  } catch (err) {
    if (lista) lista.innerHTML = '<div class="empty-state">⚠ Falha ao carregar usuários: ' + escapeHtml(err.message) + '</div>';
  }
  return todosUsuarios;
}

function aplicarFiltros() {
  const q = norm(buscaAtual);
  return todosUsuarios.filter(u => {
    if (modalidadeAtiva && u.perfil !== modalidadeAtiva) return false;
    if (!q) return true;
    return norm(u.nome).indexOf(q) !== -1 || norm(u.posto_nome).indexOf(q) !== -1;
  });
}

function renderLista() {
  const lista = document.getElementById('ti-lista');
  const contador = document.getElementById('ti-contador');
  const filtrados = aplicarFiltros();
  if (contador) contador.textContent = filtrados.length + '/' + todosUsuarios.length;
  if (!filtrados.length) {
    if (lista) lista.innerHTML = '<div class="empty-state">Nenhum usuário para este filtro.</div>';
    return;
  }
  const html = filtrados.map(u => {
    const nome = u.nome || '—';
    const sub = u.posto_nome ? u.posto_nome : (u.email || '');
    return '' +
      '<div class="ti-user">' +
        '<div class="ti-user-avatar">' + escapeHtml(iniciaisDe(nome)) + '</div>' +
        '<div class="ti-user-info">' +
          '<div class="ti-user-nome">' + escapeHtml(nome) + '</div>' +
          '<div class="ti-user-meta">' +
            '<span class="ti-user-perfil">' + escapeHtml(u.perfil || '?') + '</span>' + escapeHtml(sub) +
          '</div>' +
        '</div>' +
        '<button class="ti-entrar" type="button" data-id="' + escapeHtml(u.id) + '">Entrar</button>' +
      '</div>';
  }).join('');
  if (lista) lista.innerHTML = html;
}

async function entrarComo(userId, btn) {
  if (!userId) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  const backup = {
    token:   jbretasGetItem('jbretas_token'),
    usuario: jbretasGetItem('jbretas_usuario'),
    refresh: jbretasGetItem('jbretas_refresh'),
    expira:  jbretasGetItem('jbretas_expira'),
  };
  let resp;
  try {
    resp = await apiFetch('/ti/entrar-como', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
    alert('Falha ao entrar como esse usuário: ' + err.message);
    return;
  }
  localStorage.setItem('jbretas_ti_backup', JSON.stringify(backup));
  localStorage.setItem('jbretas_visao_ti', JSON.stringify({
    nome:   resp.usuario.nome,
    perfil: resp.usuario.perfil,
    posto:  resp.usuario.nomePosto || (resp.usuario.posto && resp.usuario.posto.nome) || null,
  }));
  jbretasClearSessao();
  jbretasSetItem('jbretas_token', resp.token, true);
  jbretasSetItem('jbretas_usuario', JSON.stringify(resp.usuario), true);
  if (resp.refresh_token) jbretasSetItem('jbretas_refresh', resp.refresh_token, true);
  if (resp.expira != null) jbretasSetItem('jbretas_expira', String(resp.expira), true);
  redirecionarPorPerfil(resp.usuario);
}

// ════════════════════════════════════════════════════════════════
// ABA "USUÁRIOS" (CRUD)
// ════════════════════════════════════════════════════════════════
function ligarControlesUsuarios() {
  const tabs = document.getElementById('ti-tabs');
  if (tabs) tabs.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-tab') : null;
    if (!btn) return;
    switchTab(btn.getAttribute('data-tab'));
  });

  const novo = document.getElementById('btn-novo-usuario');
  if (novo) novo.addEventListener('click', () => abrirModal('novo'));

  const busca = document.getElementById('ti-u-busca');
  if (busca) busca.addEventListener('input', (e) => { buscaU = e.target.value || ''; renderGerenciar(); });

  const lista = document.getElementById('ti-u-lista');
  if (lista) lista.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-acao') : null;
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    const user = usuariosGerenciar.find(x => x.id === id) || null;
    if (act === 'editar')  abrirModal('editar', user);
    if (act === 'excluir') excluirUsuario(id);
    if (act === 'toggle')  toggleAtivo(id);
  });

  const perfil = document.getElementById('f-perfil');
  if (perfil) perfil.addEventListener('change', toggleGruposPorPerfil);
  const salvar = document.getElementById('ti-modal-salvar');
  if (salvar) salvar.addEventListener('click', submitForm);
  const cancel = document.getElementById('ti-modal-cancel');
  if (cancel) cancel.addEventListener('click', fecharModal);

  // Aba Pendências — filtros e ações por delegação (ligadas uma vez).
  const itFiltros = document.getElementById('ti-it-filtros');
  if (itFiltros) itFiltros.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-it-chip') : null;
    if (!btn) return;
    itFiltro = btn.getAttribute('data-f') || 'todos';
    renderItens();
  });
  const itKpis = document.getElementById('ti-it-kpis');
  if (itKpis) itKpis.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-it-kpi') : null;
    if (!btn) return;
    itStatus = btn.getAttribute('data-st') || 'abertos';
    renderItens();
  });
  const itLista = document.getElementById('ti-it-lista');
  if (itLista) itLista.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.ti-it-btn') : null;
    if (!btn) return;
    mudarStatusItem(btn.getAttribute('data-id'), btn.getAttribute('data-st'));
  });
}

async function carregarGerenciar(force) {
  if (gerenciarCarregado && !force) { atualizarBloqueio(); return usuariosGerenciar; }
  const lista = document.getElementById('ti-u-lista');
  try {
    const [ru, rp] = await Promise.all([
      apiFetch('/ti/usuarios?incluir_inativos=1'),
      apiFetch('/ti/postos-lista'),
    ]);
    usuariosGerenciar = (ru && ru.usuarios) || [];
    postosLista = (rp && rp.postos) || [];
    gerenciarCarregado = true;
    preencherSelectPostos();
  } catch (err) {
    if (lista) lista.innerHTML = '<div class="empty-state">⚠ Falha ao carregar: ' + escapeHtml(err.message) + '</div>';
    return usuariosGerenciar;
  }
  atualizarBloqueio();
  renderGerenciar();
  return usuariosGerenciar;
}

// Aviso + desabilita "Novo" quando impersonando.
function atualizarBloqueio() {
  const bloq = !podeEscrever();
  const aviso = document.getElementById('ti-imp-aviso');
  if (aviso) aviso.style.display = bloq ? 'flex' : 'none';
  const novo = document.getElementById('btn-novo-usuario');
  if (novo) novo.disabled = bloq;
}

// Ativos primeiro, inativos no fim (preserva ordem do servidor dentro do grupo).
function filtrarGerenciar() {
  const q = norm(buscaU);
  const filtrados = usuariosGerenciar.filter(u => {
    if (!q) return true;
    return norm(u.nome).indexOf(q) !== -1
        || norm(u.email).indexOf(q) !== -1
        || norm(u.posto_nome).indexOf(q) !== -1;
  });
  return filtrados.slice().sort((a, b) => (a.ativo === false ? 1 : 0) - (b.ativo === false ? 1 : 0));
}

function renderGerenciar() {
  const lista = document.getElementById('ti-u-lista');
  const contador = document.getElementById('ti-u-contador');
  const filtrados = filtrarGerenciar();
  if (contador) contador.textContent = filtrados.length + '/' + usuariosGerenciar.length;
  if (!filtrados.length) {
    if (lista) lista.innerHTML = '<div class="empty-state">Nenhum usuário.</div>';
    return;
  }
  const dis = podeEscrever() ? '' : ' disabled';
  const html = filtrados.map(u => {
    const nome = u.nome || '—';
    const inativo = u.ativo === false;
    const sub = (u.email || '') + (u.posto_nome ? ' · ' + u.posto_nome : '');
    const selo = inativo ? '<span class="ti-selo-inativo">inativo</span>' : '';
    return '' +
      '<div class="ti-user' + (inativo ? ' inativo' : '') + '">' +
        '<div class="ti-user-avatar">' + escapeHtml(iniciaisDe(nome)) + '</div>' +
        '<div class="ti-user-info">' +
          '<div class="ti-user-nome">' + selo + escapeHtml(nome) + '</div>' +
          '<div class="ti-user-meta">' +
            '<span class="ti-user-perfil">' + escapeHtml(u.perfil || '?') + '</span>' + escapeHtml(sub) +
          '</div>' +
        '</div>' +
        '<div class="ti-user-acoes">' +
          '<button class="ti-acao" type="button" data-act="editar" data-id="' + escapeHtml(u.id) + '" title="Editar"' + dis + '>✏️</button>' +
          '<button class="ti-acao" type="button" data-act="toggle" data-id="' + escapeHtml(u.id) + '" title="' + (inativo ? 'Reativar' : 'Desativar') + '"' + dis + '>' + (inativo ? '✓' : '⏻') + '</button>' +
          '<button class="ti-acao perigo" type="button" data-act="excluir" data-id="' + escapeHtml(u.id) + '" title="Excluir"' + dis + '>🗑️</button>' +
        '</div>' +
      '</div>';
  }).join('');
  if (lista) lista.innerHTML = html;
}

function preencherSelectPostos() {
  const sel = document.getElementById('f-posto');
  if (!sel) return;
  sel.innerHTML = '<option value="">— selecione —</option>' +
    postosLista.map(p => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.nome) + '</option>').join('');
}

function toggleGruposPorPerfil() {
  const sel = document.getElementById('f-perfil');
  const perfil = sel ? sel.value : 'GERENTE';
  const grpPosto = document.getElementById('f-grp-posto');
  const grpSuper = document.getElementById('f-grp-super');
  if (grpPosto) grpPosto.style.display = (perfil === 'GERENTE') ? 'block' : 'none';
  if (grpSuper) grpSuper.style.display = (perfil === 'SUPERVISOR') ? 'block' : 'none';
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
function getVal(id) { const el = document.getElementById(id); return el ? (el.value || '') : ''; }

function abrirModal(mode, user) {
  if (!podeEscrever()) { atualizarBloqueio(); return; }
  modalUserId = (mode === 'editar' && user) ? user.id : null;
  const title = document.getElementById('ti-modal-title');
  const sub = document.getElementById('ti-modal-sub');
  const hint = document.getElementById('f-senha-hint');
  const msg = document.getElementById('ti-modal-msg');
  if (msg) { msg.textContent = ''; msg.className = 'modal-msg'; }

  if (mode === 'editar' && user) {
    if (title) title.textContent = 'Editar usuário';
    if (sub) sub.textContent = 'Trocar titular = reescrever nome/e-mail/senha do mesmo perfil.';
    setVal('f-nome', user.nome); setVal('f-email', user.email);
    setVal('f-senha', ''); setVal('f-perfil', user.perfil || 'GERENTE');
    setVal('f-posto', user.posto_id || ''); setVal('f-super', user.supervisor || '');
    if (hint) hint.textContent = 'Deixe em branco para não alterar. Trocar a senha desconecta o usuário atual — ele entra com a nova.';
  } else {
    if (title) title.textContent = 'Novo usuário';
    if (sub) sub.textContent = 'Preencha os dados do usuário.';
    setVal('f-nome', ''); setVal('f-email', ''); setVal('f-senha', '');
    setVal('f-perfil', 'GERENTE'); setVal('f-posto', ''); setVal('f-super', '');
    if (hint) hint.textContent = 'Senha inicial do usuário (você define e informa a ele).';
  }
  toggleGruposPorPerfil();
  const modal = document.getElementById('ti-modal');
  if (modal) modal.classList.add('active');
}

function fecharModal() {
  const modal = document.getElementById('ti-modal');
  if (modal) modal.classList.remove('active');
  modalUserId = null;
}

function coletarForm() {
  const perfil = getVal('f-perfil') || 'GERENTE';
  return {
    nome:       getVal('f-nome').trim(),
    email:      getVal('f-email').trim(),
    senha:      getVal('f-senha'),
    perfil:     perfil,
    posto_id:   perfil === 'GERENTE'    ? (getVal('f-posto') || null) : null,
    supervisor: perfil === 'SUPERVISOR' ? (getVal('f-super').trim() || null) : null,
  };
}

// POST (novo) ou PUT (editar). senha vazia no editar = não altera.
async function salvarUsuario(payload, id) {
  if (!podeEscrever()) return { ok: false, bloqueado: true };
  const body = {
    nome:       payload.nome,
    email:      payload.email,
    perfil:     payload.perfil,
    posto_id:   payload.perfil === 'GERENTE'    ? (payload.posto_id || null) : null,
    supervisor: payload.perfil === 'SUPERVISOR' ? (payload.supervisor || null) : null,
  };
  if (payload.senha) body.senha = payload.senha;
  try {
    if (id) await apiFetch('/ti/usuario/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else    await apiFetch('/ti/usuario',       { method: 'POST', body: JSON.stringify(body) });
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

async function submitForm() {
  const msg = document.getElementById('ti-modal-msg');
  const payload = coletarForm();
  const editando = !!modalUserId;
  if (!payload.nome || !payload.email || !payload.perfil || (!editando && !payload.senha)) {
    if (msg) { msg.className = 'modal-msg err'; msg.style.display = 'block'; msg.textContent = 'Preencha nome, e-mail, perfil' + (editando ? '' : ' e senha') + '.'; }
    return;
  }
  const r = await salvarUsuario(payload, modalUserId);
  if (r.ok) {
    fecharModal();
    toast(editando ? 'Usuário atualizado.' : 'Usuário criado.');
    await carregarGerenciar(true);
  } else if (msg) {
    msg.className = 'modal-msg err'; msg.style.display = 'block';
    msg.textContent = r.bloqueado ? 'Bloqueado durante impersonação.' : (r.erro || 'Falha ao salvar.');
  }
}

// PATCH ativo (não confirma aqui — o caller confirma quando desativa).
async function setAtivo(id, ativo) {
  if (!podeEscrever()) return { ok: false, bloqueado: true };
  try {
    await apiFetch('/ti/usuario/' + id + '/ativo', { method: 'PATCH', body: JSON.stringify({ ativo: ativo }) });
  } catch (err) {
    return { ok: false, erro: err.message };
  }
  const u = usuariosGerenciar.find(x => x.id === id);
  if (u) u.ativo = ativo;
  renderGerenciar();
  return { ok: true };
}

function toggleAtivo(id) {
  const u = usuariosGerenciar.find(x => x.id === id);
  const novo = !(u && u.ativo);
  if (!novo) {
    if (!confirm('Desativar ' + (u ? u.nome : 'usuário') + '? Ele perde acesso ao login (o histórico é preservado).')) return;
  }
  return setAtivo(id, novo);
}

// DELETE com fallback: se o backend responder usuario_tem_historico,
// oferece Desativar no lugar.
async function excluirUsuario(id) {
  if (!podeEscrever()) return { ok: false, bloqueado: true };
  const u = usuariosGerenciar.find(x => x.id === id);
  if (!confirm('Excluir DEFINITIVAMENTE ' + (u ? u.nome : 'este usuário') + '? Use só para cadastro errado.')) {
    return { ok: false, cancelado: true };
  }
  try {
    await apiFetch('/ti/usuario/' + id, { method: 'DELETE' });
    toast('Usuário excluído.');
    await carregarGerenciar(true);
    return { ok: true };
  } catch (err) {
    if (err.message === 'usuario_tem_historico') {
      if (confirm('Este usuário tem lançamentos no histórico e não pode ser excluído. Deseja DESATIVAR (tira do login, preserva o histórico)?')) {
        const r = await setAtivo(id, false);
        return { ok: r.ok, historico: true, desativado: r.ok };
      }
      return { ok: false, historico: true };
    }
    alert('Falha ao excluir: ' + err.message);
    return { ok: false, erro: err.message };
  }
}

// ════════════════════════════════════════════════════════════════
// ABA "PENDÊNCIAS" (ti_itens — GET /ti/itens, PATCH /ti/itens/:id)
// ════════════════════════════════════════════════════════════════
async function carregarItens(force) {
  if (itensCarregado && !force) { renderItens(); return itens; }
  const lista = document.getElementById('ti-it-lista');
  try {
    const resp = await apiFetch('/ti/itens?todos=1');
    itens = (resp && resp.itens) || [];
    itContagem = (resp && resp.contagem) || {};
    itensCarregado = true;
  } catch (err) {
    if (lista) lista.innerHTML = '<div class="empty-state">⚠ Falha ao carregar: ' + escapeHtml(err.message) + '</div>';
    return itens;
  }
  renderItens();
  return itens;
}

function renderItens() {
  // KPIs clicáveis — filtram por status. "Abertos" (novo+em_analise) é o padrão.
  const kpis = document.getElementById('ti-it-kpis');
  if (kpis) {
    const c = itContagem || {};
    const abertos = (Number(c.novo) || 0) + (Number(c.em_analise) || 0);
    const box = (st, num, lbl) =>
      '<button class="ti-it-kpi' + (itStatus === st ? ' on' : '') + '" type="button" data-st="' + st + '">' +
        '<div class="ti-it-kpi-num">' + (Number(num) || 0) + '</div>' +
        '<div class="ti-it-kpi-lbl">' + lbl + '</div>' +
      '</button>';
    kpis.innerHTML =
      box('abertos', abertos, 'Abertos') +
      box('novo', c.novo, 'Novos') +
      box('em_analise', c.em_analise, 'Em análise') +
      box('resolvido', c.resolvido, 'Resolvidos') +
      box('ignorado', c.ignorado, 'Ignorados');
  }

  // Filtros — todos, alta (severidade), e uma pílula por categoria distinta.
  const filtrosEl = document.getElementById('ti-it-filtros');
  if (filtrosEl) {
    const cats = [];
    (itens || []).forEach(i => {
      if (i.categoria && cats.indexOf(i.categoria) === -1) cats.push(i.categoria);
    });
    cats.sort((a, b) => String(a).localeCompare(String(b)));
    const defs = [{ f: 'todos', lbl: 'Todos' }, { f: 'alta', lbl: 'Alta' }]
      .concat(cats.map(cat => ({ f: 'cat:' + cat, lbl: cat })));
    filtrosEl.innerHTML = defs.map(d =>
      '<button class="ti-it-chip' + (itFiltro === d.f ? ' on' : '') + '" type="button" data-f="' + escapeHtml(d.f) + '">' + escapeHtml(d.lbl) + '</button>'
    ).join('');
  }

  // Lista — aplica itStatus E itFiltro juntos.
  const lista = document.getElementById('ti-it-lista');
  if (!lista) return;
  const filtrados = (itens || []).filter(i => {
    // status
    if (itStatus === 'abertos') {
      if (i.status !== 'novo' && i.status !== 'em_analise') return false;
    } else if (i.status !== itStatus) {
      return false;
    }
    // severidade / categoria
    if (itFiltro === 'alta') return i.severidade === 'alta';
    if (itFiltro.indexOf('cat:') === 0) return i.categoria === itFiltro.slice(4);
    return true;   // 'todos'
  });
  if (!filtrados.length) {
    const msg = (itStatus === 'resolvido') ? 'Nenhum item resolvido ainda.'
              : (itStatus === 'ignorado')  ? 'Nenhum item ignorado.'
              : 'Nada aberto neste filtro.';
    lista.innerHTML = '<div class="empty-state">' + msg + '</div>';
    return;
  }
  const dis = podeEscrever() ? '' : ' disabled';
  lista.innerHTML = filtrados.map(i => {
    const sevCls = (i.severidade === 'alta') ? 'ti-it-alta'
                 : (i.severidade === 'baixa') ? 'ti-it-baixa' : 'ti-it-media';
    const cat  = i.categoria ? '<span class="ti-it-cat">' + escapeHtml(i.categoria) + '</span>' : '';
    const selo = (i.status === 'em_analise') ? '<span class="ti-it-cat">em análise</span>' : '';
    const det  = i.detalhe ? '<div class="ti-it-det">' + escapeHtml(i.detalhe) + '</div>' : '';
    const btn = (st, lbl, extra) =>
      '<button class="ti-it-btn' + (extra ? ' ' + extra : '') + '" type="button" data-id="' + escapeHtml(i.id) + '" data-st="' + st + '"' + dis + '>' + lbl + '</button>';
    // Ações conforme o status atual do item.
    let acoes;
    if (i.status === 'novo') {
      acoes = btn('em_analise', 'Em análise') + btn('resolvido', 'Resolver') + btn('ignorado', 'Ignorar');
    } else if (i.status === 'em_analise') {
      acoes = btn('resolvido', 'Resolver') + btn('ignorado', 'Ignorar') + btn('novo', 'Reabrir', 'reabrir');
    } else {
      // resolvido / ignorado
      acoes = btn('novo', 'Reabrir', 'reabrir');
    }
    return '' +
      '<div class="ti-it ' + sevCls + '">' +
        '<div class="ti-it-titulo">' + escapeHtml(i.titulo || '—') + '</div>' +
        '<div>' + cat + selo + '</div>' +
        det +
        '<div class="ti-it-acoes">' + acoes + '</div>' +
      '</div>';
  }).join('');
}

// PATCH status. Recarrega do servidor (lista + contagem) em vez de mexer no
// array local — a contagem é responsabilidade do backend.
async function mudarStatusItem(id, status) {
  if (!id || !status) return;
  if (!podeEscrever()) return;
  try {
    await apiFetch('/ti/itens/' + id, { method: 'PATCH', body: JSON.stringify({ status: status }) });
  } catch (err) {
    alert('Falha ao atualizar item: ' + err.message);
    return;
  }
  await carregarItens(true);
}

// Expostos p/ onclick do HTML e p/ o harness de testes.
window.toggleTheme       = toggleTheme;
window.entrarComo        = entrarComo;
window.aplicarFiltros    = aplicarFiltros;
window.carregarUsuarios  = carregarUsuarios;
window.renderLista       = renderLista;
window.switchTab         = switchTab;
window.estaImpersonando  = estaImpersonando;
window.podeEscrever      = podeEscrever;
window.carregarGerenciar = carregarGerenciar;
window.filtrarGerenciar  = filtrarGerenciar;
window.renderGerenciar   = renderGerenciar;
window.salvarUsuario     = salvarUsuario;
window.excluirUsuario    = excluirUsuario;
window.setAtivo          = setAtivo;
window.abrirModal        = abrirModal;
window.atualizarBloqueio = atualizarBloqueio;
window.carregarItens     = carregarItens;
window.renderItens       = renderItens;
window.mudarStatusItem   = mudarStatusItem;
// Movimentação do dia. `mvPintar` existe para o harness de render poder
// injetar um payload sem servidor e sem sessão — é o único jeito de testar
// as telas do TI, que exigem login. Não é usado pela aba.
window.mvCarregar        = mvCarregar;
window.ontemLocal        = ontemLocal;
window.ligarControlesMov = ligarControlesMov;
window.mvPintar          = function (payload) { _mvDado = payload; _mvFrentTodos = false; mvRender(); };

// ════════════════════════════════════════════════════════════════
// ABA API TecnoX — diagnóstico da sonda (POST /tecnox/sonda executa+grava;
// GET /tecnox/sondas lê o histórico). Ao abrir carrega SÓ o histórico (rápido);
// a sonda (30–60s) só no clique. Reusa escapeHtml/apiFetch globais.
// ════════════════════════════════════════════════════════════════
let _txPostos = [];
let _txHist = [];
let _txSonda = null;      // sonda mostrada nas tabelas de campos/soma
let _txSondaIdx = 0;      // índice dela no histórico (p/ destacar a linha)
let _txConsultando = false;
// Campos que ESPERAMOS: se não vierem, aparecem como "falta" (senão o ausente
// fica invisível — o oposto do objetivo). São campos de ITEM.
const TX_ESPERADOS = { vendas: ['qtd_item', 'formaPagamento', 'indiceCombustivel'], compras: [] };

function txDataHora(iso) {
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return String(iso || ''); }
}
function txBRL(n) { return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function txMsg(txt, tipo) {
  const el = document.getElementById('tx-msg'); if (!el) return;
  if (!txt) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = ''; el.textContent = txt;
  el.className = 'tx-msg ' + (tipo === 'erro' ? 'tx-msg-erro' : 'tx-msg-ok');
}

function ligarControlesTecnox() {
  const btn = document.getElementById('tx-btn');
  if (btn) btn.addEventListener('click', txConsultar);
  const selP = document.getElementById('tx-posto');
  if (selP) selP.addEventListener('change', txCarregarHistorico);
  const selT = document.getElementById('tx-tipo');
  if (selT) selT.addEventListener('change', txCarregarHistorico);
  const hist = document.getElementById('tx-hist');
  if (hist) hist.addEventListener('click', (e) => {
    const row = e.target.closest ? e.target.closest('.tx-hist-row') : null;
    if (!row) return;
    const idx = parseInt(row.getAttribute('data-idx'), 10);
    if (!Number.isInteger(idx) || !_txHist[idx]) return;
    _txSondaIdx = idx; _txSonda = _txHist[idx];
    txRenderHistorico(); txRenderCampos(); txRenderSoma();
  });
}

function txAoAbrir() {
  rxCarregar();                               // saúde do rollup: 1 consulta, rápida
  if (!_txPostos.length) txCarregarPostos();  // carrega postos e, ao fim, histórico + movimentação
  else {
    txCarregarHistorico();
    // Movimentação só na PRIMEIRA abertura: reabrir a aba não muda o rollup,
    // e recarregar apagaria o "mostrar todos" que a pessoa já expandiu.
    if (!_mvDado) mvCarregar();
  }
}

// ════════════════════════════════════════════════════════════════
// SAÚDE DO ROLLUP NOTURNO — lê GET /rollup/execucoes.
// O veredito (ok / alerta / sem_rodada) vem PRONTO da API: a mesma regra
// serviria um alerta por push depois, e duas cópias dela divergiriam na
// primeira mudança. Aqui só se pinta o que o servidor decidiu.
// ════════════════════════════════════════════════════════════════
async function rxCarregar() {
  const elS = document.getElementById('rx-saude');
  const elR = document.getElementById('rx-reincidentes');
  const elH = document.getElementById('rx-hist');
  const elQ = document.getElementById('rx-quando');
  if (!elS) return;
  try {
    const resp = await apiFetch('/rollup/execucoes?limite=14');
    const s = resp.saude || {}, execs = resp.execucoes || [], reinc = resp.reincidentes || [];

    const cor = s.estado === 'ok' ? 'var(--ok)' : 'var(--danger)';
    const icone = s.estado === 'ok' ? '✅' : (s.estado === 'sem_rodada' ? '🚨' : '⚠️');
    const titulo = s.estado === 'ok' ? 'Rollup em dia'
                 : s.estado === 'sem_rodada' ? 'O rollup NÃO rodou'
                 : 'Rollup rodou com falha';

    elS.innerHTML =
      '<div style="display:flex;gap:.6rem;align-items:flex-start;padding:.7rem .8rem;border-radius:8px;' +
      'border-left:3px solid ' + cor + ';background:color-mix(in srgb,' + cor + ' 10%,transparent)">' +
        '<span style="font-size:1.1rem;line-height:1.2">' + icone + '</span>' +
        '<div>' +
          '<div style="font-weight:600;color:' + cor + '">' + escapeHtml(titulo) + '</div>' +
          '<div style="font-size:.78rem;color:var(--text2);margin-top:.15rem">' + escapeHtml(s.motivo || '') + '</div>' +
        '</div>' +
      '</div>';

    if (elQ) elQ.textContent = s.horas_desde_ultima == null ? 'nunca rodou'
      : ('há ' + s.horas_desde_ultima + 'h');

    // Reincidentes: posto que falhou em mais de uma das 14 rodadas. Um posto que
    // trava toda semana aparece como "1 posto" em cada noite isolada e some no
    // ruído — só o acumulado mostra o padrão.
    if (elR) elR.innerHTML = !reinc.length ? '' :
      '<div style="margin-top:.8rem">' +
        '<div style="font-size:.72rem;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.35rem">' +
          'Postos que falharam mais de uma vez nas últimas 14 rodadas</div>' +
        reinc.map(p =>
          '<div style="display:flex;gap:.5rem;font-size:.8rem;padding:.25rem 0;border-bottom:1px solid var(--border)">' +
            '<span style="font-weight:600;min-width:11rem">' + escapeHtml(p.posto) + '</span>' +
            '<span style="color:var(--danger);font-family:var(--mono)">' + p.vezes + '×</span>' +
            '<span style="color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
              escapeHtml(p.ultimo_erro || '') + '</span>' +
          '</div>').join('') +
      '</div>';

    if (elH) elH.innerHTML = !execs.length ? '' :
      '<div style="margin-top:.8rem;overflow-x:auto">' +
        '<table style="width:100%;border-collapse:collapse;font-size:.76rem">' +
        '<thead><tr style="color:var(--text3);text-align:left">' +
          ['quando', 'janela', 'ok', 'falha', 'sem venda', 'recuperados']
            .map(h => '<th style="padding:.3rem .5rem;font-weight:500">' + h + '</th>').join('') +
        '</tr></thead><tbody>' +
        execs.map(e => {
          const morreu = !e.fim;
          return '<tr style="border-top:1px solid var(--border)">' +
            '<td style="padding:.3rem .5rem;font-family:var(--mono)">' + escapeHtml(txDataHora(e.inicio)) +
              (morreu ? ' <span style="color:var(--danger)">(não fechou)</span>' : '') + '</td>' +
            '<td style="padding:.3rem .5rem;font-family:var(--mono);color:var(--text3)">' +
              escapeHtml(String(e.data_de)) + ' .. ' + escapeHtml(String(e.data_ate)) + '</td>' +
            '<td style="padding:.3rem .5rem;font-family:var(--mono)">' + (e.pares_ok || 0) + '/' + (e.pares_alvo || 0) + '</td>' +
            '<td style="padding:.3rem .5rem;font-family:var(--mono);color:' +
              (e.pares_falha > 0 ? 'var(--danger)' : 'var(--text3)') + '">' + (e.pares_falha || 0) + '</td>' +
            '<td style="padding:.3rem .5rem;font-family:var(--mono);color:var(--text3)">' + (e.pares_sem_dado || 0) + '</td>' +
            '<td style="padding:.3rem .5rem;font-family:var(--mono);color:' +
              (e.pares_recuperados > 0 ? 'var(--warning)' : 'var(--text3)') + '">' + (e.pares_recuperados || 0) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>';
  } catch (err) {
    // Tabela ainda não criada (sql/rollup_execucoes.sql não aplicado) cai aqui.
    // Falha de leitura da saúde NÃO pode passar por "está tudo bem".
    elS.innerHTML = '<div class="empty-state" style="color:var(--danger)">' +
      'Não foi possível ler a saúde do rollup: ' + escapeHtml(err.message || String(err)) + '</div>';
    if (elR) elR.innerHTML = '';
    if (elH) elH.innerHTML = '';
  }
}

// UM fetch de /postos serve os DOIS seletores da aba, com listas diferentes
// de propósito: a sonda precisa de CNPJ (é o parâmetro da API da TecnoX) e
// filtra por ele; a movimentação lê o rollup, que é chaveado por posto_id, e
// por isso não filtra — um posto sem CNPJ cadastrado teria sonda impossível
// mas movimentação normal, e escondê-lo aqui seria esconder venda.
async function txCarregarPostos() {
  const sel = document.getElementById('tx-posto');
  const selMv = document.getElementById('mv-posto');
  try {
    const resp = await apiFetch('/postos');
    const todos = (resp.postos || []).slice()
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    _txPostos = todos.filter(p => p.cnpj && String(p.cnpj).trim());
    if (sel) sel.innerHTML = _txPostos.length
      ? _txPostos.map(p => '<option value="' + escapeHtml(p.cnpj) + '">' + escapeHtml(p.nome) + '</option>').join('')
      : '<option value="">Nenhum posto com CNPJ</option>';
    if (selMv) selMv.innerHTML = todos.length
      ? todos.map(p => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.nome) + '</option>').join('')
      : '<option value="">Nenhum posto ativo</option>';
    const inp = document.getElementById('tx-data');   // default: ontem
    if (inp && !inp.value) inp.value = ontemLocal();
    const inpMv = document.getElementById('mv-data');
    if (inpMv && !inpMv.value) inpMv.value = ontemLocal();
    txCarregarHistorico();
    mvCarregar();
  } catch (err) {
    if (sel) sel.innerHTML = '<option value="">Erro ao carregar postos</option>';
    if (selMv) selMv.innerHTML = '<option value="">Erro ao carregar postos</option>';
  }
}

// Ontem no fuso de QUEM OLHA, montado campo por campo. Serve os DOIS campos
// de data da aba (sonda e movimentação).
//
// `toISOString()` NÃO serve, e era o que os dois usavam: ele converte para
// UTC, e depois das 21h de Brasília o UTC já está no dia seguinte — então
// "ontem" saía como HOJE. É o mesmo bug de fuso que o teste-medicao-fuso.js
// documentou na API, do outro lado do sistema. As duas telas erravam junto:
// a sonda pedia à TecnoX um dia que ainda está acontecendo, e a movimentação
// abriria em "sem dado" porque o rollup noturno não coletou hoje.
function ontemLocal() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

async function txCarregarHistorico() {
  const cnpj = (document.getElementById('tx-posto') || {}).value || '';
  const tipo = (document.getElementById('tx-tipo') || {}).value || 'vendas';
  const hist = document.getElementById('tx-hist');
  const cont = document.getElementById('tx-hist-cont');
  if (!cnpj) { if (hist) hist.innerHTML = '<div class="empty-state">Selecione um posto.</div>'; return; }
  try {
    const resp = await apiFetch('/tecnox/sondas?cnpj=' + encodeURIComponent(cnpj) + '&tipo=' + encodeURIComponent(tipo) + '&limite=10');
    _txHist = resp.sondas || [];
    _txSondaIdx = 0;
    _txSonda = _txHist[0] || null;
    if (cont) cont.textContent = _txHist.length + ' sonda(s)';
    txRenderDiff();
    txRenderCampos();
    txRenderSoma();
    txRenderHistorico();
  } catch (err) {
    if (hist) hist.innerHTML = '<div class="empty-state">Erro ao carregar histórico: ' + escapeHtml(err.message || '') + '</div>';
  }
}

async function txConsultar() {
  if (_txConsultando) return;
  const cnpj = (document.getElementById('tx-posto') || {}).value || '';
  const data = (document.getElementById('tx-data') || {}).value || '';
  const tipo = (document.getElementById('tx-tipo') || {}).value || 'vendas';
  if (!cnpj) { txMsg('Selecione um posto.', 'erro'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { txMsg('Selecione uma data.', 'erro'); return; }
  const btn = document.getElementById('tx-btn');
  _txConsultando = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando… (até 60s)'; }
  txMsg('', '');
  try {
    await apiFetch('/tecnox/sonda', { method: 'POST', body: JSON.stringify({ tipo, cnpj, data }) });
    txMsg('Sonda executada e gravada.', 'ok');
  } catch (err) {
    // A rota grava a falha mesmo assim (histórico de indisponibilidade).
    txMsg('Falha na sonda: ' + (err.message || err) + ' — registrada no histórico.', 'erro');
  } finally {
    _txConsultando = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Consultar e salvar'; }
    await txCarregarHistorico();   // recarrega: mostra a nova sonda (sucesso OU falha)
  }
}

// Mapa campo → "chega?" (preenchidos > 0), unindo capa + itens de uma sonda.
function txMapaChega(sonda) {
  const m = {};
  const c = (sonda && sonda.campos) || {};
  const todos = [].concat(Array.isArray(c.capa) ? c.capa : [], Array.isArray(c.itens) ? c.itens : []);
  todos.forEach(r => { if (r && r.campo) m[r.campo] = (Number(r.preenchidos) || 0) > 0; });
  return m;
}

// Faixa de comparativo entre as 2 sondas mais recentes (só o que MUDOU).
function txRenderDiff() {
  const el = document.getElementById('tx-diff'); if (!el) return;
  el.innerHTML = '';
  if (_txHist.length < 2) return;
  const atual = _txHist[0], anterior = _txHist[1];
  if (atual.tipo !== anterior.tipo) return;  // só compara sondas do MESMO tipo (vendas×vendas, compras×compras)
  if (atual.erro || anterior.erro) return;   // não compara contra sonda que falhou
  const cAt = txMapaChega(atual), cAn = txMapaChega(anterior);
  const nomes = new Set([].concat(Object.keys(cAt), Object.keys(cAn)));
  const linhas = [];
  nomes.forEach(nome => {
    const antes = !!cAn[nome], agora = !!cAt[nome];
    if (!antes && agora) linhas.push('<div class="tx-diff-add">' + escapeHtml(nome) + ' passou a chegar</div>');
    else if (antes && !agora) linhas.push('<div class="tx-diff-rem">' + escapeHtml(nome) + ' parou de chegar</div>');
  });
  if (!linhas.length) return;   // nada mudou → sem faixa
  el.innerHTML = '<div class="tx-diff-wrap">' + linhas.join('') + '</div>';
}

function txLinhaCampo(campo, preench, zeros, exemplo, status) {
  const ex = (exemplo === null || exemplo === undefined) ? '—'
    : escapeHtml(typeof exemplo === 'object' ? JSON.stringify(exemplo) : String(exemplo));
  return '<tr' + (status === 'falta' ? ' class="tx-row-falta"' : '') + '>' +
    '<td class="tx-campo">' + escapeHtml(campo) + '</td>' +
    '<td class="tx-num">' + preench + '</td>' +
    '<td class="tx-num">' + zeros + '</td>' +
    '<td class="tx-ex">' + ex + '</td>' +
    '<td><span class="tx-st tx-st-' + status + '">' + status + '</span></td>' +
  '</tr>';
}
function txTabelaCampos(rows, esperados) {
  const arr = Array.isArray(rows) ? rows : [];
  const presentes = new Set(arr.map(r => r.campo));
  const linhas = arr.map(r => txLinhaCampo(r.campo, r.preenchidos || 0, r.zeros || 0, r.exemplo,
    (Number(r.preenchidos) || 0) > 0 ? 'chega' : 'vazio'));
  (esperados || []).forEach(nome => {   // esperado ausente → "falta" (no topo, pra destacar)
    if (!presentes.has(nome)) linhas.unshift(txLinhaCampo(nome, 0, 0, null, 'falta'));
  });
  if (!linhas.length) return '<div class="empty-state">Sem campos.</div>';
  return '<div class="tx-tbl-wrap"><table class="tx-tbl"><thead><tr>' +
    '<th>Campo</th><th class="tx-num">Preench.</th><th class="tx-num">Zeros</th><th>Exemplo</th><th>Status</th>' +
    '</tr></thead><tbody>' + linhas.join('') + '</tbody></table></div>';
}

function txRenderCampos() {
  const el = document.getElementById('tx-campos'); if (!el) return;
  const s = _txSonda;
  if (!s) { el.innerHTML = ''; return; }
  if (s.erro) {
    el.innerHTML = '<div class="section"><div class="section-body"><div class="tx-falhou">Sonda falhou: ' +
      escapeHtml(s.erro) + ' — sem inventário de campos.</div></div></div>';
    return;
  }
  const campos = s.campos || {};
  const esperados = TX_ESPERADOS[s.tipo] || [];
  el.innerHTML =
    '<div class="section"><div class="section-header"><span class="section-icon">🧾</span>' +
      '<span class="section-title">Campos — Capa</span></div>' +
      '<div class="section-body">' + txTabelaCampos(campos.capa, []) + '</div></div>' +
    '<div class="section"><div class="section-header"><span class="section-icon">📦</span>' +
      '<span class="section-title">Campos — Itens</span></div>' +
      '<div class="section-body">' + txTabelaCampos(campos.itens, esperados) + '</div></div>';
}

function txRenderSoma() {
  const el = document.getElementById('tx-soma'); if (!el) return;
  const s = _txSonda;
  if (!s || s.erro) { el.innerHTML = ''; return; }
  const soma = Array.isArray(s.soma_por_item) ? s.soma_por_item : [];
  if (!soma.length) { el.innerHTML = ''; return; }
  const semLitros = soma.every(x => !(Number(x.qtd) > 0));
  const linhas = soma.map(x =>
    '<tr><td class="tx-campo">' + escapeHtml(x.descricao) + '</td>' +
    '<td class="tx-num">' + (x.itens || 0) + '</td>' +
    '<td class="tx-num">' + txBRL(x.bruto) + '</td>' +
    '<td class="tx-num">' + txBRL(x.desconto) + '</td>' +
    '<td class="tx-num">' + txBRL(x.valor) + '</td></tr>').join('');
  el.innerHTML =
    '<div class="section"><div class="section-header"><span class="section-icon">⛽</span>' +
      '<span class="section-title">Faturamento por combustível</span></div>' +
      '<div class="section-body"><div class="tx-tbl-wrap"><table class="tx-tbl"><thead><tr>' +
        '<th>Combustível</th><th class="tx-num">Itens</th><th class="tx-num">Bruto</th>' +
        '<th class="tx-num">Desconto</th><th class="tx-num">Líquido</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      (semLitros ? '<div class="tx-nota">litros indisponíveis — a API não devolve quantidade</div>' : '') +
    '</div></div>';
}

// ════════════════════════════════════════════════════════════════
// MOVIMENTAÇÃO DO DIA — camada 1 da auditoria por posto.
// Lê GET /tecnox/movimentacao, que agrega o ROLLUP (tecnox_venda_dia +
// tecnox_venda_produto_dia + tecnox_venda_dim_dia). NÃO chama a API da
// TecnoX: responde em milissegundos, e é por isso que não há botão
// "consultar" — recarrega ao trocar posto ou data.
//
// A TELA NÃO CALCULA NADA. Rótulo de combustível, nome de forma de
// pagamento, ressalva do cartão genérico, ordem dos turnos e a marca de
// contagem aproximada vêm PRONTOS da rota — mesmo desenho do card de saúde
// do rollup ("aqui só se pinta o que o servidor decidiu"). Duas cópias da
// regra divergiriam na primeira mudança.
// ════════════════════════════════════════════════════════════════
let _mvCarregando = false;
let _mvDado = null;
let _mvFrentTodos = false;      // quebra de frentista expandida?
// Num intervalo longo a lista de frentistas cresce com a rotação do posto.
// Abaixo do GATILHO lista tudo — cortar uma lista de 22 nomes só esconderia
// dado sem ganho de leitura. Acima, mostra os MAIORES e agrupa o resto numa
// linha só, que continua clicável para abrir.
const MV_FRENT_GATILHO = 30;
const MV_FRENT_TOPO = 20;

// Formatadores. Nos cards e nas linhas o litro vai SEM decimal e o real SEM
// centavo de propósito: em 375px "26.954,988 L" e "R$ 166.282,98" estouram a
// largura da célula e quebram no meio do número. A precisão cheia continua no
// payload — a tela é de leitura, não de conferência contábil.
function mvInt(n)  { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function mvBRL0(n) { return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
// Percentual com casa ADAPTATIVA: abaixo de 1% vai com duas casas. Com uma
// casa fixa, uma forma de pagamento de 0,03% e uma de 0,14% viravam as duas
// "0,0%" e "0,1%" — e um desconto de R$ 53 em R$ 163 mil aparecia como
// "0,0% do bruto", que lê como zero.
function mvPct(n) {
  if (n == null) return '—';
  const casas = Math.abs(Number(n)) < 1 ? 2 : 1;
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}
function mvMsg(txt, tipo) {
  const el = document.getElementById('mv-msg'); if (!el) return;
  if (!txt) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = ''; el.textContent = txt;
  el.className = 'tx-msg ' + (tipo === 'erro' ? 'tx-msg-erro' : 'tx-msg-ok');
}

const mvMet = (valor, unid, cls) =>
  '<span class="mv-met' + (cls ? ' ' + cls : '') + '"><b>' + valor + '</b>' +
  (unid ? ' ' + escapeHtml(unid) : '') + '</span>';

// Uma linha de quebra. `pct` desenha a barra de fundo; null = sem barra.
// O badge do código é omitido quando ele É o nome: combustível que o rollup
// não mapeou vem com codigo === rotulo (a descrição crua), e mostrar os dois
// dava "GAS NATURAL VEICULARGAS NATURAL VEICULAR" na linha.
function mvRow(nome, cod, mets, pct) {
  const larg = (pct != null && pct > 0) ? Math.min(100, Number(pct)) : 0;
  const badge = (cod && String(cod) !== String(nome))
    ? '<span class="mv-cod">' + escapeHtml(cod) + '</span>' : '';
  return '<div class="mv-row">' +
    (larg ? '<div class="mv-bar" style="width:' + larg.toFixed(2) + '%"></div>' : '') +
    '<span class="mv-nome">' + badge + escapeHtml(nome) + '</span>' +
    '<span class="mv-mets">' + mets.join('') + '</span>' +
  '</div>';
}
function mvBloco(titulo, contagem, legenda, corpo, extra) {
  return '<div class="mv-bloco">' +
    '<div class="mv-bloco-tit">' + escapeHtml(titulo) +
      (contagem ? '<span class="mv-bloco-cont">' + escapeHtml(contagem) + '</span>' : '') + '</div>' +
    (legenda ? '<div class="mv-legenda">' + legenda + '</div>' : '') +
    corpo + (extra || '') +
  '</div>';
}
// Marca de contagem aproximada. cupons_exato=false quer dizer que o grupo
// somou mais de um combustível, e aí o mesmo cupom pode estar em dois Sets.
const mvCup = (r) => (r.cupons_exato ? '' : '~') + mvInt(r.cupons_aprox);

// Mostra o par de campos do recorte escolhido. Ao entrar no intervalo pela
// primeira vez, semeia de/até com a semana que termina na data já escolhida —
// abrir com os dois campos vazios obrigaria dois cliques antes de ver algo.
function mvAplicarModo(semear) {
  const modo = (document.getElementById('mv-modo') || {}).value || 'dia';
  const fData = document.getElementById('mv-f-data');
  const fDe = document.getElementById('mv-f-de');
  const fAte = document.getElementById('mv-f-ate');
  if (fData) fData.hidden = modo !== 'dia';
  if (fDe) fDe.hidden = modo !== 'periodo';
  if (fAte) fAte.hidden = modo !== 'periodo';
  if (modo === 'periodo' && semear) {
    const inpDe = document.getElementById('mv-de');
    const inpAte = document.getElementById('mv-ate');
    const base = (document.getElementById('mv-data') || {}).value || ontemLocal();
    if (inpAte && !inpAte.value) inpAte.value = base;
    if (inpDe && !inpDe.value) {
      const d = new Date(base + 'T12:00:00');   // meio-dia: imune a fuso
      d.setDate(d.getDate() - 7);
      inpDe.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                    '-' + String(d.getDate()).padStart(2, '0');
    }
  }
  return modo;
}

function ligarControlesMov() {
  ['mv-posto', 'mv-data', 'mv-de', 'mv-ate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { _mvFrentTodos = false; mvCarregar(); });
  });
  const selModo = document.getElementById('mv-modo');
  if (selModo) selModo.addEventListener('change', () => {
    _mvFrentTodos = false;
    mvAplicarModo(true);
    mvCarregar();
  });
  // Delegação: os dois alvos são recriados a cada render.
  const corpo = document.getElementById('mv-corpo');
  if (corpo) corpo.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    if (e.target.closest('#mv-frent-mais')) { _mvFrentTodos = true; mvRender(); return; }
    // Clicar num dia da lista de sinais TROCA O FILTRO para aquele dia. É o
    // caminho do resumo para o detalhe: no intervalo a faixa só diz quais dias
    // acenderam, e o detalhe completo é o que a tela de dia único já mostra.
    const dia = e.target.closest('.mv-dia-sinal');
    if (dia) {
      const d = dia.getAttribute('data-dia');
      if (!d) return;
      const selM = document.getElementById('mv-modo');
      const inpD = document.getElementById('mv-data');
      if (selM) selM.value = 'dia';
      if (inpD) inpD.value = d;
      _mvFrentTodos = false;
      mvAplicarModo(false);
      mvCarregar();
    }
  });
}

async function mvCarregar() {
  const el = document.getElementById('mv-corpo'); if (!el) return;
  const posto_id = (document.getElementById('mv-posto') || {}).value || '';
  const modo = mvAplicarModo(false);
  const reData = /^\d{4}-\d{2}-\d{2}$/;
  let qs;
  if (modo === 'periodo') {
    const de = (document.getElementById('mv-de') || {}).value || '';
    const ate = (document.getElementById('mv-ate') || {}).value || '';
    if (!posto_id || !reData.test(de) || !reData.test(ate)) {
      el.innerHTML = '<div class="empty-state">Selecione posto e o intervalo.</div>';
      return;
    }
    qs = '&de=' + encodeURIComponent(de) + '&ate=' + encodeURIComponent(ate);
  } else {
    const data = (document.getElementById('mv-data') || {}).value || '';
    if (!posto_id || !reData.test(data)) {
      el.innerHTML = '<div class="empty-state">Selecione posto e data.</div>';
      return;
    }
    qs = '&data=' + encodeURIComponent(data);
  }
  if (_mvCarregando) return;
  _mvCarregando = true;
  mvMsg('', '');
  el.innerHTML = '<div class="empty-state">Carregando…</div>';
  try {
    _mvDado = await apiFetch('/tecnox/movimentacao?posto_id=' + encodeURIComponent(posto_id) + qs);
    mvRender();
  } catch (err) {
    _mvDado = null;
    el.innerHTML = '';
    mvMsg('Não foi possível ler a movimentação: ' + (err.message || err), 'erro');
  } finally {
    _mvCarregando = false;
  }
}

function mvRender() {
  const el = document.getElementById('mv-corpo'); if (!el) return;
  const d = _mvDado;
  if (!d) { el.innerHTML = ''; return; }

  // Dia sem rollup. É a MESMA marca que o cron usa como retomada (ausência de
  // linha em tecnox_venda_dia), então dizer "sem dado" aqui não é a tela
  // desistindo: é o estado real da coleta daquele par posto/dia.
  const periodo = d.consulta.modo === 'periodo';
  const quando = periodo
    ? mvDataBR(d.consulta.de) + ' a ' + mvDataBR(d.consulta.ate)
    : mvDataBR(d.consulta.data || d.consulta.de);

  if (!d.tem_dado) {
    el.innerHTML = '<div class="empty-state">Sem dado para ' + (periodo ? 'este intervalo' : 'esta data') + '.<br>' +
      '<span style="font-size:.74rem;color:var(--text3)">O rollup não tem venda de ' +
      escapeHtml(d.consulta.posto_nome) + ' em ' + escapeHtml(quando) +
      '. Confira a saúde do rollup noturno acima.</span></div>';
    return;
  }

  // No intervalo, DIAS COM DADO não é o mesmo que dias pedidos: o rollup só
  // tem 19 dias hoje, então pedir 01/01 a 08/09 soma 19 e não 251. Sem dizer
  // isso, o total pareceria de oito meses.
  const dd = d.periodo ? d.periodo.dias_com_dado : 1;
  const escopo = '<div class="mv-escopo"><b>' + escapeHtml(d.consulta.posto_nome) + '</b> · ' +
    escapeHtml(quando) +
    (periodo ? ' · <b>' + dd + '</b> dia' + (dd > 1 ? 's' : '') + ' com dado no rollup' +
      (d.periodo && d.periodo.primeiro !== d.consulta.de
        ? ' (de ' + escapeHtml(mvDataBR(d.periodo.primeiro)) + ' a ' + escapeHtml(mvDataBR(d.periodo.ultimo)) + ')'
        : '')
      : '') + '</div>';

  el.innerHTML = escopo + mvSinais(d) + mvCards(d) + mvBlocoComb(d) + mvBlocoTurno(d) +
                 mvBlocoPagamento(d) + mvBlocoFrentista(d) + mvBlocoCanal(d);
}

// ── Faixa de sinais (camada 2) ──
// Quem decide o que é sinal, de que nível e contra qual referência é a rota
// (movSinais no server.js). Aqui só se formata número e se escolhe a cor —
// mesma divisão da camada 1. Um limiar duplicado aqui divergiria do backend
// na primeira calibragem, e a tela passaria a discordar do que ela própria
// mostra como "esperado".
function mvValorSinal(n, unidade) {
  if (n == null) return '—';
  return unidade === 'rs_litro'
    ? 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + '/L'
    : mvPct(n);
}
function mvSinais(d) {
  const s = d.sinais;
  // Payload de antes da camada 2 (ou rota velha em cache): não inventa faixa.
  if (!s) return '';
  if (s.por_dia) return mvSinaisPeriodo(s);

  const itens = (s.itens || []).map(x => {
    const ic = x.nivel === 'vermelho' ? '🔴' : '🟡';
    // O ESPERADO VEM SEMPRE JUNTO DO MEDIDO, na mesma linha. Um número
    // sozinho ("desconto 3,10%") não diz se é muito — só ao lado do normal
    // daquele posto ele vira informação.
    const esp = (x.esperado_min != null && x.esperado_max != null && x.tipo === 'MARGEM')
      ? mvValorSinal(x.esperado_min, x.unidade) + ' a ' + mvValorSinal(x.esperado_max, x.unidade)
      : mvValorSinal(x.esperado, x.unidade);
    const rs = (x.medido_rs != null && x.unidade === 'pct') ? ' (' + txBRL(x.medido_rs) + ')' : '';
    return '<div class="mv-sinal ' + x.nivel + '">' +
      '<span class="mv-sinal-ic">' + ic + '</span>' +
      '<span class="mv-sinal-txt">' +
        '<div class="mv-sinal-nome">' + escapeHtml(x.titulo) +
          (x.escopo ? ' — ' + escapeHtml(x.escopo) : '') + '</div>' +
        '<div class="mv-sinal-num"><b>' + mvValorSinal(x.medido, x.unidade) + '</b>' + rs +
          ' <span class="esp">· ' + escapeHtml(x.esperado_rotulo || 'esperado') + ' ' + esp +
          (x.base_dias ? ' (' + x.base_dias + ' dias)' : '') + '</span></div>' +
        '<div class="mv-sinal-det">' + escapeHtml(x.detalhe || '') + '</div>' +
      '</span>' +
    '</div>';
  }).join('');

  // "Não avaliado" não é o mesmo que "não há sinal". Fim de semana e feriado
  // não têm custo lançado, e sem esta linha o dia apareceria limpo quando na
  // verdade a margem nem foi olhada.
  const na = (s.nao_avaliados || []).length
    ? '<div class="mv-sinais-na">Não avaliado: ' +
      s.nao_avaliados.map(x => '<b>' + escapeHtml(x.tipo.toLowerCase()) +
        (x.escopo ? ' (' + escapeHtml(x.escopo) + ')' : '') + '</b> — ' + escapeHtml(x.detalhe)).join(' · ') +
      '</div>'
    : '';

  if (!s.total) {
    return '<div class="mv-sinais">' +
      '<div class="mv-sinais-tit limpo">Sinais do dia</div>' +
      '<div class="mv-sinais-ok">✅ Nenhum sinal neste dia.</div>' + na + '</div>';
  }
  const cont = [];
  if (s.vermelhos) cont.push(s.vermelhos + ' vermelho' + (s.vermelhos > 1 ? 's' : ''));
  if (s.amarelos) cont.push(s.amarelos + ' amarelo' + (s.amarelos > 1 ? 's' : ''));
  return '<div class="mv-sinais">' +
    '<div class="mv-sinais-tit tem">' + s.total + (s.total > 1 ? ' sinais' : ' sinal') + ' neste dia' +
      '<span class="mv-sinais-cont">' + cont.join(' · ') + '</span></div>' +
    itens + na + '</div>';
}

function mvDataBR(iso) {
  const p = String(iso || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || '');
}

// ── Cards do dia ──
// A ORDEM não é decorativa: cupons (aproximado) vem colado em abastecimentos
// (exato) para a diferença entre os dois ficar visível em vez de virar
// pergunta. Ver o bloco de contagem em GET /tecnox/movimentacao.
function mvCards(d) {
  const dia = d.dia;
  const card = (num, lbl, sub, cls) =>
    '<div class="mv-card"><div class="mv-card-num' + (cls ? ' ' + cls : '') + '">' + num + '</div>' +
    '<div class="mv-card-lbl">' + escapeHtml(lbl) + '</div>' +
    (sub ? '<div class="mv-card-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';

  const cupons = dia.cupons_aprox == null
    ? card('—', 'cupons', 'sem forma de pgto no dia')
    : card('~' + mvInt(dia.cupons_aprox), 'cupons', 'aprox. · soma por forma', 'aprox');

  const cards = cupons +
    card(mvInt(dia.abastecimentos), 'abastecimentos', 'itens de combustível') +
    card(mvInt(dia.litros) + ' L', 'litros', mvInt(dia.litros_por_abastecimento) + ' L por abast.') +
    card(mvBRL0(dia.venda_total), 'venda líquida',
         'comb ' + mvBRL0(dia.liquido_combustivel) + ' + prod ' + mvBRL0(dia.produtos_rs)) +
    card(txBRL(dia.rs_por_abastecimento), 'R$ / abast.', 'ticket médio');

  // A nota explica o til UMA vez, aqui. O card sozinho não ensina por que o
  // número de cupons não fecha, e sem isso alguém vai somar as quebras e
  // achar que a tela está errada.
  const nota = '<div class="mv-nota">O rollup guarda cupons distintos <b>por combustível</b>, ' +
    'então não existe contagem exata de cupom do dia: somar as linhas conta duas vezes ' +
    'quem abasteceu dois combustíveis (medido: +12,5% em média, +29,3% no pior caso). ' +
    'O <b>abastecimento</b> (item de combustível) é exato e é o denominador do ticket. ' +
    'O cupom aproximado vem da soma por forma de pagamento, que erra ' +
    'só no pagamento dividido (+2,2% em média).</div>';

  return '<div class="mv-cards">' + cards + '</div>' + nota +
    (dia.desconto > 0
      ? '<div class="mv-nota">Desconto concedido no dia: <b>' + txBRL(dia.desconto) +
        '</b> (' + mvPct(dia.bruto > 0 ? dia.desconto / dia.bruto * 100 : null) + ' do bruto).</div>'
      : '<div class="mv-nota">Nenhum desconto concedido no dia.</div>');
}

// ── Faixa de sinais no modo INTERVALO ──
// Os alarmes são por DIA e continuam sendo: comparar oito dias somados contra
// a média diária do posto misturaria unidades, e um desconto anormal de um dia
// diluído em oito desapareceria. Então aqui a faixa não soma nada — ela LISTA
// os dias que acenderam, e cada linha leva ao dia.
function mvSinaisPeriodo(s) {
  const na = s.dias_com_nao_avaliado
    ? '<div class="mv-sinais-na"><b>' + s.dias_com_nao_avaliado + '</b> de <b>' + s.dias_com_dado +
      '</b> dia(s) tiveram algum sinal <b>não avaliado</b> por falta de base — abra o dia para ver qual.</div>'
    : '';
  if (!s.dias_com_sinal) {
    return '<div class="mv-sinais">' +
      '<div class="mv-sinais-tit limpo">Sinais do intervalo</div>' +
      '<div class="mv-sinais-ok">✅ Nenhum sinal neste intervalo — ' + s.dias_com_dado +
      ' dia(s) conferido(s).</div>' + na + '</div>';
  }
  const linhas = s.dias.map(dia => {
    // O dia herda a cor do PIOR sinal que teve.
    const nivel = dia.vermelhos ? 'vermelho' : 'amarelo';
    const resumo = dia.itens
      .map(x => x.titulo_curto + (x.escopo ? ' (' + x.escopo + ')' : ''))
      .join(' · ');
    // Só o primeiro detalhe: a linha é resumo, e o resto está a um clique.
    const det = dia.itens.length && dia.itens[0].detalhe ? ' — ' + dia.itens[0].detalhe : '';
    return '<button type="button" class="mv-dia-sinal ' + nivel + '" data-dia="' + escapeHtml(dia.data) + '">' +
      '<span class="mv-dia-data">' + (dia.vermelhos ? '🔴' : '🟡') + ' ' + escapeHtml(mvDataBR(dia.data)) + '</span>' +
      '<span class="mv-dia-txt">' + escapeHtml(resumo) +
        '<span style="color:var(--text3)">' + escapeHtml(det) + '</span></span>' +
      '<span class="mv-dia-ir">ver o dia →</span>' +
    '</button>';
  }).join('');
  const cont = [];
  if (s.vermelhos) cont.push(s.vermelhos + ' vermelho' + (s.vermelhos > 1 ? 's' : ''));
  if (s.amarelos) cont.push(s.amarelos + ' amarelo' + (s.amarelos > 1 ? 's' : ''));
  return '<div class="mv-sinais">' +
    '<div class="mv-sinais-tit tem">' + s.dias_com_sinal +
      (s.dias_com_sinal > 1 ? ' dias com sinal' : ' dia com sinal') + ' neste intervalo' +
      '<span class="mv-sinais-cont">de ' + s.dias_com_dado + ' com dado · ' + cont.join(' · ') + '</span></div>' +
    linhas + na + '</div>';
}

// ── Faturamento por combustível ──
function mvBlocoComb(d) {
  const linhas = d.por_combustivel.map(c => mvRow(c.rotulo, c.codigo, [
    mvMet(mvInt(c.litros), 'L'),
    mvMet(mvBRL0(c.liquido), '', 'rs'),
    mvMet(c.rs_litro == null ? '—' : c.rs_litro.toFixed(3), 'R$/L'),
    mvMet(mvInt(c.itens), 'ab'),
    mvMet(mvPct(c.pct_liquido), ''),
  ], c.pct_liquido)).join('');
  return mvBloco('Faturamento por combustível', d.dia.combustiveis + ' combustíveis',
    'L = litros · R$/L = preço médio ponderado do dia (mistura à vista, frota e prazo) · ab = abastecimentos · % do líquido de combustível',
    linhas);
}

// ── Quebra por turno ──
function mvBlocoTurno(d) {
  if (!d.por_turno.length) {
    return mvBloco('Por turno', null, null,
      '<div class="empty-state">Sem quebra por turno neste dia.</div>');
  }
  const linhas = d.por_turno.map(t => mvRow('Turno ' + t.chave, null, [
    mvMet(mvInt(t.litros), 'L'),
    mvMet(mvBRL0(t.liquido), '', 'rs'),
    mvMet(mvInt(t.itens), 'ab'),
    mvMet(mvCup(t), 'cup'),
    mvMet(mvPct(t.pct_liquido), ''),
  ], t.pct_liquido)).join('');
  // A ressalva do turno é obrigatória: a numeração da TecnoX não é contínua
  // nem cronológica, e quem lê "turno 1, turno 2, turno 4" vai supor as duas
  // coisas se ninguém disser o contrário.
  const chaves = d.por_turno.map(t => t.chave).join(', ');
  const aviso = '<div class="mv-aviso">Turnos deste dia: <b>' + escapeHtml(chaves) + '</b>. ' +
    'A numeração vem da TecnoX e <b>não é contínua nem cronológica</b> — um posto pode ter 1, 2 e 4, ' +
    'e o turno de número maior pode ser a madrugada. A tela lista só os turnos que existem no dia, ' +
    'na ordem da chave, e não completa a série.</div>';
  return mvBloco('Por turno', d.por_turno.length + ' turnos',
    'ab = abastecimentos · cup = cupons (<b>~</b> = aproximado, o turno somou mais de um combustível)',
    linhas, aviso);
}

// ── Quebra por forma de pagamento ──
function mvBlocoPagamento(d) {
  if (!d.pagamento_disponivel) {
    return mvBloco('Por forma de pagamento', null, null,
      '<div class="empty-state">Sem forma de pagamento neste dia.</div>',
      '<div class="mv-aviso">A TecnoX começou a mandar o array <b>pagamentos</b> na capa do cupom em ' +
      '<b>01/09/2026</b>. Dia anterior a isso tem venda no rollup, mas não tem quebra por forma — ' +
      'não é falha da coleta.</div>');
  }
  const p = d.por_pagamento;
  // Totais por ind_tipo primeiro: é o balde do DRE e é o que responde "quanto
  // foi cartão" sem ler 17 linhas de operadora.
  const chips = p.tipos.map(t =>
    '<div class="mv-tipo"><span class="mv-tipo-cod">' + escapeHtml(t.ind_tipo) + '</span>' +
    escapeHtml(t.rotulo) + ' <b>' + mvBRL0(t.valor) + '</b> ' +
    '<span style="color:var(--text3)">' + mvPct(t.pct_valor) + ' · ' + t.formas + ' forma(s)</span></div>').join('');

  const linhas = p.formas.map(f => mvRow(f.rotulo, f.ind_tipo + '|' + f.cod, [
    mvMet(mvBRL0(f.valor), '', 'rs'),
    mvMet(mvInt(f.cupons), 'cup'),
    mvMet(mvInt(f.pernas), 'pernas'),
    mvMet(mvPct(f.pct_valor), ''),
  ], f.pct_valor)).join('');

  const avisos = [];
  const genericas = p.formas.filter(f => f.sem_adquirente);
  if (genericas.length) {
    const soma = genericas.reduce((s, f) => s + f.valor, 0);
    avisos.push('<div class="mv-aviso">Este posto tem <b>' + mvBRL0(soma) + '</b> (' +
      mvPct(p.total_valor > 0 ? soma / p.total_valor * 100 : null) +
      ') em cartão cadastrado de forma <b>genérica no PDV</b> (código 82). ' +
      'O dado não diz qual adquirente foi — Getnet, Safra, Cielo — e a tela não chuta. ' +
      'Para abrir por adquirente aqui, o cadastro do PDV precisa ser corrigido.</div>');
  }
  const semForma = p.formas.filter(f => f.sem_forma);
  if (semForma.length) {
    avisos.push('<div class="mv-aviso">Há <b>' + mvInt(semForma.reduce((s, f) => s + f.cupons, 0)) +
      ' cupom(ns) sem forma de pagamento informada</b> (' +
      mvBRL0(semForma.reduce((s, f) => s + f.valor, 0)) + '). ' +
      'É um balde explícito do rollup, não silêncio — o faturamento aparece, só não se sabe como foi pago.</div>');
  }
  // A soma das formas fica ~0,5% ACIMA da venda porque val_pagamento é o valor
  // ENTREGUE (troco). Dizer isso aqui evita que a diferença pareça erro da tela.
  const delta = p.total_valor - d.dia.venda_total;
  const deltaPct = d.dia.venda_total > 0 ? delta / d.dia.venda_total * 100 : null;
  avisos.push('<div class="mv-nota">Soma das formas: <b>' + mvBRL0(p.total_valor) +
    '</b> · venda do dia: <b>' + mvBRL0(d.dia.venda_total) + '</b> · diferença <b>' +
    (delta >= 0 ? '+' : '') + mvBRL0(delta) + '</b> (' + (deltaPct >= 0 ? '+' : '') + mvPct(deltaPct) +
    '). Diferença positiva pequena é esperada: <b>val_pagamento é o valor entregue</b>, não o aplicado ' +
    '— cupom de R$ 74,20 pago com R$ 100,00 vem como 100,00, e a sobra fica na perna de dinheiro. ' +
    'As pernas de cartão são exatas.</div>');

  return mvBloco('Por forma de pagamento', p.formas.length + ' formas · ' + p.tipos.length + ' categorias',
    'Sem coluna de litros: pagamento paga o cupom inteiro e o rollup <b>não rateia litro</b> entre as pernas. ' +
    'cup = cupons que usaram a forma (exato) · pernas = nº de pagamentos',
    '<div class="mv-tipos">' + chips + '</div>' + linhas, avisos.join(''));
}

// ── Quebra por frentista ──
function mvBlocoFrentista(d) {
  const todos = d.por_frentista;
  if (!todos.length) {
    return mvBloco('Por frentista', null, null,
      '<div class="empty-state">Sem quebra por frentista neste dia.</div>');
  }
  // Corta só quando a lista fica grande de verdade. Num intervalo longo a
  // rotação do posto empilha nomes; num dia são ~10 e cortar seria esconder
  // dado sem ganho nenhum de leitura.
  const corta = !_mvFrentTodos && todos.length > MV_FRENT_GATILHO;
  const mostra = corta ? todos.slice(0, MV_FRENT_TOPO) : todos;
  const linhas = mostra.map(f => mvRow(f.chave, null, [
    mvMet(mvInt(f.litros), 'L'),
    mvMet(mvBRL0(f.liquido), '', 'rs'),
    mvMet(mvInt(f.itens), 'ab'),
    mvMet(mvCup(f), 'cup'),
    mvMet(mvPct(f.pct_liquido), ''),
  ], f.pct_liquido)).join('');
  // O resto vira UMA linha com o que ele soma — e continua clicável. O total
  // do bloco tem de continuar fechando com os cards mesmo cortado; escondido
  // sem somar, o rodapé passaria a discordar da tela.
  let mais = '';
  if (corta) {
    const resto = todos.slice(MV_FRENT_TOPO);
    const rs = resto.reduce((s, f) => s + f.liquido, 0);
    const litros = resto.reduce((s, f) => s + f.litros, 0);
    const ab = resto.reduce((s, f) => s + f.itens, 0);
    mais = '<button class="mv-mais" id="mv-frent-mais" type="button">+ ' + resto.length +
      ' frentistas — ' + mvBRL0(rs) + ' · ' + mvInt(litros) + ' L · ' + mvInt(ab) +
      ' ab   (mostrar todos)</button>';
  }
  // SEM_FRENTISTA é o balde do rollup para item cujo `funcionario` traz razão
  // social em vez de pessoa. Aparece como está, para o total continuar fechando.
  const temSem = todos.some(f => f.chave === 'SEM_FRENTISTA');
  const nota = temSem
    ? '<div class="mv-nota"><b>SEM_FRENTISTA</b> é o balde do rollup para item em que a TecnoX manda ' +
      'razão social no lugar do nome da pessoa. Fica visível para o total fechar, em vez de sumir do ranking.</div>'
    : '';
  return mvBloco('Por frentista', todos.length + ' frentistas',
    'ab = abastecimentos · cup = cupons (<b>~</b> = aproximado) · % do líquido de combustível',
    linhas, mais + nota);
}

// ── Quebra por canal ──
function mvBlocoCanal(d) {
  if (!d.por_canal.length) {
    return mvBloco('Por canal', null, null,
      '<div class="empty-state">Sem quebra por canal neste dia.</div>');
  }
  const linhas = d.por_canal.map(c => mvRow(c.rotulo, c.chave, [
    mvMet(mvInt(c.litros), 'L'),
    mvMet(mvBRL0(c.liquido), '', 'rs'),
    mvMet(mvInt(c.itens), 'ab'),
    mvMet(mvCup(c), 'cup'),
    mvMet(mvPct(c.pct_liquido), ''),
  ], c.pct_liquido)).join('');
  // Canal ≠ forma de pagamento. O rollup só tem três canais, porque canal vem
  // de duas flags da capa (venda_99 / venda_soutag) e o resto é pista. Good
  // Card, Ticket Car e afins são FORMA DE PAGAMENTO e estão no bloco de cima.
  const nota = '<div class="mv-nota">O canal vem das flags da capa do cupom e só tem três valores: ' +
    '<b>99</b>, <b>Soutag</b> e <b>pista</b>. Good Card, Ticket Car, Abastece Aí e afins não são canal — ' +
    'são forma de pagamento, e estão na quebra acima.</div>';
  return mvBloco('Por canal', d.por_canal.length + ' canais',
    'ab = abastecimentos · cup = cupons (<b>~</b> = aproximado) · % do líquido de combustível',
    linhas, nota);
}

function txRenderHistorico() {
  const el = document.getElementById('tx-hist'); if (!el) return;
  if (!_txHist.length) { el.innerHTML = '<div class="empty-state">Nenhuma sonda ainda para este posto + tipo.</div>'; return; }
  el.innerHTML = _txHist.map((s, i) =>
    '<div class="tx-hist-row' + (i === _txSondaIdx ? ' on' : '') + '" data-idx="' + i + '">' +
      '<span class="tx-h-data">' + escapeHtml(txDataHora(s.executado_em)) + '</span>' +
      '<span class="tx-h-tipo">' + escapeHtml(s.tipo) + '</span>' +
      '<span class="tx-h-reg">' + (s.registros != null ? s.registros : 0) + ' reg</span>' +
      '<span class="tx-h-ms">' + (s.duracao_ms != null ? s.duracao_ms : '?') + ' ms</span>' +
      (s.erro ? '<span class="tx-h-erro">' + escapeHtml(s.erro) + '</span>' : '<span class="tx-h-ok">ok</span>') +
    '</div>').join('');
}
