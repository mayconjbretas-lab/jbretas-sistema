// ================================================================
// JBRETAS SISTEMA — modulos/painel-adm/app.js
// Painel ADM desktop (esqueleto). Tela de escolha Desktop/Mobile +
// navegação por abas (placeholders). SEM lógica de dados ainda.
// Depende de: config.js, api.js, auth.js (carregados antes).
// ================================================================

// ── Proteção de rota ────────────────────────────────────────────
const USUARIO = exigirSessao(['ADM']);

const CHAVE_VERSAO = 'jb_adm_versao'; // 'desktop' | 'mobile'

// ── Tema claro/escuro (mesma chave jb_theme dos outros módulos) ──
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = tema === 'light' ? '☀️' : '🌙';
  localStorage.setItem('jb_theme', tema);
}
function toggleTheme() {
  const atual = document.documentElement.getAttribute('data-theme') || 'dark';
  aplicarTema(atual === 'dark' ? 'light' : 'dark');
}

// ── Topbar ──────────────────────────────────────────────────────
function preencherTopbar() {
  if (!USUARIO) return;
  const nome = USUARIO.nome || USUARIO.email || '—';
  document.getElementById('app-usuario').textContent = nome;
  document.getElementById('app-perfil').textContent  = USUARIO.perfil || '—';
  document.getElementById('app-avatar').textContent   = nome.trim().slice(0, 2).toUpperCase();
}

// ── Escolha Desktop/Mobile ──────────────────────────────────────
function irParaMobile() {
  // Atualiza a escolha só se o usuário já tinha pedido pra lembrar.
  if (localStorage.getItem(CHAVE_VERSAO)) localStorage.setItem(CHAVE_VERSAO, 'mobile');
  window.location.href = caminhoRaiz() + 'modulos/admin/';
}

// Chamada pelos botões da tela de escolha.
function escolherVersao(versao) {
  const lembrar = document.getElementById('chk-lembrar')?.checked;
  if (lembrar) localStorage.setItem(CHAVE_VERSAO, versao);
  if (versao === 'mobile') {
    window.location.href = caminhoRaiz() + 'modulos/admin/';
    return;
  }
  abrirPainelDesktop();
}

function abrirPainelDesktop() {
  document.getElementById('tela-escolha').style.display = 'none';
  document.getElementById('screen-app').style.display = 'flex';
  preencherTopbar();
  // A URL MANDA, quando ela diz algo: F5 e link colado voltam para onde a
  // pessoa estava. Sem hash, ou com hash que não casa com aba nenhuma,
  // segue o padrão do HTML (Comparação, já marcada lá).
  const veioDoHash = aplicarHash();
  // Comparação é a aba ativa por padrão — carrega já. Com o hash apontando
  // para OUTRA aba, não carrega: o setTab dela faz a carga quando alguém
  // entrar (guarda `!comparaCarregado`), e puxar /coletas para uma tela que
  // não está à vista é a leitura mais cara daqui, sem ninguém pedir.
  if (!veioDoHash) { gravarHash('comp'); carregarDadosComparar(); }
  iniciarAutoRefreshComparar();
}

// ── Navegação por abas ──────────────────────────────────────────
function setTab(btn, tab) {
  document.querySelectorAll('.bnav .nbtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.pa-main .scr').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('s-' + tab)?.classList.add('active');
  if (tab === 'comp' && !comparaCarregado) carregarDadosComparar();
  // Coleta (revisão) — mesmo render do painel mobile (coleta-revisao.js).
  // O botão saiu da barra (ver o index.html), mas a aba segue viva e
  // alcançável por #coleta na URL — este ramo é o que a atende.
  if (tab === 'coleta') renderColetaRevisao(document.getElementById('s-coleta'));
  // Financeiro — três sub-vistas; ver o bloco FIN_VISTAS.
  if (tab === 'financeiro') renderFinanceiro();
  // Medição — ADM define o pré-pedido (medicao.js expõe renderMedicao em window).
  if (tab === 'medicao') renderMedicao(document.getElementById('s-medicao'));
  // Relatórios — hospeda DUAS vistas (relatórios da rede e DRE). Ver
  // renderRelatArea: o setTab acabou de limpar o `active` de TODAS as .scr,
  // e o #s-dre é uma delas (está aninhado dentro do #s-relat), então quem
  // repõe o estado da vista escolhida é ela.
  if (tab === 'relat') renderRelatArea();
  // Custo & Margem — mesmo JS da Logística; ADM entra em modo só-leitura (sem edição).
  if (tab === 'custo') renderCustoMargem(document.getElementById('s-custo'));
  // Mais+ — aba KPI (sugestão de pedido; kpi.js expõe renderKpi em window).
  if (tab === 'mais') renderKpi(document.getElementById('s-mais'));
  // Demais abas (mapa/histórico) entram nos próximos blocos.
  // Por último: a URL guarda onde a pessoa está. Ver o bloco do hash.
  gravarHash(tab);
}

// ── Aba RELATÓRIOS: duas vistas, uma área ────────────────────────
// O DRE era aba do topo e passou a ser uma vista aqui dentro. NADA do DRE
// mudou: mesmo dre.js, mesmo renderDre, mesma section #s-dre (com o id
// preservado, porque os ~210 seletores de CSS dele são `#s-dre .algo`), e o
// mesmo arquivo continua servindo o admin mobile.
// AS VISTAS DA ABA, num MAPA e não num if/else: uma linha por relatório, e
// o resto da função não muda quando entra o próximo.
//
// O CONSOLIDADO É UMA VISTA COMO AS OUTRAS. Ele era o estado "nenhuma
// aberta" — quem quisesse vê-lo clicava no botão aceso para fechar o que
// estava abrindo. Isso fazia a tela de entrada da aba ser a menos usada das
// quatro, e obrigava a conhecer um gesto (fechar para chegar) que botão
// nenhum anunciava. Agora tem botão, como os outros três.
//
// `plano: true` no Consolidado porque o #s-relat-lista é um DIV comum, e
// não uma .scr: a visibilidade dele é por `hidden`. Transformá-lo em .scr
// uniformizaria o loop e mudaria o layout — .scr é display:flex com
// height:100% no desktop e ganha padding no mobile, e o conteúdo do
// Consolidado não pediu nada disso.
//
// A ORDEM DAS CHAVES é a dos botões na tela, para quem ler as duas listas
// não precisar cruzá-las. `mov` (mês × mês) fica sem botão de propósito,
// como já estava: a vista existe, a entrada visível não.
// ── ABA FINANCEIRO ──────────────────────────────────────────────
// Substituiu a COLETA na barra inferior. Nada da Coleta foi apagado: a
// section #s-coleta, o renderColetaRevisao e o ramo do setTab continuam
// inteiros, e o botão dela segue no DOM (escondido) porque é por ele que o
// roteador de hash abre #coleta. Ver o comentário no index.html.
//
// Três sub-vistas, no MESMO padrão da aba Relatórios: um mapa com uma linha
// por vista, e o resto da função não muda quando entra a próxima. Banco e
// Clientes ainda desenham placeholder; Nota prazo já tem módulo.
//
// A CHAVE TEM HÍFEN em nota-prazo, e isso importa: ela vai para a URL
// (#financeiro/nota-prazo) e o validador de sub-vista é o próprio mapa —
// o /^[a-z]+$/ do botaoDaAba vale para o nome da ABA, não para o da vista.
//
// `render` É OPCIONAL, e é o que troca o placeholder pelo módulo: a vista
// que tem um desenha com ele, a que não tem segue em construção. Mesmo
// contrato do REL_VISTAS. A função recebe o #fin-corpo, e NÃO a section:
// quem manda no conteúdo da sub-vista é aquele div, e é ele que o
// renderFinanceiro reescreve a cada troca de sub-botão.
const FIN_VISTAS = {
  banco: { rot: 'Banco', botao: 'fin-btn-banco' },
  'nota-prazo': { rot: 'Nota prazo', botao: 'fin-btn-nota-prazo',
                  render: (el) => renderNotaPrazo(el) },
  clientes: { rot: 'Clientes', botao: 'fin-btn-clientes' },
};
// Padrão da aba. Variável de MÓDULO, como a _relatVista: voltar ao
// Financeiro reabre a última sub-vista escolhida, não o padrão.
let _finVista = 'banco';

