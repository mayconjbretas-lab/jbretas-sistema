// ================================================================
// JBRETAS SISTEMA — Worker de borda
//
// FAZ UMA COISA SÓ: manda http para https. Todo o resto é entregue pelo
// runtime de assets, intacto, via env.ASSETS.fetch().
//
// POR QUE PRECISA DE CÓDIGO. `*.workers.dev` NÃO redireciona http para https
// por padrão — medido em 17/09/2026: `http://jbretas-sistema...workers.dev/`
// respondia 200 com a página de login inteira (7.747 bytes) e o
// shared/js/auth.js em claro. Sem zona própria no painel, não há o botão
// "Always Use HTTPS" para marcar, e `_headers` só acrescenta cabeçalho, não
// redireciona. Sobra o Worker.
//
// O RISCO QUE ISSO FECHA não é o roubo da senha em trânsito (o POST do login
// já vai para https://, ver shared/js/config.js). É pior: servido por http,
// o auth.js pode ser TROCADO no caminho — wifi de posto, hotspot, DNS
// envenenado — e o script adulterado manda as credenciais para onde quiser,
// com a cara da tela certa.
//
// run_worker_first: true NO wrangler.json É OBRIGATÓRIO AQUI. Com o padrão
// (assets primeiro), este script só rodaria quando NENHUM asset casasse — e
// `GET /` por http casa com o index.html, então o redirecionamento nunca
// aconteceria justamente no caso que importa. O custo é que toda requisição
// passa a invocar o Worker.
//
// 301 e não 302: é permanente e os navegadores o guardam. Com o HSTS que o
// _headers manda (max-age de 1 ano), a segunda visita já nem chega ao 80 —
// o navegador troca o esquema sozinho, sem ir à rede. O 301 é o que cobre a
// PRIMEIRA visita, a única que o HSTS não alcança.
// ================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      // Mantém caminho, query e hash. O hash nem chega ao servidor, mas a
      // URL é reconstruída inteira de propósito: se um dia isto virar
      // redirecionamento de caminho, o lugar já está certo.
      return Response.redirect(url.toString(), 301);
    }
    // ASSETS.fetch entrega o arquivo E aplica o _headers: os headers de
    // segurança continuam saindo por ele, não são repetidos aqui. Duas
    // fontes para o mesmo header é como se acaba com Strict-Transport-Security
    // duplicado na resposta.
    return env.ASSETS.fetch(request);
  },
};
