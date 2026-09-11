import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, transaction, buildUpdate } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { toCents, pct } from '../../utils/money.js';
import { today, monthKey, monthRange, monthsBetween } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';
import { buildMonthlySeries } from '../../utils/series.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.union([z.number(), z.string()]);

export const INVESTMENT_TYPES = [
  'tesouro', 'cdb', 'lci_lca', 'acoes', 'fiis', 'etf',
  'fundos', 'cripto', 'poupanca', 'previdencia', 'debenture', 'outros',
];

export const TYPE_LABELS = {
  tesouro: 'Tesouro Direto', cdb: 'CDB', lci_lca: 'LCI/LCA', acoes: 'Ações',
  fiis: 'FIIs', etf: 'ETFs', fundos: 'Fundos', cripto: 'Criptomoedas',
  poupanca: 'Poupança', previdencia: 'Previdência', debenture: 'Debêntures', outros: 'Outros',
};

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do ativo').max(120),
  ticker: z.string().trim().max(20).optional().nullable(),
  type: z.enum(INVESTMENT_TYPES),
  institution: z.string().trim().max(80).optional().nullable(),
  quantity: z.coerce.number().min(0).optional().default(0),
  avg_price: money.optional().default(0),
  invested_amount: money.optional().default(0),
  current_value: money.optional().default(0),
  purchase_date: isoDate,
  maturity_date: isoDate.optional().nullable(),
  index_ref: z.string().trim().max(40).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/** Enriquece o ativo com rentabilidade e proventos acumulados. */
