// ================================================================
// JBRETAS SISTEMA — shared/js/grade-card.js
// O CARD de posto da tela de pedido do dia (Logística): as duas metades
// pedido | medição, a % da capacidade do tanque e o comentário de célula.
//
// COMPARTILHADO entre modulos/logistica (desktop) e modulos/logistica-mobile.
// Os dois desenham o MESMO card: o desktop pelo renderGrade e o celular pelo
// renderGradeMobile, cada um no seu host, mas os dois chamando o montarCard
// daqui. Nasceu dentro do app.js do desktop e saiu para cá quando o celular
// passou a precisar dele — copiar as ~200 linhas era garantir que as duas
// telas divergissem na primeira correção de faixa de cor ou de rótulo.
//
// ════════ O QUE ESTE ARQUIVO ESPERA DE QUEM O CARREGA ════════
// Ele é carregado ANTES do app.js do módulo e só DEFINE funções; tudo abaixo
// é lido na hora da chamada, quando o app.js já existe. O contrato:
//
//   fmtNum(v) · esc(s) · apiFetch(url, opts)   funções do módulo/shared
//   _gradeData        a data selecionada (ISO), para o rótulo e o POST
//   _gradeTanques     { posto_id: { COD: capacidade } } da resposta
//   _gradeComentarios a coluna medicao.comentario existe?
//   _gradePostos      os postos em mão, para o cache do comentário
//
// São `let` no topo do app.js de cada módulo — escopo de script, que scripts
// clássicos do mesmo documento dividem. Só um dos dois app.js carrega por
// página, então não há choque de nome.
// ================================================================
// ════════ CARD DIVIDIDO: PEDIDO | MEDIÇÃO ════════
// A metade esquerda é o card de antes (pedido do dia, uma linha por
// combustível pedido). A direita é a MEDIÇÃO que o gerente lançou no mesmo
// dia, que vem na mesma resposta de /medicao/pedido-dia — a rota passou a
// ler a coluna `medicao` da mesma linha de onde já lia o `pedido`, sem
// chamada nova.
//
// ════════ % DA CAPACIDADE, E NÃO pedido − medição ════════
// A linha "Dif. pedido − medição" existiu aqui e SAIU: ela dava negativo em
// 37 postos de 37 em 15/09/2026, porque somava grandezas de naturezas
// diferentes — a medição é o ESTOQUE de todos os combustíveis e o pedido é a
// reposição, só dos que estão sendo repostos. O P. BAHAMAS, sem pedido e com
// 14.673 L no tanque, aparecia como "tanque baixo".
//
// O que substitui é a pergunta certa: quanto do tanque está cheio. Medição ÷
// capacidade, por combustível, com a capacidade somada dos tanques ATIVOS
// daquele posto e combustível (a rota devolve em `tanques`, da mesma tabela e
// com a mesma soma que a GET /sugestao-pedido usa). Em 15/09 isto separa de
// verdade: 60 células verdes, 75 âmbares e 22 vermelhas.
//
// O TOTAL DO POSTO É O MENOR PERCENTUAL, não a média: o que decide a viagem
// é o combustível que acaba primeiro. O P. ESPAÇO REAL tem S500 a 62% e
// etanol a 19% — a média (36%) diria que está confortável, e o menor diz que
// o etanol vai faltar.
var COR_PEDIDO = '#0F6E56', COR_MEDICAO = '#185FA5';
// As faixas do pedido. Acima de 50% verde, 25–50% âmbar, abaixo de 25%
// vermelho. O limite de baixo é EXCLUSIVO em 50 e INCLUSIVO em 25, então 50%
// cravado é âmbar e 25% cravado é âmbar — só abaixo de 25 fica vermelho.
function faixaPct(pct) {
  if (pct === null || pct === undefined || !isFinite(pct)) return '';
  if (pct > 50) return 'gm-pct--alto';
  if (pct >= 25) return 'gm-pct--medio';
  return 'gm-pct--baixo';
}

