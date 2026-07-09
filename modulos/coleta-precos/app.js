// ================================================================
// JBRETAS SISTEMA — modulos/coleta-precos/app.js
// Coleta de preços da concorrência: seleciona o concorrente (dado
// relacional vindo de GET /concorrentes/:posto — tabelas concorrentes
// + posto_concorrente no Supabase), digita o preço com máscara R$,
// captura geolocalização e foto obrigatória, salva via POST /coletas.
// ================================================================

let usuarioAtual = null;
let concorrentes = [];
let concorrenteSelecionado = null;
let combustiveisMapeados = []; // [{ nome, codigo, coluna }]
let localizacaoAtual = null;   // { lat, lng }
let fotoBase64Atual = null;

document.addEventListener('DOMContentLoaded', async () => {
  usuarioAtual = exigirSessao(['GERENTE']);
  if (!usuarioAtual) return;

  montarTopbar();

  if (!usuarioAtual.posto?.nome) {
    document.getElementById('concorrente-body').innerHTML =
      '<div class="empty-state">⚠ Este usuário não tem posto vinculado. Contate o administrador.</div>';
    return;
  }

  await carregarDados(usuarioAtual.posto.nome);
});

function toggleMenu(event) {
  event.stopPropagation();
  document.getElementById('dropdown-menu').classList.toggle('hidden');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('dropdown-menu');
  if (menu && !menu.classList.contains('hidden') && !e.target.closest('#btn-menu')) {
    menu.classList.add('hidden');
  }
});

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

// Ordem dos campos de preço na tela de Coleta de Preços — segue a
// ordem física de uma placa de posto (ET, GC, GA/GA Premium, S10,
// S500), não o campo `ordem` de combustiveis_posto (esse é o da
// tabela de Fechamento/tanques e não deve mudar).
const ORDEM_PRECOS_COLETA = ['et', 'gc', 'ga', 's10', 's500'];

// Mapeia o nome do combustível (vindo de combustiveis_posto) pra
// coluna da tabela coletas (gc/ga/et/s10/s500). Combustíveis sem
// coluna equivalente (GNV, Grid, Octapro etc.) retornam null e ficam
// de fora do formulário de coleta.
function mapCombustivelParaColuna(nome) {
  const semAcento = Array.from(String(nome).normalize('NFD'))
    .filter(ch => ch.charCodeAt(0) < 128)
    .join('');
  const n = semAcento.toUpperCase();
  if (n.includes('S-10') || n.includes('S10')) return 's10';
  if (n.includes('S-500') || n.includes('S500') || n.includes('PODIUM')) return 's500';
  if (n.includes('ETANOL')) return 'et';
  if (n.includes('ADITIV')) return 'ga';
  if (n.includes('GASOLINA')) return 'gc';
  return null;
}

async function carregarDados(nomePosto) {
  try {
    const [respPostos, respConcorrentes] = await Promise.all([
      apiFetch('/postos'),
      apiFetch(`/concorrentes/${encodeURIComponent(nomePosto)}`),
    ]);

    const postoCompleto = (respPostos.postos || []).find(
      p => p.nome.toUpperCase() === nomePosto.toUpperCase()
    );
    const combustiveisAtuais = (postoCompleto?.combustiveis_posto || [])
      .filter(c => c.ativo !== false)
      .sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
    combustiveisMapeados = combustiveisAtuais
      .map(c => ({ nome: c.nome, codigo: c.codigo, coluna: mapCombustivelParaColuna(c.nome) }))
      .filter(c => c.coluna)
      .sort((a, b) => ORDEM_PRECOS_COLETA.indexOf(a.coluna) - ORDEM_PRECOS_COLETA.indexOf(b.coluna));

    concorrentes = respConcorrentes.concorrentes || [];
    renderConcorrentes();
    await carregarHistorico(nomePosto);
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    document.getElementById('concorrente-body').innerHTML =
      `<div class="empty-state">⚠ Erro ao carregar dados: ${err.message}</div>`;
  }
}

