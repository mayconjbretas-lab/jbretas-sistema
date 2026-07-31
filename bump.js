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

// Descobre TODOS os *.html varrendo o repo a partir da raiz deste script,
// em vez de lista fixa (senão módulos novos ficam de fora do cache-bust).
// Ignora node_modules, .git, .wrangler e demais pastas ocultas/de build.
const IGNORAR = new Set(['node_modules', 'dist', 'build']);
function descobrirHtmls(dirAbs, baseAbs) {
  const achados = [];
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // pula node_modules/build e qualquer pasta oculta (.git, .wrangler, .claude…)
      if (IGNORAR.has(entry.name) || entry.name.startsWith('.')) continue;
      achados.push(...descobrirHtmls(path.join(dirAbs, entry.name), baseAbs));
    } else if (entry.isFile() && /\.html$/i.test(entry.name)) {
      // relativo à raiz, sempre com "/" (independe do SO)
      achados.push(path.relative(baseAbs, path.join(dirAbs, entry.name)).split(path.sep).join('/'));
    }
  }
  return achados;
}
const ARQUIVOS = descobrirHtmls(__dirname, __dirname).sort();

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
