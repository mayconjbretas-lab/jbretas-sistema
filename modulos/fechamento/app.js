// ================================================================
// JBRETAS SISTEMA — modulos/fechamento/app.js
// Substitui o db.js + app.js antigos: tanques e combustíveis agora
// vêm da API (tabelas tanques / combustiveis_posto no Supabase),
// não mais hardcoded em arquivo JS.
//
// LIMITAÇÃO ATUAL (TODO): a tabela `tanques` hoje não guarda o tipo
// de tabela de arqueação (cm→litros). Por isso, por enquanto, todo
// tanque é tratado como leitura direta em litros (igual aos postos
// Veeder-Root do sistema antigo). Quando portarmos as tabelas de
// arqueação física pro Supabase, ajustamos aqui a conversão cm→L.
// ================================================================

let usuarioAtual = null;
let tanquesAtuais = [];
let combustiveisAtuais = [];
let cargaRespondida = null; // 'sim' | 'nao' | null

document.addEventListener('DOMContentLoaded', async () => {
  usuarioAtual = exigirSessao(['GERENTE']);
  if (!usuarioAtual) return;

  montarTopbar();
  montarDataPadrao();

  if (!usuarioAtual.posto?.nome) {
    document.getElementById('tanques-body').innerHTML =
      '<div class="empty-state">⚠ Este usuário não tem posto vinculado. Contate o administrador.</div>';
    return;
  }

  await carregarEstruturaDoPosto(usuarioAtual.posto.nome);
});

function montarTopbar() {
  document.getElementById('app-gerente').textContent = usuarioAtual.nome || '—';
  document.getElementById('app-posto').textContent = usuarioAtual.posto?.nome || '—';
  document.getElementById('card-gerente').textContent = usuarioAtual.nome || '—';
  document.getElementById('card-posto').textContent = usuarioAtual.posto?.nome || '—';
  const iniciais = (usuarioAtual.nome || '??').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
  document.getElementById('app-avatar').textContent = iniciais;

  const hoje = new Date();
  document.getElementById('page-date').textContent = hoje.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
}

function montarDataPadrao() {
  const input = document.getElementById('card-data-input');
  const hoje = new Date();
  input.value = hoje.toISOString().split('T')[0];
}

async function carregarEstruturaDoPosto(nomePosto) {
  try {
    const [respTanques, respPostos] = await Promise.all([
      apiFetch(`/tanques/${encodeURIComponent(nomePosto)}`),
      apiFetch('/postos'),
    ]);

    tanquesAtuais = respTanques.tanques || [];
    const postoCompleto = (respPostos.postos || []).find(
      p => p.nome.toUpperCase() === nomePosto.toUpperCase()
    );
    combustiveisAtuais = (postoCompleto?.combustiveis_posto || [])
      .filter(c => c.ativo !== false)
      .sort((a, b) => (a.ordem || 99) - (b.ordem || 99));

    renderTanques();
    renderVendas();
    renderCarga();
  } catch (err) {
    console.error('Erro ao carregar estrutura do posto:', err);
    document.getElementById('tanques-body').innerHTML =
      `<div class="empty-state">⚠ Erro ao carregar dados: ${err.message}</div>`;
  }
}

function renderTanques() {
  const body = document.getElementById('tanques-body');
  if (!tanquesAtuais.length) {
    body.innerHTML = '<div class="empty-state">Nenhum tanque cadastrado para este posto ainda.</div>';
    return;
  }
  body.innerHTML = tanquesAtuais.map((t, i) => `
    <div class="tank-row">
      <div>
        <div class="tank-fuel">${t.codigo || 'TQ.' + (i + 1)}</div>
        <div class="tank-name">${t.combustivel}</div>
        <div class="tank-cap">Capacidade: ${Number(t.capacidade).toLocaleString('pt-BR')} L</div>
      </div>
      <div class="stepper">
        <input class="step-input" type="number" min="0" step="0.01"
          id="tanque-${t.id}" data-combustivel="${t.combustivel}" placeholder="0">
      </div>
    </div>
  `).join('');
}

function renderVendas() {
  const body = document.getElementById('vendas-body');
  if (!combustiveisAtuais.length) {
    body.innerHTML = '<div class="empty-state">Nenhum combustível cadastrado.</div>';
    return;
  }
  body.innerHTML = combustiveisAtuais.map(c => `
    <div class="fuel-row">
      <span class="fuel-label">${c.codigo} — ${c.nome}</span>
      <input class="step-input" type="number" min="0" step="0.01"
        id="venda-${c.nome.replace(/\s+/g, '_')}" data-combustivel="${c.nome}"
        placeholder="0" oninput="atualizarTotalVendas()"
        style="background:var(--surface3);border:1px solid var(--border2);border-radius:8px;width:110px;">
    </div>
  `).join('');
}

