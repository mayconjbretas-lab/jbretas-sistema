// ================================================================
// JBRETAS SISTEMA — modulos/logistica/medicao-pdf.js
// Botao de impressao da Medicao, na aba Matriz / Medicao.
// Montado por window.medicaoPdf.montar({ getPosto, getPostos }) —
// mesmo contrato do medicaoFabs (app.js chama os dois lado a lado).
//
// SO A LOGISTICA DESKTOP. Nao entra no painel-adm nem no
// logistica-mobile — por isso e arquivo daqui e nao de shared/, e por
// isso o botao NAO foi para o medicao-fabs.js (aquele e carregado
// tambem pelo logistica-mobile).
//
// DUAS PAGINAS POR POSTO, para imprimir em FRENTE E VERSO:
//   FRENTE — medicao do mes + linha de total; a previsao do dia
//            corrente aparece em italico.
//   VERSO  — venda e pedido final LADO A LADO, cada um com total.
// CARGA NAO ENTRA, a pedido: e onde os gerentes mais erram e a folha
// nao deve carregar o numero errado para dentro do posto.
//
// UM POSTO POR VEZ (o selecionado no filtro). A rede inteira daria 74
// paginas — arquivo que ninguem abre, e que impresso em simplex poe o
// verso de cada posto na frente do seguinte, arruinando o documento
// todo em silencio. Se um dia precisar, o laco entra aqui.
//
// SEM BIBLIOTECA: window.print() + medicao-print.css. Ver o cabecalho
// daquele arquivo para o porque.
// ================================================================
(function () {
  'use strict';

  let _opcoes = null;
  let _ocupado = false;

  const MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
                 'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  const DIA_SEM = ['dom','seg','ter','qua','qui','sex','sáb'];

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const temValor = (v) => v !== null && v !== undefined && v !== '';
  const fmt = (n) => (n === null || n === undefined || n === '')
    ? '' : Number(n).toLocaleString('pt-BR');
  const pad = (n) => String(n).padStart(2, '0');

  // ── Botao ───────────────────────────────────────────────────────
  function montar(opcoes) {
    _opcoes = opcoes || {};
    const host = document.getElementById('matriz-acoes');
    if (!host) return;
    host.innerHTML =
      '<button type="button" class="matriz-btn-pdf" id="btn-medicao-pdf" ' +
      'title="Gera 2 páginas (frente: medição · verso: venda e pedido). Imprima em frente e verso.">' +
      '🖨️ Imprimir folha do posto</button>';
    host.querySelector('#btn-medicao-pdf').addEventListener('click', imprimir);
  }

  async function imprimir() {
    if (_ocupado) return;
    const posto = _opcoes.getPosto ? _opcoes.getPosto() : '';
    if (!posto) { alert('Selecione um posto para imprimir a folha.'); return; }
    const btn = document.getElementById('btn-medicao-pdf');
    _ocupado = true;
    const txt = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Montando…';
    try {
      const hoje = new Date();
      const mes = hoje.getMonth() + 1, ano = hoje.getFullYear();
      const dados = await apiFetch('/medicao/' + encodeURIComponent(posto) +
                                   '?mes=' + mes + '&ano=' + ano);
      const bandeira = acharBandeira(posto);
      montarFolha(posto, bandeira, dados, mes, ano, hoje);
      // O dialogo do navegador e sincrono: so volta quando o usuario
      // imprime ou cancela. A folha fica no DOM ate la (display:none na tela).
      window.print();
    } catch (err) {
      alert('Não foi possível montar a folha: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = txt;
      _ocupado = false;
    }
  }

  function acharBandeira(nome) {
    const lista = _opcoes.getPostos ? (_opcoes.getPostos() || []) : [];
    const p = lista.find(x => x.nome === nome);
    return (p && p.bandeira) || '';
  }

  // ── Previsao (identica a matriz e ao admin mobile) ───────────────
  // medicao(ontem) + pedido(hoje); so medicao(ontem) se nao ha pedido;
  // nada se nao ha medicao(ontem). `pedido` e medicao.pedido (Pedido
  // Final). No papel nao ha cor: o italico e o unico sinal, e a legenda
  // do rodape diz o que ele significa.
  function previsaoDe(dias, idxDia, i) {
    const ontem = dias[idxDia - 1];
    if (!ontem) return null;                       // dia 1: sem ontem no mes (igual as outras telas)
    const medOntem = ontem.medicao ? ontem.medicao[i] : null;
    if (!temValor(medOntem)) return null;
    const ped = dias[idxDia].pedido ? dias[idxDia].pedido[i] : null;
    return temValor(ped) ? Number(medOntem) + Number(ped) : Number(medOntem);
  }

  // ── Montagem da folha ───────────────────────────────────────────
  function montarFolha(posto, bandeira, dados, mes, ano, agora) {
    let el = document.getElementById('folha-impressao');
    if (!el) {
      el = document.createElement('div');
      el.id = 'folha-impressao';
      document.body.appendChild(el);   // filho DIRETO do body: o print.css conta com isso
    }
    const grupos = dados.grupos || [];
    const vendas = dados.combustiveisVenda || [];
    const dias   = dados.dias || [];
    const ehMesCorrente = agora.getFullYear() === ano && agora.getMonth() + 1 === mes;
    const diaHoje = ehMesCorrente ? agora.getDate() : -1;
    const carimbo = pad(agora.getDate()) + '/' + pad(mes) + '/' + ano + ' ' +
                    pad(agora.getHours()) + ':' + pad(agora.getMinutes());
    const cab = (face) => topo(posto, bandeira, mes, ano, face);
    const rod = (n, legenda) => rodape(carimbo, n, legenda);

    el.innerHTML =
      // ── FRENTE: so a medicao ──
      '<section class="folha folha-frente">' +
        cab('Frente · Medição') +
        tabela(dias, grupos, diaHoje, 'medicao', { previsao: true }) +
        rod(1, 'Em itálico: previsão do dia corrente — medição do dia anterior mais o pedido do dia. Valor previsto, não medido.') +
      '</section>' +
      // ── VERSO: venda e pedido lado a lado (ver .fl-blocos no print.css) ──
      '<section class="folha folha-verso">' +
        cab('Verso · Venda e pedido') +
        '<div class="fl-blocos">' +
          '<div class="fl-bloco">' +
            '<div class="fl-bloco-tit">Venda diária (L)</div>' +
            tabela(dias, vendas, diaHoje, 'venda', {}) +
          '</div>' +
          '<div class="fl-bloco">' +
            '<div class="fl-bloco-tit">Pedido final aprovado (L)</div>' +
            tabela(dias, grupos, diaHoje, 'pedido', {}) +
          '</div>' +
        '</div>' +
        rod(2, '') +
      '</section>';
  }

  function topo(posto, bandeira, mes, ano, face) {
    return '<div class="fl-topo">' +
      '<div class="fl-posto">' + esc(posto) + '</div>' +
      '<div class="fl-meta">' +
        '<span class="fl-band">' + esc(bandeira || '—') + '</span>' +
        '<span class="fl-mes">' + MESES[mes - 1] + ' / ' + ano + '</span>' +
      '</div>' +
      '<div class="fl-face">' + esc(face) + '</div>' +
    '</div>';
  }

  function rodape(carimbo, n, legenda) {
    return '<div class="fl-rodape">' +
      '<span class="fl-legenda">' + (legenda ? esc(legenda) : '') + '</span>' +
      '<span>Gerado em ' + carimbo + ' · Página ' + n + ' de 2</span>' +
    '</div>';
  }

  // Uma tabela: DIA + uma coluna por combustivel + linha de TOTAL.
  // `cols` e grupos (medicao/pedido) ou combustiveisVenda (venda) — a API
  // devolve as duas listas e os indices sao os de cada uma.
  function tabela(dias, cols, diaHoje, campo, opt) {
    if (!cols.length) return '<div class="fl-bloco-tit">Sem combustíveis cadastrados</div>';
    let thead = '<tr><th class="fl-c-dia">Dia</th>' +
      cols.map(c => '<th>' + esc(c.abv) + '</th>').join('') + '</tr>';

    const totais = cols.map(() => null);
    let body = '';
    dias.forEach((dia, idx) => {
      // dia.data vem 'DD/MM/AAAA'; o dia-da-semana sai dai, sem refazer fuso.
      const p = String(dia.data).split('/');
      const dow = new Date(+p[2], +p[1] - 1, +p[0]).getDay();
      const eHoje = dia.dia === diaHoje;
      const fds = dow === 0 || dow === 6;
      body += '<tr class="' + (eHoje ? 'fl-hoje ' : '') + (fds ? 'fl-fds' : '') + '">' +
        '<td class="fl-c-dia">' + pad(dia.dia) + '<span class="fl-dow">' + DIA_SEM[dow] + '</span></td>';
      cols.forEach((c, i) => {
        const val = dia[campo] ? dia[campo][i] : null;
        if (temValor(val)) totais[i] = (totais[i] || 0) + Number(val);
        if (temValor(val)) {
          body += '<td>' + fmt(val) + '</td>';
        } else if (opt.previsao && eHoje) {
          const prev = previsaoDe(dias, idx, i);
          body += prev == null
            ? '<td class="fl-vazio">—</td>'
            : '<td class="fl-prev">' + fmt(prev) + '</td>';
        } else {
          body += '<td class="fl-vazio">—</td>';
        }
      });
      body += '</tr>';
    });

    const tfoot = '<tr><td class="fl-c-dia">Total</td>' +
      totais.map(t => '<td>' + (t == null ? '—' : fmt(t)) + '</td>').join('') + '</tr>';

    return '<table class="fl-tab"><thead>' + thead + '</thead><tbody>' + body +
           '</tbody><tfoot>' + tfoot + '</tfoot></table>';
  }

  window.medicaoPdf = { montar: montar };
})();
