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
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  input.value = ontem.toISOString().split('T')[0];
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
  body.innerHTML = tanquesAtuais.map((t, i) => {
    const arq = t.tipo_medicao;
    const isVeederRoot = arq === 'veederroot';
    const isGnv = arq === 'gnv';
    const isRegua = !isVeederRoot && !isGnv && !!ARQUEACAO[arq]; // arq com tabela conhecida

    let inputBlock;
    if (isGnv) {
      inputBlock = `<div class="tank-arq-label" style="color:var(--text3);margin-top:0;">— GNV (sem medição de tanque)</div>`;
    } else if (isRegua) {
      inputBlock = `
        <div class="tank-vol" id="vol-${t.id}">0 L</div>
        <div class="stepper">
          <input class="step-input" type="number" min="0" max="260" step="1"
            id="tanque-${t.id}" data-combustivel="${t.combustivel}" data-arq="${arq}"
            placeholder="0" oninput="atualizarVolTanque('${t.id}','${arq}')">
        </div>
        <div class="tank-arq-label">Régua (cm) — tabela ${arq}</div>
      `;
    } else {
      // Veeder-Root, ou arq desconhecido/pendente (fallback: litros direto)
      inputBlock = `
        <div class="stepper">
          <input class="step-input" type="number" min="0" step="0.01"
            id="tanque-${t.id}" data-combustivel="${t.combustivel}" placeholder="0">
        </div>
        ${isVeederRoot ? '<div class="tank-arq-label">Veeder-Root (litros)</div>' : ''}
        ${(!isVeederRoot && !isRegua) ? `<div class="tank-arq-label tank-arq-pendente">Tipo "${arq || '?'}" pendente — litros direto</div>` : ''}
      `;
    }

    return `
    <div class="tank-row">
      <div>
        <div class="tank-fuel">${t.codigo || 'TQ.' + (i + 1)}</div>
        <div class="tank-name">${t.combustivel}</div>
        <div class="tank-cap">Capacidade: ${Number(t.capacidade).toLocaleString('pt-BR')} L</div>
      </div>
      <div>${inputBlock}</div>
    </div>
  `;
  }).join('');
}

// Atualiza o volume exibido (litros) conforme o cm digitado, usando a
// tabela de arqueação correspondente. Ver shared/js/arqueacao.js.
function atualizarVolTanque(tanqueId, arq) {
  const input = document.getElementById('tanque-' + tanqueId);
  const cm = parseInt(input?.value) || 0;
  const vol = cmToLitros(cm, arq);
  const volEl = document.getElementById('vol-' + tanqueId);
  if (volEl) volEl.textContent = vol.toLocaleString('pt-BR') + ' L';
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
  body.innerHTML = combustiveisAtuais.map(c => {
    const chave = c.nome.replace(/\s+/g, '_');
    return `
    <div class="fuel-row" style="margin-bottom:8px;">
      <span class="fuel-label">${c.codigo} — ${c.nome}</span>
      <div class="stepper">
        <button type="button" class="step-btn" onclick="stepCarga('carga-${chave}',-1000)">−</button>
        <input class="step-input" id="carga-${chave}" data-combustivel="${c.nome}"
          data-val="0" value="0" type="text" inputmode="numeric"
          style="width:90px" oninput="formatCargaInput(this)">
        <button type="button" class="step-btn" onclick="stepCarga('carga-${chave}',1000)">+</button>
      </div>
    </div>
  `;
  }).join('');
}

// Máscara de milhar (pt-BR) igual ao sistema antigo — o valor numérico puro
// fica em data-val; o value exibido é só formatação visual.
function formatCargaInput(el) {
  const digits = el.value.replace(/\D/g, '');
  const num = parseInt(digits) || 0;
  el.dataset.val = num;
  el.value = num === 0 ? '0' : num.toLocaleString('pt-BR');
}

function stepCarga(id, delta) {
  const el = document.getElementById(id);
  const val = parseInt(el.dataset.val) || 0;
  const novo = Math.max(0, val + delta);
  el.dataset.val = novo;
  el.value = novo === 0 ? '0' : novo.toLocaleString('pt-BR');
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
    const arq = t.tipo_medicao;
    if (arq === 'gnv') {
      return `${t.codigo} (${t.combustivel}): GNV`;
    }
    const input = document.getElementById('tanque-' + t.id);
    if (arq && arq !== 'veederroot' && ARQUEACAO[arq]) {
      const cm = parseInt(input?.value) || 0;
      const vol = cmToLitros(cm, arq);
      return `${t.codigo} (${t.combustivel}): ${cm}cm = ${vol}L`;
    }
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
    const valor = parseInt(input?.dataset.val) || 0;
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
