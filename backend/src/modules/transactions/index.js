import { Router } from 'express';
import { z } from 'zod';
import { all, get } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { buildTxFilters, buildOrder, TX_SELECT, serializeTx } from '../../utils/txQuery.js';
import { toCents } from '../../utils/money.js';
import { today } from '../../utils/dates.js';
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  duplicateTransaction,
  settleTransaction,
} from './service.js';

const router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em AAAA-MM-DD');
const money = z.union([z.number(), z.string()]);

/** Schema de filtros — reaproveitado por Receitas, Despesas e Histórico. */
export const filterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  dateField: z.enum(['due', 'competence', 'settle']).optional().default('due'),
  kind: z.enum(['income', 'expense']).optional(),
  status: z.enum(['pending', 'settled', 'canceled', 'overdue']).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  accountId: z.coerce.number().int().positive().optional(),
  cardId: z.coerce.number().int().positive().optional(),
  invoiceId: z.coerce.number().int().positive().optional(),
  incomeType: z.string().optional(),
  expenseNature: z.enum(['fixed', 'variable']).optional(),
  paymentMethod: z.string().optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  search: z.string().trim().max(120).optional(),
  onlyInstallments: z.coerce.boolean().optional(),
  onlyRecurring: z.coerce.boolean().optional(),
  includeNeutral: z.coerce.boolean().optional().default(false),
  sort: z.enum(['due_date', 'competence_date', 'settle_date', 'amount', 'description', 'created_at'])
    .optional().default('due_date'),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(25),
});

/** Traduz filtros da query (reais) para o formato interno (centavos). */
export function toFilterInput(userId, q) {
  return {
    ...q,
    userId,
    minAmount: q.minAmount !== undefined ? toCents(q.minAmount) : undefined,
    maxAmount: q.maxAmount !== undefined ? toCents(q.maxAmount) : undefined,
  };
}

const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual']),
  interval_n: z.coerce.number().int().min(1).max(12).optional().default(1),
  end_date: isoDate.optional().nullable(),
  max_count: z.coerce.number().int().min(1).max(600).optional().nullable(),
});

const createSchema = z.object({
  kind: z.enum(['income', 'expense']),
  description: z.string().trim().min(1, 'Informe a descrição').max(200),
  amount: money,
  status: z.enum(['pending', 'settled', 'canceled']).optional().default('pending'),
  category_id: z.coerce.number().int().positive().optional().nullable(),
  subcategory_id: z.coerce.number().int().positive().optional().nullable(),
  account_id: z.coerce.number().int().positive().optional().nullable(),
  competence_date: isoDate.optional(),
  due_date: isoDate,
  settle_date: isoDate.optional().nullable(),
  income_type: z.enum(['salario', 'renda_extra', 'comissao', 'venda', 'dividendos', 'juros',
    'reembolso', 'aluguel', 'premio', 'outros']).optional().nullable(),
  receipt_method: z.string().max(40).optional().nullable(),
  expense_nature: z.enum(['fixed', 'variable']).optional(),
  payment_method: z.enum(['dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia',
    'cheque', 'vale', 'outros']).optional().nullable(),
  card_id: z.coerce.number().int().positive().optional().nullable(),
  installment_total: z.coerce.number().int().min(1).max(480).optional().default(1),
  recurrence: recurrenceSchema.optional().nullable(),
  tags: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  goal_id: z.coerce.number().int().positive().optional().nullable(),
});

// ------------------------------------------------------------------
// GET /api/transactions — lista paginada + totais do filtro atual
// ------------------------------------------------------------------
router.get(
  '/',
  validateQuery(filterSchema),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const { where, params } = buildTxFilters(toFilterInput(req.user.id, q));
    const order = buildOrder(q.sort, q.dir);
    const offset = (q.page - 1) * q.pageSize;

    const rows = await all(`${TX_SELECT} WHERE ${where} ${order} LIMIT ? OFFSET ?`, [...params, q.pageSize, offset]);
    const { total } = await get(`SELECT COUNT(*) AS total FROM transactions t WHERE ${where}`, params);

    // Totais consideram TODO o filtro, não apenas a página exibida.
    const totals = await get(
      `SELECT
         COALESCE(SUM(CASE WHEN t.kind = 'income'  THEN t.amount END), 0) AS income_total,
         COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount END), 0) AS expense_total,
         COALESCE(SUM(CASE WHEN t.status = 'settled' AND t.kind = 'income'  THEN t.amount END), 0) AS income_settled,
         COALESCE(SUM(CASE WHEN t.status = 'settled' AND t.kind = 'expense' THEN t.amount END), 0) AS expense_settled,
         COALESCE(SUM(CASE WHEN t.status = 'pending' THEN t.amount END), 0) AS pending_total,
         COALESCE(SUM(CASE WHEN t.status = 'pending' AND t.due_date < ? THEN t.amount END), 0) AS overdue_total
       FROM transactions t WHERE ${where}`,
      [today(), ...params],
    );

    res.json({
      data: rows.map((r) => serializeTx(r)),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
      totals: { ...totals, balance: totals.income_total - totals.expense_total },
    });
  }),
);

