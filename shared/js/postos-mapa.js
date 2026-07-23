// ================================================================
// shared/js/postos-mapa.js
// Coordenadas e metadados dos 37 postos próprios, para uso no mapa
// do painel ADM. Extraído do AppPainel/js/config.js (MAP_POSTOS),
// já com as correções v3/v4 aplicadas (BRUNA duplicada removida,
// BEATRIZ corrigida, coordenadas validadas).
//
// Este arquivo NÃO depende de nenhuma tabela do Supabase — é dado
// estático de geolocalização. As cores por supervisor batem com o
// AppPainel original.
// ================================================================

const MAP_POSTOS = [
  {k:"JA",                   ap:"P. JA",                    lat:-19.9581, lng:-43.9571, sup:"Mauricio", banda:"Ipiranga",        reg:"metro"},
  {k:"ITAPOA",               ap:"P. ITAPOA",                lat:-19.9198, lng:-43.9814, sup:"Mauricio", banda:"Shell",           reg:"metro"},
  {k:"MANGABEIRAS",          ap:"P. MANGABEIRAS",           lat:-19.9600, lng:-43.9610, sup:"Mauricio", banda:"Shell",           reg:"metro"},
  {k:"DIFERENCIAL",          ap:"P. DIFERENCIAL",           lat:-19.9182, lng:-43.9368, sup:"Mauricio", banda:"Rede Flex",       reg:"metro"},
  {k:"ARAPONGA",             ap:"P. ARAPONGA",              lat:-19.9620, lng:-43.9500, sup:"Mauricio", banda:"Ipiranga",        reg:"metro"},
  {k:"URBANO FERRAZ",        ap:"P. URBANO FERRAZ",         lat:-19.9300, lng:-43.9540, sup:"Mauricio", banda:"BR/Petrobras",    reg:"metro"},
  {k:"ALEX",                 ap:"P. ALEX",                  lat:-19.9550, lng:-43.9320, sup:"Mauricio", banda:"Ipiranga",        reg:"metro"},
  {k:"BERNARDO",             ap:"P. BERNARDO",              lat:-19.9900, lng:-43.9000, sup:"Mauricio", banda:"Shell",           reg:"metro"},
  {k:"BOMBOM MATRIZ",        ap:"P. BOMBOM MATRIZ",         lat:-19.9200, lng:-43.9380, sup:"Mauricio", banda:"Ipiranga",        reg:"metro"},
  {k:"TUNEL",                ap:"P. TUNEL",                 lat:-19.9050, lng:-43.9470, sup:"Fabricio", banda:"BR/Petrobras",    reg:"metro"},
  {k:"TRANCOSO",             ap:"P. TRANCOSO",              lat:-19.9050, lng:-43.9300, sup:"Fabricio", banda:"Ipiranga",        reg:"metro"},
  {k:"ANA LUCIA",            ap:"P. ANA LUCIA",             lat:-19.8900, lng:-43.8260, sup:"Fabricio", banda:"BR/Petrobras",    reg:"metro"},
  {k:"SANTA INES - JOAQUIM", ap:"P. SANTA INES - JOAQUIM",  lat:-19.9350, lng:-44.0630, sup:"Fabricio", banda:"Shell",           reg:"metro"},
  {k:"SAO BERNARDO",         ap:"P. SAO BERNARDO",          lat:-19.8700, lng:-43.9290, sup:"Fabricio", banda:"Ipiranga",        reg:"metro"},
  {k:"BAHAMAS",              ap:"P. BAHAMAS",               lat:-19.9150, lng:-43.9300, sup:"Fabricio", banda:"Ipiranga",        reg:"metro"},
  {k:"SERENA COLIBRI",       ap:"P. SERENA COLIBRI",        lat:-19.8140, lng:-44.0650, sup:"Fabricio", banda:"Ipiranga",        reg:"metro"},
  {k:"BRUNA",                ap:"P. BRUNA",                 lat:-19.8954, lng:-43.9550, sup:"Gledson",  banda:"BR/Petrobras",    reg:"metro"},
  {k:"TOPAZIO",              ap:"P. TOPAZIO",               lat:-19.7740, lng:-44.0530, sup:"Paulo",    banda:"BR/Petrobras",    reg:"metro"},
  {k:"JOCA",                 ap:"P. JOCA",                  lat:-19.9290, lng:-43.9730, sup:"Paulo",    banda:"Ipiranga",        reg:"metro"},
  {k:"LOURA EMPREENDIMENTOS",ap:"P. LOURA EMPREENDIMENTOS", lat:-19.9384, lng:-44.0901, sup:"Paulo",    banda:"Shell",           reg:"metro"},
  {k:"AVIVA",                ap:"P. AVIVA",                 lat:-19.7820, lng:-44.0750, sup:"Paulo",    banda:"Ipiranga",        reg:"metro"},
  {k:"SAO LUIZ RL",          ap:"P. SAO LUIZ RL",           lat:-19.7470, lng:-44.0830, sup:"Paulo",    banda:"Ipiranga",        reg:"metro"},
  {k:"PLANALTO",             ap:"P. PLANALTO",              lat:-19.8272, lng:-44.0072, sup:"Paulo",    banda:"BR/Petrobras",    reg:"metro"},
  {k:"SANTA MARIA",          ap:"P. SANTA MARIA",           lat:-19.8000, lng:-44.0750, sup:"Paulo",    banda:"BR/Petrobras",    reg:"metro"},
  {k:"BOMBOM FILIAL",        ap:"P. BOMBOM FILIAL",         lat:-19.8760, lng:-43.9180, sup:"Paulo",    banda:"Ipiranga",        reg:"metro"},
  {k:"SANTA INES MINAS",     ap:"P. SANTA INES MINAS",      lat:-19.8880, lng:-43.8230, sup:"Paulo",    banda:"Shell",           reg:"metro"},
  {k:"OURO BRANCO",          ap:"P. OURO BRANCO",           lat:-20.5200, lng:-43.7300, sup:"Paulo",    banda:"Bandeira Branca", reg:"metro"},
  {k:"GLORIA",               ap:"P. GLORIA",                lat:-19.9370, lng:-43.9100, sup:"Gledson",  banda:"Shell",           reg:"metro"},
  {k:"QUATRO RODAS",         ap:"P. QUATRO RODAS",          lat:-19.8670, lng:-44.0580, sup:"Gledson",  banda:"Ipiranga",        reg:"metro"},
  {k:"RODRIGO",              ap:"P. RODRIGO",               lat:-19.9480, lng:-44.1980, sup:"Gledson",  banda:"Shell",           reg:"metro"},
  {k:"LEANDRO",              ap:"P. LEANDRO",               lat:-19.7820, lng:-44.0750, sup:"Gledson",  banda:"Ipiranga",        reg:"metro"},
  {k:"MIRAGEM JBRETAS",      ap:"P. MIRAGEM JBRETAS",       lat:-19.7820, lng:-43.8850, sup:"Gledson",  banda:"Shell",           reg:"metro"},
  {k:"BIANCA",               ap:"P. BIANCA",                lat:-20.0400, lng:-44.1500, sup:"Gledson",  banda:"Ipiranga",        reg:"metro"},
  {k:"BARBOSA - DUDU",       ap:"P. BARBOSA - DUDU",        lat:-19.9330, lng:-44.0030, sup:"Gledson",  banda:"ALE",             reg:"metro"},
  {k:"ESPACO REAL",          ap:"P. ESPACO REAL",           lat:-21.1300, lng:-44.2570, sup:"Rodrigo",  banda:"BR/Petrobras",    reg:"sjdr"},
  {k:"FELIPAO",              ap:"P. FELIPAO",               lat:-19.9230, lng:-43.9900, sup:"Rodrigo",  banda:"BR/Petrobras",    reg:"sjdr"},
  {k:"BEATRIZ",              ap:"P. BEATRIZ",               lat:-21.1389, lng:-44.2294, sup:"Rodrigo",  banda:"Shell",           reg:"sjdr"},
];

const SUPCOR_MAP = {
  Mauricio: '#00e5a0', Paulo: '#4895ef', Fabricio: '#f9c74f',
  Gledson: '#c77dff', Rodrigo: '#ff6b6b',
};

// Corrige coordenadas que às vezes chegam multiplicadas por 1.000.000
// (bug histórico do Apps Script). Mantido por segurança, mesmo que a
// fonte nova (Supabase) não deva mais introduzir esse erro.
function corrigirCoordenada(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return NaN;
  if (Math.abs(n) > 180) return n / 1000000;
  return n;
}
