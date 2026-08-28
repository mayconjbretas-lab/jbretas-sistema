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
  if (!_txPostos.length) txCarregarPostos();  // carrega postos e, ao fim, o histórico
  else txCarregarHistorico();
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

async function txCarregarPostos() {
  const sel = document.getElementById('tx-posto');
  try {
    const resp = await apiFetch('/postos');
    _txPostos = (resp.postos || [])
      .filter(p => p.cnpj && String(p.cnpj).trim())
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    if (sel) sel.innerHTML = _txPostos.length
      ? _txPostos.map(p => '<option value="' + escapeHtml(p.cnpj) + '">' + escapeHtml(p.nome) + '</option>').join('')
      : '<option value="">Nenhum posto com CNPJ</option>';
    const inp = document.getElementById('tx-data');   // default: ontem
    if (inp && !inp.value) { const d = new Date(); d.setDate(d.getDate() - 1); inp.value = d.toISOString().slice(0, 10); }
    txCarregarHistorico();
  } catch (err) {
    if (sel) sel.innerHTML = '<option value="">Erro ao carregar postos</option>';
  }
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