// Normaliza nome de posto pra comparação (sem acento/caixa/espaço).
// Inline aqui porque a página de coleta não carrega coletas-service.js.
function normNomePosto(s) {
  return Array.from(String(s || '').normalize('NFD'))
    .filter(ch => ch.charCodeAt(0) < 128)
    .join('').toUpperCase().trim().replace(/\s+/g, ' ');
}
// true quando o alvo selecionado é o próprio posto do gerente.
function ehProprioPosto(nome) {
  return !!usuarioAtual?.posto?.nome && normNomePosto(nome) === normNomePosto(usuarioAtual.posto.nome);
}

function renderConcorrentes() {
  const body = document.getElementById('concorrente-body');
  if (!concorrentes.length) {
    body.innerHTML = '<div class="empty-state">Nenhum concorrente cadastrado ainda para este posto. Contate o administrador para vincular concorrentes.</div>';
    return;
  }
  body.innerHTML = `
    <select id="select-concorrente" class="field-select" onchange="onConcorrenteSelecionado()">
      <option value="">Selecione...</option>
      ${concorrentes.map(c => {
        const label = ehProprioPosto(c.nome)
          ? `🏠 Meu posto (${c.nome})`
          : `${c.nome}`;
        return `<option value="${c.id}">${label}</option>`;
      }).join('')}
    </select>
  `;

  document.getElementById('precos-card').style.display = 'block';
  document.getElementById('local-card').style.display = 'block';
  document.getElementById('foto-card').style.display = 'block';
  document.getElementById('historico-card').style.display = 'block';
  document.getElementById('save-bar').style.display = 'flex';
  renderPrecos();
  capturarLocalizacao(); // captura automática ao abrir a tela — sem exigir clique
}

function onConcorrenteSelecionado() {
  const select = document.getElementById('select-concorrente');
  const id = select.value;
  concorrenteSelecionado = concorrentes.find(c => c.id === id) || null;
  atualizarEstadoSalvar();
}

function renderPrecos() {
  const body = document.getElementById('precos-body');
  if (!combustiveisMapeados.length) {
    body.innerHTML = '<div class="empty-state">Nenhum combustível compatível cadastrado para este posto.</div>';
    return;
  }
  body.innerHTML = combustiveisMapeados.map(c => `
    <div class="fuel-row" style="margin-bottom:8px;">
      <span class="fuel-label">${c.codigo || c.coluna.toUpperCase()} — ${c.nome}</span>
      <input class="preco-input" type="tel" inputmode="numeric" id="preco-${c.coluna}"
        data-coluna="${c.coluna}" data-val="0" value="0,00"
        oninput="formatPrecoInput(this)">
    </div>
  `).join('');
}

// Máscara R$ 0,00 — acumula dígitos da direita pra esquerda (ex: "5699" → "56,99").
function formatPrecoInput(el) {
  const digits = el.value.replace(/\D/g, '');
  const num = parseInt(digits || '0', 10);
  const valor = num / 100;
  el.dataset.val = valor.toFixed(2);
  el.value = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  validarFaixaPrecos();
  atualizarEstadoSalvar();
}

function validarFaixaPrecos() {
  const aviso = document.getElementById('preco-aviso');
  const foraDaFaixa = combustiveisMapeados
    .map(c => ({ ...c, val: parseFloat(document.getElementById(`preco-${c.coluna}`)?.dataset.val || '0') }))
    .filter(c => c.val > 0 && (c.val < 2 || c.val > 10));
  if (foraDaFaixa.length) {
    aviso.textContent = `⚠ Valor fora da faixa esperada (R$2,00–R$10,00): ${foraDaFaixa.map(c => c.nome).join(', ')}. Confira antes de salvar.`;
    aviso.classList.add('visivel');
  } else {
    aviso.textContent = '';
    aviso.classList.remove('visivel');
  }
  return foraDaFaixa.length === 0;
}

