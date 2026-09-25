# jbretas-sistema — frontend (Cloudflare Workers)

> Este arquivo mora em `.claude/` e **não** na raiz de propósito: o deploy
> publica a raiz inteira e o `.assetsignore` não exclui `CLAUDE.md` — na raiz,
> ele ficaria público na internet.

## O deploy publica a ÁRVORE, não um commit

`npx wrangler deploy` — o `wrangler.jsonc` tem `assets.directory: "."`, então
vai ao ar **tudo que estiver na pasta**, filtrado só pelo `.assetsignore`.
Arquivo em edição, não commitado, da outra conversa: vai junto.

**`git push` NÃO deploya.** Aqui não há integração Git nem GitHub Actions.
(No `jbretas-api` é o contrário — lá o push É o deploy.)

## Fluxo

```
node bump.js                      # cache-busting dos HTML (não commita nada)
git add <os HTML alterados, pelo nome>
git commit -m "..."
git status                        # tem de estar LIMPO
npx wrangler deploy
```

O `bump.js` toca ~15 HTMLs de uma vez — é a maior fonte de árvore suja aqui.
Um hook bloqueia o deploy se `git status --porcelain` tiver qualquer saída.

## Nunca deploye sem o Maycon pedir

Nem "para testar", nem porque o commit ficou pronto. Produção é decisão dele.

## Layout: tela em produção não se mexe

Ao **acrescentar** algo numa tela que já está no ar:

- **Não mexa no que existe.** Larguras, tamanhos, espaçamentos e posições
  ficam como estão.
- Informação nova entra **ao lado / à direita**, alinhada com o que já existe.
- **Espaço sobrando fica vazio.** É o certo, não um defeito.
- **Nunca** estique barras, cards ou colunas para preencher a tela.

Quem usa a tela decorou onde as coisas estão. Reflow para "aproveitar o
espaço" custa mais do que o espaço vale.

## Testes

`testes/` tem harnesses HTML que montam o código de produção com `apiFetch`
dublado. Estão fora do deploy (`.assetsignore`) e fora do `bump.js`. Rode no
navegador antes de deployar.