function renderFinanceiro() {
  Object.keys(FIN_VISTAS).forEach(function (k) {
    const b = document.getElementById(FIN_VISTAS[k].botao);
    if (b) b.classList.toggle('active', k === _finVista);
  });
  const el = document.getElementById('fin-corpo');
  if (!el) return;
  const v = FIN_VISTAS[_finVista] || FIN_VISTAS.banco;
  // O módulo da vista, quando existe. try/catch porque um erro aqui derruba
  // a aba INTEIRA no clique — e um script que não carregou (deploy pela
  // metade, cache velho) é exatamente o caso em que a pessoa precisa
  // conseguir voltar para o Banco. O erro aparece na tela e no console.
  if (typeof v.render === 'function') {
    el.innerHTML = '';
    try {
      v.render(el);
    } catch (e) {
      console.error('Financeiro / ' + v.rot + ':', e);
      el.innerHTML = '<div class="em-construcao">💲 ' + v.rot + ' — falhou ao abrir</div>';
    }
    return;
  }
  // SEM escapar: v.rot vem do FIN_VISTAS, que é literal deste arquivo — não é
  // dado de usuário nem de API. E este módulo NÃO tem escapeHtml no escopo
  // (o esc() dos shared vive dentro dos IIFEs deles); chamar um que não existe
  // derrubaria a aba no clique.
  el.innerHTML = '<div class="em-construcao">💲 ' + v.rot + ' — em construção</div>';
}
// Sub-vista é recorte LOCAL: o render da vista decide se busca algo (o
// renderNotaPrazo não refaz a chamada na reabertura), e o hash é gravado
// como no relAbrir.
function finAbrir(vista) {
  if (!FIN_VISTAS[vista]) return;
  _finVista = vista;
  renderFinanceiro();
  gravarHash('financeiro');
}

const REL_VISTAS = {
  postos: { sec: 's-movpostos', botao: 'rel-btn-postos', render: (el) => renderMovPostos(el) },
  app: { sec: 's-app', botao: 'rel-btn-app', render: (el) => renderAppCupons(el) },
  dre: { sec: 's-dre', botao: 'rel-btn-dre', render: (el) => renderDre(el) },
  mercado: { sec: 's-mercado', botao: 'rel-btn-mercado', render: (el) => renderMercado(el) },
  lista: { sec: 's-relat-lista', botao: 'rel-btn-lista', plano: true,
           render: (el) => renderRelatorios(el) },
  mov: { sec: 's-movmes', botao: 'rel-btn-mov', render: (el) => renderMovMes(el) },
};
// Padrão da aba: a Movimentação do dia. A variável é de MÓDULO e sobrevive
// à troca de aba, então voltar a Relatórios reabre a última vista escolhida
// — só a primeira entrada da sessão usa este valor.
let _relatVista = 'postos';

function renderRelatArea() {
  Object.keys(REL_VISTAS).forEach((k) => {
    const v = REL_VISTAS[k];
    const sec = document.getElementById(v.sec);
    const btn = document.getElementById(v.botao);
    const ativa = (k === _relatVista);
    // As sections são .scr: quem manda na visibilidade é a classe `active`
    // (.scr{display:none} / #s-dre.active{display:block}, injetada pelo próprio
    // dre.js; a gêmea do #s-movmes vem do shared/css/mov-mes.css). `hidden` não
    // bastaria aqui — o seletor de id com classe vence o atributo.
    //
    // O Consolidado é a exceção, e por isso tem `plano`: div comum, sem
    // regra de .scr atrás dele, e aí `hidden` é justamente o que funciona.
    if (sec) {
      if (v.plano) sec.hidden = !ativa;
      else sec.classList.toggle('active', ativa);
    }
    // O botão fica ACESO enquanto o relatório está aberto, e é por ele que se
    // volta. aria-pressed, e não aria-expanded: é botão de estado numa barra.
    if (btn) {
      btn.classList.toggle('active', ativa);
      btn.setAttribute('aria-pressed', ativa ? 'true' : 'false');
    }
    // Render SOB DEMANDA e SÓ da vista visível: cada relatório faz o próprio
    // GET e não deve disparar para quem abriu o outro. Todos são idempotentes
    // (guardam o próprio shell), então reentrar não remonta nada.
    if (ativa && sec) v.render(sec);
  });
}

// Um botão por relatório, e SEM fechar. NÃO mexe na .bnav: continua-se na
// aba Relatórios.
//
// O MESMO BOTÃO NÃO FECHA MAIS. Fechava quando o Consolidado era o estado
// vazio e havia para onde voltar; agora as quatro vistas são vistas, e
// "fechar" deixaria a aba sem conteúdo nenhum na tela. Clicar no botão
// aceso repinta a vista dele, o que é inofensivo (todos os renders são
// idempotentes) e é o que o usuário esperaria de um botão já marcado.
function relAbrir(vista) {
  if (!REL_VISTAS[vista]) return;
  _relatVista = vista;
  renderRelatArea();
  gravarHash('relat');
}