// Uma célula de medição. Ela é o alvo do comentário, então carrega posto e
// combustível no próprio nó: o menu de contexto e o editor leem de lá em vez
// de procurar o card pai.
function celulaMedicao(p, cod, valor, comentario, capacidade) {
  var tem = !!comentario;
  // SEM CAPACIDADE CADASTRADA mostra só a medição, sem percentual: dividir
  // por uma capacidade que não existe daria Infinity, e inventar um
  // denominador seria pior que não responder. Em 15/09 isto não acontece —
  // os 157 pares posto×combustível com medição têm tanque ativo —, mas um
  // combustível novo entra sem tanque cadastrado antes de entrar com.
  var cap = Number(capacidade);
  var temCap = isFinite(cap) && cap > 0;
  var pct = temCap ? (Number(valor) / cap * 100) : null;
  var valHtml = temCap
    ? '<span class="gm-litros">' + fmtNum(valor) + ' L / ' + fmtNum(cap) + ' L</span>' +
      ' · <span class="gm-pct ' + faixaPct(pct) + '">' + Math.round(pct) + '%</span>'
    : '<span class="gm-litros">' + fmtNum(valor) + ' L</span>';
  return '<div class="gm-cel' + (tem ? ' gm-cel--com' : '') + '"' +
    ' data-pid="' + esc(String(p.posto_id)) + '"' +
    ' data-comb="' + esc(cod) + '"' +
    (temCap ? ' data-cap="' + esc(String(cap)) + '" data-pct="' + esc(String(Math.round(pct))) + '"' : '') +
    (tem ? ' data-com="' + esc(comentario) + '" title="' + esc(comentario) + '"' : '') +
    ' oncontextmenu="__gmMenu(event, this)" onclick="__gmClique(event, this)">' +
    '<span class="grade-cl-cod">' + esc(cod) + '</span>' +
    '<span class="grade-cl-val">' + valHtml + '</span>' +
    // O triângulo é irmão do valor, não pseudo-elemento: assim o harness o
    // encontra por seletor e o leitor de tela o ignora (aria-hidden).
    (tem ? '<span class="gm-tri" aria-hidden="true"></span>' : '') +
    '<span class="gm-add" title="Comentar" aria-hidden="true">🗨</span>' +
  '</div>';
}

// O rótulo da metade da medição. Com a data IGUAL à do pedido continua
// "Medição do dia", que é o que a tela sempre disse; quando a medição é de
// antes, o rótulo passa a trazer o dia — "Medição 16/09". Sem isso o card
// anunciaria um estoque de ontem como se fosse de hoje, e é justamente o
// caso comum: o pedido de hoje é para amanhã, e amanhã ainda não foi medido.
function rotuloMedicao(p, dataPedido) {
  var dm = p.data_medicao;
  if (!dm || dm === dataPedido) return 'Medição do dia';
  // dd/mm, sem o ano: a data do pedido está no cabeçalho da grade, e o ano
  // repetido em 37 cards não informa nada.
  var pt = String(dm).split('-');
  return pt.length === 3 ? 'Medição ' + pt[2] + '/' + pt[1] : 'Medição do dia';
}

function montarCard(p, montado) {
  var pc = p.por_combustivel || {};
  var mpc = p.medicao_por_combustivel || {};
  var com = p.comentarios || {};
  var linhas = Object.keys(pc).filter(function (k) { return Number(pc[k]) > 0; }).map(function (k) {
    return '<div class="grade-cl"><span class="grade-cl-cod">' + esc(k) + '</span>' +
      '<span class="grade-cl-val">' + fmtNum(pc[k]) + '</span></div>';
  }).join('');
  var cap = (_gradeTanques && _gradeTanques[p.posto_id]) || {};
  var medLinhas = Object.keys(mpc).map(function (k) {
    return celulaMedicao(p, k, mpc[k], com[k], cap[k]);
  }).join('');
  var temMed = p.medicao_total !== null && p.medicao_total !== undefined;
  // MENOR percentual entre os combustíveis do posto — ver o bloco de cima.
  var menor = null;
  Object.keys(mpc).forEach(function (k) {
    var c = Number(cap[k]);
    if (!isFinite(c) || c <= 0) return;
    var pc = Number(mpc[k]) / c * 100;
    if (menor === null || pc < menor) menor = pc;
  });
  var band = p.bandeira ? '<span class="grade-band">' + esc(p.bandeira) + '</span>' : '';
  var on = montado.has(String(p.posto_id)) ? ' grade-card--montado' : '';
  var semPed = (Number(p.total) || 0) <= 0 ? ' grade-card--sem-pedido' : '';
  // Card inteiro alterna "montado"; o NOME abre a matriz reduzida; o lápis edita.
  return '<div class="grade-card grade-card--split' + on + semPed + '" data-pid="' + esc(String(p.posto_id)) + '" data-nome="' + esc(p.posto_nome || '') + '" onclick="__gradeToggle(this)">' +
    '<div class="grade-card-top">' +
      '<span class="grade-posto" data-nome="' + esc(p.posto_nome || '') + '" onclick="__gradeAbrir(event, this)">' + esc(p.posto_nome || '—') + '</span>' +
      '<span class="grade-top-r"><span class="grade-check">✓</span>' + band +
        '<span class="grade-lapis" title="Editar pedido" onclick="__gradeLapis(event, this)">✏️</span></span>' +
    '</div>' +
    '<div class="grade-split">' +
      '<div class="grade-meia grade-meia--ped">' +
        '<div class="grade-meia-rot">Pedido final</div>' +
        '<div class="grade-total">' + fmtNum(p.total) + ' L</div>' +
        '<div class="grade-cls">' + (linhas || '<span class="grade-sem-tag">sem pedido</span>') + '</div>' +
      '</div>' +
      '<div class="grade-meia grade-meia--med">' +
        '<div class="grade-meia-rot' + (p.data_medicao && p.data_medicao !== _gradeData ? ' grade-meia-rot--atras' : '') + '">' +
          esc(rotuloMedicao(p, _gradeData)) + '</div>' +
        (temMed
          ? '<div class="grade-total grade-total--med">' + fmtNum(p.medicao_total) + ' L' +
              (menor === null ? ''
                : '<span class="gm-menor ' + faixaPct(menor) + '">' + Math.round(menor) +
                  '% no mais baixo</span>') +
            '</div>' +
            '<div class="grade-cls">' + medLinhas + '</div>'
          : '<span class="grade-sem-tag">sem medição</span>') +
      '</div>' +
    '</div>' +
  '</div>';
}

