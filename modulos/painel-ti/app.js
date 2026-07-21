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
  ['acessar', 'usuarios'].forEach(t => {
    const panel = document.getElementById('tab-' + t);
    if (panel) panel.classList.toggle('active', t === name);
    const btn = document.getElementById('tabbtn-' + t);
    if (btn) btn.classList.toggle('active', t === name);
  });
  if (name === 'usuarios') carregarGerenciar(false);
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
