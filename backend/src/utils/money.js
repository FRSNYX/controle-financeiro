/**
 * Dinheiro é sempre INTEGER de centavos no banco (RN-12).
 * A conversão para/de reais acontece apenas na borda da API.
 */

/** Reais (number|string) -> centavos (int). Aceita "1.234,56" e "1234.56". */
export function toCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.round(value * 100);

  const raw = String(value).trim().replace(/[R$\s]/g, '');
  // "1.234,56" (pt-BR) -> remove pontos de milhar, vírgula vira ponto
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Centavos -> reais (number com 2 casas). */
export const toReais = (cents) => Math.round(Number(cents) || 0) / 100;

/** Centavos -> "R$ 1.234,56". */
export const formatBRL = (cents) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(toReais(cents));

/**
 * Divide `total` centavos em `count` parcelas sem perder centavos (RN-03).
 * O resto é somado à PRIMEIRA parcela, então Σ parcelas === total exato.
 */
export function splitInstallments(total, count) {
  const n = Math.max(1, Math.trunc(count));
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base));
}

/** Percentual com proteção contra divisão por zero. */
export function pct(part, whole) {
  const w = Number(whole) || 0;
  if (w === 0) return 0;
  return Math.round((Number(part) / w) * 10000) / 100;
}