// ── A ABA MORA NA URL ───────────────────────────────────────────
// A aba e a sub-vista viram '#relat/postos' na barra de endereço. Sem isto,
// F5 devolvia a Comparação: quem estava conferindo a Movimentação do dia
// perdia o lugar a cada recarga, e link nenhum apontava para uma tela.
//
// replaceState, e NÃO pushState: trocar de aba não é navegar. Com pushState,
// sair da página depois de passear por cinco abas exigiria cinco toques no
// botão de voltar, e sair da página é o que aquele botão quer dizer aqui.
//
// CONSEQUÊNCIA DECLARADA: o voltar/avançar NÃO percorre as abas visitadas —
// não existe entrada de histórico para percorrer, e é essa a troca que o
// replaceState faz. O listener de hashchange abaixo cobre o que sobra: hash
// editado à mão, link colado na mesma página, e qualquer entrada de
// histórico que venha de fora deste código.
//
// O BOTÃO É ACHADO PELO onclick porque é o único vínculo entre nome de aba
// e botão que existe hoje — o mesmo seletor que o abrirDreMobile já usava.
// Um data-tab seria mais limpo e pediria mexer nos dois index.html.
function botaoDaAba(tab) {
  // A regra do nome NÃO é decoração: o valor vem do hash, que é do usuário,
  // e entra num seletor CSS. Sem ela, um hash com apóstrofo quebraria o
  // querySelector — ou casaria um botão que ninguém pediu.
  if (!tab || !/^[a-z]+$/.test(tab)) return null;
  return document.querySelector('.nbtn[onclick*="\'' + tab + '\'"]');
}
// A aba App tem hash PRÓPRIO — '#app' e '#app/soutag' — em vez de
// '#relat/app'. É a única vista de Relatórios com sub-estado (o canal) que
// precisa sobreviver ao F5, e '#relat/app/soutag' seria um terceiro nível
// num esquema de dois. Nada do esquema antigo mudou: '#relat/postos',
// '#relat/dre' e os demais continuam idênticos.
function hashDaAba(tab) {
  if (tab === 'relat' && _relatVista === 'app') {
    const canal = (typeof window.__apCanalAtual === 'function') ? window.__apCanalAtual() : '';
    return '#app' + (canal ? '/' + String(canal).toLowerCase() : '');
  }
  if (tab === 'financeiro') return '#financeiro/' + _finVista;
  return '#' + tab + (tab === 'relat' ? '/' + _relatVista : '');
}
// O app-cupons.js chama isto ao trocar de canal, para a URL acompanhar sem
// que ele precise conhecer o roteador.
window.__apHash = function () { gravarHash('relat'); };
function gravarHash(tab) {
  const novo = hashDaAba(tab);
  // Reescrever o mesmo hash não muda nada e ainda assim mexe na URL.
  if (location.hash !== novo) history.replaceState(null, '', novo);
}
// Abre o que o hash pedir. Devolve false quando ele não corresponde a aba
// nenhuma: hash inválido não é erro, é ausência de instrução — e aí o padrão
// do HTML fica como está, sem mensagem e sem tela em branco.
function aplicarHash() {
  const partes = String(location.hash || '').replace(/^#/, '').split('/');
  // '#app' e '#app/soutag' abrem a aba Relatórios na vista App. Traduzido
  // aqui, antes do resto, para o roteador continuar tendo um caminho só.
  if (partes[0] === 'app') {
    const bt = botaoDaAba('relat');
    if (!bt) return false;
    _relatVista = 'app';
    if (partes[1] && typeof window.__apSetCanal === 'function') {
      window.__apSetCanal(partes[1].toUpperCase() === '99' ? '99' : 'SOUTAG');
    }
    setTab(bt, 'relat');
    return true;
  }
  const btn = botaoDaAba(partes[0]);
  if (!btn) return false;
  // A sub-vista só é aceita se existir no mapa. "#relat/inventada" abre a
  // aba na última vista válida, em vez de abrir uma aba vazia.
  if (partes[0] === 'relat' && partes[1] && REL_VISTAS[partes[1]]) _relatVista = partes[1];
  // Mesma regra para o Financeiro: sub-vista fora do mapa não zera a aba,
  // abre na última válida. "#financeiro/inventada" cai no Banco.
  if (partes[0] === 'financeiro' && partes[1] && FIN_VISTAS[partes[1]]) _finVista = partes[1];
  setTab(btn, partes[0]);
  return true;
}
window.addEventListener('hashchange', aplicarHash);

// ================================================================
// ABA COMPARAÇÃO — clonada da Compara mobile (modulos/admin/app.js),
// mesma fonte de dados (shared/js/coletas-service.js → GET /coletas)
// e MAP_POSTOS/SUPCOR_MAP (shared/js/postos-mapa.js). Layout desktop.
// ================================================================
let G_COMPARACAO = {};
let G_MEDIA_DETALHE = null;
let comparaCarregado = false;
const INTERVALO_ATUALIZACAO = 5 * 60 * 1000;
let _cmpRefreshTimer = null;

const CMP_FUELS = [
  { key: 'ET',   label: 'Etanol' },
  { key: 'GC',   label: 'Comum' },
  { key: 'GA',   label: 'Aditiv.' },
  { key: 'S10',  label: 'Diesel S10' },
];
const CMP_STRATS = [
  { key: 'agg',  label: 'Agressivo', desc: '1 centavo abaixo do concorrente mais barato — ganha volume.' },
  { key: 'avg',  label: 'Na média',  desc: 'Média dos concorrentes coletados — equilíbrio.' },
  { key: 'prem', label: 'Premium',   desc: '1 centavo acima do mais caro — protege margem.' },
];
let G_CMP_FUEL = 'GC';
let G_CMP_STRAT = 'avg';
let G_CMP_REG = '';
let G_CMP_BAND = '';
let G_CMP_REDE = '';   // filtro de REDE do concorrente ('' = todas)
let G_CMP_POSTO = '';
let G_CMP_SO_MUDOU = false;
let G_CMP_ABAIXO = false; // chip "abaixo do nosso" (independente do "acima")
let G_CMP_ACIMA  = false; // chip "acima do nosso"  (independente do "abaixo")
let G_CMP_ORD = ''; // '' = alfabético | 'barato' = preço Você asc | 'caro' = desc
// Data da Comparação (YYYY-MM-DD). '' = hoje, que é o estado de sempre: nada
// muda até alguém mexer no seletor. Vazia (e não a data de hoje) de propósito
// — é o '' que faz buscarComparacaoDoDia e cmpAplicarRevisoes seguirem pelo
// caminho antigo, sem alargar janela nem limite do GET /coletas.
let G_CMP_DATA = '';

// Estado dos filtros no formato que o shared/js/comparacao-card.js espera.
// Montado na hora da chamada, não guardado: estes let mudam a cada clique
// de chip e um snapshot velho renderizaria o card com o filtro anterior.
function cmpOpcoes() {
  return {
    fuel:    G_CMP_FUEL,
    strat:   G_CMP_STRAT,
    ord:     G_CMP_ORD,
    abaixo:  G_CMP_ABAIXO,
    acima:   G_CMP_ACIMA,
    soMudou: G_CMP_SO_MUDOU,
    // Liga o "✓ Conferir" no cabeçalho do card. A Logística monta o card pelo
    // MESMO cmpCardMatriz e não passa esta chave — por isso ela é opt-in.
    conferir: true,
  };
}

// Troca a data da Comparação e recarrega. Valor vazio ou fora do formato volta
// para hoje — é o que o próprio <input type="date"> devolve quando limpam o
// campo, e cair em hoje é melhor que ficar numa data meio preenchida.
function cmpSetData(v) {
  const iso = String(v || '').slice(0, 10);
  G_CMP_DATA = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
  carregarDadosComparar();
}

// Chip âmbar com a data quando NÃO é hoje — mesmo sinal da aba Coleta, pelo
// mesmo motivo: evita ler dia passado achando que é o corrente.
function cmpPintarDataRetro() {
  const hoje = (typeof hojeISOLocal === 'function') ? hojeISOLocal() : '';
  const inp = document.getElementById('cmp-data');
  if (inp) { inp.max = hoje; inp.value = G_CMP_DATA || hoje; }
  const chip = document.getElementById('cmp-data-retro');
  if (!chip) return;
  const retro = !!G_CMP_DATA && G_CMP_DATA !== hoje;
  chip.hidden = !retro;
  if (retro) chip.textContent = isoParaBRData(G_CMP_DATA);
}

async function carregarDadosComparar() {
  document.getElementById('upd-txt').textContent = 'Buscando dados...';
  try {
    const dia = G_CMP_DATA || null;
    G_COMPARACAO = await buscarComparacaoDoDia({ dias: 15, data: dia });
    await cmpAplicarRevisoes(G_COMPARACAO, dia); // sobrepõe os preços editados do dia no "Você"
    comparaCarregado = true;
    if (!document.getElementById('cmp-posto').dataset.populado) popularFiltrosComparar();
    processarKPIsComparar();
    renderComparar();
    // Depois do render: o contador conta o que a leitura trouxe, e os botões
    // dos cards já nasceram do mesmo _cmpConferidos.
    cmpPintarDataRetro();
    cmpPintarContador();
    const agora = new Date();
    document.getElementById('upd-txt').textContent =
      `Atualizado às ${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')} · próxima em 5min`;
  } catch (err) {
    console.error('Erro ao carregar dados da Compara:', err);
    document.getElementById('upd-txt').textContent = 'Erro ao carregar — tenta de novo (↻)';
  }
}

function popularFiltrosComparar() {
  const selPosto = document.getElementById('cmp-posto');
  const selReg = document.getElementById('cmp-sup'); // id mantido; agora é filtro de REGIÃO
  const selBand = document.getElementById('cmp-band');
  const selRede = document.getElementById('cmp-rede');
  // Bandeira e rede saem dos CONCORRENTES carregados (banco, via /coletas →
  // concorrentes), NÃO do MAP_POSTOS estático. Só valores realmente presentes.
  const conc = Object.values(G_COMPARACAO).flatMap(d => (d && d.concorrentes) || []);
  const bandas = [...new Set(conc.map(c => c.bandeira).filter(Boolean))].sort();
  const redes  = [...new Set(conc.map(c => c.rede).filter(Boolean))].sort();
  selPosto.innerHTML = '<option value="">Todos os postos</option>' +
    MAP_POSTOS.slice().sort((a, b) => a.ap.localeCompare(b.ap)).map(p => `<option value="${p.k}">${p.ap}</option>`).join('');
  selReg.innerHTML = '<option value="">Todas regiões</option>'
    + '<option value="metro">Metropolitana</option>'
    + '<option value="sjdr">São João del Rei</option>';
  selBand.innerHTML = '<option value="">Todas bandeiras</option>' + bandas.map(b => `<option value="${b}">${b}</option>`).join('');
  if (selRede) selRede.innerHTML = '<option value="">Todas redes</option>' + redes.map(r => `<option value="${r}">${r}</option>`).join('');
  selPosto.dataset.populado = '1';
}

function processarKPIsComparar() {
  const hoje = hojeBR();
  let lancaramHoje = 0, concorrentesHoje = 0;
  let somaGcProprio = 0, contGcProprio = 0;

  MAP_POSTOS.forEach(posto => {
    const dado = G_COMPARACAO[posto.k];
    if (!dado) return;
    if (dado.proprio && !dado.proprioDesatualizado) lancaramHoje++;
    if (dado.proprio && dado.proprio.GC !== null && dado.proprio.GC !== undefined) {
      somaGcProprio += Number(dado.proprio.GC); contGcProprio++;
    }
    dado.concorrentes.forEach(c => { if (!c.desatualizado) concorrentesHoje++; });
  });

  const totalPostos = MAP_POSTOS.length;
  document.getElementById('kv-proprios').textContent = lancaramHoje;
  const faltam = totalPostos - lancaramHoje;
  document.getElementById('kv-proprios-sub').textContent =
    faltam > 0 ? `de ${totalPostos} · faltam ${faltam}` : `de ${totalPostos} · completo ✓`;
  document.getElementById('kv-concs').textContent = concorrentesHoje;

  const mediaGc = calcularMediaHierarquica(MAP_POSTOS, 'GC');
  document.getElementById('kv-gc').textContent = mediaGc !== null ? fmtPrecoBRL(mediaGc) : '--';
  document.getElementById('kv-mgc').textContent = contGcProprio > 0 ? fmtPrecoBRL(somaGcProprio / contGcProprio) : '--';

  void hoje;
}

function calcularMediaHierarquica(postosArr, fuel) {
  const porPosto = [];
  postosArr.forEach(posto => {
    const dado = G_COMPARACAO[posto.k];
    if (!dado) return;
    const valores = dado.concorrentes
      .map(c => c.registro[fuel])
      .filter(v => v !== null && v !== undefined);
    if (!valores.length) return;
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    porPosto.push({ posto: posto.ap, sup: posto.sup, media });
  });
  const porSupervisor = {};
  porPosto.forEach(p => {
    if (!porSupervisor[p.sup]) porSupervisor[p.sup] = [];
    porSupervisor[p.sup].push(p);
  });
  const mediaPorSupervisor = {};
  Object.keys(porSupervisor).forEach(sup => {
    const arr = porSupervisor[sup];
    const media = arr.reduce((s, x) => s + x.media, 0) / arr.length;
    mediaPorSupervisor[sup] = { media, postos: arr };
  });
  const supKeys = Object.keys(mediaPorSupervisor);
  if (!supKeys.length) { G_MEDIA_DETALHE = null; return null; }
  const mediaGeral = supKeys.reduce((s, k) => s + mediaPorSupervisor[k].media, 0) / supKeys.length;
  G_MEDIA_DETALHE = { mediaPorSupervisor, mediaGeral };
  return mediaGeral;
}

function abrirDetalheMedia() {
  document.getElementById('modal-media').classList.add('open');
  renderDetalheMedia();
}
function fecharMedia(e) { if (e.target.id === 'modal-media') fecharMediaBtn(); }
function fecharMediaBtn() { document.getElementById('modal-media').classList.remove('open'); }

// ── Modal "Lançaram | Faltam" (rede toda, ignora filtros) ─────────
function abrirFaltam() {
  renderFaltam();
  document.getElementById('modal-faltam').classList.add('open');
}
function fecharFaltam(e) { if (e.target.id === 'modal-faltam') fecharFaltamBtn(); }
function fecharFaltamBtn() { document.getElementById('modal-faltam').classList.remove('open'); }

function renderFaltam(){
  const lancaram = [];
  const faltam = [];
  MAP_POSTOS.slice().sort((a,b)=>a.ap.localeCompare(b.ap)).forEach(p => {
    const d = G_COMPARACAO[p.k];
    const ok = d && d.proprio && !d.proprioDesatualizado;
    if (ok) lancaram.push({ p, ger: (d.proprio && d.proprio.gerente) ? d.proprio.gerente : '' });
    else faltam.push({ p });
  });
  const linha = (nome, sub) =>
    `<div style="background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:8px;margin-bottom:5px">
       <div style="font-size:12px;font-weight:600;color:var(--tx)">${nome}</div>
       <div style="font-size:11px;color:var(--tx2)">${sub}</div>
     </div>`;
  const colL = lancaram.map(x => linha(x.p.ap, x.ger ? `${x.ger} · ${x.p.sup}` : x.p.sup)).join('') || '<div style="font-size:11px;color:var(--tx3)">nenhum</div>';
  const colF = faltam.map(x => linha(x.p.ap, x.p.sup)).join('') || '<div style="font-size:11px;color:var(--tx3)">nenhum ✓</div>';
  document.getElementById('faltam-body').innerHTML =
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
       <div>
         <div style="font-size:11px;font-weight:600;color:var(--ok);margin-bottom:6px">✓ LANÇARAM (${lancaram.length})</div>
         ${colL}
       </div>
       <div>
         <div style="font-size:11px;font-weight:600;color:var(--wn);margin-bottom:6px">⏳ FALTAM (${faltam.length})</div>
         ${colF}
       </div>
     </div>`;
}

function renderDetalheMedia() {
  const body = document.getElementById('media-detalhe-body');
  if (!G_MEDIA_DETALHE) { body.innerHTML = '<div class="empty">Sem dados de concorrentes coletados.</div>'; return; }
  const { mediaPorSupervisor, mediaGeral } = G_MEDIA_DETALHE;
  let html = `<div class="ccard" style="margin-bottom:.6rem;text-align:center">
    <div class="cclbl">MÉDIA GERAL DA REDE</div>
    <div style="font-family:var(--mono);font-size:1.4rem;font-weight:700;color:var(--inf)">${fmtPrecoBRL(mediaGeral)}</div>
    <div style="font-size:.62rem;color:var(--tx3)">Média das ${Object.keys(mediaPorSupervisor).length} médias regionais abaixo</div>
  </div>`;
  Object.keys(mediaPorSupervisor).forEach(sup => {
    const { media, postos } = mediaPorSupervisor[sup];
    const cor = SUPCOR_MAP[sup] || '#8892a4';
    html += `<div class="reg-sup" style="margin-bottom:.5rem">
      <div class="reg-sup-hdr">
        <div class="reg-sup-nome" style="color:${cor}">${sup}</div>
        <div style="font-family:var(--mono);font-weight:700;color:${cor}">${fmtPrecoBRL(media)}</div>
      </div><div class="reg-posto-list">`;
    postos.forEach(p => {
      html += `<div class="reg-posto"><span>${p.posto}</span><span style="font-family:var(--mono)">${fmtPrecoBRL(p.media)}</span></div>`;
    });
    html += `</div></div>`;
  });
  body.innerHTML = html;
}

function montarFuelTabsComparar() {
  const wrap = document.getElementById('cmp-fuel-tabs');
  wrap.innerHTML = CMP_FUELS.map(f =>
    `<button class="fueltab${f.key === G_CMP_FUEL ? ' active' : ''}" onclick="cmpSetFuel('${f.key}')">${f.label}</button>`
  ).join('');
}
function montarStratTabsComparar() {
  const wrap = document.getElementById('cmp-strat-tabs');
  wrap.innerHTML = CMP_STRATS.map(s =>
    `<button class="strat-tab${s.key === G_CMP_STRAT ? ' active' : ''}" onclick="cmpSetStrat('${s.key}')">${s.label}</button>`
  ).join('');
  const atual = CMP_STRATS.find(s => s.key === G_CMP_STRAT);
  document.getElementById('cmp-strat-desc').textContent = atual ? atual.desc : '';
}

function cmpSetFuel(key)  { G_CMP_FUEL  = key; renderComparar(); }
function cmpSetStrat(key) { G_CMP_STRAT = key; renderComparar(); }
function cmpSetReg(val)   { G_CMP_REG   = val; renderComparar(); }
function cmpSetBand(val)  { G_CMP_BAND  = val; renderComparar(); }
function cmpSetRede(val)  { G_CMP_REDE  = val; renderComparar(); }
function cmpSetPosto(val) { G_CMP_POSTO = val; renderComparar(); }
// Toggle: clicar no botão ativo desliga (volta pro alfabético).
function cmpSetOrd(val)   { G_CMP_ORD = (G_CMP_ORD === val) ? '' : val; renderComparar(); }

// Renderiza os 2 botões de ordenação por preço no container #cmp-ord-btns.
// Cores do tema: verde (--ok) p/ "mais barato", vermelho (--dg) p/ "mais caro".
// Ativo = fundo levemente preenchido + borda na cor cheia.
function cmpMontarOrdBtns() {
  const wrap = document.getElementById('cmp-ord-btns');
  if (!wrap) return;
  const bAtivo = G_CMP_ORD === 'barato';
  const cAtivo = G_CMP_ORD === 'caro';
  wrap.innerHTML =
      `<button class="ftag" onclick="cmpSetOrd('barato')" style="color:var(--ok);`
    + `border-color:${bAtivo ? 'var(--ok)' : 'rgba(0,229,160,.35)'};`
    + `background:${bAtivo ? 'rgba(0,229,160,.15)' : 'transparent'}">↓ Mais barato</button>`
    + `<button class="ftag" onclick="cmpSetOrd('caro')" style="color:var(--dg);`
    + `border-color:${cAtivo ? 'var(--dg)' : 'rgba(255,107,107,.35)'};`
    + `background:${cAtivo ? 'rgba(255,107,107,.15)' : 'transparent'}">↑ Mais caro</button>`;
}
function cmpToggleSoMudou(chk) { G_CMP_SO_MUDOU = chk.checked; renderComparar(); }

// Chips de distância (Abaixo/Acima do nosso + Limpar) ficam INERTES com o filtro
// "Só quem mudou" ligado — a distância até o nosso preço sai da tela. Botão que
// não responde é pior que ausente: desabilita visualmente (.chip-inerte =
// opacidade + cursor default + pointer-events none) e reabilita ao desligar.
function cmpAtualizarChipsFaixa() {
  const inerte = G_CMP_SO_MUDOU;
  ['flt-abaixo', 'flt-acima', 'flt-todos-preco'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('chip-inerte', inerte);
  });
}

