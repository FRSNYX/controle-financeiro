/** Erro com status HTTP — o handler central sabe o que fazer com ele. */
export class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(msg, 400, details);
export const unauthorized = (msg = 'Não autenticado') => new AppError(msg, 401);
export const forbidden = (msg = 'Acesso negado') => new AppError(msg, 403);
export const notFound = (msg = 'Registro não encontrado') => new AppError(msg, 404);
export const conflict = (msg) => new AppError(msg, 409);

/** Embrulha handlers async para que rejeições cheguem ao error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
