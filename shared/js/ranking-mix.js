// ================================================================
// JBRETAS SISTEMA — shared/js/ranking-mix.js
// Overlay "Ranking de Mix de Gasolina Aditivada" — compartilhado
// pelos módulos do GERENTE (aberto pelo botão 🥇 do gerente-nav.js).
//
// Expõe window.abrirRankingMix(). Busca GET /ranking-mix (apiFetch),
// que já devolve SÓ { posto, mix } (sem litros/R$). A linha do posto
// do gerente (getUsuarioLogado().posto.nome) entra em destaque com
// badge "VOCÊ"; se ele não vende aditivada, um rodapé discreto avisa.
// CSS injetado via <style> (tokens longos do base.css, dual theme).
// ================================================================
(function () {
  let _montado = false;
  let _aba   = 'vendas';   // aba ativa: 'vendas' | 'mix'
  let _dados = null;       // resposta do GET /ranking-vendas (null no modo fallback)

  // Nome de exibição: tira o prefixo "P. " e capitaliza natural
  // (mesma regra do relatorios.js). "P. MIRAGEM JBRETAS" → "Miragem Jbretas".
  function nomeExib(nome) {
    return String(nome || '')
      .replace(/^P\.\s*/i, '')
      .trim()
      .toLowerCase()
      .replace(/(^|[\s\-])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }

  // Normaliza p/ comparar posto do gerente x ranking (sem acento, caixa alta,
  // espaços colapsados) — casa mesmo com pequenas diferenças de digitação.
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  const fmtPct = (v) => (v === null || v === undefined)
    ? '—' : (Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

  // "2026-07-15" → "15/07"
  function brDiaMes(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}` : String(iso || '');
  }
  function fmtCiclo(ciclo) {
    if (!ciclo || (!ciclo.inicio && !ciclo.fim)) return '';
    return brDiaMes(ciclo.inicio) + ' a ' + brDiaMes(ciclo.fim);
  }

  // Chave de comparação do posto do gerente x nome cru da planilha:
  // tira "P. ", acento, caixa, colapsa espaços (mesma ideia do chavePostoParaK,
  // mas local — coletas-service.js não é carregado nos módulos do gerente).
  function chave(nome) {
    return norm(String(nome || '').replace(/^P\.\s*/i, ''));
  }
  function minhaPosto() { const u = getUsuarioLogado() || {}; return u.posto ? u.posto.nome : ''; }

  // pct/mix da planilha vêm como FRAÇÃO crua da célula (3.494 = 349,40%;
  // 0.1929 = 19,29%) → formata com ×100 (mesmo fmtPct do fallback).
  // Semáforo da meta em fração: >=1 verde | 0.85–0.99 azul | <0.85 âmbar.
  function semaforo(v) {
    const n = Number(v);
    if (isNaN(n)) return '';
    return n >= 1 ? 'sem-ok' : (n >= 0.85 ? 'sem-inf' : 'sem-wn');
  }

  function injetarEstilo() {
    if (document.getElementById('ranking-mix-style')) return;
    const st = document.createElement('style');
    st.id = 'ranking-mix-style';
    st.textContent =
      '.rkx-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:flex-end;' +
        'justify-content:center;background:rgba(0,0,0,.6)}' +
      '.rkx-overlay.open{display:flex}' +
      '@media(min-width:600px){.rkx-overlay{align-items:center;padding:1.5rem}}' +
      '.rkx-sheet{background:var(--surface);border:1px solid var(--border);' +
        'border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;' +
        'padding:1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));position:relative}' +
      '@media(min-width:600px){.rkx-sheet{border-radius:16px}}' +
      '.rkx-close{position:absolute;top:.8rem;right:.8rem;background:var(--surface2);' +
        'border:1px solid var(--border);border-radius:8px;padding:4px 10px;color:var(--text3);' +
        'cursor:pointer;font-size:.9rem}' +
      '.rkx-title{font-family:var(--mono);font-size:.9rem;font-weight:700;color:var(--text);' +
        'padding-right:2.5rem}' +
      '.rkx-sub{font-size:.64rem;color:var(--text3);font-family:var(--mono);text-transform:uppercase;' +
        'letter-spacing:.05em;margin:.15rem 0 .9rem}' +
      '.rkx-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}' +
      '.rkx-item{display:flex;align-items:baseline;gap:.6rem;padding:.6rem .8rem;' +
        'background:var(--surface2);border:1px solid var(--border);border-radius:10px;font-size:.9rem}' +
      '.rkx-pos{font-family:var(--mono);font-weight:700;color:var(--text3);min-width:1.8rem}' +
      '.rkx-nome{flex:1;color:var(--text);font-weight:600}' +
      '.rkx-val{font-family:var(--mono);font-weight:700;color:var(--accent);white-space:nowrap}' +
      '.rkx-item.rkx-voce{background:var(--accent-dim);border-color:var(--accent)}' +
      '.rkx-item.rkx-voce .rkx-nome,.rkx-item.rkx-voce .rkx-pos,.rkx-item.rkx-voce .rkx-val{color:var(--accent)}' +
      '.rkx-badge{font-family:var(--mono);font-size:.54rem;font-weight:700;background:var(--accent);' +
        'color:#0a0d0f;border-radius:4px;padding:2px 6px;letter-spacing:.05em;margin-left:.4rem}' +
      '.rkx-foot{margin-top:.9rem;font-size:.72rem;color:var(--text3);text-align:center}' +
      '.rkx-tabs{display:flex;gap:6px;margin-bottom:.8rem}' +
      '.rkx-tab{flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:.5rem;font-family:var(--mono);font-size:.72rem;font-weight:700;color:var(--text3);cursor:pointer;text-align:center}' +
      '.rkx-tab.on{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}' +
      // specificity extra (.rkx-item ...) pra o semáforo vencer o realce da linha VOCÊ.
      '.rkx-item .rkx-val.sem-ok{color:var(--ok)}' +
      '.rkx-item .rkx-val.sem-inf{color:var(--info)}' +
      '.rkx-item .rkx-val.sem-wn{color:var(--warning)}' +
      '.rkx-msg{text-align:center;color:var(--text3);font-size:.82rem;padding:1.5rem}' +
      '.rkx-erro{text-align:center;color:var(--danger);font-size:.82rem;padding:1.5rem}';
    document.head.appendChild(st);
  }

  function montar() {
    if (_montado) return;
    injetarEstilo();
    const ov = document.createElement('div');
    ov.className = 'rkx-overlay';
    ov.id = 'rkx-overlay';
    ov.innerHTML =
      '<div class="rkx-sheet">' +
        '<button class="rkx-close" id="rkx-close">✕</button>' +
        '<div class="rkx-title" id="rkx-title">🥇 Mix G. Aditivada</div>' +
        '<div class="rkx-sub" id="rkx-sub"></div>' +
        '<div class="rkx-tabs" id="rkx-tabs" style="display:none"></div>' +
        '<div id="rkx-body"><div class="rkx-msg">Carregando…</div></div>' +
      '</div>';
    document.body.appendChild(ov);
    // Fechar: X e clique no fundo escuro (fora da folha).
    document.getElementById('rkx-close').onclick = fechar;
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    _montado = true;
  }

  function fechar() {
    const ov = document.getElementById('rkx-overlay');
    if (ov) ov.classList.remove('open');
  }

  // ── Modo FALLBACK: ranking-mix legado (aba única, mix = fração ×100) ──
  function renderFallbackMix(resp) {
    document.getElementById('rkx-tabs').style.display = 'none';
    const ranking = (resp && resp.ranking) || [];
    document.getElementById('rkx-title').textContent =
      '🥇 Mix G. Aditivada — ' + brDiaMes(resp && resp.data) + ' (ontem)';
    document.getElementById('rkx-sub').textContent = '% do volume de gasolina';
    const meu = chave(minhaPosto());
    let euNoRanking = false;
    const itens = ranking.map((r, i) => {
      const eu = meu && chave(r.posto) === meu;
      if (eu) euNoRanking = true;
      const badge = eu ? '<span class="rkx-badge">VOCÊ</span>' : '';
      return '<li class="rkx-item' + (eu ? ' rkx-voce' : '') + '">' +
        '<span class="rkx-pos">' + (i + 1) + '.</span>' +
        '<span class="rkx-nome">' + nomeExib(r.posto) + badge + '</span>' +
        '<span class="rkx-val">' + fmtPct(r.mix) + '</span>' +
      '</li>';
    }).join('');
    let html = ranking.length
      ? '<ul class="rkx-list">' + itens + '</ul>'
      : '<div class="rkx-msg">Sem dados de mix para esta data.</div>';
    if (meu && !euNoRanking && ranking.length) {
      html += '<div class="rkx-foot">Seu posto não vende gasolina aditivada</div>';
    }
    document.getElementById('rkx-body').innerHTML = html;
  }

  // ── Modo 2 ABAS (dados da planilha via /ranking-vendas) ──────────
  function renderTabs() {
    const t = document.getElementById('rkx-tabs');
    t.style.display = 'flex';
    t.innerHTML =
      '<button class="rkx-tab' + (_aba === 'vendas' ? ' on' : '') + '" onclick="__rkxAba(\'vendas\')">🏆 Vendas</button>' +
      '<button class="rkx-tab' + (_aba === 'mix' ? ' on' : '') + '" onclick="__rkxAba(\'mix\')">🥇 Mix</button>';
  }
  window.__rkxAba = function (a) { _aba = a; renderTabs(); renderAba(); };
  function renderAba() { if (_aba === 'mix') renderMixCiclo(); else renderVendas(); }

  function linhaRanking(pos, nome, valHtml, eu) {
    return '<li class="rkx-item' + (eu ? ' rkx-voce' : '') + '">' +
      '<span class="rkx-pos">' + (pos != null ? pos : '–') + '.</span>' +
      '<span class="rkx-nome">' + nomeExib(nome) + (eu ? '<span class="rkx-badge">VOCÊ</span>' : '') + '</span>' +
      valHtml + '</li>';
  }

  function renderVendas() {
    const d = _dados;
    document.getElementById('rkx-title').textContent = '🏆 Ranking de Vendas';
    document.getElementById('rkx-sub').textContent = (fmtCiclo(d.ciclo) ? 'Ciclo ' + fmtCiclo(d.ciclo) + ' · ' : '') + '% da meta';
    const meu = chave(minhaPosto());
    const lista = d.vendas || [];
    const itens = lista.map(r => {
      const eu = meu && chave(r.posto) === meu;
      const val = '<span class="rkx-val ' + semaforo(r.pct) + '">' + fmtPct(r.pct) + '</span>';
      return linhaRanking(r.posicao, r.posto, val, eu);
    }).join('');
    let html = lista.length ? '<ul class="rkx-list">' + itens + '</ul>' : '<div class="rkx-msg">Sem dados de vendas.</div>';
    if (d.rede_pct != null) html += '<div class="rkx-foot">Rede: ' + fmtPct(d.rede_pct) + '</div>';
    document.getElementById('rkx-body').innerHTML = html;
  }

  function renderMixCiclo() {
    const d = _dados;
    document.getElementById('rkx-title').textContent = '🥇 Mix G. Aditivada';
    document.getElementById('rkx-sub').textContent = (fmtCiclo(d.ciclo) ? 'Ciclo ' + fmtCiclo(d.ciclo) + ' · ' : '') + '% do volume de gasolina';
    const meu = chave(minhaPosto());
    const lista = d.mix || [];
    const itens = lista.map(r => {
      const eu = meu && chave(r.posto) === meu;
      const val = '<span class="rkx-val">' + fmtPct(r.mix) + '</span>';
      return linhaRanking(r.posicao, r.posto, val, eu);
    }).join('');
    let html = lista.length ? '<ul class="rkx-list">' + itens + '</ul>' : '<div class="rkx-msg">Sem dados de mix.</div>';
    if (d.rede_mix != null) html += '<div class="rkx-foot">Rede: ' + fmtPct(d.rede_mix) + '</div>';
    document.getElementById('rkx-body').innerHTML = html;
  }

  // Fallback: rota nova falhou/veio vazia → ranking-mix atual (aba única).
  async function fallback() {
    _dados = null;
    const resp = await apiFetch('/ranking-mix');
    renderFallbackMix(resp);
  }

  // ── Entrada pública (chamada pelo botão 🥇 do gerente-nav) ────────
  window.abrirRankingMix = async function () {
    montar();
    const ov = document.getElementById('rkx-overlay');
    ov.classList.add('open');
    document.getElementById('rkx-title').textContent = '🏆 Ranking';
    document.getElementById('rkx-sub').textContent = '';
    document.getElementById('rkx-tabs').style.display = 'none';
    document.getElementById('rkx-body').innerHTML = '<div class="rkx-msg">Carregando…</div>';
    try {
      const resp = await apiFetch('/ranking-vendas');
      const vazio = !resp || ((!resp.vendas || !resp.vendas.length) && (!resp.mix || !resp.mix.length));
      if (vazio) return await fallback();
      _dados = resp; _aba = 'vendas';
      renderTabs();
      renderAba();
    } catch (err) {
      try { await fallback(); }
      catch (e) {
        document.getElementById('rkx-body').innerHTML =
          '<div class="rkx-erro">Erro ao carregar o ranking: ' + (err.message || err) + '</div>';
      }
    }
  };
})();
