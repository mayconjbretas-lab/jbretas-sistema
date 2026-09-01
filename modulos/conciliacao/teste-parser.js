// ================================================================
// Testa o PARSER da colagem, extraido do app.js. Roda em node, sem
// navegador. `npm` nao existe neste repo — rode direto:
//     node modulos/conciliacao/teste-parser.js
//
// O parser so traduz texto em linhas; quem valida e a API. Por isso o
// que se testa aqui e: achou o cabecalho? separou os blocos? ligou cada
// bloco ao posto certo? converteu a data?
// ================================================================
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function trecho(de, ate) {
  const i = src.indexOf(de);
  if (i < 0) { console.error('nao achei: ' + de); process.exit(1); }
  const f = src.indexOf(ate, i);
  return src.slice(i, f + ate.length);
}
const fonte = [
  ['const semAc = (s) =>', ";\n"],
  ['function dataISO(v) {', '\n}'],
  ['function partirRotulo(rot) {', '\n}'],
  ['function parsearColagem(texto) {', '\n}'],
  ['function parsearLongo(grade, iCab, cab) {', '\n}'],
  ['function parsearLargo(grade, iCab, cab) {', '\n}'],
].map(([a, b]) => trecho(a, b)).join('\n');
const { parsearColagem, dataISO, partirRotulo, semAc } =
  new Function(fonte + '\n return { parsearColagem, dataISO, partirRotulo, semAc };')();

let falhas = 0;
const checar = (ok, txt) => { console.log((ok ? '  ok   ' : ' FALHA ') + txt); if (!ok) falhas++; };
const T = (linhas) => linhas.join('\n');

console.log('=== normalizacao ===');
checar(semAc(' início ') === 'INICIO', 'semAc tira acento e caixa');
checar(dataISO('01/07/2026') === '2026-07-01', 'DD/MM/AAAA -> ISO');
checar(dataISO('1/7/2026') === '2026-07-01', 'sem zero a esquerda');
checar(dataISO('2026-07-01') === '2026-07-01', 'ISO passa direto');
checar(dataISO('01/07/26') === '01/07/26', 'ano de 2 digitos NAO e adivinhado');
checar(partirRotulo('P. ITAPOA · BANHEIRO').equipamento === 'BANHEIRO', 'rotulo com · separa');
checar(partirRotulo('P. ITAPOA - BANHEIRO').equipamento === 'BANHEIRO', 'com hifen tambem');
checar(partirRotulo('P. JA').equipamento === '', 'sem separador, so posto');
checar(partirRotulo('P. LOURA EMPREENDIMENTOS').posto === 'P. LOURA EMPREENDIMENTOS',
  'nome com espacos NAO e partido por engano');

console.log('\n=== formato LARGO (o da planilha) ===');
const largo = T([
  'P. JA\t\t\t\t\tP. ITAPOA · BANHEIRO',
  'Data\tInicial\tFinal\tDiferença\tValor\tData\tInicial\tFinal\tDiferença\tValor',
  '01/07/2026\t1000\t1300\t300\t300,00\t01/07/2026\t500\t612\t112\t112,00',
  '01/08/2026\t1300\t1655\t355\t355,00\t01/08/2026\t612\t700\t88\t88,00',
]);
const rl = parsearColagem(largo);
checar(!rl.erro, 'sem erro: ' + (rl.erro || ''));
checar(rl.formato === 'largo', 'detectou LARGO');
checar(rl.blocos === 2, '2 blocos');
checar(rl.linhas.length === 4, '4 linhas (2 blocos x 2 datas)');
const ja = rl.linhas.filter(l => l.posto === 'P. JA');
checar(ja.length === 2 && ja[0].equipamento === '', 'P. JA sem equipamento (a API infere)');
checar(ja[0].data === '2026-07-01' && ja[0].inicial === '1000' && ja[0].final === '1300', 'valores do 1o bloco');
const it = rl.linhas.filter(l => l.posto === 'P. ITAPOA');
checar(it.length === 2 && it[0].equipamento === 'BANHEIRO', 'P. ITAPOA traz o equipamento do rotulo');
checar(it[1].inicial === '612' && it[1].final === '700', 'segunda data do 2o bloco');
checar(rl.linhas.every(l => l.valor_recolhido !== ''), 'coluna Valor virou valor_recolhido');

