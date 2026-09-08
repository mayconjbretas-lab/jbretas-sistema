# testes/

Testes de tela que precisam de DOM de verdade. **Não vão para o Cloudflare** —
`testes/` está no `.assetsignore`.

## Como rodar

Sobe um servidor estático na raiz do repo e abre a página:

```bash
npx --yes serve -l 5501 .
```

Depois `http://localhost:5501/testes/custo-fluxo`. Verde = passou; o rodapé
conta as falhas.

**Sem o `.html` na URL, de propósito**: o `serve` redireciona `/x.html` para
`/x` e **descarta a query string** no caminho — com `.html` o `?arquivo=`
abaixo é silenciosamente ignorado e o teste roda no módulo do repo achando que
rodou noutro.

## custo-fluxo.html

Fluxo da importação de custo (Logística → Custo & Margem → Importar planilha),
pelo **caminho do usuário**: `__cmImportFile` com um `File` de verdade, o
`dry_run` interceptado no `window.fetch`, o modal montado pelo próprio módulo,
e os handlers públicos `__cmiEscopo` / `__cmiDataSel`. As afirmações são sobre
o **DOM resultante** — card, botão e seções.

### Por que ele existe

Um bug foi para produção com testes verdes. Os testes de então injetavam
`_cmiDataSel` como parâmetro e chamavam `bloqueiaAqui` / `htmlBloqueantes`
isolados, então a sequência real nunca rodava: `_cmiDataSel` começa **nulo**
(o `__cmImportFile` zera antes do `dry_run`) e era resolvido no meio do
`renderPreviaImport`. As leituras anteriores a essa linha viam `null`, e
`null` significa "planilha inteira", onde todo bloqueante trava. A tela
mostrava `4/4 travam` com Gravar desabilitado enquanto a seção, montada
depois, classificava certo os 4 problemas como sendo de outros dias.

Teste de unidade não pega isso. Só pega quem monta a tela na ordem real.

### O que ele afirma

1. o modal é montado e o `dry_run` sai sem filtro de data;
2. na 1ª abertura: card `0/4`, sem vermelho, botão habilitado com
   `Gravar 158 linhas (08/09)`, uma seção âmbar com os 4 problemas;
3. alternar para "Planilha inteira" e voltar mantém tudo coerente;
4. trocar a data no seletor atualiza **card, botão e seção no mesmo passo** —
   incluindo escolher um dia que TEM problema (card `1/4`, botão travado,
   seção vermelha nomeando a data + âmbar com os outros 3);
5. card = seção = botão em 3 datas e na planilha inteira;
6. gravar de verdade: o corpo sai com `de === ate === ` a data do botão e a
   API aceita — o botão não promete o que o servidor recusa.

### Provando que ele pega regressão

`?arquivo=<url>` carrega outra cópia do módulo. Foi assim que se confirmou que
o teste discrimina: apontado para a versão com o bug deu **10 falhas** (card
`4/4`, botão `disabled`, rótulo `Gravar`, e o card nunca atualizado ao trocar
a data); no módulo corrigido, **0**.

```bash
git show <commit-antigo>:modulos/logistica/custo-margem.js > testes/velho.js
# depois: /testes/custo-fluxo?arquivo=velho.js   (sem .html — ver acima)
# e apague o velho.js: ele não deve ser commitado
```