async function decorate(inv) {
  const profit = inv.current_value - inv.invested_amount;
  const income = (await get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM investment_movements
      WHERE investment_id = ? AND type IN ('dividend','interest','jcp','rent')`,
    [inv.id],
  )).total;

  return {
    ...inv,
    archived: !!inv.archived,
    type_label: TYPE_LABELS[inv.type] ?? inv.type,
    profit_amount: profit,
    profit_pct: pct(profit, inv.invested_amount),
    income_total: income,
    // Retorno total inclui os proventos já recebidos, não só a valorização.
    total_return_amount: profit + income,
    total_return_pct: pct(profit + income, inv.invested_amount),
  };
}

/**
 * RN-07 — recalcula posição a partir do histórico de movimentos.
 * Preço médio sobe apenas com aportes; retirada reduz quantidade mantendo o PM.
 * Proventos não alteram a posição — são renda, contabilizada à parte.
 */
async function recalcPosition(userId, investmentId) {
  const movements = await all(
    'SELECT * FROM investment_movements WHERE investment_id = ? ORDER BY date ASC, id ASC',
    [investmentId],
  );

  let qty = 0;
  let invested = 0;

  for (const m of movements) {
    if (m.type === 'contribution') {
      qty += m.quantity;
      invested += m.amount;
    } else if (m.type === 'withdrawal') {
      const avg = qty > 0 ? invested / qty : 0;
      const soldQty = Math.min(m.quantity, qty);
      qty -= soldQty;
      invested -= Math.round(avg * soldQty);
      if (qty <= 0) { qty = 0; invested = 0; }
    }
  }

  const avgPrice = qty > 0 ? Math.round(invested / qty) : 0;
  await run(
    `UPDATE investments SET quantity = ?, invested_amount = ?, avg_price = ?,
                            updated_at = NOW()
      WHERE id = ? AND user_id = ?`,
    [qty, Math.max(0, invested), avgPrice, investmentId, userId],
  );
}

// ------------------------------------------------------------------
// Carteira
// ------------------------------------------------------------------
router.get(
  '/',
  validateQuery(z.object({
    type: z.enum(INVESTMENT_TYPES).optional(),
    archived: z.enum(['0', '1', 'all']).optional().default('0'),
    search: z.string().trim().max(80).optional(),
  })),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (q.archived !== 'all') { where.push('archived = ?'); params.push(Number(q.archived)); }
    if (q.type) { where.push('type = ?'); params.push(q.type); }
    if (q.search) { where.push('(name LIKE ? OR ticker LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }

    const rows = await all(
      `SELECT * FROM investments WHERE ${where.join(' AND ')} ORDER BY current_value DESC, name`,
      params,
    );
    // `decorate` consulta os proventos de cada ativo: resolvem em paralelo.
    const data = await Promise.all(rows.map(decorate));

    const invested = data.reduce((s, i) => s + i.invested_amount, 0);
    const current = data.reduce((s, i) => s + i.current_value, 0);
    const income = data.reduce((s, i) => s + i.income_total, 0);

    res.json({
      data,
      summary: {
        count: data.length,
        invested_total: invested,
        current_total: current,
        profit_amount: current - invested,
        profit_pct: pct(current - invested, invested),
        income_total: income,
        total_return_amount: current - invested + income,
        total_return_pct: pct(current - invested + income, invested),
      },
    });
  }),
);

/** Distribuição da carteira por tipo de ativo — alimenta o gráfico de pizza. */
router.get(
  '/allocation',
  asyncHandler(async (req, res) => {
    const rows = await all(
      `SELECT type, COUNT(*) AS count,
              COALESCE(SUM(invested_amount), 0) AS invested,
              COALESCE(SUM(current_value), 0)   AS current_value
         FROM investments WHERE user_id = ? AND archived = 0
        GROUP BY type ORDER BY current_value DESC`,
      [req.user.id],
    );

    const total = rows.reduce((s, r) => s + r.current_value, 0);
    res.json({
      data: rows.map((r) => ({
        ...r,
        type_label: TYPE_LABELS[r.type] ?? r.type,
        share_pct: pct(r.current_value, total),
        profit_amount: r.current_value - r.invested,
      })),
      total,
    });
  }),
);

/**
 * Evolução mensal da carteira.
 * `invested` é acumulado a partir dos movimentos; `market_value` usa a última
 * avaliação registrada de cada ativo até o mês, caindo para o valor aplicado
 * quando ainda não houve marcação a mercado.
 */
router.get(
  '/evolution',
  validateQuery(z.object({ months: z.coerce.number().int().min(3).max(120).optional().default(12) })),
  asyncHandler(async (req, res) => {
    const { months } = req.validatedQuery;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - (months - 1));
    const startISO = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;

    const list = monthsBetween(startISO, today());

    // Fluxos acumulados por mês e marcação a mercado saem de duas consultas,
    // não de duas por mês.
    const [flowRows, series] = await Promise.all([
      all(
        `SELECT to_char(date, 'YYYY-MM') AS ym,
                COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount
                                  WHEN type = 'withdrawal'   THEN -amount ELSE 0 END), 0) AS invested,
                COALESCE(SUM(CASE WHEN type IN ('dividend','interest','jcp','rent') THEN amount ELSE 0 END), 0) AS income
           FROM investment_movements
          WHERE user_id = ? AND date <= ?
          GROUP BY ym ORDER BY ym`,
        [req.user.id, monthRange(list.at(-1)).end],
      ),
      buildMonthlySeries(req.user.id, list, { includePhysical: false }),
    ]);

    // Os aportes são acumulados: o total investido num mês inclui tudo que veio antes.
    let investedAcc = 0;
    let incomeAcc = 0;
    const flowsByMonth = new Map(flowRows.map((r) => [r.ym, r]));

    const data = list.map((ym, i) => {
      const f = flowsByMonth.get(ym);
      if (f) {
        investedAcc += f.invested;
        incomeAcc += f.income;
      }
      const market = series[i]?.investments ?? 0;

      return {
        month: ym,
        invested: Math.max(0, investedAcc),
        income_accumulated: incomeAcc,
        market_value: market,
        profit: market - Math.max(0, investedAcc),
      };
    });

    res.json({ data });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const inv = await get('SELECT * FROM investments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!inv) throw notFound('Investimento não encontrado');

    const movements = await all(
      `SELECT m.*, a.name AS account_name FROM investment_movements m
         LEFT JOIN accounts a ON a.id = m.account_id
        WHERE m.investment_id = ? ORDER BY m.date DESC, m.id DESC`,
      [inv.id],
    );
    const valuations = await all(
      'SELECT * FROM asset_valuations WHERE investment_id = ? ORDER BY date ASC',
      [inv.id],
    );

    res.json({
      data: {
        ...(await decorate(inv)),
        movements,
        valuations,
        contributions: movements.filter((m) => m.type === 'contribution'),
        withdrawals: movements.filter((m) => m.type === 'withdrawal'),
        incomes: movements.filter((m) => ['dividend', 'interest', 'jcp', 'rent'].includes(m.type)),
      },
    });
  }),
);

router.post(
  '/',
  validate(schema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const invested = toCents(b.invested_amount);
    const currentValue = toCents(b.current_value) || invested;

    const created = await transaction(async () => {
      const { lastInsertRowid } = await run(
        `INSERT INTO investments
           (user_id, name, ticker, type, institution, quantity, avg_price, invested_amount,
            current_value, purchase_date, maturity_date, index_ref, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, b.name, b.ticker ?? null, b.type, b.institution ?? null, b.quantity,
         toCents(b.avg_price), invested, currentValue, b.purchase_date,
         b.maturity_date ?? null, b.index_ref ?? null, b.notes ?? null],
      );
      const id = Number(lastInsertRowid);

      // O aporte inicial vira movimento: o histórico nasce completo.
      if (invested > 0) {
        await run(
          `INSERT INTO investment_movements
             (user_id, investment_id, type, quantity, unit_price, amount, date, notes)
           VALUES (?, ?, 'contribution', ?, ?, ?, ?, 'Aporte inicial')`,
          [req.user.id, id, b.quantity, toCents(b.avg_price), invested, b.purchase_date],
        );
      }
      await run(
        `INSERT INTO asset_valuations (user_id, investment_id, date, market_value)
         VALUES (?, ?, ?, ?) ON CONFLICT(investment_id, date) DO UPDATE SET market_value = excluded.market_value`,
        [req.user.id, id, b.purchase_date, currentValue],
      );

      return await get('SELECT * FROM investments WHERE id = ?', [id]);
    });

    await logAudit({ userId: req.user.id, entity: 'investments', entityId: created.id, action: 'create', summary: `Investimento "${created.name}" cadastrado`, after: created });
    res.status(201).json({ data: await decorate(created) });
  }),
);

