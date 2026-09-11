import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do pacote backend (…/backend). */
export const ROOT = path.resolve(here, '..', '..');

const int = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 4000),

  dbFile: process.env.DB_FILE ?? path.join(ROOT, 'data', 'financas.db'),
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
};

export const isProd = env.nodeEnv === 'production';

// Falha cedo: rodar em produção com o segredo padrão é um furo de segurança.
if (isProd && env.jwtSecret === 'troque-este-segredo-em-producao') {
  throw new Error('JWT_SECRET precisa ser definido em produção (.env).');
}