// Chips independentes: 'abaixo' e 'acima' alternam sozinhos (podem os 2
// ativos ao mesmo tempo); 'todos' = limpar os dois. `btn` não é mais usado
// (o estado manda no visual), mantido só p/ compat com o onclick do HTML.
function cmpSetFaixaPreco(btn, faixa) {
  if (faixa === 'abaixo')      G_CMP_ABAIXO = !G_CMP_ABAIXO;
  else if (faixa === 'acima')  G_CMP_ACIMA  = !G_CMP_ACIMA;
  else                         { G_CMP_ABAIXO = false; G_CMP_ACIMA = false; } // 'todos' = limpar
  const bA = document.getElementById('flt-abaixo');
  const bC = document.getElementById('flt-acima');
  const bL = document.getElementById('flt-todos-preco');
  if (bA) bA.classList.toggle('active', G_CMP_ABAIXO);
  if (bC) bC.classList.toggle('active', G_CMP_ACIMA);
  if (bL) bL.style.display = (G_CMP_ABAIXO || G_CMP_ACIMA) ? '' : 'none';
  renderComparar();
}

// ════════════════════════════════════════════════════════════════
// O CARD DA COMPARAÇÃO MUDOU DE CASA: shared/js/comparacao-card.js.
// De lá vêm cmpCardMatriz, cmpCalcCard, cmpStatsFuel, cmpSugeridoMatriz
// e os auxiliares CMP_FUELS_CARD, fmtPrecoBRL, seloDesatualizado e
// idSafe — este arquivo os consome pelo window, e o <script> do módulo
// carrega ANTES deste. Vivia duplicado aqui e no outro painel.
//
// O LÁPIS FICOU: cmpEditarVoce / cmpConfirmarVoce / cmpSalvarPrecoProprio
// / cmpCriarSolicitacao falam com a API e mexem no estado desta tela.
//
// Os filtros viraram parâmetro do card (ele não lê mais os G_CMP_* por
// escopo global); cmpOpcoes(), lá em cima junto dos let, é quem os empacota.
// ════════════════════════════════════════════════════════════════

