import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, transaction } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { toCents } from '../../utils/money.js';
import { today } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const schema = z.object({
  from_account_id: z.coerce.number().int().positive(),
  to_account_id: z.coerce.number().int().positive(),
  amount: z.union([z.number(), z.string()]),
  fee: z.union([z.number(), z.string()]).optional().default(0),
  date: isoDate.optional(),
  description: z.string().trim().max(200).optional().default('Transferência'),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * RN-02 — a transferência gera DUAS transações espelhadas marcadas `neutral = 1`.
 * Elas movimentam o saldo das contas, mas todo agregado de receita/despesa
 * filtra `neutral = 0`, então jamais inflam o resultado do mês.
 *
 * A tarifa (fee), se houver, sai da conta de origem como despesa REAL —
 * é custo de fato, não movimentação neutra.
 */
function createTransferLegs(userId, tr, accounts) {
  const common = {
    description: tr.description,
    competence: tr.date,
    due: tr.date,
  };

  run(
    `INSERT INTO transactions
       (user_id, kind, description, amount, status, neutral, account_id,
        competence_date, due_date, settle_date, transfer_id, notes)
     VALUES (?, 'transfer_out', ?, ?, 'settled', 1, ?, ?, ?, ?, ?, ?)`,
    [userId, `${common.description} → ${accounts.to.name}`, tr.amount, tr.from_account_id,
     common.competence, common.due, tr.date, tr.id, tr.notes ?? null],
  );

  run(
    `INSERT INTO transactions
       (user_id, kind, description, amount, status, neutral, account_id,
        competence_date, due_date, settle_date, transfer_id, notes)
     VALUES (?, 'transfer_in', ?, ?, 'settled', 1, ?, ?, ?, ?, ?, ?)`,
    [userId, `${common.description} ← ${accounts.from.name}`, tr.amount, tr.to_account_id,
     common.competence, common.due, tr.date, tr.id, tr.notes ?? null],
  );

  if (tr.fee > 0) {
    run(
      `INSERT INTO transactions
         (user_id, kind, description, amount, status, neutral, account_id,
          competence_date, due_date, settle_date, expense_nature, payment_method, transfer_id)
       VALUES (?, 'expense', ?, ?, 'settled', 0, ?, ?, ?, ?, 'variable', 'transferencia', ?)`,
      [userId, `Tarifa — ${common.description}`, tr.fee, tr.from_account_id,
       common.competence, common.due, tr.date, tr.id],
    );
  }
}

router.get(
  '/',
  validateQuery(z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    accountId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(200).optional().default(25),
  })),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const where = ['t.user_id = ?', 't.deleted_at IS NULL'];
    const params = [req.user.id];
    if (q.from) { where.push('t.date >= ?'); params.push(q.from); }
    if (q.to) { where.push('t.date <= ?'); params.push(q.to); }
    if (q.accountId) {
      where.push('(t.from_account_id = ? OR t.to_account_id = ?)');
      params.push(q.accountId, q.accountId);
    }
    const clause = where.join(' AND ');

    const rows = all(
      `SELECT t.*, af.name AS from_account_name, af.color AS from_account_color,
              at.name AS to_account_name,   at.color AS to_account_color
         FROM transfers t
         JOIN accounts af ON af.id = t.from_account_id
         JOIN accounts at ON at.id = t.to_account_id
        WHERE ${clause}
        ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    const { total } = get(`SELECT COUNT(*) AS total FROM transfers t WHERE ${clause}`, params);

    res.json({
      data: rows,
      pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    });
  }),
);

router.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.from_account_id === b.to_account_id) throw badRequest('Origem e destino devem ser contas diferentes');

    const from = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [b.from_account_id, req.user.id]);
    const to = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [b.to_account_id, req.user.id]);
    if (!from) throw badRequest('Conta de origem não encontrada');
    if (!to) throw badRequest('Conta de destino não encontrada');

    const amount = toCents(b.amount);
    const fee = toCents(b.fee);
    if (amount <= 0) throw badRequest('O valor deve ser maior que zero');

    const date = b.date ?? today();

    const created = transaction(() => {
      const { lastInsertRowid } = run(
        `INSERT INTO transfers (user_id, from_account_id, to_account_id, amount, fee, date, description, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, from.id, to.id, amount, fee, date, b.description, b.notes ?? null],
      );
      const tr = { id: Number(lastInsertRowid), ...b, amount, fee, date };
      createTransferLegs(req.user.id, tr, { from, to });
      return get('SELECT * FROM transfers WHERE id = ?', [tr.id]);
    });

    logAudit({ userId: req.user.id, entity: 'transfers', entityId: created.id, action: 'create', summary: `Transferência ${from.name} → ${to.name}`, after: created });
    res.status(201).json({ data: created });
  }),
);

router.patch(
  '/:id',
  validate(schema.partial()),
  asyncHandler(async (req, res) => {
    const before = get('SELECT * FROM transfers WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [req.params.id, req.user.id]);
    if (!before) throw notFound('Transferência não encontrada');

    const b = req.body;
    const next = {
      from_account_id: b.from_account_id ?? before.from_account_id,
      to_account_id: b.to_account_id ?? before.to_account_id,
      amount: b.amount !== undefined ? toCents(b.amount) : before.amount,
      fee: b.fee !== undefined ? toCents(b.fee) : before.fee,
      date: b.date ?? before.date,
      description: b.description ?? before.description,
      notes: b.notes !== undefined ? b.notes : before.notes,
    };
    if (next.from_account_id === next.to_account_id) throw badRequest('Origem e destino devem ser contas diferentes');

    const from = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [next.from_account_id, req.user.id]);
    const to = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [next.to_account_id, req.user.id]);
    if (!from || !to) throw badRequest('Conta não encontrada');

    const after = transaction(() => {
      run(
        `UPDATE transfers SET from_account_id = ?, to_account_id = ?, amount = ?, fee = ?,
                              date = ?, description = ?, notes = ?, updated_at = datetime('now','localtime')
          WHERE id = ?`,
        [next.from_account_id, next.to_account_id, next.amount, next.fee, next.date, next.description, next.notes, before.id],
      );
      // Recriar as pernas é mais simples e seguro do que sincronizá-las campo a campo.
      run('DELETE FROM transactions WHERE transfer_id = ?', [before.id]);
      createTransferLegs(req.user.id, { id: before.id, ...next }, { from, to });
      return get('SELECT * FROM transfers WHERE id = ?', [before.id]);
    });

    logAudit({ userId: req.user.id, entity: 'transfers', entityId: before.id, action: 'update', summary: 'Transferência editada', before, after });
    res.json({ data: after });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const tr = get('SELECT * FROM transfers WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [req.params.id, req.user.id]);
    if (!tr) throw notFound('Transferência não encontrada');

    transaction(() => {
      run("UPDATE transfers SET deleted_at = datetime('now','localtime') WHERE id = ?", [tr.id]);
      run("UPDATE transactions SET deleted_at = datetime('now','localtime') WHERE transfer_id = ?", [tr.id]);
    });

    logAudit({ userId: req.user.id, entity: 'transfers', entityId: tr.id, action: 'delete', summary: 'Transferência excluída', before: tr });
    res.json({ ok: true });
  }),
);

export default router;
