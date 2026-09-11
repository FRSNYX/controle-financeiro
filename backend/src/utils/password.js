import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Gera { hash, salt } em hex. scrypt evita dependência nativa (bcrypt/argon2). */
export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, KEYLEN, SCRYPT_OPTS).toString('hex');
  return { hash, salt };
}

/** Comparação em tempo constante — não vaza informação por timing. */
export function verifyPassword(plain, hash, salt) {
  try {
    const candidate = scryptSync(plain, salt, KEYLEN, SCRYPT_OPTS);
    const stored = Buffer.from(hash, 'hex');
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('hex');