// ── Ganchos do lápis (shared/js/comparacao-card.js) ──────────────
// O cmpEditarVoce/cmpConfirmarVoce vivem no módulo compartilhado, e o que
// eles não podem saber é (a) onde esta tela guarda a comparação e (b) o que
// esta tela faz depois de salvar. As duas coisas entram por aqui.
//
// O corpo do cmpAposSalvarPreco é a CAUDA ORIGINAL do cmpConfirmarVoce,
// movida sem alterar: o convite do GA, o re-render e o ✓ por combustível.
// Nos caminhos de desistência (preço inválido, preço igual) ele é chamado
// com salvou:false e flashFuels vazio, o que executa só o renderComparar()
// — exatamente o que aquelas linhas faziam antes.
window.cmpDadoDoPosto = (k) => G_COMPARACAO[k];

window.cmpAposSalvarPreco = async (ctx) => {
  // Regra do GA — NUNCA automático: ao salvar GC, oferece GA = GC + diferencial
  // do posto (dado.diferencial_ga, padrão 0,30).
  if (ctx.salvou && ctx.fuel === 'GC') {
    const dado = ctx.dado;
    const difGa = (dado && dado.diferencial_ga != null) ? Number(dado.diferencial_ga) : 0.30;
    const alvoGA = ctx.novo + difGa;
    if (window.confirm(`Aplicar também GA (aditivada) = GC + ${difGa.toFixed(2).replace('.', ',')} = R$ ${alvoGA.toFixed(2).replace('.', ',')}?`)) {
      const origGA = (dado.proprio && dado.proprio['GA'] !== null && dado.proprio['GA'] !== undefined) ? Number(dado.proprio['GA']) : null;
      const okGA = await cmpSalvarPrecoProprio(ctx.posto.ap, 'GA', alvoGA, origGA);
      if (okGA) {
        dado.proprio['GA'] = alvoGA;
        // GA também SEMPRE gera solicitação — só pula se o valor não mudou.
        if ((origGA === null || Math.abs(alvoGA - origGA) >= 0.005)
            && await cmpCriarSolicitacao(ctx.posto.ap, 'GA', origGA, alvoGA)) ctx.flashFuels.push('GA');
      }
    }
  }
  renderComparar();
  ctx.flashFuels.forEach(ff => cmpFlashCheck(ctx.k, ff));
};