// ════════ COMENTÁRIO DE CÉLULA (estilo Excel) ════════
// Triângulo vermelho no canto = a célula tem comentário. Clique mostra;
// botão direito abre o menu (inserir / editar / excluir). O texto vive em
// medicao.comentario — a mesma linha do número, ver o cabeçalho da
// POST /logistica/comentario-medicao.
//
// TUDO PARA stopPropagation: o card inteiro tem onclick que alterna
// "montado". Sem isso, comentar uma célula marcaria o posto como montado.
var _gmMenuEl = null, _gmPopEl = null;

function gmFechar() {
  if (_gmMenuEl && _gmMenuEl.parentNode) _gmMenuEl.parentNode.removeChild(_gmMenuEl);
  if (_gmPopEl && _gmPopEl.parentNode) _gmPopEl.parentNode.removeChild(_gmPopEl);
  _gmMenuEl = null; _gmPopEl = null;
}
// Fecha ao clicar fora, ao rolar e no Esc. Os três: o menu é flutuante e
// posicionado em coordenada de tela, então rolar o deixaria órfão no lugar.
document.addEventListener('click', function (e) {
  if (_gmMenuEl && !_gmMenuEl.contains(e.target)) gmFechar();
  else if (_gmPopEl && !_gmPopEl.contains(e.target) && !(e.target.closest && e.target.closest('.gm-cel'))) gmFechar();
}, true);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') gmFechar(); });
window.addEventListener('scroll', function () { gmFechar(); }, true);

function gmFlutuante(cls, x, y) {
  var el = document.createElement('div');
  el.className = cls;
  // Preso ao body e em position:fixed: dentro do card ele seria cortado pelo
  // overflow do .grade-scroll.
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  document.body.appendChild(el);
  return el;
}

// Clique na célula: mostra o comentário, se houver. Sem comentário o clique
// não faz nada (e não alterna o card).
function __gmClique(ev, cel) {
  ev.stopPropagation();
  var txt = cel.getAttribute('data-com');
  gmFechar();
  if (!txt) return;
  var r = cel.getBoundingClientRect();
  _gmPopEl = gmFlutuante('gm-pop', r.left, r.bottom + 4);
  _gmPopEl.textContent = txt;
}

// Botão direito: menu próprio, sem o do navegador.
function __gmMenu(ev, cel) {
  ev.preventDefault();
  ev.stopPropagation();
  gmFechar();
  if (!_gradeComentarios) {
    var r0 = cel.getBoundingClientRect();
    _gmPopEl = gmFlutuante('gm-pop gm-pop--erro', r0.left, r0.bottom + 4);
    _gmPopEl.textContent = 'comentário indisponível: falta aplicar sql/medicao_comentario.sql';
    return;
  }
  var tem = !!cel.getAttribute('data-com');
  _gmMenuEl = gmFlutuante('gm-menu', ev.clientX, ev.clientY);
  var opcoes = tem
    ? [['Editar comentário', 'editar'], ['Excluir comentário', 'excluir']]
    : [['Inserir comentário', 'editar']];
  opcoes.forEach(function (o) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'gm-menu-item' + (o[1] === 'excluir' ? ' gm-menu-item--del' : '');
    b.textContent = o[0];
    b.onclick = function (e) {
      e.stopPropagation();
      gmFechar();
      if (o[1] === 'excluir') gmSalvar(cel, null);
      else gmEditor(cel);
    };
    _gmMenuEl.appendChild(b);
  });
}

