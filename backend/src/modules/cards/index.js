import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, transaction, buildUpdate } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { toCents } from '../../utils/money.js';
import { today, monthKey, resolveInvoicePeriod } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';
import { TX_SELECT, serializeTx } from '../../utils/txQuery.js';
import { getOrCreateInvoice } from '../transactions/service.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * RN-05 — limite disponível = limite total − compras ainda não pagas.
 *
 * "Não paga" é exatamente `status = 'pending'`: pagar uma fatura liquida suas
 * compras (marca `settled`), então o status da transação já carrega essa
 * informação. Olhar para o status da FATURA em vez do da transação faria
 * compras antigas de faturas nunca quitadas comprometerem o limite para sempre.
 */
const USED_LIMIT_SQL = `
  COALESCE((
    SELECT SUM(t.amount) FROM transactions t
     WHERE t.card_id = c.id AND t.deleted_at IS NULL AND t.status = 'pending'
  ), 0) AS used_limit
`;

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cartão').max(80),
  institution: z.string().trim().max(80).optional().nullable(),
  brand: z.string().trim().max(40).optional().nullable(),
  limit_amount: z.union([z.number(), z.string()]).optional().default(0),
  closing_day: z.coerce.number().int().min(1).max(31),
  due_day: z.coerce.number().int().min(1).max(31),
  default_account_id: z.coerce.number().int().positive().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#8b5cf6'),
  notes: z.string().max(1000).optional().nullable(),
});

