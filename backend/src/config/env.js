import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pasta do banco local.
 *
 * Fica FORA do projeto de propósito: um diretório de dados do Postgres dentro
 * de uma pasta sincronizada (OneDrive, Dropbox, Google Drive) corrompe — o
 * serviço de sincronização copia os arquivos enquanto o banco os escreve.
 */
const localDataDir = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'),
  'controle-financeiro',
  'pgdata',
);

/** Raiz do pacote backend (…/backend). */
export const ROOT = path.resolve(here, '..', '..');

const int = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// A Vercel expõe a URL do Postgres com nomes diferentes conforme a integração.
const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEON_DATABASE_URL ??
  null;

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 4000),

  /** Sem URL, o backend sobe com Postgres embarcado (PGlite) em arquivo local. */
  databaseUrl,
  pgliteDir: process.env.PGLITE_DIR ?? localDataDir,
  dbPoolMax: int(process.env.DB_POOL_MAX, 3),

  uploadDir: process.env.UPLOAD_DIR ?? path.join(ROOT, 'uploads'),
  backupDir: process.env.BACKUP_DIR ?? path.join(ROOT, 'data', 'backups'),

  jwtSecret: process.env.JWT_SECRET ?? 'troque-este-segredo-em-producao',
  accessTtlMin: int(process.env.ACCESS_TTL_MIN, 15),
  refreshTtlDays: int(process.env.REFRESH_TTL_DAYS, 7),

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 10),

  /**
   * Em serverless o disco é efêmero e some a cada invocação: anexos precisam de
   * armazenamento externo. Enquanto não houver, o upload fica desligado em vez
   * de aceitar arquivos que sumiriam sem aviso.
   */
  uploadsEnabled: process.env.UPLOADS_ENABLED === 'true' || !process.env.VERCEL,

  isServerless: !!process.env.VERCEL,
};

export const isProd = env.nodeEnv === 'production';

// Falha cedo: rodar em produção com o segredo padrão é um furo de segurança.
if (isProd && env.jwtSecret === 'troque-este-segredo-em-producao') {
  throw new Error(
    'JWT_SECRET precisa ser definido em produção. Configure a variável de ambiente antes de subir.',
  );
}
