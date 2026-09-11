/**
 * Datas trafegam como 'YYYY-MM-DD' (ISO) no banco e na API.
 * A formatação DD/MM/AAAA acontece no frontend.
 *
 * Toda a aritmética usa UTC para evitar que fuso horário empurre uma data
 * para o dia anterior/seguinte.
 */

export const pad = (n) => String(n).padStart(2, '0');

/** Data de hoje em 'YYYY-MM-DD', no fuso local da máquina. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Timestamp local 'YYYY-MM-DD HH:MM:SS'. */
export function now() {
  const d = new Date();
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 'YYYY-MM-DD' -> Date em UTC (meia-noite). */
export function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date -> 'YYYY-MM-DD'. */
export const fmtISO = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export function addDays(iso, days) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtISO(d);
}

/**
 * Soma meses preservando o "dia desejado" quando o mês de destino é mais curto.
 * Ex.: 31/01 + 1 mês = 28/02 (ou 29/02 em ano bissexto), não 03/03.
 */
export function addMonths(iso, months) {
  const d = parseISO(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1)));
  return fmtISO(d);
}

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** 'YYYY-MM-DD' -> 'YYYY-MM'. */
export const monthKey = (iso) => String(iso).slice(0, 7);

/** 'YYYY-MM' -> { start: 'YYYY-MM-01', end: 'YYYY-MM-<último>' }. */
export function monthRange(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
}

/** Ano inteiro. */
export const yearRange = (year) => ({ start: `${year}-01-01`, end: `${year}-12-31` });

/** Constrói uma data segura a partir de ano/mês/dia-desejado (clampa o dia). */
export function safeDate(year, month, desiredDay) {
  return `${year}-${pad(month)}-${pad(Math.min(desiredDay, daysInMonth(year, month)))}`;
}

/** Lista de meses 'YYYY-MM' entre duas datas, inclusive. */
export function monthsBetween(startISO, endISO) {
  const out = [];
  let cur = `${monthKey(startISO)}-01`;
  const last = monthKey(endISO);
  // guarda contra intervalos absurdos vindos de filtro do usuário
  for (let i = 0; i < 600 && monthKey(cur) <= last; i++) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

/** Diferença em dias (b - a). */
export const diffDays = (aISO, bISO) =>
  Math.round((parseISO(bISO).getTime() - parseISO(aISO).getTime()) / 86400000);

const FREQUENCY_STEPS = {
  daily: { unit: 'day', n: 1 },
  weekly: { unit: 'day', n: 7 },
  biweekly: { unit: 'day', n: 14 },
  monthly: { unit: 'month', n: 1 },
  bimonthly: { unit: 'month', n: 2 },
  quarterly: { unit: 'month', n: 3 },
  semiannual: { unit: 'month', n: 6 },
  annual: { unit: 'month', n: 12 },
};

/** Avança uma data conforme a frequência da recorrência (RN-06). */
export function stepDate(iso, frequency, intervalN = 1) {
  const step = FREQUENCY_STEPS[frequency];
  if (!step) throw new Error(`Frequência inválida: ${frequency}`);
  const times = step.n * Math.max(1, intervalN);
  return step.unit === 'day' ? addDays(iso, times) : addMonths(iso, times);
}

/**
 * RN-04 — Descobre a fatura de uma compra no cartão.
 *
 * A compra entra na fatura que ainda não fechou: se o dia da compra é ANTERIOR
 * ao dia de fechamento, cai na fatura do próprio mês; se é no dia do fechamento
 * ou depois, cai na fatura do mês seguinte.
 *
 * `reference_month` é o mês do VENCIMENTO — é assim que o usuário enxerga
 * ("fatura de março"). Se o dia de vencimento for menor que o de fechamento,
 * o vencimento cai no mês seguinte ao fechamento.
 */
export function resolveInvoicePeriod(purchaseISO, closingDay, dueDay) {
  const d = parseISO(purchaseISO);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1; // 1-12
  const day = d.getUTCDate();

  if (day >= Math.min(closingDay, daysInMonth(year, month))) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const closingDate = safeDate(year, month, closingDay);

  // Vencimento: mesmo mês do fechamento se dueDay > closingDay, senão mês seguinte.
  let dueYear = year;
  let dueMonth = month;
  if (dueDay <= closingDay) {
    dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
  }
  const dueDate = safeDate(dueYear, dueMonth, dueDay);

  return {
    referenceMonth: `${dueYear}-${pad(dueMonth)}`,
    closingDate,
    dueDate,
  };
}