// Ícone 🗨 que aparece no hover: o mesmo caminho do "Inserir/Editar".
document.addEventListener('click', function (e) {
  var add = e.target.closest && e.target.closest('.gm-add');
  if (!add) return;
  e.stopPropagation();
  e.preventDefault();
  var cel = add.closest('.gm-cel');
  if (!cel) return;
  if (!_gradeComentarios) { __gmMenu(e, cel); return; }
  gmFechar();
  gmEditor(cel);
}, true);

// Textarea flutuante. Ctrl+Enter salva, Esc cancela — as duas teclas que
// alguém tenta num campo de comentário.
function gmEditor(cel) {
  var r = cel.getBoundingClientRect();
  _gmPopEl = gmFlutuante('gm-editor', r.left, r.bottom + 4);
  var ta = document.createElement('textarea');
  ta.className = 'gm-ta';
  ta.value = cel.getAttribute('data-com') || '';
  ta.maxLength = 500;
  ta.placeholder = 'Comentário desta célula…';
  var acoes = document.createElement('div');
  acoes.className = 'gm-acoes';
  var bc = document.createElement('button');
  bc.type = 'button'; bc.className = 'gm-cancelar'; bc.textContent = 'Cancelar';
  bc.onclick = function (e) { e.stopPropagation(); gmFechar(); };
  var bs = document.createElement('button');
  bs.type = 'button'; bs.className = 'gm-salvar'; bs.textContent = 'Salvar';
  bs.onclick = function (e) { e.stopPropagation(); gmSalvar(cel, ta.value); };
  acoes.appendChild(bc); acoes.appendChild(bs);
  _gmPopEl.appendChild(ta); _gmPopEl.appendChild(acoes);
  _gmPopEl.onclick = function (e) { e.stopPropagation(); };
  ta.onkeydown = function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); gmFechar(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); gmSalvar(cel, ta.value); }
  };
  ta.focus();
}

// Grava e atualiza a célula NO LUGAR: re-renderizar a grade fecharia todos
// os cards e perderia a rolagem por causa de um comentário.
async function gmSalvar(cel, texto) {
  var pid = cel.getAttribute('data-pid');
  var comb = cel.getAttribute('data-comb');
  var txt = (texto === null || texto === undefined) ? null : String(texto).trim();
  if (txt === '') txt = null;
  gmFechar();
  cel.classList.add('gm-cel--salvando');
  try {
    await apiFetch('/logistica/comentario-medicao', {
      method: 'POST',
      body: JSON.stringify({ posto_id: pid, data: _gradeData, combustivel: comb, comentario: txt }),
    });
    gmPintarCelula(cel, txt);
    // O cache também, senão o próximo render da grade ressuscita o antigo.
    var p = _gradePostos.filter(function (x) { return String(x.posto_id) === String(pid); })[0];
    if (p) {
      if (!p.comentarios) p.comentarios = {};
      if (txt) p.comentarios[comb] = txt; else delete p.comentarios[comb];
    }
  } catch (err) {
    window.alert('Não foi possível salvar o comentário: ' + ((err && err.message) ? err.message : err));
  } finally {
    cel.classList.remove('gm-cel--salvando');
  }
}

function gmPintarCelula(cel, txt) {
  var tri = cel.querySelector('.gm-tri');
  if (txt) {
    cel.setAttribute('data-com', txt);
    cel.setAttribute('title', txt);
    cel.classList.add('gm-cel--com');
    if (!tri) {
      var t = document.createElement('span');
      t.className = 'gm-tri';
      t.setAttribute('aria-hidden', 'true');
      cel.insertBefore(t, cel.querySelector('.gm-add'));
    }
  } else {
    cel.removeAttribute('data-com');
    cel.removeAttribute('title');
    cel.classList.remove('gm-cel--com');
    if (tri && tri.parentNode) tri.parentNode.removeChild(tri);
  }
}
