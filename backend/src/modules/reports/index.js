import { Router } from 'express';
import { z } from 'zod';
import { all, get } from '../../db/index.js';
import { validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';
import { pct, toReais, formatBRL } from '../../utils/money.js';
import { today, monthKey, monthRange, monthsBetween, addMonths } from '../../utils/dates.js';
import { buildTxFilters, TX_SELECT, serializeTx } from '../../utils/txQuery.js';
import { filterSchema, toFilterInput } from '../transactions/index.js';
import { exportCsv, exportXlsx, exportPdf } from './export.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const periodSchema = z.object({
  from: isoDate,
  to: isoDate,
  groupBy: z.enum(['day', 'week', 'month', 'year']).optional().default('month'),
});

/** Agrupamento temporal resolvido no banco, sem trazer tudo para a memória. */
const GROUP_EXPR = {
  day: `to_char(due_date, 'YYYY-MM-DD')`,
  // IYYY/IW usam a semana ISO; o "W" entre aspas duplas é texto literal no
  // to_char do Postgres, por isso a string JS usa crase.
  week: `to_char(due_date, 'IYYY-"W"IW')`,
  month: `to_char(due_date, 'YYYY-MM')`,
  year: `to_char(due_date, 'YYYY')`,
};

// ------------------------------------------------------------------
// Série temporal receitas x despesas
// ------------------------------------------------------------------
router.get(
  '/summary',
  validateQuery(periodSchema),
  asyncHandler(async (req, res) => {
    const { from, to, groupBy } = req.validatedQuery;
    const expr = GROUP_EXPR[groupBy];

    const rows = await all(
      `SELECT ${expr} AS bucket,
              COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense,
              COUNT(*) AS tx_count
         FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL AND neutral = 0
          AND status <> 'canceled' AND due_date >= ? AND due_date <= ?
        GROUP BY bucket ORDER BY bucket`,
      [req.user.id, from, to],
    );

    let running = 0;
    const data = rows.map((r) => {
      running += r.income - r.expense;
      return {
        ...r,
        result: r.income - r.expense,
        accumulated: running,
        savings_rate: pct(r.income - r.expense, r.income),
      };
    });

    res.json({
      period: { from, to, groupBy },
      data,
      totals: {
        income: data.reduce((s, r) => s + r.income, 0),
        expense: data.reduce((s, r) => s + r.expense, 0),
        result: running,
      },
    });
  }),
);

// ------------------------------------------------------------------
// Indicadores do período
// ------------------------------------------------------------------
router.get(
  '/indicators',
  validateQuery(z.object({ from: isoDate, to: isoDate })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery;
    const userId = req.user.id;

    const base = `user_id = ? AND deleted_at IS NULL AND neutral = 0
                  AND status <> 'canceled' AND due_date >= ? AND due_date <= ?`;
    const params = [userId, from, to];

    const totals = await get(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense,
              COUNT(CASE WHEN kind = 'expense' THEN 1 END) AS expense_count,
              COUNT(CASE WHEN kind = 'income'  THEN 1 END) AS income_count
         FROM transactions WHERE ${base}`,
      params,
    );

    const biggestExpense = await get(
      `${TX_SELECT}
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.status <> 'canceled' AND t.kind = 'expense'
          AND t.due_date >= ? AND t.due_date <= ?
        ORDER BY t.amount DESC LIMIT 1`,
      params,
    );

    const topCategory = await get(
      // GROUP BY 1 aponta para a 1ª coluna do SELECT: "name" sozinho seria
      // ambíguo, já que os dois JOINs de categories também expõem essa coluna.
      `SELECT COALESCE(parent.name, cat.name, 'Sem categoria') AS name,
              COALESCE(parent.color, cat.color, '#94a3b8') AS color,
              SUM(t.amount) AS total
         FROM transactions t
         LEFT JOIN categories cat    ON cat.id = t.category_id
         LEFT JOIN categories parent ON parent.id = cat.parent_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.status <> 'canceled' AND t.kind = 'expense'
          AND t.due_date >= ? AND t.due_date <= ?
        GROUP BY 1, 2 ORDER BY total DESC LIMIT 1`,
      params,
    );

    // Média diária de gasto no período selecionado.
    const days = Math.max(
      1,
      Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
    );
    const months = monthsBetween(from, to).length || 1;

    // Crescimento patrimonial entre o começo e o fim do período.
    const netWorthAt = async (dateISO) => {
      const { cash } = await get(
        `SELECT COALESCE(SUM(CASE WHEN t.kind IN ('income','transfer_in') THEN t.amount ELSE -t.amount END), 0) AS cash
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id AND a.archived = 0 AND a.include_in_total = 1
          WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.status = 'settled' AND t.settle_date <= ?`,
        [userId, dateISO],
      );
      const { initial } = await get(
        'SELECT COALESCE(SUM(initial_balance), 0) AS initial FROM accounts WHERE user_id = ? AND archived = 0 AND include_in_total = 1',
        [userId],
      );
      const { market } = await get(
        `SELECT COALESCE(SUM(
                  COALESCE((SELECT v.market_value FROM asset_valuations v
                             WHERE v.investment_id = i.id AND v.date <= ?
                             ORDER BY v.date DESC LIMIT 1), i.invested_amount)
                ), 0) AS market
           FROM investments i WHERE i.user_id = ? AND i.purchase_date <= ?`,
        [dateISO, userId, dateISO],
      );
      return initial + cash + market;
    };

    const startNet = await netWorthAt(from);
    const endNet = await netWorthAt(to);

    // Comparação com o período anterior de mesma duração.
    const prevTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(new Date(prevTo).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const prev = await get(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense
         FROM transactions WHERE ${base}`,
      [userId, prevFrom, prevTo],
    );

    const result = totals.income - totals.expense;

    res.json({
      period: { from, to, days, months },
      indicators: {
        income_total: totals.income,
        expense_total: totals.expense,
        result,
        savings_rate: pct(result, totals.income),
        avg_expense_per_day: Math.round(totals.expense / days),
        avg_expense_per_month: Math.round(totals.expense / months),
        avg_expense_per_transaction: totals.expense_count > 0 ? Math.round(totals.expense / totals.expense_count) : 0,
        avg_income_per_month: Math.round(totals.income / months),
        expense_count: totals.expense_count,
        income_count: totals.income_count,
        biggest_expense: biggestExpense ? serializeTx(biggestExpense) : null,
        top_category: topCategory ?? null,
        net_worth_start: startNet,
        net_worth_end: endNet,
        net_worth_growth: endNet - startNet,
        net_worth_growth_pct: pct(endNet - startNet, startNet),
      },
      comparison: {
        period: { from: prevFrom, to: prevTo },
        income: prev.income,
        expense: prev.expense,
        result: prev.income - prev.expense,
        income_change_pct: pct(totals.income - prev.income, prev.income),
        expense_change_pct: pct(totals.expense - prev.expense, prev.expense),
      },
    });
  }),
);

