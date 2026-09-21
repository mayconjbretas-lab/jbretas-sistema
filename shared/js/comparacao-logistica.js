// ================================================================
// JBRETAS SISTEMA — shared/js/comparacao-logistica.js
// Seção "Comparação de preços" da aba Alteração de Preços (Logística).
// Renderiza em #sl-comparacao, acima da lista de solicitações.
//
// NÃO REIMPLEMENTA O CARD. A matriz é o mesmo cmpCardMatriz do
// shared/js/comparacao-card.js que o admin e o painel-adm usam, chamado com
// a mesma assinatura e com um `opcoes` congelado nos valores INICIAIS dos
// G_CMP_* do admin (fuel GC, estratégia avg, sem ordenação e sem os chips de
// abaixo/acima/só-quem-mudou). A Logística não tem barra de filtros; se um dia
// tiver, é só trocar CMP_OPCOES por estado.
//
// DOIS CAMINHOS PARA EDITAR, o mesmo desfecho. O lápis da célula "Você" é o
// cmpEditarVoce/cmpConfirmarVoce do shared (ganhou vida aqui quando a regra
// que o escondia saiu do comparacao.css); o formulário do rodapé do card é
// desta tela, e existe porque mostra erro inline em vez de alert e
// pré-preenche com o Sugerido. Os dois terminam no mesmo
// window.cmpAposSalvarPreco, definido no fim deste arquivo.
//
// PRÓPRIO × CONCORRENTE SÓ PELA ESTRUTURA. dado.proprio é a coleta do nosso
// posto e dado.concorrentes são as dos vizinhos — quem separou foi o campo
// `tipo` do GET /coletas, lá no coletas-service. Aqui não se compara nome de
// posto em momento nenhum: foi exatamente isso que quebrou a Beatriz uma vez.
// ================================================================
(function () {
  'use strict';

  const INTERVALO_MS = 5 * 60 * 1000;   // recarga periódica
  const HOST_ID = 'sl-comparacao';

  // Congelado nos valores iniciais dos let do admin/app.js:
  //   G_CMP_FUEL='GC'  G_CMP_STRAT='avg'  G_CMP_ORD=''
  //   G_CMP_ABAIXO=false  G_CMP_ACIMA=false  G_CMP_SO_MUDOU=false
  const CMP_OPCOES = {
    fuel: 'GC', strat: 'avg', ord: '',
    abaixo: false, acima: false, soMudou: false,
  };

  let _comp = null;        // mapa da comparação (chave .k -> dado)
  let _carregando = false;
  let _timer = null;

  // ════════ ESTADO DOS FILTROS ════════
  // Em memória do módulo, como o resto desta tela: a recarga automática de 5
  // minutos redesenha a seção inteira, e sem isto ela apagaria a busca que a
  // pessoa acabou de digitar. Recarregar a PÁGINA devolve tudo ao padrão, que
  // é o certo — filtro é estado de uma consulta, não preferência gravada.
  let _busca = '';         // texto cru do campo (normalizado na comparação)
  let _bandeira = '';      // '' = Todos; senão o slug da bandeira
  // A lista já preparada da última renderização, para filtrar e recontar sem
  // remontar o HTML (e sem tirar o foco do campo de busca a cada tecla).
  let _itens = [];

  // O combustível de referência dos cartões de resumo. É o mesmo GC que o
  // CMP_OPCOES congela como fuel ativo — a gasolina comum é o preço que
  // governa a tabela de rua, e é sobre ele que "abaixo/acima da região" diz
  // alguma coisa. Trocar aqui troca só o resumo; a tabela do card mostra
  // todos os combustíveis de qualquer jeito.
  const FUEL_RESUMO = 'GC';

  function ehLogistica() {
    try { return (getUsuarioLogado() || {}).perfil === 'LOGISTICA'; }
    catch (e) { return false; }
  }

  const host = () => document.getElementById(HOST_ID);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ════════ BANDEIRAS ════════
  // A bandeira sai do MAP_POSTOS (campo `banda`), que é dado ESTÁTICO deste
  // repositório — nenhuma chamada nova à API entrou por causa dos filtros
  // (item 5: não alterar a fonte de dados).
  //
  // OS NOMES DO PEDIDO NÃO SÃO OS NOMES DO DADO. O pedido cita Ipiranga,
  // Vibra, Rio Branco e Ale; o MAP_POSTOS traz "Ipiranga", "Shell",
  // "BR/Petrobras", "Rede Flex", "Bandeira Branca" e "ALE". Vibra é o nome
  // novo da BR — mesma distribuidora, mesma cor, e por isso as duas grafias
  // caem na mesma entrada. "Rio Branco" fica registrada e acende sozinha se
  // um dia aparecer no dado. Shell, Rede Flex e Bandeira Branca usam a cor
  // neutra: inventar uma cor para elas seria inventar dado.
  //
  // O CHIP, PORÉM, NÃO DEPENDE DESTA LISTA. Os chips saem das bandeiras que
  // existem nos postos carregados ("e qualquer outra bandeira que existir nos
  // dados"), então uma bandeira nova aparece como filtro no mesmo dia em que
  // entra no MAP_POSTOS — só sem cor própria até alguém acrescentá-la aqui.
  const BANDEIRA_COR = {
    'ipiranga': 'ip',
    'vibra': 'vibra', 'br-petrobras': 'vibra', 'br': 'vibra', 'petrobras': 'vibra',
    'rio-branco': 'riobranco',
    'ale': 'ale',
  };

  // Sem acento, minúsculo, separadores virando '-': "BR/Petrobras" →
  // "br-petrobras". Serve para a cor da bandeira E para a busca por nome.
  function slug(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  // Busca: mesma normalização, mas sem trocar espaço por '-' — digitar
  // "santa ines" tem de casar com "P. SANTA INES MINAS".
  function semAcento(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  const corBandeira = (nome) => BANDEIRA_COR[slug(nome)] || 'outra';
  const nomeBandeira = (posto) => (posto && posto.banda) ? posto.banda : 'Sem bandeira';

  // Preço "6,19" a partir de número; '' quando não há valor.
  const precoInput = (v) => (v === null || v === undefined || isNaN(v))
    ? '' : Number(v).toFixed(2).replace('.', ',');

  // Não reusa o fmtPrecoBRL do comparacao-card.js de propósito: aquele é o
  // formato DA MATRIZ e mudá-lo mexeria nas três telas. Este é só do texto
  // "atual R$6,19" deste formulário.
  const fmtBRL = (v) => (v === null || v === undefined || v === '' || v === '-')
    ? '--' : 'R$' + Number(v).toFixed(2).replace('.', ',');

  // ── Dados ───────────────────────────────────────────────────────
  async function carregar() {
    if (_carregando) return;
    _carregando = true;
    try {
      const comp = await buscarComparacaoDoDia({ dias: 15 });
      // Mesmo overlay do admin: sobrepõe no "Você" os preços já revisados hoje.
      await cmpAplicarRevisoes(comp);
      _comp = comp;
    } catch (err) {
      console.warn('Comparação (logística) indisponível:', err && err.message);
      if (_comp === null) _comp = {};   // primeira carga falhou: pinta o vazio
    } finally {
      _carregando = false;
    }
    render();
  }

  // ════════ ORDEM: ALFABÉTICA, E SÓ ════════
  // Era "com coleta de hoje primeiro, depois os sem coleta, cada grupo em
  // ordem alfabética". Virou alfabético puro, como pedido (item 3) — e com a
  // ordem estável a pessoa acha o posto pelo nome em vez de caçá-lo num
  // agrupamento que muda de um dia para o outro. O que se perde é o destaque
  // automático de quem coletou hoje; quem procura por isso tem a busca e os
  // cartões de resumo, e o card sem coleta continua se identificando sozinho.
  function postosOrdenados() {
    const comMapa = (typeof MAP_POSTOS !== 'undefined') ? MAP_POSTOS : [];
    return comMapa
      .filter(p => _comp && _comp[p.k])
      .map(p => ({
        posto: p,
        dado: _comp[p.k],
        nomeBusca: semAcento(p.ap),
        bandeira: nomeBandeira(p),
        bandSlug: slug(nomeBandeira(p)),
      }))
      .sort((a, b) => a.posto.ap.localeCompare(b.posto.ap, 'pt-BR'));
  }

  // ── Filtros ─────────────────────────────────────────────────────
  // Busca e bandeira valem JUNTAS: um item precisa passar nas duas.
  function passa(item) {
    if (_bandeira && item.bandSlug !== _bandeira) return false;
    if (_busca && item.nomeBusca.indexOf(_busca) === -1) return false;
    return true;
  }

  // Preço próprio de um combustível, já com o overlay de revisão aplicado.
  function proprioDe(dado, f) {
    const v = dado && dado.proprio ? dado.proprio[f] : null;
    return (v === null || v === undefined) ? null : Number(v);
  }

  // "Abaixo/acima da região" = nosso preço contra a MÉDIA dos concorrentes
  // daquele posto no combustível de referência — exatamente a coluna MÉDIA
  // que o card mostra, para o número do resumo e o número da tabela não
  // poderem discordar. Posto sem preço próprio ou sem concorrente não conta
  // para nenhum dos dois lados: ele não está comparado, está ausente.
  // A folga de meio centavo evita que arredondamento conte um empate como
  // diferença.
  function ladoDaRegiao(dado) {
    const nosso = proprioDe(dado, FUEL_RESUMO);
    const st = (typeof cmpStatsFuel === 'function') ? cmpStatsFuel(dado, FUEL_RESUMO) : null;
    if (nosso === null || !st) return 0;
    if (nosso < st.avg - 0.005) return -1;
    if (nosso > st.avg + 0.005) return 1;
    return 0;
  }

  function resumoDe(itens) {
    let abaixo = 0, acima = 0;
    const conc = new Set();
    itens.forEach(({ dado }) => {
      const l = ladoDaRegiao(dado);
      if (l < 0) abaixo++; else if (l > 0) acima++;
      // Contagem por NOME: o mesmo concorrente aparece na lista de vários
      // postos vizinhos, e somar as listas contaria a bandeira da esquina
      // três vezes.
      (dado.concorrentes || []).forEach(c => { if (c && c.nome) conc.add(c.nome); });
    });
    return { abaixo, acima, postos: itens.length, concorrentes: conc.size };
  }

  // Aplica os filtros SEM REMONTAR O HTML: esconde os cards que não passam e
  // reescreve só os números. Remontar a cada tecla tiraria o foco do campo de
  // busca (e fecharia um formulário de solicitação aberto no meio da lista).
  function aplicarFiltros(el) {
    const raiz = el || host();
    if (!raiz) return;
    const visiveis = [];
    _itens.forEach(item => {
      const card = raiz.querySelector('.cl-card[data-posto="' + cssEsc(item.posto.k) + '"]');
      const ok = passa(item);
      if (ok) visiveis.push(item);
      if (card) card.classList.toggle('cl-oculto', !ok);
    });
    const r = resumoDe(visiveis);
    const por = (sel, txt) => { const n = raiz.querySelector(sel); if (n) n.textContent = txt; };
    por('[data-r-abaixo]', String(r.abaixo));
    por('[data-r-acima]', String(r.acima));
    por('[data-r-postos]', String(r.postos));
    por('[data-r-conc]', String(r.concorrentes));
    raiz.querySelectorAll('[data-chip]').forEach(c => {
      c.classList.toggle('on', c.getAttribute('data-chip') === _bandeira);
    });
    const vazio = raiz.querySelector('[data-sem-resultado]');
    if (vazio) vazio.hidden = visiveis.length > 0;
  }

  // Aspas e barras invertidas escapadas para entrar num seletor de atributo.
  // As chaves do MAP_POSTOS não têm nenhuma das duas hoje ("BARBOSA - DUDU" é
  // o pior caso), mas o seletor quebraria em silêncio se um dia tivessem.
  function cssEsc(s) { return String(s == null ? '' : s).replace(/(["\\])/g, '\\$1'); }

  // ── Render ──────────────────────────────────────────────────────
  function render() {
    const el = host();
    if (!el) return;

    _itens = postosOrdenados();
    const comColeta = _itens.filter(i => i.dado.proprio && !i.dado.proprioDesatualizado).length;

    // Bandeiras DOS DADOS, alfabéticas. Uma bandeira que suma do MAP_POSTOS
    // some do filtro sozinha; uma nova aparece sozinha.
    const bandeiras = [];
    const vistas = {};
    _itens.forEach(i => {
      if (vistas[i.bandSlug]) return;
      vistas[i.bandSlug] = true;
      bandeiras.push({ nome: i.bandeira, slug: i.bandSlug });
    });
    bandeiras.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    // Se a bandeira filtrada sumiu dos dados (posto removido, coleta que não
    // veio), o filtro volta para Todos em vez de deixar a tela vazia sem
    // explicação.
    if (_bandeira && !vistas[_bandeira]) _bandeira = '';

    const chips = '<button type="button" class="cl-chip cl-chip--todos" data-chip="">Todos</button>' +
      bandeiras.map(b =>
        '<button type="button" class="cl-chip cl-b--' + esc(corBandeira(b.nome)) +
          '" data-chip="' + esc(b.slug) + '">' + esc(b.nome) + '</button>').join('');

    const cabecalho =
      '<div class="cl-head">' +
        '<span class="cl-h1">Comparação de preços · hoje</span>' +
        '<span class="cl-count">' + (_itens.length
          ? esc(comColeta + ' posto' + (comColeta === 1 ? '' : 's') + ' com coleta')
          : 'Sem coletas hoje') + '</span>' +
        '<button type="button" class="cl-reload" data-recarregar title="Recarregar">↻</button>' +
      '</div>';

    if (!_itens.length) {
      el.innerHTML = cabecalho + '<div class="cl-vazio">Sem coletas hoje.</div>';
      ligar(el);
      return;
    }

    const filtros =
      '<div class="cl-filtros">' +
        '<input type="search" class="cl-busca" data-busca placeholder="Buscar posto…"' +
          ' value="' + esc(_busca) + '" autocomplete="off" spellcheck="false">' +
        '<div class="cl-chips">' + chips + '</div>' +
      '</div>';

    // Os quatro números saem VAZIOS daqui e quem os escreve é o
    // aplicarFiltros, logo abaixo: um caminho só para contar, em vez de uma
    // contagem na montagem e outra no filtro que poderiam divergir.
    const resumo =
      '<div class="cl-resumo">' +
        cardResumo('abaixo', 'Abaixo da região', 'r-abaixo') +
        cardResumo('acima', 'Acima da região', 'r-acima') +
        cardResumo('neutro', 'Postos comparados', 'r-postos') +
        cardResumo('neutro', 'Concorrentes', 'r-conc') +
      '</div>';

    el.innerHTML = cabecalho + filtros + resumo +
      '<div class="cl-rail">' + _itens.map(cardHtml).join('') + '</div>' +
      '<div class="cl-vazio" data-sem-resultado hidden>Nenhum posto com esses filtros.</div>';

    ligar(el);
    aplicarFiltros(el);
  }

  function cardResumo(tom, rotulo, chave) {
    return '<div class="cl-kpi cl-kpi--' + tom + '">' +
      '<div class="cl-kpi-num" data-' + chave + '>–</div>' +
      '<div class="cl-kpi-lbl">' + esc(rotulo) + '</div>' +
    '</div>';
  }

  // ════════ O CARD ════════
  // NÃO É MAIS O cmpCardMatriz. Aquele card é uma MATRIZ (uma linha por
  // concorrente, cinco colunas de combustível) e a tabela dele tem
  // `min-width: 580px` — numa grade de 340px ele voltaria a rolar na
  // horizontal, que é justamente o que se tirou desta tela. Aqui o card é o
  // RESUMO pedido: nosso preço contra média/menor/maior da região, uma linha
  // por combustível.
  //
  // O QUE ISSO CUSTA: os preços de CADA concorrente, um a um, não aparecem
  // mais nesta tela. Eles continuam na aba Coleta e no painel ADM, que usam o
  // cmpCardMatriz intocado — nenhuma outra tela mudou.
  //
  // O LÁPIS CONTINUA FUNCIONANDO, e é por isso que a célula "NOSSO" guarda o
  // id `cmpm-voce-<posto>-<fuel>` e a classe `.cmpm-voce`: é por esse id que o
  // cmpEditarVoce do shared troca a célula pelo input, sem saber que o card em
  // volta mudou.
  function cardHtml(item) {
    const { posto, dado } = item;
    const idk = idSafe(posto.k);
    const kSafe = String(posto.k).replace(/'/g, "\\'");

    const linhas = CMP_FUELS_CARD.map(f => {
      const nosso = proprioDe(dado, f.key);
      const st = (typeof cmpStatsFuel === 'function') ? cmpStatsFuel(dado, f.key) : null;
      // Combustível que ninguém vende (nem nós nem os vizinhos coletados) não
      // vira linha de traços — vira nada.
      if (nosso === null && !st) return '';

      const tdNosso = nosso === null
        ? '<td class="cl-td cl-na" id="cmpm-voce-' + idk + '-' + f.key + '">—</td>'
        : '<td class="cl-td cl-nosso cmpm-voce" id="cmpm-voce-' + idk + '-' + f.key + '">' +
            '<span class="cmpm-preco">' + esc(fmtBRL(nosso)) + '</span>' +
            ' <span class="cmpm-pen" title="Editar nosso preço"' +
              ' onclick="cmpEditarVoce(&#39;' + esc(kSafe) + '&#39;,&#39;' + f.key + '&#39;)">✏️</span>' +
          '</td>';

      // Verde no MENOR quando já somos o menor (ou empatamos com ele) e
      // vermelho no MAIOR quando já somos o maior: o alerta fica na ponta que
      // a pessoa precisa ver.
      const cMenor = (nosso !== null && st && nosso <= st.min + 0.005) ? ' cl-bom' : '';
      const cMaior = (nosso !== null && st && nosso >= st.max - 0.005) ? ' cl-ruim' : '';
      const cel = (v, cls) => (v === null || v === undefined)
        ? '<td class="cl-td cl-na">—</td>'
        : '<td class="cl-td' + cls + '">' + esc(fmtBRL(v)) + '</td>';

      return '<tr>' +
        '<th class="cl-th-comb" title="' + esc(f.nome) + '">' + esc(f.btn) + '</th>' +
        tdNosso +
        cel(st ? st.avg : null, '') +
        cel(st ? st.min : null, cMenor) +
        cel(st ? st.max : null, cMaior) +
      '</tr>';
    }).join('');

    const tabela = linhas
      ? '<table class="cl-tab">' +
          '<thead><tr><th class="cl-th-comb">COMB.</th><th>NOSSO</th>' +
            '<th>MÉDIA</th><th>MENOR</th><th>MAIOR</th></tr></thead>' +
          '<tbody>' + linhas + '</tbody>' +
        '</table>'
      : '<div class="cl-sem-preco">Sem preço coletado hoje.</div>';

    const selo = (dado.proprioDesatualizado && typeof seloDesatualizado === 'function')
      ? seloDesatualizado(dado.proprio) : '';

    return '<div class="cl-card" data-posto="' + esc(posto.k) + '">' +
      '<div class="cl-card-hd">' +
        '<span class="cl-card-nome">' + esc(posto.ap) + selo + '</span>' +
        '<span class="cl-bandeira cl-b--' + esc(corBandeira(item.bandeira)) + '">' +
          esc(item.bandeira) + '</span>' +
      '</div>' +
      tabela +
      cmpFotosHtml(posto, dado) +
      '<div class="cl-rodape">' +
        '<button type="button" class="cl-btn-sol" data-solicitar="' + esc(posto.k) + '">Solicitar alteração</button>' +
      '</div>' +
      '<div class="cl-form" data-form="' + esc(posto.k) + '" hidden></div>' +
    '</div>';
  }

  // A FAIXA DE FOTOS E O LIGHTBOX MORAM NO shared/js/comparacao-card.js.
  // Nasceram aqui; subiram quando o ADM passou a mostrar as mesmas
  // miniaturas embaixo da matriz. O onclick da miniatura já chama o
  // cmpAbrirFoto — esta tela não liga listener de foto nenhum.

  // ── Formulário de solicitação ───────────────────────────────────
  // Só os combustíveis em que o posto TEM preço próprio: pedir alteração de um
  // preço que não conhecemos mandaria preco_antigo null e o gerente receberia
  // uma troca sem referência.
  function formHtml(posto, dado) {
    const proprio = dado.proprio || {};
    const fuels = CMP_FUELS_CARD.filter(f => proprio[f.key] !== null && proprio[f.key] !== undefined);
    if (!fuels.length) {
      return '<div class="cl-form-erro">Sem preço próprio coletado — nada a alterar.</div>';
    }
    const sug = cmpSugeridoMatriz(dado, CMP_OPCOES);
    const opcoes = fuels.map(f =>
      '<option value="' + f.key + '">' + esc(f.btn) + ' · ' + esc(f.nome) + '</option>').join('');
    const primeiro = fuels[0].key;
    return '<div class="cl-form-linha">' +
        '<select class="cl-sel">' + opcoes + '</select>' +
        '<span class="cl-atual" data-atual>atual ' + esc(fmtBRL(proprio[primeiro])) + '</span>' +
      '</div>' +
      '<div class="cl-form-linha">' +
        '<input class="cl-inp" type="text" inputmode="decimal" placeholder="novo preço"' +
          ' value="' + esc(precoInput(sug[primeiro])) + '">' +
        '<button type="button" class="cl-ok" data-confirmar>Confirmar</button>' +
        '<button type="button" class="cl-cancel" data-cancelar>Cancelar</button>' +
      '</div>' +
      '<div class="cl-form-msg" data-msg></div>';
  }

  // "619" → 6.19 (só dígitos = centavos); "6,19"/"6.19" → 6.19.
  // Mesma regra do cmpParsePreco do admin, para os dois caminhos de edição
  // aceitarem exatamente a mesma digitação.
  function parsePreco(str) {
    const s = String(str || '').trim();
    if (!s) return NaN;
    if (/[.,]/.test(s)) return parseFloat(s.replace(',', '.'));
    const digits = s.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) / 100 : NaN;
  }

  function abrirForm(card, k) {
    const dado = _comp && _comp[k];
    const posto = (typeof MAP_POSTOS !== 'undefined') ? MAP_POSTOS.find(p => p.k === k) : null;
    if (!dado || !posto) return;
    const box = card.querySelector('[data-form]');
    if (!box) return;
    box.innerHTML = formHtml(posto, dado);
    box.hidden = false;
    const sel = box.querySelector('.cl-sel');
    const inp = box.querySelector('.cl-inp');
    const atual = box.querySelector('[data-atual]');
    if (sel) {
      sel.addEventListener('change', () => {
        const f = sel.value;
        const sug = cmpSugeridoMatriz(dado, CMP_OPCOES);
        if (atual) atual.textContent = 'atual ' + fmtBRL(dado.proprio ? dado.proprio[f] : null);
        if (inp) inp.value = precoInput(sug[f]);
      });
    }
    if (inp) inp.focus();
  }

  function fecharForm(card) {
    const box = card.querySelector('[data-form]');
    if (box) { box.hidden = true; box.innerHTML = ''; }
  }

  // Espelha o cmpConfirmarVoce do admin: valida, grava a revisão e SÓ ENTÃO
  // abre a solicitação — na mesma ordem e com os mesmos argumentos
  // (posto.ap, fuel, novo, orig) / (posto.ap, fuel, orig, novo).
  // Não reproduz o convite do GA: lá ele é um window.confirm no meio do fluxo,
  // e aqui o operador escolhe o combustível no próprio select.
  async function confirmar(card, k) {
    const dado = _comp && _comp[k];
    const posto = (typeof MAP_POSTOS !== 'undefined') ? MAP_POSTOS.find(p => p.k === k) : null;
    const box = card.querySelector('[data-form]');
    if (!dado || !posto || !box) return;

    const sel = box.querySelector('.cl-sel');
    const inp = box.querySelector('.cl-inp');
    const msg = box.querySelector('[data-msg]');
    const btnOk = box.querySelector('[data-confirmar]');
    if (!sel || !inp) return;

    const f = sel.value;
    const novo = parsePreco(inp.value);
    const orig = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined)
      ? Number(dado.proprio[f]) : null;

    const dizer = (t) => { if (msg) { msg.textContent = t; msg.classList.add('on'); } };
    if (isNaN(novo) || novo <= 0) { dizer('Preço inválido.'); return; }
    if (orig !== null && Math.abs(novo - orig) < 0.005) { dizer('Preço igual ao atual.'); return; }

    if (btnOk) { btnOk.disabled = true; btnOk.textContent = 'Enviando…'; }
    if (msg) { msg.textContent = ''; msg.classList.remove('on'); }

    // As duas funções engolem o erro e devolvem false (elas mesmas alertam).
    const ok = await cmpSalvarPrecoProprio(posto.ap, f, novo, orig);
    if (!ok) {
      dizer('Não foi possível salvar o preço. Tente de novo.');
      if (btnOk) { btnOk.disabled = false; btnOk.textContent = 'Confirmar'; }
      return;
    }
    if (!dado.proprio) dado.proprio = {};
    dado.proprio[f] = novo;   // overlay local, igual ao admin

    const okSol = await cmpCriarSolicitacao(posto.ap, f, orig, novo);
    if (!okSol) {
      dizer('Preço salvo, mas a solicitação ao gerente falhou.');
      if (btnOk) { btnOk.disabled = false; btnOk.textContent = 'Confirmar'; }
      return;
    }

    fecharForm(card);
    piscar(card.querySelector('[data-solicitar]'), '✓ Enviado ao gerente');
    // MESMO desfecho do lápis, pelo MESMO hook: recarregar a seção e dar um
    // poll na lista de pendentes. Antes este bloco repetia à mão o que o
    // cmpAposSalvarPreco já faz, e as duas metades iam divergir na primeira
    // vez que alguém mexesse numa só.
    await window.cmpAposSalvarPreco({
      k, fuel: f, posto, dado, novo, orig, salvou: true, flashFuels: [],
    });
  }

  function piscar(btn, txt) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = txt;
    btn.classList.add('ok');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 2200);
  }

  // ── Eventos (delegação: o innerHTML troca os filhos, não o host) ──
  function ligar(el) {
    if (el._clLigado) return;
    // 'input' e nao 'keyup': pega colar, limpar pelo x do type=search e
    // autocompletar, que o keyup deixa passar.
    el.addEventListener('input', (e) => {
      if (!e.target.closest('[data-busca]')) return;
      _busca = semAcento(e.target.value);
      aplicarFiltros(el);
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-recarregar]')) { carregar(); return; }
      const chip = e.target.closest('[data-chip]');
      if (chip) { _bandeira = chip.getAttribute('data-chip') || ''; aplicarFiltros(el); return; }
      const card = e.target.closest('.cl-card');
      if (!card) return;
      const k = card.getAttribute('data-posto');
      if (e.target.closest('[data-solicitar]')) { abrirForm(card, k); return; }
      if (e.target.closest('[data-cancelar]'))  { fecharForm(card); return; }
      if (e.target.closest('[data-confirmar]')) { confirmar(card, k); return; }
    });
    el._clLigado = true;
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (!ehLogistica()) return;
    if (!host()) return;
    carregar();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(carregar, INTERVALO_MS);
  }

  // ── Ganchos do lápis (shared/js/comparacao-card.js) ─────────────
  // Com eles definidos, o lápis da célula "Você" funciona aqui igual ao do
  // admin — é por isso que a regra que o escondia saiu do comparacao.css.
  //
  // O cmpAposSalvarPreco daqui NÃO traz o convite do GA. No admin ele é um
  // window.confirm no meio do fluxo; aqui o operador já escolhe o combustível
  // no select do formulário, e um modal brigaria com isso. Quem quiser mexer
  // no GA pela Logística escolhe GA na lista.
  //
  // Fora do init() de propósito: os ganchos só precisam existir, e deixá-los
  // atrás do teste de perfil os faria faltar caso o init saísse antes.
  window.cmpDadoDoPosto = (k) => (_comp ? _comp[k] : null);

  window.cmpAposSalvarPreco = () => {
    carregar();                 // redesenha a seção com o preço novo
    window.__slRefresh?.();     // e força um poll da lista de pendentes
  };

  window.comparacaoLogistica = { recarregar: carregar };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
