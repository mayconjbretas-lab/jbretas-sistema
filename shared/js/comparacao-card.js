// ================================================================
// JBRETAS SISTEMA — shared/js/comparacao-card.js
// Card da aba Comparação (matriz Você / concorrentes / Sugerido),
// extraído de modulos/admin/app.js. Antes disto o mesmo card vivia
// duplicado em modulos/admin/app.js e modulos/painel-adm/app.js; as
// duas cópias eram idênticas nas 9 declarações movidas (conferido por
// diff função a função antes da extração — só divergiam no fim de
// linha, LF no admin e CRLF no painel-adm).
//
// SÓ O CARD. O lápis (cmpEditarVoce / cmpConfirmarVoce /
// cmpSalvarPrecoProprio / cmpCriarSolicitacao) fica no app.js de cada
// painel: ele fala com a API e mexe em estado do módulo.
//
// OS FILTROS VIRARAM PARÂMETRO, e não import implícito. As funções liam
// seis `let` de módulo do app.js: G_CMP_FUEL, G_CMP_STRAT, G_CMP_ORD,
// G_CMP_ABAIXO, G_CMP_ACIMA e G_CMP_SO_MUDOU. Dentro de um IIFE a
// referência solta continuaria resolvendo pela cadeia de escopo global —
// e era justamente por funcionar POR ACIDENTE que não podia ficar: o
// módulo passaria a depender de nomes que só existem em dois arquivos, e
// uma terceira tela que o carregasse quebraria em tempo de execução, sem
// aviso nenhum em tempo de carga.
//
// O CÓDIGO MOVIDO FICA NA COLUNA 0, e não indentado dentro do IIFE: o
// return final do cmpCardMatriz é um template literal de 7 linhas, e
// indentar o bloco meteria 2 espaços DENTRO da string — o HTML sairia
// diferente do que as duas telas produzem hoje. Feio, mas verbatim.
//
// Uso: window.cmpCardMatriz(posto, dado, pos, opcoes)
//   opcoes = { fuel, strat, ord, abaixo, acima, soMudou }
// Carregar ANTES do app.js do módulo: ele consome fmtPrecoBRL,
// seloDesatualizado, idSafe e CMP_FUELS_CARD daqui (cmpCardMudancas e
// o resto da tela ainda usam os quatro por fora).
// ================================================================
(function () {
  'use strict';

  // Defaults = valores iniciais daqueles let no app.js, para que chamar
  // sem `opcoes` dê exatamente o estado de tela recém-carregada.
  function norm(opcoes) {
    const o = opcoes || {};
    return {
      fuel:    o.fuel    !== undefined ? o.fuel    : 'GC',
      strat:   o.strat   !== undefined ? o.strat   : 'avg',
      ord:     o.ord     !== undefined ? o.ord     : '',
      abaixo:  !!o.abaixo,
      acima:   !!o.acima,
      soMudou: !!o.soMudou,
    };
  }
  // ── Constantes ────────────────────────────────────────────────
const CMP_FUELS_CARD = [
  { key: 'GC',   btn: 'GC',   nome: 'comum' },
  { key: 'GA',   btn: 'GA',   nome: 'aditivada' },
  { key: 'ET',   btn: 'ET',   nome: 'etanol' },
  { key: 'S10',  btn: 'S10',  nome: 'diesel S10' },
  { key: 'S500', btn: 'S500', nome: 'diesel S500' },
];

  // ── Formatação ────────────────────────────────────────────────
function fmtPrecoBRL(v) {
  if (v === null || v === undefined || v === '' || v === '-') return '--';
  return 'R$' + Number(v).toFixed(2).replace('.', ',');
}

  // Selo pra valor que não é de hoje — não esconde o dado, só avisa.
function seloDesatualizado(registro) {
  if (!registro || !registro.data) return '';
  return ` <span style="font-size:.6rem;color:var(--wn)">· dado de ${registro.data}</span>`;
}

  // id seguro pra usar em id="" de célula (mesma regra do id do card).
function idSafe(k) { return String(k).replace(/[^a-zA-Z0-9]/g, '_'); }

  // ── Cálculo ───────────────────────────────────────────────────
function cmpCalcularSugerido(min, avg, max, strat) {
  if (strat === 'agg')  return min - 0.01;
  if (strat === 'prem') return max + 0.01;
  return avg;
}

function cmpCalcCard(dado, f, opcoes) {
  const op = norm(opcoes);
  const ownVal = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined)
    ? Number(dado.proprio[f]) : null;
  const competidores = dado.concorrentes
    .map(c => ({
      nome: c.nome,
      preco: (c.registro[f] !== null && c.registro[f] !== undefined) ? Number(c.registro[f]) : null,
      desatualizado: c.desatualizado,
      registro: c.registro,
      ontem: (c.registroOntem && c.registroOntem[f] !== null && c.registroOntem[f] !== undefined)
        ? Number(c.registroOntem[f]) : null,
    }))
    .filter(c => c.preco !== null)
    .filter(c => !op.soMudou || (!c.desatualizado && c.ontem !== null && Math.abs(c.preco - c.ontem) >= 0.005))
    .sort((a, b) => a.preco - b.preco);
  return { ownVal, competidores };
}

  // min/avg/max dos concorrentes de um posto para um combustível.
function cmpStatsFuel(dado, f) {
  const precos = dado.concorrentes
    .map(c => (c.registro[f] !== null && c.registro[f] !== undefined) ? Number(c.registro[f]) : null)
    .filter(v => v !== null);
  if (!precos.length) return null;
  return { min: Math.min(...precos), max: Math.max(...precos), avg: precos.reduce((a, b) => a + b, 0) / precos.length };
}

  // Sugerido por combustível: GC/ET/S10/S500 pela estratégia sobre os
  // próprios concorrentes; GA = alvoGC + diferencial DO POSTO
  // (dado.diferencial_ga, padrão 0,30), ignorando concorrentes de GA.
function cmpSugeridoMatriz(dado, opcoes) {
  const op = norm(opcoes);
  const out = {};
  const gc = cmpStatsFuel(dado, 'GC');
  const alvoGC = gc ? cmpCalcularSugerido(gc.min, gc.avg, gc.max, op.strat) : null;
  out.GC = alvoGC;
  const difGa = (dado && dado.diferencial_ga != null) ? Number(dado.diferencial_ga) : 0.30;
  out.GA = (alvoGC !== null) ? alvoGC + difGa : null;
  ['ET', 'S10', 'S500'].forEach(f => {
    const s = cmpStatsFuel(dado, f);
    out[f] = s ? cmpCalcularSugerido(s.min, s.avg, s.max, op.strat) : null;
  });
  return out;
}

  // ── Render ────────────────────────────────────────────────────
  // Monta o card no formato MATRIZ (colunas = fuels; linhas = Você /
  // cada concorrente / Sugerido).
function cmpCardMatriz(posto, dado, pos, opcoes) {
  const op = norm(opcoes);
  const cols = CMP_FUELS_CARD; // GC, GA, ET, S10, S500
  // Prefixo de posição (dourado) só quando a lista está ordenada por preço.
  const posPrefix = pos ? `<span style="color:var(--accent)">${pos}º </span>` : '';
  const idk = idSafe(posto.k);
  const kSafe = String(posto.k).replace(/'/g, "\\'");

  // preço próprio por fuel (já com overlay de revisão aplicado em proprio)
  const own = {};
  cols.forEach(f => {
    const v = (dado.proprio && dado.proprio[f.key] !== null && dado.proprio[f.key] !== undefined) ? Number(dado.proprio[f.key]) : null;
    own[f.key] = v;
  });

  const thead = `<tr><th class="cmpm-rowlbl"></th>${cols.map(f => `<th><span class="cmpm-colh">${f.btn}</span></th>`).join('')}</tr>`;

  // linha Você — lápis só nos fuels com valor
  const voceCells = cols.map(f => {
    const v = own[f.key];
    if (v === null) return `<td class="cmpm-cell" id="cmpm-voce-${idk}-${f.key}"><span class="cmpm-na">—</span></td>`;
    return `<td class="cmpm-cell cmpm-voce" id="cmpm-voce-${idk}-${f.key}">`
      + `<span class="cmpm-preco">${fmtPrecoBRL(v)}</span>`
      + ` <span class="cmpm-pen" title="Editar nosso preço" onclick="cmpEditarVoce('${kSafe}','${f.key}')">✏️</span></td>`;
  }).join('');
  const desatSelo = dado.proprioDesatualizado ? seloDesatualizado(dado.proprio) : '';
  const fOrd = op.fuel;                                    // fuel do ranking
  const ordAtivo = (op.ord === 'barato' || op.ord === 'caro');

  // Descritor da linha Você (preço de ranking = próprio no fuel ativo).
  const voceObj = { tipo: 'voce', preco: own[fOrd], label: `Você${desatSelo}`, cells: voceCells };

  // Descritores dos concorrentes (célula = preço + diff, igual a antes).
  const concObjs = dado.concorrentes.map(c => {
    const cells = cols.map(f => {
      const cv = (c.registro[f.key] !== null && c.registro[f.key] !== undefined) ? Number(c.registro[f.key]) : null;
      if (cv === null) return `<td class="cmpm-cell"><span class="cmpm-na">—</span></td>`;
      const ov = own[f.key];
      let diff = '';
      if (ov !== null) {
        const d = cv - ov;
        const igual = Math.abs(d) < 0.005;
        const cor = igual ? 'var(--wn)' : (d < 0 ? 'var(--dg)' : 'var(--ok)');
        const txt = igual ? 'igual' : (d > 0 ? '+' : '') + Math.round(d * 100) + 'c';
        diff = ` <span class="cmpm-diff" style="color:${cor}">${txt}</span>`;
      }
      // Destaque de filtro: SÓ na coluna do combustível ativo (op.fuel) e
      // só com o filtro correspondente ligado. Mesmo critério do esconder.
      let hl = '';
      if (f.key === op.fuel) {
        if (ov !== null) {
          const d = cv - ov;
          if (op.abaixo && d < -0.005)     hl += ' cmpm-hl-abaixo';
          else if (op.acima && d > 0.005)  hl += ' cmpm-hl-acima';
        }
      }
      return `<td class="cmpm-cell${hl}"><span class="cmpm-preco">${fmtPrecoBRL(cv)}</span>${diff}</td>`;
    }).join('');
    const nomeLbl = c.nome + (c.desatualizado ? seloDesatualizado(c.registro) : '');
    const preco = (c.registro && c.registro[fOrd] != null) ? Number(c.registro[fOrd]) : null;
    return { tipo: 'conc', preco, label: nomeLbl, title: c.nome, registro: c.registro, cells };
  });

  // Ordem das linhas dentro do card:
  //  - ordenação ATIVA: Você + concorrentes juntos, por preço no fuel ativo
  //    (asc no 'barato', desc no 'caro'); linhas sem preço no fuel vão pro fim.
  //  - desligada: layout atual (Você no topo; concorrentes por GC desc cascata).
  const ORDEM_DESEMPATE = ['GC', 'GA', 'ET', 'S10', 'S500'];
  let linhas;
  if (ordAtivo) {
    linhas = [voceObj, ...concObjs].sort((a, b) => {
      if (a.preco === null && b.preco === null) return 0;
      if (a.preco === null) return 1;
      if (b.preco === null) return -1;
      return op.ord === 'barato' ? a.preco - b.preco : b.preco - a.preco;
    });
  } else {
    // slice() pra não mutar; sem valor conta como -Infinity (vai pro fim).
    const concOrd = concObjs.slice().sort((a, b) => {
      for (const f of ORDEM_DESEMPATE) {
        const va = (a.registro && a.registro[f] != null) ? Number(a.registro[f]) : -Infinity;
        const vb = (b.registro && b.registro[f] != null) ? Number(b.registro[f]) : -Infinity;
        if (vb !== va) return vb - va;
      }
      return 0;
    });
    linhas = [voceObj, ...concOrd];
  }

  // Renderiza cada linha; com ordenação ativa, nº interno (dourado, discreto)
  // nas linhas COM preço no fuel e 📌 na linha Você (que agora flutua).
  let nInt = 0;
  const linhasHtml = linhas.map(o => {
    let prefixo = '';
    if (ordAtivo && o.preco !== null) { nInt += 1; prefixo = `<span class="cmpm-posint">${nInt}º</span> `; }
    const pin = (ordAtivo && o.tipo === 'voce') ? '📌 ' : '';
    const thCls = 'cmpm-rowlbl' + (o.tipo === 'conc' ? ' cmpm-conc' : '');
    const titleAttr = o.title ? ` title="${o.title}"` : '';
    const trCls = o.tipo === 'voce' ? ' class="cmpm-row-voce"' : '';
    return `<tr${trCls}><th class="${thCls}"${titleAttr}>${prefixo}${pin}${o.label}</th>${o.cells}</tr>`;
  }).join('');

  // Mensagem de vazio quando não há concorrentes (Você continua acima).
  const concVazio = concObjs.length === 0
    ? `<tr><td class="cmpm-vazio" colspan="${cols.length + 1}">Sem concorrente coletado</td></tr>`
    : '';

  // linha Sugerido — SEMPRE fixa no rodapé, fora do ranking. GA mostra o
  // diferencial REAL do posto: "(GC+20)"/"(GC+30)"; se for 0, "(= GC)".
  const sug = cmpSugeridoMatriz(dado, opcoes);
  const difCentsGa = Math.round(((dado && dado.diferencial_ga != null) ? Number(dado.diferencial_ga) : 0.30) * 100);
  const gaHint = difCentsGa === 0 ? '(= GC)' : (difCentsGa > 0 ? `(GC+${difCentsGa})` : `(GC-${Math.abs(difCentsGa)})`);
  const sugCells = cols.map(f => {
    const s = sug[f.key];
    if (s === null || s === undefined) return `<td class="cmpm-cell"><span class="cmpm-na">—</span></td>`;
    const hint = f.key === 'GA' ? ` <span class="cmpm-hint">${gaHint}</span>` : '';
    return `<td class="cmpm-cell cmpm-sug"><span class="cmpm-preco">${fmtPrecoBRL(s)}</span>${hint}</td>`;
  }).join('');
  const sugRow = `<tr class="cmpm-row-sug"><th class="cmpm-rowlbl">Sugerido</th>${sugCells}</tr>`;

  return `<div class="region-card" id="cmp-card-${idk}">
    <div class="region-hdr"><span class="region-nome">${posPrefix}${posto.ap}</span></div>
    <div class="cmpm-wrap"><table class="cmpm-table">
      <thead>${thead}</thead>
      <tbody>${linhasHtml}${concVazio}${sugRow}</tbody>
    </table></div>
  </div>`;
}


  // ── Ida e volta com a API ─────────────────────────────────────
  // As três abaixo são as ÚNICAS do card que falam com o servidor. Vieram
  // depois do resto (o card puro foi extraído primeiro) porque elas eram a
  // parte que parecia presa ao painel — e não era: só liam a data de hoje e
  // o G_COMPARACAO, que agora entra por parâmetro.
  //
  // apiFetch e normalizarNomePosto NÃO foram arrastados: já são globais de
  // shared/js/api.js e shared/js/coletas-service.js, carregados nas duas
  // telas. cmpHojeISO veio junto por ser local ao app.js e não ter mais
  // nenhum outro chamador lá.

  // Data de hoje YYYY-MM-DD a partir do horário LOCAL (evita drift de UTC).
  // Mesma convenção do hojeISO() da aba Coleta — é a data usada no POST/GET
  // de coleta-revisao.
function cmpHojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

  // Sobrepõe no "Você" os preços já revisados HOJE. Recebe o mapa da
  // comparação, MUTA e devolve — antes lia o G_COMPARACAO do app.js por
  // escopo global, o que prendia o módulo a um nome que só existe em dois
  // arquivos.
  //
  // Falha em silêncio de propósito (console.warn, sem throw): sem o overlay
  // a matriz ainda serve, mostrando o preço coletado cru. Foi assim que o
  // 403 da LOGISTICA passou despercebido até alguém comparar os números.
async function cmpAplicarRevisoes(comparacao) {
  try {
    const resp = await apiFetch('/coleta-revisao?data=' + cmpHojeISO());
    (resp.linhas || []).forEach(l => {
      if (l.preco_editado === null || l.preco_editado === undefined) return;
      const chave = normalizarNomePosto(l.posto_nome || '');
      const dado = comparacao[chave];
      if (!dado) return;
      if (!dado.proprio) dado.proprio = {};
      dado.proprio[l.combustivel] = Number(l.preco_editado);
    });
  } catch (err) {
    console.warn('Não foi possível aplicar revisões na matriz:', err && err.message);
  }
  return comparacao;
}

  // Grava a revisão do preço próprio. Devolve true/false; o alert fica aqui
  // porque as duas telas reagem igual ao erro.
async function cmpSalvarPrecoProprio(postoNome, combustivel, precoEditado, precoOriginal) {
  try {
    await apiFetch('/coleta-revisao', {
      method: 'POST',
      body: JSON.stringify({
        posto_nome: postoNome,
        data: cmpHojeISO(),
        combustivel,
        preco_editado: precoEditado,
        preco_original: precoOriginal,
      }),
    });
    return true;
  } catch (err) {
    alert('Erro ao salvar preço: ' + (err && err.message ? err.message : 'tente de novo'));
    return false;
  }
}

  // Abre a solicitação para o gerente confirmar na bomba. Chamada DEPOIS do
  // cmpSalvarPrecoProprio: se esta falhar, o preço já está salvo e o aviso
  // diz exatamente isso.
async function cmpCriarSolicitacao(postoNome, combustivel, precoAntigo, precoNovo) {
  try {
    await apiFetch('/solicitacoes-preco', {
      method: 'POST',
      body: JSON.stringify({
        posto_nome:   postoNome,
        combustivel,
        preco_antigo: (precoAntigo === null || precoAntigo === undefined) ? null : precoAntigo,
        preco_novo:   precoNovo,
      }),
    });
    return true;
  } catch (err) {
    alert('Preço salvo, mas falhou ao solicitar confirmação do gerente: ' + (err && err.message ? err.message : 'tente de novo'));
    return false;
  }
}

  // ── Superfície pública ────────────────────────────────────────
  // As quatro do card, mais os auxiliares que o app.js de cada módulo
  // ainda usa por fora: cmpCardMudancas consome CMP_FUELS_CARD e
  // seloDesatualizado, e fmtPrecoBRL aparece ~27x no admin.
  window.cmpCardMatriz       = cmpCardMatriz;
  window.cmpCalcCard         = cmpCalcCard;
  window.cmpStatsFuel        = cmpStatsFuel;
  window.cmpSugeridoMatriz   = cmpSugeridoMatriz;
  window.cmpCalcularSugerido = cmpCalcularSugerido;
  window.CMP_FUELS_CARD      = CMP_FUELS_CARD;
  window.fmtPrecoBRL         = fmtPrecoBRL;
  window.seloDesatualizado   = seloDesatualizado;
  window.idSafe              = idSafe;
  window.cmpAplicarRevisoes    = cmpAplicarRevisoes;
  window.cmpSalvarPrecoProprio = cmpSalvarPrecoProprio;
  window.cmpCriarSolicitacao   = cmpCriarSolicitacao;
  window.cmpHojeISO            = cmpHojeISO;
})();