function capturarLocalizacao() {
  const status = document.getElementById('geo-status');
  const btn = document.getElementById('btn-geo');
  if (!navigator.geolocation) {
    status.textContent = '⚠ Geolocalização não suportada neste navegador';
    return;
  }
  btn.disabled = true;
  btn.textContent = '⏳ Capturando...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      localizacaoAtual = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      status.textContent = `✅ Localização capturada (${localizacaoAtual.lat.toFixed(5)}, ${localizacaoAtual.lng.toFixed(5)})`;
      btn.disabled = false;
      btn.textContent = '📍 Capturar novamente';
      atualizarEstadoSalvar();
    },
    (err) => {
      status.textContent = `⚠ Erro ao capturar localização: ${err.message}`;
      btn.disabled = false;
      btn.textContent = '📍 Capturar localização';
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function onFotoSelecionada(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    // Comprime no cliente (cap 1600px no lado maior, JPEG 0.7) antes de usar.
    // Reduz o tamanho do upload/OCR sem perder legibilidade do totem.
    comprimirFoto(reader.result, (comprimida) => {
      fotoBase64Atual = comprimida; // já cai de volta pro original se falhar
      const preview = document.getElementById('foto-preview');
      preview.src = fotoBase64Atual;
      preview.style.display = 'block';
      document.getElementById('foto-preview-placeholder').style.display = 'none';
      atualizarEstadoSalvar();
      lerTotem(); // OCR automático: lê os preços da foto e preenche os campos
    });
  };
  reader.readAsDataURL(file);
}

// OCR (Etapa 2): manda a foto pra /ocr e preenche os campos de preço.
// 3 estados por combustível: número (preenche) · 'ilegivel' (avisa) · 'ausente' (ignora).
// Nunca quebra o fluxo — em erro, só avisa pra digitar manual.
async function lerTotem() {
  if (!fotoBase64Atual) return;
  const aviso = document.getElementById('ocr-aviso');
  const setAviso = (txt, mostrar) => {
    if (!aviso) return;
    aviso.textContent = txt;
    aviso.classList.toggle('visivel', !!mostrar);
  };
  setAviso('Lendo preços da foto…', true);
  try {
    const resp = await apiFetch('/ocr', { method: 'POST', body: JSON.stringify({ fotoBase64: fotoBase64Atual }) });
    const precos = (resp && resp.precos) || {};
    let ilegiveis = [];
    let lidos = 0;
    ['gc','ga','et','s10','s500'].forEach(k => {
      const el = document.getElementById('preco-' + k);
      if (!el) return;
      const v = precos[k];
      if (typeof v === 'number' && isFinite(v)) {
        el.value = String(Math.round(v * 100));
        formatPrecoInput(el);
        lidos++;
      } else if (v === 'ilegivel') {
        ilegiveis.push(k.toUpperCase());
      }
      // 'ausente' ou sem valor: deixa como está
    });
    if (ilegiveis.length) {
      setAviso('Li ' + lidos + ' preço(s). Não consegui ler: ' + ilegiveis.join(', ') + ' — confira e digite.', true);
    } else if (lidos) {
      setAviso('Preços lidos pela IA — confira antes de salvar.', true);
    } else {
      setAviso('Não consegui ler os preços — digite manualmente.', true);
    }
  } catch (err) {
    setAviso('Erro ao ler a foto (' + (err && err.message ? err.message : 'tente de novo') + '). Digite manualmente.', true);
  }
}

// Redimensiona via canvas (máx. 1600px no lado maior, sem aumentar imagens
// menores) e reexporta como JPEG qualidade 0.7. Chama cb com o dataURL
// comprimido; em qualquer falha, chama cb com o dataURL original (não quebra
// o fluxo do gerente).
function comprimirFoto(dataUrlOriginal, cb) {
  try {
    const MAX = 1600;
    const img = new Image();
    img.onload = () => {
      try {
        const escala = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala);
        const h = Math.round(img.height * escala);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return cb(dataUrlOriginal);
        ctx.drawImage(img, 0, 0, w, h);
        const comprimida = canvas.toDataURL('image/jpeg', 0.7);
        cb(comprimida && comprimida.startsWith('data:image/jpeg') ? comprimida : dataUrlOriginal);
      } catch (e) {
        cb(dataUrlOriginal);
      }
    };
    img.onerror = () => cb(dataUrlOriginal);
    img.src = dataUrlOriginal;
  } catch (e) {
    cb(dataUrlOriginal);
  }
}

