// ================================================================
// JBRETAS SISTEMA — shared/js/coletas-service.js
// Serviço compartilhado de leitura de coletas: busca GET /coletas e
// separa os registros em "próprio" (preço do posto do gerente,
// mostrado na placa dele mesmo) e "concorrentes" (preços da
// concorrência), agrupados por posto.
//
// Consumido por: mapa de postos (admin/mapa-precos — só usa .proprio,
// pra status/preço do próprio posto) e, nas próximas etapas, pela
// tela de swipe do painel admin e pelas abas Comparar/Histórico
// (Fase 2), que vão consumir .concorrentes também.
//
// Critério híbrido: registros novos já vêm com tipo = 'Próprio' ou
// 'Concorrente' direto da fonte (/sync/coleta e POST /coletas, ambos
// no server.js, calculam isso na gravação). Registros legados que
// ainda não passaram pela migração (tipo = '-' ou qualquer valor não
// migrado) caem no fallback: mesma comparação normalizada usada no
// backend (posto_nome vs posto_alvo, sem acento/case/espaço) — ver
// inferirTipoColeta() em jbretas-api/server.js, que usa a mesma regra.
// ================================================================

function normalizarNomePosto(nome) {
  return String(nome).replace(/^P\.\s*/i, '').trim().toUpperCase();
}

// Remove acentos pra comparação de texto (não confundir com
// normalizarNomePosto acima, que só tira o prefixo "P." pra casar
// nome de exibição com chave do MAP_POSTOS).
function semAcentoComparacao(str) {
  return Array.from(String(str || '').normalize('NFD'))
    .filter(ch => ch.charCodeAt(0) < 128)
    .join('')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// Apelidos usados no campo POSTO ALVO da coleta própria (planilha)
// que não batem com o nome oficial do posto — mesmo conceito do
// ALIASES_POSTO do AppPainel antigo. Chave já normalizada (ver
// semAcentoComparacao), valor é o nome oficial que ela resolve.
// Único lugar onde esse mapa vive nesta camada — mesma lista
// replicada em jbretas-api/server.js no backend.
const ALIASES_POSTO = {
  'P. LOURA':   'P. LOURA EMPREENDIMENTOS',
  'P. MIRAGEM': 'P. MIRAGEM JBRETAS',
  'P. BEATRIZ': 'PAIVA E PAIVA COMBUSTIVEL',
};

function resolverAliasPosto(nome) {
  const normalizado = semAcentoComparacao(nome);
  return ALIASES_POSTO[normalizado] || nome;
}

function ehColetaPropria(registro) {
  const tipo = String(registro.tipo || '').trim().toUpperCase();
  if (tipo === 'PRÓPRIO' || tipo === 'PROPRIO') return true;
  if (tipo === 'CONCORRENTE') return false;
  // fallback pra legado ainda não migrado — resolve apelido do
  // posto_alvo antes de comparar
  const alvoResolvido = resolverAliasPosto(registro.postoAlvo);
  return semAcentoComparacao(registro.posto) === semAcentoComparacao(alvoResolvido);
}

// Busca coletas (via GET /coletas, já autenticado) e agrupa por posto
// normalizado: { [postoNormalizado]: { proprio: [...], concorrentes: [...] } }.
// Cada lista mantém a ordem que a API já retorna (mais recente primeiro).
async function buscarColetasAgrupadas({ posto = null, dias = 15 } = {}) {
  const params = new URLSearchParams();
  if (posto) params.set('posto', posto);
  params.set('dias', dias);
  const resp = await apiFetch(`/coletas?${params.toString()}`);
  const registros = resp.registros || [];

  const porPosto = {};
  registros.forEach(r => {
    const chave = normalizarNomePosto(r.posto);
    if (!porPosto[chave]) porPosto[chave] = { proprio: [], concorrentes: [] };
    (ehColetaPropria(r) ? porPosto[chave].proprio : porPosto[chave].concorrentes).push(r);
  });
  return porPosto;
}

function hojeBR() {
  return new Date().toLocaleDateString('pt-BR');
}

window.normalizarNomePosto = normalizarNomePosto;
window.ehColetaPropria = ehColetaPropria;
window.buscarColetasAgrupadas = buscarColetasAgrupadas;
window.hojeBR = hojeBR;