// ------------------------------------------------------------------
// Agrupamentos
// ------------------------------------------------------------------
router.get(
  '/by-category',
  validateQuery(z.object({
    from: isoDate, to: isoDate,
    kind: z.enum(['income', 'expense']).optional().default('expense'),
    includeSubcategories: z.coerce.boolean().optional().default(false),
  })),
  asyncHandler(async (req, res) => {
    const { from, to, kind, includeSubcategories } = req.validatedQuery;

    const groupKey = includeSubcategories
      ? "COALESCE(cat.id, 0)"
      : "COALESCE(parent.id, cat.id, 0)";
    const nameExpr = includeSubcategories
      ? "COALESCE(cat.name, 'Sem categoria')"
      : "COALESCE(parent.name, cat.name, 'Sem categoria')";
    const colorExpr = includeSubcategories
      ? "COALESCE(cat.color, '#94a3b8')"
      : "COALESCE(parent.color, cat.color, '#94a3b8')";

    const rows = await all(
      `SELECT ${groupKey} AS category_id, ${nameExpr} AS name, ${colorExpr} AS color,
              SUM(t.amount) AS total, COUNT(*) AS tx_count,
              AVG(t.amount) AS avg_amount, MAX(t.amount) AS max_amount
         FROM transactions t
         LEFT JOIN categories cat    ON cat.id = t.category_id
         LEFT JOIN categories parent ON parent.id = cat.parent_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.status <> 'canceled' AND t.kind = ?
          AND t.due_date >= ? AND t.due_date <= ?
        GROUP BY 1, 2, 3 ORDER BY total DESC`,
      [req.user.id, kind, from, to],
    );

    const total = rows.reduce((s, r) => s + r.total, 0);
    res.json({
      data: rows.map((r) => ({ ...r, avg_amount: Math.round(r.avg_amount), share_pct: pct(r.total, total) })),
      total,
    });
  }),
);

router.get(
  '/by-account',
  validateQuery(z.object({ from: isoDate, to: isoDate })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery;
    const rows = await all(
      `SELECT a.id, a.name, a.type, a.color,
              COALESCE(SUM(CASE WHEN t.kind = 'income'  THEN t.amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount END), 0) AS expense,
              COUNT(t.id) AS tx_count
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
              AND t.neutral = 0 AND t.status <> 'canceled'
              AND t.due_date >= ? AND t.due_date <= ?
        WHERE a.user_id = ? GROUP BY a.id ORDER BY expense DESC`,
      [from, to, req.user.id],
    );
    res.json({ data: rows.map((r) => ({ ...r, result: r.income - r.expense })) });
  }),
);

router.get(
  '/by-card',
  validateQuery(z.object({ from: isoDate, to: isoDate })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery;
    const rows = await all(
      `SELECT c.id, c.name, c.color, c.limit_amount,
              COALESCE(SUM(t.amount), 0) AS total, COUNT(t.id) AS tx_count
         FROM credit_cards c
         LEFT JOIN transactions t ON t.card_id = c.id AND t.deleted_at IS NULL
              AND t.status <> 'canceled' AND t.competence_date >= ? AND t.competence_date <= ?
        WHERE c.user_id = ? GROUP BY c.id ORDER BY total DESC`,
      [from, to, req.user.id],
    );
    res.json({ data: rows });
  }),
);

