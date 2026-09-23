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
      // Botão "✓ Conferir" no cabeçalho do card. OPT-IN, e falso por padrão,
      // porque o mesmo cmpCardMatriz monta o card da Logística — que não tem
      // (nem deve ter) a marcação de conferido. Só painel-adm e admin ligam.
      conferir: !!o.conferir,
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
    <div class="region-hdr"><span class="region-nome">${posPrefix}${posto.ap}</span>${op.conferir ? cmpBtnConferir(posto) : ''}</div>
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

  // ── Conferido por posto (sentinela GERAL) ─────────────────────
  // A aba Coleta marca o posto conferido gravando combustivel='GERAL' com
  // status='conferido' em coleta_revisao (POST /coleta-revisao/conferir) e lê
  // de volta a MESMA linha no GET. A Comparação passa a ler e escrever essa
  // mesma linha — conferir num lugar aparece no outro, sem tabela nova.
  //
  // O conjunto é preenchido pelo cmpAplicarRevisoes (a leitura já existia;
  // antes as linhas GERAL eram descartadas junto com todo preco_editado nulo).
  let _cmpConferidos = new Set();   // chaves de posto (as mesmas do MAP_POSTOS .k)
  let _cmpDataRev    = null;        // data da última leitura — é nela que o POST grava

  // Sobrepõe no "Você" os preços já revisados NA DATA. Recebe o mapa da
  // comparação, MUTA e devolve — antes lia o G_COMPARACAO do app.js por
  // escopo global, o que prendia o módulo a um nome que só existe em dois
  // arquivos.
  //
  // `data` (YYYY-MM-DD) é opcional: sem ela é hoje, como sempre foi — é o que
  // mantém a Logística (que chama com um argumento só) no dia corrente.
  //
  // Falha em silêncio de propósito (console.warn, sem throw): sem o overlay
  // a matriz ainda serve, mostrando o preço coletado cru. Foi assim que o
  // 403 da LOGISTICA passou despercebido até alguém comparar os números.
