import { all, get } from '../db/index.js';
import { monthRange } from './dates.js';

/**
 * Série mensal consolidada: receitas, despesas, saldo em contas, valor de
 * mercado dos investimentos e bens, mês a mês.
 *
 * Tudo sai de CINCO consultas agregadas, independente de quantos meses forem
 * pedidos. A versão ingênua faria quatro consultas POR MÊS — com o banco em
 * rede, doze meses custariam quase cinquenta idas e voltas, e essa série
 * aparece no Dashboard e na tela de patrimônio.
 */
export async function buildMonthlySeries(userId, months, { includePhysical = true } = {}) {
  if (!months.length) return [];

  const firstMonth = months[0];
  const endISO = monthRange(months.at(-1)).end;
  const startISO = monthRange(firstMonth).start;

  const [byMonth, settledByMonth, initialRow, investmentRows, assetRows] = await Promise.all([
    all(
      `SELECT to_char(due_date, 'YYYY-MM') AS ym,
              COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense
         FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL AND neutral = 0 AND status <> 'canceled'
          AND due_date >= ? AND due_date <= ?
        GROUP BY ym`,
      [userId, startISO, endISO],
    ),

    // Sem filtro de data inicial: o saldo de um mês depende de tudo que foi
    // liquidado antes dele, inclusive fora da janela exibida.
    all(
      `SELECT to_char(t.settle_date, 'YYYY-MM') AS ym,
              COALESCE(SUM(CASE WHEN t.kind IN ('income','transfer_in')
                                THEN t.amount ELSE -t.amount END), 0) AS delta
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.include_in_total = 1 AND a.archived = 0
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.status = 'settled'
          AND t.settle_date IS NOT NULL AND t.settle_date <= ?
        GROUP BY ym`,
      [userId, endISO],
    ),

    get(
      `SELECT COALESCE(SUM(initial_balance), 0) AS initial FROM accounts
        WHERE user_id = ? AND archived = 0 AND include_in_total = 1`,
      [userId],
    ),

    all(
      `SELECT i.id, i.purchase_date, i.invested_amount,
              v.date AS valuation_date, v.market_value
         FROM investments i
         LEFT JOIN asset_valuations v ON v.investment_id = i.id AND v.date <= ?
        WHERE i.user_id = ? AND i.purchase_date <= ?
        ORDER BY i.id, v.date`,
      [endISO, userId, endISO],
    ),

    includePhysical
      ? all('SELECT value, acquisition_date FROM assets WHERE user_id = ?', [userId])
      : Promise.resolve([]),
  ]);

  const incomeExpense = new Map(byMonth.map((r) => [r.ym, r]));
  const deltas = settledByMonth.map((r) => ({ ym: r.ym, delta: r.delta }));

  // Agrupa as marcações a mercado por ativo, já em ordem cronológica.
  const investments = new Map();
  for (const row of investmentRows) {
    if (!investments.has(row.id)) {
      investments.set(row.id, {
        purchase: row.purchase_date,
        invested: row.invested_amount,
        valuations: [],
      });
    }
    if (row.valuation_date) {
      investments.get(row.id).valuations.push({ date: row.valuation_date, value: row.market_value });
    }
  }

  /** Valor de mercado: última marcação até a data; sem marcação, o aplicado. */
  const marketValueAt = (dateISO) => {
    let total = 0;
    for (const inv of investments.values()) {
      if (inv.purchase > dateISO) continue;
      const latest = inv.valuations.filter((v) => v.date <= dateISO).at(-1);
      total += latest ? latest.value : inv.invested;
    }
    return total;
  };

  const physicalAt = (dateISO) =>
    assetRows
      .filter((a) => !a.acquisition_date || a.acquisition_date <= dateISO)
      .reduce((sum, a) => sum + a.value, 0);

  // Parte do saldo inicial somado a tudo que foi liquidado antes da janela.
  let running = initialRow.initial;
  for (const { ym, delta } of deltas) {
    if (ym < firstMonth) running += delta;
  }
  const deltaByMonth = new Map(deltas.map((d) => [d.ym, d.delta]));

  return months.map((ym) => {
    const { end } = monthRange(ym);
    const m = incomeExpense.get(ym) ?? { income: 0, expense: 0 };
    running += deltaByMonth.get(ym) ?? 0;

    const market = marketValueAt(end);
    const physical = physicalAt(end);

    return {
      month: ym,
      label: `${ym.slice(5)}/${ym.slice(2, 4)}`,
      income: m.income,
      expense: m.expense,
      result: m.income - m.expense,
      cash: running,
      balance: running,
      investments: market,
      invested: market,
      physical_assets: physical,
      total_assets: running + market + physical,
      net_worth: running + market + physical,
    };
  });
}
