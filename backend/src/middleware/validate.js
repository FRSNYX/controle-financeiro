import { AppError } from '../utils/errors.js';

/**
 * Valida req[source] contra um schema Zod e substitui pelo valor parseado
 * (já coagido e com defaults aplicados).
 */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        campo: i.path.join('.') || '(raiz)',
        erro: i.message,
      }));
      return next(new AppError('Dados inválidos', 422, details));
    }
    // req.query é getter-only no Express 5 — guardamos em req.validatedQuery.
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    next();
  };

export const validateQuery = (schema) => validate(schema, 'query');
