import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, buildUpdate } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, conflict, notFound } from '../../utils/errors.js';
import { logAudit } from '../../utils/audit.js';
import { toCents } from '../../utils/money.js';
import { TX_SELECT, serializeTx } from '../../utils/txQuery.js';

const router = Router();

export const ACCOUNT_TYPES = [
  'checking', 'savings', 'wallet', 'cash', 'digital', 'broker', 'other',
];

/**
 * RN-01 — saldo nunca é armazenado, sempre derivado das transações liquidadas.
 * `predicted_balance` projeta o saldo considerando também o que está pendente.
 *
 * Despesas de cartão têm account_id NULL (pertencem à fatura), então não
 * aparecem aqui — só o pagamento da fatura movimenta a conta (RN-04).
 */
const BALANCE_SQL = `
  a.initial_balance + COALESCE((
    SELECT SUM(CASE WHEN t.kind IN ('income','transfer_in') THEN t.amount ELSE -t.amount END)
      FROM transactions t
     WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.status = 'settled'
  ), 0) AS current_balance,
  a.initial_balance + COALESCE((
    SELECT SUM(CASE WHEN t.kind IN ('income','transfer_in') THEN t.amount ELSE -t.amount END)
      FROM transactions t
     WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.status <> 'canceled'
  ), 0) AS predicted_balance
`;

const baseSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da conta').max(80),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(80).optional().nullable(),
  initial_balance: z.union([z.number(), z.string()]).optional().default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida').optional().default('#6366f1'),
  icon: z.string().max(40).optional().default('wallet'),
  include_in_total: z.boolean().optional().default(true),
  notes: z.string().max(1000).optional().nullable(),
});

router.get(
  '/',
  validateQuery(z.object({ archived: z.enum(['0', '1', 'all']).optional().default('0') })),
  asyncHandler(async (req, res) => {
    const { archived } = req.validatedQuery;
    const where = archived === 'all' ? '' : 'AND a.archived = ?';
    const params = archived === 'all' ? [req.user.id] : [req.user.id, Number(archived)];

    const accounts = all(
      `SELECT a.*, ${BALANCE_SQL} FROM accounts a WHERE a.user_id = ? ${where} ORDER BY a.archived, a.name`,
      params,
    ).map((a) => ({ ...a, archived: !!a.archived, include_in_total: !!a.include_in_total }));

    const total = accounts
      .filter((a) => a.include_in_total && !a.archived)
      .reduce((sum, a) => sum + a.current_balance, 0);

    res.json({ data: accounts, total_balance: total });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const account = get(`SELECT a.*, ${BALANCE_SQL} FROM accounts a WHERE a.id = ? AND a.user_id = ?`, [
      req.params.id,
      req.user.id,
    ]);
    if (!account) throw notFound('Conta não encontrada');
    res.json({ data: { ...account, archived: !!account.archived } });
  }),
);

/** Extrato da conta — movimentações em ordem cronológica com saldo acumulado. */
router.get(
  '/:id/statement',
  validateQuery(
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(200),
    }),
  ),
  asyncHandler(async (req, res) => {
    const account = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!account) throw notFound('Conta não encontrada');

    const { from, to, limit } = req.validatedQuery;
    const where = ['t.account_id = ?', 't.deleted_at IS NULL', "t.status <> 'canceled'"];
    const params = [account.id];
    if (from) { where.push('t.due_date >= ?'); params.push(from); }
    if (to) { where.push('t.due_date <= ?'); params.push(to); }

    const rows = all(
      `${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.due_date ASC, t.id ASC LIMIT ?`,
      [...params, limit],
    );

    // Saldo acumulado começa no saldo anterior ao primeiro item da janela.
    let running = account.initial_balance;
    if (from) {
      const prior = get(
        `SELECT COALESCE(SUM(CASE WHEN kind IN ('income','transfer_in') THEN amount ELSE -amount END), 0) AS s
           FROM transactions
          WHERE account_id = ? AND deleted_at IS NULL AND status = 'settled' AND due_date < ?`,
        [account.id, from],
      );
      running += prior.s;
    }

    const data = rows.map((row) => {
      const signed = row.kind === 'income' || row.kind === 'transfer_in' ? row.amount : -row.amount;
      if (row.status === 'settled') running += signed;
      return { ...serializeTx(row), signed_amount: signed, running_balance: running };
    });

    res.json({ data, opening_balance: account.initial_balance });
  }),
);

router.post(
  '/',
  validate(baseSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { lastInsertRowid } = run(
      `INSERT INTO accounts (user_id, name, type, institution, initial_balance, color, icon, include_in_total, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, b.name, b.type, b.institution ?? null, toCents(b.initial_balance),
       b.color, b.icon, b.include_in_total ? 1 : 0, b.notes ?? null],
    );
    const created = get(`SELECT a.*, ${BALANCE_SQL} FROM accounts a WHERE a.id = ?`, [Number(lastInsertRowid)]);
    logAudit({ userId: req.user.id, entity: 'accounts', entityId: created.id, action: 'create', summary: `Conta "${created.name}" criada`, after: created });
    res.status(201).json({ data: created });
  }),
);

router.patch(
  '/:id',
  validate(baseSchema.partial().extend({ archived: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const before = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!before) throw notFound('Conta não encontrada');

    const b = req.body;
    buildUpdate('accounts', before.id, req.user.id, {
      name: b.name,
      type: b.type,
      institution: b.institution,
      initial_balance: b.initial_balance !== undefined ? toCents(b.initial_balance) : undefined,
      color: b.color,
      icon: b.icon,
      include_in_total: b.include_in_total === undefined ? undefined : b.include_in_total ? 1 : 0,
      archived: b.archived === undefined ? undefined : b.archived ? 1 : 0,
      notes: b.notes,
    });

    const after = get(`SELECT a.*, ${BALANCE_SQL} FROM accounts a WHERE a.id = ?`, [before.id]);
    logAudit({ userId: req.user.id, entity: 'accounts', entityId: before.id, action: 'update', summary: `Conta "${after.name}" atualizada`, before, after });
    res.json({ data: after });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const account = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!account) throw notFound('Conta não encontrada');

    const { n } = get(
      'SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND deleted_at IS NULL',
      [account.id],
    );
    // Excluir apagaria o histórico. Arquivar preserva os lançamentos (RN-11).
    if (n > 0) {
      throw conflict(
        `Esta conta possui ${n} movimentação(ões) e não pode ser excluída. Arquive-a para ocultá-la sem perder o histórico.`,
      );
    }

    run('DELETE FROM accounts WHERE id = ?', [account.id]);
    logAudit({ userId: req.user.id, entity: 'accounts', entityId: account.id, action: 'delete', summary: `Conta "${account.name}" excluída`, before: account });
    res.json({ ok: true });
  }),
);

export default router;