/** Soma de uma fatura (lançamentos não cancelados). */
async function invoiceTotal(invoiceId) {
  const { total } = await get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
      WHERE invoice_id = ? AND deleted_at IS NULL AND status <> 'canceled'`,
    [invoiceId],
  );
  return total;
}

/** Garante que as faturas do mês atual e do próximo existam, para a UI ter o que mostrar. */
async function ensureCurrentInvoices(userId, card) {
  // Em série, não em paralelo: as duas chamadas podem criar faturas, e
  // executá-las juntas arriscaria duas inserções para o mesmo mês.
  const current = await getOrCreateInvoice(userId, card, today());
  const nextMonthDate = `${monthKey(today())}-28`;
  const next = await getOrCreateInvoice(userId, card, nextMonthDate);
  return { current, next };
}

router.get(
  '/',
  validateQuery(z.object({ archived: z.enum(['0', '1', 'all']).optional().default('0') })),
  asyncHandler(async (req, res) => {
    const { archived } = req.validatedQuery;
    const where = archived === 'all' ? '' : 'AND c.archived = ?';
    const params = archived === 'all' ? [req.user.id] : [req.user.id, Number(archived)];

    const cards = await all(
      `SELECT c.*, ${USED_LIMIT_SQL}, a.name AS default_account_name
         FROM credit_cards c
         LEFT JOIN accounts a ON a.id = c.default_account_id
        WHERE c.user_id = ? ${where} ORDER BY c.archived, c.name`,
      params,
    );

    // Um cartão não depende do outro: resolvem-se em paralelo.
    const data = await Promise.all(
      cards.map(async (card) => {
        const { current, next } = await ensureCurrentInvoices(req.user.id, card);
        const [currentTotal, nextTotal] = await Promise.all([
          invoiceTotal(current.id),
          invoiceTotal(next.id),
        ]);

        return {
          ...card,
          archived: !!card.archived,
          available_limit: Math.max(0, card.limit_amount - card.used_limit),
          limit_usage_pct: card.limit_amount > 0
            ? Math.round((card.used_limit / card.limit_amount) * 1000) / 10
            : 0,
          current_invoice: { ...current, total: currentTotal },
          next_invoice: { ...next, total: nextTotal },
        };
      }),
    );

    res.json({ data });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const card = await get(`SELECT c.*, ${USED_LIMIT_SQL} FROM credit_cards c WHERE c.id = ? AND c.user_id = ?`, [
      req.params.id, req.user.id,
    ]);
    if (!card) throw notFound('Cartão não encontrado');
    const { current, next } = await ensureCurrentInvoices(req.user.id, card);

    res.json({
      data: {
        ...card,
        archived: !!card.archived,
        available_limit: Math.max(0, card.limit_amount - card.used_limit),
        current_invoice: { ...current, total: await invoiceTotal(current.id) },
        next_invoice: { ...next, total: await invoiceTotal(next.id) },
      },
    });
  }),
);

/** Histórico de faturas do cartão. */
router.get(
  '/:id/invoices',
  validateQuery(z.object({ limit: z.coerce.number().int().min(1).max(60).optional().default(24) })),
  asyncHandler(async (req, res) => {
    const card = await get('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!card) throw notFound('Cartão não encontrado');

    const invoices = await all(
      `SELECT i.*, COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                 WHERE t.invoice_id = i.id AND t.deleted_at IS NULL AND t.status <> 'canceled'
              ), 0) AS total,
              (SELECT COUNT(*) FROM transactions t
                WHERE t.invoice_id = i.id AND t.deleted_at IS NULL AND t.status <> 'canceled') AS tx_count
         FROM card_invoices i
        WHERE i.card_id = ? ORDER BY i.reference_month DESC LIMIT ?`,
      [card.id, req.validatedQuery.limit],
    );

    res.json({ data: invoices.map((i) => ({ ...i, is_overdue: i.status !== 'paid' && i.due_date < today() })) });
  }),
);

/** Lançamentos de uma fatura específica. */
router.get(
  '/invoices/:invoiceId/transactions',
  asyncHandler(async (req, res) => {
    const invoice = await get('SELECT * FROM card_invoices WHERE id = ? AND user_id = ?', [req.params.invoiceId, req.user.id]);
    if (!invoice) throw notFound('Fatura não encontrada');

    const rows = await all(
      `${TX_SELECT} WHERE t.invoice_id = ? AND t.deleted_at IS NULL ORDER BY t.competence_date DESC, t.id DESC`,
      [invoice.id],
    );

    res.json({
      data: rows.map((r) => serializeTx(r)),
      invoice: { ...invoice, total: await invoiceTotal(invoice.id) },
    });
  }),
);

/**
 * Pagamento da fatura — é AQUI que o dinheiro sai da conta (RN-04).
 * Gera uma despesa real na conta escolhida e quita a fatura.
 */
router.post(
  '/invoices/:invoiceId/pay',
  validate(z.object({
    account_id: z.coerce.number().int().positive(),
    amount: z.union([z.number(), z.string()]).optional(),
    date: isoDate.optional(),
    category_id: z.coerce.number().int().positive().optional().nullable(),
  })),
  asyncHandler(async (req, res) => {
    const invoice = await get('SELECT * FROM card_invoices WHERE id = ? AND user_id = ?', [req.params.invoiceId, req.user.id]);
    if (!invoice) throw notFound('Fatura não encontrada');
    if (invoice.status === 'paid') throw conflict('Esta fatura já está paga');

    const account = await get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [req.body.account_id, req.user.id]);
    if (!account) throw badRequest('Conta não encontrada');

    const card = await get('SELECT * FROM credit_cards WHERE id = ?', [invoice.card_id]);
    const total = await invoiceTotal(invoice.id);
    const amount = req.body.amount !== undefined ? toCents(req.body.amount) : total;
    if (amount <= 0) throw badRequest('Não há valor a pagar nesta fatura');

    const payDate = req.body.date ?? today();

    const result = await transaction(async () => {
      const { lastInsertRowid } = await run(
        `INSERT INTO transactions
           (user_id, kind, description, amount, status, account_id, category_id,
            competence_date, due_date, settle_date, expense_nature, payment_method, notes)
         VALUES (?, 'expense', ?, ?, 'settled', ?, ?, ?, ?, ?, 'fixed', 'boleto', ?)`,
        [req.user.id, `Fatura ${card.name} — ${invoice.reference_month}`, amount, account.id,
         req.body.category_id ?? null, payDate, invoice.due_date, payDate,
         `Pagamento da fatura de referência ${invoice.reference_month}`],
      );
      const txId = Number(lastInsertRowid);

      // Pagamento parcial mantém a fatura aberta e o limite comprometido.
      const fullyPaid = amount >= total;
      await run(
        `UPDATE card_invoices
            SET status = ?, paid_amount = paid_amount + ?, paid_at = ?, payment_tx_id = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [fullyPaid ? 'paid' : 'closed', amount, fullyPaid ? payDate : null, txId, invoice.id],
      );

      // Quitar a fatura liquida as compras que ela contém.
      if (fullyPaid) {
        await run(
          `UPDATE transactions SET status = 'settled', settle_date = ?
            WHERE invoice_id = ? AND deleted_at IS NULL AND status = 'pending'`,
          [payDate, invoice.id],
        );
      }

      return { txId, fullyPaid };
    });

    await logAudit({
      userId: req.user.id, entity: 'card_invoices', entityId: invoice.id, action: 'update',
      summary: `Fatura ${card.name} ${invoice.reference_month} paga`,
    });

    res.json({
      ok: true,
      transaction_id: result.txId,
      fully_paid: result.fullyPaid,
      message: result.fullyPaid ? 'Fatura paga' : 'Pagamento parcial registrado',
    });
  }),
);

