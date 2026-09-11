/**
 * Confere se todo ícone importado de `lucide-react` existe de fato.
 *
 * Um nome inexistente é importado como `undefined` sem erro de build, e
 * quebra a tela inteira só quando o React tenta renderizá-la.
 *
 * Uso: node frontend/check-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');

const lucide = await import('lucide-react');
const disponiveis = new Set(Object.keys(lucide));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const problemas = [];

for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/s);
  if (!m) continue;

  for (const parte of m[1].split(',')) {
    const nome = parte.trim().split(/\s+as\s+/)[0].trim();
    if (!nome) continue;
    if (!disponiveis.has(nome)) {
      problemas.push({ file: path.relative(SRC, file).replace(/\\/g, '/'), nome });
    }
  }
}

if (problemas.length === 0) {
  console.log('  Todos os ícones existem.');
} else {
  console.log(`  ${problemas.length} ícone(s) inexistente(s):\n`);
  for (const p of problemas) console.log(`  ${p.file}  ->  ${p.nome}`);
}
process.exit(problemas.length ? 1 : 0);
