// ================================================================
// JBRETAS SISTEMA — shared/js/painel-switch.js
// Alternador ADM / TI no cabeçalho, para quem tem a flag `ti`.
//
// PROBLEMA: a conta com ti=true abre os dois painéis, mas trocar de um
// para o outro só dava editando a URL na mão.
//
// SÓ APARECE PARA perfil ADM **E** ti === true. Hoje isso é uma conta
// só (as outras 54 têm ti nulo/false), e um ADM comum continua vendo
// apenas o ADM — não há nem o botão nem a dica de que o TI existe.
//
// SELF-EXECUTÁVEL, mesmo padrão do gerente-nav.js e da faixa "vendo
// como" do auth.js: injeta o controle + o CSS via <style>, sem tocar
// no base.css nem no CSS de nenhum painel. Um lugar só decide quem vê,
// como fica e para onde vai; painel novo depois é uma linha no PAINEIS.
//
// A SESSÃO ATRAVESSA SOZINHA. Token e usuário vivem no localStorage da
// mesma origem, então navegar entre /modulos/painel-adm/ e
// /modulos/painel-ti/ não passa por login. Por isso o destino é um <a>
// href de verdade e não location.href: abrir em nova aba, meio-clique e
// o "voltar" do navegador funcionam de graça, e não há nada a
// "transportar" na troca.
//
// IMPERSONAÇÃO SE RESOLVE SOZINHA. Ao entrar como outro usuário, o
// painel-ti troca `jbretas_usuario` pelo alvo (que não tem ti=true) e
// guarda o original em jbretas_ti_backup. Como a condição lê o usuário
// CORRENTE, o alternador desaparece enquanto se está vendo como outra
// pessoa — que é o certo: quem está impersonado não deve pular para o
// TI. Voltar ao TI continua sendo pela faixa "vendo como".
// ================================================================
(function () {
  // Painéis do alternador: `key` é a pasta em /modulos/, usada tanto na
  // detecção do painel atual (location.pathname) quanto no destino.
  const PAINEIS = [
    { key: 'painel-adm', rot: 'ADM', titulo: 'Painel ADM' },
    { key: 'painel-ti',  rot: 'TI',  titulo: 'Painel TI'  },
  ];

  // O ADM MOBILE (/modulos/admin/) entra como painel reconhecido, e NÃO como
  // um terceiro item do PAINEIS — item novo ali viraria um terceiro segmento
  // em TODOS os painéis, e o desktop passaria a mostrar "ADM | TI | ADM".
  //
  // NO MOBILE SAI UM SEGMENTO SÓ: o TI. O cabeçalho de lá é uma .tb-right com
  // display:flex e SEM flex-wrap, já com quatro botões e o "ao vivo" dentro
  // (Desktop, tema, recarregar, sair). O segmento ADM seria peso morto — a
  // pessoa já está no ADM — custando a largura que falta a 375px.
  const ADM_MOBILE = 'admin';

  function injetarEstilo() {
    if (document.getElementById('painel-switch-style')) return;
    const st = document.createElement('style');
    st.id = 'painel-switch-style';
    st.textContent =
      // Casca com a MESMA linguagem visual do .btn-mobile do painel-adm
      // (surface2 / border2, mono .72rem 700, radius 8) para o cabeçalho
      // não ganhar um terceiro estilo de botão. O painel-ti não tem
      // .btn-mobile no CSS dele, então a regra vem daqui e os dois ficam
      // idênticos sem duplicar CSS em dois arquivos.
      '.pswitch{display:inline-flex;align-items:center;gap:2px;' +
        'background:var(--surface2);border:1px solid var(--border2);' +
        'border-radius:8px;padding:2px;white-space:nowrap}' +
      '.pswitch-seg{font-family:var(--mono);font-size:.72rem;font-weight:700;' +
        'letter-spacing:.03em;padding:.3rem .7rem;border-radius:6px;' +
        'border:1px solid transparent;color:var(--text3);' +
        'text-decoration:none;line-height:1.2;display:inline-block}' +
      // O segmento de DESTINO é um link: precisa de :hover e de foco visível
      // pelo teclado (o resto do cabeçalho são <button>, que já têm o padrão
      // do navegador).
      'a.pswitch-seg:hover{color:var(--accent);border-color:var(--border2)}' +
      'a.pswitch-seg:focus-visible{outline:2px solid var(--accent);outline-offset:1px}' +
      // ATIVO marcado com a mesma convenção dos dois painéis (.fueltab.active,
      // .ti-tab.active): fundo accent-dim, borda e texto accent.
      '.pswitch-seg.ativo{background:var(--accent-dim);border-color:var(--accent);' +
        'color:var(--accent);cursor:default}';
    // SEM media query de propósito. Eu havia encolhido a fonte para .68rem em
    // ≤480px, mas o .btn-mobile ao lado NÃO encolhe — ficariam dois tamanhos
    // de fonte vizinhos no mesmo cabeçalho, o oposto da consistência que se
    // quer. São duas palavras curtas (ADM, TI); se algum dia apertar, é
    // problema do cabeçalho inteiro e não deste controle.
    document.head.appendChild(st);
  }

  function injetar() {
    if (document.getElementById('painel-switch')) return;

    // Sem auth.js carregado não há como saber quem é: não injeta nada.
    if (typeof getUsuarioLogado !== 'function') return;
    const u = getUsuarioLogado();
    if (!u || u.perfil !== 'ADM' || u.ti !== true) return;

    // Painel atual pelo caminho. Fora dos painéis reconhecidos (não deveria
    // acontecer, o script só é carregado por eles) não injeta.
    //
    // A ORDEM DO TESTE IMPORTA: o PAINEIS vem primeiro porque '/admin/' NÃO
    // aparece em '/modulos/painel-adm/' (ali é "-adm/", e "admin" com i e n
    // não está na cadeia) — mas o contrário custaria caro se um dia o nome de
    // pasta mudar, e testar o específico antes do genérico é a ordem segura.
    const path = location.pathname;
    let atual = PAINEIS.find(p => path.indexOf('/' + p.key + '/') !== -1);
    const noMobile = !atual && path.indexOf('/' + ADM_MOBILE + '/') !== -1;
    if (noMobile) atual = PAINEIS[0];   // o ADM mobile É o painel ADM
    if (!atual) return;

    // Um segmento no mobile (só o destino), os dois no desktop.
    const segs = noMobile ? PAINEIS.filter(p => p.key === 'painel-ti') : PAINEIS;

    const raiz = (typeof caminhoRaiz === 'function') ? caminhoRaiz() : '/';
    const cx = document.createElement('div');
    cx.className = 'pswitch';
    cx.id = 'painel-switch';
    cx.setAttribute('role', 'group');
    cx.setAttribute('aria-label', 'Alternar painel');
    cx.innerHTML = segs.map(p => {
      // O painel em que já se está sai como <span>, não como link: clicar
      // no que você já está aberto recarregaria a página sem motivo.
      if (p.key === atual.key) {
        return '<span class="pswitch-seg ativo" aria-current="page" title="' +
               p.titulo + ' (atual)">' + p.rot + '</span>';
      }
      return '<a class="pswitch-seg" href="' + raiz + 'modulos/' + p.key + '/"' +
             ' title="Ir para o ' + p.titulo + '">' + p.rot + '</a>';
    }).join('');

    // MESMA POSIÇÃO NOS DOIS: antes do botão de tema, que é onde o
    // "Versão Mobile" fica no painel-adm. Ancorar no #theme-btn e não no
    // fim da .topbar-right mantém o alternador longe do SAIR.
    const tema = document.getElementById('theme-btn');
    if (tema && tema.parentNode) {
      tema.parentNode.insertBefore(cx, tema);
      return;
    }
    const dir = document.querySelector('.topbar-right');
    if (dir) dir.appendChild(cx);
  }

  function init() { injetarEstilo(); injetar(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
