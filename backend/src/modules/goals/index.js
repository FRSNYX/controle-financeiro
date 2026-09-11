import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, transaction, buildUpdate } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { toCents, pct } from '../../utils/money.js';
import { today, diffDays } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const GOAL_TYPES = [
  'reserva_emergencia', 'viagem', 'carro', 'imovel', 'notebook',
  'investimento', 'educacao', 'casamento', 'outros',
];

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da meta').max(120),
  type: z.enum(GOAL_TYPES).optional().default('outros'),
  target_amount: z.union([z.number(), z.string()]),
  start_date: isoDate.optional(),
  target_date: isoDate,
  account_id: z.coerce.number().int().positive().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#10b981'),
  icon: z.string().max(40).optional().default('target'),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Enriquece a meta com progresso e ritmo necessário.
 * `monthly_needed` responde à pergunta que importa: "quanto preciso guardar
 * por mês, a partir de hoje, para chegar lá no prazo?".
 */
function decorate(goal) {
  const { current } = get(
    'SELECT COALESCE(SUM(amount), 0) AS current FROM goal_contributions WHERE goal_id = ?',
    [goal.id],
  );

  const remaining = Math.max(0, goal.target_amount - current);
  const daysLeft = diffDays(today(), goal.target_date);
  const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30));

  return {
    ...goal,
    current_amount: current,
    remaining_amount: remaining,
    percent: Math.min(100, pct(current, goal.target_amount)),
    days_left: daysLeft,
    is_late: daysLeft < 0 && remaining > 0,
    is_complete: current >= goal.target_amount,
    monthly_needed: daysLeft > 0 ? Math.ceil(remaining / monthsLeft) : remaining,
  };
}

router.get(
  '/',
  validateQuery(z.object({ status: z.enum(['active', 'done', 'canceled', 'all']).optional().default('active') })),
  asyncHandler(async (req, res) => {
    const { status } = req.validatedQuery;
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (status !== 'all') { where.push('status = ?'); params.push(status); }

    const data = all(
      `SELECT * FROM goals WHERE ${where.join(' AND ')} ORDER BY status, target_date`,
      params,
    ).map(decorate);

    res.json({
      data,
      summary: {
        count: data.length,
        target_total: data.reduce((s, g) => s + g.target_amount, 0),
        current_total: data.reduce((s, g) => s + g.current_amount, 0),
        completed: data.filter((g) => g.is_complete).length,
        late: data.filter((g) => g.is_late).length,
      },
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const goal = get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!goal) throw notFound('Meta não encontrada');

    const contributions = all(
      'SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC',
      [goal.id],
    );
    res.json({ data: { ...decorate(goal), contributions } });
  }),
);

router.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const target = toCents(b.target_amount);
    if (target <= 0) throw badRequest('O valor objetivo deve ser maior que zero');

    const start = b.start_date ?? today();
    if (b.target_date < start) throw badRequest('A data prevista deve ser posterior à data de início');

    const { lastInsertRowid } = run(
      `INSERT INTO goals (user_id, name, type, target_amount, start_date, target_date, account_id, color, icon, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, b.name, b.type, target, start, b.target_date, b.account_id ?? null, b.color, b.icon, b.notes ?? null],
    );

    const created = get('SELECT * FROM goals WHERE id = ?', [Number(lastInsertRowid)]);
    logAudit({ userId: req.user.id, entity: 'goals', entityId: created.id, action: 'create', summary: `Meta "${created.name}" criada`, after: created });
    res.status(201).json({ data: decorate(created) });
  }),
);

router.patch(
  '/:id',
  validate(schema.partial().extend({ status: z.enum(['active', 'done', 'canceled']).optional() })),
  asyncHandler(async (req, res) => {
    const before = get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!before) throw notFound('Meta não encontrada');

    const b = req.body;
    buildUpdate('goals', before.id, req.user.id, {
      name: b.name, type: b.type,
      target_amount: b.target_amount !== undefined ? toCents(b.target_amount) : undefined,
      start_date: b.start_date, target_date: b.target_date,
      account_id: b.account_id, color: b.color, icon: b.icon,
      status: b.status, notes: b.notes,
    });

    const after = get('SELECT * FROM goals WHERE id = ?', [before.id]);
    logAudit({ userId: req.user.id, entity: 'goals', entityId: before.id, action: 'update', summary: `Meta "${after.name}" atualizada`, before, after });
    res.json({ data: decorate(after) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const goal = get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!goal) throw notFound('Meta não encontrada');
    run('DELETE FROM goals WHERE id = ?', [goal.id]);
    logAudit({ userId: req.user.id, entity: 'goals', entityId: goal.id, action: 'delete', summary: `Meta "${goal.name}" excluída`, before: goal });
    res.json({ ok: true });
  }),
);

/** Aporte na meta. `amount` negativo representa retirada. */
router.post(
  '/:id/contributions',
  validate(z.object({
    amount: z.union([z.number(), z.string()]),
    date: isoDate.optional(),
    notes: z.string().max(500).optional().nullable(),
    create_transaction: z.boolean().optional().default(false),
    account_id: z.coerce.number().int().positive().optional().nullable(),
  })),
  asyncHandler(async (req, res) => {
    const goal = get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!goal) throw notFound('Meta não encontrada');

    const b = req.body;
    const amount = toCents(b.amount);
    if (amount === 0) throw badRequest('Informe um valor diferente de zero');
    const date = b.date ?? today();

    transaction(() => {
      run(
        'INSERT INTO goal_contributions (user_id, goal_id, amount, date, notes) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, goal.id, amount, date, b.notes ?? null],
      );

      if (b.create_transaction && b.account_id && amount > 0) {
        run(
          `INSERT INTO transactions
             (user_id, kind, description, amount, status, account_id, competence_date,
              due_date, settle_date, expense_nature, payment_method, goal_id, notes)
           VALUES (?, 'expense', ?, ?, 'settled', ?, ?, ?, ?, 'variable', 'transferencia', ?, ?)`,
          [req.user.id, `Aporte — ${goal.name}`, amount, b.account_id, date, date, date, goal.id,
           `Aporte para a meta "${goal.name}"`],
        );
      }

      // Meta atingida encerra sozinha: não exige ação do usuário.
      const { current } = get(
        'SELECT COALESCE(SUM(amount), 0) AS current FROM goal_contributions WHERE goal_id = ?',
        [goal.id],
      );
      if (current >= goal.target_amount && goal.status === 'active') {
        run("UPDATE goals SET status = 'done', updated_at = datetime('now','localtime') WHERE id = ?", [goal.id]);
      }
    });

    const after = get('SELECT * FROM goals WHERE id = ?', [goal.id]);
    logAudit({ userId: req.user.id, entity: 'goals', entityId: goal.id, action: 'update', summary: `Aporte em "${goal.name}"` });
    res.status(201).json({ data: decorate(after) });
  }),
);

router.delete(
  '/:id/contributions/:contributionId',
  asyncHandler(async (req, res) => {
    const c = get('SELECT * FROM goal_contributions WHERE id = ? AND goal_id = ? AND user_id = ?', [
      req.params.contributionId, req.params.id, req.user.id,
    ]);
    if (!c) throw notFound('Aporte não encontrado');
    run('DELETE FROM goal_contributions WHERE id = ?', [c.id]);
    res.json({ ok: true });
  }),
);

export default router;
