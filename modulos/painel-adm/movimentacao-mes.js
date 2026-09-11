// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/movimentacao-mes.js
// Tela "Movimentação do dia" da aba Relatórios. ADITIVO: expõe
// window.renderMovMes(section), chamado pelo relAbrir() — mesmo padrão do
// renderDre / renderRelatorios.
//
// COMPARTILHADO entre o painel-adm (desktop) e o modulos/admin (celular),
// como o dre.js já é. Um arquivo, um modo por largura — não dois arquivos.
//
// FONTE: GET /tecnox/faturamento-mes (guard ADM ou LOGISTICA), que lê SÓ o
// rollup TecnoX pela MESMA movAgregar da tela de auditoria do Painel TI. A
// conta não é refeita aqui: esta tela formata o que a rota já somou.
//
// ISTO NÃO É A TELA DO TI. Lá é auditoria (alarmes de desconto, margem e
// pagamento, quebra por frentista e por turno). Aqui é gestão: faturamento,
// convênio e a variação contra outro mês. Nenhum alarme entra.
//
// GRÁFICO PRÓPRIO, e de propósito. O do DRE (svgLinhas + ligarTooltipGrafico,
// 255 linhas) desenha três séries, média de meses fechados, balão com quatro
// medidas e seleção por toque. Aqui são duas linhas e nada mais. Reusar
// aquele obrigaria a extraí-lo do IIFE do dre.js e a mexer nas seis chamadas
// que ele já tem lá — risco no DRE para economizar 60 linhas simples.
// O dre.js NÃO é tocado por este arquivo.
//
// ════════ POR QUE A VARIAÇÃO ÀS VEZES NÃO APARECE ════════
// Quem decide é a ROTA, no campo `comparavel` — esta tela não recalcula a
// régua, só lê. Ver o comentário da rota: a variação exige o MESMO número de
// dias com dado dos dois lados, porque comparar 9 dias de setembro com 11 de
// agosto dava −14,8% quando a verdade por dia era +4,1%. Sinal trocado, não
// arredondamento.
//
// Quando a régua barra por `dias_diferentes`, a tela oferece o conserto num
// clique: o botão "comparar os mesmos dias" troca o alcance para "até o dia
// N", com N = o último dia com dado do mês base.
// ═════════════════════════════════════════════════════════
(function () {
  'use strict';

  var _sec = null;          // <section id="s-movmes">
  var _pronto = false;      // shell montado?
  var _postos = [];
  var _posto = '';          // '' = REDE TODA
  var _mes = '';            // 'AAAA-MM' — mês base
  var _cmp = '';            // 'AAAA-MM' — comparação
  var _ateDia = null;       // null = mês inteiro; N = dias 1..N nos DOIS meses
  // 'mes' = um mês contra outro (o original). 'ano' = acumulado de 01/01 até
  // hoje, SEM comparação. Os dois modos são a mesma tela e os mesmos blocos —
  // o que muda é a rota, a fonte e o gráfico.
  var _modo = 'mes';
  var _ano = '';            // 'AAAA', só no modo ano
  var _metrica = 'faturamento';
  var _dados = null;
  var _carregando = false;
  var _erro = '';
  var _seq = 0;             // guarda contra resposta velha (ver carregar)

  // ── Datas ────────────────────────────────────────────────────────
  // Data LOCAL, nunca toISOString(): em UTC−3 o toISOString() de 23h vira o
  // dia seguinte, e o mês default sairia errado na virada do mês.
  function hojeLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }
  function somarMeses(m, n) {
    var a = Number(m.slice(0, 4)), b = Number(m.slice(5, 7)) - 1 + n;
    a += Math.floor(b / 12); b = ((b % 12) + 12) % 12;
    return a + '-' + String(b + 1).padStart(2, '0');
  }
  function diasNoMes(m) {
    return new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  }
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function nomeMes(m) { return MESES[Number(m.slice(5, 7)) - 1] + ' de ' + m.slice(0, 4); }
  function nomeMesCurto(m) { return MESES[Number(m.slice(5, 7)) - 1].slice(0, 3) + '/' + m.slice(2, 4); }
  // ISO -> dd/mm/aaaa por fatiamento, NUNCA por new Date(iso): '2026-01-01'
  // é parseado como UTC e em UTC-3 voltaria 31/12/2025.
  // dd/mm — o ano já está no cabeçalho, e repeti-lo doze vezes numa linha de
  // rodapé de bloco só gasta largura no celular.
  function brDataCurta(iso) {
    if (!iso || String(iso).length < 10) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1];
  }
  function brData(iso) {
    if (!iso || String(iso).length < 10) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  // ── Números ──────────────────────────────────────────────────────
  function nf(v, casas) {
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  // ABREVIADO NOS DOIS TAMANHOS, desktop inclusive: a tela é para ler de
  // relance, e "R$ 41.203.882,17" obriga a contar casas para saber a ordem de
  // grandeza. O valor cheio fica no `title` de quem quiser conferir.
  // O sinal vem DEPOIS do "R$", igual ao resto do sistema.
  function fmtRSCurto(v) {
    if (!Number.isFinite(Number(v))) return '—';
    var n = Number(v), a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e6) return 'R$ ' + s + nf(a / 1e6, 1) + ' mi';
    if (a >= 1e3) return 'R$ ' + s + nf(a / 1e3, 0) + ' mil';
    return 'R$ ' + s + nf(a, 0);
  }
  function fmtLCurto(v) {
    if (!Number.isFinite(Number(v))) return '—';
    var n = Number(v), a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + nf(a / 1e6, 1) + ' mi L';
    if (a >= 1e3) return s + nf(a / 1e3, 0) + ' mil L';
    return s + nf(a, 0) + ' L';
  }
  function fmtRSCheio(v) {
    return Number.isFinite(Number(v)) ? 'R$ ' + nf(v, 2) : '—';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Variação ─────────────────────────────────────────────────────
  // Devolve null quando NÃO HÁ o que dizer. Nunca devolve 0% como se fosse
  // uma medida: sem lado de comparação, ou com ele em zero, a divisão não
  // existe e um "0%" na tela seria afirmação inventada.
  function variacao(agora, antes) {
    var a = Number(agora), b = Number(antes);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return (a / b - 1) * 100;
  }
  // A VARIAÇÃO EM PALAVRA, que é o pedido: "▲ subiu 4%", não "+4,0%".
  // Abaixo de meio por cento vira "quase igual" — dizer "subiu 0%" seria
  // gastar a palavra "subiu" num movimento que não houve.
  // `textoNulo` existe porque "sem dado para comparar" nem sempre é o motivo
  // certo. Quando o convênio não existe no mês de comparação, a razão é
  // ESTRUTURAL (o canal só passou a ser gravado em 21/08), e repetir a frase
  // genérica em todo bloco foi o que fez a tela parecer quebrada.
  function htmlVar(pct, tamanho, textoNulo, sufixo) {
    var cls = 'mm-var' + (tamanho ? ' ' + tamanho : '');
    var suf = sufixo || '';
    if (pct === null) return '<div class="' + cls + ' nada">' + esc(textoNulo || 'sem dado para comparar') + '</div>';
    if (Math.abs(pct) < 0.5) return '<div class="' + cls + ' igual">quase igual' + esc(suf) + '</div>';
    var sobe = pct > 0;
    var casas = Math.abs(pct) < 10 ? 1 : 0;
    return '<div class="' + cls + ' ' + (sobe ? 'sobe' : 'cai') + '">' +
      '<span class="mm-seta" aria-hidden="true">' + (sobe ? '▲' : '▼') + '</span> ' +
      (sobe ? 'subiu' : 'caiu') + ' ' + nf(Math.abs(pct), casas) + '%' + esc(suf) + '</div>';
  }

  // ════════ COMO COMPARAR, decidido UMA VEZ ════════
  // Três estados, e a tela inteira lê deste objeto em vez de cada bloco
  // repetir a condição — foi assim que a mensagem do convênio conseguiu
  // contradizer os blocos na rodada passada.
  //
  //  'total'   — mesmos dias dos dois lados: total contra total.
  //  'dia'     — contagens diferentes: o TOTAL não compara, mas a MÉDIA POR
  //              DIA compara. Suprimir tudo jogava fora um número verdadeiro:
  //              setembro tem 9 dias e agosto 11, e o Soutag rende R$ 443 mil
  //              por dia contra R$ 419 mil — +5,8%, que é a resposta à
  //              pergunta "qual mês rende mais".
  //  'nenhum'  — o mês de comparação não existe. Aí não há o que dividir.
  function modoComparacao(base, cmp, comparavel) {
    if (comparavel.ok) return { tipo: 'total' };
    if (comparavel.motivo === 'dias_diferentes' && cmp && cmp.tem_dado &&
        base.dias_com_dado > 0 && cmp.dias_com_dado > 0) {
      return { tipo: 'dia', diasBase: base.dias_com_dado, diasCmp: cmp.dias_com_dado };
    }
    return { tipo: 'nenhum' };
  }

  // A MESMA `variacao()` nos dois modos — o que muda são os insumos, não a
  // fórmula. Duas fórmulas acabariam discordando no arredondamento.
  function compara(modo, agora, antes) {
    if (modo.tipo === 'total') return variacao(agora, antes);
    if (modo.tipo === 'dia') return variacao(agora / modo.diasBase, antes / modo.diasCmp);
    return null;
  }

  // A variação + , no modo por dia, as DUAS médias que a produziram. Sem elas
  // um "+5,8% por dia" seria mais um número para conferir sem base.
  function htmlVarModo(modo, agora, antes, o) {
    o = o || {};
    var fmt = o.fmt || fmtRSCurto;
    var pct = (agora === null || antes === null || antes === undefined)
      ? null : compara(modo, agora, antes);
    if (modo.tipo !== 'dia' || pct === null) {
      return htmlVar(pct, o.tamanho, o.textoNulo);
    }
    return htmlVar(pct, o.tamanho, null, ' por dia') +
      '<div class="mm-media">' + fmt(agora / modo.diasBase) + '/dia · ' +
      esc(o.rotuloCmp || 'antes') + ' ' + fmt(antes / modo.diasCmp) + '/dia</div>';
  }

  // ── Shell ────────────────────────────────────────────────────────
  function montarShell(sec) {
    _sec = sec;
    var hj = hojeLocal();
    if (!_mes) { _mes = hj.slice(0, 7); _cmp = somarMeses(_mes, -1); }
    if (!_ano) _ano = hj.slice(0, 4);
    sec.innerHTML =
      '<div class="mm-filtros" id="mm-filtros"></div>' +
      '<div class="mm-corpo" id="mm-corpo"></div>';
    _pronto = true;
    renderFiltros();
  }

  function opcoesMes(sel) {
    // 18 meses para trás a partir do mês corrente. Não pergunta ao banco quais
    // existem: mês sem dado responde "sem dado para comparar", que é uma
    // resposta honesta, e uma lista que muda de tamanho conforme a carga
    // confundiria mais do que ajuda.
    var hj = hojeLocal().slice(0, 7), out = '';
    for (var i = 0; i < 18; i++) {
      var m = somarMeses(hj, -i);
      out += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + nomeMes(m) + '</option>';
    }
    return out;
  }

  function renderFiltros() {
    var el = _sec.querySelector('#mm-filtros');
    if (!el) return;
    var maxDia = diasNoMes(_mes);
    var diaSel = _ateDia === null ? '' : String(_ateDia);
    var ops = '';
    for (var d = 1; d <= maxDia; d++) {
      ops += '<option value="' + d + '"' + (String(d) === diaSel ? ' selected' : '') + '>dia ' + d + '</option>';
    }
    // O SELETOR DE MODO É O PRIMEIRO FILTRO, e os três filtros de mês só
    // existem no modo Mês. Deixá-los aparecendo e inertes no modo Ano seria
    // pior do que escondê-los: um <select> que não muda nada é um defeito aos
    // olhos de quem mexe nele.
    var anos = '';
    for (var y = Number(hojeLocal().slice(0, 4)); y >= 2026; y--) {
      anos += '<option value="' + y + '"' + (String(y) === _ano ? ' selected' : '') + '>' + y + '</option>';
    }
    el.innerHTML =
      '<label class="mm-f"><span>Ver</span>' +
        '<select id="mm-modo" onchange="__mmFiltro(\'modo\', this.value)">' +
          '<option value="mes"' + (_modo === 'mes' ? ' selected' : '') + '>Mês × mês</option>' +
          '<option value="ano"' + (_modo === 'ano' ? ' selected' : '') + '>Ano acumulado</option>' +
        '</select></label>' +
      '<label class="mm-f"><span>Posto</span>' +
        '<select id="mm-posto" onchange="__mmFiltro(\'posto\', this.value)">' +
          '<option value=""' + (_posto ? '' : ' selected') + '>Rede toda</option>' +
          _postos.map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (p.id === _posto ? ' selected' : '') + '>' + esc(p.nome) + '</option>';
          }).join('') +
        '</select></label>' +
      (_modo === 'ano'
        ? '<label class="mm-f"><span>Ano</span>' +
            '<select id="mm-ano" onchange="__mmFiltro(\'ano\', this.value)">' + anos + '</select></label>'
        : '<label class="mm-f"><span>Mês</span>' +
            '<select id="mm-mes" onchange="__mmFiltro(\'mes\', this.value)">' + opcoesMes(_mes) + '</select></label>' +
          '<label class="mm-f"><span>Comparar com</span>' +
            '<select id="mm-cmp" onchange="__mmFiltro(\'cmp\', this.value)">' + opcoesMes(_cmp) + '</select></label>' +
          '<label class="mm-f"><span>Alcance</span>' +
            '<select id="mm-alcance" onchange="__mmFiltro(\'alcance\', this.value)">' +
              '<option value=""' + (_ateDia === null ? ' selected' : '') + '>Mês inteiro</option>' +
              ops +
            '</select></label>');
  }

  window.__mmFiltro = function (qual, valor) {
    if (qual === 'modo') {
      if (valor !== 'mes' && valor !== 'ano') return;
      _modo = valor;
      // Os dados do outro modo não servem para este: zera para a tela não
      // pintar o ano com o payload do mês no instante antes da resposta.
      _dados = null;
      renderFiltros();
    } else if (qual === 'ano') {
      _ano = valor;
    } else if (qual === 'posto') _posto = valor;
    else if (qual === 'mes') {
      _mes = valor;
      // Trocar o mês base sem mover a comparação deixaria "comparar setembro
      // com setembro" a um clique. A rota recusa (400), então a tela evita.
      if (_cmp === _mes) _cmp = somarMeses(_mes, -1);
      // "até o dia 31" num mês de 30 não existe: encolhe junto.
      if (_ateDia !== null) _ateDia = Math.min(_ateDia, diasNoMes(_mes));
      renderFiltros();
    } else if (qual === 'cmp') {
      if (valor === _mes) { renderFiltros(); return; }
      _cmp = valor;
    } else if (qual === 'alcance') {
      _ateDia = valor === '' ? null : Number(valor);
    }
    carregar();
  };

  // O conserto num clique do caso `dias_diferentes`: alinha os dois meses no
  // último dia com dado do mês base.
  window.__mmMesmosDias = function () {
    if (!_dados || !_dados.base || !_dados.base.ultimo) return;
    _ateDia = Number(_dados.base.ultimo.slice(8, 10));
    renderFiltros();
    carregar();
  };

  window.__mmMetrica = function (id) {
    if (id !== 'faturamento' && id !== 'litros') return;
    _metrica = id;
    pintar();   // sem rede: a série dos dois meses já veio inteira
  };

  // O detalhe de litros do bloco de combustível. No desktop o CSS já mostra e
  // o botão não muda nada visível; no celular é ele que abre.
  window.__mmDetalhe = function (el) {
    if (!el) return;
    var abriu = !el.classList.contains('aberto');
    el.classList.toggle('aberto', abriu);
    el.setAttribute('aria-expanded', abriu ? 'true' : 'false');
  };

  // ── Carga ────────────────────────────────────────────────────────
  async function carregarPostos() {
    if (_postos.length) return;
    try {
      var r = await apiFetch('/postos');
      _postos = (r.postos || r.data || r || [])
        .filter(function (p) { return p && p.id && p.nome; })
        .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
      renderFiltros();
    } catch (e) { /* a tela funciona em Rede toda mesmo sem a lista */ }
  }

  async function carregar() {
    _carregando = true; _erro = ''; pintar();
    // Trocar dois filtros depressa dispara duas buscas; sem o selo, a PRIMEIRA
    // resposta a chegar pinta, e ela pode ser a do filtro antigo.
    var meu = ++_seq;
    try {
      var posto = _posto ? '&posto_id=' + encodeURIComponent(_posto) : '';
      var url = _modo === 'ano'
        ? '/tecnox/faturamento-ano?ano=' + _ano + posto
        : '/tecnox/faturamento-mes?mes=' + _mes + '&cmp=' + _cmp + posto +
          (_ateDia === null ? '' : '&ate_dia=' + _ateDia);
      var r = await apiFetch(url);
      if (meu !== _seq) return;
      _dados = r;
    } catch (e) {
      if (meu !== _seq) return;
      _dados = null; _erro = e.message || 'Falha ao carregar';
    } finally {
      if (meu === _seq) { _carregando = false; pintar(); }
    }
  }

  // ── Blocos ───────────────────────────────────────────────────────
  // A JANELA REAL DOS DADOS, colada embaixo de cada número.
  //
  // Repetir a mesma linha em doze blocos é redundância DE PROPÓSITO: o filtro
  // diz "setembro" e o número é de 01/09 a 09/09, e quem lê um bloco isolado
  // — ou tira um print dele — não vê o cabeçalho. Foi assim que R$ 3.990.044
  // de nove dias foi lido como o mês de setembro.
  //
  // Usa `ultimo` (o último dia COM DADO) e nunca o fim do mês civil: a janela
  // pedida pela rota é 01/09 a 30/09, e escrever "30/09" seria trocar um
  // rótulo errado por outro.
  function htmlPeriodo(lado) {
    if (!lado || !lado.primeiro || !lado.ultimo) return '';
    var n = lado.dias_com_dado;
    return '<div class="mm-periodo">' + brDataCurta(lado.primeiro) + ' a ' + brDataCurta(lado.ultimo) +
      ' · ' + n + (n === 1 ? ' dia' : ' dias') + '</div>';
  }

  function blocoConvenio(chave, rotulo, base, cmp, comparavel, semCmp, modo, rotuloCmp) {
    var b = (base.por_canal || []).find(function (c) { return c.chave === chave; });
    var c = (cmp.por_canal || []).find(function (x) { return x.chave === chave; });
    // AUSENTE e ZERO são coisas diferentes e a tela separa: 6 dos 37 postos não
    // têm 99 nenhum, e "R$ 0" é o fato; "sem 99 neste posto" é outro fato.
    if (!b) {
      return '<div class="mm-bloco mm-vazio"><div class="mm-nome">' + esc(rotulo) + '</div>' +
        '<div class="mm-num">—</div><div class="mm-var nada">sem movimento no mês</div>' +
        htmlPeriodo(base) + '</div>';
    }
    // Quando o mês de comparação não tem convênio nenhum, a frase genérica
    // some: o porquê está na nota da seção, e repeti-lo aqui em dois blocos
    // era metade do ruído que fazia a tela parecer quebrada.
    return '<div class="mm-bloco">' +
      '<div class="mm-nome">' + esc(rotulo) + '</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(b.faturamento)) + '">' + fmtRSCurto(b.faturamento) + '</div>' +
      htmlVarModo(modo, b.faturamento, c ? c.faturamento : null,
        { textoNulo: semCmp ? 'sem comparação' : null, rotuloCmp: rotuloCmp }) +
      // ABASTECIMENTOS, não cupons: é a contagem exata. Ver o comentário da
      // rota — o "cupons" do rollup é um teto que não fecha na conferência.
      '<div class="mm-sub">' + nf(b.abastecimentos, 0) +
        (b.abastecimentos === 1 ? ' abastecimento' : ' abastecimentos') + '</div>' +
      '<div class="mm-sub">' + fmtLCurto(b.litros) + '</div>' +
      htmlPeriodo(base) +
      '</div>';
  }

  function blocoCombustivel(c, mapCmp, comparavel, base, modo, rotuloCmp) {
    var o = mapCmp.get(c.codigo);
    // As DUAS variações saem do mesmo modo: no modo 'dia' as duas viram média
    // diária, e a comparação de sinais opostos continua valendo porque os
    // dois lados foram divididos pelos mesmos divisores.
    var vR = o ? compara(modo, c.faturamento, o.faturamento) : null;
    var vL = o ? compara(modo, c.litros, o.litros) : null;
    // SINAIS OPOSTOS: subiu em litro e caiu em R$ (ou o contrário) é
    // exatamente a leitura que o DRE não dá, então o bloco acende e o detalhe
    // fica ABERTO — inclusive no celular, onde ele começaria fechado.
    var oposto = vR !== null && vL !== null &&
      Math.abs(vR) >= 0.5 && Math.abs(vL) >= 0.5 && (vR > 0) !== (vL > 0);
    return '<button type="button" class="mm-bloco mm-tocavel' + (oposto ? ' mm-oposto aberto' : '') + '"' +
      ' aria-expanded="' + (oposto ? 'true' : 'false') + '" onclick="__mmDetalhe(this)">' +
      '<div class="mm-nome">' + esc(c.rotulo) + '</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(c.faturamento)) + '">' + fmtRSCurto(c.faturamento) + '</div>' +
      htmlVarModo(modo, c.faturamento, o ? o.faturamento : null, { rotuloCmp: rotuloCmp }) +
      (oposto ? '<div class="mm-aviso">o litro e o R$ foram para lados opostos</div>' : '') +
      '<div class="mm-det">' +
        '<div class="mm-det-num">' + fmtLCurto(c.litros) + '</div>' +
        htmlVarModo(modo, c.litros, o ? o.litros : null,
          { tamanho: 'mm-var-mini', fmt: fmtLCurto, rotuloCmp: rotuloCmp }) +
      '</div>' +
      htmlPeriodo(base) +
      '</button>';
  }

  // ── Gráfico ──────────────────────────────────────────────────────
  // Duas linhas por dia do mês. SVG só para as linhas; pontos e rótulos são
  // HTML posicionados em %.
  //
  // POR QUE ASSIM, e não <circle>/<text> dentro do SVG: o viewBox é esticado
  // com preserveAspectRatio="none" (720x240 numa caixa de ~330x200 em 375px),
  // e sob fatores de escala diferentes em X e Y um círculo vira ovo e o texto
  // deita. Span em % é redondo em qualquer largura. Pelo mesmo motivo as
  // linhas levam vector-effect="non-scaling-stroke", senão a espessura sairia
  // grossa na horizontal e fina na vertical.
  //
  // FALHA QUEBRA A LINHA: dia sem dado começa um segmento novo em vez de
  // ligar os vizinhos por cima do buraco. É isso que faz a linha do mês base
  // PARAR onde o dado para, em vez de despencar a zero no dia 10.
  function svgDuasLinhas(base, cmp, met, mesQ, cmpQ) {
    var pb = base && base.tem_dado ? base.serie : [];
    var pc = cmp && cmp.tem_dado ? cmp.serie : [];
    if (!pb.length && !pc.length) return '<div class="mm-sem">sem dado para desenhar</div>';

    var maxDia = Math.max(
      diasNoMes(mesQ),
      pb.reduce(function (m, p) { return Math.max(m, p.dia); }, 0),
      pc.reduce(function (m, p) { return Math.max(m, p.dia); }, 0)
    );
    var vals = pb.concat(pc).map(function (p) { return Number(p[met]); })
      .filter(function (v) { return Number.isFinite(v); });
    if (!vals.length) return '<div class="mm-sem">sem dado para desenhar</div>';
    // ESCALA COMEÇANDO EM ZERO. Cortar a base faria uma oscilação de 3%
    // ocupar meia tela — num gráfico de faturamento isso é enganar o olho.
    var max = Math.max.apply(null, vals) * 1.08 || 1;

    var W = 720, H = 240;
    var x = function (dia) { return maxDia > 1 ? (dia - 1) / (maxDia - 1) * W : W / 2; };
    var y = function (v) { return H - (v / max) * H; };

    var porDia = function (serie) {
      var m = new Map();
      serie.forEach(function (p) { m.set(p.dia, Number(p[met])); });
      return m;
    };
    var segmentos = function (serie) {
      var m = porDia(serie), segs = [], atual = [];
      for (var d = 1; d <= maxDia; d++) {
        var v = m.has(d) ? m.get(d) : null;
        if (v === null || !Number.isFinite(v)) {
          if (atual.length) { segs.push(atual); atual = []; }
        } else atual.push(x(d).toFixed(1) + ',' + y(v).toFixed(1));
      }
      if (atual.length) segs.push(atual);
      return segs;
    };
    var linhas = function (serie, cls) {
      return segmentos(serie).map(function (s) {
        // Segmento de UM ponto não vira polyline (não tem o que desenhar): o
        // ponto HTML já o representa.
        return s.length < 2 ? '' : '<polyline class="' + cls + '" points="' + s.join(' ') +
          '" vector-effect="non-scaling-stroke" />';
      }).join('');
    };
    var pontos = function (serie, cls) {
      return serie.map(function (p) {
        var v = Number(p[met]);
        if (!Number.isFinite(v)) return '';
        return '<span class="mm-pt ' + cls + '" style="left:' + (x(p.dia) / W * 100).toFixed(2) +
          '%;top:' + (y(v) / H * 100).toFixed(2) + '%"></span>';
      }).join('');
    };

    // POUCOS RÓTULOS, como pedido: de 5 em 5 mais o dia 1 e o último. Em 375px
    // trinta números viram uma tarja cinza ilegível.
    var rotulos = '';
    for (var d2 = 1; d2 <= maxDia; d2++) {
      if (d2 !== 1 && d2 !== maxDia && d2 % 5 !== 0) continue;
      if (d2 !== 1 && d2 !== maxDia && maxDia - d2 < 3) continue;   // não colar no último
      rotulos += '<span class="mm-rx" style="left:' + (x(d2) / W * 100).toFixed(2) + '%">' + d2 + '</span>';
    }
    var fmt = met === 'litros' ? fmtLCurto : fmtRSCurto;

    return '<div class="mm-graf-legenda">' +
        '<span class="mm-leg base"><i></i>' + esc(nomeMesCurto(mesQ)) + '</span>' +
        '<span class="mm-leg cmp"><i></i>' + esc(nomeMesCurto(cmpQ)) + '</span>' +
      '</div>' +
      '<div class="mm-graf-caixa">' +
        '<div class="mm-graf-y"><span>' + fmt(max) + '</span><span>' + fmt(max / 2) + '</span><span>0</span></div>' +
        '<div class="mm-graf-area">' +
          // O PLOT E UMA CAIXA SO, e o SVG a preenche por inteiro. Os pontos
          // sao posicionados em % DESTA MESMA caixa, entao ponto e linha caem
          // no mesmo lugar por construcao — sem margem de correcao nenhuma.
          // Antes o SVG media 220px dentro de uma area de 240px e os pontos
          // usavam a area: eles derivavam ate 20px da linha no pe do grafico,
          // e a fixture plana do teste escondia isso porque tudo caia no topo.
          // Os rotulos do eixo saem daqui e viram IRMAOS do plot.
          '<div class="mm-graf-plot">' +
            '<svg class="mm-graf" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
              '<line class="mm-grade" x1="0" y1="0" x2="' + W + '" y2="0" vector-effect="non-scaling-stroke" />' +
              '<line class="mm-grade" x1="0" y1="' + (H / 2) + '" x2="' + W + '" y2="' + (H / 2) + '" vector-effect="non-scaling-stroke" />' +
              '<line class="mm-grade" x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '" vector-effect="non-scaling-stroke" />' +
              linhas(pc, 'mm-lin-cmp') +
              linhas(pb, 'mm-lin-base') +
            '</svg>' +
            pontos(pc, 'cmp') +
            pontos(pb, 'base') +
          '</div>' +
          '<div class="mm-graf-x">' + rotulos + '</div>' +
        '</div>' +
      '</div>';
  }


  // ── Bloco de categoria (modo Ano) ────────────────────────────────
  // SEM VARIAÇÃO NENHUMA: não existe 2025 no banco, e a rota nem devolve
  // campo para isso. Onde no modo Mês há "▲ subiu 11%", aqui há o peso da
  // categoria no faturamento — que é a leitura que o acumulado permite.
  function blocoCategoria(c) {
    var ehLitro = c.unidade === 'L';
    var qtd = ehLitro ? fmtLCurto(c.quantidade)
      : nf(c.quantidade, 0) + (c.quantidade === 1 ? ' item' : ' itens');
    return '<button type="button" class="mm-bloco mm-tocavel' + (ehLitro ? '' : ' mm-un') +
      '" aria-expanded="false"' +
      ' onclick="__mmDetalhe(this)">' +
      '<div class="mm-nome">' + esc(c.nome) + '</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(c.faturamento)) + '">' + fmtRSCurto(c.faturamento) + '</div>' +
      '<div class="mm-peso">' + (c.pct === null ? '—' : nf(c.pct, c.pct < 1 ? 2 : 1) + '% do faturamento') + '</div>' +
      '<div class="mm-det">' +
        '<div class="mm-det-num">' + qtd + '</div>' +
      '</div>' +
      '</button>';
  }

  // ── Gráfico de barras, um mês por barra (modo Ano) ───────────────
  // Barras em HTML/flex, e não SVG: são no máximo 12, a altura é uma % e o
  // rótulo é texto normal. Um viewBox esticado aqui só traria de volta os
  // problemas de escala que o gráfico de linha teve de resolver.
  //
  // O MÊS INCOMPLETO SAI MARCADO. Medido em 10/09/2026: janeiro a abril têm
  // 32-33 dos 37 postos. Sem a marca, a subida de jan→mai leria como
  // crescimento quando parte dela é só posto que apareceu.
  function svgBarrasMes(serie, met, temIncompleto) {
    if (!serie || !serie.length) return '<div class="mm-sem">sem dado para desenhar</div>';
    var vals = serie.map(function (m) { return Number(m[met]); })
      .filter(function (v) { return Number.isFinite(v); });
    if (!vals.length) return '<div class="mm-sem">sem dado para desenhar</div>';
    var max = Math.max.apply(null, vals) * 1.08 || 1;
    var fmt = met === 'litros' ? fmtLCurto : fmtRSCurto;

    var barras = serie.map(function (m) {
      var v = Number(m[met]);
      var alt = Number.isFinite(v) ? Math.max(v / max * 100, 0.5) : 0;
      var rot = MESES[Number(m.mes.slice(5, 7)) - 1].slice(0, 3);
      // O title leva o número cheio E a cobertura: quem passa o mouse numa
      // barra baixa precisa saber se ela é baixa por venda ou por importação.
      var porQue = m.motivo_parcial === 'postos' ? ' · faltam postos'
        : m.motivo_parcial === 'dias' ? ' · mês ainda incompleto'
        : m.motivo_parcial === 'ambos' ? ' · faltam postos e dias'
        : '';
      var tt = rot + '/' + m.mes.slice(2, 4) + ': ' + fmt(v) +
        ' · ' + m.postos + (m.postos === 1 ? ' posto' : ' postos') +
        ' · ' + m.dias + ' de ' + (m.dias_do_mes || m.dias) + ' dias' + porQue;
      // A barra mora num invólucro próprio: a altura dela é % DELE, então
      // 100% ocupa o desenho inteiro sem empurrar o rótulo para fora.
      return '<div class="mm-col" title="' + esc(tt) + '">' +
        '<div class="mm-col-plot"><div class="mm-barra' + (m.completo ? '' : ' parcial') +
          '" style="height:' + alt.toFixed(1) + '%"></div></div>' +
        '<span class="mm-col-rot">' + esc(rot) + (m.completo ? '' : '<i aria-hidden="true">*</i>') + '</span>' +
        '</div>';
    }).join('');

    return '<div class="mm-graf-caixa">' +
        '<div class="mm-graf-y"><span>' + fmt(max) + '</span><span>' + fmt(max / 2) + '</span><span>0</span></div>' +
        '<div class="mm-graf-area"><div class="mm-barras">' + barras + '</div></div>' +
      '</div>' +
      (temIncompleto
        ? '<div class="mm-legenda-pe">* mês incompleto — faltam postos, ou o mês ainda não fechou. ' +
          'A barra é menor por cobertura, não por queda de venda.</div>'
        : '');
  }

  // ── Pintura do modo ANO ──────────────────────────────────────────
  function pintarAno(el) {
    var c = _dados.consulta || {};
    var A = _dados.ano || {};
    var conv = _dados.convenio || {};
    var quem = c.rede_toda ? 'Rede toda' : (c.posto_nome || 'Posto');

    if (!A.tem_dado) {
      el.innerHTML = '<div class="mm-aviso-caixa">Sem dado para ' + esc(c.ano || _ano) +
        ' em ' + esc(quem) + '.</div>';
      return;
    }

    var faixa = '<div class="mm-contexto"><b>' + esc(quem) + '</b> · ' + esc(c.ano || _ano) +
      ' · ' + brData(c.de) + ' a ' + brData(c.ate) + ' · acumulado, sem comparação</div>';

    var aviso = A.cobertura_completa ? '' :
      '<div class="mm-aviso-caixa"><b>Cobertura parcial:</b> ' +
      A.meses_incompletos.map(function (m) { return nomeMesCurto(m); }).join(', ') +
      (A.meses_incompletos.length === 1 ? ' tem' : ' têm') + ' menos postos que a rede (' +
      A.postos_rede + '). O acumulado é a soma do que existe, não da rede inteira nesses meses.</div>';

    // ── 1. POR CATEGORIA ──
    // TOP 6 + o resto agrupado. Com 26 categorias no ano e combustível
    // valendo 99%, uma parede de blocos de R$ 400 esconderia justamente o
    // que importa. O bloco "Outras" carrega a soma, então nada some.
    var cats = (A.por_categoria || []).slice();
    var mostra = cats.slice(0, 6), resto = cats.slice(6);
    var blocosCat = mostra.map(blocoCategoria).join('');
    if (resto.length) {
      var somaResto = resto.reduce(function (s2, x) { return s2 + x.faturamento; }, 0);
      var pctResto = resto.reduce(function (s2, x) { return s2 + (x.pct || 0); }, 0);
      blocosCat += '<div class="mm-bloco">' +
        '<div class="mm-nome">Outras ' + resto.length + ' categorias</div>' +
        '<div class="mm-num" title="' + esc(fmtRSCheio(somaResto)) + '">' + fmtRSCurto(somaResto) + '</div>' +
        '<div class="mm-peso">' + nf(pctResto, 2) + '% do faturamento</div>' +
        '</div>';
    }
    var secCat = '<h3 class="mm-titulo">Por categoria · ano inteiro</h3>' +
      '<div class="mm-nota">A quebra por combustível (gasolina, etanol, diesel) não existe nesta fonte — ' +
      'ela vem do rollup, que começa em 21/08. Para vê-la, use o modo Mês × mês.</div>' +
      '<div class="mm-blocos mm-3">' + blocosCat + '</div>';

    // ── 2. CONVÊNIO, com a janela própria em destaque ──
    var secConv;
    if (!conv.tem_dado) {
      secConv = '<h3 class="mm-titulo">Convênio</h3>' +
        '<div class="mm-aviso-caixa">Sem dado de convênio em ' + esc(c.ano || _ano) + '.</div>';
    } else {
      var umCanal = function (chave, rotulo) {
        var b = (conv.por_canal || []).find(function (x) { return x.chave === chave; });
        if (!b) {
          return '<div class="mm-bloco mm-vazio"><div class="mm-nome">' + esc(rotulo) + '</div>' +
            '<div class="mm-num">—</div><div class="mm-peso">sem movimento no período</div></div>';
        }
        return '<div class="mm-bloco">' +
          '<div class="mm-nome">' + esc(rotulo) + '</div>' +
          '<div class="mm-num" title="' + esc(fmtRSCheio(b.faturamento)) + '">' + fmtRSCurto(b.faturamento) + '</div>' +
          '<div class="mm-sub">' + fmtLCurto(b.litros) + '</div>' +
          '</div>';
      };
      secConv = '<h3 class="mm-titulo">Convênio</h3>' +
        // O AVISO VEM ANTES DOS BLOCOS, não depois. Um número de R$ 8,6 mi
        // ao lado de um total de ano de R$ 633 mi é lido como 1,4% do ano se
        // a ressalva chegar tarde — e ele é 20 dias, não o ano.
        '<div class="mm-aviso-caixa"><b>Convênio disponível a partir de ' + brData(conv.desde) + '.</b> ' +
        'Estes números cobrem ' + brData(conv.desde) + ' a ' + brData(conv.ate) + ' (' + conv.dias +
        (conv.dias === 1 ? ' dia' : ' dias') + '), e NÃO o ano — o detalhe por canal só passou a ser ' +
        'gravado nessa data.</div>' +
        '<div class="mm-blocos mm-2">' + umCanal('SOUTAG', 'Soutag') + umCanal('99', 'App 99') + '</div>';
    }

    // ── 3. TOTAL GERAL ──
    var total = '<div class="mm-bloco mm-total">' +
      '<div class="mm-nome">Total do ano</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(A.faturamento)) + '">' + fmtRSCurto(A.faturamento) + '</div>' +
      '<div class="mm-peso">' + brData(c.de) + ' a ' + brData(c.ate) + '</div>' +
      '<div class="mm-det aberto-sempre">' +
        '<div class="mm-det-num">' + fmtLCurto(A.litros) + ' de combustível</div>' +
      '</div></div>';

    // ── 4. GRÁFICO MÊS A MÊS ──
    var graf = '<h3 class="mm-titulo">Mês a mês</h3>' +
      '<div class="mm-graf-topo">' +
        '<div class="fueltab-row mm-metrica">' +
          '<button type="button" class="fueltab' + (_metrica === 'faturamento' ? ' active' : '') +
            '" onclick="__mmMetrica(\'faturamento\')">Faturamento</button>' +
          '<button type="button" class="fueltab' + (_metrica === 'litros' ? ' active' : '') +
            '" onclick="__mmMetrica(\'litros\')">Litros</button>' +
        '</div>' +
      '</div>' +
      // O rótulo diz o que a barra é em cada métrica: o faturamento é GERAL
      // (todas as categorias, batendo com o Total do ano) e o litro é SÓ de
      // combustível, porque nas outras categorias a quantidade é peça.
      '<div class="mm-nota">' + (_metrica === 'litros'
        ? 'Litros de combustível por mês.'
        : 'Faturamento de todas as categorias por mês — soma o Total do ano.') + '</div>' +
      // A legenda do asterisco depende de haver BARRA marcada, e nao de
      // `cobertura_completa` — que fala só de postos. O mês corrente é
      // parcial por dias e marcaria a barra sem legenda nenhuma.
      svgBarrasMes(A.serie_mes, _metrica,
        (A.serie_mes || []).some(function (m) { return !m.completo; }));

    el.innerHTML = faixa + aviso + secCat + secConv + total + graf;
  }

  // ── Pintura ──────────────────────────────────────────────────────
  function pintar() {
    if (!_pronto || !_sec) return;
    var el = _sec.querySelector('#mm-corpo');
    if (!el) return;

    if (_carregando) { el.innerHTML = '<div class="mm-aviso-caixa">Carregando…</div>'; return; }
    if (_erro) { el.innerHTML = '<div class="mm-aviso-caixa erro">' + esc(_erro) + '</div>'; return; }
    if (!_dados) { el.innerHTML = ''; return; }

    // Ramifica pelo QUE VEIO, não pelo estado local: uma resposta do ano
    // pintada pelo caminho do mês daria "sem dado" numa tela que tem dado.
    if (_dados.ano || _modo === 'ano') { pintarAno(el); return; }

    var base = _dados.base, cmp = _dados.comparacao, comparavel = _dados.comparavel || { ok: false };
    // OS RÓTULOS SAEM DA `consulta` QUE A ROTA DEVOLVEU, e não do estado local
    // (_mes/_cmp/_ateDia). A rota ecoa o que ela de fato consultou; o estado
    // local é o que a tela PEDIU. Eles concordam no caminho normal, mas se um
    // dia divergirem — resposta atrasada, filtro corrigido no servidor — a
    // tela mostraria números de um mês com o nome de outro. O teste pegou
    // isto com uma fixture em que os dois discordam de propósito.
    var c = _dados.consulta || {};
    var mesQ = c.mes || _mes, cmpQ = c.cmp || _cmp;
    var ateQ = (c.ate_dia === undefined ? _ateDia : c.ate_dia);
    var quem = c.rede_toda ? 'Rede toda' : (c.posto_nome || 'Posto');

    if (!base || !base.tem_dado) {
      el.innerHTML = '<div class="mm-aviso-caixa">Sem dado para ' + esc(nomeMes(mesQ)) +
        ' em ' + esc(quem) + '.</div>';
      return;
    }

    // ── Faixa de contexto: quem, quando, e o estado da comparação ──
    var faixa = '<div class="mm-contexto"><b>' + esc(quem) + '</b> · ' + esc(nomeMes(mesQ)) +
      ' · ' + base.dias_com_dado + (base.dias_com_dado === 1 ? ' dia' : ' dias') + ' com dado' +
      (ateQ === null || ateQ === undefined ? '' : ' (até o dia ' + ateQ + ')') + '</div>';

    // COMO comparar, decidido uma vez e lido por todos os blocos.
    var modo = modoComparacao(base, cmp, comparavel);
    var rotuloCmp = nomeMesCurto(cmpQ);

    var aviso = '';
    if (!comparavel.ok) {
      if (comparavel.motivo === 'dias_diferentes') {
        // ── A EXPLICAÇÃO INTEIRA, e não só "dias diferentes" ──
        // Diz (a) quantos dias cada lado tem, (b) POR QUE o mês de comparação
        // é curto, (c) que a média por dia compara e (d) quanto ela deu. Sem
        // (b) e (d), a caixa só anunciava uma perda; com eles, ela entrega o
        // número que responde "qual mês rende mais por dia".
        var deQuando = (cmp.primeiro && Number(cmp.primeiro.slice(8, 10)) > 1)
          ? ', só de ' + brData(cmp.primeiro) + ' em diante' : '';
        var pctDiaTotal = compara(modo, base.faturamento, cmp.faturamento);
        var frasePorDia = (pctDiaTotal === null) ? ''
          : ' <b>A média por dia compara</b>, e é ela que os blocos abaixo mostram — no total, ' +
            (Math.abs(pctDiaTotal) < 0.5 ? 'praticamente igual'
              : (pctDiaTotal > 0 ? '▲ subiu ' : '▼ caiu ') +
                nf(Math.abs(pctDiaTotal), Math.abs(pctDiaTotal) < 10 ? 1 : 0) + '%') +
            ' por dia (' + fmtRSCurto(base.faturamento / modo.diasBase) + '/dia contra ' +
            fmtRSCurto(cmp.faturamento / modo.diasCmp) + '/dia).';
        // O BOTÃO SÓ SE RESOLVER. Ele corta os dois meses no dia N, e a rota
        // já respondeu se o mês de comparação tem esses dias. Oferecer um
        // botão que não muda nada é pior do que não oferecer nenhum.
        var conserto = comparavel.alinhavel
          ? '<button type="button" class="mm-btn-conserto" onclick="__mmMesmosDias()">' +
            'comparar os mesmos dias (1 a ' + comparavel.alinhar_em + ')</button>'
          : (comparavel.alinhar_em
            ? '<div class="mm-nota-caixa">Alinhar os dois no dia ' + comparavel.alinhar_em +
              ' não resolveria: ' + esc(nomeMes(cmpQ)) + ' não tem esses dias.</div>'
            : '');
        aviso = '<div class="mm-aviso-caixa"><b>Os totais não se comparam:</b> ' +
          esc(nomeMes(mesQ)) + ' tem ' + comparavel.dias_base + ' dias com dado e ' +
          esc(nomeMes(cmpQ)) + ' tem ' + comparavel.dias_cmp + esc(deQuando) +
          '. Somar períodos de tamanhos diferentes daria uma variação falsa.' +
          frasePorDia + conserto + '</div>';
      } else {
        // DIZER O MOTIVO, e não só o efeito. "Sem dado para comparar" sozinho
        // se lê como filtro quebrado — foi a reclamação. Com a data de início
        // do rollup, lê-se como um fato do banco, e fica evidente que a
        // consulta funcionou: os números do mês base continuam todos na tela.
        var porQue = _dados.rollup_desde
          ? ' O rollup da TecnoX começa em ' + brData(_dados.rollup_desde) +
            ', então não há nada antes disso para comparar.'
          : '';
        aviso = '<div class="mm-aviso-caixa"><b>Sem dado para comparar em ' +
          esc(nomeMes(cmpQ)) + '.</b>' + porQue +
          ' Os números abaixo são de ' + esc(nomeMes(mesQ)) + ' e estão corretos.</div>';
      }
    }

    // ── 1. CONVÊNIO ──
    // O CONVÊNIO TEM UM MOTIVO PRÓPRIO PARA NÃO COMPARAR, e ele não é o mesmo
    // do faturamento: o detalhe por canal só passou a ser gravado em 21/08, e
    // isso vale mesmo num mês que TENHA faturamento. Dizer "sem dado para
    // comparar" nos dois lugares embaralha um fato estrutural com uma falha
    // de consulta — e é o que fazia a tela parecer quebrada.
    var estadoConv = _dados.convenio || {};
    var semCmpConv = estadoConv.cmp_tem === false;
    // A SEGUNDA FRASE SÓ SAI SE FOR VERDADE. Ela é o que mata a impressão de
    // filtro quebrado — "só o convênio parou, o resto está comparando" — mas
    // quando o mês de comparação está VAZIO o faturamento também não compara,
    // e afirmar que compara seria a tela mentindo sobre si mesma. Nesse caso o
    // aviso grande, acima, já explica o lado do faturamento.
    var notaConv = (semCmpConv && estadoConv.desde)
      ? '<div class="mm-nota">Convênio (Soutag/99) só tem registro desde ' +
        brData(estadoConv.desde) + '. Por isso estes dois blocos não comparam' +
        (modo.tipo === 'total'
          ? ' — o faturamento por combustível, abaixo, compara normalmente.'
          : modo.tipo === 'dia'
            ? ' — o faturamento por combustível, abaixo, compara por dia.'
            : '.') +
        '</div>'
      : '';
    var conv = '<h3 class="mm-titulo">Convênio</h3>' + notaConv +
      '<div class="mm-blocos mm-2">' +
        blocoConvenio('SOUTAG', 'Soutag', base, cmp, comparavel, semCmpConv, modo, rotuloCmp) +
        blocoConvenio('99', 'App 99', base, cmp, comparavel, semCmpConv, modo, rotuloCmp) +
      '</div>';

    // ── 2. POR COMBUSTÍVEL ──
    var mapCmp = new Map(((cmp && cmp.por_combustivel) || []).map(function (c) { return [c.codigo, c]; }));
    var blocos = (base.por_combustivel || []).map(function (c) {
      return blocoCombustivel(c, mapCmp, comparavel, base, modo, rotuloCmp);
    }).join('');
    var total = '<div class="mm-bloco mm-total">' +
      '<div class="mm-nome">Total</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(base.faturamento)) + '">' + fmtRSCurto(base.faturamento) + '</div>' +
      htmlVarModo(modo, base.faturamento, cmp && cmp.tem_dado ? cmp.faturamento : null,
        { rotuloCmp: rotuloCmp }) +
      '<div class="mm-det aberto-sempre">' +
        '<div class="mm-det-num">' + fmtLCurto(base.litros) + '</div>' +
        htmlVarModo(modo, base.litros, cmp && cmp.tem_dado ? cmp.litros : null,
          { tamanho: 'mm-var-mini', fmt: fmtLCurto, rotuloCmp: rotuloCmp }) +
      '</div>' +
      htmlPeriodo(base) +
      '</div>';
    var comb = '<h3 class="mm-titulo">Por combustível</h3>' +
      '<div class="mm-blocos mm-3">' + blocos + '</div>' + total;

    // ── 3. GRÁFICO ──
    var graf = '<h3 class="mm-titulo">Dia a dia</h3>' +
      '<div class="mm-graf-topo">' +
        '<div class="fueltab-row mm-metrica">' +
          '<button type="button" class="fueltab' + (_metrica === 'faturamento' ? ' active' : '') +
            '" onclick="__mmMetrica(\'faturamento\')">Faturamento</button>' +
          '<button type="button" class="fueltab' + (_metrica === 'litros' ? ' active' : '') +
            '" onclick="__mmMetrica(\'litros\')">Litros</button>' +
        '</div>' +
      '</div>' +
      svgDuasLinhas(base, cmp, _metrica, mesQ, cmpQ);

    el.innerHTML = faixa + aviso + conv + comb + graf;
  }

  // ── Entrada ──────────────────────────────────────────────────────
  // Formatadores emprestados ao movimentacao-postos.js. SÓ estes três: o
  // fmtLCurto e o fmtRSCurto abreviam para "mil"/"mi", e a vista Por posto
  // é de conferência — lá os litros saem inteiros.
  window.mmFmt = { nf: nf, esc: esc, brData: brData, brDataCurta: brDataCurta };

  window.renderMovMes = function (sec) {
    if (!sec) return;
    if (!_pronto || _sec !== sec) montarShell(sec);
    carregarPostos();
    // Recarrega a cada entrada: o rollup do dia pode ter rodado entre duas
    // visitas, e o mês base default é o corrente.
    carregar();
  };
})();
