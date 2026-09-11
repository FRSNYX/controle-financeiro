import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { today, addDays } from '../../utils/dates.js';
import { TX_SELECT, serializeTx } from '../../utils/txQuery.js';
import { notify } from '../../utils/audit.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ENTITY_LABELS = {
  transactions: 'Lançamento', accounts: 'Conta', categories: 'Categoria',
  credit_cards: 'Cartão', card_invoices: 'Fatura', transfers: 'Transferência',
  investments: 'Investimento', budgets: 'Orçamento', goals: 'Meta',
  assets: 'Bem', liabilities: 'Dívida', users: 'Usuário',
};

const ACTION_LABELS = {
  create: 'Criação', update: 'Alteração', delete: 'Exclusão',
  restore: 'Restauração', login: 'Acesso', import: 'Importação',
};

/** GET /api/history — trilha de auditoria (o que mudou, quando e como). */
router.get(
  '/',
  validateQuery(z.object({
    entity: z.string().optional(),
    action: z.enum(['create', 'update', 'delete', 'restore', 'login', 'import']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(30),
  })),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const where = ['user_id = ?'];
    const params = [req.user.id];

    if (q.entity) { where.push('entity = ?'); params.push(q.entity); }
    if (q.action) { where.push('action = ?'); params.push(q.action); }
    if (q.from) { where.push('date(created_at) >= ?'); params.push(q.from); }
    if (q.to) { where.push('date(created_at) <= ?'); params.push(q.to); }
    if (q.search) { where.push('summary LIKE ?'); params.push(`%${q.search}%`); }

    const clause = where.join(' AND ');
    const rows = all(
      `SELECT * FROM audit_log WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    const { total } = get(`SELECT COUNT(*) AS total FROM audit_log WHERE ${clause}`, params);

    res.json({
      data: rows.map((r) => ({
        ...r,
        entity_label: ENTITY_LABELS[r.entity] ?? r.entity,
        action_label: ACTION_LABELS[r.action] ?? r.action,
        date: r.created_at.slice(0, 10),
        time: r.created_at.slice(11, 19),
        before: r.before_json ? JSON.parse(r.before_json) : null,
        after: r.after_json ? JSON.parse(r.after_json) : null,
      })),
      pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    });
  }),
);

/** Lixeira — lançamentos excluídos continuam recuperáveis (RN-11). */
router.get(
  '/trash',
  validateQuery(z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(30),
  })),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const rows = all(
      `${TX_SELECT} WHERE t.user_id = ? AND t.deleted_at IS NOT NULL
        ORDER BY t.deleted_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, q.pageSize, (q.page - 1) * q.pageSize],
    );
    const { total } = get(
      'SELECT COUNT(*) AS total FROM transactions WHERE user_id = ? AND deleted_at IS NOT NULL',
      [req.user.id],
    );
    res.json({
      data: rows.map((r) => serializeTx(r)),
      pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    });
  }),
);

router.post(
  '/trash/:id/restore',
  asyncHandler(async (req, res) => {
    const tx = get('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL', [
      req.params.id, req.user.id,
    ]);
    if (!tx) throw notFound('Lançamento não encontrado na lixeira');

    run('UPDATE transactions SET deleted_at = NULL WHERE id = ?', [tx.id]);
    run(
      'INSERT INTO audit_log (user_id, entity, entity_id, action, summary) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'transactions', tx.id, 'restore', `Lançamento "${tx.description}" restaurado`],
    );
    res.json({ ok: true });
  }),
);

/**
 * Busca global — varre lançamentos, contas, categorias, cartões,
 * investimentos e metas de uma vez só.
 */
