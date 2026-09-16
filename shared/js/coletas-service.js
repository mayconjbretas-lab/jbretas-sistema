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
async function buscarColetasAgrupadas({ posto = null, dias = 15, data = null } = {}) {
  const params = new URLSearchParams();
  if (posto) params.set('posto', posto);
  if (data) params.set('data', data);   // data específica: backend ignora `dias`
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

// ── Datas em ISO (YYYY-MM-DD), para a Comparação retroativa ───────
// O registro do GET /coletas traz `data` em DD/MM/YYYY (o que hojeBR/ontemBR
// comparam) E `dataISO` em YYYY-MM-DD. Ordenação e comparação usam o ISO:
// string BR não ordena ('02/01' > '01/12' é falso como texto).
function hojeISOLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoParaBRData(iso) {
  const p = String(iso || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '';
}
// Constrói a partir dos componentes (não de Date.parse) porque 'YYYY-MM-DD'
// solto é lido como UTC e, em GMT-3, volta um dia.
function isoSomandoDias(iso, n) {
  const p = String(iso).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function diasEntreISO(de, ate) {
  const a = String(de).split('-').map(Number), b = String(ate).split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

// Junta N mapas de buscarColetasAgrupadas num só, NA ORDEM EM QUE VIERAM.
// A ordem é o contrato: todo o resto do serviço lê grupo.proprio[0] como "o
// mais recente", então o mapa do dia mais novo tem de ser o primeiro da lista.
function fundirGrupos(grupos) {
  const junto = {};
  grupos.forEach(g => {
    Object.keys(g || {}).forEach(chave => {
      if (!junto[chave]) junto[chave] = { proprio: [], concorrentes: [] };
      junto[chave].proprio.push(...g[chave].proprio);
      junto[chave].concorrentes.push(...g[chave].concorrentes);
    });
  });
  return junto;
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
// `data` (YYYY-MM-DD) desloca o "hoje" da comparação: o card passa a ser o
// daquele dia, e o `ontem` de cada concorrente é o dia ANTERIOR A ELE. Sem
// `data`, nada muda — é exatamente a chamada de sempre.
async function buscarComparacaoDoDia({ dias = 15, data = null } = {}) {
  const alvoISO = data || hojeISOLocal();
  const atras   = Math.max(0, diasEntreISO(alvoISO, hojeISOLocal()));
  const anteriorISO = isoSomandoDias(alvoISO, -1);
  // DIA ESCOLHIDO: duas chamadas ?data= (o dia e o anterior), e não uma janela
  // por `dias`. A janela não serve porque o corte do backend é por QUANTIDADE:
  // ele ordena data desc e aplica .limit() — a ~185 coletas/dia, o teto de 5000
  // cobre 27 dias, e a partir daí o dia pedido cai fora do corte e a tela mostra
  // VAZIO, sem erro, igual a "ninguém lançou naquele dia". Medido: 26 dias atrás
  // devolve 37 de 37 postos, 27 dias atrás devolve 0 de 37.
  //
  // O ?data= não depende de `limit`: devolve o dia inteiro em qualquer
  // profundidade, e são ~370 registros no lugar de 3.300–5.000.
  //
  // DOIS dias porque é disso que o card precisa: o alvo, e o anterior para o
  // registroOntem de cada concorrente. O alvo vem PRIMEIRO na concatenação —
  // grupo.proprio[0] tem de continuar sendo o mais recente.
  //
  // O que muda: posto sem coleta no alvo NEM no dia anterior aparece vazio, em
  // vez de cair num dia mais antigo pelo fallback. Em data retroativa é o certo
  // — pediram AQUELE dia. O caminho de hoje não passa por aqui.
  const porPosto = atras > 0
    ? fundirGrupos(await Promise.all([
        buscarColetasAgrupadas({ data: alvoISO }),
        buscarColetasAgrupadas({ data: anteriorISO }),
      ]))
    : await buscarColetasAgrupadas({ dias });
  const hoje  = isoParaBRData(alvoISO);
  const ontem = isoParaBRData(anteriorISO);

  // Diferencial GA por posto (GA sugerido = GC + diferencial), vindo do banco via
  // GET /postos — que faz select('*'), então a coluna diferencial_ga já vem. É
  // chaveado igual ao `resultado` (chavePostoParaK sobre o nome do posto), para o
  // cálculo do sugerido casar por posto. NÃO-FATAL: se /postos falhar, o mapa fica
  // vazio e o frontend cai no padrão 0,30 — a Comparação nunca quebra por isso.
  const difGaPorChave = {};
  try {
    const rp = await apiFetch('/postos');
    (rp.postos || []).forEach(p => {
      if (p && p.nome != null && p.diferencial_ga != null) {
        difGaPorChave[chavePostoParaK(p.nome)] = Number(p.diferencial_ga);
      }
    });
  } catch (e) {
    console.warn('diferencial_ga dos postos indisponível (usando padrão 0,30):', e && e.message);
  }

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
        // rede vem normalizada do master (GET /coletas junta concorrentes); '-' = sem rede.
        rede: (ultimo.rede && ultimo.rede !== '-') ? ultimo.rede : null,
        registro: ultimo,
        desatualizado: ultimo.data !== hoje,
        registroOntem: registros.find(r => r.data === ontem) || null,
      };
    });

    resultado[chave] = { proprio, proprioDesatualizado, concorrentes,
      diferencial_ga: (chave in difGaPorChave) ? difGaPorChave[chave] : null };
  });
  return resultado;
}

window.normalizarNomePosto = normalizarNomePosto;
window.ehColetaPropria = ehColetaPropria;
window.buscarColetasAgrupadas = buscarColetasAgrupadas;
window.buscarComparacaoDoDia = buscarComparacaoDoDia;
window.hojeBR = hojeBR;
window.ontemBR = ontemBR;
window.hojeISOLocal = hojeISOLocal;
window.isoParaBRData = isoParaBRData;
