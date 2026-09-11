import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

/**
 * Camada de acesso a dados — PostgreSQL.
 *
 * Dois drivers, a mesma interface:
 *   • DATABASE_URL definida  -> `pg` conectando no Postgres hospedado (produção)
 *   • sem DATABASE_URL       -> PGlite, o próprio Postgres embarcado em arquivo
 *
 * O PGlite é Postgres de verdade compilado para WebAssembly, então o SQL é
 * idêntico nos dois modos: o que passa no teste local passa na nuvem. E o
 * desenvolvimento não exige instalar nem contratar banco nenhum.
 */

const usePostgres = !!env.databaseUrl;

let driver = null;
let ready = null;

/** Conexão em uso dentro de uma transação (ver `transaction`). */
const txStore = new AsyncLocalStorage();

// ------------------------------------------------------------------
// Inicialização preguiçosa — em serverless o módulo carrega a cada
// invocação fria, então só conectamos quando alguém realmente consulta.
// ------------------------------------------------------------------
/**
 * OIDs dos tipos que precisam chegar ao código no formato que ele espera.
 *
 * Datas: o driver converteria DATE e TIMESTAMP em objetos `Date`, mas o sistema
 * inteiro trabalha com texto ISO ('AAAA-MM-DD') — inclusive as comparações de
 * vencimento e os `slice()` de data. Mantemos a string crua do Postgres.
 *
 * Dinheiro: BIGINT viria como string para não perder precisão. Centavos cabem
 * com folga em Number, então convertemos e a aritmética do código segue igual.
 */
const TYPE_OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 };

const asNumber = (v) => (v === null || v === undefined ? null : Number(v));
const asText = (v) => v; // já vem como string do protocolo

const PARSERS = {
  [TYPE_OID.INT8]: asNumber,
  [TYPE_OID.NUMERIC]: asNumber,
  [TYPE_OID.DATE]: asText,
  [TYPE_OID.TIMESTAMP]: asText,
  [TYPE_OID.TIMESTAMPTZ]: asText,
};

async function init() {
  if (usePostgres) {
    const { default: pg } = await import('pg');

    for (const [oid, parser] of Object.entries(PARSERS)) {
      pg.types.setTypeParser(Number(oid), parser);
    }

    const pool = new pg.Pool({
      connectionString: env.databaseUrl,
      // O serverless abre muitas instâncias; um teto baixo por instância evita
      // estourar o limite de conexões do banco.
      max: env.dbPoolMax,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      ssl: env.databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });

    pool.on('error', (err) => console.error('[db] erro no pool:', err.message));

    const wrap = (c) => ({
      query: (sql, params) => c.query(sql, params),
      // Sem parâmetros, o driver usa o protocolo simples, que aceita vários
      // comandos separados por ponto e vírgula (o caso das migrations).
      execMany: (sql) => c.query(sql),
      release: () => c.release?.(),
    });

    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      execMany: (sql) => pool.query(sql),
      connect: async () => wrap(await pool.connect()),
      close: () => pool.end(),
    };
  }

  // O PGlite grava em disco: em serverless isso não existe. Falhar aqui com
  // uma mensagem clara é melhor do que subir um banco que some a cada chamada.
  if (env.isServerless) {
    throw new Error(
      'DATABASE_URL não configurada. Em produção é obrigatório apontar para um PostgreSQL ' +
        '(na Vercel: aba Storage > Create Database > Neon Postgres).',
    );
  }

  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(path.dirname(env.pgliteDir), { recursive: true });
  const db = await PGlite.create(env.pgliteDir);

  // O PGlite recebe os parsers por consulta, não globalmente como o `pg`.
  const query = (sql, params) => db.query(sql, params ?? [], { parsers: PARSERS });
  // `exec` é o método do PGlite que aceita vários comandos de uma vez.
  const execMany = (sql) => db.exec(sql);

  return {
    kind: 'pglite',
    query,
    execMany,
    // PGlite é uma conexão só: a "conexão dedicada" da transação é ele mesmo.
    connect: async () => ({ query, execMany, release: () => {} }),
    close: () => db.close(),
  };
}

