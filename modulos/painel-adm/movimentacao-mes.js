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
  function htmlVar(pct, tamanho) {
    var cls = 'mm-var' + (tamanho ? ' ' + tamanho : '');
    if (pct === null) return '<div class="' + cls + ' nada">sem dado para comparar</div>';
    if (Math.abs(pct) < 0.5) return '<div class="' + cls + ' igual">quase igual</div>';
    var sobe = pct > 0;
    var casas = Math.abs(pct) < 10 ? 1 : 0;
    return '<div class="' + cls + ' ' + (sobe ? 'sobe' : 'cai') + '">' +
      '<span class="mm-seta" aria-hidden="true">' + (sobe ? '▲' : '▼') + '</span> ' +
      (sobe ? 'subiu' : 'caiu') + ' ' + nf(Math.abs(pct), casas) + '%</div>';
  }

  // ── Shell ────────────────────────────────────────────────────────
  function montarShell(sec) {
    _sec = sec;
    var hj = hojeLocal();
    if (!_mes) { _mes = hj.slice(0, 7); _cmp = somarMeses(_mes, -1); }
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
    el.innerHTML =
      '<label class="mm-f"><span>Posto</span>' +
        '<select id="mm-posto" onchange="__mmFiltro(\'posto\', this.value)">' +
          '<option value=""' + (_posto ? '' : ' selected') + '>Rede toda</option>' +
          _postos.map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (p.id === _posto ? ' selected' : '') + '>' + esc(p.nome) + '</option>';
          }).join('') +
        '</select></label>' +
      '<label class="mm-f"><span>Mês</span>' +
        '<select id="mm-mes" onchange="__mmFiltro(\'mes\', this.value)">' + opcoesMes(_mes) + '</select></label>' +
      '<label class="mm-f"><span>Comparar com</span>' +
        '<select id="mm-cmp" onchange="__mmFiltro(\'cmp\', this.value)">' + opcoesMes(_cmp) + '</select></label>' +
      '<label class="mm-f"><span>Alcance</span>' +
        '<select id="mm-alcance" onchange="__mmFiltro(\'alcance\', this.value)">' +
          '<option value=""' + (_ateDia === null ? ' selected' : '') + '>Mês inteiro</option>' +
          ops +
        '</select></label>';
  }

  window.__mmFiltro = function (qual, valor) {
    if (qual === 'posto') _posto = valor;
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
      var qs = '?mes=' + _mes + '&cmp=' + _cmp +
        (_posto ? '&posto_id=' + encodeURIComponent(_posto) : '') +
        (_ateDia === null ? '' : '&ate_dia=' + _ateDia);
      var r = await apiFetch('/tecnox/faturamento-mes' + qs);
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
  function blocoConvenio(chave, rotulo, base, cmp, comparavel) {
    var b = (base.por_canal || []).find(function (c) { return c.chave === chave; });
    var c = (cmp.por_canal || []).find(function (x) { return x.chave === chave; });
    // AUSENTE e ZERO são coisas diferentes e a tela separa: 6 dos 37 postos não
    // têm 99 nenhum, e "R$ 0" é o fato; "sem 99 neste posto" é outro fato.
    if (!b) {
      return '<div class="mm-bloco mm-vazio"><div class="mm-nome">' + esc(rotulo) + '</div>' +
        '<div class="mm-num">—</div><div class="mm-var nada">sem movimento no mês</div></div>';
    }
    var pct = comparavel.ok && c ? variacao(b.faturamento, c.faturamento) : null;
    return '<div class="mm-bloco">' +
      '<div class="mm-nome">' + esc(rotulo) + '</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(b.faturamento)) + '">' + fmtRSCurto(b.faturamento) + '</div>' +
      htmlVar(pct) +
      '<div class="mm-sub">' + fmtLCurto(b.litros) + '</div>' +
      '</div>';
  }

  function blocoCombustivel(c, mapCmp, comparavel) {
    var o = mapCmp.get(c.codigo);
    var vR = comparavel.ok && o ? variacao(c.faturamento, o.faturamento) : null;
    var vL = comparavel.ok && o ? variacao(c.litros, o.litros) : null;
    // SINAIS OPOSTOS: subiu em litro e caiu em R$ (ou o contrário) é
    // exatamente a leitura que o DRE não dá, então o bloco acende e o detalhe
    // fica ABERTO — inclusive no celular, onde ele começaria fechado.
    var oposto = vR !== null && vL !== null &&
      Math.abs(vR) >= 0.5 && Math.abs(vL) >= 0.5 && (vR > 0) !== (vL > 0);
    return '<button type="button" class="mm-bloco mm-tocavel' + (oposto ? ' mm-oposto aberto' : '') + '"' +
      ' aria-expanded="' + (oposto ? 'true' : 'false') + '" onclick="__mmDetalhe(this)">' +
      '<div class="mm-nome">' + esc(c.rotulo) + '</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(c.faturamento)) + '">' + fmtRSCurto(c.faturamento) + '</div>' +
      htmlVar(vR) +
      (oposto ? '<div class="mm-aviso">o litro e o R$ foram para lados opostos</div>' : '') +
      '<div class="mm-det">' +
        '<div class="mm-det-num">' + fmtLCurto(c.litros) + '</div>' +
        htmlVar(vL, 'mm-var-mini') +
      '</div>' +
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

  // ── Pintura ──────────────────────────────────────────────────────
  function pintar() {
    if (!_pronto || !_sec) return;
    var el = _sec.querySelector('#mm-corpo');
    if (!el) return;

    if (_carregando) { el.innerHTML = '<div class="mm-aviso-caixa">Carregando…</div>'; return; }
    if (_erro) { el.innerHTML = '<div class="mm-aviso-caixa erro">' + esc(_erro) + '</div>'; return; }
    if (!_dados) { el.innerHTML = ''; return; }

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

    var aviso = '';
    if (!comparavel.ok) {
      if (comparavel.motivo === 'dias_diferentes') {
        aviso = '<div class="mm-aviso-caixa"><b>Sem variação:</b> ' + esc(nomeMes(mesQ)) + ' tem ' +
          comparavel.dias_base + ' dias com dado e ' + esc(nomeMes(cmpQ)) + ' tem ' +
          comparavel.dias_cmp + '. Comparar totais de tamanhos diferentes daria uma variação falsa.' +
          '<button type="button" class="mm-btn-conserto" onclick="__mmMesmosDias()">comparar os mesmos dias</button>' +
          '</div>';
      } else {
        aviso = '<div class="mm-aviso-caixa">Sem dado para comparar em ' + esc(nomeMes(cmpQ)) + '.</div>';
      }
    }

    // ── 1. CONVÊNIO ──
    var conv = '<h3 class="mm-titulo">Convênio</h3>' +
      '<div class="mm-blocos mm-2">' +
        blocoConvenio('SOUTAG', 'Soutag', base, cmp, comparavel) +
        blocoConvenio('99', 'App 99', base, cmp, comparavel) +
      '</div>';

    // ── 2. POR COMBUSTÍVEL ──
    var mapCmp = new Map(((cmp && cmp.por_combustivel) || []).map(function (c) { return [c.codigo, c]; }));
    var blocos = (base.por_combustivel || []).map(function (c) {
      return blocoCombustivel(c, mapCmp, comparavel);
    }).join('');
    var vTotR = comparavel.ok && cmp ? variacao(base.faturamento, cmp.faturamento) : null;
    var vTotL = comparavel.ok && cmp ? variacao(base.litros, cmp.litros) : null;
    var total = '<div class="mm-bloco mm-total">' +
      '<div class="mm-nome">Total</div>' +
      '<div class="mm-num" title="' + esc(fmtRSCheio(base.faturamento)) + '">' + fmtRSCurto(base.faturamento) + '</div>' +
      htmlVar(vTotR) +
      '<div class="mm-det aberto-sempre">' +
        '<div class="mm-det-num">' + fmtLCurto(base.litros) + '</div>' +
        htmlVar(vTotL, 'mm-var-mini') +
      '</div></div>';
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
  window.renderMovMes = function (sec) {
    if (!sec) return;
    if (!_pronto || _sec !== sec) montarShell(sec);
    carregarPostos();
    // Recarrega a cada entrada: o rollup do dia pode ter rodado entre duas
    // visitas, e o mês base default é o corrente.
    carregar();
  };
})();