function atualizarEstadoSalvar() {
  const btn = document.getElementById('btn-salvar-coleta');
  // Preços TODOS opcionais: alguns concorrentes não vendem certos combustíveis
  // (ex: Rede Flex Amazonas não vende Gasolina Comum). Obrigatórios: concorrente, foto e localização.
  const faixaOk = validarFaixaPrecos();
  const pronto = concorrenteSelecionado && faixaOk && fotoBase64Atual;
  btn.disabled = !pronto;
  btn.textContent = pronto ? '💾 SALVAR COLETA' : '🔒 PREENCHA OS CAMPOS OBRIGATÓRIOS';
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'btn-salvar-coleta' && !e.target.disabled) {
    salvarColeta();
  }
});

async function salvarColeta() {
  const btn = document.getElementById('btn-salvar-coleta');
  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';

  const payload = {
    concorrenteId: concorrenteSelecionado.id,
    tipo: ehProprioPosto(concorrenteSelecionado.nome) ? 'Próprio' : 'Concorrente',
    lat: localizacaoAtual ? localizacaoAtual.lat : null,
    lng: localizacaoAtual ? localizacaoAtual.lng : null,
    fotoBase64: fotoBase64Atual,
  };
  combustiveisMapeados.forEach(c => {
    const val = parseFloat(document.getElementById(`preco-${c.coluna}`)?.dataset.val || '0');
    payload[c.coluna] = val > 0 ? val : null;
  });

  try {
    const resp = await apiFetch('/coletas', { method: 'POST', body: JSON.stringify(payload) });
    mostrarToast('✅ Coleta salva!', `${resp.concorrente} — ${resp.data} às ${resp.hora}`);
    resetarFormulario();
    await carregarHistorico(usuarioAtual.posto.nome);
  } catch (err) {
    mostrarToast('❌ Erro ao salvar', err.message);
    btn.disabled = false;
    btn.textContent = '💾 SALVAR COLETA';
  }
}

function resetarFormulario() {
  document.getElementById('select-concorrente').value = '';
  concorrenteSelecionado = null;
  combustiveisMapeados.forEach(c => {
    const input = document.getElementById(`preco-${c.coluna}`);
    if (input) { input.value = '0,00'; input.dataset.val = '0'; }
  });
  localizacaoAtual = null;
  document.getElementById('geo-status').textContent = 'Localização não capturada';
  document.getElementById('btn-geo').textContent = '📍 Capturar localização';
  fotoBase64Atual = null;
  document.getElementById('input-foto-camera').value = '';
  document.getElementById('input-foto-galeria').value = '';
  document.getElementById('foto-preview').style.display = 'none';
  document.getElementById('foto-preview-placeholder').style.display = 'flex';
  validarFaixaPrecos();
  atualizarEstadoSalvar();
}

async function carregarHistorico(nomePosto) {
  const body = document.getElementById('historico-body');
  try {
    const resp = await apiFetch(`/coletas?posto=${encodeURIComponent(nomePosto)}&dias=15`);
    const registros = (resp.registros || []).slice(0, 10);
    if (!registros.length) {
      body.innerHTML = '<div class="empty-state">Nenhuma coleta registrada ainda.</div>';
      return;
    }
    body.innerHTML = registros.map(r => `
      <div class="historico-row">
        <div>
          <div class="historico-alvo">${r.postoAlvo}</div>
          <div class="historico-data">${r.data} às ${r.hora}</div>
        </div>
        <div class="historico-precos">
          ${['GC','GA','ET','S10','S500'].filter(k => r[k]).map(k => `<span>${k}: R$ ${Number(r[k]).toFixed(2).replace('.', ',')}</span>`).join('')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    body.innerHTML = `<div class="empty-state">⚠ Erro ao carregar histórico: ${err.message}</div>`;
  }
}

function mostrarToast(titulo, msg) {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-title').textContent = titulo;
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}
