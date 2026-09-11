import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

fs.mkdirSync(path.dirname(env.dbFile), { recursive: true });

export const db = new DatabaseSync(env.dbFile);

// WAL melhora leitura concorrente; foreign_keys precisa ser ligado por conexão.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/** Retorna todas as linhas. */
export const all = (sql, params = []) => db.prepare(sql).all(...params);

/** Retorna a primeira linha ou undefined. */
export const get = (sql, params = []) => db.prepare(sql).get(...params);

/** Executa INSERT/UPDATE/DELETE. Retorna { changes, lastInsertRowid }. */
export const run = (sql, params = []) => db.prepare(sql).run(...params);

/**
 * Executa `fn` dentro de uma transação. Reverte tudo se `fn` lançar.
 * node:sqlite é síncrono, então `fn` também deve ser.
 */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* rollback em transação já encerrada é inofensivo */
    }
    throw err;
  }
}

/**
 * Monta cláusula UPDATE a partir de um objeto, ignorando chaves `undefined`.
 * Evita reescrever campos que o cliente não enviou (PATCH parcial).
 */
export function buildUpdate(table, id, userId, fields) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 0;
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  const res = run(
    `UPDATE ${table} SET ${sets}, updated_at = datetime('now','localtime')
     WHERE id = ? AND user_id = ?`,
    [...values, id, userId],
  );
  return res.changes;
}