router.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.default_account_id) {
      const acc = await get('SELECT id FROM accounts WHERE id = ? AND user_id = ?', [b.default_account_id, req.user.id]);
      if (!acc) throw badRequest('Conta de pagamento não encontrada');
    }

    const { lastInsertRowid } = await run(
      `INSERT INTO credit_cards
         (user_id, name, institution, brand, limit_amount, closing_day, due_day, default_account_id, color, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, b.name, b.institution ?? null, b.brand ?? null, toCents(b.limit_amount),
       b.closing_day, b.due_day, b.default_account_id ?? null, b.color, b.notes ?? null],
    );

    const created = await get('SELECT * FROM credit_cards WHERE id = ?', [Number(lastInsertRowid)]);
    await ensureCurrentInvoices(req.user.id, created);
    await logAudit({ userId: req.user.id, entity: 'credit_cards', entityId: created.id, action: 'create', summary: `Cartão "${created.name}" criado`, after: created });
    res.status(201).json({ data: created });
  }),
);

router.patch(
  '/:id',
  validate(schema.partial().extend({ archived: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const before = await get('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!before) throw notFound('Cartão não encontrado');

    const b = req.body;
    await buildUpdate('credit_cards', before.id, req.user.id, {
      name: b.name,
      institution: b.institution,
      brand: b.brand,
      limit_amount: b.limit_amount !== undefined ? toCents(b.limit_amount) : undefined,
      closing_day: b.closing_day,
      due_day: b.due_day,
      default_account_id: b.default_account_id,
      color: b.color,
      notes: b.notes,
      archived: b.archived === undefined ? undefined : b.archived ? 1 : 0,
    });

    const after = await get('SELECT * FROM credit_cards WHERE id = ?', [before.id]);
    await logAudit({ userId: req.user.id, entity: 'credit_cards', entityId: before.id, action: 'update', summary: `Cartão "${after.name}" atualizado`, before, after });
    res.json({ data: after });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const card = await get('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!card) throw notFound('Cartão não encontrado');

    const { n } = await get('SELECT COUNT(*) AS n FROM transactions WHERE card_id = ? AND deleted_at IS NULL', [card.id]);
    if (n > 0) {
      throw conflict(`Este cartão possui ${n} lançamento(s). Arquive-o para ocultá-lo sem perder o histórico.`);
    }

    await run('DELETE FROM credit_cards WHERE id = ?', [card.id]);
    await logAudit({ userId: req.user.id, entity: 'credit_cards', entityId: card.id, action: 'delete', summary: `Cartão "${card.name}" excluído`, before: card });
    res.json({ ok: true });
  }),
);

/** Simulador: mostra em qual fatura uma compra cairia, antes de confirmar. */
router.get(
  '/:id/preview-invoice',
  validateQuery(z.object({ date: isoDate, installments: z.coerce.number().int().min(1).max(480).optional().default(1) })),
  asyncHandler(async (req, res) => {
    const card = await get('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!card) throw notFound('Cartão não encontrado');

    const { date, installments } = req.validatedQuery;
    const preview = [];
    for (let i = 0; i < installments; i++) {
      const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1 + i, +date.slice(8, 10)));
      const iso = d.toISOString().slice(0, 10);
      const period = resolveInvoicePeriod(iso, card.closing_day, card.due_day);
      preview.push({ installment: i + 1, ...period });
    }
    res.json({ data: preview });
  }),
);

export default router;
