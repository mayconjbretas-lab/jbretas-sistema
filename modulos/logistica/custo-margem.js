// ================================================================
// JBRETAS SISTEMA — modulos/logistica/custo-margem.js
// Aba "Custo & Margem" da Logística. ADITIVO: expõe
// window.renderCustoMargem(section), chamado pelo switchMainTab
// (mesmo padrão do renderMedicao). Shell única, CSS injetado.
//
// Fontes: GET /custo-margem?data= (custo/venda/margem/reajuste por
// posto×combustível) e GET /custos-fornecedores?data=. Escrita via
// POST /custo-margem (lote — massa e lápis) e POST /custos-fornecedores.
// A "venda" é a MESMA do "Você" do ADM (coleta própria) — o backend
// já resolve; aqui só exibe (etiqueta 'auto' quando venda_origem='coleta').
// Tokens de tema longos (base.css), dual claro/escuro.
// ================================================================
(function () {
  // ── Constantes de negócio (fácil ajuste) ─────────────────────────
  const MARGEM_VERDE = 0.80;   // margem >= verde
  const MARGEM_AMBAR = 0.40;   // margem >= âmbar (abaixo disso, vermelho)
  // Combustíveis canônicos da BARRA de lançamento em massa. Premium/GNV
  // (OCT/POD/GNV/ETAD…) NÃO entram na barra — só no card do posto.
  const BARRA_COMB = [
    { cod: 'GC', nome: 'Comum' },
    { cod: 'GA', nome: 'Aditivada' },
    { cod: 'ET', nome: 'Etanol' },
    { cod: 'S10', nome: 'Diesel S10' },
    { cod: 'S500', nome: 'Diesel S500' },
  ];
  // Chips de bandeira são DINÂMICOS: gerados das bandeiras presentes nos dados
  // (ver bandeirasDisponiveis) — nasce/some sozinho conforme o banco.

  // ── Estado ───────────────────────────────────────────────────────
  let _shellPronto = false;
  let _dataISO     = null;   // dia consultado (YYYY-MM-DD)
  let _dados       = null;   // resposta GET /custo-margem
  let _forn        = null;   // resposta GET /custos-fornecedores
  let _fNome       = '';     // filtro por nome
  let _fBandeira   = '';     // filtro por bandeira (chip ativo)
  let _fornEdit    = false;  // modo edição do card de fornecedores
  let _readonly    = false;  // ADM (painel-adm) = só leitura: sem barra, lápis nem editar
  // Importação de planilha (.xlsx)
  let _cmiFile     = null;   // File escolhido (só pro nome exibido)
  let _cmiB64      = null;   // dataURL base64 do arquivo (reusado no gravar)
  let _cmiPrev     = null;   // resposta do dry_run:true (prévia)

  // ── Helpers de data ──────────────────────────────────────────────
  function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
  function addDias(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  function fmtDiaNav(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const wd = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
    return `${wd} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }

  // ── Parse/format BR (custo em R$/L, até 4 casas) ─────────────────
  function parseCustoBR(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = parseFloat(norm.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : Math.round(n * 10000) / 10000;
  }
  function fmtN(v, min, max) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (isNaN(n)) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
  }
  const fmtCusto = (v) => fmtN(v, 2, 4);   // custo/venda (edição usa este p/ preencher)
  const fmtMarg  = (v) => fmtN(v, 2, 2);   // margem
  function fmtDelta(v) {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    if (n === 0) return '0';
    return (n > 0 ? '+' : '') + fmtN(n, 2, 2);
  }
  function margemClasse(m) {
    if (m === null || m === undefined) return '';
    if (m >= MARGEM_VERDE) return 'cm-m-bom';
    if (m >= MARGEM_AMBAR) return 'cm-m-med';
    return 'cm-m-ruim';
  }
  // Desvio em centavos: 0.0608 -> '6,08'. A unidade e diferente da do custo
  // (centavos, nao reais), por isso nao reusa fmtCusto.
  const fmtCent = (v) => fmtN(Math.abs(Number(v)) * 100, 2, 2);
  function deltaClasse(d) {
    if (d === null || d === undefined || d === 0) return 'cm-d-zero';
    return d < 0 ? 'cm-d-bom' : 'cm-d-ruim'; // custo caiu = bom (verde)
  }
  const idSafe = (v) => String(v).replace(/[^a-zA-Z0-9]/g, '_');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Normaliza bandeira p/ o match do chip: sem acento, caixa alta, espaços
  // colapsados e sem o prefixo "BANDEIRA " ("Bandeira Branca" casa com "BRANCA").
  function normBandeira(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().trim().replace(/\s+/g, ' ')
      .replace(/^BANDEIRA\s+/, '');
  }

  // ── Acesso aos dados ─────────────────────────────────────────────
  function getPosto(pid) { return (_dados && _dados.postos || []).find(p => String(p.posto_id) === String(pid)) || null; }
  function getComb(pid, cod) {
    const p = getPosto(pid);
    return p ? (p.combustiveis || []).find(c => String(c.codigo).toUpperCase() === String(cod).toUpperCase()) || null : null;
  }
  function postosFiltrados() {
    const nome = _fNome.trim().toLowerCase();
    return (_dados && _dados.postos || []).filter(p => {
      if (nome && !String(p.posto || '').toLowerCase().includes(nome)) return false;
      if (_fBandeira && normBandeira(p.bandeira) !== normBandeira(_fBandeira)) return false;
      return true;
    });
  }

  // ── CSS (injetado uma vez) ───────────────────────────────────────
  // EXPOSTO para a aba DRE (modulos/painel-adm/dre.js) reusar o MODAL de
  // importação (.cmi-*) sem copiar o CSS. O estilo é injetado aqui e só aqui:
  // duas cópias das mesmas regras envelheceriam separadas, e o pedido era
  // "mesmos componentes, mesma aparência". O guard por id já garante uma
  // injeção só, seja quem chamar primeiro.
  window.__cmInjetarEstiloImport = function () { injetarEstilo(); };

  function injetarEstilo() {
    if (document.getElementById('custo-margem-style')) return;
    const st = document.createElement('style');
    st.id = 'custo-margem-style';
    // Contexto admin mobile: só carrega admin.css (tokens CURTOS --sf/--ac/--tx…),
    // sem base.css → os tokens longos não existem. Se faltarem, prefixamos um
    // alias longo→curto escopado em .cm-wrap (--ok e --mono já existem lá).
    const temLongos = getComputedStyle(document.documentElement)
      .getPropertyValue('--surface').trim() !== '';
    const alias = temLongos ? '' : (
      '.cm-wrap{' +
        '--surface:var(--sf);--surface2:var(--sf2);--surface3:var(--sf3);' +
        '--border:var(--bd);--border2:var(--bd2);' +
        '--accent:var(--ac);--accent-dim:var(--acd);' +
        '--text:var(--tx);--text2:var(--tx2);--text3:var(--tx3);' +
        '--danger:var(--dg);--warning:var(--wn);--radius-lg:var(--rl)' +
      '}' +
      // No admin a .scr já tem padding próprio — evita padding dobrado.
      '.scr .cm-wrap{padding:.2rem 0}'
    );
    // CSS escopado em .cm-wrap (o wrapper que o montarShell cria) — agnóstico ao
    // container, funciona tanto na Logística (#tab-custo) quanto no Painel ADM (#s-custo).
    st.textContent =
      alias +
      // Painel ADM: deixa a seção fluir e a .pa-main rolar (inócuo na Logística).
      '#s-custo{height:auto;min-height:100%}' +
      '#s-custo.active{display:block}' +
      '.cm-wrap{flex:1;min-height:0;overflow-y:auto;padding:1.1rem 1.2rem;display:flex;flex-direction:column;gap:1rem}' +
      '.cm-wrap .cm-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}' +
      '.cm-wrap .cm-title{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--text)}' +
      '.cm-wrap .cm-headright{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;justify-content:flex-end}' +
      '.cm-wrap .cm-ultimp{display:inline-flex;align-items:center}' +
      '.cm-wrap .cm-imp-chip{display:inline-flex;align-items:center;gap:.4rem;white-space:nowrap;font-family:var(--mono);font-size:.64rem;font-weight:600;line-height:1;padding:.34rem .62rem;border-radius:999px;border:1px solid transparent}' +
      '.cm-wrap .cm-imp-chip .cm-imp-ic{font-size:.72rem;line-height:1}' +
      '.cm-wrap .cm-imp-chip .cm-imp-lbl{color:var(--text3)}' +
      '.cm-wrap .cm-imp-chip .cm-imp-quando{font-weight:700}' +
      '.cm-wrap .cm-imp-hoje{background:color-mix(in srgb,var(--ok) 13%,transparent);border-color:color-mix(in srgb,var(--ok) 38%,transparent)}' +
      '.cm-wrap .cm-imp-hoje .cm-imp-quando{color:var(--ok)}' +
      '.cm-wrap .cm-imp-old{background:color-mix(in srgb,var(--warning) 14%,transparent);border-color:color-mix(in srgb,var(--warning) 42%,transparent)}' +
      '.cm-wrap .cm-imp-old .cm-imp-quando{color:var(--warning)}' +
      '.cm-wrap .cm-daynav{display:flex;align-items:center;gap:.4rem}' +
      '.cm-wrap .cm-daybtn{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:.9rem}' +
      '.cm-wrap .cm-daybtn:hover{border-color:var(--accent);color:var(--accent)}' +
      '.cm-wrap .cm-hoje{width:auto;padding:0 .7rem;font-family:var(--mono);font-size:.72rem;font-weight:700;letter-spacing:.02em}' +
      '.cm-wrap .cm-daylabel{position:relative;background:var(--accent-dim);border:1px solid var(--accent);color:var(--accent);font-family:var(--mono);font-size:.8rem;font-weight:700;padding:.5rem .9rem;border-radius:8px;cursor:pointer;white-space:nowrap}' +
      '.cm-wrap .cm-daylabel input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}' +
      '.cm-wrap .cm-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1rem 1.1rem}' +
      '.cm-wrap .cm-bar-title{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--accent);letter-spacing:.04em;text-transform:uppercase;margin-bottom:.7rem}' +
      '.cm-wrap .cm-bar-inputs{display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-end}' +
      '.cm-wrap .cm-bar-field{display:flex;flex-direction:column;gap:3px}' +
      '.cm-wrap .cm-bar-field label{font-size:.62rem;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em}' +
      '.cm-wrap .cm-bar-field input{width:92px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:.5rem .6rem;color:var(--text);font-family:var(--mono);font-size:.85rem;text-align:right;outline:none}' +
      '.cm-wrap .cm-bar-field input:focus{border-color:var(--accent)}' +
      '.cm-wrap .cm-btn{background:var(--accent);color:#1a1206;border:none;font-family:var(--mono);font-size:.75rem;font-weight:700;padding:.6rem 1rem;border-radius:8px;cursor:pointer;white-space:nowrap}' +
      '.cm-wrap .cm-btn:hover{opacity:.9}' +
      '.cm-wrap .cm-btn.ghost{background:var(--surface2);border:1px solid var(--border);color:var(--text)}' +
      '.cm-wrap .cm-btn.ghost:hover{border-color:var(--accent);color:var(--accent)}' +
      '.cm-wrap .cm-confirm{margin-top:.7rem;background:var(--surface2);border:1px solid var(--accent);border-radius:10px;padding:.7rem .85rem;display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}' +
      '.cm-wrap .cm-confirm .txt{font-size:.8rem;color:var(--text2);flex:1}' +
      '.cm-wrap .cm-filtro{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}' +
      '.cm-wrap .cm-search{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:.5rem .7rem;color:var(--text);font-size:.84rem;outline:none;min-width:200px}' +
      '.cm-wrap .cm-search:focus{border-color:var(--accent)}' +
      '.cm-wrap .cm-chips{display:flex;gap:5px;flex-wrap:wrap}' +
      '.cm-wrap .cm-chip{background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:5px 11px;font-size:.68rem;font-family:var(--mono);font-weight:700;color:var(--text3);cursor:pointer;transition:all .15s}' +
      '.cm-wrap .cm-chip:hover{border-color:var(--border2);color:var(--text2)}' +
      '.cm-wrap .cm-chip.on{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}' +
      '.cm-wrap .cm-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}' +
      '@media(max-width:1100px){.cm-wrap .cm-grid{grid-template-columns:1fr}}' +
      '.cm-wrap .cm-pcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:.9rem 1rem}' +
      '.cm-wrap .cm-pcard-hdr{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.6rem}' +
      '.cm-wrap .cm-pnome{font-size:.92rem;font-weight:700;color:var(--text)}' +
      '.cm-wrap .cm-badge{font-family:var(--mono);font-size:.6rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:var(--surface3);color:var(--text2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;white-space:nowrap}' +
      '.cm-wrap .cm-table{width:100%;border-collapse:collapse;font-size:.8rem}' +
      '.cm-wrap .cm-table th{text-align:right;font-family:var(--mono);font-size:.58rem;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);padding:0 .4rem .45rem;border-bottom:1px solid var(--border);white-space:nowrap}' +
      '.cm-wrap .cm-table th:first-child{text-align:left}' +
      '.cm-wrap .cm-table td{padding:.42rem .4rem;border-bottom:1px solid var(--border);color:var(--text2);text-align:right;white-space:nowrap}' +
      '.cm-wrap .cm-table td:first-child{text-align:left;color:var(--text);font-weight:600}' +
      '.cm-wrap .cm-table tr:last-child td{border-bottom:none}' +
      '.cm-wrap .cm-custo{font-family:var(--mono);font-weight:700;color:var(--accent)}' +
      '.cm-wrap .cm-venda{font-family:var(--mono);color:var(--text)}' +
      '.cm-wrap .cm-auto{font-size:.54rem;color:var(--text3);border:1px solid var(--border);border-radius:4px;padding:0 3px;margin-left:4px;vertical-align:middle}' +
      '.cm-wrap .cm-pen{cursor:pointer;opacity:.55;font-size:.72rem;margin-left:5px}' +
      '.cm-wrap .cm-pen:hover{opacity:1}' +
      '.cm-wrap .cm-na{color:var(--text3);opacity:.6}' +
      '.cm-wrap .cm-inp{width:74px;background:var(--surface2);border:1px solid var(--accent);border-radius:6px;padding:2px 5px;color:var(--text);font-family:var(--mono);font-size:.78rem;text-align:right;outline:none}' +
      '.cm-wrap .cm-m-bom{color:var(--ok);font-weight:700;font-family:var(--mono)}' +
      '.cm-wrap .cm-m-med{color:var(--warning);font-weight:700;font-family:var(--mono)}' +
      '.cm-wrap .cm-m-ruim{color:var(--danger);font-weight:700;font-family:var(--mono)}' +
      '.cm-wrap .cm-d-bom{color:var(--ok);font-family:var(--mono)}' +
      '.cm-wrap .cm-d-ruim{color:var(--danger);font-family:var(--mono)}' +
      '.cm-wrap .cm-d-zero{color:var(--text3);font-family:var(--mono)}' +
      // Desvio em relacao ao custo do posto de REFERENCIA da bandeira.
      // Fica colado no custo (nao vira coluna) para nao apertar a tabela no
      // celular — a aba roda tambem em logistica-mobile.
      '.cm-wrap .cm-dv{font-family:var(--mono);font-size:.6rem;font-weight:700;margin-left:5px;padding:0 3px;border-radius:4px;vertical-align:middle;white-space:nowrap}' +
      '.cm-wrap .cm-dv.mais{color:var(--danger);background:color-mix(in srgb,var(--danger) 12%,transparent)}' +
      '.cm-wrap .cm-dv.menos{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent)}' +
      // Fallback: o desvio nao e contra a referencia, e contra a moda da bandeira.
      '.cm-wrap .cm-dv.fb{color:var(--warning);background:none;border:1px dashed var(--warning);font-weight:600}' +
      '.cm-wrap .cm-ref{font-family:var(--mono);font-size:.58rem;font-weight:700;letter-spacing:.05em;color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:2px 7px;white-space:nowrap}' +
      '.cm-wrap .cm-forn-menor{color:var(--ok);font-weight:700}' +
      '.cm-wrap .cm-empty{text-align:center;color:var(--text3);font-size:.82rem;padding:2rem}' +
      '.cm-wrap .cm-erro{text-align:center;color:var(--danger);font-size:.82rem;padding:2rem}' +
      // ── Modal de importação (fora de .cm-wrap: overlay no body). Só abre na
      // Logística, onde base.css define os tokens longos globalmente. ──
      '.cmi-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6)}' +
      '.cmi-overlay.open{display:flex}' +
      '@media(min-width:600px){.cmi-overlay{align-items:center;padding:1.5rem}}' +
      '.cmi-sheet{background:var(--surface);border:1px solid var(--border);border-radius:16px 16px 0 0;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;padding:1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));position:relative}' +
      '@media(min-width:600px){.cmi-sheet{border-radius:16px}}' +
      '.cmi-close{position:absolute;top:.8rem;right:.8rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:4px 10px;color:var(--text3);cursor:pointer;font-size:.9rem}' +
      '.cmi-title{font-family:var(--mono);font-size:.95rem;font-weight:700;color:var(--text);padding-right:2.5rem}' +
      '.cmi-file{font-size:.72rem;color:var(--text3);font-family:var(--mono);margin:.2rem 0 .9rem;word-break:break-all}' +
      '.cmi-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:.8rem}' +
      '.cmi-c{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:.6rem .4rem;text-align:center}' +
      '.cmi-c b{display:block;font-family:var(--mono);font-size:1.15rem;color:var(--text);line-height:1.25}' +
      '.cmi-c span{font-size:.56rem;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.03em}' +
      '.cmi-c.bad{border-color:var(--danger)}' +
      '.cmi-c.bad b{color:var(--danger)}' +
      '.cmi-faixa{font-size:.78rem;color:var(--text2);margin-bottom:.7rem}' +
      '.cmi-faixa b{color:var(--text);font-family:var(--mono)}' +
      '.cmi-info{font-size:.76rem;color:var(--text2);background:var(--surface2);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;padding:.55rem .7rem;margin-bottom:.7rem}' +
      '.cmi-bloq{background:var(--surface2);border:1px solid var(--danger);border-radius:10px;padding:.7rem .85rem;margin-bottom:.8rem}' +
      '.cmi-bloq-tit{font-family:var(--mono);font-size:.72rem;font-weight:700;color:var(--danger);text-transform:uppercase;letter-spacing:.03em;margin-bottom:.5rem}' +
      '.cmi-bloq ul{margin:0 0 .5rem;padding-left:1.1rem;display:flex;flex-direction:column;gap:.28rem}' +
      '.cmi-bloq li{font-size:.8rem;color:var(--text)}' +
      '.cmi-fix{font-size:.74rem;color:var(--text2)}' +
      '.cmi-tbl{width:100%;border-collapse:collapse;font-size:.78rem;margin-bottom:.9rem}' +
      '.cmi-tbl th{text-align:right;font-family:var(--mono);font-size:.56rem;letter-spacing:.03em;text-transform:uppercase;color:var(--text3);padding:0 .4rem .4rem;border-bottom:1px solid var(--border)}' +
      '.cmi-tbl th:first-child{text-align:left}' +
      '.cmi-tbl td{padding:.35rem .4rem;border-bottom:1px solid var(--border);color:var(--text2);text-align:right}' +
      '.cmi-tbl td:first-child{text-align:left;color:var(--text);font-weight:600}' +
      '.cmi-tbl tr:last-child td{border-bottom:none}' +
      '.cmi-cst{font-family:var(--mono);color:var(--accent);font-weight:700}' +
      '.cmi-foot{display:flex;gap:.6rem;justify-content:flex-end;flex-wrap:wrap}' +
      '.cmi-btn{background:var(--accent);color:#1a1206;border:none;font-family:var(--mono);font-size:.78rem;font-weight:700;padding:.6rem 1.1rem;border-radius:8px;cursor:pointer}' +
      '.cmi-btn:hover{opacity:.9}' +
      '.cmi-btn:disabled{opacity:.45;cursor:not-allowed}' +
      '.cmi-btn.ghost{background:var(--surface2);border:1px solid var(--border);color:var(--text)}' +
      '.cmi-btn.ghost:hover{border-color:var(--accent);color:var(--accent)}' +
      '.cmi-msg{font-size:.85rem;color:var(--text2);text-align:center;padding:.5rem 0 1rem}' +
      '.cmi-erro-ic{font-size:1.8rem;text-align:center;margin:.5rem 0 .3rem}';
    document.head.appendChild(st);
  }

  // ── Shell (montado uma vez) ──────────────────────────────────────
  function montarShell(sec) {
    _dataISO = _dataISO || hojeISO();
    // Leitura decidida pelo HOST, não pelo perfil: edita só nos módulos de
    // Logística (desktop /logistica/ e mobile /logistica-mobile/); qualquer outro
    // host — o painel-adm (#s-custo) inclusive — fica leitura (fail-closed). O id
    // do container não serve: #s-custo é compartilhado por logistica-mobile E
    // painel-adm; o módulo (URL) é o discriminador confiável. Alinha com o backend
    // (POST /custos/importar aceita ADM+LOGISTICA) sem abrir nada pra GERENTE, que
    // não acessa nenhum desses módulos (logística exige LOGISTICA/ADM; adm é ADM).
    _readonly = !/\/logistica(-mobile)?\//.test(window.location.pathname);
    injetarEstilo();
    sec.innerHTML =
      '<div class="cm-wrap">' +
        '<div class="cm-head">' +
          '<div class="cm-title">💰 Custo &amp; Margem</div>' +
          '<div class="cm-headright">' +
          '<div class="cm-ultimp" id="cm-ultimp" style="display:none"></div>' +
          '<div class="cm-daynav">' +
            '<button class="cm-daybtn" onclick="__cmDia(-1)" title="Dia anterior">◀</button>' +
            '<label class="cm-daylabel" id="cm-daylabel"></label>' +
            '<button class="cm-daybtn" onclick="__cmDia(1)" title="Próximo dia">▶</button>' +
            '<button class="cm-daybtn cm-hoje" id="cm-hoje-btn" onclick="__cmHoje()" title="Voltar para hoje" style="display:none">⟳ Hoje</button>' +
          '</div>' +   // cm-daynav
          '</div>' +   // cm-headright
        '</div>' +     // cm-head
        (window.navCustoHTML ? window.navCustoHTML('custo') : '') +
        '<div class="cm-card" id="cm-bar"></div>' +
        '<div class="cm-filtro" id="cm-filtro"></div>' +
        '<div id="cm-grid-box"><div class="cm-empty">Carregando…</div></div>' +
        '<div id="cm-forn-box"></div>' +
      '</div>';
    _shellPronto = true;
  }

  // ── Indicador "última importação" (chip no canto direito do cabeçalho) ─
  // Fuso EXPLÍCITO America/Sao_Paulo via Intl (NUNCA getters locais de Date —
  // o Railway roda UTC e já tivemos bug de 1 dia). O diff de dias compara as
  // DATAS já convertidas p/ SP (não o instante bruto).
  function spParts(d) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  }
  // nº de dia-calendário (em SP) via Date.UTC — só p/ subtrair; NÃO é getter local.
  function diaNum(p) { return Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000; }

  // Idade da importação em linguagem natural (tudo em SP).
  function idadeImport(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const pi = spParts(d), pa = spParts(new Date());
    const diff = diaNum(pa) - diaNum(pi);                 // dias de diferença (SP)
    const hhmm = pi.hour + ':' + pi.minute;
    const dataCompleta = pi.day + '/' + pi.month + '/' + pi.year + ' ' + hhmm;
    let label;
    if (diff <= 0)       label = 'hoje ' + hhmm;
    else if (diff === 1) label = 'ontem ' + hhmm;
    else if (diff <= 6)  label = 'há ' + diff + ' dias';
    else                 label = pi.day + '/' + pi.month + '/' + pi.year;
    return { label, hoje: diff <= 0, dataCompleta };
  }

  // Tooltip nativo (title) com o detalhe completo; omite linhas de dado null.
  function tooltipImport(u, info) {
    const linhas = ['Última importação', info.dataCompleta];
    const partes = [];
    if (u.custos != null) partes.push(Number(u.custos).toLocaleString('pt-BR') + ' linhas');
    if (u.dias != null)   partes.push(u.dias + ' dias');
    if (partes.length) linhas.push(partes.join(' · '));
    if (u.por) linhas.push(u.por);
    return linhas.join('\n');
  }

  function renderUltimaImport() {
    const el = document.getElementById('cm-ultimp');
    if (!el) return;
    const u = _dados && _dados.ultima_importacao;
    const iso = u && (u.em_iso || u.em);
    if (!u || !iso) { el.style.display = 'none'; el.innerHTML = ''; return; }   // null → nada
    const info = idadeImport(iso);
    if (!info) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    const classe = info.hoje ? 'cm-imp-hoje' : 'cm-imp-old';
    const icone  = info.hoje ? '📄' : '⚠️';
    el.innerHTML =
      '<span class="cm-imp-chip ' + classe + '" title="' + esc(tooltipImport(u, info)) + '">' +
        '<span class="cm-imp-ic">' + icone + '</span>' +
        '<span class="cm-imp-lbl">Planilha importada</span>' +
        '<span class="cm-imp-quando">' + esc(info.label) + '</span>' +
      '</span>';
  }

  // ── Carrega o dia (custo-margem + fornecedores) ──────────────────
  async function carregar(iso) {
    _dataISO = iso;
    const lbl = document.getElementById('cm-daylabel');
    if (lbl) lbl.innerHTML = esc(fmtDiaNav(iso)) + '<input type="date" value="' + iso + '" onchange="__cmDataInput(this)">';
    // Botão "⟳ Hoje" só aparece quando NÃO estamos no dia de hoje (Brasília).
    const hojeBtn = document.getElementById('cm-hoje-btn');
    if (hojeBtn) hojeBtn.style.display = (iso === hojeISO()) ? 'none' : '';
    const box = document.getElementById('cm-grid-box');
    if (box) box.innerHTML = '<div class="cm-empty">Carregando…</div>';
    try {
      const [cm, forn] = await Promise.all([
        apiFetch('/custo-margem?data=' + encodeURIComponent(iso)),
        apiFetch('/custos-fornecedores?data=' + encodeURIComponent(iso)),
      ]);
      _dados = cm; _forn = forn; _fornEdit = false;
      renderUltimaImport();
      renderBarra();
      renderFiltro();
      renderGrid();
      renderFornecedores();
    } catch (err) {
      if (box) box.innerHTML = '<div class="cm-erro">Erro ao carregar: ' + esc(err.message || err) + '</div>';
    }
  }

  // ── Barra ⚡ Lançar custo do dia (respeita o FILTRO ATIVO) ─────────
  // O alvo do lançamento em massa = postos VISÍVEIS no grid (chips + busca),
  // não a rede inteira. Título, botão e confirmação nomeiam esse alvo.
  function alvoBarra() {
    const n = postosFiltrados().length;
    const s = n === 1 ? '' : 's';
    const hasB = !!_fBandeira, hasQ = !!_fNome.trim();
    let titulo, btnSuf, confirmAlvo;
    if (!hasB && !hasQ) {
      titulo = `REDE TODA (${n})`; btnSuf = '(todas)'; confirmAlvo = 'da rede';
    } else if (hasB) {
      titulo = `${_fBandeira} (${n} posto${s})`; btnSuf = `(${_fBandeira})`; confirmAlvo = `da ${_fBandeira}`;
    } else {
      titulo = `BUSCA (${n} posto${s})`; btnSuf = '(busca)'; confirmAlvo = 'da busca';
    }
    return {
      n, s,
      tituloFull: '⚡ Lançar custo do dia — ' + titulo,
      btnLabel: `Aplicar em ${n} posto${s} ${btnSuf}`,
      confirmAlvo,
    };
  }
  // Atualiza SÓ o título e o rótulo do botão (não recria os inputs — não apaga
  // o que o usuário já digitou). Chamado quando o filtro muda.
  function atualizarBarraAlvo() {
    const a = alvoBarra();
    const t = document.getElementById('cm-bar-titulo'); if (t) t.textContent = a.tituloFull;
    const b = document.getElementById('cm-bar-btn');    if (b) b.textContent = a.btnLabel;
  }

  function renderBarra() {
    const bar = document.getElementById('cm-bar');
    if (_readonly) { bar.style.display = 'none'; return; }   // ADM não lança em massa
    const campos = BARRA_COMB.map(f =>
      '<div class="cm-bar-field"><label>' + f.cod + '</label>' +
      '<input id="cm-bar-' + f.cod + '" inputmode="decimal" placeholder="0,0000"></div>'
    ).join('');
    const a = alvoBarra();
    bar.innerHTML =
      '<div class="cm-bar-title" id="cm-bar-titulo">' + esc(a.tituloFull) + '</div>' +
      '<div class="cm-bar-inputs">' + campos +
        '<button class="cm-btn" id="cm-bar-btn" onclick="__cmAplicarPrep()">' + esc(a.btnLabel) + '</button>' +
        '<button class="cm-btn ghost" id="cm-import-btn" onclick="__cmImportAbrir()" title="Importar planilha de custo (.xlsx)">📥 Importar planilha</button>' +
        '<input type="file" id="cm-import-file" accept=".xlsx" hidden onchange="__cmImportFile(this)">' +
      '</div>' +
      '<div id="cm-bar-confirm"></div>';
  }

  // ── Filtro (busca + chips de bandeira) ───────────────────────────
  // Bandeiras presentes nos dados (normalizadas), ordenadas por contagem desc.
  function bandeirasDisponiveis() {
    const cont = new Map();
    (_dados && _dados.postos || []).forEach(p => {
      const b = normBandeira(p.bandeira);
      if (!b) return;
      cont.set(b, (cont.get(b) || 0) + 1);
    });
    return [...cont.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  function renderFiltro() {
    const f = document.getElementById('cm-filtro');
    const chips = bandeirasDisponiveis().map(b => {
      const val = b.label.replace(/'/g, "\\'");
      return '<button class="cm-chip' + (_fBandeira === b.label ? ' on' : '') + '" onclick="__cmChip(\'' + val + '\')">' + esc(b.label) + '</button>';
    }).join('');
    f.innerHTML =
      '<input class="cm-search" id="cm-search" placeholder="🔎 Buscar posto…" value="' + esc(_fNome) + '" oninput="__cmBusca(this)">' +
      '<div class="cm-chips">' +
        '<button class="cm-chip' + (_fBandeira === '' ? ' on' : '') + '" onclick="__cmChip(\'\')">TODAS</button>' +
        chips +
      '</div>';
  }

  // ── Desvio vs. o posto de REFERENCIA da bandeira ─────────────────
  // O painel de Mercado publica UM custo por bandeira (o do posto de
  // referencia). Aqui o objetivo e o inverso: ver QUEM foge dele. Positivo =
  // paga mais caro (vermelho); negativo = tem desconto (verde).
  //
  // Nao mostra nada quando:
  //  · o posto ESTA na referencia (desvio 0) — card limpo, so o que desvia salta;
  //  · nao ha referencia possivel (ref_origem null) — combustivel que o posto de
  //    referencia nao vende E com um unico posto na bandeira, entao nao ha
  //    com o que comparar. O backend ja suprime esses casos.
  //
  // ref_origem = "moda" e FALLBACK: o posto de referencia nao lancou custo no
  // dia, e a comparacao esta sendo feita contra o valor mais frequente da
  // bandeira. Vem tracejado em ambar para nao ser lido como desvio real.
  function desvioHtml(c) {
    if (c.desvio == null || !c.ref_origem) return '';
    const fb = c.ref_origem !== 'referencia';
    if (c.desvio === 0 && !fb) return '';
    const base = fb
      ? 'valor mais frequente da bandeira' + (c.ref_posto ? '; o posto de referência (' + c.ref_posto + ') não lançou custo neste dia' : '; referência não configurada')
      : 'custo do posto de referência' + (c.ref_posto ? ' (' + c.ref_posto + ')' : '');
    const title = (c.desvio === 0 ? 'Igual ao ' : (c.desvio > 0 ? 'Paga a mais que o ' : 'Paga a menos que o ')) +
      base + ': ' + fmtCusto(c.ref_custo) +
      (c.desvio === 0 ? '' : ' → diferença de ' + fmtCent(c.desvio) + ' centavos') +
      (fb ? '. FALLBACK: não é o preço de referência.' : '');
    const cls = 'cm-dv ' + (fb ? 'fb' : (c.desvio > 0 ? 'mais' : 'menos'));
    const seta = c.desvio === 0 ? '=' : (c.desvio > 0 ? '▴' : '▾');
    const texto = c.desvio === 0 ? 'na moda' : seta + fmtCent(c.desvio) + '¢';
    return '<span class="' + cls + '" title="' + esc(title) + '">' + texto + '</span>';
  }

  // ── Grid de cards dos postos ─────────────────────────────────────
  function renderGrid() {
    const box = document.getElementById('cm-grid-box');
    const postos = postosFiltrados();
    if (!postos.length) { box.innerHTML = '<div class="cm-empty">Nenhum posto para esse filtro.</div>'; return; }
    box.innerHTML = '<div class="cm-grid">' + postos.map(cardPosto).join('') + '</div>';
  }

  function cardPosto(p) {
    const pid = p.posto_id;
    const linhas = (p.combustiveis || []).map(c => {
      const cod = String(c.codigo).toUpperCase();
      // CUSTO (editável)
      // Lápis só quando NÃO é leitura (ADM não edita).
      const penCusto = _readonly ? '' : '<span class="cm-pen" title="Editar custo" onclick="__cmEditCusto(\'' + pid + '\',\'' + cod + '\')">✏️</span>';
      const penVenda = _readonly ? '' : '<span class="cm-pen" title="Sobrescrever venda" onclick="__cmEditVenda(\'' + pid + '\',\'' + cod + '\')">✏️</span>';
      const custoHtml = (c.custo != null ? '<span class="cm-custo">' + fmtCusto(c.custo) + '</span>' : '<span class="cm-na">—</span>') +
        desvioHtml(c) + penCusto;
      // VENDA (+ etiqueta auto quando vem da coleta) + lápis de override
      let vendaHtml;
      if (c.venda != null) {
        vendaHtml = '<span class="cm-venda">' + fmtCusto(c.venda) + '</span>' +
          (c.venda_origem === 'coleta' ? '<span class="cm-auto" title="preço da coleta própria">auto</span>' : '');
      } else {
        vendaHtml = '<span class="cm-na">—</span>';
      }
      vendaHtml += penVenda;
      // MARGEM / DELTA
      const margemHtml = c.margem != null ? '<span class="' + margemClasse(c.margem) + '">' + fmtMarg(c.margem) + '</span>' : '<span class="cm-na">—</span>';
      const deltaHtml = '<span class="' + deltaClasse(c.reajuste) + '">' + fmtDelta(c.reajuste) + '</span>';
      return '<tr>' +
        '<td>' + esc(c.codigo) + '</td>' +
        '<td id="cm-custo-' + idSafe(pid) + '-' + cod + '">' + custoHtml + '</td>' +
        '<td id="cm-venda-' + idSafe(pid) + '-' + cod + '">' + vendaHtml + '</td>' +
        '<td>' + margemHtml + '</td>' +
        '<td>' + deltaHtml + '</td>' +
      '</tr>';
    }).join('');
    const badge = p.bandeira ? '<span class="cm-badge">' + esc(p.bandeira) + '</span>' : '';
    // Este posto define o custo da bandeira no painel de Mercado: os desvios dos
    // outros postos da bandeira sao medidos contra ele, e o dele e sempre zero.
    const refBadge = p.eh_referencia
      ? '<span class="cm-ref" title="Posto de referência da bandeira ' + esc(p.bandeira || '') +
        '. É o custo que o painel de Mercado publica, e a base dos desvios dos outros postos.">REFERÊNCIA</span>'
      : '';
    return '<div class="cm-pcard">' +
      '<div class="cm-pcard-hdr"><span class="cm-pnome">' + esc(p.posto) + '</span>' + refBadge + badge + '</div>' +
      '<table class="cm-table">' +
        '<thead><tr><th>Comb</th><th>Custo</th><th>Venda</th><th>Margem</th><th>Δ Custo</th></tr></thead>' +
        '<tbody>' + (linhas || '<tr><td colspan="5" class="cm-na">Sem combustíveis</td></tr>') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // ── Card 🏭 Referência Fornecedores ──────────────────────────────
  function renderFornecedores() {
    const box = document.getElementById('cm-forn-box');
    const itens = (_forn && _forn.itens) || [];
    // matriz comb × distribuidora
    const combs = [...new Set(itens.map(i => i.combustivel))];
    const distrs = [...new Set(itens.map(i => i.distribuidora))].sort((a, b) => a.localeCompare(b));
    const mapa = {}; // comb|distr -> custo
    itens.forEach(i => { mapa[i.combustivel + '|' + i.distribuidora] = i.custo; });

    let corpo;
    if (!itens.length) {
      corpo = '<div class="cm-empty">Nenhum custo de fornecedor lançado neste dia.</div>';
    } else {
      const thead = '<tr><th>Comb</th>' + distrs.map(d => '<th>' + esc(d) + '</th>').join('') + '</tr>';
      const linhas = combs.map(cb => {
        const valores = distrs.map(d => mapa[cb + '|' + d]).filter(v => v != null).map(Number);
        const menor = valores.length ? Math.min(...valores) : null;
        const cels = distrs.map(d => {
          const v = mapa[cb + '|' + d];
          if (_fornEdit) {
            return '<td><input class="cm-inp" data-comb="' + esc(cb) + '" data-distr="' + esc(d) +
              '" value="' + (v != null ? fmtCusto(v) : '') + '" inputmode="decimal"></td>';
          }
          if (v == null) return '<td class="cm-na">—</td>';
          const menorCls = (menor != null && Math.abs(Number(v) - menor) < 0.00005) ? ' class="cm-forn-menor"' : '';
          return '<td><span' + menorCls + '>' + fmtCusto(v) + '</span></td>';
        }).join('');
        return '<tr><td>' + esc(cb) + '</td>' + cels + '</tr>';
      }).join('');
      corpo = '<table class="cm-table">' +
        '<thead>' + thead + '</thead><tbody>' + linhas + '</tbody></table>';
    }

    const botoes = _readonly
      ? ''   // ADM não edita fornecedores
      : (_fornEdit
        ? '<button class="cm-btn" onclick="__cmFornSave()">Salvar</button>' +
          '<button class="cm-btn ghost" onclick="__cmFornCancel()">Cancelar</button>'
        : (itens.length ? '<button class="cm-btn ghost" onclick="__cmFornEdit()">✎ Editar</button>' : ''));

    box.innerHTML =
      '<div class="cm-card">' +
        '<div class="cm-pcard-hdr"><div class="cm-bar-title" style="margin:0">🏭 Referência Fornecedores</div>' +
          '<div style="display:flex;gap:.5rem">' + botoes + '</div>' +
        '</div>' +
        corpo +
      '</div>';
  }

  // ── POST helpers ─────────────────────────────────────────────────
  async function postLancamentos(lancamentos) {
    try {
      await apiFetch('/custo-margem', { method: 'POST', body: JSON.stringify({ data: _dataISO, lancamentos, origem: 'manual' }) });
      return true;
    } catch (err) {
      alert('Erro ao salvar custo: ' + (err.message || err));
      return false;
    }
  }

  // ── Edição inline: CUSTO ─────────────────────────────────────────
  window.__cmEditCusto = function (pid, cod) {
    const cell = document.getElementById('cm-custo-' + idSafe(pid) + '-' + cod);
    if (!cell) return;
    const c = getComb(pid, cod);
    const val = (c && c.custo != null) ? fmtCusto(c.custo) : '';
    cell.innerHTML = '<input class="cm-inp" id="cm-inp-c-' + idSafe(pid) + '-' + cod + '" inputmode="decimal" value="' + val + '"' +
      ' onkeydown="__cmKey(event,this,\'c\',\'' + pid + '\',\'' + cod + '\')" onblur="__cmSaveCusto(\'' + pid + '\',\'' + cod + '\',this)">';
    const inp = document.getElementById('cm-inp-c-' + idSafe(pid) + '-' + cod);
    if (inp) { inp.focus(); inp.select(); }
  };
  window.__cmSaveCusto = async function (pid, cod, inp) {
    if (inp.dataset.saving === '1' || inp.dataset.cancel === '1') return;
    const c = getComb(pid, cod);
    const novo = parseCustoBR(inp.value);
    const atual = (c && c.custo != null) ? Number(c.custo) : null;
    if (novo === null) { renderGrid(); return; }                       // vazio → cancela
    if (atual != null && Math.abs(novo - atual) < 0.00005) { renderGrid(); return; }
    inp.dataset.saving = '1';
    // preserva o override existente (o upsert reescreve a linha inteira)
    const override = (c && c.venda_origem === 'override') ? c.venda : null;
    const ok = await postLancamentos([{ posto_id: pid, combustivel: cod, custo_avista: novo, venda_override: override }]);
    if (ok) await carregar(_dataISO); else renderGrid();
  };

  // ── Edição inline: VENDA (override) ──────────────────────────────
  window.__cmEditVenda = function (pid, cod) {
    const cell = document.getElementById('cm-venda-' + idSafe(pid) + '-' + cod);
    if (!cell) return;
    const c = getComb(pid, cod);
    // preenche com o override atual (se houver); coleta 'auto' não pré-preenche
    const val = (c && c.venda_origem === 'override' && c.venda != null) ? fmtCusto(c.venda) : '';
    cell.innerHTML = '<input class="cm-inp" id="cm-inp-v-' + idSafe(pid) + '-' + cod + '" inputmode="decimal" value="' + val + '" placeholder="override"' +
      ' onkeydown="__cmKey(event,this,\'v\',\'' + pid + '\',\'' + cod + '\')" onblur="__cmSaveVenda(\'' + pid + '\',\'' + cod + '\',this)">';
    const inp = document.getElementById('cm-inp-v-' + idSafe(pid) + '-' + cod);
    if (inp) { inp.focus(); inp.select(); }
  };
  window.__cmSaveVenda = async function (pid, cod, inp) {
    if (inp.dataset.saving === '1' || inp.dataset.cancel === '1') return;
    const c = getComb(pid, cod);
    const novo = parseCustoBR(inp.value);          // vazio → remove override (null)
    const overrideAtual = (c && c.venda_origem === 'override' && c.venda != null) ? Number(c.venda) : null;
    if ((novo === null && overrideAtual === null) ||
        (novo !== null && overrideAtual !== null && Math.abs(novo - overrideAtual) < 0.00005)) {
      renderGrid(); return; // sem mudança
    }
    inp.dataset.saving = '1';
    const custo = (c && c.custo != null) ? Number(c.custo) : null;  // preserva o custo
    const ok = await postLancamentos([{ posto_id: pid, combustivel: cod, custo_avista: custo, venda_override: novo }]);
    if (ok) await carregar(_dataISO); else renderGrid();
  };

  // Enter salva (blur), Esc cancela (re-render sem salvar).
  window.__cmKey = function (e, inp) {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); inp.dataset.cancel = '1'; renderGrid(); }
  };

  // ── Barra: aplicar em massa (com confirmação inline) ─────────────
  function lerBarra() {
    // { cod: valor } só dos campos preenchidos
    const out = {};
    BARRA_COMB.forEach(f => {
      const el = document.getElementById('cm-bar-' + f.cod);
      const v = el ? parseCustoBR(el.value) : null;
      if (v !== null) out[f.cod] = v;
    });
    return out;
  }
  window.__cmAplicarPrep = function () {
    const vals = lerBarra();
    const cods = Object.keys(vals);
    const box = document.getElementById('cm-bar-confirm');
    if (!cods.length) { box.innerHTML = '<div class="cm-confirm"><span class="txt">Preencha ao menos um custo pra aplicar.</span></div>'; return; }
    const postos = postosFiltrados();
    if (!postos.length) { box.innerHTML = '<div class="cm-confirm"><span class="txt">Nenhum posto no filtro atual.</span></div>'; return; }
    // conta os lançamentos reais (postos VISÍVEIS × combustíveis preenchidos que o posto tem)
    let totalLanc = 0;
    postos.forEach(p => {
      (p.combustiveis || []).forEach(c => { if (vals[String(c.codigo).toUpperCase()] !== undefined) totalLanc++; });
    });
    const a = alvoBarra();
    const resumo = cods.map(cod => cod + ' ' + fmtCusto(vals[cod])).join(' · ');
    box.innerHTML =
      '<div class="cm-confirm">' +
        '<span class="txt">Lançar <b>' + resumo + '</b> em <b>' + a.n + '</b> posto' + a.s + ' ' + esc(a.confirmAlvo) +
          ' (' + totalLanc + ' lançamento' + (totalLanc === 1 ? '' : 's') + ')?</span>' +
        '<button class="cm-btn" onclick="__cmAplicarConfirm()">Confirmar</button>' +
        '<button class="cm-btn ghost" onclick="__cmAplicarCancel()">Cancelar</button>' +
      '</div>';
  };
  window.__cmAplicarCancel = function () {
    const box = document.getElementById('cm-bar-confirm');
    if (box) box.innerHTML = '';
  };
  window.__cmAplicarConfirm = async function () {
    const vals = lerBarra();
    const lancamentos = [];
    postosFiltrados().forEach(p => {
      (p.combustiveis || []).forEach(c => {
        const cod = String(c.codigo).toUpperCase();
        if (vals[cod] === undefined) return;
        const override = (c.venda_origem === 'override') ? c.venda : null; // preserva override do posto
        lancamentos.push({ posto_id: p.posto_id, combustivel: c.codigo, custo_avista: vals[cod], venda_override: override });
      });
    });
    if (!lancamentos.length) { __cmAplicarCancel(); return; }
    const ok = await postLancamentos(lancamentos);
    if (ok) await carregar(_dataISO);
  };

  // ── Filtro / navegação de dia ────────────────────────────────────
  window.__cmDia = function (n) { carregar(addDias(_dataISO, n)); };
  window.__cmHoje = function () { carregar(hojeISO()); };
  window.__cmDataInput = function (el) { if (el.value) carregar(el.value); };
  window.__cmChip = function (b) { _fBandeira = b; renderFiltro(); renderGrid(); atualizarBarraAlvo(); __cmAplicarCancel(); };
  window.__cmBusca = function (el) { _fNome = el.value; renderGrid(); atualizarBarraAlvo(); __cmAplicarCancel(); };

  // ── Fornecedores: editar/salvar ──────────────────────────────────
  window.__cmFornEdit = function () { _fornEdit = true; renderFornecedores(); };
  window.__cmFornCancel = function () { _fornEdit = false; renderFornecedores(); };
  window.__cmFornSave = async function () {
    const inputs = document.querySelectorAll('#cm-forn-box .cm-inp');
    const itens = [];
    inputs.forEach(inp => {
      const custo = parseCustoBR(inp.value);
      if (custo === null) return; // célula vazia não regrava
      itens.push({ combustivel: inp.dataset.comb, distribuidora: inp.dataset.distr, custo });
    });
    if (!itens.length) { _fornEdit = false; renderFornecedores(); return; }
    try {
      await apiFetch('/custos-fornecedores', { method: 'POST', body: JSON.stringify({ data: _dataISO, itens }) });
      _fornEdit = false;
      await carregar(_dataISO);
    } catch (err) {
      alert('Erro ao salvar fornecedores: ' + (err.message || err));
    }
  };

  // ════════════════════════════════════════════════════════════════
  // IMPORTAÇÃO DE PLANILHA (.xlsx) → POST /custos/importar
  // dry_run:true = prévia no modal; dry_run:false = grava. Só Logística
  // (a barra some no _readonly, então o botão nem aparece pro ADM).
  // ════════════════════════════════════════════════════════════════

  // Fetch dedicado: precisa do STATUS + CORPO mesmo em erro (o apiFetch
  // descarta o corpo em não-2xx, e o 409 traz os bloqueantes). Mantém o
  // refresh-once de token igual ao apiFetch.
  async function importFetch(body, _retry) {
    const token = window.jbretasGetItem ? window.jbretasGetItem('jbretas_token') : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch(window.JBRETAS_CONFIG.API_URL + '/custos/importar', {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    if (resp.status === 401 && !_retry && typeof window.jbretasRefresh === 'function') {
      if (await window.jbretasRefresh()) return importFetch(body, true);
    }
    if (resp.status === 401) {
      if (window.jbretasClearSessao) window.jbretasClearSessao();
      window.location.href = (window.caminhoRaiz ? window.caminhoRaiz() : '') + 'index.html?expirado=1';
      return { status: 401, json: {} };
    }
    let json = null;
    try { json = await resp.json(); } catch (e) { /* corpo não-JSON */ }
    return { status: resp.status, json: json || {} };
  }

  function lerArquivoDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);           // "data:...;base64,AAAA…"
      r.onerror = () => reject(new Error('não consegui ler o arquivo'));
      r.readAsDataURL(file);
    });
  }

  // "2026-06-30" → "30/06" e "30/06/2026"
  function brDDMM(iso)    { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : String(iso || ''); }
  function brDDMMAAAA(iso){ const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || ''); }

  // Bloqueante cru → texto legível (nunca JSON na tela).
  function textoBloqueante(a) {
    if (!a || !a.tipo) return 'Problema não identificado na planilha.';
    if (a.tipo === 'BLOQUEANTE_datas_divergentes') {
      const ds = (a.datas || []).map(brDDMM).join(' e ');
      return 'Datas divergentes no mesmo bloco' + (a.bloco != null ? ' (linha ' + a.bloco + ')' : '') + ': ' + ds;
    }
    if (a.tipo === 'BLOQUEANTE_datas_nao_lidas') {
      const ds = a.datas || [];
      const mostra = ds.slice(0, 12).map(brDDMMAAAA).join(', ');
      return 'A aba tem ' + a.datas_na_aba + ' datas e o parser leu ' + a.datas_lidas +
             '. Ficaram de fora: ' + mostra +
             (ds.length > 12 ? ' (e mais ' + (ds.length - 12) + ')' : '');
    }
    if (a.tipo === 'BLOQUEANTE_ano_suspeito')   return 'Ano suspeito: ' + brDDMMAAAA(a.data);
    if (a.tipo === 'BLOQUEANTE_data_duplicada') return 'Data repetida em dois blocos: ' + brDDMMAAAA(a.data);
    return a.tipo.replace(/^BLOQUEANTE_/, '').replace(/_/g, ' ') + (a.data ? ': ' + brDDMMAAAA(a.data) : '');
  }

  // status HTTP + corpo → mensagem legível.
  function mensagemErroImport(status, json) {
    const base = json && json.erro ? String(json.erro) : '';
    if (status === 403) return 'Seu perfil não tem permissão para importar custos.';
    if (status === 413) return 'Arquivo maior que 7 MB. Reduza a planilha e importe de novo.';
    if (status === 400) return base ? ('Não foi possível ler a planilha: ' + base) : 'O arquivo não é um .xlsx válido.';
    if (status === 409) return 'Importação bloqueada pelos avisos da planilha.';
    // 429: este wrapper não passa pelo apiFetch, então a mensagem de rate limit
    // precisa existir aqui também. `retry_apos` vem no corpo (ver handler429 na API).
    if (status === 429) {
      const seg = Number(json && json.retry_apos) || 0;
      const espera = seg <= 0 ? ''
        : (seg >= 60 ? ' Tente em ' + Math.ceil(seg / 60) + ' min.' : ' Tente em ' + seg + 's.');
      return (base || 'Muitas requisições. Aguarde um instante.') + espera;
    }
    return base ? ('Erro: ' + base) : ('Erro inesperado (HTTP ' + status + ').');
  }

  // ── Modal ────────────────────────────────────────────────────────
  function montarModalImport() {
    if (document.getElementById('cmi-overlay')) return;
    const ov = document.createElement('div');
    ov.className = 'cmi-overlay';
    ov.id = 'cmi-overlay';
    ov.innerHTML =
      '<div class="cmi-sheet">' +
        '<button class="cmi-close" id="cmi-close">✕</button>' +
        '<div class="cmi-title" id="cmi-title">Prévia da importação</div>' +
        '<div class="cmi-file" id="cmi-file-nome"></div>' +
        '<div id="cmi-body"></div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('cmi-close').onclick = fecharModalImport;
    ov.addEventListener('click', (e) => { if (e.target === ov) fecharModalImport(); });
  }
  function fecharModalImport() { const ov = document.getElementById('cmi-overlay'); if (ov) ov.classList.remove('open'); }
  function abrirOverlayImport() { montarModalImport(); document.getElementById('cmi-overlay').classList.add('open'); }

  function abrirModalErroImport(msg) {
    abrirOverlayImport();
    document.getElementById('cmi-title').textContent = 'Importação';
    document.getElementById('cmi-file-nome').textContent = _cmiFile ? _cmiFile.name : '';
    document.getElementById('cmi-body').innerHTML =
      '<div class="cmi-erro-ic">⚠️</div>' +
      '<div class="cmi-msg">' + esc(msg) + '</div>' +
      '<div class="cmi-foot"><button class="cmi-btn ghost" onclick="__cmiFechar()">Fechar</button></div>';
  }

  function renderPreviaImport(p, nome) {
    document.getElementById('cmi-title').textContent = 'Prévia da importação';
    document.getElementById('cmi-file-nome').textContent = nome || (_cmiFile ? _cmiFile.name : '');
    const arq = p.arquivo || {}, resumo = p.resumo || {}, bloq = p.bloqueantes || [], amostra = p.amostra || [];
    const temBloq = bloq.length > 0;
    // Conferência do parser: datas da aba x datas lidas. Divergência aparece no
    // card, não só na lista de bloqueantes — é a primeira coisa que se olha.
    const faltando = Array.isArray(arq.datas_faltando) ? arq.datas_faltando : [];

    const cards =
      '<div class="cmi-cards">' +
        '<div class="cmi-c' + (faltando.length ? ' bad' : '') + '"><b>' +
          (arq.datas != null ? arq.datas : '—') +
          (faltando.length ? '/' + arq.datas_na_aba : '') +
        '</b><span>Datas' + (faltando.length ? ' lidas' : '') + '</span></div>' +
        '<div class="cmi-c"><b>' + (resumo.postos_casados != null ? resumo.postos_casados : '—') + '/37</b><span>Postos casados</span></div>' +
        '<div class="cmi-c' + (temBloq ? ' bad' : '') + '"><b>' + bloq.length + '</b><span>Bloqueantes</span></div>' +
      '</div>';

    const faixa = (arq.data_min || arq.data_max)
      ? '<div class="cmi-faixa">Período: <b>' + esc(brDDMMAAAA(arq.data_min)) + '</b> → <b>' + esc(brDDMMAAAA(arq.data_max)) + '</b></div>'
      : '';

    const infoManual = (resumo.preservado_manual > 0)
      ? '<div class="cmi-info">' + resumo.preservado_manual + ' linha(s) com origem manual não serão sobrescritas.</div>'
      : '';

    const apt = p.avisos_por_tipo || {};
    const aptK = Object.keys(apt).filter(k => !/^BLOQUEANTE/.test(k)).sort();
    const avisosHtml = aptK.length
      ? '<div class="cmi-info"><b>Avisos:</b> ' +
          aptK.map(k => esc(k.replace(/_/g, ' ')) + ' (' + apt[k] + ')').join(' · ') +
        '</div>'
      : '';

    let bloqHtml = '';
    if (temBloq) {
      bloqHtml =
        '<div class="cmi-bloq">' +
          '<div class="cmi-bloq-tit">⛔ ' + bloq.length + ' bloqueante' + (bloq.length === 1 ? '' : 's') + '</div>' +
          '<ul>' + bloq.map(a => '<li>' + esc(textoBloqueante(a)) + '</li>').join('') + '</ul>' +
          '<div class="cmi-fix">Corrija na planilha, salve e importe de novo.</div>' +
        '</div>';
    }

    let tbl = '';
    if (amostra.length) {
      const rows = amostra.slice(0, 15).map(a =>
        '<tr><td>' + esc(a.posto) + '</td><td>' + esc(a.combustivel) + '</td>' +
        '<td class="cmi-cst">' + fmtCusto(a.custo) + '</td></tr>').join('');
      tbl = '<table class="cmi-tbl"><thead><tr><th>Posto</th><th>Comb</th><th>Custo</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    const n = resumo.custos != null ? resumo.custos : 0;
    const gravar = temBloq
      ? '<button class="cmi-btn" disabled>Gravar</button>'
      : '<button class="cmi-btn" id="cmi-gravar" onclick="__cmiGravar()">Gravar ' + n + ' linha' + (n === 1 ? '' : 's') + '</button>';

    document.getElementById('cmi-body').innerHTML =
      cards + faixa + infoManual + bloqHtml + avisosHtml + tbl +
      '<div class="cmi-foot">' + gravar + '<button class="cmi-btn ghost" onclick="__cmiFechar()">Fechar</button></div>';
  }

  // ── Handlers públicos ────────────────────────────────────────────
  window.__cmImportAbrir = function () {
    const inp = document.getElementById('cm-import-file');
    if (inp) { inp.value = ''; inp.click(); }
  };

  window.__cmImportFile = async function (input) {
    const file = input.files && input.files[0];
    input.value = '';                              // permite reescolher o mesmo arquivo
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { alert('Selecione um arquivo .xlsx (planilha do Excel).'); return; }
    if (file.size > 7 * 1024 * 1024) { alert('Arquivo maior que 7 MB. Reduza a planilha e tente de novo.'); return; }

    const btn = document.getElementById('cm-import-btn');
    const rot = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Lendo planilha…'; }
    try {
      const dataUrl = await lerArquivoDataURL(file);
      _cmiFile = file; _cmiB64 = dataUrl;
      const { status, json } = await importFetch({ arquivoBase64: dataUrl, dry_run: true });
      if (status !== 200 || !json || json.ok !== true) { abrirModalErroImport(mensagemErroImport(status, json)); return; }
      _cmiPrev = json;
      abrirOverlayImport();
      renderPreviaImport(json, file.name);
    } catch (err) {
      alert('Erro ao ler a planilha: ' + (err && err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = rot || '📥 Importar planilha'; }
    }
  };

  window.__cmiFechar = fecharModalImport;

  window.__cmiGravar = async function () {
    if (!_cmiB64) return;
    const btn = document.getElementById('cmi-gravar');
    if (btn) { btn.disabled = true; btn.textContent = 'Gravando…'; }
    try {
      const { status, json } = await importFetch({ arquivoBase64: _cmiB64, dry_run: false });
      if (status === 200 && json && json.ok) {
        fecharModalImport();
        const g = json.gravado || {};
        let msg = 'Importação concluída.\n' +
          (g.custos_precos || 0) + ' custo(s) e ' + (g.custos_fornecedores || 0) + ' cotação(ões) gravados.';
        if (g.preservado_manual) msg += '\n' + g.preservado_manual + ' linha(s) manual preservada(s).';
        if (g.descartado)        msg += '\n' + g.descartado + ' linha(s) descartada(s) (sem cadastro).';
        alert(msg);
        await carregar(_dataISO);              // recarrega o dia atual (sem reload de página)
        return;
      }
      if (status === 409) {                     // bloqueantes → reabre a prévia com eles
        if (json && Array.isArray(json.bloqueantes) && _cmiPrev) {
          _cmiPrev = Object.assign({}, _cmiPrev, { bloqueantes: json.bloqueantes });
          renderPreviaImport(_cmiPrev, _cmiFile ? _cmiFile.name : '');
        } else {
          const pv = await importFetch({ arquivoBase64: _cmiB64, dry_run: true });
          if (pv.status === 200 && pv.json) { _cmiPrev = pv.json; renderPreviaImport(pv.json, _cmiFile ? _cmiFile.name : ''); }
          else abrirModalErroImport(mensagemErroImport(pv.status, pv.json));
        }
        return;
      }
      abrirModalErroImport(mensagemErroImport(status, json));
    } catch (err) {
      alert('Erro ao gravar: ' + (err && err.message || err));
      if (_cmiPrev) renderPreviaImport(_cmiPrev, _cmiFile ? _cmiFile.name : '');   // restaura o botão Gravar
    }
  };

  // ── Entrada pública (chamada pelo switchMainTab) ─────────────────
  window.renderCustoMargem = function (sec) {
    if (!sec) return;
    if (!_shellPronto || !sec.querySelector('.cm-wrap')) montarShell(sec);
    if (!_dados) carregar(_dataISO); // primeira abertura busca; depois mantém
  };
})();
