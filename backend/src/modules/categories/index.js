import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, buildUpdate } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { logAudit } from '../../utils/audit.js';

const router = Router();

const baseSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da categoria').max(60),
  kind: z.enum(['income', 'expense']),
  parent_id: z.coerce.number().int().positive().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#64748b'),
  icon: z.string().max(40).optional().default('tag'),
});

/** Lista em árvore: categorias-pai com suas subcategorias aninhadas. */
router.get(
  '/',
  validateQuery(
    z.object({
      kind: z.enum(['income', 'expense']).optional(),
      flat: z.coerce.boolean().optional().default(false),
      archived: z.enum(['0', '1', 'all']).optional().default('0'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { kind, flat, archived } = req.validatedQuery;

    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (kind) { where.push('kind = ?'); params.push(kind); }
    if (archived !== 'all') { where.push('archived = ?'); params.push(Number(archived)); }

    const rows = (await all(
      `SELECT * FROM categories WHERE ${where.join(' AND ')} ORDER BY parent_id IS NOT NULL, name`,
      params,
    )).map((c) => ({ ...c, archived: !!c.archived, is_system: !!c.is_system }));

    if (flat) return res.json({ data: rows });

    const parents = rows.filter((c) => c.parent_id === null);
    const byParent = new Map();
    for (const c of rows.filter((c) => c.parent_id !== null)) {
      if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
      byParent.get(c.parent_id).push(c);
    }

    res.json({ data: parents.map((p) => ({ ...p, children: byParent.get(p.id) ?? [] })) });
  }),
);

/** Uso da categoria — alimenta gráficos de gastos por categoria. */
router.get(
  '/usage',
  validateQuery(z.object({ from: z.string().optional(), to: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery;
    const where = ['t.user_id = ?', 't.deleted_at IS NULL', 't.neutral = 0', "t.status <> 'canceled'"];
    const params = [req.user.id];
    if (from) { where.push('t.due_date >= ?'); params.push(from); }
    if (to) { where.push('t.due_date <= ?'); params.push(to); }

    res.json({
      data: await all(
        `SELECT c.id, c.name, c.kind, c.color, c.icon,
                COUNT(t.id) AS tx_count, COALESCE(SUM(t.amount), 0) AS total
           FROM categories c
           LEFT JOIN transactions t ON t.category_id = c.id AND ${where.join(' AND ')}
          WHERE c.user_id = ? AND c.parent_id IS NULL
          GROUP BY c.id
          ORDER BY total DESC`,
        [...params, req.user.id],
      ),
    });
  }),
);

router.post(
  '/',
  validate(baseSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;

    if (b.parent_id) {
      const parent = await get('SELECT * FROM categories WHERE id = ? AND user_id = ?', [b.parent_id, req.user.id]);
      if (!parent) throw badRequest('Categoria pai não encontrada');
      // Apenas dois níveis: categoria > subcategoria. Mais fundo confunde relatórios.
      if (parent.parent_id) throw badRequest('Não é possível criar subcategoria de uma subcategoria');
      if (parent.kind !== b.kind) throw badRequest('A subcategoria deve ser do mesmo tipo da categoria pai');
    }

    const { lastInsertRowid } = await run(
      'INSERT INTO categories (user_id, name, kind, parent_id, color, icon) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, b.name, b.kind, b.parent_id ?? null, b.color, b.icon],
    );
    const created = await get('SELECT * FROM categories WHERE id = ?', [Number(lastInsertRowid)]);
    await logAudit({ userId: req.user.id, entity: 'categories', entityId: created.id, action: 'create', summary: `Categoria "${created.name}" criada`, after: created });
    res.status(201).json({ data: created });
  }),
);

router.patch(
  '/:id',
  validate(baseSchema.partial().extend({ archived: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const before = await get('SELECT * FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!before) throw notFound('Categoria não encontrada');

    const b = req.body;
    if (b.parent_id !== undefined && b.parent_id !== null) {
      if (Number(b.parent_id) === before.id) throw badRequest('Uma categoria não pode ser pai dela mesma');
      const parent = await get('SELECT * FROM categories WHERE id = ? AND user_id = ?', [b.parent_id, req.user.id]);
      if (!parent) throw badRequest('Categoria pai não encontrada');
      if (parent.parent_id) throw badRequest('Não é possível aninhar em uma subcategoria');
    }

    await buildUpdate('categories', before.id, req.user.id, {
      name: b.name,
      kind: b.kind,
      parent_id: b.parent_id,
      color: b.color,
      icon: b.icon,
      archived: b.archived === undefined ? undefined : b.archived ? 1 : 0,
    });

    const after = await get('SELECT * FROM categories WHERE id = ?', [before.id]);
    await logAudit({ userId: req.user.id, entity: 'categories', entityId: before.id, action: 'update', summary: `Categoria "${after.name}" atualizada`, before, after });
    res.json({ data: after });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const cat = await get('SELECT * FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!cat) throw notFound('Categoria não encontrada');

    const { n } = await get(
      `SELECT COUNT(*) AS n FROM transactions
        WHERE (category_id = ? OR subcategory_id = ?) AND deleted_at IS NULL`,
      [cat.id, cat.id],
    );
    if (n > 0) {
      throw conflict(
        `Esta categoria é usada em ${n} lançamento(s). Arquive-a para deixar de oferecê-la sem perder o histórico.`,
      );
    }

    const { subs } = await get('SELECT COUNT(*) AS subs FROM categories WHERE parent_id = ?', [cat.id]);
    if (subs > 0) throw conflict(`Exclua ou mova as ${subs} subcategoria(s) antes.`);

    await run('DELETE FROM categories WHERE id = ?', [cat.id]);
    await logAudit({ userId: req.user.id, entity: 'categories', entityId: cat.id, action: 'delete', summary: `Categoria "${cat.name}" excluída`, before: cat });
    res.json({ ok: true });
  }),
);

export default router;
