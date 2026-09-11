import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, all, run } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )
`);

export function migrate({ silent = false } = {}) {
  const log = (...a) => !silent && console.log(...a);

  const applied = new Set(all('SELECT name FROM _migrations').map((r) => r.name));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // Cada migration roda atomicamente: ou aplica inteira, ou nada.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      run('INSERT INTO _migrations (name) VALUES (?)', [file]);
      db.exec('COMMIT');
      log(`  aplicada: ${file}`);
      count++;
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migration ${file}: ${err.message}`);
    }
  }

  log(count === 0 ? '  banco já atualizado' : `  ${count} migration(s) aplicada(s)`);
  return count;
}

// Execução direta: `npm run migrate`
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  console.log('Migrando banco de dados...');
  migrate();
  console.log('Concluído.');
}