function atualizarTotalVendas() {
  let total = 0;
  combustiveisAtuais.forEach(c => {
    const input = document.getElementById('venda-' + c.nome.replace(/\s+/g, '_'));
    total += parseFloat(input?.value) || 0;
  });
  document.getElementById('total-vendas').textContent = total.toLocaleString('pt-BR') + ' L';
}

function renderCarga() {
  const body = document.getElementById('carga-body');
  body.innerHTML = combustiveisAtuais.map(c => `
    <div class="fuel-row" style="margin-bottom:8px;">
      <span class="fuel-label">${c.codigo} — ${c.nome}</span>
      <input class="step-input" type="number" min="0" step="0.01"
        id="carga-${c.nome.replace(/\s+/g, '_')}" data-combustivel="${c.nome}"
        placeholder="0" style="background:var(--surface3);border:1px solid var(--border2);border-radius:8px;width:110px;">
    </div>
  `).join('');
}

function setCarga(valor) {
  cargaRespondida = valor;
  const btnSim = document.getElementById('btn-carga-sim');
  const btnNao = document.getElementById('btn-carga-nao');
  const campos = document.getElementById('carga-campos');
  btnSim.classList.toggle('sim-ativo', valor === 'sim');
  btnNao.classList.toggle('nao-ativo', valor === 'nao');
  campos.classList.toggle('visivel', valor === 'sim');
  liberarSalvar();
}

function liberarSalvar() {
  const btn = document.getElementById('btn-salvar-fechamento');
  const msg = document.getElementById('carga-status-msg');
  if (cargaRespondida) {
    btn.disabled = false;
    btn.textContent = '💾 SALVAR FECHAMENTO';
    msg.style.display = 'none';
  } else {
    btn.disabled = true;
    btn.textContent = '🔒 RESPONDA A CARGA PARA SALVAR';
    msg.style.display = 'block';
  }
}

document.addEventListener('click', e => {
  if (e.target.id === 'btn-salvar-fechamento' && !e.target.disabled) {
    salvarFechamento();
  }
});

function montarStringTanques() {
  return tanquesAtuais.map(t => {
    const input = document.getElementById('tanque-' + t.id);
    const valor = parseFloat(input?.value) || 0;
    // Formato compatível com o parser do server.js: "TQ.X (COMBUSTIVEL): valorL"
    return `${t.codigo} (${t.combustivel}): ${valor}L`;
  }).join(' | ');
}

function montarStringVendas() {
  return combustiveisAtuais.map(c => {
    const input = document.getElementById('venda-' + c.nome.replace(/\s+/g, '_'));
    const valor = parseFloat(input?.value) || 0;
    return `${c.nome}: ${valor}L`;
  }).join(' | ');
}

function montarStringCarga() {
  if (cargaRespondida !== 'sim') return null;
  return combustiveisAtuais.map(c => {
    const input = document.getElementById('carga-' + c.nome.replace(/\s+/g, '_'));
    const valor = parseFloat(input?.value) || 0;
    return `${c.nome}: ${valor}L`;
  }).filter(s => !s.startsWith('undefined')).join(' | ');
}

async function salvarFechamento() {
  const btn = document.getElementById('btn-salvar-fechamento');
  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';

  const dataInput = document.getElementById('card-data-input').value; // YYYY-MM-DD
  const [ano, mes, dia] = dataInput.split('-');
  const dataBR = `${dia}/${mes}/${ano}`;
  const agora = new Date();
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const totalVendasTexto = document.getElementById('total-vendas').textContent;

  const payload = {
    data: dataBR,
    hora,
    posto: usuarioAtual.posto.nome,
    gerente: usuarioAtual.nome,
    tanques: montarStringTanques(),
    vendas: montarStringVendas(),
    totalVendas: totalVendasTexto,
    lubSoutag: document.getElementById('lub-soutag').value || 0,
    lubDia: document.getElementById('lub-dia').value || 0,
    cargaRecebida: cargaRespondida,
    carga: montarStringCarga(),
  };

  try {
    const resp = await apiFetch('/fechamento', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    mostrarToast('✅ Fechamento salvo!', `${payload.posto} — ${dataBR} às ${hora}`);
    btn.textContent = '💾 SALVAR FECHAMENTO';
    btn.disabled = false;
  } catch (err) {
    mostrarToast('❌ Erro ao salvar', err.message);
    btn.textContent = '💾 SALVAR FECHAMENTO';
    btn.disabled = false;
  }
}

function mostrarToast(titulo, msg) {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-title').textContent = titulo;
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}
