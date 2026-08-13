// ================================================================
// JBRETAS SISTEMA — shared/js/solicitacoes-logistica.js
// Ciclo de preço (lado LOGÍSTICA). Molde estrutural: solicitacoes-gerente.js.
// Só age se o perfil for LOGISTICA.
//
// Faz:
//  1) Polling a cada 20s de GET /solicitacoes-preco?status=todas (a Logística
//     é central: vê a REDE toda). Separa em memória: aguardando_logistica no
//     topo (pendentes) + o resto no histórico (por data desc).
//  2) Faixa de aviso clicável no topo (inserida após a .topbar) → troca para a
//     SEÇÃO "tab-precos" (não abre mais bottom-sheet).
//  3) Renderiza a SEÇÃO de página em #sl-pagina: título + contagem, cards das
//     pendentes (1 por posto, cabeçalho colorido), separador Histórico com
//     seletor de data, e cards do histórico agrupados por dia.
//
// Ação: POST /solicitacoes-preco/:id/aprovar (SEM corpo/foto). Aprovar libera
// a troca na bomba e só então o gerente é avisado (backend).
//
// Expõe window.solicitacoesLogistica = { refresh, abrir, montarEm(container) }.
// Sem montarEm, renderPagina escreve no #sl-pagina do document (desktop).
// CSS injetado via <style> com os tokens LONGOS do base.css (dual-theme).
// ================================================================
(function () {
  const INTERVALO_MS = 20000;
  const FUEL_LABEL = {
    GC: 'Gasolina Comum', GA: 'Gasolina Aditivada', ET: 'Etanol',
    S10: 'Diesel S10', S500: 'Diesel S500',
  };
  const FUEL_ORDER = ['GC', 'GA', 'ET', 'S10', 'S500'];

  let _solicitacoes = [];     // último snapshot (rede toda, todos os status)
  let _ultimaContagem = null; // p/ detectar aumento de pendentes (beep). null = 1º poll
  let _dataHist = '';         // filtro de dia do histórico ('' = todos)
  let _ultimoRenderSig = null;// evita re-render desnecessário a cada poll
  let _ctx = null;            // AudioContext único/persistente (lazy)
  let _somPendente = false;   // poll tocou com áudio travado → toca no 1º gesto
  let _container = null;      // se montarEm() foi chamado, renderPagina escreve aqui
                              // (senão, cai no #sl-pagina do document — desktop)

  // Host da página: o container passado via montarEm() ou, na falta dele, o
  // #sl-pagina do document (comportamento do desktop, inalterado).
  function hostPagina() {
    return _container || document.getElementById('sl-pagina');
  }

  function ehLogistica() {
    try { return (getUsuarioLogado() || {}).perfil === 'LOGISTICA'; }
    catch (e) { return false; }
  }

  // ── Formatação ──────────────────────────────────────────────────
  function fmtBRL(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function horaDe(iso) {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }
  function diaISO(iso) {
    try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
    catch (e) { return ''; }
  }
  function diaLabel(iso) {
    try {
      return new Date(iso).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch (e) { return ''; }
  }
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Áudio (mesma máquina do lado gerente) ───────────────────────
  function garantirCtx() {
    if (!_ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) _ctx = new AC();
      } catch (e) { _ctx = null; }
    }
    return _ctx;
  }
  function destravarAudio() {
    if (_ctx && _ctx.state === 'running' && !_somPendente) return;
    try {
      const ctx = garantirCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended' && ctx.resume) {
        ctx.resume().then(() => {
          if (_somPendente && ctx.state === 'running') { _somPendente = false; tocarNotificacao(); }
        }).catch(() => {});
      } else if (ctx.state === 'running' && _somPendente) {
        _somPendente = false;
        tocarNotificacao();
      }
    } catch (e) { /* silencioso */ }
  }
  function tocarNotificacao() {
    const agendar = (ctx) => {
      const seq = [659.25, 880, 1108.73]; // E5, A5, C#6
      const passo = 0.18;
      const gapSeq = 0.35;
      const nota = (freq, t0, dur) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(ctx.destination);
        const o1 = ctx.createOscillator();
        o1.type = 'sine'; o1.frequency.value = freq; o1.connect(g);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t0);
        g2.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g2.connect(ctx.destination);
        const o2 = ctx.createOscillator();
        o2.type = 'triangle'; o2.frequency.value = freq * 2; o2.connect(g2);
        o1.start(t0); o1.stop(t0 + dur);
        o2.start(t0); o2.stop(t0 + dur);
      };
      const base = ctx.currentTime + 0.03;
      const durSeq = seq.length * passo;
      for (let rep = 0; rep < 2; rep++) {
        const ini = base + rep * (durSeq + gapSeq);
        seq.forEach((f, i) => nota(f, ini + i * passo, passo));
      }
    };
    try {
      const ctx = garantirCtx();
      if (ctx && ctx.state === 'running') {
        _somPendente = false;
        agendar(ctx);
      } else {
        _somPendente = true;
        if (ctx && ctx.state === 'suspended' && ctx.resume) {
          ctx.resume().then(() => {
            if (_somPendente && ctx.state === 'running') { _somPendente = false; agendar(ctx); }
          }).catch(() => {});
        }
      }
    } catch (e) { _somPendente = true; }
    try {
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    } catch (e) { /* iOS/sem suporte — silencioso */ }
  }

  // ── Estilo (tokens longos do base.css; dual-theme) ──────────────
  function injetarEstilo() {
    if (document.getElementById('solic-logistica-style')) return;
    const st = document.createElement('style');
    st.id = 'solic-logistica-style';
    st.textContent =
      // faixa de aviso no topo (a Logística não tem bnav → sem badge)
      '.sl-faixa{display:none;cursor:pointer;margin:0;padding:.7rem 1rem;background:var(--surface2);' +
        'border-bottom:2px solid var(--accent);color:var(--accent);font-family:var(--mono);' +
        'font-size:.8rem;font-weight:700;text-align:center}' +
      '.sl-faixa.visivel{display:block}' +
      // página (seção tab-precos)
      '#sl-pagina{padding:1rem 0}' +
      '.sl-head{display:flex;align-items:baseline;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem}' +
      '.sl-h1{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--text)}' +
      '.sl-count-alerta{font-family:var(--mono);font-size:.78rem;font-weight:700;color:var(--danger)}' +
      '.sl-cards{display:flex;flex-direction:column;gap:.8rem}' +
      // card + cabeçalho colorido (encosta nas bordas, arredonda só em cima)
      '.sl-card{background:var(--surface2);border:1px solid var(--border);border-radius:12px;overflow:hidden}' +
      '.sl-card-hd{display:flex;justify-content:space-between;align-items:center;gap:.6rem;' +
        'padding:.5rem .9rem;border-radius:12px 12px 0 0}' +
      '.sl-hd-posto{font-family:var(--mono);font-weight:700;font-size:.86rem}' +
      '.sl-hd-estado{font-family:var(--mono);font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}' +
      '.sl-hd-pend{background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger)}' +
      '.sl-hd-ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}' +
      '.sl-hd-aguard{background:color-mix(in srgb,var(--warning) 20%,transparent);color:var(--warning)}' +
      '.sl-hd-canc{background:var(--surface3);color:var(--text3)}' +
      '.sl-card-body{padding:.8rem .9rem}' +
      '.sl-linhas{display:flex;flex-direction:column;gap:.55rem}' +
      // Linha = miniatura opcional à esquerda + corpo em grid. No corpo (desktop):
      // combustível à esquerda, preço à direita (linha 1) e horário abaixo (linha 2).
      // No mobile, o override em #mb-precos empilha combustível/horário/preço.
      '.sl-linha{display:flex;gap:.6rem;align-items:flex-start}' +
      '.sl-thumb{width:52px;height:52px;flex-shrink:0;object-fit:cover;border-radius:8px;' +
        'border:1px solid var(--border);cursor:pointer}' +
      '.sl-linha-corpo{flex:1;min-width:0;display:grid;grid-template-columns:1fr auto;' +
        'grid-template-areas:"fuel precos" "tempos tempos";column-gap:.6rem;align-items:baseline}' +
      '.sl-fuel{grid-area:fuel;font-weight:600;color:var(--text);font-size:.82rem}' +
      '.sl-precos{grid-area:precos;justify-self:end;font-family:var(--mono);font-size:.86rem;color:var(--text3)}' +
      '.sl-novo{color:var(--accent);font-weight:700}' +
      '.sl-tempos{grid-area:tempos;font-family:var(--mono);font-size:.62rem;color:var(--text3);margin-top:2px}' +
      '.sl-aprovar{width:100%;margin-top:.8rem;background:var(--accent);color:#0a0d0f;border:none;' +
        'border-radius:8px;padding:.7rem;font-family:var(--mono);font-size:.76rem;font-weight:700;' +
        'letter-spacing:.04em;text-transform:uppercase;cursor:pointer}' +
      '.sl-aprovar:disabled{background:var(--surface3);color:var(--text3);cursor:not-allowed;opacity:.65}' +
      '.sl-erro{color:var(--danger);font-size:.72rem;margin-top:.5rem;display:none}' +
      '.sl-erro.on{display:block}' +
      // separador + histórico
      '.sl-sep{display:flex;align-items:center;justify-content:space-between;gap:.6rem;' +
        'margin:1.4rem 0 .8rem;border-top:1px solid var(--border);padding-top:.9rem}' +
      '.sl-sep-txt{font-family:var(--mono);font-size:.78rem;font-weight:700;color:var(--text2)}' +
      '.sl-data{background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);' +
        'font-family:var(--mono);font-size:.72rem;padding:.35rem .5rem}' +
      '.sl-dia{margin-bottom:1rem}' +
      '.sl-dia-lbl{font-family:var(--mono);font-size:.68rem;color:var(--text3);text-transform:uppercase;' +
        'letter-spacing:.05em;margin-bottom:.5rem}' +
      '.sl-vazio{text-align:center;color:var(--text3);font-size:.82rem;padding:1.2rem}';
    document.head.appendChild(st);
  }

  // ── Faixa de aviso (inserida após a .topbar da Logística) ───────
  function updateFaixa(count) {
    let faixa = document.getElementById('sl-faixa');
    if (count > 0) {
      if (!faixa) {
        const host = document.querySelector('.topbar');
        if (!host || !host.parentNode) return;
        faixa = document.createElement('div');
        faixa.id = 'sl-faixa';
        faixa.className = 'sl-faixa';
        faixa.addEventListener('click', () => abrir());
        host.parentNode.insertBefore(faixa, host.nextSibling);
      }
      const plural = count === 1 ? 'alteração de preço aguardando aprovação'
                                 : 'alterações de preço aguardando aprovação';
      faixa.textContent = '⚠️ ' + count + ' ' + plural + ' — TOCAR AQUI';
      faixa.classList.add('visivel');
    } else if (faixa) {
      faixa.classList.remove('visivel');
    }
  }

  // Contador inline no item "Alteração de Preços" da sidebar.
  function updateNavContador(count) {
    const el = document.getElementById('sl-nav-count');
    if (!el) return;
    el.textContent = count > 0 ? ' (' + count + ')' : '';
  }

  // ── Agrupamentos ────────────────────────────────────────────────
  function agruparPorPosto(itens) {
    const map = {};
    itens.forEach(s => {
      const pid = s.posto_id;
      if (!map[pid]) map[pid] = { posto_id: pid, posto_nome: s.posto_nome || String(pid), itens: [] };
      map[pid].itens.push(s);
    });
    const arr = Object.keys(map).map(k => map[k]);
    arr.forEach(g => g.itens.sort((a, b) =>
      FUEL_ORDER.indexOf(a.combustivel) - FUEL_ORDER.indexOf(b.combustivel)));
    arr.sort((a, b) => String(a.posto_nome).localeCompare(String(b.posto_nome)));
    return arr;
  }
  function agruparPorDia(itens) {
    const map = {};
    itens.forEach(s => {
      const dia = diaISO(s.criado_em);
      if (!map[dia]) map[dia] = { dia, label: diaLabel(s.criado_em), itens: [] };
      map[dia].itens.push(s);
    });
    const arr = Object.keys(map).map(k => map[k]);
    arr.sort((a, b) => String(b.dia).localeCompare(String(a.dia))); // desc
    return arr;
  }

  // ── HTML ────────────────────────────────────────────────────────
  function lineHtml(s, isHist) {
    const fuel = FUEL_LABEL[s.combustivel] || s.combustivel;
    const precos = fmtBRL(s.preco_antigo) + ' → <span class="sl-novo">' + fmtBRL(s.preco_novo) + '</span>';
    let tempos;
    if (!isHist) {
      tempos = 'solicitado ' + horaDe(s.criado_em);
    } else {
      const parts = ['solicitado ' + horaDe(s.criado_em)];
      if (s.aprovado_em) parts.push('aprovado ' + horaDe(s.aprovado_em));
      parts.push(s.confirmado_em ? 'placa trocada ' + horaDe(s.confirmado_em) : 'placa pendente');
      tempos = parts.join(' · ');
    }
    // Miniatura da placa: só no HISTÓRICO, na linha CONFIRMADA (placa trocada)
    // e se houver foto. Aprovada-sem-confirmação (âmbar) e pendente NÃO recebem;
    // sem foto (s.foto null) não renderiza o espaço — a linha volta ao layout base.
    const thumb = (isHist && s.confirmado_em && s.foto)
      ? '<img class="sl-thumb" loading="lazy" src="' + escapeHtml(s.foto) + '" ' +
        'data-foto="' + escapeHtml(s.foto) + '" alt="foto da placa">'
      : '';
    return '<div class="sl-linha">' + thumb +
        '<div class="sl-linha-corpo">' +
          '<span class="sl-fuel">' + escapeHtml(fuel) + '</span>' +
          '<span class="sl-precos">' + precos + '</span>' +
          '<div class="sl-tempos">' + escapeHtml(tempos) + '</div>' +
        '</div>' +
      '</div>';
  }

  function cardPendenteHtml(g) {
    const n = g.itens.length;
    return '<div class="sl-card">' +
        '<div class="sl-card-hd sl-hd-pend">' +
          '<span class="sl-hd-posto">' + escapeHtml(g.posto_nome) + '</span>' +
          '<span class="sl-hd-estado">Pendente de aprovação</span></div>' +
        '<div class="sl-card-body">' +
          '<div class="sl-linhas">' + g.itens.map(s => lineHtml(s, false)).join('') + '</div>' +
          '<div class="sl-erro" data-erro="' + escapeHtml(g.posto_id) + '"></div>' +
          '<button class="sl-aprovar" data-aprovar="' + escapeHtml(g.posto_id) + '">✅ Aprovar todos (' + n + ')</button>' +
        '</div>' +
      '</div>';
  }

  // Estado do card de histórico: verde (todas com placa trocada), amarelo
  // (aprovado, aguardando o gerente trocar a placa) ou cinza (cancelado).
  function estadoHist(itens) {
    if (itens.length && itens.every(i => i.confirmado_em)) return { cls: 'sl-hd-ok', txt: 'Aprovado' };
    if (itens.length && itens.every(i => i.status === 'cancelada')) return { cls: 'sl-hd-canc', txt: 'Cancelado' };
    return { cls: 'sl-hd-aguard', txt: 'Aguardando gerente' };
  }
  function cardHistHtml(g) {
    const est = estadoHist(g.itens);
    return '<div class="sl-card">' +
        '<div class="sl-card-hd ' + est.cls + '">' +
          '<span class="sl-hd-posto">' + escapeHtml(g.posto_nome) + '</span>' +
          '<span class="sl-hd-estado">' + est.txt + '</span></div>' +
        '<div class="sl-card-body"><div class="sl-linhas">' +
          g.itens.map(s => lineHtml(s, true)).join('') + '</div></div>' +
      '</div>';
  }

  // Assinatura do estado renderizável — evita re-render a cada poll sem mudança.
  function assinatura() {
    return _dataHist + '||' + _solicitacoes
      .map(s => s.id + ':' + s.status + ':' + (s.confirmado_em || '') + ':' + (s.aprovado_em || ''))
      .join(',');
  }

  function renderPagina() {
    const host = hostPagina();
    if (!host) return;
    const sig = assinatura();
    if (sig === _ultimoRenderSig) return; // nada mudou → não mexe no DOM
    _ultimoRenderSig = sig;

    // delegação de clique (uma vez só — innerHTML troca filhos, não o host)
    if (!host._slLigado) {
      host.addEventListener('click', (e) => {
        // Miniatura → abre a foto assinada em nova aba (mesmo padrão do ADM).
        const foto = e.target.closest && e.target.closest('[data-foto]');
        if (foto) { window.open(foto.getAttribute('data-foto'), '_blank'); return; }
        const ap = e.target.closest && e.target.closest('[data-aprovar]');
        if (ap) aprovarPosto(ap.getAttribute('data-aprovar'));
      });
      host._slLigado = true;
    }

    const pendentes = _solicitacoes.filter(s => s.status === 'aguardando_logistica');
    const historico = _solicitacoes.filter(s => s.status !== 'aguardando_logistica');
    const n = pendentes.length;

    let html = '<div class="sl-head"><span class="sl-h1">Alteração de preços</span>' +
      (n > 0 ? '<span class="sl-count-alerta">' + n + ' aguardando aprovação</span>' : '') +
    '</div>';

    if (pendentes.length) {
      html += '<div class="sl-cards">' + agruparPorPosto(pendentes).map(cardPendenteHtml).join('') + '</div>';
    } else {
      html += '<div class="sl-vazio">Nenhuma alteração aguardando aprovação. 🎉</div>';
    }

    html += '<div class="sl-sep"><span class="sl-sep-txt">Histórico</span>' +
      '<input type="date" id="sl-data-hist" class="sl-data" value="' + escapeHtml(_dataHist) + '"></div>';

    let hist = historico.slice();
    if (_dataHist) hist = hist.filter(s => diaISO(s.criado_em) === _dataHist);
    if (!hist.length) {
      html += '<div class="sl-vazio">Sem histórico' + (_dataHist ? ' nesta data' : '') + '.</div>';
    } else {
      html += agruparPorDia(hist).map(d =>
        '<div class="sl-dia"><div class="sl-dia-lbl">' + escapeHtml(d.label) + '</div>' +
          '<div class="sl-cards">' + agruparPorPosto(d.itens).map(cardHistHtml).join('') + '</div>' +
        '</div>'
      ).join('');
    }

    host.innerHTML = html;

    const di = document.getElementById('sl-data-hist');
    if (di) di.addEventListener('change', (e) => { _dataHist = e.target.value || ''; renderPagina(); });
  }

  function mostrarErroPosto(postoId, msg) {
    const host = hostPagina();
    if (!host) return;
    const el = host.querySelector('[data-erro="' + postoId + '"]');
    if (el) { el.textContent = msg; el.classList.add('on'); }
  }

  // Aprova, em SEQUÊNCIA, todas as pendentes do posto. As que dão certo saem
  // de aguardando_logistica (backend); as que falham ficam e o erro aparece.
  async function aprovarPosto(postoId) {
    const itens = _solicitacoes.filter(s =>
      s.status === 'aguardando_logistica' && String(s.posto_id) === String(postoId));
    if (!itens.length) return;
    const host = hostPagina();
    const btn = host && host.querySelector('button[data-aprovar="' + postoId + '"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Aprovando…'; }
    let falhas = 0;
    for (const s of itens) {
      try {
        await apiFetch('/solicitacoes-preco/' + s.id + '/aprovar', { method: 'POST' });
      } catch (e) {
        falhas++;
      }
    }
    await refresh();            // re-fetch do servidor
    _ultimoRenderSig = null;    // força re-render limpo (botão restaurado)
    renderPagina();
    if (falhas > 0) {
      mostrarErroPosto(postoId, falhas + ' alteração(ões) não aprovada(s). Tente novamente.');
    }
  }

  // ── Dados ───────────────────────────────────────────────────────
  async function refresh() {
    if (!ehLogistica()) return;
    try {
      const resp = await apiFetch('/solicitacoes-preco?status=todas');
      _solicitacoes = (resp && resp.solicitacoes) || [];
    } catch (e) {
      return; // rede/sessão: mantém snapshot, tenta no próximo poll
    }
    const n = _solicitacoes.filter(s => s.status === 'aguardando_logistica').length;
    if (_ultimaContagem !== null && n > _ultimaContagem) tocarNotificacao();
    _ultimaContagem = n;
    updateFaixa(n);
    updateNavContador(n);
    renderPagina();
  }

  // Atalho: só troca pra seção nova (o render já roda no polling).
  function abrir() {
    const el = document.querySelector('.nav-item[data-tab="tab-precos"]');
    if (typeof window.switchMainTab === 'function') window.switchMainTab('tab-precos', el || null);
    _ultimoRenderSig = null;
    renderPagina();
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (!ehLogistica()) return;
    injetarEstilo();
    ['pointerdown', 'keydown', 'click', 'touchend'].forEach(ev =>
      document.addEventListener(ev, destravarAudio, { capture: true }));
    refresh();            // 1º poll (sem beep)
    setInterval(refresh, INTERVALO_MS);
  }

  // Monta o render num container próprio (mobile). Guarda a referência e força
  // um render limpo nele — reseta a assinatura pra ignorar o guard de idempotência
  // na 1ª pintura do novo host (o host._slLigado religa a delegação de clique).
  function montarEm(container) {
    _container = container || null;
    _ultimoRenderSig = null;
    renderPagina();
  }

  window.solicitacoesLogistica = { refresh, abrir, montarEm };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
