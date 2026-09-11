// ================================================================
// JBRETAS SISTEMA — shared/js/comparacao-logistica.js
// Seção "Comparação de preços" da aba Alteração de Preços (Logística).
// Renderiza em #sl-comparacao, acima da lista de solicitações.
//
// NÃO REIMPLEMENTA O CARD. A matriz é o mesmo cmpCardMatriz do
// shared/js/comparacao-card.js que o admin e o painel-adm usam, chamado com
// a mesma assinatura e com um `opcoes` congelado nos valores INICIAIS dos
// G_CMP_* do admin (fuel GC, estratégia avg, sem ordenação e sem os chips de
// abaixo/acima/só-quem-mudou). A Logística não tem barra de filtros; se um dia
// tiver, é só trocar CMP_OPCOES por estado.
//
// DOIS CAMINHOS PARA EDITAR, o mesmo desfecho. O lápis da célula "Você" é o
// cmpEditarVoce/cmpConfirmarVoce do shared (ganhou vida aqui quando a regra
// que o escondia saiu do comparacao.css); o formulário do rodapé do card é
// desta tela, e existe porque mostra erro inline em vez de alert e
// pré-preenche com o Sugerido. Os dois terminam no mesmo
// window.cmpAposSalvarPreco, definido no fim deste arquivo.
//
// PRÓPRIO × CONCORRENTE SÓ PELA ESTRUTURA. dado.proprio é a coleta do nosso
// posto e dado.concorrentes são as dos vizinhos — quem separou foi o campo
// `tipo` do GET /coletas, lá no coletas-service. Aqui não se compara nome de
// posto em momento nenhum: foi exatamente isso que quebrou a Beatriz uma vez.
// ================================================================
(function () {
  'use strict';

  const INTERVALO_MS = 5 * 60 * 1000;   // recarga periódica
  const HOST_ID = 'sl-comparacao';

  // Congelado nos valores iniciais dos let do admin/app.js:
  //   G_CMP_FUEL='GC'  G_CMP_STRAT='avg'  G_CMP_ORD=''
  //   G_CMP_ABAIXO=false  G_CMP_ACIMA=false  G_CMP_SO_MUDOU=false
  const CMP_OPCOES = {
    fuel: 'GC', strat: 'avg', ord: '',
    abaixo: false, acima: false, soMudou: false,
  };

  let _comp = null;        // mapa da comparação (chave .k -> dado)
  let _carregando = false;
  let _timer = null;

  function ehLogistica() {
    try { return (getUsuarioLogado() || {}).perfil === 'LOGISTICA'; }
    catch (e) { return false; }
  }

  const host = () => document.getElementById(HOST_ID);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Preço "6,19" a partir de número; '' quando não há valor.
  const precoInput = (v) => (v === null || v === undefined || isNaN(v))
    ? '' : Number(v).toFixed(2).replace('.', ',');

  // Não reusa o fmtPrecoBRL do comparacao-card.js de propósito: aquele é o
  // formato DA MATRIZ e mudá-lo mexeria nas três telas. Este é só do texto
  // "atual R$6,19" deste formulário.
  const fmtBRL = (v) => (v === null || v === undefined || v === '' || v === '-')
    ? '--' : 'R$' + Number(v).toFixed(2).replace('.', ',');

  // ── Dados ───────────────────────────────────────────────────────
  async function carregar() {
    if (_carregando) return;
    _carregando = true;
    try {
      const comp = await buscarComparacaoDoDia({ dias: 15 });
      // Mesmo overlay do admin: sobrepõe no "Você" os preços já revisados hoje.
      await cmpAplicarRevisoes(comp);
      _comp = comp;
    } catch (err) {
      console.warn('Comparação (logística) indisponível:', err && err.message);
      if (_comp === null) _comp = {};   // primeira carga falhou: pinta o vazio
    } finally {
      _carregando = false;
    }
    render();
  }

  // Postos na ordem pedida: com coleta própria HOJE primeiro (alfabético),
  // depois os sem coleta (alfabético). `proprioDesatualizado` é o que o
  // coletas-service usa para dizer "este dado não é de hoje".
  function postosOrdenados() {
    const comMapa = (typeof MAP_POSTOS !== 'undefined') ? MAP_POSTOS : [];
    const lista = comMapa
      .filter(p => _comp && _comp[p.k])
      .map(p => ({ posto: p, dado: _comp[p.k] }));
    const temHoje = (d) => !!(d && d.proprio && !d.proprioDesatualizado);
    return lista.sort((a, b) => {
      const ta = temHoje(a.dado) ? 0 : 1;
      const tb = temHoje(b.dado) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return a.posto.ap.localeCompare(b.posto.ap);
    });
  }

  // ── Render ──────────────────────────────────────────────────────
  function render() {
    const el = host();
    if (!el) return;

    const itens = postosOrdenados();
    const comColeta = itens.filter(i => i.dado.proprio && !i.dado.proprioDesatualizado).length;

    // O SCROLL DO CARROSSEL SOBREVIVE AO REDESENHO. Sem isto a recarga de 5
    // min (ou a que roda logo após uma solicitação) jogaria o usuário de volta
    // ao primeiro posto, no meio da leitura.
    const railAntigo = el.querySelector('.cl-rail');
    const scrollAntigo = railAntigo ? railAntigo.scrollLeft : 0;

    const cabecalho =
      '<div class="cl-head">' +
        '<span class="cl-h1">Comparação de preços · hoje</span>' +
        '<span class="cl-count">' + (itens.length
          ? esc(comColeta + ' posto' + (comColeta === 1 ? '' : 's') + ' com coleta')
          : 'Sem coletas hoje') + '</span>' +
        '<button type="button" class="cl-reload" data-recarregar title="Recarregar">↻</button>' +
      '</div>';

    if (!itens.length) {
      el.innerHTML = cabecalho + '<div class="cl-vazio">Sem coletas hoje.</div>';
      ligar(el);
      return;
    }

    el.innerHTML = cabecalho +
      '<div class="cl-rail">' + itens.map(cardHtml).join('') + '</div>';

    const rail = el.querySelector('.cl-rail');
    if (rail) rail.scrollLeft = scrollAntigo;
    ligar(el);
  }

  function cardHtml({ posto, dado }) {
    // Mesma chamada que o admin faz: (posto, dado, pos, opcoes). `pos` é null
    // porque aqui não há ordenação por preço — no admin ele só vem preenchido
    // com o ranking ligado.
    const matriz = cmpCardMatriz(posto, dado, null, CMP_OPCOES);
    return '<div class="cl-card" data-posto="' + esc(posto.k) + '">' +
      matriz +
      cmpFotosHtml(posto, dado) +
      '<div class="cl-rodape">' +
        '<button type="button" class="cl-btn-sol" data-solicitar="' + esc(posto.k) + '">Solicitar alteração</button>' +
      '</div>' +
      '<div class="cl-form" data-form="' + esc(posto.k) + '" hidden></div>' +
    '</div>';
  }

  // A FAIXA DE FOTOS E O LIGHTBOX MORAM NO shared/js/comparacao-card.js.
  // Nasceram aqui; subiram quando o ADM passou a mostrar as mesmas
  // miniaturas embaixo da matriz. O onclick da miniatura já chama o
  // cmpAbrirFoto — esta tela não liga listener de foto nenhum.

  // ── Formulário de solicitação ───────────────────────────────────
  // Só os combustíveis em que o posto TEM preço próprio: pedir alteração de um
  // preço que não conhecemos mandaria preco_antigo null e o gerente receberia
  // uma troca sem referência.
  function formHtml(posto, dado) {
    const proprio = dado.proprio || {};
    const fuels = CMP_FUELS_CARD.filter(f => proprio[f.key] !== null && proprio[f.key] !== undefined);
    if (!fuels.length) {
      return '<div class="cl-form-erro">Sem preço próprio coletado — nada a alterar.</div>';
    }
    const sug = cmpSugeridoMatriz(dado, CMP_OPCOES);
    const opcoes = fuels.map(f =>
      '<option value="' + f.key + '">' + esc(f.btn) + ' · ' + esc(f.nome) + '</option>').join('');
    const primeiro = fuels[0].key;
    return '<div class="cl-form-linha">' +
        '<select class="cl-sel">' + opcoes + '</select>' +
        '<span class="cl-atual" data-atual>atual ' + esc(fmtBRL(proprio[primeiro])) + '</span>' +
      '</div>' +
      '<div class="cl-form-linha">' +
        '<input class="cl-inp" type="text" inputmode="decimal" placeholder="novo preço"' +
          ' value="' + esc(precoInput(sug[primeiro])) + '">' +
        '<button type="button" class="cl-ok" data-confirmar>Confirmar</button>' +
        '<button type="button" class="cl-cancel" data-cancelar>Cancelar</button>' +
      '</div>' +
      '<div class="cl-form-msg" data-msg></div>';
  }

  // "619" → 6.19 (só dígitos = centavos); "6,19"/"6.19" → 6.19.
  // Mesma regra do cmpParsePreco do admin, para os dois caminhos de edição
  // aceitarem exatamente a mesma digitação.
  function parsePreco(str) {
    const s = String(str || '').trim();
    if (!s) return NaN;
    if (/[.,]/.test(s)) return parseFloat(s.replace(',', '.'));
    const digits = s.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) / 100 : NaN;
  }

  function abrirForm(card, k) {
    const dado = _comp && _comp[k];
    const posto = (typeof MAP_POSTOS !== 'undefined') ? MAP_POSTOS.find(p => p.k === k) : null;
    if (!dado || !posto) return;
    const box = card.querySelector('[data-form]');
    if (!box) return;
    box.innerHTML = formHtml(posto, dado);
    box.hidden = false;
    const sel = box.querySelector('.cl-sel');
    const inp = box.querySelector('.cl-inp');
    const atual = box.querySelector('[data-atual]');
    if (sel) {
      sel.addEventListener('change', () => {
        const f = sel.value;
        const sug = cmpSugeridoMatriz(dado, CMP_OPCOES);
        if (atual) atual.textContent = 'atual ' + fmtBRL(dado.proprio ? dado.proprio[f] : null);
        if (inp) inp.value = precoInput(sug[f]);
      });
    }
    if (inp) inp.focus();
  }

  function fecharForm(card) {
    const box = card.querySelector('[data-form]');
    if (box) { box.hidden = true; box.innerHTML = ''; }
  }

  // Espelha o cmpConfirmarVoce do admin: valida, grava a revisão e SÓ ENTÃO
  // abre a solicitação — na mesma ordem e com os mesmos argumentos
  // (posto.ap, fuel, novo, orig) / (posto.ap, fuel, orig, novo).
  // Não reproduz o convite do GA: lá ele é um window.confirm no meio do fluxo,
  // e aqui o operador escolhe o combustível no próprio select.
  async function confirmar(card, k) {
    const dado = _comp && _comp[k];
    const posto = (typeof MAP_POSTOS !== 'undefined') ? MAP_POSTOS.find(p => p.k === k) : null;
    const box = card.querySelector('[data-form]');
    if (!dado || !posto || !box) return;

    const sel = box.querySelector('.cl-sel');
    const inp = box.querySelector('.cl-inp');
    const msg = box.querySelector('[data-msg]');
    const btnOk = box.querySelector('[data-confirmar]');
    if (!sel || !inp) return;

    const f = sel.value;
    const novo = parsePreco(inp.value);
    const orig = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined)
      ? Number(dado.proprio[f]) : null;

    const dizer = (t) => { if (msg) { msg.textContent = t; msg.classList.add('on'); } };
    if (isNaN(novo) || novo <= 0) { dizer('Preço inválido.'); return; }
    if (orig !== null && Math.abs(novo - orig) < 0.005) { dizer('Preço igual ao atual.'); return; }

    if (btnOk) { btnOk.disabled = true; btnOk.textContent = 'Enviando…'; }
    if (msg) { msg.textContent = ''; msg.classList.remove('on'); }

    // As duas funções engolem o erro e devolvem false (elas mesmas alertam).
    const ok = await cmpSalvarPrecoProprio(posto.ap, f, novo, orig);
    if (!ok) {
      dizer('Não foi possível salvar o preço. Tente de novo.');
      if (btnOk) { btnOk.disabled = false; btnOk.textContent = 'Confirmar'; }
      return;
    }
    if (!dado.proprio) dado.proprio = {};
    dado.proprio[f] = novo;   // overlay local, igual ao admin

    const okSol = await cmpCriarSolicitacao(posto.ap, f, orig, novo);
    if (!okSol) {
      dizer('Preço salvo, mas a solicitação ao gerente falhou.');
      if (btnOk) { btnOk.disabled = false; btnOk.textContent = 'Confirmar'; }
      return;
    }

    fecharForm(card);
    piscar(card.querySelector('[data-solicitar]'), '✓ Enviado ao gerente');
    // MESMO desfecho do lápis, pelo MESMO hook: recarregar a seção e dar um
    // poll na lista de pendentes. Antes este bloco repetia à mão o que o
    // cmpAposSalvarPreco já faz, e as duas metades iam divergir na primeira
    // vez que alguém mexesse numa só.
    await window.cmpAposSalvarPreco({
      k, fuel: f, posto, dado, novo, orig, salvou: true, flashFuels: [],
    });
  }

  function piscar(btn, txt) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = txt;
    btn.classList.add('ok');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 2200);
  }

  // ── Eventos (delegação: o innerHTML troca os filhos, não o host) ──
  function ligar(el) {
    if (el._clLigado) return;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-recarregar]')) { carregar(); return; }
      const card = e.target.closest('.cl-card');
      if (!card) return;
      const k = card.getAttribute('data-posto');
      if (e.target.closest('[data-solicitar]')) { abrirForm(card, k); return; }
      if (e.target.closest('[data-cancelar]'))  { fecharForm(card); return; }
      if (e.target.closest('[data-confirmar]')) { confirmar(card, k); return; }
    });
    el._clLigado = true;
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (!ehLogistica()) return;
    if (!host()) return;
    carregar();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(carregar, INTERVALO_MS);
  }

  // ── Ganchos do lápis (shared/js/comparacao-card.js) ─────────────
  // Com eles definidos, o lápis da célula "Você" funciona aqui igual ao do
  // admin — é por isso que a regra que o escondia saiu do comparacao.css.
  //
  // O cmpAposSalvarPreco daqui NÃO traz o convite do GA. No admin ele é um
  // window.confirm no meio do fluxo; aqui o operador já escolhe o combustível
  // no select do formulário, e um modal brigaria com isso. Quem quiser mexer
  // no GA pela Logística escolhe GA na lista.
  //
  // Fora do init() de propósito: os ganchos só precisam existir, e deixá-los
  // atrás do teste de perfil os faria faltar caso o init saísse antes.
  window.cmpDadoDoPosto = (k) => (_comp ? _comp[k] : null);

  window.cmpAposSalvarPreco = () => {
    carregar();                 // redesenha a seção com o preço novo
    window.__slRefresh?.();     // e força um poll da lista de pendentes
  };

  window.comparacaoLogistica = { recarregar: carregar };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