router.patch(
  '/:id',
  validate(schema.partial().extend({ archived: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const before = await get('SELECT * FROM investments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!before) throw notFound('Investimento não encontrado');

    const b = req.body;
    await buildUpdate('investments', before.id, req.user.id, {
      name: b.name, ticker: b.ticker, type: b.type, institution: b.institution,
      quantity: b.quantity,
      avg_price: b.avg_price !== undefined ? toCents(b.avg_price) : undefined,
      invested_amount: b.invested_amount !== undefined ? toCents(b.invested_amount) : undefined,
      current_value: b.current_value !== undefined ? toCents(b.current_value) : undefined,
      purchase_date: b.purchase_date, maturity_date: b.maturity_date,
      index_ref: b.index_ref, notes: b.notes,
      archived: b.archived === undefined ? undefined : b.archived ? 1 : 0,
    });

    // Atualizar o valor atual é uma marcação a mercado: registra ponto na série.
    if (b.current_value !== undefined) {
      await run(
        `INSERT INTO asset_valuations (user_id, investment_id, date, market_value)
         VALUES (?, ?, ?, ?) ON CONFLICT(investment_id, date) DO UPDATE SET market_value = excluded.market_value`,
        [req.user.id, before.id, today(), toCents(b.current_value)],
      );
    }

    const after = await get('SELECT * FROM investments WHERE id = ?', [before.id]);
    await logAudit({ userId: req.user.id, entity: 'investments', entityId: before.id, action: 'update', summary: `Investimento "${after.name}" atualizado`, before, after });
    res.json({ data: await decorate(after) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const inv = await get('SELECT * FROM investments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!inv) throw notFound('Investimento não encontrado');

    await run('DELETE FROM investments WHERE id = ?', [inv.id]); // movimentos caem por CASCADE
    await logAudit({ userId: req.user.id, entity: 'investments', entityId: inv.id, action: 'delete', summary: `Investimento "${inv.name}" excluído`, before: inv });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------
// Movimentos: aporte, retirada, proventos
// ------------------------------------------------------------------
router.post(
  '/:id/movements',
  validate(z.object({
    type: z.enum(['contribution', 'withdrawal', 'dividend', 'interest', 'jcp', 'rent']),
    quantity: z.coerce.number().min(0).optional().default(0),
    unit_price: money.optional().default(0),
    amount: money,
    date: isoDate.optional(),
    account_id: z.coerce.number().int().positive().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    create_transaction: z.boolean().optional().default(false),
  })),
  asyncHandler(async (req, res) => {
    const inv = await get('SELECT * FROM investments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!inv) throw notFound('Investimento não encontrado');

    const b = req.body;
    const amount = toCents(b.amount);
    if (amount <= 0) throw badRequest('O valor deve ser maior que zero');
    const date = b.date ?? today();

    if (b.type === 'withdrawal' && b.quantity > inv.quantity) {
      throw badRequest(`Quantidade indisponível: a posição atual é de ${inv.quantity}`);
    }

    await transaction(async () => {
      await run(
        `INSERT INTO investment_movements
           (user_id, investment_id, type, quantity, unit_price, amount, date, account_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, inv.id, b.type, b.quantity, toCents(b.unit_price), amount, date,
         b.account_id ?? null, b.notes ?? null],
      );

      await recalcPosition(req.user.id, inv.id);

      // Aporte/retirada altera o valor de mercado; provento não.
      if (b.type === 'contribution' || b.type === 'withdrawal') {
        const delta = b.type === 'contribution' ? amount : -amount;
        await run(
          `UPDATE investments SET current_value = GREATEST(0, current_value + ?),
                                  updated_at = NOW()
            WHERE id = ?`,
          [delta, inv.id],
        );
        const updated = await get('SELECT current_value FROM investments WHERE id = ?', [inv.id]);
        await run(
          `INSERT INTO asset_valuations (user_id, investment_id, date, market_value)
           VALUES (?, ?, ?, ?) ON CONFLICT(investment_id, date) DO UPDATE SET market_value = excluded.market_value`,
          [req.user.id, inv.id, date, updated.current_value],
        );
      }

      // Espelha no fluxo de caixa quando o usuário pede.
      if (b.create_transaction && b.account_id) {
        const isIncome = ['dividend', 'interest', 'jcp', 'rent', 'withdrawal'].includes(b.type);
        await run(
          `INSERT INTO transactions
             (user_id, kind, description, amount, status, account_id, competence_date, due_date,
              settle_date, income_type, expense_nature, payment_method, notes)
           VALUES (?, ?, ?, ?, 'settled', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.id, isIncome ? 'income' : 'expense',
           `${isIncome ? 'Rendimento' : 'Aporte'} — ${inv.name}`, amount, b.account_id,
           date, date, date,
           isIncome ? (b.type === 'withdrawal' ? 'outros' : 'dividendos') : null,
           isIncome ? null : 'variable', isIncome ? null : 'transferencia',
           `Movimento de investimento: ${inv.name}`],
        );
      }
    });

    const after = await get('SELECT * FROM investments WHERE id = ?', [inv.id]);
    await logAudit({ userId: req.user.id, entity: 'investments', entityId: inv.id, action: 'update', summary: `Movimento (${b.type}) em "${inv.name}"` });
    res.status(201).json({ data: await decorate(after) });
  }),
);

router.delete(
  '/:id/movements/:movementId',
  asyncHandler(async (req, res) => {
    const mov = await get('SELECT * FROM investment_movements WHERE id = ? AND investment_id = ? AND user_id = ?', [
      req.params.movementId, req.params.id, req.user.id,
    ]);
    if (!mov) throw notFound('Movimento não encontrado');

    await transaction(async () => {
      await run('DELETE FROM investment_movements WHERE id = ?', [mov.id]);
      await recalcPosition(req.user.id, mov.investment_id);
      if (mov.type === 'contribution' || mov.type === 'withdrawal') {
        const delta = mov.type === 'contribution' ? -mov.amount : mov.amount;
        await run('UPDATE investments SET current_value = GREATEST(0, current_value + ?) WHERE id = ?', [delta, mov.investment_id]);
      }
    });

    res.json({ ok: true });
  }),
);

/** Marcação a mercado manual — registra o valor do ativo numa data. */
router.post(
  '/:id/valuations',
  validate(z.object({ date: isoDate.optional(), market_value: money })),
  asyncHandler(async (req, res) => {
    const inv = await get('SELECT * FROM investments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!inv) throw notFound('Investimento não encontrado');

    const date = req.body.date ?? today();
    const value = toCents(req.body.market_value);

    await transaction(async () => {
      await run(
        `INSERT INTO asset_valuations (user_id, investment_id, date, market_value)
         VALUES (?, ?, ?, ?) ON CONFLICT(investment_id, date) DO UPDATE SET market_value = excluded.market_value`,
        [req.user.id, inv.id, date, value],
      );
      // Só a avaliação mais recente define o valor atual do ativo.
      const latest = await get(
        'SELECT date FROM asset_valuations WHERE investment_id = ? ORDER BY date DESC LIMIT 1',
        [inv.id],
      );
      if (latest.date === date) {
        await run("UPDATE investments SET current_value = ?, updated_at = NOW() WHERE id = ?", [value, inv.id]);
      }
    });

    res.status(201).json({ data: await decorate(await get('SELECT * FROM investments WHERE id = ?', [inv.id])) });
  }),
);

export { monthKey };
export default router;
