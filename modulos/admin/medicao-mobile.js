// ================================================================
// JBRETAS SISTEMA — modulos/admin/medicao-mobile.js
// Tela MEDICAO do admin mobile. Expoe window.renderMedicaoMobile(sec),
// chamado pelo setTab (mesmo padrao do renderColetaRevisao).
//
// POR QUE ARQUIVO PROPRIO (e nao um ramo do painel-adm/medicao.js):
// aquele arquivo e o DESKTOP — uma tabela unica com os 5 grupos lado a
// lado (Medicao Venda Carga Pre-pedido Diferenca x N combustiveis, ~21
// colunas). No celular isso rolava nos dois eixos e obrigava a subir ate
// o topo para trocar de posto. Aqui a tela e outra: cabecalho fixo com
// setas de posto, alternador Semana/Mes, UMA categoria por vez em cinco
// abas no alcance do polegar, e so o corpo da tabela rolando.
// O desktop segue intocado; nenhuma linha dele foi ramificada.
//
// TOKENS: este arquivo e do admin, entao o CSS irmao usa o vocabulario
// CURTO (--tx/--bd/--ac/--sf/--inf) direto. Nao ha ponte longo->curto e
// nenhum token e declarado em :root — foi exatamente o vazamento que o
// medicao.css do painel-adm causava (declarava --c-* no :root DELE, que
// no admin virava o :root da pagina inteira).
//
// PREVISAO — o ponto mais facil de quebrar. Formula, identica ao desktop
// (painel-adm/medicao.js:315) e a Logistica (shared/js/matriz-medicao.js:227):
//     medicao(ontem) + pedido(hoje)  -> italico azul, com fundo
//     medicao(ontem), sem pedido     -> italico cinza, sem fundo
//     sem medicao(ontem)             -> travessao
// `pedido` e a coluna medicao.pedido (Pedido Final da Logistica), NAO
// pre_pedido. So aparece na aba MEDICAO, so na linha de HOJE e so quando
// a celula esta vazia (se o gerente ja lancou, o valor real manda).
// E DISPLAY: nao e gravada nem relida por calculo nenhum.
// ================================================================
(function () {
  'use strict';

  // ── Estado ──────────────────────────────────────────────────────
  let _shellPronto = false;
  let _postos      = [];      // GET /postos (id, nome, bandeira)
  let _bandeira    = '';      // '' = todas
  let _idx         = 0;       // posicao na lista JA filtrada por bandeira
  let _modo        = 'semana';// 'semana' | 'mes'
  let _ancora      = null;    // Date: segunda da semana, ou dia 1 do mes
  let _aba         = 'medicao';
  let _cacheMes    = new Map();   // 'AAAA-MM' -> resposta do GET /medicao/:posto
  const _dirty     = new Map();   // 'data|comb' -> { data, comb, valor }
  let _carregando  = false;

  const ABAS = [
    { k: 'medicao',   lbl: 'MEDIÇÃO', rot: 'Medição'    },
    { k: 'venda',     lbl: 'VENDA',   rot: 'Venda'      },
    { k: 'carga',     lbl: 'CARGA',   rot: 'Carga'      },
    { k: 'prePedido', lbl: 'PEDIDO',  rot: 'Pré-pedido' },
    { k: 'diferenca', lbl: 'DIF',     rot: 'Diferença'  },
  ];
  const DIA_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  // So para o rotulo das linhas de borda ('31 jul').
  const MES_CURTO = ['jan','fev','mar','abr','mai','jun',
                     'jul','ago','set','out','nov','dez'];
  const MESES   = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

  // ── Utilitarios (copiados do painel-adm/medicao.js; puros, sem DOM) ─
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (n) => (n === null || n === undefined || n === '')
    ? '' : Number(n).toLocaleString('pt-BR');
  function parseNum(str) {
    const raw = String(str).replace(/\./g, '').replace(',', '.').trim();
    return raw === '' ? null : Number(raw);
  }
  const temValor = (v) => v !== null && v !== undefined && v !== '';

  // ── Datas ───────────────────────────────────────────────────────
  // Date local, como o resto do projeto: o usuario esta no fuso de SP.
  const hoje = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const iso  = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                      '-' + String(d.getDate()).padStart(2, '0');
  const chaveMes = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const somaDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // Segunda-feira da semana de `d`. A semana vai de SEGUNDA a DOMINGO (7 dias),
  // com sabado e domingo visiveis — nao sao escondidos como na folha antiga.
  function segundaDe(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // getDay: 0=dom -> 0=seg
    return x;
  }

  // Intervalo [inicio, fim] do periodo atual, ambos inclusivos.
  // No modo MES o intervalo passa a incluir um dia de cada lado: o pedido de
  // um dia e para o dia SEGUINTE, entao em 31/08 o pedido de hoje e para
  // 01/09 e nao havia linha onde lancar. O dia de tras serve a leitura (a
  // medicao de fechamento que gerou o consumo do dia 1o).
  // A SEMANA nao precisa: ela ja cruza a virada sozinha, por construcao.
  function intervalo() {
    if (_modo === 'semana') return [_ancora, somaDias(_ancora, 6)];
    const ini = new Date(_ancora.getFullYear(), _ancora.getMonth(), 1);
    const fim = new Date(_ancora.getFullYear(), _ancora.getMonth() + 1, 0);
    return [somaDias(ini, -1), somaDias(fim, 1)];
  }

  // Primeiro dia do mes ancora — separa a borda de TRAS (somente leitura) da
  // de FRENTE (editavel).
  const primeiroDoMes = () => new Date(_ancora.getFullYear(), _ancora.getMonth(), 1);

  function rotuloPeriodo() {
    const [a, b] = intervalo();
    // No modo Mes o rotulo vem da ANCORA, nao do inicio do intervalo: com as
    // bordas o intervalo comeca no ultimo dia do mes anterior, e o cabecalho
    // de agosto mostraria "JUL".
    if (_modo === 'mes') return MESES[_ancora.getMonth()] + ' ' + _ancora.getFullYear();
    const dd = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    return dd(a) + '–' + dd(b);
  }

  // ── Postos ──────────────────────────────────────────────────────
  const listaFiltrada = () => _bandeira ? _postos.filter(p => p.bandeira === _bandeira) : _postos;
  const postoAtual    = () => listaFiltrada()[_idx] || null;

  // ── Carga de dados ──────────────────────────────────────────────
  // GET /medicao/:posto?mes=&ano= — a rota JA aceitava os dois parametros
  // (server.js:2981); o desktop so nunca os enviava. Nenhuma mudanca na API.
  async function carregarMes(posto, ano, mes) {
    const k = posto + '|' + ano + '-' + String(mes).padStart(2, '0');
    if (_cacheMes.has(k)) return _cacheMes.get(k);
    // ?margem=1 traz o mes mais o ultimo dia do anterior e o primeiro do
    // seguinte, com valores reais e marcados com fora_do_mes. No modo Mes e
    // o que da as linhas da virada em UMA chamada — costurar 3 meses no
    // cliente triplicaria as chamadas a cada seta de posto, em rede de celular.
    const resp = await apiFetch('/medicao/' + encodeURIComponent(posto) +
                                '?mes=' + mes + '&ano=' + ano + '&margem=1');
    _cacheMes.set(k, resp);
    return resp;
  }

  // Carrega os meses que o periodo cobre (a semana pode cruzar a virada) e
  // devolve { grupos, combustiveisVenda, porData } — porData indexado por ISO.
  async function dadosDoPeriodo() {
    const posto = postoAtual();
    if (!posto) return null;
    const meses = new Map();
    if (_modo === 'mes') {
      // UMA chamada: o ?margem=1 do proprio mes ja cobre as duas bordas.
      // Percorrer o intervalo aqui carregaria 3 meses e desfaria o ganho.
      meses.set(chaveMes(_ancora), { ano: _ancora.getFullYear(), mes: _ancora.getMonth() + 1 });
    } else {
      const [ini, fim] = intervalo();
      for (let d = new Date(ini); d <= fim; d = somaDias(d, 1)) {
        meses.set(chaveMes(d), { ano: d.getFullYear(), mes: d.getMonth() + 1 });
      }
    }
    const resps = [];
    for (const m of meses.values()) resps.push(await carregarMes(posto.nome, m.ano, m.mes));
    const porData = new Map();
    resps.forEach(r => (r.dias || []).forEach(dia => {
      // dia.data vem 'DD/MM/AAAA' do backend; indexa por ISO para casar com o laco.
      const p = String(dia.data).split('/');
      const k = p[2] + '-' + p[1] + '-' + p[0];
      // Na SEMANA que cruza a virada os dois meses sao carregados, e a mesma
      // data chega duas vezes: como dia normal de um e como borda do outro.
      // O dia do PROPRIO mes vence — senao 01/09 apareceria como borda numa
      // semana de setembro, cinza e fora do total.
      if (porData.has(k) && dia.fora_do_mes) return;
      porData.set(k, dia);
    }));
    return {
      grupos: resps[0].grupos || [],
      combustiveisVenda: resps[0].combustiveisVenda || [],
      porData,
    };
  }

  // ── Previsao e diferenca ────────────────────────────────────────
  // O dia 1o do mes PASSA A TER previsao. Antes havia uma guarda `mesmoMes`
  // aqui, para nao divergir do desktop: nenhuma das telas tinha o mes
  // anterior em memoria, entao no dia 1 nao havia `ontem` e nenhuma
  // projetava. Com o ?margem=1 as tres passam a ter a linha de tras, entao a
  // guarda saiu e a formula vale para todo dia que tenha o anterior
  // carregado. A formula em si nao mudou.
  function previsaoDe(d, dados, i) {
    const ontem = somaDias(d, -1);
    const dOntem = dados.porData.get(iso(ontem));
    const dHoje  = dados.porData.get(iso(d));
    const medOntem   = dOntem && dOntem.medicao ? dOntem.medicao[i] : null;
    const pedidoHoje = dHoje  && dHoje.pedido   ? dHoje.pedido[i]   : null;
    if (!temValor(medOntem))   return { valor: null, semPedido: false };
    if (!temValor(pedidoHoje)) return { valor: Number(medOntem), semPedido: true };
    return { valor: Number(medOntem) + Number(pedidoHoje), semPedido: false };
  }

  // DIFERENCA = medicao(hoje) − [ medicao(ontem) + carga(hoje) − venda(hoje) ].
  // CALCULADA aqui, nao lida de dia.diferenca: nenhuma rota da API escreve
  // nessa coluna (CAMPOS_MEDICAO, server.js:1107, nao a inclui), entao o valor
  // do banco nao e confiavel. Mesma escolha da Logistica (matriz-medicao.js:244).
  // Obrigatorias: so medicao(hoje) e medicao(ontem). carga/venda ausentes
  // contam 0 — dia sem descarga e normal, e e essa conta que denuncia carga
  // que nao desceu.
  function diferencaDe(d, dados, i) {
    const ontem = somaDias(d, -1);
    // Sem guarda de mes, pelo mesmo motivo da previsao: com a linha de tras
    // carregada, o dia 1o tem `ontem` e a conta fecha.
    const dHoje = dados.porData.get(iso(d));
    const dOntem = dados.porData.get(iso(ontem));
    if (!dHoje || !dOntem) return null;
    const medHoje  = dHoje.medicao ? dHoje.medicao[i] : null;
    const medOntem = dOntem.medicao ? dOntem.medicao[i] : null;
    if (!temValor(medHoje) || !temValor(medOntem)) return null;
    const carga = (dHoje.carga && temValor(dHoje.carga[i])) ? Number(dHoje.carga[i]) : 0;
    const g = dados.grupos[i];
    const iv = dados.combustiveisVenda.findIndex(c => c.comb === g.comb);
    const venda = (iv !== -1 && dHoje.venda && temValor(dHoje.venda[iv])) ? Number(dHoje.venda[iv]) : 0;
    return Number(medHoje) - (Number(medOntem) + carga - venda);
  }

  // ── Shell ───────────────────────────────────────────────────────
  function montarShell(sec) {
    sec.innerHTML =
      '<div class="mm-wrap">' +
        '<div class="mm-topo">' +
          '<div class="mm-posto">' +
            '<button class="mm-seta" id="mm-ant" aria-label="Posto anterior">‹</button>' +
            '<div class="mm-posto-txt">' +
              '<div class="mm-nome" id="mm-nome">carregando…</div>' +
              '<div class="mm-sub" id="mm-sub">—</div>' +
            '</div>' +
            '<button class="mm-seta" id="mm-prox" aria-label="Próximo posto">›</button>' +
            '<button class="mm-lupa" id="mm-lupa" aria-label="Filtrar por bandeira">⌕</button>' +
          '</div>' +
          '<div class="mm-bandeiras" id="mm-bandeiras" hidden></div>' +
          '<div class="mm-periodo">' +
            '<button class="mm-seta mm-seta-p" id="mm-per-ant" aria-label="Período anterior">‹</button>' +
            '<div class="mm-modo">' +
              '<button class="mm-modo-b on" data-modo="semana">Semana</button>' +
              '<button class="mm-modo-b" data-modo="mes">Mês</button>' +
            '</div>' +
            '<button class="mm-seta mm-seta-p" id="mm-per-prox" aria-label="Próximo período">›</button>' +
            '<div class="mm-per-lbl" id="mm-per-lbl"></div>' +
          '</div>' +
        '</div>' +
        '<div class="mm-corpo" id="mm-corpo"></div>' +
        '<div class="mm-rodape" id="mm-rodape"></div>' +
        '<div class="mm-abas" id="mm-abas">' +
          ABAS.map(a => '<button class="mm-aba' + (a.k === _aba ? ' on' : '') + '" data-aba="' +
            a.k + '">' + a.lbl + '</button>').join('') +
        '</div>' +
        '<button class="mm-salvar" id="mm-salvar" hidden>💾 Salvar pré-pedido</button>' +
      '</div>';

    sec.querySelector('#mm-ant').onclick      = () => passarPosto(-1);
    sec.querySelector('#mm-prox').onclick     = () => passarPosto(+1);
    sec.querySelector('#mm-lupa').onclick     = alternarFiltro;
    sec.querySelector('#mm-per-ant').onclick  = () => passarPeriodo(-1);
    sec.querySelector('#mm-per-prox').onclick = () => passarPeriodo(+1);
    sec.querySelector('#mm-salvar').onclick   = salvar;
    sec.querySelectorAll('.mm-modo-b').forEach(b => { b.onclick = () => trocarModo(b.dataset.modo); });
    sec.querySelectorAll('.mm-aba').forEach(b => { b.onclick = () => trocarAba(b.dataset.aba); });
    _shellPronto = true;
  }

  // ── Navegacao ───────────────────────────────────────────────────
  function passarPosto(n) {
    const lista = listaFiltrada();
    if (!lista.length) return;
    // Circular: do ultimo volta ao primeiro. Passar 37 postos com o polegar
    // nao pode esbarrar numa ponta.
    _idx = (_idx + n + lista.length) % lista.length;
    if (_dirty.size) _dirty.clear();
    repintar();
  }

  function passarPeriodo(n) {
    _ancora = _modo === 'semana'
      ? somaDias(_ancora, 7 * n)
      : new Date(_ancora.getFullYear(), _ancora.getMonth() + n, 1);
    repintar();
  }

  function trocarModo(modo) {
    if (modo === _modo) return;
    _modo = modo;
    // Reancora no periodo que contem a data que ja estava em foco, para a troca
    // nao teletransportar o usuario para outro mes.
    const ref = _modo === 'semana' ? segundaDe(_ancora) : new Date(_ancora.getFullYear(), _ancora.getMonth(), 1);
    _ancora = ref;
    document.querySelectorAll('.mm-modo-b').forEach(b => b.classList.toggle('on', b.dataset.modo === modo));
    repintar();
  }

  function trocarAba(aba) {
    if (aba === _aba) return;
    _aba = aba;
    document.querySelectorAll('.mm-aba').forEach(b => b.classList.toggle('on', b.dataset.aba === aba));
    // Sem refetch: o(s) mes(es) do periodo ja estao em memoria.
    repintar();
  }

  function alternarFiltro() {
    const host = document.getElementById('mm-bandeiras');
    const lupa = document.getElementById('mm-lupa');
    const abrir = host.hasAttribute('hidden');
    host.toggleAttribute('hidden', !abrir);
    lupa.classList.toggle('on', abrir);
    if (abrir) montarFiltro(host);
  }

  function montarFiltro(host) {
    const bandeiras = [...new Set(_postos.map(p => p.bandeira).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    host.innerHTML =
      '<button class="mm-band' + (_bandeira === '' ? ' on' : '') + '" data-b="">todas</button>' +
      bandeiras.map(b => '<button class="mm-band' + (b === _bandeira ? ' on' : '') +
        '" data-b="' + esc(b) + '">' + esc(b) + '</button>').join('');
    host.querySelectorAll('.mm-band').forEach(btn => {
      btn.onclick = () => {
        _bandeira = btn.dataset.b;
        _idx = 0;                       // a lista mudou: volta ao 1o da bandeira
        montarFiltro(host);
        repintar();
      };
    });
  }

  // ── Render ──────────────────────────────────────────────────────
  async function repintar() {
    const posto = postoAtual();
    const lista = listaFiltrada();
    const nome  = document.getElementById('mm-nome');
    const sub   = document.getElementById('mm-sub');
    const corpo = document.getElementById('mm-corpo');
    document.getElementById('mm-per-lbl').textContent = rotuloPeriodo();
    atualizarSalvar();

    if (!posto) {
      nome.textContent = 'nenhum posto';
      sub.textContent  = '0 de 0 · ' + (_bandeira || 'todas');
      corpo.innerHTML  = '<div class="mm-msg">Nenhum posto nesta bandeira.</div>';
      document.getElementById('mm-rodape').innerHTML = '';
      return;
    }
    nome.textContent = posto.nome.replace(/^P\.\s*/i, '');
    sub.textContent  = (_idx + 1) + ' de ' + lista.length + ' · ' + (_bandeira || 'todas');

    const meu = ++_carregando;
    corpo.innerHTML = '<div class="mm-msg">Carregando…</div>';
    let dados;
    try {
      dados = await dadosDoPeriodo();
    } catch (err) {
      if (meu !== _carregando) return;
      corpo.innerHTML = '<div class="mm-erro">Erro ao carregar: ' + esc(err.message || err) + '</div>';
      return;
    }
    // Passar postos rapido dispara varias cargas; so a ultima pinta.
    if (meu !== _carregando || !dados) return;
    renderTabela(dados);
  }

  function renderTabela(dados) {
    const corpo = document.getElementById('mm-corpo');
    const fuels = dados.grupos;
    if (!fuels.length) {
      corpo.innerHTML = '<div class="mm-msg">Sem combustíveis cadastrados para este posto.</div>';
      document.getElementById('mm-rodape').innerHTML = '';
      return;
    }
    const ehVenda = _aba === 'venda';
    const ehPed   = _aba === 'prePedido';
    const hj      = iso(hoje());
    const [ini, fim] = intervalo();

    let thead = '<tr><th class="mm-c-dia">DIA</th>' +
      fuels.map(f => '<th>' + esc(f.abv) + '</th>').join('') +
      (ehVenda ? '<th class="mm-c-tot">TOT</th>' : '') + '</tr>';

    let body = '';
    const totais = fuels.map(() => null);
    for (let d = new Date(ini); d <= fim; d = somaDias(d, 1)) {
      const k   = iso(d);
      const dia = dados.porData.get(k);
      const eHoje = k === hj;
      const fds = d.getDay() === 0 || d.getDay() === 6;
      const fora = !!(dia && dia.fora_do_mes);
      // Borda de TRAS (antes do 1o do mes) e so leitura: existe para VER o
      // fechamento. A da FRENTE e editavel — e o pedido da virada.
      const soLeitura = fora && d < primeiroDoMes();
      body += '<tr class="' + (eHoje ? 'mm-hoje' : '') + (fds ? ' mm-fds' : '') +
              (fora ? ' mm-fora' : '') + '"' +
              (eHoje ? ' id="mm-linha-hoje"' : '') + '>';
      // Na borda o rotulo leva o mes ('31 jul'): so '31' no topo de uma tela
      // de agosto se le como 31 de agosto.
      const rotulo = fora
        ? String(d.getDate()).padStart(2, '0') + ' ' + MES_CURTO[d.getMonth()]
        : String(d.getDate()).padStart(2, '0');
      body += '<td class="mm-c-dia"' + (soLeitura ? ' title="Mês anterior — somente leitura"' : '') +
              '>' + rotulo + '<span class="mm-dow">' + DIA_SEM[d.getDay()] + '</span></td>';

      fuels.forEach((f, i) => {
        let val = null;
        if (_aba === 'diferenca')      val = diferencaDe(d, dados, i);
        else if (dia && dia[_aba])     val = dia[_aba][i];

        // `!fora`: o rodape mostra o total DO MES. 01/09 e setembro e nao
        // entra no total de agosto.
        if (temValor(val) && !fora) totais[i] = (totais[i] || 0) + Number(val);

        if (ehPed && !soLeitura) {
          body += '<td class="mm-cel-ed"><input class="mm-in" inputmode="decimal" value="' +
            (val == null ? '' : fmt(val)) + '" data-data="' + esc(k) + '" data-comb="' +
            esc(f.comb) + '" oninput="__mmDirty(this)" onfocus="this.select()"></td>';
        } else if (_aba === 'diferenca' && fora) {
          // Celula VAZIA nas linhas de borda: a diferenca vem do dia anterior, e
          // o anterior ao 31/07 nao e carregado. Travessao aqui leria como 'dia
          // sem valor', que e outra coisa.
          body += '<td class="mm-na"></td>';
        } else if (_aba === 'diferenca') {
          const cls = val == null ? 'mm-vazio' : (val > 0 ? 'mm-dif-pos' : (val < 0 ? 'mm-dif-neg' : 'mm-dif-zero'));
          const txt = val == null ? '—' : ((val > 0 ? '+' : '') + fmt(val));
          body += '<td><span class="' + cls + '">' + txt + '</span></td>';
        } else if (_aba === 'medicao' && eHoje && val == null) {
          // Previsao do dia corrente (ver cabecalho do arquivo).
          const p = previsaoDe(d, dados, i);
          if (p.valor == null)      body += '<td><span class="mm-vazio">—</span></td>';
          else if (p.semPedido)     body += '<td><span class="mm-prev-sp">' + fmt(p.valor) + '</span></td>';
          else                      body += '<td class="mm-cel-prev"><span class="mm-prev">' + fmt(p.valor) + '</span></td>';
        } else {
          // Na borda de tras a celula do PEDIDO cai aqui: vira texto, com a
          // classe mm-ro. Campo que nao aceita clique sem sinal nenhum parece
          // defeito, entao ela fica visivelmente diferente de um input.
          const cls = (val == null ? 'mm-vazio' : 'mm-val') + (soLeitura && ehPed ? ' mm-ro' : '');
          body += '<td' + (soLeitura && ehPed ? ' class="mm-cel-ro" title="Mês anterior — somente leitura"' : '') +
            '><span class="' + cls + '">' + (val == null ? '—' : fmt(val)) + '</span></td>';
        }
      });

      if (ehVenda) {
        let som = null;
        fuels.forEach((f, i) => {
          const v = dia && dia.venda ? dia.venda[i] : null;
          if (temValor(v)) som = (som || 0) + Number(v);
        });
        body += '<td class="mm-c-tot"><span class="' + (som == null ? 'mm-vazio' : 'mm-vtot') + '">' +
          (som == null ? '—' : fmt(som)) + '</span></td>';
      }
      body += '</tr>';
    }

    corpo.innerHTML = '<table class="mm-tab"><thead>' + thead + '</thead><tbody>' + body + '</tbody></table>';
    renderRodape(fuels, totais);
    const lh = document.getElementById('mm-linha-hoje');
    if (lh) lh.scrollIntoView({ block: 'center' });
  }

  function renderRodape(fuels, totais) {
    const aba = ABAS.find(a => a.k === _aba);
    const geral = totais.reduce((s, v) => (v == null ? s : (s || 0) + v), null);
    document.getElementById('mm-rodape').innerHTML =
      '<span class="mm-rod-lbl">' + (_modo === 'semana' ? 'Semana' : 'Mês') + ' · ' + esc(aba.rot) + '</span>' +
      '<span class="mm-rod-val">' + (geral == null ? '—' : fmt(geral)) + '</span>';
  }

  // ── Edicao do pre-pedido ────────────────────────────────────────
  window.__mmDirty = function (inp) {
    inp.classList.add('mm-in-dirty');
    _dirty.set(inp.dataset.data + '|' + inp.dataset.comb,
      { data: inp.dataset.data, comb: inp.dataset.comb, valor: parseNum(inp.value) });
    atualizarSalvar();
  };

  function atualizarSalvar() {
    const b = document.getElementById('mm-salvar');
    if (b) b.toggleAttribute('hidden', _dirty.size === 0);
  }

  async function salvar() {
    const posto = postoAtual();
    if (!_dirty.size || !posto) return;
    const b = document.getElementById('mm-salvar');
    b.disabled = true;
    const orig = b.textContent;
    b.textContent = 'Salvando…';
    const itens = [..._dirty.values()].map(e => ({
      data: e.data, combustivel: e.comb, campo: 'pre_pedido', valor: e.valor,
    }));
    try {
      await apiFetch('/medicao', { method: 'POST', body: JSON.stringify({ posto: posto.nome, itens }) });
      _dirty.clear();
      document.querySelectorAll('.mm-in-dirty').forEach(i => i.classList.remove('mm-in-dirty'));
      // O mes salvo saiu do ar: invalida o cache para a proxima leitura vir do banco.
      [..._cacheMes.keys()].filter(k => k.startsWith(posto.nome + '|')).forEach(k => _cacheMes.delete(k));
      b.textContent = '✓ Salvo';
      setTimeout(() => { b.textContent = orig; b.disabled = false; atualizarSalvar(); }, 1200);
    } catch (err) {
      b.textContent = orig;
      b.disabled = false;
      alert('Erro ao salvar o pré-pedido: ' + (err.message || err));
    }
  }

  // ── Entrada ─────────────────────────────────────────────────────
  async function iniciar() {
    _ancora = segundaDe(hoje());
    try {
      const resp = await apiFetch('/postos');
      _postos = resp.postos || [];
    } catch (err) {
      document.getElementById('mm-corpo').innerHTML =
        '<div class="mm-erro">Erro ao carregar postos: ' + esc(err.message || err) + '</div>';
      return;
    }
    repintar();
  }

  window.renderMedicaoMobile = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('#mm-corpo')) { montarShell(sec); iniciar(); return; }
    repintar();   // re-entrada: shell persiste, so repinta o escopo atual
  };
})();
