// ================================================================
// JBRETAS SISTEMA — modulos/logistica-mobile/sugestao-mobile.js
// Aba "Sugestão de Pedido" do logistica-mobile (entra pelo Mais+, molde do
// Custo & Margem). Render MOBILE-ESPECÍFICO (layout empilhado, 4 colunas) —
// NÃO reusa o kpi.js (que monta o shell desktop de 6 colunas + sub-abas).
// Consome o MESMO endpoint GET /sugestao-pedido. Depende de api.js (apiFetch)
// e do base.css (tokens LONGOS: --ok/--danger/--surface2/--text3/--warning/
// --accent — todos existem no mobile).
//
// ⚠ DUPLICAÇÃO CONSCIENTE: as fórmulas de PED/Δ e as helpers de giro
// (fmtGiro/corGiro) espelham as do modulos/painel-adm/kpi.js. São privadas do
// IIFE de lá (não dá para importar sem carregar o módulo desktop). Se mudar a
// REGRA (cálculo do Δ, buckets/cores do giro), mude NOS DOIS lugares.
// ================================================================
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtL = (n) => (n === null || n === undefined) ? '—' : Math.round(Number(n)).toLocaleString('pt-BR');

  // espelha fmtGiro/corGiro do kpi.js (ver aviso no topo)
  function fmtGiro(g) {
    if (g == null || !isFinite(g)) return '—';
    if (g < 0.25) return 'vazio';
    if (g < 0.5) return 'meio dia';
    if (g < 1) return 'hoje';
    if (g < 2) return '1 dia';
    return Math.round(g) + ' dias';
  }
  function corGiro(g) {
    if (g == null || !isFinite(g)) return 'var(--text3)';
    if (g < 1) return 'var(--danger)';   // <1 dia = ação hoje
    if (g < 2) return 'var(--warning)';  // 1 dia = atenção
    return 'var(--text2)';               // 2+ dias = ok
  }

  function amanhaISO() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  let _data = '';   // '' → amanhã (default do endpoint)

  // Célula de pedido (número) + Δ menor logo abaixo. DUPLICA a regra do
  // blocoHtml (kpi.js): Δ = pedido − sugestão; "—"/sem Δ se pedido null; sem Δ
  // se Δ==0; senão com sinal, verde (--ok) / vermelho (--danger).
  function pedCell(sug, ped) {
    if (ped == null) return '<span class="mbsug-ped">—</span>';
    const d = Number(ped) - (Number(sug) || 0);
    let delta = '';
    if (d !== 0) {
      delta = '<span class="mbsug-delta ' + (d > 0 ? 'pos' : 'neg') + '">' +
        (d > 0 ? '+' : '−') + fmtL(Math.abs(d)) + '</span>';
    }
    return '<span class="mbsug-ped">' + fmtL(ped) + '</span>' + delta;
  }

  function linhaHtml(i) {
    return '<div class="mbsug-lin">' +
      '<span class="mbsug-comb">' + esc(i.combustivel) + '</span>' +
      '<span class="mbsug-giro" style="color:' + corGiro(i.giro) + '">' + esc(fmtGiro(i.giro)) + '</span>' +
      '<span class="mbsug-sug">' + fmtL(i.sugestao) + '</span>' +
      '<span class="mbsug-ped-cell">' + pedCell(i.sugestao, i.pedido) + '</span>' +
    '</div>';
  }

  async function render(host) {
    host.innerHTML = '<div class="mbsug"><div class="mbsug-msg">Carregando…</div></div>';
    let resp;
    try {
      resp = await apiFetch('/sugestao-pedido' + (_data ? ('?data=' + encodeURIComponent(_data)) : ''));
    } catch (e) {
      host.innerHTML = '<div class="mbsug"><div class="mbsug-msg">Erro ao carregar a sugestão.</div></div>';
      return;
    }

    // Filtro opção (b), igual ao desktop: sugerido > 0 OU pedido lançado.
    const itens = (resp.itens || []).filter(i => (i.sugestao || 0) > 0 || i.pedido != null);

    // Agrupa por posto: total sugerido, total pedido (só lançados; ausente ≠ 0),
    // e giro mínimo (para ordenar os blocos por urgência).
    const mapa = new Map();
    itens.forEach(i => {
      let b = mapa.get(i.posto_nome);
      if (!b) { b = { nome: i.posto_nome, combs: [], sug: 0, ped: 0, temPed: false, minGiro: Infinity }; mapa.set(i.posto_nome, b); }
      b.combs.push(i);
      b.sug += (i.sugestao || 0);
      if (i.pedido != null) { b.ped += Number(i.pedido); b.temPed = true; }
      const g = (i.giro == null) ? Infinity : i.giro;
      if (g < b.minGiro) b.minGiro = g;
    });
    const blocos = [...mapa.values()];
    blocos.forEach(b => b.combs.sort((x, y) => (x.giro == null ? Infinity : x.giro) - (y.giro == null ? Infinity : y.giro)));
    blocos.sort((a, b) => a.minGiro - b.minGiro);   // mais urgente primeiro

    // Totais da REDE: sugerido do backend; pedido somado no cliente (só lançados).
    const redeSug = (resp.totais && resp.totais.sugerido != null) ? resp.totais.sugerido : itens.reduce((s, i) => s + (i.sugestao || 0), 0);
    let redePed = 0, redeTemPed = false;
    itens.forEach(i => { if (i.pedido != null) { redePed += Number(i.pedido); redeTemPed = true; } });
    const dataEnt = resp.data_entrega || _data || amanhaISO();

    const topo = '<div class="mbsug-topo">' +
      '<label class="mbsug-data">ENTREGA<input type="date" id="mbsug-data" value="' + esc(dataEnt) + '"></label>' +
      '<div class="mbsug-rede">' +
        '<span class="mbsug-rede-sug">SUG REDE<b>' + fmtL(redeSug) + ' L</b></span>' +
        '<span class="mbsug-rede-ped">PED REDE<b>' + (redeTemPed ? fmtL(redePed) + ' L' : '—') + '</b></span>' +
      '</div></div>';

    let corpo;
    if (!blocos.length) {
      corpo = '<div class="mbsug-msg">Nenhum posto com sugestão ou pedido.</div>';
    } else {
      corpo = '<div class="mbsug-blocos">' + blocos.map(b =>
        '<div class="mbsug-bloco"><div class="mbsug-cab">' +
          '<span class="mbsug-nome">' + esc(b.nome) + '</span>' +
          '<span class="mbsug-tot">' + fmtL(b.sug) + ' <span class="mbsug-seta">→</span> ' +
            '<b class="mbsug-tot-ped">' + (b.temPed ? fmtL(b.ped) : '—') + '</b></span>' +
        '</div>' + b.combs.map(linhaHtml).join('') + '</div>'
      ).join('') + '</div>';
    }

    host.innerHTML = '<div class="mbsug">' + topo + corpo + '</div>';
    const inp = host.querySelector('#mbsug-data');
    if (inp) inp.onchange = (e) => { _data = e.target.value || ''; render(host); };
  }

  // Abre pelo Mais+ (molde do abrirCustoMobile): fecha o modal, limpa .active de
  // .scr/.nbtn (Mais não é toggle → nenhum nbtn fica aceso), ativa #s-sugestao,
  // desliga os FABs (saiu da Medição) e remove sem-reserva-bnav (rola livre).
  // Voltar para a Medição pelo bnav religa FABs/layout via setTab.
  window.abrirSugestaoMobile = function () {
    document.getElementById('modal-mais').classList.remove('open');
    document.querySelectorAll('.scr').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.nbtn').forEach(x => x.classList.remove('active'));
    const sec = document.getElementById('s-sugestao');
    sec.classList.add('active');
    if (window.medicaoFabs) window.medicaoFabs.setVisivel(false);
    document.querySelector('.main')?.classList.remove('sem-reserva-bnav');
    render(sec);
  };
})();