async function cmpAplicarRevisoes(comparacao, data) {
  const dia = data || cmpHojeISO();
  _cmpDataRev    = dia;
  _cmpConferidos = new Set();
  try {
    const resp = await apiFetch('/coleta-revisao?data=' + dia);
    (resp.linhas || []).forEach(l => {
      const chave = normalizarNomePosto(l.posto_nome || '');
      // Sentinela do posto: não tem preço, marca o posto inteiro. Sai antes do
      // teste de preco_editado — é justamente por ser nulo que ela caía fora.
      if (l.combustivel === 'GERAL') {
        if (chave && l.status === 'conferido') _cmpConferidos.add(chave);
        return;
      }
      if (l.preco_editado === null || l.preco_editado === undefined) return;
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

  // Só ADM. O guard de verdade é o da rota (server.js recusa 403 para os
  // demais); esconder aqui evita oferecer um botão que sempre daria erro.
function cmpPodeConferir() {
  const u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
  return !!(u && u.perfil === 'ADM');
}
function cmpEhConferido(k) { return _cmpConferidos.has(k); }
function cmpQtdConferidos() { return _cmpConferidos.size; }

  // Botão do cabeçalho do card. String vazia quando não se aplica — quem
  // chama concatena sem condicional, e a Logística (que não passa
  // opcoes.conferir) recebe '' e segue com o cabeçalho de hoje.
function cmpBtnConferir(posto) {
  if (!posto || !cmpPodeConferir()) return '';
  if (cmpEhConferido(posto.k)) {
    return '<button type="button" class="cmp-conf on" disabled ' +
      'title="Posto conferido — marcado nesta tela ou na aba Coleta">✓ Conferido</button>';
  }
  return '<button type="button" class="cmp-conf" onclick="cmpConferir(this,&#39;' +
    at(posto.k) + '&#39;,&#39;' + at(posto.ap) + '&#39;)" ' +
    'title="Marcar como conferido (sem alteração)">✓ Conferir</button>';
}

  // MESMO payload do csConfirmar da aba Coleta (coleta-revisao.js:784):
  // { posto_nome, data }. posto_nome é o .ap do MAP_POSTOS — é o que a Coleta
  // manda (lá o campo se chama posto.nome, preenchido com mp.ap) e o backend
  // resolve nome->id. A data é a da LEITURA, não hoje: conferindo um dia
  // passado a marca tem de cair naquele dia, senão o F5 não a traz de volta.
async function cmpConferir(btn, k, nome) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  const antes = btn.textContent;
  btn.textContent = '…';
  try {
    await apiFetch('/coleta-revisao/conferir', {
      method: 'POST',
      body: JSON.stringify({ posto_nome: nome, data: _cmpDataRev || cmpHojeISO() }),
    });
  } catch (err) {
    // Volta o botão ao estado clicável: sem isto um erro de rede deixaria o
    // posto travado em '…' até recarregar, parecendo conferido.
    btn.disabled = false;
    btn.textContent = antes;
    alert('Erro ao marcar conferido: ' + (err && err.message ? err.message : 'tente de novo'));
    return;
  }
  _cmpConferidos.add(k);
  btn.classList.add('on');
  btn.textContent = '✓ Conferido';
  btn.title = 'Posto conferido — marcado nesta tela ou na aba Coleta';
  cmpPintarContador();
}

  // Contador "N de 37 conferidos". Mesmo id nos dois painéis, então a
  // atualização mora aqui e nenhum app.js precisa de um hook próprio.
  // Silencioso quando o elemento não existe (Logística não tem contador).
function cmpPintarContador() {
  const el = document.getElementById('cmp-conf-contador');
  if (!el) return;
  const tot = (typeof MAP_POSTOS !== 'undefined') ? MAP_POSTOS.length : 0;
  el.textContent = cmpQtdConferidos() + ' de ' + tot + ' conferidos';
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


  // ── Lápis inline ──────────────────────────────────────────────
  // Editar o preço próprio direto na célula "Você". Ligado por onclick
  // inline que o cmpCardMatriz emite, e é isso que força os dois ganchos
  // abaixo: atributo HTML só carrega string, então nem o objeto do posto
  // nem a função de re-render podem chegar por parâmetro.
  //
  //   window.cmpDadoDoPosto(k)    -> devolve o `dado` daquele posto
  //   window.cmpAposSalvarPreco(ctx) -> o que a TELA faz depois de salvar
  //
  // ctx = { k, fuel, posto, dado, novo, orig, salvou, flashFuels }.
  // Sem os ganchos definidos o lápis vira no-op silencioso em vez de
  // estourar ReferenceError numa tela que só quer ver a matriz.
  const dadoDoPosto = (k) =>
    (typeof window.cmpDadoDoPosto === 'function') ? window.cmpDadoDoPosto(k) : null;
  const aposSalvar = async (ctx) => {
    if (typeof window.cmpAposSalvarPreco === 'function') await window.cmpAposSalvarPreco(ctx);
  };

function cmpEditarVoce(k, f) {
  const cell = document.getElementById(`cmpm-voce-${idSafe(k)}-${f}`);
  if (!cell) return;
  const dado = dadoDoPosto(k);
  const orig = (dado && dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined) ? Number(dado.proprio[f]) : null;
  const val = orig !== null ? orig.toFixed(2).replace('.', ',') : '';
  const kSafe = String(k).replace(/'/g, "\\'");
  cell.innerHTML = `<input class="cmpm-input" id="cmpm-inp-${idSafe(k)}-${f}" type="text" inputmode="decimal"
    value="${val}"
    onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
    onblur="cmpConfirmarVoce('${kSafe}','${f}')">`;
  const inp = document.getElementById(`cmpm-inp-${idSafe(k)}-${f}`);
  if (inp) { inp.focus(); inp.select(); }
}

  // "619" → 6.19 (só dígitos = centavos); "6,19"/"6.19" → 6.19 (decimal direto).
function cmpParsePreco(str) {
  const s = String(str || '').trim();
  if (!s) return NaN;
  if (/[.,]/.test(s)) return parseFloat(s.replace(',', '.'));
  const digits = s.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) / 100 : NaN;
}

async function cmpConfirmarVoce(k, f) {
  const inp = document.getElementById(`cmpm-inp-${idSafe(k)}-${f}`);
  if (!inp || inp.dataset.saving === '1') return;
  const dado = dadoDoPosto(k);
  const posto = MAP_POSTOS.find(p => p.k === k);
  if (!dado || !posto) { await aposSalvar({ k, fuel: f, posto: null, dado: null, novo: null, orig: null, salvou: false, flashFuels: [] }); return; }

  const novo = cmpParsePreco(inp.value);
  const orig = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined) ? Number(dado.proprio[f]) : null;

  // inválido/vazio ou sem mudança → cancela sem salvar
  if (isNaN(novo) || novo <= 0) { await aposSalvar({ k, fuel: f, posto, dado, novo, orig, salvou: false, flashFuels: [] }); return; }
  if (orig !== null && Math.abs(novo - orig) < 0.005) { await aposSalvar({ k, fuel: f, posto, dado, novo, orig, salvou: false, flashFuels: [] }); return; }

  inp.dataset.saving = '1';
  const flashFuels = []; // fuels que geraram solicitação (feedback ✓)
  const ok = await cmpSalvarPrecoProprio(posto.ap, f, novo, orig);
  if (ok) {
    if (!dado.proprio) dado.proprio = {};
    dado.proprio[f] = novo; // overlay local (reflete na hora + persiste no reload via cmpAplicarRevisoes)
    // Solicitação SEMPRE que o preço mudou (posto.ap, NÃO .nome). O guard de
    // "sem mudança" acima já retornou, mas reconfere por segurança.
    if ((orig === null || Math.abs(novo - orig) >= 0.005)
        && await cmpCriarSolicitacao(posto.ap, f, orig, novo)) flashFuels.push(f);
  }

  // Daqui para baixo é da TELA, não do card: recarregar, re-renderizar, o
  // convite do GA. Cada painel define o seu em window.cmpAposSalvarPreco.
  await aposSalvar({ k, fuel: f, posto, dado, novo, orig, salvou: ok, flashFuels });
}

  // Feedback leve: ✓ dourado rápido na célula "Você" do combustível editado
  // (após o re-render da tela já ter recriado a célula).
function cmpFlashCheck(k, f) {
  const cell = document.getElementById(`cmpm-voce-${idSafe(k)}-${f}`);
  if (!cell) return;
  const chk = document.createElement('span');
  chk.textContent = ' ✓';
  chk.style.color = 'var(--ac)';
  chk.style.fontWeight = '700';
  chk.style.transition = 'opacity .6s';
  cell.appendChild(chk);
  setTimeout(() => { chk.style.opacity = '0'; }, 500);
  setTimeout(() => { if (chk.parentNode) chk.parentNode.removeChild(chk); }, 1200);
}


  // ── Faixa de fotos da placa ───────────────────────────────────
  // Nasceu na Logística e subiu para cá quando o ADM passou a querer as
  // mesmas miniaturas embaixo da matriz. Devolve string, não DOM: quem
  // chama concatena no HTML do card, do mesmo jeito que faz com a matriz.
  //
  // PRÓPRIO × CONCORRENTE SÓ PELA ESTRUTURA. dado.proprio é a coleta do
  // nosso posto, dado.concorrentes a dos vizinhos — quem separou foi o
  // campo `tipo` do GET /coletas, lá no coletas-service. Aqui não se
  // compara nome de posto: foi a comparação por nome que quebrou a
  // Beatriz uma vez.
  //
  // Sem foto → SEM miniatura, e não um quadro cinza: o operador precisa
  // saber que aquela coleta veio sem prova, não ver um buraco decorado.
  function cmpFotosHtml(posto, dado) {
    const itens = [];
    // O NOME DO POSTO DO CARD vai em TODAS as miniaturas, inclusive nas dos
    // concorrentes. Na tira ele é óbvio (a foto está dentro do card); no
    // lightbox, que agora atravessa postos, é a única coisa que diz em que
    // bloco se está — "ALAMO" sozinho não responde "vizinho de quem?".
    const doCard = posto && posto.ap ? posto.ap : '';
    const fotoPropria = dado && dado.proprio && dado.proprio.foto;
    if (fotoPropria && fotoPropria !== '-') {
      itens.push(mini(fotoPropria, '🏠 ' + posto.ap, posto.ap, dado.proprio.hora, true, doCard));
    }
    ((dado && dado.concorrentes) || []).forEach(c => {
      const f = c.registro && c.registro.foto;
      if (!f || f === '-') return;
      itens.push(mini(f, c.nome, c.nome, c.registro.hora, false, doCard));
    });
    if (!itens.length) {
      return '<div class="cmpf-fotos cmpf-vazia">Sem fotos nesta coleta</div>';
    }
    return '<div class="cmpf-fotos">' + itens.join('') + '</div>';
  }

  // Escapa para atributo HTML. A legenda e o nome vêm do banco.
  const at = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // onclick INLINE, e não delegação: é o mesmo padrão do lápis, e poupa
  // cada tela de ligar um listener no container certo. A aspa simples na
  // URL vira %27 antes de entrar no atributo (mesma defesa do csZoom).
  function mini(url, etiqueta, nome, hora, ehMeu, postoDoCard) {
    // HH:MM, sem os segundos. O `hora` do GET /coletas vem 'HH:MM:SS' e o
    // ':00' do fim não diz nada a quem confere foto — só rouba largura na
    // legenda do lightbox, onde o nome do posto já é longo. slice e não
    // regex: hora malformada encurta em vez de virar string vazia.
    const quando = (hora && hora !== '-' ? ' · coletado ' + String(hora).slice(0, 5) : '');
    const legenda = nome + quando;
    // data-legenda usa a ETIQUETA, que traz o 🏠 na nossa. Navegando pelo
    // lightbox o rótulo é a ÚNICA coisa que diz qual foto é a nossa: a borda
    // azul do .meu fica na tira, não no lightbox. O 2º argumento segue com a
    // legenda sem 🏠 — é só o fallback de quem chamar sem tira.
    const legendaLb = etiqueta + quando;
    const u = String(url).replace(/'/g, '%27');
    return '<figure class="' + (ehMeu ? 'meu' : 'conc') + '">' +
      '<img loading="lazy" src="' + at(url) + '" alt="' + at(etiqueta) + '"' +
        ' data-legenda="' + at(legendaLb) + '"' +
        ' data-posto="' + at(postoDoCard || '') + '"' +
        ' onclick="cmpAbrirFoto(&#39;' + at(u) + '&#39;,&#39;' + at(legenda) + '&#39;,this)">' +
      '<figcaption>' + at(etiqueta) + '</figcaption>' +
    '</figure>';
  }

  // ── Lightbox ──────────────────────────────────────────────────
  // Fecha no fundo, no ✕ e no Esc — NUNCA ao tocar a imagem. Fechar sem
  // querer custa reabrir o posto todo, e foi reclamação real na tela de
  // revisão de coleta. As SETAS também não fecham: são filhas do fundo, e o
  // handler trata a seta ANTES de testar o fundo.
  //
  // ════════ A NAVEGAÇÃO ATRAVESSA OS CARDS ════════
  // Era dentro do MESMO card: chegar na última foto de um posto e a seta
  // voltava para a primeira dele. Quem confere a rua inteira tinha de fechar,
  // rolar até o próximo posto e abrir de novo, uma vez por posto.
  //
  // Agora a sequência é a da TELA: Araponga (nossa) → concorrente → …→ Aviva
  // (nossa) → concorrente → … A ordem sai do DOM, que já está na ordem dos
  // cards, então ordenar a grade (alfabética, por bandeira, filtrada) reordena
  // o lightbox junto, sem ninguém sincronizar nada.
  //
  // O ESCOPO É DESCOBERTO, NÃO CRAVADO: sobe do card até o primeiro ancestral
  // que contém MAIS DE UMA tira. Assim o mesmo código serve a .cl-rail da
  // Logística, à grade do painel-adm e à do admin, sem conhecer o seletor de
  // nenhum. Se só houver uma tira na tela (card aberto sozinho, mobile de um
  // posto), o laço chega ao body e a lista é a daquele card — o comportamento
  // de antes.
  //
  // A LISTA É TIRADA NO CLIQUE, não guardada: redesenhos (recarga de 5 min,
  // filtro) trocam o DOM, e uma lista velha apontaria para nós que não
  // existem mais. Enquanto o lightbox está aberto ela é estável, que é o que
  // importa.
  let _lbFotos = [];
  let _lbIdx   = 0;

  function lbEscopo(tira) {
    let el = tira.parentElement;
    while (el && el !== document.body) {
      if (el.querySelectorAll('.cmpf-fotos').length > 1) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  function lbDaTira(origem) {
    const tira = (origem && origem.closest) ? origem.closest('.cmpf-fotos') : null;
    if (!tira) return null;
    const imgs = [].slice.call(lbEscopo(tira).querySelectorAll('.cmpf-fotos img'));
    if (!imgs.length) return null;
    return {
      // alt como reserva: miniatura de HTML antigo em cache não tem
      // data-legenda, e legenda vazia é pior que legenda sem a hora.
      lista: imgs.map(im => ({
        url: im.getAttribute('src'),
        legenda: im.getAttribute('data-legenda') || im.getAttribute('alt') || '',
        posto: im.getAttribute('data-posto') || '',
      })),
      idx: Math.max(0, imgs.indexOf(origem)),
    };
  }

  // "P. ARAPONGA · ALAMO · coletado 08:31" — o posto do card na frente.
  // A NOSSA foto não repete o nome: a etiqueta dela já é "🏠 P. ARAPONGA".
  function lbLegenda(f) {
    if (!f) return '';
    const base = f.legenda || '';
    if (!f.posto || base.indexOf('🏠') === 0 || base.indexOf(f.posto) === 0) return base;
    return f.posto + ' · ' + base;
  }

  // Repinta src/alt/legenda no MESMO <img> em vez de remontar o lightbox:
  // remontar recriaria o nó a cada seta e piscaria o fundo escuro inteiro.
  function lbPintar() {
    const cx = document.querySelector('.cmpf-lightbox');
    const f  = _lbFotos[_lbIdx];
    if (!cx || !f) return;
    const im  = cx.querySelector('.cmpf-lb-fig img');
    const cap = cx.querySelector('.cmpf-lb-fig figcaption');
    const txt = lbLegenda(f);
    if (im)  { im.setAttribute('src', f.url); im.setAttribute('alt', txt); }
    if (cap) { cap.textContent = txt; }   // textContent: nada a escapar
  }

  // CIRCULAR: da última vai para a primeira e vice-versa. Com 3 a 5 fotos por
  // card, esbarrar num fim de lista que não anda lê como travamento.
  function cmpNavFoto(passo) {
    const n = _lbFotos.length;
    if (n < 2) return;
    _lbIdx = (_lbIdx + passo + n) % n;
    lbPintar();
  }

  function cmpAbrirFoto(url, legenda, origem) {
    cmpFecharFoto();
    const tira = lbDaTira(origem);
    _lbFotos = tira ? tira.lista
                    : [{ url: String(url), legenda: String(legenda == null ? '' : legenda), posto: '' }];
    _lbIdx   = tira ? tira.idx : 0;
    const cx = document.createElement('div');
    cx.className = 'cmpf-lightbox';
    // Foto única não ganha seta: duas setas que só dão voltas em si mesmas
    // prometem uma navegação que não existe.
    const setas = _lbFotos.length > 1
      ? '<button type="button" class="cmpf-lb-nav ant" aria-label="Foto anterior">‹</button>' +
        '<button type="button" class="cmpf-lb-nav prox" aria-label="Próxima foto">›</button>'
      : '';
    cx.innerHTML =
      '<button type="button" class="cmpf-lb-x" aria-label="Fechar">✕</button>' +
      setas +
      '<figure class="cmpf-lb-fig">' +
        '<img src="" alt=""><figcaption></figcaption>' +
      '</figure>';
    cx.addEventListener('click', (e) => {
      const seta = (e.target.closest) ? e.target.closest('.cmpf-lb-nav') : null;
      if (seta) { cmpNavFoto(seta.classList.contains('prox') ? 1 : -1); return; }
      if (e.target === cx || (e.target.closest && e.target.closest('.cmpf-lb-x'))) cmpFecharFoto();
    });
    document.body.appendChild(cx);
    lbPintar();
    document.addEventListener('keydown', teclaFoto);
  }

  function cmpFecharFoto() {
    const el = document.querySelector('.cmpf-lightbox');
    if (el) el.remove();
    _lbFotos = []; _lbIdx = 0;
    document.removeEventListener('keydown', teclaFoto);
  }
  // preventDefault nas setas: sem ele a seta rola a página por baixo do
  // lightbox, e ao fechar o card não está mais onde estava.
  function teclaFoto(e) {
    if (e.key === 'Escape')     { cmpFecharFoto();  return; }
    if (e.key === 'ArrowRight') { cmpNavFoto(1);  e.preventDefault(); return; }
    if (e.key === 'ArrowLeft')  { cmpNavFoto(-1); e.preventDefault(); }
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
  window.cmpEditarVoce         = cmpEditarVoce;
  window.cmpConfirmarVoce      = cmpConfirmarVoce;
  window.cmpFlashCheck         = cmpFlashCheck;
  window.cmpParsePreco         = cmpParsePreco;
  window.cmpFotosHtml          = cmpFotosHtml;
  window.cmpAbrirFoto          = cmpAbrirFoto;
  window.cmpFecharFoto         = cmpFecharFoto;
  window.cmpNavFoto            = cmpNavFoto;
  window.cmpBtnConferir        = cmpBtnConferir;
  window.cmpConferir           = cmpConferir;
  window.cmpPodeConferir       = cmpPodeConferir;
  window.cmpEhConferido        = cmpEhConferido;
  window.cmpQtdConferidos      = cmpQtdConferidos;
  window.cmpPintarContador     = cmpPintarContador;
})();