/** Próximos vencimentos — usado no Dashboard. */
router.get(
  '/upcoming',
  validateQuery(z.object({
    days: z.coerce.number().int().min(1).max(365).optional().default(30),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  })),
  asyncHandler(async (req, res) => {
    const { days, limit } = req.validatedQuery;
    const rows = await all(
      `${TX_SELECT}
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.status = 'pending'
          AND t.due_date <= (?::date + (? || ' days')::interval)
        ORDER BY t.due_date ASC LIMIT ?`,
      [req.user.id, today(), days, limit],
    );
    res.json({ data: rows.map((r) => serializeTx(r)) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await get(`${TX_SELECT} WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL`, [
      req.params.id, req.user.id,
    ]);
    if (!row) throw notFound('Lançamento não encontrado');

    const attachments = await all('SELECT * FROM attachments WHERE transaction_id = ?', [row.id]);
    const siblings = row.installment_group
      ? await all(
          `SELECT id, installment_no, due_date, amount, status FROM transactions
            WHERE installment_group = ? AND deleted_at IS NULL ORDER BY installment_no`,
          [row.installment_group],
        )
      : [];

    res.json({ data: { ...serializeTx(row), attachments, installments: siblings } });
  }),
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const result = await createTransaction(req.user.id, req.body);
    res.status(201).json({ ...result, message: result.count > 1 ? `${result.count} lançamentos criados` : 'Lançamento criado' });
  }),
);

router.patch(
  '/:id',
  validate(createSchema.partial().omit({ kind: true, installment_total: true, recurrence: true })),
  asyncHandler(async (req, res) => {
    const updated = await updateTransaction(req.user.id, Number(req.params.id), req.body);
    res.json({ data: serializeTx(updated) });
  }),
);

router.delete(
  '/:id',
  validateQuery(z.object({ scope: z.enum(['one', 'future', 'all']).optional().default('one') })),
  asyncHandler(async (req, res) => {
    const deleted = await deleteTransaction(req.user.id, Number(req.params.id), req.validatedQuery.scope);
    res.json({ ok: true, deleted });
  }),
);

router.post(
  '/:id/duplicate',
  validate(z.object({
    description: z.string().trim().max(200).optional(),
    amount: money.optional(),
    due_date: isoDate.optional(),
    competence_date: isoDate.optional(),
  })),
  asyncHandler(async (req, res) => {
    res.status(201).json(await duplicateTransaction(req.user.id, Number(req.params.id), req.body));
  }),
);

router.post(
  '/:id/settle',
  validate(z.object({
    settled: z.boolean().optional().default(true),
    date: isoDate.optional(),
    accountId: z.coerce.number().int().positive().optional(),
  })),
  asyncHandler(async (req, res) => {
    const updated = await settleTransaction(req.user.id, Number(req.params.id), req.body);
    res.json({ data: serializeTx(updated) });
  }),
);

/** Baixa em lote — marcar várias contas como pagas de uma vez. */
router.post(
  '/bulk-settle',
  validate(z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
    settled: z.boolean().optional().default(true),
    date: isoDate.optional(),
  })),
  asyncHandler(async (req, res) => {
    const { ids, settled, date } = req.body;
    let updated = 0;
    for (const id of ids) {
      try {
        await settleTransaction(req.user.id, id, { settled, date });
        updated++;
      } catch {
        // Ignora ids inválidos para não abortar o lote inteiro.
      }
    }
    res.json({ ok: true, updated });
  }),
);

export default router;