// O overlay de revisões (cmpAplicarRevisoes) e as duas chamadas do lápis
// (cmpSalvarPrecoProprio / cmpCriarSolicitacao) também moraram aqui e hoje
// vêm do shared/js/comparacao-card.js, junto do cmpHojeISO que as três
// usam. O que ficou neste arquivo é só a parte que mexe em DOM e em estado
// desta tela: cmpEditarVoce, cmpConfirmarVoce e cmpFlashCheck.

// Concorrente `c` mudou de preço no combustível `f` entre ontem e hoje?
// Fonte de ontem = c.registroOntem (mesma origem que o filtro antigo usava).
// Só conta se o dado de hoje NÃO está desatualizado, tem leitura de ontem e
// |Δ| >= 0,5 centavo. Sem preço em algum lado → não conta.
function cmpConcMudou(c, f) {
  if (!c || c.desatualizado) return false;
  const h = c.registro ? c.registro[f] : undefined;
  const o = c.registroOntem ? c.registroOntem[f] : undefined;
  return h !== null && h !== undefined && o !== null && o !== undefined
    && Math.abs(Number(h) - Number(o)) >= 0.005;
}

// Filtros por POSTO na matriz, SEMPRE relativos ao combustível ativo
// (G_CMP_FUEL). AND lógico entre eles + com região/posto/bandeira. O mesmo
// critério pinta as células em cmpCardMatriz (esconder + destacar).
function cmpPostoPassaFiltros(dado) {
  const f = G_CMP_FUEL;
  const concs = dado.concorrentes || [];

  // 1) Só quem mudou de ontem→hoje: passa se ALGUM concorrente mudou no
  //    combustível ATIVO.
  if (G_CMP_SO_MUDOU && !concs.some(c => cmpConcMudou(c, f))) return false;

  // 2) Abaixo/Acima do nosso (chips independentes): passa se ALGUM
  //    concorrente estiver abaixo (ou acima) do nosso proprio[f] no
  //    combustível ativo. Sem proprio (sem base) → esconde se algum chip on.
  if (G_CMP_ABAIXO || G_CMP_ACIMA) {
    const ov = (dado.proprio && dado.proprio[f] !== null && dado.proprio[f] !== undefined) ? Number(dado.proprio[f]) : null;
    if (ov === null) return false;
    const algum = concs.some(c => {
      const cv = (c.registro && c.registro[f] !== null && c.registro[f] !== undefined) ? Number(c.registro[f]) : null;
      if (cv === null) return false;
      const d = cv - ov;
      return (G_CMP_ABAIXO && d < -0.005) || (G_CMP_ACIMA && d > 0.005);
    });
    if (!algum) return false;
  }

  return true;
}

// Melhor preço do card inteiro no fuel `f`, sob a ótica da ordenação: menor
// (ord 'barato') ou maior (ord 'caro') entre a linha Você e TODOS os
// concorrentes. null se ninguém tem preço no fuel (card vai pro fim da lista).
function cmpMelhorPrecoCard(dado, f, ord) {
  if (!dado) return null;
  const precos = [];
  if (dado.proprio && dado.proprio[f] != null) precos.push(Number(dado.proprio[f]));
  (dado.concorrentes || []).forEach(c => {
    if (c.registro && c.registro[f] != null) precos.push(Number(c.registro[f]));
  });
  if (!precos.length) return null;
  return ord === 'caro' ? Math.max(...precos) : Math.min(...precos);
}