console.log('\n=== blocos de tamanhos diferentes ===');
// P. JA tem 3 meses; P. ITAPOA so 1. A linha vazia do bloco curto nao
// pode virar lancamento fantasma.
const desigual = T([
  'P. JA\t\t\t\t\tP. ITAPOA · BANHEIRO',
  'Data\tInicial\tFinal\tDiferença\tValor\tData\tInicial\tFinal\tDiferença\tValor',
  '01/07/2026\t1000\t1300\t300\t300,00\t01/07/2026\t500\t612\t112\t112,00',
  '01/08/2026\t1300\t1655\t355\t355,00\t\t\t\t\t',
  '01/09/2026\t1655\t1700\t45\t45,00',
]);
const rd = parsearColagem(desigual);
checar(rd.linhas.length === 4, 'so 4 lancamentos (3 do JA + 1 do ITAPOA), sem fantasma');
checar(rd.linhas.filter(l => l.posto === 'P. ITAPOA').length === 1, 'ITAPOA com 1 so');

console.log('\n=== celula mesclada (nome so na 1a coluna do bloco) ===');
const mesclado = T([
  'P. JA\t\t\t\t\tP. TUNEL · CALIBRADOR\t\t\t\t',
  'Data\tInicial\tFinal\tDiferença\tValor\tData\tInicial\tFinal\tDiferença\tValor',
  '01/07/2026\t10\t20\t10\t10,00\t01/07/2026\t30\t45\t15\t15,00',
]);
const rm = parsearColagem(mesclado);
checar(rm.linhas.length === 2 && rm.linhas[1].posto === 'P. TUNEL', 'rotulo do 2o bloco encontrado');

console.log('\n=== formato LONGO ===');
const longo = T([
  'Posto\tData\tEquipamento\tInicial\tFinal\tValor recolhido',
  'P. JA\t01/07/2026\tCALIBRADOR\t1000\t1300\t300,00',
  'P. ITAPOA\t01/07/2026\tBANHEIRO\t500\t612\t112,00',
]);
const rlo = parsearColagem(longo);
checar(!rlo.erro && rlo.formato === 'longo', 'detectou LONGO');
checar(rlo.linhas.length === 2, '2 linhas');
checar(rlo.linhas[1].equipamento === 'BANHEIRO' && rlo.linhas[1].data === '2026-07-01', 'campos do longo');

console.log('\n=== colagens que devem falhar com explicacao ===');
checar(/cabecalho|cabeçalho/i.test(parsearColagem('bla\tble\nfoo\tbar').erro || ''), 'sem cabecalho: diz o que falta');
checar(/Nada colado/.test(parsearColagem('').erro || ''), 'vazio');
const semNome = T([
  'Data\tInicial\tFinal\tDiferença\tValor',
  '01/07/2026\t10\t20\t10\t10,00',
]);
checar(/nome do posto/i.test(parsearColagem(semNome).erro || ''), 'largo sem a linha dos nomes: avisa');

console.log('\n=== a coluna Diferenca e ignorada de proposito ===');
const difErrada = T([
  'P. JA',
  'Data\tInicial\tFinal\tDiferença\tValor',
  '01/07/2026\t1000\t1300\t999\t300,00',
]);
const rdi = parsearColagem(difErrada);
checar(rdi.linhas[0].inicial === '1000' && rdi.linhas[0].final === '1300',
  'leitura vem de Inicial/Final; a Diferenca conferida na planilha nao vira fonte');
checar(rdi.linhas[0].diferenca === undefined, 'Diferenca nem e carregada');

console.log(falhas ? '\n*** ' + falhas + ' FALHA(S) ***' : '\nTodos passaram.');
process.exit(falhas ? 1 : 0);