router.get(
  '/by-payment-method',
  validateQuery(z.object({ from: isoDate, to: isoDate })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery;
    const rows = await all(
      `SELECT COALESCE(payment_method, 'nao_informado') AS method,
              SUM(amount) AS total, COUNT(*) AS tx_count
         FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL AND neutral = 0 AND kind = 'expense'
          AND status <> 'canceled' AND due_date >= ? AND due_date <= ?
        GROUP BY 1 ORDER BY total DESC`,
      [req.user.id, from, to],
    );
    const total = rows.reduce((s, r) => s + r.total, 0);
    res.json({ data: rows.map((r) => ({ ...r, share_pct: pct(r.total, total) })), total });
  }),
);

/** Comparativo mês a mês — quanto cada categoria variou. */
router.get(
  '/monthly-comparison',
  validateQuery(z.object({ months: z.coerce.number().int().min(2).max(24).optional().default(6) })),
  asyncHandler(async (req, res) => {
    const { months } = req.validatedQuery;
    const start = addMonths(`${monthKey(today())}-01`, -(months - 1));
    const list = monthsBetween(start, today());

    // Uma consulta agregada para todos os meses, em vez de uma por mês.
    const rows = await all(
      `SELECT to_char(due_date, 'YYYY-MM') AS ym,
              COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0) AS expense
         FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL AND neutral = 0 AND status <> 'canceled'
          AND due_date >= ? AND due_date <= ?
        GROUP BY ym`,
      [req.user.id, monthRange(list[0]).start, monthRange(list.at(-1)).end],
    );
    const byMonth = new Map(rows.map((r) => [r.ym, r]));

    const data = list.map((ym) => {
      const totals = byMonth.get(ym) ?? { income: 0, expense: 0 };
      return {
        month: ym,
        label: `${ym.slice(5)}/${ym.slice(2, 4)}`,
        income: totals.income,
        expense: totals.expense,
        result: totals.income - totals.expense,
        savings_rate: pct(totals.income - totals.expense, totals.income),
      };
    });

    const avgExpense = data.reduce((s, d) => s + d.expense, 0) / (data.length || 1);
    res.json({
      data: data.map((d) => ({ ...d, vs_average_pct: pct(d.expense - avgExpense, avgExpense) })),
      averages: {
        income: Math.round(data.reduce((s, d) => s + d.income, 0) / (data.length || 1)),
        expense: Math.round(avgExpense),
        result: Math.round(data.reduce((s, d) => s + d.result, 0) / (data.length || 1)),
      },
    });
  }),
);

// ------------------------------------------------------------------
// Exportação: CSV, Excel e PDF
// ------------------------------------------------------------------
const EXPORT_COLUMNS = [
  { key: 'due_date', header: 'Vencimento', width: 14, type: 'date' },
  { key: 'settle_date', header: 'Pagamento/Recebimento', width: 20, type: 'date' },
  { key: 'kind_label', header: 'Tipo', width: 12 },
  { key: 'description', header: 'Descrição', width: 40 },
  { key: 'category_name', header: 'Categoria', width: 20 },
  { key: 'subcategory_name', header: 'Subcategoria', width: 20 },
  { key: 'account_name', header: 'Conta', width: 20 },
  { key: 'card_name', header: 'Cartão', width: 18 },
  { key: 'payment_method', header: 'Forma de pagamento', width: 18 },
  { key: 'installment_label', header: 'Parcela', width: 10 },
  { key: 'status_label', header: 'Status', width: 12 },
  { key: 'amount', header: 'Valor (R$)', width: 16, type: 'money' },
];

router.get(
  '/export',
  validateQuery(filterSchema.extend({ format: z.enum(['csv', 'xlsx', 'pdf']).optional().default('csv') })),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const { where, params } = buildTxFilters(toFilterInput(req.user.id, q));

    // Exportação ignora paginação: leva o filtro inteiro, com teto de segurança.
    const rows = (await all(`${TX_SELECT} WHERE ${where} ORDER BY t.due_date ASC LIMIT 20000`, params))
      .map((r) => {
        const tx = serializeTx(r);
        return { ...tx, kind_label: r.kind === 'income' ? 'Receita' : 'Despesa' };
      });

    const totals = {
      income: rows.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0),
      expense: rows.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0),
    };

    const meta = {
      title: 'Relatório financeiro',
      user: req.user.name,
      period: q.from && q.to ? `${q.from} a ${q.to}` : 'Todos os períodos',
      generatedAt: today(),
      totals,
    };

    const stamp = today().replaceAll('-', '');
    const filename = `relatorio-financeiro-${stamp}`;

    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(exportCsv(rows, EXPORT_COLUMNS));
    }

    if (q.format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(await exportXlsx(rows, EXPORT_COLUMNS, meta));
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    return exportPdf(res, rows, EXPORT_COLUMNS, meta);
  }),
);

export { toReais, formatBRL };
export default router;
