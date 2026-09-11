import { Router } from 'express';
import { z } from 'zod';
import { all, get } from '../../db/index.js';
import { validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';
import { pct } from '../../utils/money.js';
import { today, monthKey, monthRange, monthsBetween, addMonths } from '../../utils/dates.js';
import { TX_SELECT, serializeTx } from '../../utils/txQuery.js';
import { buildMonthlySeries } from '../../utils/series.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Saldo total das contas (RN-01), apenas as marcadas para somar no total. */
async function totalBalance(userId) {
  return (await get(
    `SELECT COALESCE(SUM(
              a.initial_balance + COALESCE((
                SELECT SUM(CASE WHEN t.kind IN ('income','transfer_in') THEN t.amount ELSE -t.amount END)
                  FROM transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.status = 'settled'
              ), 0)
            ), 0) AS total
       FROM accounts a
      WHERE a.user_id = ? AND a.archived = 0 AND a.include_in_total = 1`,
    [userId],
  )).total;
}

/** Totais de receita/despesa num intervalo, sempre ignorando transferências. */
async function periodTotals(userId, from, to) {
  return await get(
    `SELECT
       COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount END), 0) AS income_total,
       COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense_total,
       COALESCE(SUM(CASE WHEN kind = 'income'  AND status = 'settled' THEN amount END), 0) AS income_received,
       COALESCE(SUM(CASE WHEN kind = 'expense' AND status = 'settled' THEN amount END), 0) AS expense_paid,
       COALESCE(SUM(CASE WHEN kind = 'income'  AND status = 'pending' THEN amount END), 0) AS receivable,
       COALESCE(SUM(CASE WHEN kind = 'expense' AND status = 'pending' THEN amount END), 0) AS payable,
       COALESCE(SUM(CASE WHEN status = 'pending' AND due_date < ? AND kind = 'expense' THEN amount END), 0) AS overdue_payable,
       COALESCE(SUM(CASE WHEN status = 'pending' AND due_date < ? AND kind = 'income'  THEN amount END), 0) AS overdue_receivable,
       COUNT(CASE WHEN kind = 'income'  THEN 1 END) AS income_count,
       COUNT(CASE WHEN kind = 'expense' THEN 1 END) AS expense_count
     FROM transactions
    WHERE user_id = ? AND deleted_at IS NULL AND neutral = 0
      AND status <> 'canceled' AND due_date >= ? AND due_date <= ?`,
    [today(), today(), userId, from, to],
  );
}

async function investedTotals(userId) {
  return await get(
    `SELECT COALESCE(SUM(invested_amount), 0) AS invested,
            COALESCE(SUM(current_value), 0)   AS current_value,
            COUNT(*) AS count
       FROM investments WHERE user_id = ? AND archived = 0`,
    [userId],
  );
}

// ------------------------------------------------------------------
// GET /api/dashboard
// ------------------------------------------------------------------
router.get(
  '/',
  validateQuery(z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    evolutionMonths: z.coerce.number().int().min(3).max(36).optional().default(12),
  })),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const userId = req.user.id;

    // Período: mês explícito > intervalo customizado > mês corrente.
    const range = q.month
      ? monthRange(q.month)
      : { start: q.from ?? monthRange(monthKey(today())).start, end: q.to ?? monthRange(monthKey(today())).end };

    const totals = await periodTotals(userId, range.start, range.end);
    const balance = await totalBalance(userId);
    const investments = await investedTotals(userId);

    const { physical_assets } = await get(
      'SELECT COALESCE(SUM(value), 0) AS physical_assets FROM assets WHERE user_id = ?',
      [userId],
    );
    const { debts } = await get(
      'SELECT COALESCE(SUM(remaining_amount), 0) AS debts FROM liabilities WHERE user_id = ?',
      [userId],
    );

    const netWorth = balance + investments.current_value + physical_assets;
    const result = totals.income_total - totals.expense_total;

    // ---- Gastos por categoria (subcategorias somam na categoria-pai) ----
    const byCategory = await all(
      `SELECT COALESCE(parent.id, cat.id, 0)              AS category_id,
              COALESCE(parent.name, cat.name, 'Sem categoria') AS name,
              COALESCE(parent.color, cat.color, '#94a3b8')     AS color,
              COALESCE(parent.icon, cat.icon, 'tag')           AS icon,
              SUM(t.amount) AS total, COUNT(*) AS tx_count
         FROM transactions t
         LEFT JOIN categories cat    ON cat.id = t.category_id
         LEFT JOIN categories parent ON parent.id = cat.parent_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.kind = 'expense' AND t.status <> 'canceled'
          AND t.due_date >= ? AND t.due_date <= ?
        GROUP BY 1, 2, 3, 4
        ORDER BY total DESC`,
      [userId, range.start, range.end],
    );
    const categoryTotal = byCategory.reduce((s, c) => s + c.total, 0);

    // ---- Receitas por categoria ----
    const incomeByCategory = await all(
      `SELECT COALESCE(c.id, 0) AS category_id,
              COALESCE(c.name, 'Sem categoria') AS name,
              COALESCE(c.color, '#94a3b8') AS color,
              SUM(t.amount) AS total
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.kind = 'income' AND t.status <> 'canceled'
          AND t.due_date >= ? AND t.due_date <= ?
        GROUP BY 1, 2, 3 ORDER BY total DESC`,
      [userId, range.start, range.end],
    );

    // ---- Série mensal: receitas x despesas + evolução do saldo ----
    const startMonth = addMonths(`${monthKey(range.end)}-01`, -(q.evolutionMonths - 1));
    const months = monthsBetween(startMonth, range.end);

    const monthly = await buildMonthlySeries(userId, months);

    // ---- Listas ----
    const recent = (await all(
      `${TX_SELECT}
        WHERE t.user_id = ? AND t.deleted_at IS NULL
        ORDER BY t.created_at DESC, t.id DESC LIMIT 8`,
      [userId],
    )).map((r) => serializeTx(r));

    const upcoming = (await all(
      `${TX_SELECT}
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.status = 'pending' AND t.due_date <= (?::date + INTERVAL '30 days')
        ORDER BY t.due_date ASC LIMIT 8`,
      [userId, today()],
    )).map((r) => serializeTx(r));

    const budgetAlerts = (await all(
      `SELECT b.*, c.name AS category_name, c.color AS category_color,
              COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                 WHERE t.user_id = b.user_id AND t.kind = 'expense' AND t.deleted_at IS NULL
                   AND t.neutral = 0 AND t.status <> 'canceled'
                   AND (t.category_id = b.category_id OR t.subcategory_id = b.category_id)
                   AND t.due_date >= ? AND t.due_date <= ?
              ), 0) AS spent
         FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.user_id = ? AND b.month = ? AND b.category_id IS NOT NULL`,
      [monthRange(monthKey(range.end)).start, monthRange(monthKey(range.end)).end, userId, monthKey(range.end)],
    ))
      .map((b) => ({ ...b, percent_used: pct(b.spent, b.limit_amount) }))
      .filter((b) => b.percent_used >= 80)
      .sort((a, b) => b.percent_used - a.percent_used);

    // Comparação com o mês anterior dá contexto ao número do mês atual.
    const prevMonth = addMonths(`${monthKey(range.start)}-01`, -1);
    const prev = await periodTotals(userId, monthRange(monthKey(prevMonth)).start, monthRange(monthKey(prevMonth)).end);

    res.json({
      period: { from: range.start, to: range.end, month: monthKey(range.end) },
      cards: {
        total_balance: balance,
        income_total: totals.income_total,
        expense_total: totals.expense_total,
        result,
        invested_total: investments.current_value,
        invested_amount: investments.invested,
        investment_profit: investments.current_value - investments.invested,
        net_worth: netWorth,
        liabilities_total: debts,
        net_worth_liquid: netWorth - debts,
        physical_assets,
        payable: totals.payable,
        receivable: totals.receivable,
        overdue_payable: totals.overdue_payable,
        overdue_receivable: totals.overdue_receivable,
        income_received: totals.income_received,
        expense_paid: totals.expense_paid,
        savings_rate: pct(result, totals.income_total),
      },
      comparison: {
        income_change: pct(totals.income_total - prev.income_total, prev.income_total),
        expense_change: pct(totals.expense_total - prev.expense_total, prev.expense_total),
        result_previous: prev.income_total - prev.expense_total,
      },
      charts: {
        expenses_by_category: byCategory.map((c) => ({ ...c, share_pct: pct(c.total, categoryTotal) })),
        income_by_category: incomeByCategory,
        monthly,
      },
      lists: { recent, upcoming, budget_alerts: budgetAlerts },
    });
  }),
);

export default router;
