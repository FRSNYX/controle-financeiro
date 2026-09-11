import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { get } from '../db/index.js';
import { unauthorized } from '../utils/errors.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, env.jwtSecret, {
    expiresIn: `${env.accessTtlMin}m`,
  });
}

/**
 * Exige um access token válido e carrega o usuário em req.user.
 * Toda query de domínio filtra por req.user.id — é aqui que o isolamento começa.
 */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('Token não informado'));

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    const e = unauthorized(expired ? 'Sessão expirada' : 'Token inválido');
    e.code = expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return next(e);
  }

  // Recarrega do banco: um usuário excluído não pode continuar operando
  // só porque ainda tem um token válido em mãos.
  const user = get(
    'SELECT id, name, email, theme, currency, projection_rate FROM users WHERE id = ?',
    [payload.sub],
  );
  if (!user) return next(unauthorized('Usuário não encontrado'));

  req.user = user;
  next();
}
