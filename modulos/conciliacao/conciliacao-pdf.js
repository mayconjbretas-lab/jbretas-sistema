// ================================================================
// conciliacao-pdf.js — relatório impresso do Calibrador.
//
// Uma linha por EQUIPAMENTO. Quando o posto tem dois, a segunda linha
// vem recuada e Data/Posto/Recolhido/Diferenca usam ROWSPAN sobre as
// duas: o recolhido e por COLETA, nao por equipamento. Repetir o valor
// nas duas linhas faria quem le somar duas vezes; deixar a celula vazia
// leria como falta. O rowspan diz "e o mesmo numero, das duas linhas".
//
// IMPRIME DE UM IFRAME PROPRIO, com CSS proprio — mesmo arranjo da folha
// de medicao da Logistica. La a versao que escondia a aplicacao com
// `@media print { body > * { display:none } }` saia EM BRANCO em
// producao e ainda estragava o Ctrl+P normal da tela. Nao repetir.
//
// SEM BIBLIOTECA: print() do iframe.
//
// O RELATORIO SEGUE O FILTRO DA TELA, inclusive o modo Pendentes. Isso e
// deliberado — o botao diz "do que esta na tela" —, mas o cabecalho
// IMPRIME os filtros aplicados, senao uma folha de 12 coletas parece o
// mes inteiro para quem a recebe sem contexto.
//
// Os dados vem de uma chamada PROPRIA com ?itens=1, nao do que a lista ja
// tem em memoria: a lista nao carrega equipamento nenhum (sao 2 consultas
// a mais no servidor, inuteis para a tela normal).
// ================================================================
(function () {
  'use strict';

  // Espelha o ?v= do proprio script: bump.js so reescreve tags do HTML, e
  // esta URL nasce aqui no JS. Sem isso o CSS da folha ficaria em cache para
  // sempre depois de um bump.
  const CSS_FOLHA = (function () {
    const s = document.currentScript && document.currentScript.src;
    const v = s && s.indexOf('?') >= 0 ? s.slice(s.indexOf('?')) : '';
    return 'conciliacao-print.css' + v;
  })();

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const din = (v) => (v == null || v === '') ? '—'
    : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inteiro = (v) => (v == null || v === '') ? '—' : Number(v).toLocaleString('pt-BR');
  const dataBR = (iso) => {
    if (!iso) return '—';
    const p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : String(iso);
  };

  // Rotulo do periodo. Prioriza os campos De/Ate; sem eles, deduz da
  // amplitude do que veio. Um mes inteiro sai como "agosto de 2026"; uma
  // janela solta sai como intervalo, para a folha nunca dizer "agosto"
  // mostrando 12 a 20 de agosto.
  function rotuloPeriodo(de, ate, coletas) {
    let ini = de, fim = ate;
    if (!ini || !fim) {
      const datas = coletas.map(c => String(c.data).slice(0, 10)).filter(Boolean).sort();
      if (!datas.length) return 'sem período';
      ini = ini || datas[0];
      fim = fim || datas[datas.length - 1];
    }
    const [ay, am, ad] = ini.split('-').map(Number);
    const [by, bm, bd] = fim.split('-').map(Number);
    if (ay === by && am === bm) {
      const ultimo = new Date(Date.UTC(ay, am, 0)).getUTCDate();
      if (ad === 1 && bd === ultimo) return MESES[am - 1] + ' de ' + ay;
      return ad + ' a ' + bd + ' de ' + MESES[am - 1] + ' de ' + ay;
    }
    return dataBR(ini) + '/' + ay + ' a ' + dataBR(fim) + '/' + by;
  }

  function classeDif(c) {
    if (c.sem_recolhido) return 'v-sem';
    const d = Number(c.diferenca);
    return d < 0 ? 'v-falta' : (d > 0 ? 'v-sobra' : 'v-zero');
  }

  function corpo(coletas, filtros) {
    if (!coletas.length) {
      return '<div class="f-vazio">Nenhuma coleta com os filtros aplicados.</div>';
    }

    let linhas = '';
    coletas.forEach(c => {
      // Coleta sem item (importada antiga) ainda precisa sair na folha: some-la
      // faria os totais nao baterem com a tela. Vira uma linha so, sem
      // equipamento.
      const itens = (c.itens && c.itens.length) ? c.itens : [{ equipamento: '—', inicial: null, final: null, usos: null, valor: c.valor_esperado }];
      const n = itens.length;
      const clsLinha = c.sem_recolhido ? ' sem-rec' : '';
      itens.forEach((it, i) => {
        const primeira = i === 0;
        linhas +=
          '<tr class="' + (primeira ? 'g-inicio' : '') + clsLinha + '">' +
          (primeira
            ? '<td class="mono g-span" rowspan="' + n + '">' + esc(dataBR(c.data)) + '</td>' +
              '<td class="g-span" rowspan="' + n + '">' + esc(c.posto || '—') + '</td>'
            : '') +
          '<td class="' + (primeira ? '' : 'eq-mais') + '">' + esc(it.equipamento || '—') + '</td>' +
          '<td class="num mono">' + inteiro(it.inicial) + '</td>' +
          '<td class="num mono">' + inteiro(it.final) + '</td>' +
          '<td class="num mono">' + inteiro(it.usos) + '</td>' +
          '<td class="num mono">' + din(it.valor) + '</td>' +
          (primeira
            ? '<td class="num mono g-span" rowspan="' + n + '">' +
                (c.sem_recolhido ? '<span class="v-sem">sem recolhido</span>' : din(c.valor_recolhido)) + '</td>' +
              '<td class="num mono g-span ' + classeDif(c) + '" rowspan="' + n + '">' +
                (c.sem_recolhido ? '—' : (Number(c.diferenca) > 0 ? '+' : '') + din(c.diferenca)) + '</td>'
            : '') +
          '</tr>';
      });
    });

    // TOTAIS — Recolhido e Diferenca somam SO as coletas que tem recolhido.
    // Tratar ausente como zero mostraria um rombo do tamanho do esperado
    // dessas coletas: um numero que nunca existiu, no lugar mais visivel da
    // folha. Mesma regra do resumo da tela, de proposito — folha e tela nao
    // podem discordar.
    const comRec = coletas.filter(c => !c.sem_recolhido);
    const semRec = coletas.length - comRec.length;
    const espTudo = coletas.reduce((a, c) => a + Number(c.valor_esperado || 0), 0);
    const espComRec = comRec.reduce((a, c) => a + Number(c.valor_esperado || 0), 0);
    const rec = comRec.reduce((a, c) => a + Number(c.valor_recolhido || 0), 0);
    const dif = rec - espComRec;
    const conf = coletas.filter(c => c.conferido).length;
    const comDif = comRec.filter(c => Number(c.diferenca) !== 0).length;
    const clsTot = dif < 0 ? 'v-falta' : (dif > 0 ? 'v-sobra' : 'v-zero');

    const rodapeFiltros = [
      filtros.posto   ? 'posto: ' + filtros.posto : '',
      filtros.lancou  ? 'lançado por: ' + filtros.lancou : '',
      filtros.destino ? 'destino: ' + filtros.destino : '',
      // Em Pendentes o status vem do modo, não do seletor — imprimir os dois
      // repetiria a mesma informação com dois nomes.
      filtros.modo === 'pendentes' ? 'somente pendentes de foto'
        : (filtros.status ? 'status: ' + filtros.status : ''),
    ].filter(Boolean).join(' · ') || 'sem filtros além do período';

    return '' +
      '<div class="f-cab">' +
        '<span class="f-tit">Conciliação · Calibrador</span>' +
        '<span class="f-per">' + esc(filtros.periodo) + '</span>' +
        '<span class="f-sub">' +
          'Destino: <b>' + esc(filtros.destino || 'todos') + '</b><br>' +
          esc(coletas.length) + ' coleta(s)' +
        '</span>' +
      '</div>' +
      // Teto da API cortou: a FOLHA diz. Um papel truncado em silêncio é pior
      // que a tela truncada em silêncio — ele circula sem quem o lê ter como
      // saber que falta coleta ali dentro.
      (filtros.truncado
        ? '<div class="f-corte">⚠ Lista cortada no teto de ' + esc(filtros.teto) +
          ' coletas — há mais no período. Estreite o filtro e gere de novo.</div>'
        : '') +
      '<table>' +
        '<thead><tr>' +
          '<th>Data</th><th>Posto</th><th>Equipamento</th>' +
          '<th class="num">Inicial</th><th class="num">Final</th><th class="num">Usos</th>' +
          '<th class="num">Esperado</th><th class="num">Recolhido</th><th class="num">Diferença</th>' +
        '</tr></thead>' +
        '<tbody>' + linhas + '</tbody>' +
        '<tfoot><tr>' +
          '<td colspan="6">Total — ' + coletas.length + ' coleta(s)</td>' +
          '<td class="num mono">' + din(espTudo) + '</td>' +
          '<td class="num mono">' + din(rec) + '</td>' +
          '<td class="num mono ' + clsTot + '">' + (dif > 0 ? '+' : '') + din(dif) + '</td>' +
        '</tr></tfoot>' +
      '</table>' +
      '<div class="f-resumo">' +
        '<div><span>Conferidas</span><b>' + conf + ' de ' + coletas.length + '</b></div>' +
        '<div><span>Sem recolhido</span><b class="' + (semRec ? 'v-sem' : '') + '">' + semRec + '</b></div>' +
        '<div><span>Com diferença</span><b class="' + (comDif ? 'v-falta' : '') + '">' + comDif +
          ' de ' + comRec.length + '</b></div>' +
        (semRec
          ? '<div><span>Esperado fora da conta da diferença</span><b>' + din(espTudo - espComRec) + '</b></div>'
          : '') +
      '</div>' +
      '<div class="f-rodape"><span>' + esc(rodapeFiltros) + '</span>' +
        '<span>JBRETAS · gerado em ' + esc(new Date().toLocaleString('pt-BR')) + '</span></div>';
  }

  // ── Impressao: iframe proprio ─────────────────────────────────
  function imprimirDocumento(corpoHtml) {
    return new Promise((resolve, reject) => {
      const antigo = document.getElementById('cc-folha-iframe');
      if (antigo) antigo.remove();
      const ifr = document.createElement('iframe');
      ifr.id = 'cc-folha-iframe';
      // Fora da vista, mas COM tamanho de verdade: iframe 0x0 ou display:none
      // nao faz layout e a impressao sai vazia.
      ifr.setAttribute('aria-hidden', 'true');
      ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:297mm;height:210mm;' +
                          'opacity:0;pointer-events:none;border:0;z-index:-1';
      document.body.appendChild(ifr);

      const doc = ifr.contentDocument;
      doc.open();
      doc.write(
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
        '<title>Conciliação — Calibrador</title>' +
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
          setTimeout(() => {
            const el = document.getElementById('cc-folha-iframe');
            if (el) el.remove();
          }, 1000);
        }
      };

      // Espera o CSS aplicar: sem isso a folha pode ir ao diálogo sem layout.
      const link = doc.querySelector('link[rel="stylesheet"]');
      if (!link) { mandar(); return; }
      let disparado = false;
      const uma = () => { if (!disparado) { disparado = true; mandar(); } };
      link.addEventListener('load', uma);
      link.addEventListener('error', uma);   // CSS quebrado imprime sem estilo,
      setTimeout(uma, 1500);                 // mas imprime — melhor que travar.
    });
  }

  window.conciliacaoPdf = { corpo, imprimirDocumento, rotuloPeriodo };
})();
