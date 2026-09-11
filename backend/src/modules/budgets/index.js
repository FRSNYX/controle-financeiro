import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { toCents, pct } from '../../utils/money.js';
import { monthRange, monthKey, today } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';

const router = Router();
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Mês deve estar em AAAA-MM');

/** RN-08 — alerta escalona conforme o consumo do limite. */
function alertLevel(percent) {
  if (percent >= 100) return { level: 'exceeded', label: 'Limite estourado', severity: 'danger' };
  if (percent >= 90) return { level: 'critical', label: 'Atingiu 90% do limite', severity: 'danger' };
  if (percent >= 80) return { level: 'warning', label: 'Atingiu 80% do limite', severity: 'warning' };
  return { level: 'ok', label: 'Dentro do limite', severity: 'success' };
}

/** Gasto realizado do mês para uma categoria (NULL = todas as despesas). */
async function spentInMonth(userId, month, categoryId) {
  const { start, end } = monthRange(month);
  const where = [
    'user_id = ?', "kind = 'expense'", 'deleted_at IS NULL', 'neutral = 0',
    "status <> 'canceled'", 'due_date >= ?', 'due_date <= ?',
  ];
  const params = [userId, start, end];
  if (categoryId) {
    where.push('(category_id = ? OR subcategory_id = ?)');
    params.push(categoryId, categoryId);
  }
  return await get(
    `SELECT COALESCE(SUM(amount), 0) AS spent,
            COALESCE(SUM(CASE WHEN status = 'settled' THEN amount END), 0) AS paid
       FROM transactions WHERE ${where.join(' AND ')}`,
    params,
  );
}

// ------------------------------------------------------------------
// GET /api/budgets?month=YYYY-MM
// ------------------------------------------------------------------
router.get(
  '/',
  validateQuery(z.object({ month: monthSchema.optional() })),
  asyncHandler(async (req, res) => {
    const month = req.validatedQuery.month ?? monthKey(today());

    const rows = await all(
      `SELECT b.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
         FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.user_id = ? AND b.month = ?
        ORDER BY b.category_id IS NULL DESC, c.name`,
      [req.user.id, month],
    );

    const categories = [];
    let general = null;

    for (const b of rows) {
      const { spent, paid } = await spentInMonth(req.user.id, month, b.category_id);
      const percent = pct(spent, b.limit_amount);
      const item = {
        ...b,
        spent,
        paid,
        remaining: b.limit_amount - spent,
        percent_used: percent,
        alert: alertLevel(percent),
      };
      if (b.category_id === null) general = item;
      else categories.push(item);
    }

    // Orçamento geral: compara com o total gasto no mês, não com a soma dos limites.
    if (!general) {
      const { spent } = await spentInMonth(req.user.id, month, null);
      general = { id: null, month, category_id: null, limit_amount: 0, spent, remaining: -spent, percent_used: 0, alert: alertLevel(0) };
    }

    const limitSum = categories.reduce((s, c) => s + c.limit_amount, 0);
    const spentSum = categories.reduce((s, c) => s + c.spent, 0);

    res.json({
      month,
      general,
      data: categories,
      summary: {
        categories_count: categories.length,
        limit_total: limitSum,
        spent_total: spentSum,
        remaining_total: limitSum - spentSum,
        percent_used: pct(spentSum, limitSum),
        alerts: categories.filter((c) => c.alert.level !== 'ok').length,
      },
    });
  }),
);

/** Cria ou atualiza — o índice único (user, mês, categoria) evita duplicidade. */
router.put(
  '/',
  validate(z.object({
    month: monthSchema,
    category_id: z.coerce.number().int().positive().optional().nullable(),
    limit_amount: z.union([z.number(), z.string()]),
    notes: z.string().max(500).optional().nullable(),
  })),
  asyncHandler(async (req, res) => {
    const { month, category_id = null, limit_amount, notes = null } = req.body;
    const limit = toCents(limit_amount);

    await run(
      `INSERT INTO budgets (user_id, month, category_id, limit_amount, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, month, COALESCE(category_id, -1))
       DO UPDATE SET limit_amount = excluded.limit_amount,
                     notes = excluded.notes,
                     updated_at = NOW()`,
      [req.user.id, month, category_id, limit, notes],
    );

    const saved = await get(
      'SELECT * FROM budgets WHERE user_id = ? AND month = ? AND COALESCE(category_id, -1) = COALESCE(?, -1)',
      [req.user.id, month, category_id],
    );
    const { spent } = await spentInMonth(req.user.id, month, category_id);
    const percent = pct(spent, limit);

    await logAudit({ userId: req.user.id, entity: 'budgets', entityId: saved.id, action: 'update', summary: `Orçamento de ${month} definido`, after: saved });
    res.json({ data: { ...saved, spent, remaining: limit - spent, percent_used: percent, alert: alertLevel(percent) } });
  }),
);

/** Copia os limites de um mês para outro — evita redigitar todo início de mês. */
router.post(
  '/copy',
  validate(z.object({ from: monthSchema, to: monthSchema })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.body;
    const source = await all('SELECT * FROM budgets WHERE user_id = ? AND month = ?', [req.user.id, from]);

    let copied = 0;
    for (const b of source) {
      await run(
        `INSERT INTO budgets (user_id, month, category_id, limit_amount, notes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, month, COALESCE(category_id, -1))
         DO UPDATE SET limit_amount = excluded.limit_amount, updated_at = NOW()`,
        [req.user.id, to, b.category_id, b.limit_amount, b.notes],
      );
      copied++;
    }

    res.json({ ok: true, copied, message: `${copied} limite(s) copiado(s) de ${from} para ${to}` });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = await get('SELECT * FROM budgets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!b) throw notFound('Orçamento não encontrado');
    await run('DELETE FROM budgets WHERE id = ?', [b.id]);
    await logAudit({ userId: req.user.id, entity: 'budgets', entityId: b.id, action: 'delete', summary: `Orçamento de ${b.month} removido`, before: b });
    res.json({ ok: true });
  }),
);

export { alertLevel, spentInMonth };
export default router;
