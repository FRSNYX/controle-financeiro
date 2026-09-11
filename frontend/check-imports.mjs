/**
 * Confere se todo identificador importado dos módulos internos existe de fato.
 *
 * Um import que não resolve vira `undefined` em tempo de execução e derruba a
 * tela inteira ("Element type is invalid"), sem erro nenhum na compilação.
 *
 * Uso: node frontend/check-imports.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Nomes exportados por um módulo (named exports e re-exports simples). */
function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();

  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  return names;
}

function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined; // caminho não encontrado
}

const problems = [];

for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');

  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, clause, spec] = m;
    const target = resolve(file, spec);
    if (target === null) continue; // pacote externo
    if (target === undefined) {
      problems.push({ file, spec, name: '(módulo não encontrado)' });
      continue;
    }

    const available = exportsOf(target);
    const named = clause.match(/\{([^}]+)\}/);
    if (!named) continue;

    for (const part of named[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (!name || name.startsWith('//')) continue;
      if (!available.has(name)) {
        problems.push({ file, spec, name });
      }
    }
  }
}

const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');

if (problems.length === 0) {
  console.log('  Nenhum import quebrado.');
} else {
  console.log(`  ${problems.length} import(s) que não resolvem:\n`);
  for (const p of problems) {
    console.log(`  ${rel(p.file)}`);
    console.log(`      ${p.name}  <-  '${p.spec}'`);
  }
}
process.exit(problems.length ? 1 : 0);
