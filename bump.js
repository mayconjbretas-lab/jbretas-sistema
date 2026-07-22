// ================================================================
// bump.js — cache-busting de assets LOCAIS dos HTML do JBRETAS.
// Gera uma versão (timestamp compacto) e reescreve ?v=<versão> em
// toda tag <script src> e <link rel="stylesheet" href> de arquivo
// LOCAL. NÃO toca CDN (http/https), favicon, manifest, apple-touch.
// Uso: node bump.js
// ================================================================
const fs   = require('fs');
const path = require('path');

// Versão = AAAAMMDDHHMM (ex: 202607221530).
const v = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

// Os 12 HTML que têm assets locais (relativo à raiz deste script).
const ARQUIVOS = [
  'index.html',
  'modulos/admin/index.html',
  'modulos/admin/coleta-precos/index.html',
  'modulos/admin/coleta-revisao/index.html',
  'modulos/admin/mapa-precos/index.html',
  'modulos/coleta-precos/index.html',
  'modulos/copasa/index.html',
  'modulos/fechamento/index.html',
  'modulos/logistica/index.html',
  'modulos/painel-adm/index.html',
  'modulos/painel-ti/index.html',
  'modulos/supervisor/index.html',
];

// Local = não é http(s):// nem //cdn. Data URIs também ficam de fora.
function ehLocal(url) {
  return !/^(https?:)?\/\//i.test(url) && !/^data:/i.test(url);
}

// Remove qualquer query (?v=... ou outra) e reanexa ?v=<versão>.
// Preserva #fragmento se existir.
function bumpUrl(url) {
  const [semHash, hash] = url.split('#');
  const base = semHash.split('?')[0];
  return base + '?v=' + v + (hash !== undefined ? '#' + hash : '');
}

let totalTags = 0;
const porArquivo = [];

for (const rel of ARQUIVOS) {
  const abs = path.join(__dirname, rel);
  let html = fs.readFileSync(abs, 'utf8');
  let n = 0;

  // <script ... src="...">  (só reescreve se src for local)
  html = html.replace(/(<script\b[^>]*\bsrc=")([^"]+)("[^>]*>)/gi, (m, pre, url, post) => {
    if (!ehLocal(url)) return m;
    n++;
    return pre + bumpUrl(url) + post;
  });

  // <link ...>  — só rel="stylesheet" com href local. Ignora icon/manifest/apple-touch.
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*"stylesheet"/i.test(tag)) return tag;
    const hrefMatch = tag.match(/href="([^"]+)"/i);
    if (!hrefMatch || !ehLocal(hrefMatch[1])) return tag;
    n++;
    return tag.replace(/href="[^"]+"/i, 'href="' + bumpUrl(hrefMatch[1]) + '"');
  });

  fs.writeFileSync(abs, html);
  totalTags += n;
  porArquivo.push({ rel, n });
}

console.log('Versão aplicada: ' + v);
console.log('Tags atualizadas por arquivo:');
for (const { rel, n } of porArquivo) {
  console.log('  ' + String(n).padStart(2) + '  ' + rel);
}
console.log('Total: ' + totalTags + ' tags em ' + ARQUIVOS.length + ' arquivos.');