// Card do filtro "Só quem mudou". A unidade passa a ser CONCORRENTE + COMBUSTÍVEL:
// só entra a combinação cujo preço de HOJE difere do de ONTEM, e a coluna "Mudou"
// mostra a variação do PRÓPRIO concorrente (hoje − ontem), não a distância até o
// nosso preço. Concorrente SEM coleta de ontem NÃO aparece (motivo real:
// coleta salva antes da IA ler a foto — vira verificação no Painel TI, não ruído
// aqui); as linhas omitidas são só CONTADAS para o log. Retorna { html:'', ... }
// quando o posto não tem nenhuma mudança → o card some da tela.
// Duas tabelas empilhadas, grades independentes: em cima a linha "Você" (azul,
// 1 coluna por combustível); embaixo as mudanças (5 colunas).
// Cores da tela: verde var(--ok) subiu · vermelho var(--dg) desceu.
function cmpCardMudancas(posto, dado) {
  const num = (v) => (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) ? Number(v) : null;
  const ordFuel = {}; CMP_FUELS_CARD.forEach((f, i) => { ordFuel[f.key] = i; });
  const linhas = [];
  let mudancas = 0, omitidas = 0;

  (dado.concorrentes || []).forEach(c => {
    CMP_FUELS_CARD.forEach(f => {
      const hoje = c.registro ? num(c.registro[f.key]) : null;
      if (hoje === null) return;                          // sem preço hoje → nada a mostrar
      const ontem = c.registroOntem ? num(c.registroOntem[f.key]) : null;
      if (ontem === null) { omitidas++; return; }         // sem base de ontem → NÃO entra (só conta)
      const d = hoje - ontem;
      if (Math.abs(d) < 0.005) return;                    // não mudou → some
      mudancas++;
      linhas.push({ nome: c.nome, comb: f.btn, ordF: ordFuel[f.key], ontem, hoje,
        mudouTxt: (d > 0 ? '+' : '') + Math.round(d * 100) + 'c',
        cor: d > 0 ? 'var(--ok)' : 'var(--dg)' });
    });
  });

  if (!linhas.length) return { html: '', mudancas: 0, omitidas };

  // Concorrente (alfabético) e, dentro, ordem canônica dos combustíveis.
  linhas.sort((a, b) => a.nome.localeCompare(b.nome) || (a.ordF - b.ordF));

  // ── Tabela de cima: linha "Você" em azul (reaproveita cmpm-row-voce/-rowlbl/
  // -preco da matriz — mesmo destaque, sem cor nova). 1 coluna por combustível. ──
  const voceHead = CMP_FUELS_CARD.map(f => `<th><span class="cmpm-colh">${f.btn}</span></th>`).join('');
  const voceCells = CMP_FUELS_CARD.map(f => {
    const v = (dado.proprio && dado.proprio[f.key] != null) ? Number(dado.proprio[f.key]) : null;
    return `<td>${v !== null ? `<span class="cmpm-preco">${fmtPrecoBRL(v)}</span>` : '<span class="cmpm-na">—</span>'}</td>`;
  }).join('');
  const voceTable = `<table class="cmpm-table cmpc-voce-table">
    <thead><tr><th class="cmpm-rowlbl"></th>${voceHead}</tr></thead>
    <tbody><tr class="cmpm-row-voce"><th class="cmpm-rowlbl">Você</th>${voceCells}</tr></tbody>
  </table>`;

  // ── Tabela de baixo: as mudanças (conc + comb) ──
  const rows = linhas.map(l => `<tr>
      <td class="cmpc-nome" title="${l.nome}">${l.nome}</td>
      <td class="cmpc-comb">${l.comb}</td>
      <td class="cmpc-num">${fmtPrecoBRL(l.ontem)}</td>
      <td class="cmpc-num">${fmtPrecoBRL(l.hoje)}</td>
      <td class="cmpc-mudou" style="color:${l.cor}">${l.mudouTxt}</td>
    </tr>`).join('');

  const html = `<div class="region-card cmpc-card" id="cmp-card-${idSafe(posto.k)}">
    <div class="cmpc-hdr">
      <span class="region-nome cmpc-posto">${posto.ap}</span>
      <!-- Contagem e botão num wrapper só: o .cmpc-hdr é space-between, e um
           TERCEIRO filho solto empurraria a contagem para o meio. -->
      <span class="cmpc-hdr-dir">
        <span class="cmpc-count">${mudancas} mudança${mudancas === 1 ? '' : 's'}</span>
        ${cmpBtnConferir(posto)}
      </span>
    </div>
    <div class="cmpc-wrap">${voceTable}</div>
    <div class="cmpc-wrap"><table class="cmpc-table">
      <!-- O CABECALHO USA AS MESMAS CLASSES DO CORPO. As celulas sempre
           estiveram alinhadas — medido: mesmo left e mesma largura em th e
           td, nos dois modulos, a 375px e a 1400px, com 5 th e 5 td. O que
           desalinhava era o TEXTO dentro da celula: .cmpc-num e .cmpc-mudou
           alinham o valor a DIREITA com !important, e o th ficava a
           ESQUERDA. Medido no celular, coluna de 56px: Ontem +10px, Hoje
           +11px, Mudou +22px de desvio entre titulo e valor — e 22px numa
           coluna de 56 le como coluna trocada.

           A classe no th NAO muda cor nem fonte: a regra
           ".cmpc-table thead th" tem especificidade maior para color e
           font-family. So o text-align vira, porque so ele e !important. -->
      <thead><tr><th>Concorrente</th><th>Comb</th>
        <th class="cmpc-num">Ontem</th>
        <th class="cmpc-num">Hoje</th>
        <th class="cmpc-mudou">Mudou</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
  return { html, mudancas, omitidas };
}

function renderComparar() {
  montarFuelTabsComparar();
  montarStratTabsComparar();
  cmpMontarOrdBtns();
  cmpAtualizarChipsFaixa();

  const fuel = G_CMP_FUEL;

  const ordAtivo = (G_CMP_ORD === 'barato' || G_CMP_ORD === 'caro');

  // Bandeira e REDE recortam os CONCORRENTES (não os nossos postos): o card do
  // meu posto continua, somem as linhas de concorrente fora do grupo; posto sem
  // nenhum concorrente no grupo some inteiro (no loop). Alimenta também as médias
  // e a ordenação, pra comparar meu preço SÓ contra o grupo selecionado.
  const filtroConcAtivo = !!(G_CMP_BAND || G_CMP_REDE);
  const concPassa = (c) => (!G_CMP_BAND || c.bandeira === G_CMP_BAND) && (!G_CMP_REDE || c.rede === G_CMP_REDE);
  const dadoFiltrado = (k) => {
    const d = G_COMPARACAO[k] || { proprio: null, proprioDesatualizado: false, concorrentes: [] };
    return filtroConcAtivo ? { ...d, concorrentes: (d.concorrentes || []).filter(concPassa) } : d;
  };

  const postos = MAP_POSTOS.filter(p => {
    if (G_CMP_POSTO && p.k !== G_CMP_POSTO) return false;
    if (G_CMP_REG  && p.reg  !== G_CMP_REG)  return false;
    return true;
  });
  if (ordAtivo) {
    // Ranking pelo MELHOR preço do card no fuel ativo (min no 'barato', max no
    // 'caro'). Cards sem preço nenhum no fuel vão pro fim; entre eles, alfabético.
    postos.sort((a, b) => {
      const pa = cmpMelhorPrecoCard(dadoFiltrado(a.k), fuel, G_CMP_ORD);
      const pb = cmpMelhorPrecoCard(dadoFiltrado(b.k), fuel, G_CMP_ORD);
      if (pa === null && pb === null) return a.ap.localeCompare(b.ap);
      if (pa === null) return 1;
      if (pb === null) return -1;
      return G_CMP_ORD === 'barato' ? pa - pb : pb - pa;
    });
  } else {
    postos.sort((a, b) => a.ap.localeCompare(b.ap));
  }

  let somaMinha = 0, contMinha = 0, somaConc = 0, contConc = 0;
  let cardsHtml = '';
  let posOrd = 0; // posição só entre os cards efetivamente renderizados
  let totMudancas = 0, totOmitidas = 0; // só usados com o filtro ligado

  postos.forEach(posto => {
    const dado = dadoFiltrado(posto.k);

    // Filtro de grupo ativo e sem NENHUM concorrente no grupo → card some inteiro
    // (e o posto não entra nas médias do rodapé).
    if (filtroConcAtivo && !dado.concorrentes.length) return;

    // Agregados do rodapé (Minha média / Média concorrência) continuam no
    // combustível GLOBAL (G_CMP_FUEL) — a matriz não altera isso. Com filtro
    // ligado, refletem só o grupo selecionado (dado já vem recortado).
    const glob = cmpCalcCard(dado, fuel, cmpOpcoes());
    if (glob.ownVal !== null) { somaMinha += glob.ownVal; contMinha++; }
    glob.competidores.forEach(c => { somaConc += c.preco; contConc++; });

    // Card visível se o posto tem QUALQUER dado (próprio ou concorrente).
    if (!dado.proprio && !dado.concorrentes.length) return;

    if (G_CMP_SO_MUDOU) {
      // Filtro ligado: layout de variações (conc + comb). Some se não há
      // nenhuma linha (nem mudança, nem sem-base). Abaixo/Acima (distância até o
      // nosso preço) não se aplicam aqui — a distância sai da tela.
      const r = cmpCardMudancas(posto, dado);
      totMudancas += r.mudancas; totOmitidas += r.omitidas;   // omitidas conta mesmo se o card sumir
      if (!r.html) return;
      posOrd += 1;
      // Faixa de fotos DENTRO do mesmo .region-card, igual ao ramo da matriz
      // logo abaixo: o cmpCardMudancas devolve o card já fechado, então a
      // faixa entra antes do último </div>. Concatenar depois a deixaria
      // solta entre dois cards, com a largura do contêiner e não a do card.
      const corteMud = r.html.lastIndexOf('</div>');
      cardsHtml += (corteMud < 0)
        ? r.html + cmpFotosHtml(posto, dado)
        : r.html.slice(0, corteMud) + cmpFotosHtml(posto, dado) + r.html.slice(corteMud);
    } else {
      // Filtro desligado: comportamento atual, intacto.
      if (!cmpPostoPassaFiltros(dado)) return;
      posOrd += 1;
      // Matriz + faixa de fotos, dentro do MESMO .region-card. O
      // cmpCardMatriz devolve o card já fechado, então a faixa entra antes
      // do último </div> — concatenar depois a deixaria solta entre cards.
      const cardHtml = cmpCardMatriz(posto, dado, ordAtivo ? posOrd : null, cmpOpcoes());
      const corte = cardHtml.lastIndexOf('</div>');
      cardsHtml += (corte < 0)
        ? cardHtml + cmpFotosHtml(posto, dado)
        : cardHtml.slice(0, corte) + cmpFotosHtml(posto, dado) + cardHtml.slice(corte);
    }
  });

  document.getElementById('cmp-regions').innerHTML = cardsHtml || '<div class="empty">Nenhum posto para esse filtro.</div>';
  if (G_CMP_SO_MUDOU) {
    console.info(`[Comparação] "só quem mudou": ${totMudancas} mudança(s), ${totOmitidas} omitida(s) por falta de base, ${posOrd} card(s).`);
  }

  const minhaAvg = contMinha ? somaMinha / contMinha : null;
  const concAvg  = contConc  ? somaConc  / contConc  : null;
  let diffTxt = '-', diffCor = 'var(--tx3)';
  if (minhaAvg !== null && concAvg !== null) {
    const d = minhaAvg - concAvg;
    diffCor = d > 0 ? 'var(--dg)' : 'var(--ok)';
    diffTxt = (d > 0 ? '+' : '') + fmtPrecoBRL(Math.abs(d)) + (d > 0 ? ' acima' : ' abaixo');
  }
  document.getElementById('cmp-myavg').innerHTML = `
    <div class="myavg-card mine">
      <div class="myavg-lbl">Minha média</div>
      <div class="myavg-val" style="color:var(--ac)">${minhaAvg !== null ? fmtPrecoBRL(minhaAvg) : '--'}</div>
      <div class="myavg-sub" style="color:var(--ac)">${contMinha} posto(s)</div>
    </div>
    <div class="myavg-card comp">
      <div class="myavg-lbl">Média concorrência</div>
      <div class="myavg-val">${concAvg !== null ? fmtPrecoBRL(concAvg) : '--'}</div>
      <div class="myavg-sub" style="color:${diffCor}">${diffTxt}</div>
    </div>`;

}

// Auto-refresh só quando o painel está aberto e a aba Comparação ativa.
function iniciarAutoRefreshComparar() {
  if (_cmpRefreshTimer) clearInterval(_cmpRefreshTimer);
  _cmpRefreshTimer = setInterval(() => {
    if (!document.hidden && document.getElementById('s-comp')?.classList.contains('active')) {
      carregarDadosComparar();
    }
  }, INTERVALO_ATUALIZACAO);
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!USUARIO) return; // exigirSessao já redirecionou
  aplicarTema(localStorage.getItem('jb_theme') || 'dark');

  const escolha = localStorage.getItem(CHAVE_VERSAO);
  if (escolha === 'mobile') {
    // Escolha lembrada: vai direto pro mobile.
    window.location.href = caminhoRaiz() + 'modulos/admin/';
  } else if (escolha === 'desktop') {
    // Escolha lembrada: abre o painel direto, sem a tela de escolha.
    abrirPainelDesktop();
  } else {
    // Sem escolha salva: mostra a tela de escolha.
    document.getElementById('tela-escolha').style.display = 'flex';
  }
});
