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

// Mapa nome-do-banco → chave .k do MAP_POSTOS (resolve postos cujo posto_nome
// gravado difere do .k oficial). Chave já sem "P.", sem acento, uppercase.
const ALIAS_CHAVE_POSTO = {
  'DUDU': 'BARBOSA - DUDU',
  'PAIVA E PAIVA COMBUSTIVEL': 'BEATRIZ',
};

// Deriva a chave de agrupamento que casa com o .k do MAP_POSTOS:
// tira "P.", remove acento, colapsa espaços, e resolve alias banco→.k.
function chavePostoParaK(nome) {
  const base = semAcentoComparacao(String(nome).replace(/^P\.\s*/i, ''));
  return ALIAS_CHAVE_POSTO[base] || base;
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

// Fonte AUTORITATIVA = o campo `tipo` que o GET /coletas devolve. Desde o
// fix da Beatriz (13/07/2026) o POST /coletas decide `tipo` pela coluna
// estrutural postos.auto_concorrente_id ('Próprio' quando o concorrente
// coletado é o concorrente-de-si; senão 'Concorrente'). Classificamos SÓ
// por esse campo. NÃO comparamos mais nome de posto (o método antigo) —
// foi exatamente a comparação de nome, via alias divergente, que quebrou a
// Beatriz. Sem `tipo` explícito de própria → conta como concorrente (mesmo
// default do backend p/ coleta ambígua).
function ehColetaPropria(registro) {
  const tipo = String(registro.tipo || '').trim().toUpperCase();
  return tipo === 'PRÓPRIO' || tipo === 'PROPRIO';
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
    const chave = chavePostoParaK(r.posto);
    if (!porPosto[chave]) porPosto[chave] = { proprio: [], concorrentes: [] };
    (ehColetaPropria(r) ? porPosto[chave].proprio : porPosto[chave].concorrentes).push(r);
  });
  return porPosto;
}

function hojeBR() {
  return new Date().toLocaleDateString('pt-BR');
}

function ontemBR() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('pt-BR');
}

// Comparação do dia por posto, com FALLBACK pro último dado conhecido
// em vez de zerar à meia-noite (requisito crítico — o AppPainel antigo
// zerava tudo até o primeiro gerente lançar no dia, deixando o painel
// inútil de manhã cedo). Cada valor (próprio e por concorrente) vem
// junto com um flag `desatualizado` quando não é de hoje, pra UI
// mostrar o selo "dado de DD/MM" sem esconder a informação.
//
// { [postoNormalizado]: {
//     proprio: registro | null, proprioDesatualizado: bool,
//     concorrentes: [{ nome, bandeira, registro, desatualizado, registroOntem }]
// } }
async function buscarComparacaoDoDia({ dias = 15 } = {}) {
  const porPosto = await buscarColetasAgrupadas({ dias });
  const hoje = hojeBR();
  const ontem = ontemBR();

  const resultado = {};
  Object.keys(porPosto).forEach(chave => {
    const grupo = porPosto[chave];

    const proprioHoje = grupo.proprio.find(r => r.data === hoje) || null;
    const proprioUltimo = grupo.proprio[0] || null; // já vem desc por data/hora
    const proprio = proprioHoje || proprioUltimo;
    const proprioDesatualizado = !!proprio && proprio.data !== hoje;

    const porConcorrente = {};
    grupo.concorrentes.forEach(r => {
      const nome = r.postoAlvo;
      if (!nome || nome === '-') return;
      if (!porConcorrente[nome]) porConcorrente[nome] = [];
      porConcorrente[nome].push(r);
    });
    const concorrentes = Object.keys(porConcorrente).map(nome => {
      const registros = porConcorrente[nome]; // desc por data/hora
      const ultimo = registros[0];
      return {
        nome,
        bandeira: (ultimo.bandeira && ultimo.bandeira !== '-') ? ultimo.bandeira : null,
        registro: ultimo,
        desatualizado: ultimo.data !== hoje,
        registroOntem: registros.find(r => r.data === ontem) || null,
      };
    });

    resultado[chave] = { proprio, proprioDesatualizado, concorrentes };
  });
  return resultado;
}

window.normalizarNomePosto = normalizarNomePosto;
window.ehColetaPropria = ehColetaPropria;
window.buscarColetasAgrupadas = buscarColetasAgrupadas;
window.buscarComparacaoDoDia = buscarComparacaoDoDia;
window.hojeBR = hojeBR;
window.ontemBR = ontemBR;
