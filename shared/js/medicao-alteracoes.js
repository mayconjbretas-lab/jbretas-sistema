// JBRETAS SISTEMA — shared/js/medicao-alteracoes.js
// Faixa âmbar + modal das alterações campo a campo da medição (audit_log
// UPDATE_CAMPO). Compartilhado por logistica (desktop) e logistica-mobile — sem
// fork. Montado por window.medicaoAlteracoes.montar(host): cria a faixa no TOPO
// do host; o botão "Ver" abre o modal com duas abas:
//   • HOJE (padrão): alterações de hoje ainda NÃO limpas (GET ?aba=hoje).
//   • HISTÓRICO: tudo do período (GET ?aba=historico&dias=), seletor 3/7/15.
// "Limpar" (só na aba HOJE) marca as exibidas como vistas (POST .../limpar):
// somem de HOJE mas continuam no histórico — nada é apagado. A FAIXA conta só a
// aba HOJE. Copiar reaproveita window.jbCopiar (shared/js/clipboard.js).
(function () {
  'use strict';

  let _faixa = null, _modal = null;
  let _aba = 'hoje';        // 'hoje' | 'historico'
  let _dias = 3;            // só afeta o histórico
  let _cacheHoje = null, _cacheHist = null;

  const PERIODOS = [3, 7, 15];
  // Campos que ENTRAM no texto do WhatsApp: só os que o GERENTE preenche. Pedido
  // e pre_pedido (lançados pela Logística) ficam fora — o grupo é dos gerentes.
  // A TELA continua mostrando tudo; este recorte é exclusivo da cópia.
  const CAMPOS_WHATSAPP = ['medicao', 'venda', 'carga'];
  // Rótulo do campo no texto (só os do gerente entram na cópia).
  const CAMPO_LABEL = { medicao: 'medição', venda: 'venda', carga: 'carga' };
  // Nome do combustível → CÓDIGO curto para a cópia. O audit guarda o NOME por
  // extenso (combustiveis_posto.nome) e não o código (.abv), e não há mapa
  // nome→código reutilizável no frontend com estes códigos — daí este, local.
  const COMB_CODIGOS = ['GC', 'GA', 'ET', 'ETAD', 'S10', 'S500', 'GNV', 'OCT', 'POD'];
  function abrevCombustivel(nome) {
    const n = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return '—';
    if (COMB_CODIGOS.includes(n)) return n;                                  // já é código
    if (n.includes('GNV')) return 'GNV';
    if (n.includes('PODIUM') || n === 'POD') return 'POD';
    if (n.includes('OCTAPRO') || n.includes('OCTA PRO') || n === 'OCT') return 'OCT';
    if (n.includes('ETANOL') || n.startsWith('ET')) return n.includes('ADIT') ? 'ETAD' : 'ET';
    if (/S\s*500/.test(n)) return 'S500';
    if (/S\s*10/.test(n)) return 'S10';
    if (n.includes('DIESEL')) return /500/.test(n) ? 'S500' : 'S10';
    if (n.includes('GASOLINA') || n.includes('ADIT') || n.includes('COMUM')) return n.includes('ADIT') ? 'GA' : 'GC';
    return nome;   // desconhecido: mostra como veio, sem inventar código
  }
  // Valor p/ o texto: vazio → "não preenchido" (NUNCA travessão nem 0); 0 real → "0".
  function fmtValor(v) {
    if (v === null || v === undefined || v === '') return 'não preenchido';
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR');
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR');
  }
  function fmtDia(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (m[3] + '/' + m[2]) : (iso || '—');
  }
  function dadosAtuais() { return _aba === 'hoje' ? _cacheHoje : _cacheHist; }

  async function montar(host) {
    if (!host) return;
    if (!_faixa) {
      _faixa = document.createElement('div');
      _faixa.className = 'malt-faixa';
      _faixa.style.display = 'none';
      host.insertBefore(_faixa, host.firstChild);   // no TOPO da aba Medição
    }
    await carregarHoje();   // popula a faixa
  }

  // ── Cargas ────────────────────────────────────────────────────────────────
  async function carregarHoje() {
    try {
      _cacheHoje = await apiFetch('/medicao-alteracoes?aba=hoje');
    } catch (e) {
      _cacheHoje = null;
      console.warn('medicao-alteracoes: falha ao carregar HOJE:', e && e.message);
    }
    renderFaixa();
    if (_modal && _modal.classList.contains('aberto') && _aba === 'hoje') renderLista();
  }
  async function carregarHist() {
    try {
      _cacheHist = await apiFetch('/medicao-alteracoes?aba=historico&dias=' + _dias);
    } catch (e) {
      _cacheHist = null;
      console.warn('medicao-alteracoes: falha ao carregar HISTÓRICO:', e && e.message);
    }
    if (_modal && _modal.classList.contains('aberto') && _aba === 'historico') renderLista();
  }

  // Chamado após salvar a matriz: a faixa (HOJE) reflete a nova alteração; se o
  // modal estiver no histórico, atualiza-o também.
  async function recarregar() {
    await carregarHoje();
    if (_modal && _modal.classList.contains('aberto') && _aba === 'historico') await carregarHist();
  }

  // ── Faixa (conta SÓ a aba HOJE) ─────────────────────────────────────────────
  function renderFaixa() {
    if (!_faixa) return;
    const n = (_cacheHoje && _cacheHoje.alteracoes) ? _cacheHoje.alteracoes.length : 0;
    if (!n) { _faixa.style.display = 'none'; return; }   // limpou tudo → some
    _faixa.style.display = '';
    const plural = n === 1 ? 'alteração' : 'alterações';
    const mais = (_cacheHoje && _cacheHoje.truncado) ? '+' : '';
    _faixa.innerHTML =
      '<span class="malt-faixa-txt">✏️ ' + n + mais + ' ' + plural + ' de medição hoje</span>' +
      '<button type="button" class="malt-faixa-btn" id="malt-ver">Ver</button>';
    _faixa.querySelector('#malt-ver').addEventListener('click', abrir);
  }

  // ── Modal ───────────────────────────────────────────────────────────────────
  function abrir() {
    if (!_modal) {
      _modal = document.createElement('div');
      _modal.className = 'malt-modal';
      _modal.innerHTML =
        '<div class="malt-sheet">' +
          '<div class="malt-head">' +
            '<div class="malt-abas">' +
              '<button type="button" class="malt-aba" data-aba="hoje">Hoje</button>' +
              '<button type="button" class="malt-aba" data-aba="historico">Histórico</button>' +
            '</div>' +
            '<button type="button" class="malt-x" id="malt-x" aria-label="Fechar">✕</button>' +
          '</div>' +
          '<div class="malt-toolbar">' +
            '<div class="malt-periodos" id="malt-periodos">' +
              PERIODOS.map(d => '<button type="button" class="malt-per" data-d="' + d + '">' + d + ' dias</button>').join('') +
            '</div>' +
            '<button type="button" class="malt-limpar" id="malt-limpar">🧹 Limpar</button>' +
            '<button type="button" class="malt-copiar" id="malt-copiar">📋 Copiar p/ WhatsApp</button>' +
          '</div>' +
          '<div class="malt-body" id="malt-lista"></div>' +
        '</div>';
      document.body.appendChild(_modal);
      _modal.addEventListener('click', e => { if (e.target === _modal) fechar(); });
      _modal.querySelector('#malt-x').addEventListener('click', fechar);
      _modal.querySelector('#malt-copiar').addEventListener('click', e => {
        const txt = textoWhatsApp();
        if (!txt) { window.alert('Nada para enviar: nenhuma alteração de medição, venda ou carga nesta lista (alterações de pedido ficam fora do texto).'); return; }
        window.jbCopiar(txt, e.currentTarget);
      });
      _modal.querySelector('#malt-limpar').addEventListener('click', limpar);
      _modal.querySelectorAll('.malt-aba').forEach(b => b.addEventListener('click', () => trocarAba(b.getAttribute('data-aba'))));
      _modal.querySelectorAll('.malt-per').forEach(b => b.addEventListener('click', () => trocarPeriodo(Number(b.getAttribute('data-d')))));
    }
    _modal.classList.add('aberto');
    if (_aba === 'historico' && !_cacheHist) carregarHist();   // lazy
    renderLista();
  }
  function fechar() { if (_modal) _modal.classList.remove('aberto'); }

  async function trocarAba(aba) {
    if (aba !== 'hoje' && aba !== 'historico') return;
    _aba = aba;
    if (_aba === 'historico' && !_cacheHist) { renderLista(); await carregarHist(); }  // mostra "carregando", busca
    else renderLista();
  }
  async function trocarPeriodo(d) {
    if (d === _dias) return;
    _dias = d;
    _cacheHist = null;
    renderLista();          // some a lista velha (vira "carregando")
    await carregarHist();
  }

  function renderLista() {
    if (!_modal) return;
    // Estado dos controles: abas ativas, período só no histórico, limpar só no hoje.
    _modal.querySelectorAll('.malt-aba').forEach(b => b.classList.toggle('on', b.getAttribute('data-aba') === _aba));
    _modal.querySelectorAll('.malt-per').forEach(b => b.classList.toggle('on', Number(b.getAttribute('data-d')) === _dias));
    _modal.querySelector('#malt-periodos').style.display = _aba === 'historico' ? '' : 'none';
    const btnLimpar = _modal.querySelector('#malt-limpar');
    btnLimpar.style.display = _aba === 'hoje' ? '' : 'none';

    const dados = dadosAtuais();
    const alts = (dados && dados.alteracoes) || [];
    if (_aba === 'hoje') btnLimpar.disabled = alts.length === 0;   // lista vazia → desabilita

    const lista = _modal.querySelector('#malt-lista');
    if (!dados) { lista.innerHTML = '<div class="malt-vazio">Carregando…</div>'; return; }
    if (!alts.length) {
      lista.innerHTML = '<div class="malt-vazio">' +
        (_aba === 'hoje' ? 'Nenhuma alteração pendente hoje.' : 'Sem alterações nos últimos ' + _dias + ' dias.') +
        '</div>';
      return;
    }
    const aviso = dados.truncado ? '<div class="malt-trunc">Mostrando as 500 mais recentes.</div>' : '';
    let html = aviso + '<div class="malt-wrap"><table class="malt-tbl"><thead><tr>' +
      '<th>Posto</th><th>Comb</th><th>Dia</th><th>Campo</th><th>De</th><th>Para</th><th>Quem</th>' +
      '</tr></thead><tbody>';
    alts.forEach(a => {
      const de = fmtNum(a.valor_antes), para = fmtNum(a.valor_depois);
      const cls = a.limpo ? ' class="malt-row-limpo"' : '';   // discreto: opacidade menor (só no histórico)
      html += '<tr' + cls + '>' +
        '<td class="malt-posto" title="' + esc(a.posto) + '">' + esc(a.posto) + '</td>' +
        '<td>' + esc(a.combustivel) + '</td>' +
        '<td class="malt-num">' + esc(fmtDia(a.data)) + '</td>' +
        '<td class="malt-campo">' + esc(a.campo) + '</td>' +
        '<td class="malt-de">' + (de === null ? '<span class="malt-tr">—</span>' : '<s>' + esc(de) + '</s>') + '</td>' +
        '<td class="malt-para">' + (para === null ? '—' : esc(para)) + '</td>' +
        '<td class="malt-quem">' + esc(a.quem) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    lista.innerHTML = html;
  }

  // ── Limpar (só HOJE): marca as exibidas como vistas ─────────────────────────
  async function limpar() {
    const alts = (_cacheHoje && _cacheHoje.alteracoes) || [];
    const ids = alts.map(a => a.audit_log_id).filter(v => v != null);
    if (!ids.length) return;
    if (!window.confirm('Limpar ' + ids.length + ' alteração(ões) da aba de hoje?\n\n' +
        'Elas saem da caixa do dia mas CONTINUAM no histórico. Nada é apagado.')) return;
    const btn = _modal && _modal.querySelector('#malt-limpar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Limpando…'; }
    try {
      await apiFetch('/medicao-alteracoes/limpar', { method: 'POST', body: JSON.stringify({ ids }) });
      _cacheHist = null;               // histórico muda (visto_em) → recarrega ao abrir
      await carregarHoje();            // HOJE fica vazia; a faixa some
    } catch (e) {
      window.alert('Falha ao limpar: ' + (e && e.message));
    } finally {
      if (btn) btn.textContent = '🧹 Limpar';
      renderLista();                   // reavalia estado/desabilitação do botão
    }
  }

  // Texto p/ WhatsApp da aba ATUAL. Recorte enxuto para o grupo dos gerentes:
  //  • só campos do gerente (CAMPOS_WHATSAPP);
  //  • descarta ruído: antes E depois ambos vazio/zero (0→vazio, vazio→0, 0→0)
  //    não é correção de dado — sai; 0→valor real e valor real→0 continuam;
  //  • UM bloco por posto (todas as alterações juntas), postos A→Z, e dentro por
  //    data mais recente primeiro; combustível abreviado; autor só se houver >1.
  // Devolve '' se não sobrar nada (o chamador avisa em vez de copiar só o cabeçalho).
  function textoWhatsApp() {
    const dados = dadosAtuais();
    const vazioOuZero = v => (v === null || v === undefined || v === '' || Number(v) === 0);
    const alts = ((dados && dados.alteracoes) || []).filter(a =>
      CAMPOS_WHATSAPP.includes(a.campo) &&
      !(vazioOuZero(a.valor_antes) && vazioOuZero(a.valor_depois)));   // corta o ruído
    if (!alts.length) return '';

    // Autor por linha só quando há MAIS DE UM no lote (senão é sempre a Logística).
    const mostrarAutor = new Set(alts.map(a => a.quem || '—')).size > 1;

    // Agrupa por posto; postos A→Z; dentro, data desc (sort estável preserva a
    // ordem de created_at do backend no desempate de mesma data).
    const porPosto = new Map();
    alts.forEach(a => {
      const k = a.posto || '—';
      if (!porPosto.has(k)) porPosto.set(k, []);
      porPosto.get(k).push(a);
    });
    const postos = [...porPosto.keys()].sort((x, y) => x.localeCompare(y, 'pt-BR'));

    const titulo = _aba === 'hoje' ? 'de hoje' : 'últimos ' + _dias + ' dias';
    const blocos = postos.map(posto => {
      const linhas = porPosto.get(posto).slice()
        .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
        .map(a => {
          const autor = mostrarAutor ? ' (' + (a.quem || '—') + ')' : '';
          return fmtDia(a.data) + ' · ' + abrevCombustivel(a.combustivel) + ' · ' +
                 (CAMPO_LABEL[a.campo] || a.campo) + ': ' +
                 fmtValor(a.valor_antes) + ' → ' + fmtValor(a.valor_depois) + autor;
        });
      return '*' + posto + '*\n' + linhas.join('\n');
    });
    return '*Alterações de medição — ' + titulo + '*\n\n' + blocos.join('\n\n');
  }

  window.medicaoAlteracoes = { montar: montar, recarregar: recarregar };
})();
