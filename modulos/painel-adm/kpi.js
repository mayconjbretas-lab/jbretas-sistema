// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/kpi.js
// Aba KPI (sugestão de pedido) do Painel ADM. ADITIVO: expõe
// window.renderKpi(container) — recebe o container, NÃO crava IDs
// globais fora dele (padrão do custo-margem.js / medicao.js).
//
// Fonte: GET /sugestao-pedido?data=&bandeira= (por posto+combustível:
// medição atual, capacidade, venda média, giro, fator do dia, sugestão).
// data/bandeira vão pra API (re-fetch); combustível/ordenar são filtros
// de cliente sobre a resposta. Gráficos em div+CSS (sem biblioteca).
// Roda no desktop (painel-adm, base.css) e no mobile (admin, tokens via
// ponte #s-kpi no admin.css). Depende de api.js (apiFetch).
// ================================================================
(function () {
  let _sec        = null;
  let _shellPronto = false;
  let _resp       = null;     // última resposta da API
  let _bandeiras  = null;     // bandeiras distintas (cache da 1ª carga sem filtro)
  let _combs      = null;     // combustíveis distintos (cache)
  // Filtros
  let _data     = '';         // '' → amanhã (default do input)
  let _bandeira = '';         // vai pra API
  let _fComb    = '';         // filtro de cliente
  let _ordenar  = 'giro';     // giro | sugerido | posto | venda
  let _subAba   = 'sugestao'; // sugestao | pico | giro | volume
  let _expandido = false;     // "Ver todos" da aba atual — reseta ao trocar aba/filtro

  // ── Helpers ─────────────────────────────────────────────────────
  function amanhaISO() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  const esc  = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtL = (n) => (n === null || n === undefined) ? '—' : Math.round(Number(n)).toLocaleString('pt-BR');
  const fmt2 = (n) => (n === null || n === undefined) ? '—'
    : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Giro (dias de cobertura) e fator do dia — formatação humana.
  // corGiro usa nomes LONGOS (--text2/--text3): existem nativos no painel-adm
  // (base.css) e resolvem via #s-kpi no admin. --tx2/--tx3 quebrariam no desktop.
  function fmtGiro(g) {
    if (g == null || !isFinite(g)) return '—';
    if (g < 0.25) return 'vazio';
    if (g < 0.5)  return 'meio dia';
    if (g < 1)    return 'hoje';
    if (g < 2)    return '1 dia';
    return Math.round(g) + ' dias';
  }
  function corGiro(g) {
    if (g == null || !isFinite(g)) return 'var(--text3)';
    if (g < 1) return 'var(--danger)';
    if (g < 2) return 'var(--warning)';
    return 'var(--text2)';
  }
  function fmtFator(f) {
    if (!f || f.base < 20) return 'sem base';
    var p = Math.round((f.valor - 1) * 100);
    if (p === 0) return 'na média';
    return (p > 0 ? '+' : '−') + Math.abs(p) + '%';
  }

  // "Sem medição": GNV (e afins) vêm com medicao_atual = 0 gravado — não é
  // tanque vazio, é tanque não arqueado. null/undefined não chegam como item
  // (a rota manda pra sem_medicao), mas trato os três por robustez.
  const semMedicao = (i) => i == null || i.medicao_atual == null || i.medicao_atual === 0;

  // Código → nome por extenso (para a legenda no filtro "Todos"). Fallback = código.
  const NOMES_COMB = {
    GC: 'gasolina comum', GA: 'gasolina aditivada', ET: 'etanol', ETAD: 'etanol aditivado',
    S10: 'diesel S-10', S500: 'diesel S-500', GNV: 'GNV',
    GRID: 'gasolina grid', OCTAPRO: 'gasolina octapro', POD: 'gasolina podium', PODIUM: 'gasolina podium',
  };
  const nomeComb = (cod) => NOMES_COMB[cod] || String(cod || '').toLowerCase();

  // Dia da semana → abreviação + plural (para a legenda "Entrega ter 18/08 ·
  // terças vendem +17%"). Chaveado pelo nome que a rota devolve em dia_semana.
  const DIAS_INFO = {
    'domingo':       { abbr: 'dom', plural: 'domingos' },
    'segunda-feira': { abbr: 'seg', plural: 'segundas' },
    'terça-feira':   { abbr: 'ter', plural: 'terças' },
    'quarta-feira':  { abbr: 'qua', plural: 'quartas' },
    'quinta-feira':  { abbr: 'qui', plural: 'quintas' },
    'sexta-feira':   { abbr: 'sex', plural: 'sextas' },
    'sábado':        { abbr: 'sáb', plural: 'sábados' },
  };
  const ddmm = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : (iso || ''); };
  const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; // índice = dia (0=dom)
  const DIAS_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];                       // rótulo das colunas do Pico
  const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0];                                                // segunda → domingo

  // ── Shell (filtros + métricas + tabela + gráficos), montado uma vez ─
  function montarShell(sec) {
    sec.innerHTML =
      '<div class="kpi-wrap">' +
        '<div class="kpi-filtros">' +
          '<label class="kpi-f"><span>Entrega</span>' +
            '<input type="date" id="kpi-data" class="kpi-inp"></label>' +
          '<label class="kpi-f"><span>Bandeira</span>' +
            '<select id="kpi-bandeira" class="kpi-inp"></select></label>' +
          '<label class="kpi-f"><span>Combustível</span>' +
            '<select id="kpi-comb" class="kpi-inp"></select></label>' +
          '<label class="kpi-f"><span>Ordenar</span>' +
            '<select id="kpi-ordenar" class="kpi-inp">' +
              '<option value="giro">Giro (menor 1º)</option>' +
              '<option value="sugerido">Sugerido (maior 1º)</option>' +
              '<option value="venda">Venda/dia (maior 1º)</option>' +
              '<option value="posto">Posto (A–Z)</option>' +
            '</select></label>' +
        '</div>' +
        // Cards e filtros ficam FIXOS acima das sub-abas (valem para todas).
        '<div class="kpi-metricas" id="kpi-metricas"></div>' +
        '<div class="kpi-subabas">' +
          '<button class="kpi-subaba" data-aba="sugestao">Sugestão</button>' +
          '<button class="kpi-subaba" data-aba="pico">Pico</button>' +
          '<button class="kpi-subaba" data-aba="giro">Giro</button>' +
          '<button class="kpi-subaba" data-aba="volume">Volume</button>' +
        '</div>' +
        '<div id="kpi-body"><div class="kpi-msg">Carregando…</div></div>' +
      '</div>';

    // Trocar filtro reseta o "Ver todos"; data/bandeira refazem a chamada,
    // combustível/ordenar só re-renderizam (uma leitura só alimenta as 4 abas).
    sec.querySelector('#kpi-data').onchange     = (e) => { _data = e.target.value || ''; _expandido = false; carregar(); };
    sec.querySelector('#kpi-bandeira').onchange = (e) => { _bandeira = e.target.value || ''; _expandido = false; carregar(); };
    sec.querySelector('#kpi-comb').onchange     = (e) => { _fComb = e.target.value || ''; _expandido = false; renderTudo(); };
    sec.querySelector('#kpi-ordenar').onchange  = (e) => { _ordenar = e.target.value || 'giro'; _expandido = false; renderTudo(); };
    sec.querySelectorAll('.kpi-subaba').forEach(btn => {
      btn.onclick = () => { _subAba = btn.dataset.aba; _expandido = false; renderTudo(); };
    });
    _shellPronto = true;
  }

  function popularSelects() {
    const selB = _sec.querySelector('#kpi-bandeira');
    const selC = _sec.querySelector('#kpi-comb');
    if (selB && _bandeiras && !selB.dataset.pronto) {
      selB.innerHTML = '<option value="">Todas as bandeiras</option>' +
        _bandeiras.map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join('');
      selB.dataset.pronto = '1';
    }
    if (selB) selB.value = _bandeira;
    if (selC && _combs && !selC.dataset.pronto) {
      selC.innerHTML = '<option value="">Todos</option>' +
        _combs.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
      selC.dataset.pronto = '1';
    }
    if (selC) selC.value = _fComb;
  }

  // ── Carga (GET /sugestao-pedido) ────────────────────────────────
  async function carregar() {
    const body = _sec.querySelector('#kpi-body');
    if (body) body.innerHTML = '<div class="kpi-msg">Carregando…</div>';
    let q = '/sugestao-pedido?data=' + encodeURIComponent(_data || amanhaISO());
    if (_bandeira) q += '&bandeira=' + encodeURIComponent(_bandeira);
    try {
      _resp = await apiFetch(q);
      // Cache das opções na 1ª carga (sem bandeira, cobre a rede toda).
      if (!_bandeira && !_bandeiras) {
        _bandeiras = [...new Set((_resp.itens || []).map(i => i.bandeira).filter(Boolean))].sort();
      }
      if (!_combs) {
        _combs = [...new Set((_resp.itens || []).map(i => i.combustivel).filter(Boolean))].sort();
      }
      popularSelects();
      renderTudo();
    } catch (err) {
      if (body) body.innerHTML = '<div class="kpi-erro">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    }
  }

  // ── Itens filtrados/ordenados (cliente) ─────────────────────────
  function itensView() {
    let arr = (_resp && _resp.itens) ? _resp.itens.slice() : [];
    if (_fComb) arr = arr.filter(i => i.combustivel === _fComb);
    const inf = Number.POSITIVE_INFINITY;
    // Sem-medição (e giro nulo) vão para o FIM na ordenação por giro — não são urgência.
    const giroKey = (i) => (semMedicao(i) || i.giro == null) ? inf : i.giro;
    if (_ordenar === 'giro')          arr.sort((a, b) => giroKey(a) - giroKey(b));
    else if (_ordenar === 'sugerido') arr.sort((a, b) => (b.sugestao || 0) - (a.sugestao || 0));
    else if (_ordenar === 'venda')    arr.sort((a, b) => (b.venda_media || 0) - (a.venda_media || 0));
    else if (_ordenar === 'posto')    arr.sort((a, b) => String(a.posto_nome).localeCompare(String(b.posto_nome)));
    return arr;
  }

  function renderTudo() {
    if (!_resp) return;
    renderMetricas();
    // Marca a sub-aba ativa.
    _sec.querySelectorAll('.kpi-subaba').forEach(b => b.classList.toggle('on', b.dataset.aba === _subAba));
    renderBodyOnly();
  }

  // Re-renderiza só o corpo (sem refazer a chamada) e liga o "Ver todos".
  function renderBodyOnly() {
    const body = _sec.querySelector('#kpi-body');
    if (!body) return;
    body.innerHTML = renderBody();
    const vt = body.querySelector('.kpi-vertodos');
    if (vt) vt.onclick = () => { _expandido = true; renderBodyOnly(); };
  }

  // Renderiza só a sub-aba ativa (uma leitura da rota alimenta todas).
  function renderBody() {
    if (_subAba === 'sugestao') return renderSugestao();
    if (_subAba === 'giro')     return renderGiro();
    if (_subAba === 'pico')     return renderPico();
    if (_subAba === 'volume')   return renderVolume();
    return '';
  }

  // Legenda do fator do dia (saiu do topo): "Entrega ter 18/08 · terças vendem
  // +17%" usando fmtFator do combustível selecionado (GC quando 'Todos').
  function renderLegenda() {
    const info = DIAS_INFO[_resp.dia_semana] || { abbr: '', plural: _resp.dia_semana || '' };
    const fatores = _resp.fatores || {};
    const pre = 'Entrega ' + esc(info.abbr) + ' ' + esc(ddmm(_resp.data_entrega)) + ' · ';
    // Um combustível filtrado: o fator vale para a lista toda → frase direta.
    if (_fComb) {
      return '<div class="kpi-legenda">' + pre + esc(info.plural) + ' vendem ' + esc(fmtFator(fatores[_fComb])) + '</div>';
    }
    // "Todos": a lista mistura combustíveis, então NOMEIA de qual é o fator (GC).
    return '<div class="kpi-legenda">' + pre + esc(nomeComb('GC')) + ' vende ' +
      esc(fmtFator(fatores.GC)) + ' às ' + esc(info.plural) + '</div>';
  }

  // ── Métricas (3 cards fixos no topo) ────────────────────────────
  function renderMetricas() {
    const el = _sec.querySelector('#kpi-metricas');
    if (!el) return;
    const tot = _resp.totais || {};
    // "Secam hoje" contado no FRONT: postos distintos com giro < 1 dia, EXCLUINDO
    // linhas sem medição (GNV etc.). Não usa totais.postos_criticos da rota (que
    // conta o giro 0 dos sem-medição e serve outros consumidores). Escopo = itens
    // da resposta (já filtrados por bandeira); não aplica o filtro de combustível.
    const criticos = new Set();
    (_resp.itens || []).forEach(i => { if (!semMedicao(i) && i.giro != null && i.giro < 1) criticos.add(i.posto_id); });
    const nCriticos = criticos.size;
    const cards = [
      { lbl: 'Sugerido total', val: fmtL(tot.sugerido) + ' L', sub: (_resp.data_entrega || '') },
      { lbl: 'Secam hoje', val: String(nCriticos), sub: 'giro < 1 dia',
        cls: (nCriticos ? 'kpi-m-crit ' : '') + 'kpi-card-click', id: 'kpi-card-secam' },
      { lbl: 'Rede 30 dias', val: fmtL(tot.rede_venda_30d) + ' L', sub: 'total vendido · rede' },
    ];
    el.innerHTML = cards.map(c =>
      '<div class="kpi-card ' + (c.cls || '') + '"' + (c.id ? ' id="' + c.id + '"' : '') + '>' +
        '<div class="kpi-card-lbl">' + esc(c.lbl) + '</div>' +
        '<div class="kpi-card-val">' + c.val + '</div>' +
        '<div class="kpi-card-sub">' + esc(c.sub) + '</div>' +
      '</div>').join('');
    // "Secam hoje" leva à sub-aba Giro.
    const secam = _sec.querySelector('#kpi-card-secam');
    if (secam) secam.onclick = () => { _subAba = 'giro'; _expandido = false; renderTudo(); };
  }

  // ── Tabela de sugestão ──────────────────────────────────────────
  // Célula de giro: sem-medição (GNV etc.) mostra "sem medição" em cinza,
  // ignorando o giro que veio da rota; senão, faixa + cor de corGiro.
  function giroCelula(i) {
    if (semMedicao(i)) return '<span class="kpi-giro" style="color:var(--text3)">sem medição</span>';
    return '<span class="kpi-giro" style="color:' + corGiro(i.giro) + '">' + esc(fmtGiro(i.giro)) + '</span>';
  }
  // Uma linha da tabela. `comSug` inclui a coluna SUGERIDO. No mobile, COMB e
  // TANQUE (classes kpi-c-*) somem e reaparecem na sub-linha cinza sob o posto.
  function linhaHtml(i, comSug) {
    const sub = '<span class="kpi-mob-sub">' + esc(i.combustivel) + ' · tanque ' + fmtL(i.medicao_atual) + ' L</span>';
    let html = '<tr>' +
      '<td class="kpi-td-posto">' + esc(i.posto_nome) + sub + '</td>' +
      '<td class="kpi-c-comb">' + esc(i.combustivel) + '</td>' +
      '<td class="kpi-num kpi-c-tanque">' + fmtL(i.medicao_atual) + '</td>' +
      '<td class="kpi-num">' + fmtL(i.capacidade) + '</td>' +
      '<td class="kpi-num">' + fmtL(i.venda_media) + '</td>' +
      '<td class="kpi-td-giro">' + giroCelula(i) + '</td>';
    if (comSug) {
      const teto = (i.limitado_por === 'espaco')
        ? ' <span class="kpi-teto" title="Limitado pelo espaço do tanque">teto</span>' : '';
      html += '<td class="kpi-num kpi-td-sug">' + fmtL(i.sugestao) + teto + '</td>';
    }
    return html + '</tr>';
  }

  // Tabela com corte de 10 linhas + "Ver todos (N)" (N = total após o corte).
  function tabelaLista(theadHtml, trs, total) {
    const vis = _expandido ? trs : trs.slice(0, 10);
    const btn = (!_expandido && trs.length > 10)
      ? '<button type="button" class="kpi-vertodos">Ver todos (' + total + ')</button>' : '';
    return '<div class="kpi-tbl-wrap"><table class="kpi-tbl"><thead>' + theadHtml +
      '</thead><tbody>' + vis.join('') + '</tbody></table></div>' + btn;
  }

  const THEAD_SUG  = '<tr><th class="kpi-td-posto">POSTO</th><th class="kpi-c-comb">COMB</th>' +
    '<th class="kpi-num kpi-c-tanque">TANQUE</th><th class="kpi-num">CAPACIDADE</th>' +
    '<th class="kpi-num">VENDA/DIA</th><th>GIRO</th><th class="kpi-num">SUGERIDO</th></tr>';
  const THEAD_GIRO = '<tr><th class="kpi-td-posto">POSTO</th><th class="kpi-c-comb">COMB</th>' +
    '<th class="kpi-num kpi-c-tanque">TANQUE</th><th class="kpi-num">CAPACIDADE</th>' +
    '<th class="kpi-num">VENDA/DIA</th><th>GIRO</th></tr>';

  // ── ABA SUGESTÃO ── só itens com sugerido > 0, na ordem atual (giro asc por padrão).
  function renderSugestao() {
    const arr = itensView().filter(i => (i.sugestao || 0) > 0);
    const leg = renderLegenda();
    if (!arr.length) return leg + '<div class="kpi-msg">Nenhum posto com sugestão de pedido.</div>';
    return leg + tabelaLista(THEAD_SUG, arr.map(i => linhaHtml(i, true)), arr.length);
  }

  // ── ABA GIRO ── lista COMPLETA (inclui sugerido 0 e sem medição), giro asc,
  // sem-medição no fim; diagnóstico, sem coluna SUGERIDO.
  function renderGiro() {
    let arr = (_resp.itens || []).slice();
    if (_fComb) arr = arr.filter(i => i.combustivel === _fComb);
    const inf = Number.POSITIVE_INFINITY;
    const key = (i) => (semMedicao(i) || i.giro == null) ? inf : i.giro;
    arr.sort((a, b) => key(a) - key(b));
    if (!arr.length) return '<div class="kpi-msg">Sem itens.</div>';
    return tabelaLista(THEAD_GIRO, arr.map(i => linhaHtml(i, false)), arr.length);
  }

  // ── ABA VOLUME ── ranking por venda_total_30d desc, barra proporcional ao maior.
  function renderVolume() {
    let arr = (_resp.itens || []).slice();
    if (_fComb) arr = arr.filter(i => i.combustivel === _fComb);
    const porPosto = new Map();
    arr.forEach(i => porPosto.set(i.posto_nome, (porPosto.get(i.posto_nome) || 0) + (Number(i.venda_total_30d) || 0)));
    const lista = [...porPosto.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!lista.length) return '<div class="kpi-msg">Sem venda registrada.</div>';
    const max = lista[0][1] || 1;
    const linhas = lista.map(([nome, v]) =>
      '<div class="kpi-hb-row"><div class="kpi-hb-lbl">' + esc(nome) + '</div>' +
      '<div class="kpi-hb-track"><div class="kpi-hb-bar" style="width:' + (v / max * 100) + '%"></div></div>' +
      '<div class="kpi-hb-num">' + fmtL(v) + '</div></div>');
    const vis = _expandido ? linhas : linhas.slice(0, 10);
    const btn = (!_expandido && linhas.length > 10)
      ? '<button type="button" class="kpi-vertodos">Ver todos (' + lista.length + ')</button>' : '';
    return '<div class="kpi-vol">' + vis.join('') + '</div>' + btn;
  }

  // Uma coluna do Pico. Metade superior (positivo, verde, rótulo acima) e inferior
  // (negativo, vermelho, rótulo abaixo) divergem da linha de base; o nome do dia
  // fica na faixa central, mesma altura em todas. Altura ∝ |desvio| / maxDev.
  function picoColuna(wd, f, maxDev) {
    const semBase = !f || f.base < 20;
    const dev = semBase ? 0 : (f.valor - 1);
    const h = Math.abs(dev) / maxDev * 100;
    // 'sem base' e 'média' (dev 0) ficam SEM barra, no MESMO lugar dos rótulos
    // positivos (faixa de valor, acima da linha), em cinza (--text3).
    let up = '', down = '';
    if (semBase) {
      up = '<span class="kpi-pc-vlbl kpi-pc-neu">sem base</span>';
    } else if (dev > 0) {
      up = '<span class="kpi-pc-vlbl kpi-pc-pos">' + esc(fmtFator(f)) + '</span>' +
           '<div class="kpi-pc-bar up" style="height:' + h + '%"></div>';
    } else if (dev < 0) {
      down = '<div class="kpi-pc-bar down" style="height:' + h + '%"></div>' +
             '<span class="kpi-pc-vlbl kpi-pc-neg">' + esc(fmtFator(f)) + '</span>';
    } else {
      up = '<span class="kpi-pc-vlbl kpi-pc-neu">média</span>'; // fmtFator = 'na média' → só "média"
    }
    return '<div class="kpi-pc-col">' +
      '<div class="kpi-pc-up">' + up + '</div>' +
      '<div class="kpi-pc-day">' + esc(DIAS_ABBR[wd]) + '</div>' +
      '<div class="kpi-pc-down">' + down + '</div>' +
    '</div>';
  }

  // ── ABA PICO ── colunas verticais divergindo da média, na ordem seg→dom.
  // Escala única: o maior |desvio| entre TODOS os dias = 100% da metade.
  function renderPico() {
    const cod  = _fComb || 'GC';
    const arr7 = (_resp.fatores_semana || {})[cod];
    const nome = nomeComb(cod);
    const topo = '<div class="kpi-legenda">' + esc(nome) + (_fComb ? '' : ' (padrão · filtro em Todos)') + '</div>';
    if (!Array.isArray(arr7)) return topo + '<div class="kpi-msg">Sem base para ' + esc(nome) + '.</div>';
    const maxDev = Math.max(0.0001, ...arr7.map(f => (!f || f.base < 20) ? 0 : Math.abs(f.valor - 1)));
    const cols = ORDEM_SEMANA.map(wd => picoColuna(wd, arr7[wd], maxDev)).join('');
    const legenda = '<div class="kpi-pico-legenda">A linha do meio é a venda média do ' + esc(nome) +
      '. Barra verde acima = o dia vende mais que a média. Barra vermelha abaixo = vende menos.</div>';
    return topo + '<div class="kpi-pico-chart">' + cols + '</div>' + legenda;
  }

  // ── Entrada pública ─────────────────────────────────────────────
  window.renderKpi = function (container) {
    if (!container) return;
    _sec = container;
    if (!_shellPronto || !container.querySelector('#kpi-data')) montarShell(container);
    const inp = container.querySelector('#kpi-data');
    if (inp && !inp.value) inp.value = _data || amanhaISO();
    carregar();
  };
})();