async function getDriver() {
  ready ??= init().then((d) => {
    driver = d;
    return d;
  });
  return ready;
}

// ------------------------------------------------------------------
// Tradução de dialeto
// ------------------------------------------------------------------

/**
 * Converte os placeholders `?` do estilo SQLite para `$1, $2, ...` do Postgres.
 *
 * Ignora `?` dentro de literais de texto e de comentários — sem isso, um
 * `WHERE nome LIKE '%?%'` viraria um placeholder fantasma e a contagem de
 * parâmetros sairia errada.
 */
export function toPositional(sql) {
  let out = '';
  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      out += ch;
      inLineComment = true;
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      out += ch;
      inBlockComment = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      // '' escapa uma aspa dentro do literal
      if (inSingle && next === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (ch === '?' && !inSingle && !inDouble) {
      out += `$${++index}`;
      continue;
    }

    out += ch;
  }

  return out;
}

const isInsert = (sql) => /^\s*(--[^\n]*\n|\s)*insert\s/i.test(sql);
const hasReturning = (sql) => /\breturning\b/i.test(sql);

async function exec(sql, params = []) {
  const d = driver ?? (await getDriver());
  const connection = txStore.getStore() ?? d;
  const text = toPositional(sql);

  try {
    return await connection.query(text, params);
  } catch (err) {
    // Sem o SQL na mensagem, depurar erro de dialeto vira adivinhação.
    err.message = `${err.message}\n  SQL: ${text.replace(/\s+/g, ' ').trim().slice(0, 300)}`;
    throw err;
  }
}

// ------------------------------------------------------------------
// API pública — mesma assinatura de antes, agora assíncrona
// ------------------------------------------------------------------

/** Todas as linhas. */
export async function all(sql, params = []) {
  const res = await exec(sql, params);
  return res.rows ?? [];
}

/** Primeira linha ou undefined. */
export async function get(sql, params = []) {
  const res = await exec(sql, params);
  return (res.rows ?? [])[0];
}

/**
 * INSERT / UPDATE / DELETE.
 *
 * Devolve `{ changes, lastInsertRowid }`. Para preservar as dezenas de chamadas
 * que já usavam `lastInsertRowid`, um INSERT sem RETURNING recebe
 * `RETURNING id` automaticamente.
 */
export async function run(sql, params = []) {
  const shouldReturnId = isInsert(sql) && !hasReturning(sql);
  const finalSql = shouldReturnId ? `${sql.trimEnd().replace(/;\s*$/, '')} RETURNING id` : sql;

  const res = await exec(finalSql, params);
  const rows = res.rows ?? [];

  return {
    changes: res.rowCount ?? res.affectedRows ?? rows.length ?? 0,
    lastInsertRowid: rows[0]?.id ?? null,
    rows,
  };
}

/**
 * Executa `fn` dentro de uma transação.
 *
 * A conexão fica num AsyncLocalStorage, então `get`/`all`/`run` chamados lá
 * dentro usam automaticamente a mesma conexão — sem precisar passar o cliente
 * por parâmetro em todas as camadas.
 */
export async function transaction(fn) {
  const d = driver ?? (await getDriver());
  const client = await d.connect();

  try {
    await client.query('BEGIN');
    const result = await txStore.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rollback em transação já encerrada é inofensivo */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Executa SQL bruto (migrations). Aceita múltiplos comandos separados por ';'. */
export async function exec_raw(sql) {
  const d = driver ?? (await getDriver());
  const connection = txStore.getStore() ?? d;
  return connection.execMany(sql);
}

/**
 * Monta UPDATE a partir de um objeto, ignorando chaves `undefined`.
 * Evita sobrescrever campos que o cliente não enviou (PATCH parcial).
 */
export async function buildUpdate(table, id, userId, fields) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 0;

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);

  const res = await run(
    `UPDATE ${table} SET ${sets}, updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [...values, id, userId],
  );
  return res.changes;
}

export const dbKind = () => driver?.kind ?? (usePostgres ? 'postgres' : 'pglite');

export async function closeDb() {
  if (driver) await driver.close();
  driver = null;
  ready = null;
}

/** Garante que a conexão está de pé (usado no boot e nos testes). */
export const connect = getDriver;