router.get(
  '/search',
  validateQuery(z.object({
    q: z.string().trim().min(2, 'Digite ao menos 2 caracteres').max(120),
    limit: z.coerce.number().int().min(1).max(50).optional().default(8),
  })),
  asyncHandler(async (req, res) => {
    const { q, limit } = req.validatedQuery;
    const like = `%${q}%`;
    const uid = req.user.id;

    const transactions = all(
      `${TX_SELECT}
        WHERE t.user_id = ? AND t.deleted_at IS NULL
          AND (t.description LIKE ? OR t.notes LIKE ? OR t.tags LIKE ?)
        ORDER BY t.due_date DESC LIMIT ?`,
      [uid, like, like, like, limit],
    ).map((r) => serializeTx(r));

    res.json({
      query: q,
      results: {
        transactions,
        accounts: all('SELECT id, name, type, color FROM accounts WHERE user_id = ? AND name LIKE ? LIMIT ?', [uid, like, limit]),
        categories: all('SELECT id, name, kind, color FROM categories WHERE user_id = ? AND name LIKE ? LIMIT ?', [uid, like, limit]),
        cards: all('SELECT id, name, color FROM credit_cards WHERE user_id = ? AND name LIKE ? LIMIT ?', [uid, like, limit]),
        investments: all('SELECT id, name, ticker, type FROM investments WHERE user_id = ? AND (name LIKE ? OR ticker LIKE ?) LIMIT ?', [uid, like, like, limit]),
        goals: all('SELECT id, name, target_amount FROM goals WHERE user_id = ? AND name LIKE ? LIMIT ?', [uid, like, limit]),
      },
    });
  }),
);

// ------------------------------------------------------------------
// Notificações
// ------------------------------------------------------------------
router.get(
  '/notifications',
  validateQuery(z.object({
    unreadOnly: z.coerce.boolean().optional().default(false),
    limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  })),
  asyncHandler(async (req, res) => {
    const { unreadOnly, limit } = req.validatedQuery;
    const where = unreadOnly ? 'user_id = ? AND read_at IS NULL' : 'user_id = ?';

    const data = all(
      `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
      [req.user.id, limit],
    );
    const { unread } = get(
      'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id],
    );
    res.json({ data, unread_count: unread });
  }),
);

router.post(
  '/notifications/read',
  validate(z.object({ ids: z.array(z.coerce.number().int().positive()).optional() })),
  asyncHandler(async (req, res) => {
    if (req.body.ids?.length) {
      const placeholders = req.body.ids.map(() => '?').join(',');
      run(
        `UPDATE notifications SET read_at = datetime('now','localtime')
          WHERE user_id = ? AND id IN (${placeholders})`,
        [req.user.id, ...req.body.ids],
      );
    } else {
      run("UPDATE notifications SET read_at = datetime('now','localtime') WHERE user_id = ? AND read_at IS NULL", [req.user.id]);
    }
    res.json({ ok: true });
  }),
);

/**
 * Varre vencimentos e gera notificações.
 * A verificação de duplicidade evita repetir o mesmo aviso a cada chamada.
 */
export function checkDueNotifications(userId, { daysAhead = 3 } = {}) {
  const limit = addDays(today(), daysAhead);

  const upcoming = all(
    `SELECT t.*, c.name AS category_name FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
        AND t.status = 'pending' AND t.due_date <= ?`,
    [userId, limit],
  );

  let created = 0;
  for (const tx of upcoming) {
    const overdue = tx.due_date < today();
    const type = overdue ? 'overdue' : 'due_soon';

    const exists = get(
      'SELECT id FROM notifications WHERE user_id = ? AND type = ? AND entity = ? AND entity_id = ?',
      [userId, type, 'transactions', tx.id],
    );
    if (exists) continue;

    const isIncome = tx.kind === 'income';
    notify({
      userId,
      type,
      severity: overdue ? 'danger' : 'warning',
      title: overdue
        ? `${isIncome ? 'Recebimento' : 'Pagamento'} atrasado: ${tx.description}`
        : `Vence em breve: ${tx.description}`,
      message: `Vencimento em ${tx.due_date.slice(8, 10)}/${tx.due_date.slice(5, 7)}/${tx.due_date.slice(0, 4)}`,
      entity: 'transactions',
      entityId: tx.id,
      refDate: tx.due_date,
    });
    created++;
  }

  return created;
}

router.post(
  '/notifications/check',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, created: checkDueNotifications(req.user.id) });
  }),
);

export default router;
