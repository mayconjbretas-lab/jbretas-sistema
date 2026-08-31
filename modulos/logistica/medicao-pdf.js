// ================================================================
// JBRETAS SISTEMA — modulos/logistica/medicao-pdf.js
// Botoes de impressao da Medicao, na aba Matriz / Medicao.
// Montado por window.medicaoPdf.montar({ getPosto, getPostos }) —
// mesmo contrato do medicaoFabs (app.js chama os dois lado a lado).
//
// SO A LOGISTICA DESKTOP. Nao entra no painel-adm nem no
// logistica-mobile — por isso e arquivo daqui e nao de shared/, e por
// isso os botoes NAO foram para o medicao-fabs.js (aquele e carregado
// tambem pelo logistica-mobile).
//
// DOIS BOTOES:
//   · posto selecionado — 2 paginas;
//   · rede inteira — 2 paginas por posto (74 com 37 postos), atras de
//     uma confirmacao que diz o tamanho e lembra do duplex.
//
// DUAS PAGINAS POR POSTO, para imprimir em FRENTE E VERSO:
//   FRENTE — medicao e pedido final LADO A LADO. Juntos de proposito:
//            se olha a medicao PARA decidir o pedido, entao os dois
//            tem que estar na mesma folha. A previsao do dia corrente
//            aparece em italico na medicao, que NAO leva linha de
//            total (ver tabela(): medicao e estoque, nao fluxo).
//   VERSO  — venda sozinha, com total por DIA (soma dos combustiveis
//            da linha) e total do mes por combustivel.
//
// LINHAS DE BORDA: alem do mes, a folha traz o ULTIMO dia do mes
// anterior no topo e o PRIMEIRO do seguinte no fim. O de tras mostra a
// medicao de fechamento que gerou o consumo do dia 1o; o da frente e
// onde se lanca o pedido da virada — em 31/08 o pedido de hoje e para
// 01/09, e sem essa linha nao havia onde escrever no papel.
// Elas NAO entram em soma nenhuma do mes (ver tabela(): `fora`), e vem
// em tom mais claro e com o mes no rotulo ('31 jul', '01 set').
// CARGA NAO ENTRA, a pedido: e onde os gerentes mais erram e a folha
// nao deve carregar o numero errado para dentro do posto.
//
// IMPRIME DE UM IFRAME PROPRIO, nao da pagina. A versao anterior
// montava a folha no proprio documento e escondia a aplicacao com
// '@media print { body > * { display:none } }' — saia em BRANCO em
// producao, e de quebra estragava o Ctrl+P normal da Logistica, que
// passava a imprimir paginas vazias existindo folha ou nao. O iframe
// carrega SO o medicao-print.css: nada do CSS da aplicacao alcanca a
// folha, e nada que a folha faca alcanca a aplicacao.
//
// SEM BIBLIOTECA: print() do iframe. Ver o cabecalho do print.css.
// ================================================================
(function () {
  'use strict';

  // CSS do documento do iframe, relativo a /modulos/logistica/.
  // O ?v= vem do PROPRIO script: o bump.js so reescreve tags do HTML, e esta
  // URL nasce no JS — sem isso o navegador serviria o print.css do cache para
  // sempre, mesmo depois de um bump. Amarrando na versao do medicao-pdf.js as
  // duas andam juntas, que e o que se quer (mudam sempre no mesmo commit).
  const CSS_FOLHA = 'medicao-print.css' +
    ((document.currentScript && document.currentScript.src.split('?')[1]) ? '?' + document.currentScript.src.split('?')[1] : '');

  let _opcoes = null;
  let _ocupado = false;

  const MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
                 'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  const DIA_SEM = ['dom','seg','ter','qua','qui','sex','sáb'];
  // So para o rotulo das linhas de borda ('31 jul'). MESES (acima) e o nome
  // cheio do cabecalho da folha.
  const MES_CURTO = ['jan','fev','mar','abr','mai','jun',
                     'jul','ago','set','out','nov','dez'];

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const temValor = (v) => v !== null && v !== undefined && v !== '';
  const fmt = (n) => (n === null || n === undefined || n === '')
    ? '' : Number(n).toLocaleString('pt-BR');
  const pad = (n) => String(n).padStart(2, '0');

  // ── Botoes ──────────────────────────────────────────────────────
  function montar(opcoes) {
    _opcoes = opcoes || {};
    const host = document.getElementById('matriz-acoes');
    if (!host) return;
    host.innerHTML =
      '<button type="button" class="matriz-btn-pdf" id="btn-folha-posto" ' +
      'title="2 páginas do posto selecionado (frente: medição · verso: venda e pedido). Imprima em frente e verso.">' +
      '🖨️ Folha do posto</button>' +
      '<button type="button" class="matriz-btn-pdf" id="btn-folha-rede" ' +
      'title="2 páginas para cada posto da rede, num documento só. Imprima em frente e verso.">' +
      '🖨️ Folhas da rede</button>';
    host.querySelector('#btn-folha-posto').addEventListener('click', imprimirPosto);
    host.querySelector('#btn-folha-rede').addEventListener('click', imprimirRede);
  }

  // Envolve o clique: trava os dois botoes, mostra progresso no que foi
  // clicado e devolve tudo ao normal aconteca o que acontecer.
  function comBotao(id, fn) {
    return async function () {
      if (_ocupado) return;
      const btn = document.getElementById(id);
      const txt = btn.textContent;
      _ocupado = true;
      document.querySelectorAll('.matriz-btn-pdf').forEach(b => { b.disabled = true; });
      try {
        await fn((t) => { btn.textContent = t; });
      } catch (err) {
        alert('Não foi possível montar a folha: ' + (err.message || err));
      } finally {
        btn.textContent = txt;
        document.querySelectorAll('.matriz-btn-pdf').forEach(b => { b.disabled = false; });
        _ocupado = false;
      }
    };
  }

  const imprimirPosto = comBotao('btn-folha-posto', async (progresso) => {
    const posto = _opcoes.getPosto ? _opcoes.getPosto() : '';
    if (!posto) { alert('Selecione um posto para imprimir a folha.'); return; }
    progresso('Montando…');
    await imprimirDocumento(await folhasDoPosto(posto, new Date()));
  });

  const imprimirRede = comBotao('btn-folha-rede', async (progresso) => {
    const postos = (_opcoes.getPostos ? (_opcoes.getPostos() || []) : []).filter(p => p && p.nome);
    if (!postos.length) { alert('Nenhum posto carregado ainda.'); return; }
    // O tamanho e o duplex vao no confirm porque as duas coisas so doem DEPOIS
    // de mandar imprimir: em simplex o verso de cada posto cai na frente do
    // seguinte e a pilha inteira vira lixo, sem nenhum aviso.
    const ok = confirm(
      postos.length + ' postos · ' + (postos.length * 2) + ' páginas.\n\n' +
      'Imprima em FRENTE E VERSO — em simplex o verso de cada posto cai na ' +
      'frente do próximo e a pilha inteira fica inútil.\n\nGerar?');
    if (!ok) return;
    const agora = new Date();
    const partes = [];
    for (let i = 0; i < postos.length; i++) {
      progresso('Montando ' + (i + 1) + '/' + postos.length + '…');
      // Em serie de proposito: 37 chamadas simultaneas ao Railway nao ganham
      // tempo util e atrapalham quem estiver usando o sistema no mesmo momento.
      partes.push(await folhasDoPosto(postos[i].nome, agora, postos[i].bandeira));
    }
    progresso('Abrindo…');
    await imprimirDocumento(partes.join(''));
  });

  // ── Impressao: iframe proprio ───────────────────────────────────
  function imprimirDocumento(corpoHtml) {
    return new Promise((resolve, reject) => {
      const antigo = document.getElementById('folha-iframe');
      if (antigo) antigo.remove();
      const ifr = document.createElement('iframe');
      ifr.id = 'folha-iframe';
      // Fora da vista, mas COM tamanho de verdade: iframe 0x0 ou display:none
      // nao faz layout, e a impressao sai vazia — que e exatamente o sintoma
      // que estamos consertando.
      ifr.setAttribute('aria-hidden', 'true');
      ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;' +
                          'opacity:0;pointer-events:none;border:0;z-index:-1';
      document.body.appendChild(ifr);

      const doc = ifr.contentDocument;
      doc.open();
      doc.write(
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
        '<title>Folha de Medição</title>' +
        '<link rel="stylesheet" href="' + CSS_FOLHA + '">' +
        '</head><body>' + corpoHtml + '</body></html>');
      doc.close();

      const mandar = () => {
        try {
          ifr.contentWindow.focus();
          ifr.contentWindow.print();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          // O dialogo e sincrono: quando print() volta, o usuario ja decidiu.
          setTimeout(() => {
            const el = document.getElementById('folha-iframe');
            if (el) el.remove();
          }, 1000);
        }
      };

      // Espera o CSS aplicar. Sem isso a folha pode ir para o dialogo sem
      // estilo nenhum — ou sem layout, que e o caso em branco.
      const link = doc.querySelector('link[rel="stylesheet"]');
      if (!link) { mandar(); return; }
      let disparado = false;
      const uma = () => { if (!disparado) { disparado = true; mandar(); } };
      link.addEventListener('load', uma);
      link.addEventListener('error', uma);   // sem CSS sai feio, mas sai
      setTimeout(uma, 3000);                 // rede lenta nao trava o botao
    });
  }

  // Um mes do posto. A rota ja aceitava ?mes= e ?ano= desde sempre.
  const buscarMes = (posto, ano, mes) =>
    apiFetch('/medicao/' + encodeURIComponent(posto) + '?mes=' + mes + '&ano=' + ano);

  // ── Uma folha (frente + verso) de um posto ──────────────────────
  async function folhasDoPosto(posto, agora, bandeiraConhecida) {
    const mes = agora.getMonth() + 1, ano = agora.getFullYear();
    const ant = new Date(ano, mes - 2, 1);   // mes anterior (vira o ano sozinho)
    const pro = new Date(ano, mes, 1);       // mes seguinte
    // Os TRES meses em paralelo: o anterior e o seguinte entram so por UMA
    // linha cada, e serializar triplicaria o tempo do botao da rede (37
    // postos). Paralelo por posto, serie entre postos — o laco da rede
    // continua sequencial, entao sao 3 chamadas simultaneas no maximo.
    const [dAnt, dCur, dPro] = await Promise.all([
      buscarMes(posto, ant.getFullYear(), ant.getMonth() + 1),
      buscarMes(posto, ano, mes),
      buscarMes(posto, pro.getFullYear(), pro.getMonth() + 1),
    ]);
    const bandeira = bandeiraConhecida !== undefined ? bandeiraConhecida : acharBandeira(posto);
    const grupos = dCur.grupos || [];
    const vendas = dCur.combustiveisVenda || [];
    const dias   = comBordas(dAnt, dCur, dPro);
    // Hoje comparado pela DATA INTEIRA, nao pelo numero do dia: com a linha
    // de borda, 31/07 e 31/08 tem o mesmo `dia` e as duas seriam marcadas
    // como hoje.
    const hojeData = pad(agora.getDate()) + '/' + pad(mes) + '/' + ano;
    const carimbo = pad(agora.getDate()) + '/' + pad(mes) + '/' + ano + ' ' +
                    pad(agora.getHours()) + ':' + pad(agora.getMinutes());
    const cab = (face) => topo(posto, bandeira, mes, ano, face);
    const rod = (n, legenda) => rodape(carimbo, n, legenda);

    return '' +
      // FRENTE: medicao e pedido lado a lado — a folha em que se decide.
      '<section class="folha folha-frente">' +
        cab('Frente · Medição e pedido') +
        '<div class="fl-blocos">' +
          '<div class="fl-bloco">' +
            '<div class="fl-bloco-tit">Medição (L)</div>' +
            tabela(dias, grupos, hojeData, 'medicao', { previsao: true, semTotal: true }) +
          '</div>' +
          '<div class="fl-bloco">' +
            '<div class="fl-bloco-tit">Pedido final aprovado (L)</div>' +
            tabela(dias, grupos, hojeData, 'pedido', {}) +
          '</div>' +
        '</div>' +
        rod(1, 'Em itálico: previsão do dia corrente — medição do dia anterior mais o pedido do dia. Valor previsto, não medido.') +
      '</section>' +
      // VERSO: venda sozinha. Sozinha ela cabe em largura inteira, e sobra
      // espaco para a coluna de total do DIA (soma dos combustiveis).
      '<section class="folha folha-verso">' +
        cab('Verso · Venda') +
        '<div class="fl-bloco-tit">Venda diária (L)</div>' +
        tabela(dias, vendas, hojeData, 'venda', { totalDia: true }) +
        rod(2, '') +
      '</section>';
  }

  // Array de dias do mes com UMA linha de borda de cada lado. As de borda
  // levam `fora: true` — e essa marca, e so ela, que governa as tres coisas:
  // ficar de fora das somas, o tom mais claro e o DD/MM no lugar do dia.
  function comBordas(dAnt, dCur, dPro) {
    const doMes = (dCur.dias || []).map(d => Object.assign({}, d, { fora: false }));
    const antes = (dAnt.dias || []).slice(-1).map(d => Object.assign({}, d, { fora: true }));
    const depois = (dPro.dias || []).slice(0, 1).map(d => Object.assign({}, d, { fora: true }));
    return antes.concat(doMes, depois);
  }

  function acharBandeira(nome) {
    const lista = _opcoes.getPostos ? (_opcoes.getPostos() || []) : [];
    const p = lista.find(x => x.nome === nome);
    return (p && p.bandeira) || '';
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

  // 'Pagina X de 2' e por POSTO, nao do documento: mesmo na impressao da rede
  // cada folha e um par frente/verso independente, e e assim que ela e usada
  // dentro do posto.
  function rodape(carimbo, n, legenda) {
    return '<div class="fl-rodape">' +
      '<span class="fl-legenda">' + (legenda ? esc(legenda) : '') + '</span>' +
      '<span>Gerado em ' + carimbo + ' · Página ' + n + ' de 2</span>' +
    '</div>';
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

  // Uma tabela: DIA + uma coluna por combustivel (+ linha de TOTAL).
  // `cols` e grupos (medicao/pedido) ou combustiveisVenda (venda) — a API
  // devolve as duas listas e os indices sao os de cada uma.
  function tabela(dias, cols, hojeData, campo, opt) {
    if (!cols.length) return '<div class="fl-bloco-tit">Sem combustíveis cadastrados</div>';
    const thead = '<tr><th class="fl-c-dia">Dia</th>' +
      cols.map(c => '<th>' + esc(c.abv) + '</th>').join('') +
      (opt.totalDia ? '<th class="fl-c-tot">Total</th>' : '') + '</tr>';

    const totais = cols.map(() => null);
    let body = '';
    dias.forEach((dia, idx) => {
      // dia.data vem 'DD/MM/AAAA'; o dia-da-semana sai dai, sem refazer fuso.
      const p = String(dia.data).split('/');
      const dow = new Date(+p[2], +p[1] - 1, +p[0]).getDay();
      const eHoje = dia.data === hojeData;
      const fds = dow === 0 || dow === 6;
      // Na linha de borda o dia vem com o mes ('31 jul'): so '31' no topo de
      // uma folha de agosto se le como 31 de agosto.
      const rotuloDia = dia.fora ? pad(dia.dia) + ' ' + MES_CURTO[+p[1] - 1] : pad(dia.dia);
      body += '<tr class="' + (eHoje ? 'fl-hoje ' : '') + (dia.fora ? 'fl-extra ' : '') +
        (fds ? 'fl-fds' : '') + '">' +
        '<td class="fl-c-dia">' + rotuloDia + '<span class="fl-dow">' + DIA_SEM[dow] + '</span></td>';
      cols.forEach((c, i) => {
        const val = dia[campo] ? dia[campo][i] : null;
        // `!dia.fora`: o total e DO MES. 01/09 e setembro e nao entra no
        // total de agosto — era o risco que o pedido apontou.
        if (temValor(val) && !dia.fora) totais[i] = (totais[i] || 0) + Number(val);
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
      // Total do DIA: soma dos combustiveis da linha. Null-aware — dia sem
      // nenhum lancamento fica travessao, nao zero (zero seria uma afirmacao
      // errada: 'vendeu nada' e diferente de 'nao foi lancado').
      if (opt.totalDia) {
        let soma = null;
        cols.forEach((c, i) => {
          const v = dia[campo] ? dia[campo][i] : null;
          if (temValor(v)) soma = (soma || 0) + Number(v);
        });
        body += '<td class="fl-c-tot">' + (soma == null ? '—' : fmt(soma)) + '</td>';
      }
      body += '</tr>';
    });

    // MEDICAO nao leva total (opt.semTotal): medicao e ESTOQUE, nao fluxo —
    // somar 31 leituras de tanque nao produz numero com significado (um tanque
    // de 15.000 L 'totalizaria' 465.000 no mes). Em venda e pedido a soma e o
    // que interessa: quanto saiu e quanto foi pedido no mes.
    // Nada entra no lugar: uma media teria denominador ambiguo no papel (dias
    // medidos ou dias do mes?) e o dia corrente pode estar em italico, que e
    // previsao e nao medicao — duas coisas impossiveis de explicar num rodape.
    const geral = totais.reduce((s, t) => (t == null ? s : (s || 0) + t), null);
    const tfoot = opt.semTotal ? '' :
      '<tfoot><tr><td class="fl-c-dia">Total</td>' +
      totais.map(t => '<td>' + (t == null ? '—' : fmt(t)) + '</td>').join('') +
      (opt.totalDia ? '<td class="fl-c-tot">' + (geral == null ? '—' : fmt(geral)) + '</td>' : '') +
      '</tr></tfoot>';

    return '<table class="fl-tab"><thead>' + thead + '</thead><tbody>' + body +
           '</tbody>' + tfoot + '</table>';
  }

  window.medicaoPdf = { montar: montar };
})();
