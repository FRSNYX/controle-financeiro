import { isProd } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
}

/** Handler central — nenhuma stack trace vaza para o cliente em produção. */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Traduz violações de constraint do SQLite para mensagens úteis.
  const msg = String(err?.message ?? '');
  if (msg.includes('UNIQUE constraint failed')) {
    const field = msg.split('UNIQUE constraint failed:')[1]?.trim() ?? '';
    return res.status(409).json({ error: `Registro duplicado${field ? ` (${field})` : ''}` });
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return res.status(409).json({ error: 'Registro vinculado a outros dados e não pode ser alterado' });
  }
  if (msg.includes('CHECK constraint failed')) {
    return res.status(422).json({ error: 'Valor fora do domínio permitido' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Arquivo excede o tamanho máximo permitido' });
  }

  console.error('[erro nao tratado]', err);
  res.status(500).json({
    error: 'Erro interno do servidor',
    ...(isProd ? {} : { debug: msg }),
  });
}
