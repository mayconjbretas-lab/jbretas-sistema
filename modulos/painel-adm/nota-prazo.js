// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/nota-prazo.js
// Sub-vista "Nota prazo" da aba Financeiro do Painel ADM (desktop).
// ADITIVO: expõe window.renderNotaPrazo(el), chamado pelo finAbrir() —
// mesmo padrão do renderAppCupons / renderDre / renderMovPostos.
//
// SUBSTITUI O PLACEHOLDER, NÃO O ROTEAMENTO. O FIN_VISTAS, o hash
// (#financeiro/nota-prazo) e os três sub-botões continuam como estavam; o
// app.js ganhou UMA linha (`render:`) no mapa, e Banco e Clientes seguem no
// "em construção" de antes.
//
// FONTES (todas com guard ehAdm, todas em server.js):
//   GET  /nota-prazo/dashboard                    cards + lista de postos
//   GET  /nota-prazo/fechamentos?status&ciclo&de&ate
//   GET  /nota-prazo/clientes                     selects + saldo por cliente
//   GET  /nota-prazo/extrato/:cliente_id?de&ate   expandir um fechamento
//   POST /nota-prazo/fechamento/:id/pagar
//   POST /nota-prazo/cliente                      cadastrar/editar
//   POST /nota-prazo/lancamento                   lançar nota do bloco
//   POST /nota-prazo/fechar                       gerar fechamento do período
//
// DEPENDE DE MIGRAÇÃO: sql/nota_prazo.sql. Sem ela as rotas devolvem 503 com
// a mensagem pronta, e a tela mostra ESSA mensagem — não um erro cru. É o
// estado em que a tela nasce, antes de o SQL ser aplicado.
//
// ════════ TABELA VAZIA NÃO É ERRO ════════
// Esta tela nasce sobre quatro tabelas sem uma linha. Todo bloco tem estado
// vazio próprio e explícito ("Nenhum fechamento", "Cadastre o primeiro
// cliente"), e os cards mostram R$ 0,00 — e não "—". Zero a receber é uma
// informação; travessão seria "não sei", que é outra coisa.
//
// ════════ O QUE A TELA NÃO CALCULA ════════
// ATRASADO não é derivado aqui de "venceu e não pagou": o prazo de pagamento
// acordado não está no banco (ver o comentário da tabela em
// sql/nota_prazo.sql). A tela MOSTRA o status gravado. Se ela deduzisse,
// todo cliente com prazo de 10 dias apareceria em vermelho no dia seguinte
// ao corte.
//
// ════════ "IMPORTAR RELATÓRIO TECNOX" ════════
// O botão está na tela, como pedido, e abre o formulário com seletor de
// cliente e de bloco. O que ele grava hoje é UMA nota por vez, pela
// POST /nota-prazo/lancamento — não há rota de importação de arquivo da
// TecnoX especificada, e inventar um parser de relatório aqui seria decidir
// sozinho o formato do arquivo. O formulário está pronto para receber o
// lote quando essa rota existir: é só ele passar a mandar um array.
//
// Tema Premium via os tokens já existentes (--tx/--ac/--sf/--bd/--dg/--ok),
// resolvidos pela camada de alias do painel-adm.css. Nenhum token novo.
// ================================================================
(function () {
  'use strict';

  // Mesmo guard da rota. Sem isto a tela chamaria a API para um perfil que
  // leva 403 e mostraria o erro do servidor como se fosse falha.
  var PERFIS_VEEM = ['ADM'];

  var CICLOS = ['QUINZENAL', 'MENSAL'];
  var TIPOS = ['VIP', 'FROTA', 'PRAZO'];
  // Cor por status, num mapa e não num if/else: uma linha por status, e
  // badge, card e legenda leem daqui. Os pares são fundo/texto com contraste
  // conferido nos dois temas — o mesmo desenho do .ap-so do app-cupons.js.
  var STATUS = {
    ABERTO:   { rot: 'ABERTO',   fundo: '#FAEEDA', cor: '#7A4E06', borda: '#C98A1E' },
    PAGO:     { rot: 'PAGO',     fundo: '#E1F5EE', cor: '#085041', borda: '#0F6E56' },
    ATRASADO: { rot: 'ATRASADO', fundo: '#FBE6E6', cor: '#7A1212', borda: '#B32020' },
  };

  var _el = null;          // o #fin-corpo, dono do conteúdo
  var _pronto = false;
  var _dash = null;
  var _fech = null;
  var _clientes = null;
  var _erro = '';
  var _carregando = false;
  var _seq = 0;
  // Filtros. Período VAZIO por padrão (= tudo): a tela nasce sem dado, e um
  // recorte de mês corrente mostraria "nenhum fechamento" sobre uma tabela
  // que talvez tenha o ano inteiro.
  var _fCiclo = '';
  var _fStatus = '';
  var _fDe = '';
  var _fAte = '';
  // Fechamento expandido: id -> { carregando, erro, lancamentos }
  var _aberto = '';
  var _extrato = {};
  // Formulário aberto: '' | 'cliente' | 'lancamento' | 'fechar'
  var _form = '';
  var _formErro = '';
  var _formOk = '';
  var _formSalvando = false;
  // Prévia do "Fechar período" (o dry_run da POST /nota-prazo/fechar).
  var _previa = null;

  // ── Importação do relatório TecnoX ──
  // A PLANILHA VIVE AQUI ATÉ A CONFIRMAÇÃO. Ler o arquivo não grava nada: o
  // parse fica em _imp, a tela mostra o resumo, e só o clique em "Importar"
  // manda para a rota. É o mesmo desenho do "Fechar período" (prévia antes de
  // gerar cobrança) e pela mesma razão — isto cria conta a receber.
  var _imp = null;         // o que o parser devolveu
  var _impErro = '';
  var _impLendo = false;
  var _impSalvando = false;
  var _impOk = null;       // a resposta da rota, depois de gravar

  // ── Formatação (reusa o mmFmt, como o app-cupons) ───────────────
  function nf(v, casas) {
    if (window.mmFmt && window.mmFmt.nf) return window.mmFmt.nf(v, casas);
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  function esc(s) {
    if (window.mmFmt && window.mmFmt.esc) return window.mmFmt.esc(s);
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // R$ 0,00 e não "—" no zero: ver o bloco "TABELA VAZIA NÃO É ERRO".
  // Só null/undefined viram travessão, porque aí de fato não há número.
  function reais(v) { return (v === null || v === undefined) ? '—' : 'R$ ' + nf(v, 2); }
  function litros(v) { return (v === null || v === undefined || v === '') ? '—' : nf(v, 3) + ' L'; }
  function dataBR(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : String(iso);
  }
  function periodo(de, ate) { return dataBR(de) + ' → ' + dataBR(ate); }
  function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
  // "17/09 às 15:42". FUSO DE BRASÍLIA explícito: criado_em é timestamptz e
  // vem em UTC; sem o timeZone, quem abrir a tela de outro fuso lê a hora
  // dele para um evento que aconteceu no horário do escritório.
  function quandoBR(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var o = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' };
    var hm = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', o) + ' às ' + hm;
  }
  function primeiroDoMes() { return hojeISO().slice(0, 8) + '01'; }

  // ── CSS (injetado uma vez, escopo .np-*) ────────────────────────
  // Fora do painel-adm.css pelo mesmo motivo do app-cupons: folha
  // compartilhada é onde um seletor novo encosta no antigo sem querer.
  function injetarEstilo() {
    if (document.getElementById('nota-prazo-style')) return;
    var st = document.createElement('style');
    st.id = 'nota-prazo-style';
    st.textContent =
      // TETO DE 1400px E CENTRADO, como a tela App. O #fin-corpo é um DIV
      // comum dentro da #s-financeiro (que já é display:block) — quem
      // centraliza é este wrap, com margin auto.
      '.np-wrap{display:flex;flex-direction:column;max-width:1400px;margin:0 auto}' +
      // CARDS — 150×96 e gap 12, as medidas da Movimentação e da tela App.
      '.np-cards{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:12px;margin-bottom:20px}' +
      '.np-card{flex:0 0 auto;box-sizing:border-box;width:150px;height:96px;display:flex;' +
        'flex-direction:column;justify-content:center;gap:2px;padding:.5rem .6rem;text-align:left;' +
        'background:var(--sf2);border:1px solid var(--bd);border-radius:10px;' +
        'position:relative;font:inherit;color:var(--tx)}' +
      // A cor mora numa borda ESQUERDA de 3px, não no fundo do card: fundo
      // colorido em seis cards lado a lado vira semáforo e some a hierarquia
      // do número, que é o que se lê.
      '.np-card.v{border-left:3px solid #0F6E56}' +
      '.np-card.a{border-left:3px solid #1D5FA8}' +
      '.np-card.r{border-left:3px solid #B32020}' +
      '.np-rot{font:700 .58rem var(--mono);letter-spacing:.06em;color:var(--tx3);text-transform:uppercase}' +
      '.np-num{font:700 1.05rem var(--sans);line-height:1.1}' +
      // 1rem nos cards de dinheiro da linha de baixo: "R$ 1.234.567,89" a
      // 1.05rem estourava os 150px do card e quebrava em duas linhas.
      '.np-num.mn{font-size:.95rem}' +
      '.np-sub{font:.6rem var(--mono);color:var(--tx3)}' +
      // BARRA de filtros e ações.
      '.np-barra{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:16px}' +
      '.np-grupo{display:flex;align-items:center;gap:.35rem}' +
      '.np-lab{font:700 .62rem var(--mono);letter-spacing:.05em;color:var(--tx3);text-transform:uppercase}' +
      '.np-sel,.np-data,.np-txt{background:var(--sf2);border:1px solid var(--bd);border-radius:6px;' +
        'color:var(--tx);padding:.3rem .45rem;font:.72rem var(--mono)}' +
      '.np-txt{min-width:160px}' +
      '.np-btn{flex:0 0 auto;background:var(--sf2);border:1px solid var(--bd);border-radius:6px;' +
        'color:var(--tx2);padding:.3rem .7rem;font:700 .68rem var(--mono);cursor:pointer}' +
      '.np-btn:hover{color:var(--tx);border-color:var(--ac)}' +
      '.np-btn.on{background:var(--acd);border-color:var(--ac);color:var(--ac)}' +
      '.np-btn.pri{background:var(--ac);border-color:var(--ac);color:#0a0d0f}' +
      '.np-btn[disabled]{opacity:.45;cursor:not-allowed}' +
      '.np-btn[disabled]:hover{color:var(--tx2);border-color:var(--bd)}' +
      '.np-acoes{display:flex;flex-wrap:wrap;gap:.5rem;margin-left:auto}' +
      // LISTA — seis colunas fixas, sem 1fr. Mesma razão da Movimentação e da
      // tela App: com fração os números fogem para a borda do monitor e
      // ficam longe do nome do cliente.
      // 300 + 110 + 210 + 150 + 120 + 110 = 1000px de conteúdo.
      '.np-lista{display:flex;flex-direction:column;margin-top:0}' +
      '.np-cab,.np-linha{display:grid;grid-template-columns:300px 110px 210px 150px 120px 110px;' +
        'justify-content:start;align-items:center;gap:.7rem 8px;width:100%;padding:10px 0;' +
        'background:transparent;border:0;text-align:left;font:inherit;color:var(--tx)}' +
      '.np-cab{padding:0 0 5px;border-bottom:1px solid var(--bd)}' +
      '.np-cab span{font:700 .58rem var(--mono);letter-spacing:.05em;color:var(--tx3);text-transform:uppercase}' +
      '.np-linha{cursor:pointer;border-bottom:1px solid var(--bd)}' +
      '.np-linha:hover{background:color-mix(in srgb,var(--ac) 7%,transparent)}' +
      '.np-linha.aberta{background:color-mix(in srgb,var(--ac) 10%,transparent)}' +
      '.np-nome{font-size:.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.np-cel{font:.74rem var(--mono);color:var(--tx2)}' +
      '.np-val{font:700 .78rem var(--mono);text-align:right}' +
      // BADGE de status. inline-block com largura mínima para as três
      // palavras ocuparem o mesmo bloco e a coluna não dançar.
      '.np-badge{display:inline-block;min-width:78px;text-align:center;border-radius:999px;' +
        'padding:.15rem .5rem;font:700 .6rem var(--mono);letter-spacing:.04em;border:1px solid transparent}' +
      // DETALHE do fechamento expandido.
      '.np-det{padding:10px 0 16px;border-bottom:1px solid var(--bd);' +
        'background:color-mix(in srgb,var(--ac) 4%,transparent)}' +
      '.np-det-cab,.np-det-linha{display:grid;' +
        'grid-template-columns:100px 120px 200px 140px 110px 120px;' +
        'justify-content:start;align-items:center;gap:.5rem 8px;padding:5px 0 5px 16px}' +
      '.np-det-cab span{font:700 .55rem var(--mono);letter-spacing:.05em;color:var(--tx3);text-transform:uppercase}' +
      '.np-det-linha{font:.7rem var(--mono);color:var(--tx2);border-top:1px solid var(--bd)}' +
      '.np-det-tot{padding:8px 0 0 16px;font:700 .72rem var(--mono);color:var(--tx)}' +
      // FORMULÁRIOS — painel que abre acima da lista, não modal: o modal
      // esconderia justamente os cards e a lista que dizem se o lançamento
      // faz sentido.
      '.np-form{border:1px solid var(--ac);border-radius:10px;padding:14px;margin-bottom:18px;' +
        'background:var(--sf2)}' +
      '.np-form h4{margin:0 0 4px;font:700 .8rem var(--sans);color:var(--tx)}' +
      '.np-form-dica{font:.66rem var(--mono);color:var(--tx3);margin:0 0 12px}' +
      '.np-campos{display:flex;flex-wrap:wrap;gap:10px 14px}' +
      '.np-campo{display:flex;flex-direction:column;gap:3px}' +
      '.np-campo.larga .np-txt{min-width:340px}' +
      '.np-form-pe{display:flex;align-items:center;gap:.5rem;margin-top:14px}' +
      '.np-msg{font:.7rem var(--mono);padding:.3rem 0}' +
      '.np-msg.erro{color:var(--dg)}' +
      '.np-msg.ok{color:#0F6E56}' +
      // ESTADOS — vazio, carregando e erro. Todos com texto próprio; ver o
      // bloco "TABELA VAZIA NÃO É ERRO" no topo.
      '.np-estado{padding:28px 0;text-align:center;font:.76rem var(--mono);color:var(--tx3)}' +
      '.np-estado b{display:block;font:700 .84rem var(--sans);color:var(--tx2);margin-bottom:5px}' +
      '.np-erro{padding:14px;border:1px solid var(--dg);border-radius:8px;' +
        'font:.74rem var(--mono);color:var(--dg);margin-bottom:16px}' +
      // MOBILE: esta é tela de desktop (o painel-adm inteiro é), mas o
      // overflow-x mantém a lista legível num notebook estreito em vez de
      // espremer as seis colunas fixas.
      '@media (max-width:1100px){.np-lista,.np-det{overflow-x:auto}}';
    document.head.appendChild(st);
  }

  // ── Dados ───────────────────────────────────────────────────────
  // Uma função para as três chamadas de abertura. O _seq descarta resposta
  // de clique anterior, como no app-cupons.
  async function carregar() {
    _carregando = true; _erro = ''; pintar();
    var meu = ++_seq;
    try {
      var qs = [];
      if (_fStatus) qs.push('status=' + encodeURIComponent(_fStatus));
      if (_fCiclo) qs.push('ciclo=' + encodeURIComponent(_fCiclo));
      if (_fDe) qs.push('de=' + encodeURIComponent(_fDe));
      if (_fAte) qs.push('ate=' + encodeURIComponent(_fAte));
      var r = await Promise.all([
        apiFetch('/nota-prazo/dashboard'),
        apiFetch('/nota-prazo/fechamentos' + (qs.length ? '?' + qs.join('&') : '')),
        apiFetch('/nota-prazo/clientes'),
      ]);
      if (meu !== _seq) return;
      _dash = r[0]; _fech = r[1]; _clientes = r[2];
    } catch (e) {
      if (meu !== _seq) return;
      _dash = null; _fech = null; _clientes = null;
      _erro = (e && e.message) ? e.message : 'Falha ao carregar';
    } finally {
      if (meu === _seq) { _carregando = false; pintar(); }
    }
  }

  // Só a lista, para quando muda filtro: os cards não dependem do recorte
  // (eles falam da rede inteira) e recarregá-los faria o topo piscar.
  async function recarregarLista() {
    var meu = ++_seq;
    try {
      var qs = [];
      if (_fStatus) qs.push('status=' + encodeURIComponent(_fStatus));
      if (_fCiclo) qs.push('ciclo=' + encodeURIComponent(_fCiclo));
      if (_fDe) qs.push('de=' + encodeURIComponent(_fDe));
      if (_fAte) qs.push('ate=' + encodeURIComponent(_fAte));
      var r = await apiFetch('/nota-prazo/fechamentos' + (qs.length ? '?' + qs.join('&') : ''));
      if (meu !== _seq) return;
      _fech = r; _erro = '';
    } catch (e) {
      if (meu !== _seq) return;
      _erro = (e && e.message) ? e.message : 'Falha ao carregar';
    }
    if (meu === _seq) pintar();
  }

  // Extrato do período do fechamento. O recorte é o período DELE, não o do
  // filtro da tela: expandir uma cobrança mostra o que ELA cobra.
  async function carregarExtrato(f) {
    if (_extrato[f.id] && _extrato[f.id].lancamentos) { pintar(); return; }
    _extrato[f.id] = { carregando: true, erro: '', lancamentos: null };
    pintar();
    try {
      var r = await apiFetch('/nota-prazo/extrato/' + encodeURIComponent(f.cliente_id) +
        '?de=' + encodeURIComponent(f.periodo_de) + '&ate=' + encodeURIComponent(f.periodo_ate));
      _extrato[f.id] = { carregando: false, erro: '', lancamentos: r.lancamentos || [], resumo: r };
    } catch (e) {
      _extrato[f.id] = { carregando: false, erro: (e && e.message) || 'Falha ao carregar', lancamentos: null };
    }
    pintar();
  }

  // ── SheetJS sob demanda ─────────────────────────────────────────
  // 860 KB que só quem importa precisa. SEGUNDA CÓPIA deste carregador no
  // repositório (a outra está em app-cupons.js, para a planilha da Soutag), e
  // de propósito: o guard `window.XLSX` faz a segunda chamada reaproveitar a
  // biblioteca que a primeira baixou, então a duplicação custa 20 linhas e
  // não um download. Extrair para shared/js exigiria editar o app-cupons, que
  // está em mão de outra frente agora.
  var _xlsxPromessa = null;
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  function carregarXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_xlsxPromessa) return _xlsxPromessa;
    _xlsxPromessa = new Promise(function (ok, erro) {
      var sc = document.createElement('script');
      sc.src = XLSX_URL;
      sc.onload = function () {
        if (window.XLSX) ok(window.XLSX);
        else erro(new Error('a biblioteca de planilha carregou sem se registrar'));
      };
      sc.onerror = function () {
        _xlsxPromessa = null;   // deixa tentar de novo depois
        erro(new Error('não foi possível baixar a biblioteca de planilha (precisa de internet)'));
      };
      document.head.appendChild(sc);
    });
    return _xlsxPromessa;
  }

  // ── O relatório de faturas da TecnoX ────────────────────────────
  // ESTRUTURA MEDIDA nos três arquivos de agosto/2026 (502, 512 e 517 linhas):
  //
  //   L1        título | período | gerado          (3 células)
  //   L2        "Empresas selecionadas"
  //   L3-L48    as 46 empresas do filtro, uma por linha, só coluna A
  //   L49-L50   vazias
  //   L51       CABEÇALHO: Seq. Emissão Vencimento Doc. Cód Cliente Tipo
  //             Placa KM R$ Bruto Acrés. Desc. Juros Multa Taxa R$ Liquido
  //             Data PG R$ Pago Situação PG                (19 colunas)
  //   L52+      grupo (2 células) → dados (17) → "Total Empresa:" (13), e
  //             repete por coligada
  //   penúltima "Total Geral:"                             (12 células)
  //   última    "© Tecno X Sistemas | Página -1 de 1"      (2 células)
  //
  // O CABEÇALHO NÃO ESTÁ NA LINHA 1 e a linha dele NÃO é fixa: o preâmbulo
  // tem o tamanho da lista de empresas selecionadas, que muda com o filtro de
  // quem exporta. Quem acha o cabeçalho é a célula A = "Seq.".
  //
  // ════════ TRÊS LAYOUTS DE COLUNA NO MESMO ARQUIVO ════════
  // Na linha de dados o líquido está em P; no "Total Empresa:" está em L; no
  // "Total Geral:" está em K. Ler o total pelo índice da linha de dados traz
  // número errado sem nenhum sintoma — é por isso que as linhas de total são
  // tratadas à parte, e só o Total Geral é lido, com os índices dele.
  //
  // ════════ O RODAPÉ SE DISFARÇA DE GRUPO ════════
  // "© Tecno X Sistemas" também tem 2 células preenchidas. O que separa um do
  // outro é a coluna A: no grupo ela é o CÓDIGO NUMÉRICO da coligada.
  var IMP_TITULO = /FATURAS?\s+POR\s+DATA\s+DE\s+EMISS[ÃA]O/i;
  var IMP_OUTRO = /POR\s+DATA\s+DE\s+(LIQUIDA[ÇC][ÃA]O|VENCIMENTO)/i;
  // Mesmo mapa da rota. Situação fora destas três não entra: um "Cancelado"
  // adivinhado como ABERTO viraria conta a receber que ninguém deve.
  var IMP_SIT = { 'PG TOTAL': 'PAGO', 'PG PARCIAL': 'ABERTO', 'ABERTO': 'ABERTO' };
  // Índices das colunas de DADOS (A=0). As mortas ficam de fora: Placa e KM
  // vieram 100% vazias nos três arquivos, e Acrés./Desc./Multa/Taxa sempre 0.
  var IMP_COL = { seq: 0, emissao: 1, vencimento: 2, doc: 3, cod: 4, cliente: 5,
                  bruto: 9, juros: 12, liquido: 15, data_pg: 16, pago: 17, situacao: 18 };
  // Índices do "Total Geral:" — outro layout, ver acima.
  var IMP_TG = { qtd: 3, bruto: 4, juros: 7, liquido: 10, pago: 11 };

  function impTxt(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function impCheia(l) {
    var n = 0;
    for (var i = 0; i < (l || []).length; i++) if (l[i] !== null && l[i] !== '') n++;
    return n;
  }
  // COMPONENTES LOCAIS da Date, não toISOString(): o SheetJS monta a data com
  // `new Date(ano, mes, dia)` em horário local, e toISOString() num fuso a
  // leste de Greenwich devolveria o dia anterior. Serial e texto dd/mm/aaaa
  // também aparecem, dependendo de como a planilha foi salva.
  function impData(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
    }
    if (typeof v === 'number' && isFinite(v)) {
      // 25569 = 1970-01-01 no serial do Excel (base 1899-12-30, com o ano
      // bissexto fantasma de 1900 que o Excel mantém por compatibilidade).
      var d = new Date(Math.round((v - 25569) * 86400000));
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    }
    var t = String(v).trim();
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
    if (br) {
      var ano = br[3].length === 2 ? ('20' + br[3]) : br[3];
      return ano + '-' + ('0' + br[2]).slice(-2) + '-' + ('0' + br[1]).slice(-2);
    }
    return '';
  }
  function impNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var t = String(v === null || v === undefined ? '' : v).replace(/[^0-9,.-]/g, '');
    if (t === '') return NaN;
    // pt-BR: ponto é milhar, vírgula é decimal. "1.234,56" -> 1234.56
    if (t.indexOf(',') >= 0) t = t.split('.').join('').split(',').join('.');
    var n = Number(t);
    return isFinite(n) ? n : NaN;
  }

  function lerRelatorio(XLSX, buffer, nomeArquivo) {
    var wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    var aba = wb.SheetNames[0];
    if (!aba) throw new Error('a planilha não tem nenhuma aba');
    var aoa = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null, blankrows: true });
    if (!aoa.length) throw new Error('a primeira aba está vazia');

    var titulo = impTxt((aoa[0] || [])[0]).replace(/\s+/g, ' ');
    var outro = IMP_OUTRO.exec(titulo);
    if (outro) {
      throw new Error('Esta é a planilha por ' + (/LIQUIDA/i.test(outro[1]) ? 'LIQUIDAÇÃO' : 'VENCIMENTO') +
        '. Exporte "FATURAS POR DATA DE EMISSÃO" — os três relatórios têm o mesmo cabeçalho e conteúdo diferente.');
    }
    if (!IMP_TITULO.test(titulo)) {
      throw new Error('A célula A1 não é o título do relatório de faturas por emissão. Achei: "' +
        (titulo || '(vazia)') + '"');
    }

    var ic = -1;
    for (var i = 0; i < aoa.length; i++) {
      if (impTxt((aoa[i] || [])[0]) === 'Seq.') { ic = i; break; }
    }
    if (ic < 0) throw new Error('não achei a linha de cabeçalho (nenhuma célula A com "Seq.")');

    // O preâmbulo: as empresas do filtro. Vão para o resumo porque a
    // diferença entre elas e os grupos COM movimento é informação — 46
    // selecionadas e 33 com fatura, nos arquivos medidos.
    var empresas = [];
    for (var e = 2; e < ic; e++) {
      var nomeE = impTxt((aoa[e] || [])[0]);
      if (nomeE) empresas.push(nomeE);
    }

    var faturas = [], grupos = [], ignoradas = 0;
    var totalGeral = null;
    var grupoCod = '', grupoNome = '';
    for (var r = ic + 1; r < aoa.length; r++) {
      var l = aoa[r] || [];
      var q = impCheia(l);
      if (!q) continue;
      var a0 = impTxt(l[0]);
      if (a0 === 'Total Empresa:') continue;              // outro layout, ver acima
      if (a0 === 'Total Geral:') {
        totalGeral = {
          qtd_titulos: impNum(l[IMP_TG.qtd]),
          bruto: impNum(l[IMP_TG.bruto]),
          juros: impNum(l[IMP_TG.juros]),
          liquido: impNum(l[IMP_TG.liquido]),
          pago: impNum(l[IMP_TG.pago]),
        };
        continue;
      }
      if (q === 2) {
        // Grupo se A é código numérico; senão é o rodapé.
        if (/^\d+$/.test(a0)) {
          grupoCod = a0; grupoNome = impTxt(l[1]);
          grupos.push({ cod: grupoCod, nome: grupoNome, faturas: 0, total: 0 });
        }
        continue;
      }
      // Linha de dados de verdade tem Situação PG. É o que separa dado de
      // qualquer linha de resumo que o relatório venha a ganhar.
      var sit = impTxt(l[IMP_COL.situacao]).replace(/\s+/g, ' ').toUpperCase();
      if (!sit) { ignoradas++; continue; }
      var liq = impNum(l[IMP_COL.liquido]);
      var emi = impData(l[IMP_COL.emissao]);
      var ven = impData(l[IMP_COL.vencimento]);
      var seq = impTxt(l[IMP_COL.seq]);
      var status = IMP_SIT[sit] || null;
      if (!seq || !emi || !ven || !isFinite(liq) || !status) { ignoradas++; continue; }
      var f = {
        seq: seq,
        doc: impTxt(l[IMP_COL.doc]),
        cod: impTxt(l[IMP_COL.cod]),
        cliente: impTxt(l[IMP_COL.cliente]),
        emissao: emi,
        vencimento: ven,
        bruto: isFinite(impNum(l[IMP_COL.bruto])) ? impNum(l[IMP_COL.bruto]) : null,
        juros: isFinite(impNum(l[IMP_COL.juros])) ? impNum(l[IMP_COL.juros]) : 0,
        liquido: liq,
        data_pg: impData(l[IMP_COL.data_pg]) || null,
        pago: isFinite(impNum(l[IMP_COL.pago])) ? impNum(l[IMP_COL.pago]) : null,
        situacao: impTxt(l[IMP_COL.situacao]),
        status: status,
        grupo_cod: grupoCod || null,
        grupo_nome: grupoNome || null,
      };
      faturas.push(f);
      var g = grupos[grupos.length - 1];
      if (g && g.cod === grupoCod) { g.faturas++; g.total += liq; }
    }
    if (!faturas.length) throw new Error('nenhuma linha de fatura legível abaixo do cabeçalho');

    // CENTAVOS na soma, como a rota: somar 383 numerics como float acumula
    // erro justamente no número que confere com o Total Geral.
    var cent = 0, clientes = {}, porStatus = { ABERTO: 0, PAGO: 0 }, dias = [];
    faturas.forEach(function (f) {
      cent += Math.round(f.liquido * 100);
      clientes[f.cod] = f.cliente;
      porStatus[f.status] = (porStatus[f.status] || 0) + 1;
      dias.push(f.emissao);
    });
    dias.sort();
    var total = cent / 100;
    var tg = totalGeral && isFinite(totalGeral.liquido) ? totalGeral.liquido : null;
    return {
      arquivo: nomeArquivo, titulo: titulo, aba: aba, linha_cabecalho: ic + 1,
      empresas: empresas, grupos: grupos, faturas: faturas,
      clientes: Object.keys(clientes).length,
      total: total, total_geral: tg, qtd_titulos: totalGeral ? totalGeral.qtd_titulos : null,
      por_status: porStatus, ignoradas: ignoradas,
      periodo: { de: dias[0], ate: dias[dias.length - 1] },
      // A CONFERÊNCIA, calculada aqui para a tela poder mostrar antes de
      // mandar: a rota refaz a mesma conta e recusa a gravação se não fechar.
      fecha: tg === null ? null : Math.abs(cent - Math.round(tg * 100)) <= 1,
      diferenca: tg === null ? null : (cent - Math.round(tg * 100)) / 100,
    };
  }

  // ── HTML: cards ─────────────────────────────────────────────────
  function htmlCards() {
    var d = _dash || {};
    var pc = d.por_ciclo || {};
    var q = pc.QUINZENAL || { clientes: 0, aberto: 0 };
    var m = pc.MENSAL || { clientes: 0, aberto: 0 };
    function card(cls, rot, num, sub, mn) {
      return '<div class="np-card' + (cls ? ' ' + cls : '') + '">' +
        '<span class="np-rot">' + esc(rot) + '</span>' +
        '<span class="np-num' + (mn ? ' mn' : '') + '">' + esc(num) + '</span>' +
        '<span class="np-sub">' + esc(sub) + '</span></div>';
    }
    return '<div class="np-cards">' +
      card('v', 'Total a receber', reais(d.total_a_receber), (d.qtd_aberto || 0) + ' ab. + ' + (d.qtd_atrasado || 0) + ' atr.', true) +
      card('a', 'Total recebido', reais(d.total_recebido_mes), 'no mês, ' + (d.qtd_pago_mes || 0) + ' pagos', true) +
      card('r', 'Total atrasado', reais(d.total_atrasado), (d.qtd_atrasado || 0) + ' cobranças', true) +
      card('', 'Clientes ativos', String(d.clientes_ativos || 0), 'com cadastro') +
      card('', 'Quinzenal', String(q.clientes || 0), reais(q.aberto) + ' aberto') +
      card('', 'Mensal', String(m.clientes || 0), reais(m.aberto) + ' aberto') +
      '</div>' +
      // O aviso do fechamento órfão. Só aparece quando existe — ver
      // `aberto_sem_ciclo` na GET /nota-prazo/dashboard: é a diferença entre
      // o card de cima e a soma dos dois de baixo, e sem esta linha ela
      // seria um rombo invisível.
      (d.aberto_sem_ciclo ? '<div class="np-msg erro">⚠ ' + reais(d.aberto_sem_ciclo) +
        ' em aberto de cliente inativo ou removido — está no "total a receber" e fora dos ciclos.</div>' : '') +
      // ÚLTIMA IMPORTAÇÃO — vem do dashboard (max criado_em das faturas com
      // observação "Seq: %"), então sobrevive ao recarregar a página. O nome
      // de quem importou só aparece se a coluna opcional importado_por existir
      // (ver sql/nota_prazo_importacao.sql); sem ela, data e quantidade.
      (d.ultima_importacao ? '<div class="np-msg">Última importação: ' +
        esc(quandoBR(d.ultima_importacao.quando)) + ' · ' + nf(d.ultima_importacao.faturas, 0) +
        ' fatura' + (d.ultima_importacao.faturas === 1 ? '' : 's') +
        (d.ultima_importacao.por ? ' · importado por ' + esc(d.ultima_importacao.por) : '') +
        '</div>' : '');
  }

  // ── HTML: barra de filtros e ações ──────────────────────────────
  function opts(lista, sel, rotTodos) {
    var h = '<option value=""' + (sel === '' ? ' selected' : '') + '>' + esc(rotTodos) + '</option>';
    lista.forEach(function (v) {
      h += '<option value="' + esc(v) + '"' + (sel === v ? ' selected' : '') + '>' + esc(v.charAt(0) + v.slice(1).toLowerCase()) + '</option>';
    });
    return h;
  }
  function htmlBarra() {
    return '<div class="np-barra">' +
      '<div class="np-grupo"><span class="np-lab">Ciclo</span>' +
        '<select class="np-sel" onchange="__npFiltro(\'ciclo\',this.value)">' + opts(CICLOS, _fCiclo, 'Todos') + '</select></div>' +
      '<div class="np-grupo"><span class="np-lab">Status</span>' +
        '<select class="np-sel" onchange="__npFiltro(\'status\',this.value)">' + opts(Object.keys(STATUS), _fStatus, 'Todos') + '</select></div>' +
      '<div class="np-grupo"><span class="np-lab">Período</span>' +
        '<input class="np-data" type="date" value="' + esc(_fDe) + '" onchange="__npFiltro(\'de\',this.value)">' +
        '<span class="np-lab">até</span>' +
        '<input class="np-data" type="date" value="' + esc(_fAte) + '" onchange="__npFiltro(\'ate\',this.value)">' +
        '<button class="np-btn" type="button" onclick="__npLimpar()">Limpar</button></div>' +
      '<div class="np-acoes">' +
        '<button class="np-btn' + (_form === 'cliente' ? ' on' : '') + '" type="button" onclick="__npForm(\'cliente\')">Novo cliente</button>' +
        // ESTE BOTÃO DIZIA "Importar relatório TecnoX" e abria o formulário de
        // lançamento manual — o rótulo prometia o que a tela não fazia. Voltou
        // ao nome da ação dele; quem importa é o vizinho.
        '<button class="np-btn' + (_form === 'lancamento' ? ' on' : '') + '" type="button" onclick="__npForm(\'lancamento\')">Novo lançamento</button>' +
        '<button class="np-btn' + (_form === 'importar' ? ' on' : '') + '" type="button" onclick="__npForm(\'importar\')">Importar relatório TecnoX</button>' +
        '<button class="np-btn pri' + (_form === 'fechar' ? ' on' : '') + '" type="button" onclick="__npForm(\'fechar\')">Fechar período</button>' +
      '</div></div>';
  }

  // ── HTML: lista de fechamentos ──────────────────────────────────
  function htmlBadge(st) {
    var s = STATUS[st] || { rot: st || '—', fundo: 'transparent', cor: 'var(--tx3)', borda: 'var(--bd)' };
    return '<span class="np-badge" style="background:' + s.fundo + ';color:' + s.cor +
      ';border-color:' + s.borda + '">' + esc(s.rot) + '</span>';
  }
  function htmlDetalhe(f) {
    var e = _extrato[f.id];
    if (!e) return '';
    if (e.carregando) return '<div class="np-det"><div class="np-estado">carregando lançamentos…</div></div>';
    if (e.erro) return '<div class="np-det"><div class="np-estado">' + esc(e.erro) + '</div></div>';
    var ls = e.lancamentos || [];
    if (!ls.length) {
      // Fechamento com total e sem lançamento no período é sinal de que
      // alguém apagou ou remanejou nota DEPOIS de fechar. A tela diz isso em
      // vez de mostrar uma lista vazia e deixar parecer bug.
      return '<div class="np-det"><div class="np-estado"><b>Nenhum lançamento neste período</b>' +
        'A cobrança de ' + esc(reais(f.total)) + ' foi gerada, mas não há nota entre ' +
        esc(periodo(f.periodo_de, f.periodo_ate)) + '.</div></div>';
    }
    var h = '<div class="np-det"><div class="np-det-cab">' +
      '<span>Data</span><span>Nota</span><span>Posto</span><span>Combustível</span>' +
      '<span>Litros</span><span>Valor</span></div>';
    ls.forEach(function (l) {
      h += '<div class="np-det-linha">' +
        '<span>' + esc(dataBR(l.data)) + '</span>' +
        '<span>' + esc(l.numero_nota || '—') + (l.numero_bloco ? ' <small>(bl. ' + esc(l.numero_bloco) + ')</small>' : '') + '</span>' +
        '<span>' + esc(l.posto_nome || '—') + '</span>' +
        '<span>' + esc(l.combustivel || '—') + '</span>' +
        '<span>' + esc(litros(l.litros)) + '</span>' +
        '<span style="text-align:right">' + esc(reais(l.valor)) + '</span></div>';
    });
    // A soma dos lançamentos ao lado do total da cobrança. Quando divergem,
    // é aqui que se vê — e é a conferência que justifica poder expandir.
    var soma = (e.resumo && e.resumo.total_lancado) || 0;
    var bate = Math.round(soma * 100) === Math.round(Number(f.total) * 100);
    h += '<div class="np-det-tot">' + ls.length + ' lançamentos · soma ' + esc(reais(soma)) +
      ' · cobrança ' + esc(reais(f.total)) +
      (bate ? '' : ' <span style="color:var(--dg)">⚠ divergem em ' +
        esc(reais(Math.abs(soma - Number(f.total)))) + '</span>') + '</div></div>';
    return h;
  }
  function htmlLista() {
    var r = _fech || {};
    var ls = r.fechamentos || [];
    var cab = '<div class="np-cab"><span>Cliente</span><span>Ciclo</span><span>Período</span>' +
      '<span style="text-align:right">Total</span><span>Status</span><span>Ações</span></div>';
    if (!ls.length) {
      var filtrado = _fCiclo || _fStatus || _fDe || _fAte;
      return '<div class="np-lista">' + cab + '<div class="np-estado"><b>Nenhum fechamento</b>' +
        (filtrado ? 'Nenhuma cobrança casa com os filtros. Limpe-os para ver tudo.'
                  : 'Use "Fechar período" para gerar a primeira cobrança a partir dos lançamentos.') +
        '</div></div>';
    }
    var h = '<div class="np-lista">' + cab;
    ls.forEach(function (f) {
      var ab = _aberto === f.id;
      h += '<div class="np-linha' + (ab ? ' aberta' : '') + '" onclick="__npAbrir(\'' + esc(f.id) + '\')">' +
        '<span class="np-nome" title="' + esc(f.cliente_nome) + '">' + (ab ? '▾ ' : '▸ ') + esc(f.cliente_nome) + '</span>' +
        '<span class="np-cel">' + esc(f.ciclo || '—') + '</span>' +
        '<span class="np-cel">' + esc(periodo(f.periodo_de, f.periodo_ate)) + '</span>' +
        '<span class="np-val">' + esc(reais(f.total)) + '</span>' +
        '<span>' + htmlBadge(f.status) + '</span>' +
        // stopPropagation: o botão vive DENTRO da linha clicável, e sem isto
        // pagar também expandiria/fecharia o detalhe no mesmo clique.
        '<span>' + (f.status === 'PAGO'
          ? '<span class="np-cel">' + esc(dataBR(f.data_pagamento)) + '</span>'
          : '<button class="np-btn" type="button" onclick="event.stopPropagation();__npPagar(\'' + esc(f.id) + '\')">Pagar</button>') +
        '</span></div>';
      if (ab) h += htmlDetalhe(f);
    });
    h += '</div><div class="np-msg">' + ls.length + ' fechamentos · total ' + esc(reais(r.total)) + '</div>';
    return h;
  }

  // ── HTML: formulários ───────────────────────────────────────────
  function campo(rot, html) {
    return '<label class="np-campo"><span class="np-lab">' + esc(rot) + '</span>' + html + '</label>';
  }
  function selClientes(id, extra) {
    var ls = (_clientes && _clientes.clientes) || [];
    var h = '<select class="np-sel" id="' + id + '"' + (extra || '') + '><option value="">— escolha —</option>';
    ls.forEach(function (c) {
      h += '<option value="' + esc(c.id) + '">' + esc(c.nome) + ' (' + esc(c.ciclo) + ')</option>';
    });
    return h + '</select>';
  }
  function selPostos(id) {
    var ls = (_dash && _dash.postos) || [];
    var h = '<select class="np-sel" id="' + id + '"><option value="">— nenhum —</option>';
    ls.forEach(function (p) { h += '<option value="' + esc(p.id) + '">' + esc(p.nome) + '</option>'; });
    return h + '</select>';
  }
  function msgForm() {
    if (_formErro) return '<div class="np-msg erro">' + esc(_formErro) + '</div>';
    if (_formOk) return '<div class="np-msg ok">' + esc(_formOk) + '</div>';
    return '';
  }
  function htmlFormCliente() {
    return '<div class="np-form"><h4>Novo cliente</h4>' +
      '<p class="np-form-dica">Nome, tipo e ciclo são obrigatórios. Sem postos marcados, o cliente vale em todos.</p>' +
      '<div class="np-campos">' +
      campo('Nome', '<input class="np-txt" id="np-c-nome" maxlength="200">') +
      campo('CPF / CNPJ', '<input class="np-txt" id="np-c-doc" maxlength="32">') +
      campo('Tipo', '<select class="np-sel" id="np-c-tipo">' + TIPOS.map(function (t) {
        return '<option value="' + t + '">' + t + '</option>'; }).join('') + '</select>') +
      // O dia de corte acompanha o ciclo (15 / 30) mas continua editável:
      // é referência de quem fecha, não regra automática.
      campo('Ciclo', '<select class="np-sel" id="np-c-ciclo" onchange="__npCorte(this.value)">' + CICLOS.map(function (c) {
        return '<option value="' + c + '">' + c.charAt(0) + c.slice(1).toLowerCase() + '</option>'; }).join('') + '</select>') +
      campo('Dia de corte', '<input class="np-data" id="np-c-corte" type="number" min="1" max="31" value="15" style="width:80px">') +
      campo('Limite de crédito', '<input class="np-data" id="np-c-limite" type="number" step="0.01" min="0" style="width:130px">') +
      campo('Telefone', '<input class="np-txt" id="np-c-tel" maxlength="40" style="min-width:130px">') +
      campo('E-mail', '<input class="np-txt" id="np-c-mail" maxlength="200">') +
      '<label class="np-campo larga"><span class="np-lab">Observação</span>' +
        '<input class="np-txt" id="np-c-obs" maxlength="2000"></label>' +
      '</div>' + msgForm() +
      '<div class="np-form-pe">' +
        '<button class="np-btn pri" type="button" onclick="__npSalvarCliente()"' + (_formSalvando ? ' disabled' : '') + '>' +
          (_formSalvando ? 'Salvando…' : 'Cadastrar') + '</button>' +
        '<button class="np-btn" type="button" onclick="__npForm(\'\')">Cancelar</button>' +
      '</div></div>';
  }
  function htmlFormLancamento() {
    // O seletor de BLOCO é preenchido pelo cliente escolhido (só os EM_USO
    // dele, que vêm na GET /nota-prazo/clientes). Antes de escolher cliente
    // ele fica vazio de propósito: listar bloco de todo mundo é exatamente
    // como a nota entra no cliente errado.
    return '<div class="np-form"><h4>Importar relatório TecnoX</h4>' +
      '<p class="np-form-dica">Lança uma nota do bloco. Cliente, data e valor são obrigatórios; ' +
      'o bloco é conferido contra o cliente pela API. Ainda não há rota de importação de arquivo — ' +
      'cada nota entra aqui uma a uma.</p>' +
      '<div class="np-campos">' +
      campo('Cliente', selClientes('np-l-cliente', ' onchange="__npBlocos(this.value)"')) +
      campo('Bloco', '<select class="np-sel" id="np-l-bloco"><option value="">— escolha o cliente —</option></select>') +
      campo('Posto', selPostos('np-l-posto')) +
      campo('Data', '<input class="np-data" id="np-l-data" type="date" value="' + esc(hojeISO()) + '">') +
      campo('Nº da nota', '<input class="np-txt" id="np-l-nota" maxlength="40" style="min-width:110px">') +
      campo('Combustível', '<input class="np-txt" id="np-l-comb" maxlength="60" style="min-width:130px">') +
      campo('Litros', '<input class="np-data" id="np-l-litros" type="number" step="0.001" min="0" style="width:110px">') +
      campo('Valor', '<input class="np-data" id="np-l-valor" type="number" step="0.01" min="0" style="width:120px">') +
      '<label class="np-campo larga"><span class="np-lab">Observação</span>' +
        '<input class="np-txt" id="np-l-obs" maxlength="1000"></label>' +
      '</div>' + msgForm() +
      '<div class="np-form-pe">' +
        '<button class="np-btn pri" type="button" onclick="__npSalvarLancamento()"' + (_formSalvando ? ' disabled' : '') + '>' +
          (_formSalvando ? 'Lançando…' : 'Lançar nota') + '</button>' +
        '<button class="np-btn" type="button" onclick="__npForm(\'\')">Cancelar</button>' +
      '</div></div>';
  }
  function htmlPrevia() {
    if (!_previa) return '';
    var p = _previa;
    if (!p.a_gerar) {
      return '<div class="np-msg erro">Nada a gerar em ' + esc(periodo(p.periodo.de, p.periodo.ate)) + '.' +
        (p.pulados && p.pulados.length ? ' ' + p.pulados.length + ' cliente(s) pulado(s): ' +
          esc(p.pulados.slice(0, 5).map(function (x) { return x.nome + ' — ' + x.motivo; }).join(' · ')) +
          (p.pulados.length > 5 ? ' …' : '') : '') + '</div>';
    }
    var h = '<div class="np-msg ok">' + p.a_gerar + ' fechamento(s), total ' + esc(reais(p.total)) + ':</div>' +
      '<div class="np-det"><div class="np-det-cab" style="grid-template-columns:300px 120px 120px 140px">' +
      '<span>Cliente</span><span>Ciclo</span><span>Notas</span><span>Total</span></div>';
    p.clientes.forEach(function (c) {
      h += '<div class="np-det-linha" style="grid-template-columns:300px 120px 120px 140px">' +
        '<span>' + esc(c.nome) + '</span><span>' + esc(c.ciclo) + '</span>' +
        '<span>' + c.quantidade + '</span><span>' + esc(reais(c.total)) + '</span></div>';
    });
    h += '</div>';
    if (p.pulados && p.pulados.length) {
      h += '<div class="np-msg">' + p.pulados.length + ' pulado(s): ' +
        esc(p.pulados.map(function (x) { return x.nome + ' (' + x.motivo + ')'; }).join(' · ')) + '</div>';
    }
    return h;
  }
  function htmlFormFechar() {
    // Padrão: do dia 1 até hoje. É o recorte que quem fecha vê primeiro, e
    // qualquer outro (quinzena, mês fechado) é ajuste de duas datas.
    return '<div class="np-form"><h4>Fechar período</h4>' +
      '<p class="np-form-dica">Gera uma cobrança por cliente com lançamentos no período. ' +
      'Confira a prévia antes — cliente já fechado neste mesmo período é pulado, não duplicado.</p>' +
      '<div class="np-campos">' +
      campo('Ciclo', '<select class="np-sel" id="np-f-ciclo"><option value="">Todos</option>' +
        CICLOS.map(function (c) { return '<option value="' + c + '"' + (_fCiclo === c ? ' selected' : '') + '>' +
          c.charAt(0) + c.slice(1).toLowerCase() + '</option>'; }).join('') + '</select>') +
      campo('De', '<input class="np-data" id="np-f-de" type="date" value="' + esc(primeiroDoMes()) + '">') +
      campo('Até', '<input class="np-data" id="np-f-ate" type="date" value="' + esc(hojeISO()) + '">') +
      '</div>' + msgForm() + htmlPrevia() +
      '<div class="np-form-pe">' +
        '<button class="np-btn" type="button" onclick="__npFechar(true)"' + (_formSalvando ? ' disabled' : '') + '>Ver prévia</button>' +
        '<button class="np-btn pri" type="button" onclick="__npFechar(false)"' +
          (_formSalvando || !_previa || !_previa.a_gerar ? ' disabled' : '') + '>' +
          (_previa && _previa.a_gerar ? 'Gerar ' + _previa.a_gerar + ' fechamento(s)' : 'Gerar') + '</button>' +
        '<button class="np-btn" type="button" onclick="__npForm(\'\')">Cancelar</button>' +
      '</div></div>';
  }
  // ── HTML: importar relatório ────────────────────────────────────
  function htmlImpResumo() {
    var p = _imp;
    var ab = p.por_status.ABERTO || 0, pg = p.por_status.PAGO || 0;
    var h = '<div class="np-msg ' + (p.fecha === false ? 'erro' : 'ok') + '">' +
      nf(p.clientes, 0) + ' cliente' + (p.clientes === 1 ? '' : 's') + ', ' +
      nf(p.faturas.length, 0) + ' fatura' + (p.faturas.length === 1 ? '' : 's') + ', ' +
      nf(ab, 0) + ' em aberto, ' + nf(pg, 0) + ' paga' + (pg === 1 ? '' : 's') +
      ' — total ' + esc(reais(p.total)) + '</div>' +
      '<div class="np-msg">Período de emissão: ' + esc(periodo(p.periodo.de, p.periodo.ate)) +
      ' · ' + esc(p.titulo) + '</div>';
    // A CONFERÊNCIA CONTRA O PRÓPRIO ARQUIVO. O relatório traz um "Total
    // Geral:" e ele tem de bater com a soma das linhas lidas ao centavo; não
    // batendo, o parser perdeu ou duplicou linha e a rota recusa a gravação.
    if (p.total_geral === null) {
      h += '<div class="np-msg erro">⚠ o arquivo não traz a linha "Total Geral:" — sem ela não há como conferir a soma.</div>';
    } else if (p.fecha) {
      h += '<div class="np-msg ok">✓ soma das linhas = Total Geral do arquivo (' + esc(reais(p.total_geral)) + ')' +
        (p.qtd_titulos && isFinite(p.qtd_titulos)
          ? ' · ' + nf(p.qtd_titulos, 0) + ' títulos declarados, ' + nf(p.faturas.length, 0) + ' lidos'
          : '') + '</div>';
    } else {
      h += '<div class="np-msg erro">⚠ a soma das linhas (' + esc(reais(p.total)) +
        ') NÃO fecha com o Total Geral do arquivo (' + esc(reais(p.total_geral)) +
        '), diferença ' + esc(reais(p.diferenca)) + '. A importação está bloqueada.</div>';
    }
    if (p.ignoradas) {
      h += '<div class="np-msg">' + nf(p.ignoradas, 0) + ' linha(s) ignorada(s) — sem situação, ' +
        'data ou valor legível (o relatório tem linhas de total e rodapé).</div>';
    }
    // AS COLIGADAS, que é o agrupamento do relatório e o que vai para a
    // observação de cada fatura (a futura aba Coligadas lê dali).
    var gs = p.grupos.filter(function (g) { return g.faturas > 0; });
    h += '<div class="np-msg">' + nf(gs.length, 0) + ' de ' + nf(p.empresas.length, 0) +
      ' empresas selecionadas têm fatura no período:</div>' +
      '<div class="np-det"><div class="np-det-cab" style="grid-template-columns:60px 340px 90px 140px">' +
      '<span>Cód</span><span>Coligada</span><span>Faturas</span><span>Total</span></div>';
    gs.forEach(function (g) {
      h += '<div class="np-det-linha" style="grid-template-columns:60px 340px 90px 140px">' +
        '<span>' + esc(g.cod) + '</span><span>' + esc(g.nome) + '</span>' +
        '<span>' + nf(g.faturas, 0) + '</span><span>' + esc(reais(g.total)) + '</span></div>';
    });
    h += '</div>';
    return h;
  }
  function htmlImpFeito() {
    var r = _impOk;
    var h = '<div class="np-msg ok">✓ ' + nf(r.faturas_inseridas, 0) + ' fatura(s) gravada(s), total ' +
      esc(reais(r.total)) + '.</div>' +
      '<div class="np-msg">' + nf(r.clientes_criados, 0) + ' cliente(s) cadastrado(s)' +
      (r.clientes_renomeados ? ', ' + nf(r.clientes_renomeados, 0) + ' com nome atualizado' : '') +
      ' · ' + nf(r.fechamentos_apagados, 0) + ' fatura(s) da importação anterior apagada(s) em ' +
      esc(periodo(r.janela.de, r.janela.ate)) + '</div>';
    if (r.recusadas && r.recusadas.length) {
      h += '<div class="np-msg erro">' + nf(r.recusadas.length, 0) + ' linha(s) recusada(s) pela rota: ' +
        esc(r.recusadas.slice(0, 5).map(function (x) { return 'L' + x.linha + ' ' + x.motivo; }).join(' · ')) +
        (r.recusadas.length > 5 ? ' …' : '') + '</div>';
    }
    if (r.guarda_quem_importou === false) {
      h += '<div class="np-msg">A coluna <b>importado_por</b> ainda não existe — a linha de última ' +
        'importação vai mostrar data e quantidade, sem o nome. Ver o bloco 2 de sql/nota_prazo_importacao.sql.</div>';
    }
    return h;
  }
  function htmlFormImportar() {
    var podeGravar = !!(_imp && _imp.fecha !== false && !_impSalvando);
    var h = '<div class="np-form"><h4>Importar relatório TecnoX</h4>' +
      '<p class="np-form-dica">Relatório <b>FATURAS POR DATA DE EMISSÃO — ANALÍTICO (TODOS OS LANÇAMENTOS)</b>, ' +
      'em .xls ou .xlsx. Os relatórios por <b>liquidação</b> e por <b>vencimento</b> têm o mesmo cabeçalho e ' +
      'conteúdo diferente — a tela recusa os dois.<br>' +
      'O arquivo é lido no navegador e nada é gravado antes de você confirmar.</p>' +
      '<div class="np-campos">' +
        '<button class="np-btn" type="button" onclick="__npImpAbrir()"' + (_impLendo ? ' disabled' : '') + '>' +
          (_impLendo ? 'Lendo a planilha…' : 'Escolher arquivo') + '</button>' +
        '<input type="file" id="np-imp-file" accept=".xls,.xlsx" hidden onchange="__npImpArquivo(this)">' +
        (_imp ? '<span class="np-sub">' + esc(_imp.arquivo) + ' · aba "' + esc(_imp.aba) +
          '" · cabeçalho na linha ' + _imp.linha_cabecalho + '</span>' : '') +
      '</div>';
    if (_impErro) h += '<div class="np-msg erro">' + esc(_impErro) + '</div>';
    if (_impOk) h += htmlImpFeito();
    if (_imp) h += htmlImpResumo();
    h += '<div class="np-form-pe">' +
        '<button class="np-btn pri" type="button" onclick="__npImportar()"' + (podeGravar ? '' : ' disabled') + '>' +
          (_impSalvando ? 'Gravando…' : (_imp ? 'Importar ' + nf(_imp.faturas.length, 0) + ' fatura(s)' : 'Importar')) +
        '</button>' +
        '<button class="np-btn" type="button" onclick="__npForm(\'\')">Fechar</button>' +
      '</div></div>';
    return h;
  }
  function htmlForm() {
    if (_form === 'cliente') return htmlFormCliente();
    if (_form === 'lancamento') return htmlFormLancamento();
    if (_form === 'fechar') return htmlFormFechar();
    if (_form === 'importar') return htmlFormImportar();
    return '';
  }

  // ── Pintura ─────────────────────────────────────────────────────
  // O FORMULÁRIO SOBREVIVE AO REPINTAR. pintar() refaz o innerHTML inteiro,
  // e sem isto todo <input> e <select> volta ao padrão: um erro de validação
  // ("informe o valor") apagava os outros nove campos já preenchidos, e
  // lançar 40 notas de um bloco viraria redigitar tudo a cada engano. O
  // snapshot é por id, e os ids dos três formulários não se cruzam.
  function snapForm() {
    var c = _el && _el.querySelector('.np-form');
    if (!c) return null;
    var m = {};
    [].slice.call(c.querySelectorAll('input,select')).forEach(function (e) {
      // INPUT DE ARQUIVO FICA FORA. O value dele é "C:\fakepath\nome.xls" e o
      // navegador PROÍBE escrever qualquer coisa além de string vazia nele —
      // o reporForm levantava TypeError ao repintar depois de escolher o
      // arquivo, e a importação morria no meio. O arquivo já está em _imp;
      // não é o DOM que o guarda.
      if (e.id && e.type !== 'file') m[e.id] = e.value;
    });
    return m;
  }
  function reporForm(m) {
    if (!m) return;
    Object.keys(m).forEach(function (id) {
      var e = document.getElementById(id);
      // Só repõe valor que o campo ainda aceita: o <select> de bloco é
      // remontado por JS e pode não ter mais a opção guardada.
      if (e && m[id] !== '') { e.value = m[id]; }
    });
  }

  function pintar() {
    if (!_el) return;
    var alvo = _el.querySelector('#np-corpo');
    if (!alvo) return;
    if (_carregando && !_fech) { alvo.innerHTML = '<div class="np-estado">carregando…</div>'; return; }
    if (_erro) {
      // O erro NÃO substitui a tela inteira: a barra continua, para dar como
      // tentar de novo sem recarregar a página.
      alvo.innerHTML = '<div class="np-erro">' + esc(_erro) +
        '</div>' + htmlBarra() +
        '<div class="np-estado"><button class="np-btn" type="button" onclick="__npRecarregar()">Tentar de novo</button></div>';
      return;
    }
    var campos = snapForm();
    alvo.innerHTML = htmlCards() + htmlBarra() + htmlForm() + htmlLista();
    reporForm(campos);
  }

  // ── Handlers (globais, chamados pelo onclick do HTML) ───────────
  // Prefixo __np e não np: o painel-adm carrega 15 módulos no MESMO escopo
  // global, e nome curto aqui é colisão esperando acontecer.
  window.__npFiltro = function (qual, valor) {
    if (qual === 'ciclo') _fCiclo = valor;
    else if (qual === 'status') _fStatus = valor;
    else if (qual === 'de') _fDe = valor;
    else if (qual === 'ate') _fAte = valor;
    // Fecha o detalhe: o fechamento expandido pode não estar mais na lista
    // filtrada, e deixá-lo aberto mostraria detalhe de linha invisível.
    _aberto = '';
    recarregarLista();
  };
  window.__npLimpar = function () {
    _fCiclo = ''; _fStatus = ''; _fDe = ''; _fAte = ''; _aberto = '';
    recarregarLista();
  };
  window.__npRecarregar = function () { carregar(); };
  window.__npAbrir = function (id) {
    if (_aberto === id) { _aberto = ''; pintar(); return; }
    _aberto = id;
    var f = ((_fech && _fech.fechamentos) || []).filter(function (x) { return x.id === id; })[0];
    if (!f) { pintar(); return; }
    carregarExtrato(f);
  };
  window.__npForm = function (qual) {
    _form = (_form === qual) ? '' : qual;
    _formErro = ''; _formOk = ''; _previa = null;
    // A PLANILHA LIDA SOBREVIVE a fechar e reabrir o formulário (como o _sg
    // da tela App): reler um arquivo de 400 KB porque a pessoa clicou fora é
    // punição sem motivo. O que se limpa é a mensagem.
    _impErro = ''; _impOk = null;
    pintar();
  };
  window.__npCorte = function (ciclo) {
    var i = document.getElementById('np-c-corte');
    if (i) i.value = (ciclo === 'QUINZENAL') ? 15 : 30;
  };
  // Blocos EM_USO do cliente escolhido. Sem bloco cadastrado o select diz
  // isso em vez de ficar vazio — bloco é opcional no lançamento.
  window.__npBlocos = function (clienteId) {
    var sel = document.getElementById('np-l-bloco');
    if (!sel) return;
    var c = ((_clientes && _clientes.clientes) || []).filter(function (x) { return x.id === clienteId; })[0];
    var bs = (c && c.blocos_em_uso) || [];
    sel.innerHTML = '<option value="">' + (clienteId ? (bs.length ? '— sem bloco —' : '— nenhum bloco em uso —') : '— escolha o cliente —') + '</option>' +
      bs.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.numero_bloco) + '</option>'; }).join('');
  };

  function val(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }

  window.__npPagar = async function (id) {
    var f = ((_fech && _fech.fechamentos) || []).filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    // Confirmação porque a rota recusa o segundo pagar (409) e não há
    // "desfazer": marcar pago é decisão, não navegação.
    if (!window.confirm('Marcar como PAGO?\n\n' + f.cliente_nome + '\n' +
        periodo(f.periodo_de, f.periodo_ate) + '\n' + reais(f.total))) return;
    try {
      await apiFetch('/nota-prazo/fechamento/' + encodeURIComponent(id) + '/pagar',
        { method: 'POST', body: JSON.stringify({}) });
      // Recarrega TUDO: pagar muda os cards (sai de "a receber", entra em
      // "recebido no mês"), não só a linha.
      await carregar();
    } catch (e) {
      _erro = (e && e.message) || 'Falha ao marcar como pago';
      pintar();
    }
  };

  window.__npSalvarCliente = async function () {
    _formErro = ''; _formOk = '';
    // LER O FORMULÁRIO INTEIRO ANTES DE QUALQUER pintar(). O pintar()
    // remonta o innerHTML do #np-corpo, e com ele os <input>/<select>
    // NASCEM DE NOVO no valor padrão — o que a pessoa digitou some do DOM.
    // Ler depois mandava o formulário em branco para a API: tipo VIP e ciclo
    // QUINZENAL (os primeiros <option>) em todo cliente cadastrado, fosse
    // qual fosse a escolha. Pegado pelo testes/nota-prazo.html.
    var dados = {
      nome: val('np-c-nome'),
      documento: val('np-c-doc') || null,
      tipo: val('np-c-tipo'),
      ciclo: val('np-c-ciclo'),
      dia_corte: val('np-c-corte') || null,
      limite_credito: val('np-c-limite') || null,
      telefone: val('np-c-tel') || null,
      email: val('np-c-mail') || null,
      observacao: val('np-c-obs') || null,
    };
    var nome = dados.nome;
    if (!nome) { _formErro = 'Informe o nome.'; pintar(); return; }
    _formSalvando = true; pintar();
    try {
      await apiFetch('/nota-prazo/cliente', { method: 'POST', body: JSON.stringify(dados) });
      _formSalvando = false;
      _formOk = 'Cliente "' + nome + '" cadastrado.';
      // O formulário FICA ABERTO e limpo: cadastro de cliente vem em lote
      // (a carga inicial é um caderno inteiro), e fechar a cada nome faria
      // três cliques por cliente.
      await carregar();
      ['np-c-nome', 'np-c-doc', 'np-c-limite', 'np-c-tel', 'np-c-mail', 'np-c-obs'].forEach(function (id) {
        var e = document.getElementById(id); if (e) e.value = '';
      });
    } catch (e) {
      _formSalvando = false;
      _formErro = (e && e.message) || 'Falha ao cadastrar';
      pintar();
    }
  };

  window.__npSalvarLancamento = async function () {
    _formErro = ''; _formOk = '';
    // Formulário inteiro ANTES do primeiro pintar(), pela mesma razão do
    // __npSalvarCliente: o repintar recria os campos vazios. Aqui era pior —
    // a validação passava (cliente e valor eram lidos antes) e o lançamento
    // saía com data, posto, bloco e valor em branco.
    var dados = {
      cliente_id: val('np-l-cliente'),
      bloco_id: val('np-l-bloco') || null,
      posto_id: val('np-l-posto') || null,
      data: val('np-l-data'),
      numero_nota: val('np-l-nota') || null,
      combustivel: val('np-l-comb') || null,
      litros: val('np-l-litros') || null,
      valor: val('np-l-valor'),
      observacao: val('np-l-obs') || null,
    };
    var cliente = dados.cliente_id;
    var valor = dados.valor;
    if (!cliente) { _formErro = 'Escolha o cliente.'; pintar(); return; }
    if (!valor || !(Number(valor) > 0)) { _formErro = 'Informe um valor maior que zero.'; pintar(); return; }
    _formSalvando = true; pintar();
    try {
      await apiFetch('/nota-prazo/lancamento', { method: 'POST', body: JSON.stringify(dados) });
      _formSalvando = false;
      _formOk = 'Nota lançada: ' + reais(Number(valor)) + '.';
      // Aberto e limpo pelo mesmo motivo do cadastro: um bloco tem dezenas
      // de notas, e elas entram em sequência.
      await carregar();
      ['np-l-nota', 'np-l-litros', 'np-l-valor', 'np-l-obs'].forEach(function (id) {
        var e = document.getElementById(id); if (e) e.value = '';
      });
      // O select de blocos é montado por JS e some no repintar — repõe.
      window.__npBlocos(cliente);
      var sc = document.getElementById('np-l-cliente'); if (sc) sc.value = cliente;
    } catch (e) {
      _formSalvando = false;
      _formErro = (e && e.message) || 'Falha ao lançar';
      pintar();
    }
  };

  window.__npFechar = async function (dry) {
    _formErro = ''; _formOk = '';
    // Os três campos antes do pintar(), como nos outros dois formulários: o
    // ciclo lido depois voltava vazio (o <option> "Todos") e o fechamento
    // saía para a rede inteira mesmo com um ciclo escolhido na tela.
    var de = val('np-f-de'), ate = val('np-f-ate'), ciclo = val('np-f-ciclo');
    if (!de || !ate) { _formErro = 'Informe as duas datas.'; pintar(); return; }
    if (de > ate) { _formErro = 'A data inicial é depois da final.'; pintar(); return; }
    if (!dry && !window.confirm('Gerar ' + ((_previa && _previa.a_gerar) || 0) +
        ' fechamento(s), total ' + reais((_previa && _previa.total) || 0) + '?\n\n' +
        'Isso cria cobranças. Elas não são apagadas pela tela.')) return;
    _formSalvando = true; pintar();
    try {
      var r = await apiFetch('/nota-prazo/fechar', { method: 'POST', body: JSON.stringify({
        periodo_de: de, periodo_ate: ate,
        ciclo: ciclo || null,
        dry_run: !!dry,
      }) });
      _formSalvando = false;
      if (dry) { _previa = r; pintar(); return; }
      _previa = null;
      _formOk = r.gerados + ' fechamento(s) gerado(s), total ' + reais(r.total) + '.';
      await carregar();
    } catch (e) {
      _formSalvando = false;
      _formErro = (e && e.message) || 'Falha ao fechar período';
      pintar();
    }
  };

  // ── Importação: escolher, ler e gravar ──────────────────────────
  window.__npImpAbrir = function () {
    var el = document.getElementById('np-imp-file');
    // value vazio para o onchange disparar ao reescolher o MESMO arquivo —
    // que é o caso de quem corrigiu a exportação e tenta de novo.
    if (el) { el.value = ''; el.click(); }
  };
  window.__npImpArquivo = async function (input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    // O SheetJS lê os dois formatos: o .xls da TecnoX é BIFF/OLE2 e o .xlsx é
    // ZIP/OOXML, e o XLSX.read decide pelos bytes, não pela extensão. O guard
    // acompanha o accept do input.
    if (!/\.xlsx?$/i.test(file.name)) {
      _impErro = 'Selecione uma planilha do Excel (.xls ou .xlsx).'; pintar(); return;
    }
    _impLendo = true; _impErro = ''; _impOk = null; _imp = null; pintar();
    try {
      var XLSX = await carregarXlsx();
      var buf = new Uint8Array(await file.arrayBuffer());
      _imp = lerRelatorio(XLSX, buf, file.name);
    } catch (e) {
      _imp = null;
      _impErro = (e && e.message) ? e.message : String(e);
    } finally {
      _impLendo = false; pintar();
    }
  };
  window.__npImportar = async function () {
    if (!_imp || _imp.fecha === false) return;
    var p = _imp;
    // CONFIRMAÇÃO com os números, como o "Fechar período": esta rota apaga a
    // importação anterior da janela e grava conta a receber.
    if (!window.confirm(
        nf(p.clientes, 0) + ' cliente(s), ' + nf(p.faturas.length, 0) + ' fatura(s), ' +
        nf(p.por_status.ABERTO || 0, 0) + ' em aberto, ' + nf(p.por_status.PAGO || 0, 0) + ' paga(s).\n' +
        'Total ' + reais(p.total) + '\n' +
        'Emissão de ' + periodo(p.periodo.de, p.periodo.ate) + '\n\n' +
        'Confirmar? Isso apaga a importação anterior deste mesmo período e grava as faturas.')) return;
    _impSalvando = true; _impErro = ''; _impOk = null; pintar();
    try {
      var r = await apiFetch('/nota-prazo/importar', { method: 'POST', body: JSON.stringify({
        arquivo: p.arquivo,
        titulo: p.titulo,
        total_geral: p.total_geral,
        qtd_titulos: p.qtd_titulos,
        // Só o que a rota usa. O resumo (grupos, empresas selecionadas)
        // fica na tela: ele serve para conferir antes de mandar, e mandar
        // junto seria pedir para a rota confiar em número que ela recalcula.
        faturas: p.faturas.map(function (f) {
          return { seq: f.seq, doc: f.doc, cod: f.cod, cliente: f.cliente,
                   emissao: f.emissao, vencimento: f.vencimento,
                   liquido: f.liquido, juros: f.juros, pago: f.pago,
                   data_pg: f.data_pg, situacao: f.situacao,
                   grupo_cod: f.grupo_cod, grupo_nome: f.grupo_nome };
        }),
      }) });
      _impSalvando = false;
      _impOk = r;
      // Recarrega TUDO: importar muda os cards, a lista e a linha de última
      // importação — não só a lista.
      await carregar();
    } catch (e) {
      _impSalvando = false;
      _impErro = (e && e.message) || 'Falha ao importar';
      pintar();
    }
  };

  // ── Entrada pública ─────────────────────────────────────────────
  // Recebe o #fin-corpo (o finAbrir passa o elemento), não a section: quem
  // manda no conteúdo da sub-vista é aquele div, e é ele que o roteador
  // limpa ao trocar de sub-botão.
  window.renderNotaPrazo = function (el) {
    if (!el) return;
    _el = el;
    injetarEstilo();
    var u = (typeof getUsuarioLogado === 'function') ? getUsuarioLogado() : null;
    if (u && u.perfil && PERFIS_VEEM.indexOf(u.perfil) < 0) {
      el.innerHTML = '<div class="np-wrap"><div class="np-estado">' +
        '<b>Acesso restrito</b>Nota prazo é do perfil ADM.</div></div>';
      return;
    }
    // O finAbrir reescreve o #fin-corpo a cada troca de sub-vista, então o
    // #np-corpo precisa ser remontado — não basta o _pronto.
    if (!_pronto || !el.querySelector('#np-corpo')) {
      el.innerHTML = '<div class="np-wrap"><div id="np-corpo"></div></div>';
      _pronto = true;
    }
    // Reabertura não refaz a chamada, como no app-cupons: quem quiser dado
    // novo tem o "Tentar de novo" e os filtros.
    if (!_fech && !_carregando) { carregar(); return; }
    pintar();
  };
})();
