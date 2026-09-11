import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, buildUpdate } from '../../db/index.js';
import { validate, validateQuery } from '../../middleware/validate.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { toCents, pct } from '../../utils/money.js';
import { today, monthKey, monthRange, monthsBetween, addMonths } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.union([z.number(), z.string()]);

/**
 * RN-10 — projeção por juros compostos com aportes mensais constantes:
 *
 *   VF = PL · (1+i)^n  +  aporte · [ ((1+i)^n − 1) / i ]
 *
 * O primeiro termo é o patrimônio atual rendendo; o segundo é a série de
 * aportes futuros. Com i = 0 a série degenera em `aporte · n`.
 */
function project(presentValue, monthlyContribution, monthlyRate, years) {
  const n = years * 12;
  const growth = (1 + monthlyRate) ** n;
  const futureFromNow = presentValue * growth;
  const futureFromContributions =
    monthlyRate === 0 ? monthlyContribution * n : monthlyContribution * ((growth - 1) / monthlyRate);

  const total = Math.round(futureFromNow + futureFromContributions);
  const contributed = Math.round(monthlyContribution * n);

  return {
    years,
    months: n,
    future_value: total,
    contributed_total: contributed,
    interest_earned: total - presentValue - contributed,
    growth_pct: pct(total - presentValue, presentValue),
  };
}

/** Média de aportes dos últimos N meses — base realista para a projeção. */
function averageMonthlySavings(userId, months = 6) {
  const start = addMonths(`${monthKey(today())}-01`, -(months - 1));

  const { saved } = get(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE -amount END), 0) AS saved
       FROM transactions
      WHERE user_id = ? AND deleted_at IS NULL AND neutral = 0 AND status = 'settled'
        AND settle_date >= ? AND settle_date <= ?`,
    [userId, start, today()],
  );

  const { contributed } = get(
    `SELECT COALESCE(SUM(amount), 0) AS contributed FROM investment_movements
      WHERE user_id = ? AND type = 'contribution' AND date >= ? AND date <= ?`,
    [userId, start, today()],
  );

  // Usa o maior entre sobra de caixa e aportes efetivos: quem investe tudo que
  // sobra teria projeção zerada se olhássemos só a sobra do mês.
  const perMonth = Math.max(Math.round(saved / months), Math.round(contributed / months), 0);

  return { average_monthly: perMonth, cash_savings_avg: Math.round(saved / months), invested_avg: Math.round(contributed / months), months };
}

// ------------------------------------------------------------------
// GET /api/networth — a tela "Minha Vida Financeira"
// ------------------------------------------------------------------
router.get(
  '/',
  validateQuery(z.object({
    months: z.coerce.number().int().min(6).max(60).optional().default(12),
    rate: z.coerce.number().min(0).max(0.05).optional(),
    savingsWindow: z.coerce.number().int().min(3).max(24).optional().default(6),
  })),
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const q = req.validatedQuery;
    const monthlyRate = q.rate ?? req.user.projection_rate ?? 0.008;

    // ---- Ativos ----
    const accounts = all(
      `SELECT a.id, a.name, a.type, a.color,
              a.initial_balance + COALESCE((
                SELECT SUM(CASE WHEN t.kind IN ('income','transfer_in') THEN t.amount ELSE -t.amount END)
                  FROM transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.status = 'settled'
              ), 0) AS balance
         FROM accounts a
        WHERE a.user_id = ? AND a.archived = 0 AND a.include_in_total = 1
        ORDER BY balance DESC`,
      [userId],
    );
    const cashTotal = accounts.reduce((s, a) => s + a.balance, 0);

    const investments = get(
      `SELECT COALESCE(SUM(current_value), 0) AS current_value,
              COALESCE(SUM(invested_amount), 0) AS invested
         FROM investments WHERE user_id = ? AND archived = 0`,
      [userId],
    );

    const physicalAssets = all('SELECT * FROM assets WHERE user_id = ? ORDER BY value DESC', [userId]);
    const physicalTotal = physicalAssets.reduce((s, a) => s + a.value, 0);

    // ---- Passivos ----
    const liabilities = all('SELECT * FROM liabilities WHERE user_id = ? ORDER BY remaining_amount DESC', [userId]);
    const liabilitiesTotal = liabilities.reduce((s, l) => s + l.remaining_amount, 0);

    // Faturas de cartão em aberto também são dívida — só não estão na tabela.
    const { open_invoices } = get(
      `SELECT COALESCE(SUM(
                (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t
                  WHERE t.invoice_id = i.id AND t.deleted_at IS NULL AND t.status <> 'canceled')
                - i.paid_amount
              ), 0) AS open_invoices
         FROM card_invoices i WHERE i.user_id = ? AND i.status <> 'paid'`,
      [userId],
    );

    const totalAssets = cashTotal + investments.current_value + physicalTotal;
    const totalDebts = liabilitiesTotal + Math.max(0, open_invoices);
    const netWorth = totalAssets - totalDebts;

    // ---- Projeções ----
    const savings = averageMonthlySavings(userId, q.savingsWindow);
    const projections = [1, 5, 10].map((y) => project(netWorth, savings.average_monthly, monthlyRate, y));

    // ---- Evolução histórica do patrimônio ----
    const startMonth = addMonths(`${monthKey(today())}-01`, -(q.months - 1));
    const evolution = monthsBetween(startMonth, today()).map((ym) => {
      const { end } = monthRange(ym);

      const { accumulated } = get(
        `SELECT COALESCE(SUM(CASE WHEN t.kind IN ('income','transfer_in') THEN t.amount ELSE -t.amount END), 0) AS accumulated
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id AND a.archived = 0 AND a.include_in_total = 1
          WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.status = 'settled' AND t.settle_date <= ?`,
        [userId, end],
      );
      const { initial } = get(
        'SELECT COALESCE(SUM(initial_balance), 0) AS initial FROM accounts WHERE user_id = ? AND archived = 0 AND include_in_total = 1',
        [userId],
      );
      const { market } = get(
        `SELECT COALESCE(SUM(
                  COALESCE((SELECT v.market_value FROM asset_valuations v
                             WHERE v.investment_id = i.id AND v.date <= ?
                             ORDER BY v.date DESC LIMIT 1), i.invested_amount)
                ), 0) AS market
           FROM investments i WHERE i.user_id = ? AND i.purchase_date <= ?`,
        [end, userId, end],
      );
      const { physical } = get(
        `SELECT COALESCE(SUM(value), 0) AS physical FROM assets
          WHERE user_id = ? AND (acquisition_date IS NULL OR acquisition_date <= ?)`,
        [userId, end],
      );

      const cash = initial + accumulated;
      return {
        month: ym,
        label: `${ym.slice(5)}/${ym.slice(2, 4)}`,
        cash,
        investments: market,
        physical_assets: physical,
        total_assets: cash + market + physical,
        net_worth: cash + market + physical,
      };
    });

    const first = evolution[0]?.net_worth ?? 0;
    const last = evolution.at(-1)?.net_worth ?? 0;

    res.json({
      summary: {
        total_assets: totalAssets,
        total_debts: totalDebts,
        net_worth: netWorth,
        cash_total: cashTotal,
        investments_total: investments.current_value,
        investments_invested: investments.invested,
        physical_assets_total: physicalTotal,
        liabilities_total: liabilitiesTotal,
        open_invoices_total: Math.max(0, open_invoices),
        debt_ratio: pct(totalDebts, totalAssets),
        growth_period_amount: last - first,
        growth_period_pct: pct(last - first, first),
      },
      composition: {
        assets: [
          { key: 'cash', label: 'Contas e carteiras', value: cashTotal, color: '#22c55e' },
          { key: 'investments', label: 'Investimentos', value: investments.current_value, color: '#6366f1' },
          { key: 'physical', label: 'Bens', value: physicalTotal, color: '#f59e0b' },
        ].filter((a) => a.value !== 0),
        debts: [
          { key: 'liabilities', label: 'Dívidas e financiamentos', value: liabilitiesTotal, color: '#ef4444' },
          { key: 'invoices', label: 'Faturas em aberto', value: Math.max(0, open_invoices), color: '#f97316' },
        ].filter((d) => d.value !== 0),
      },
      accounts,
      assets: physicalAssets,
      liabilities,
      savings,
      projection: {
        monthly_rate: monthlyRate,
        annual_rate_pct: Math.round(((1 + monthlyRate) ** 12 - 1) * 10000) / 100,
        monthly_contribution: savings.average_monthly,
        scenarios: projections,
      },
      evolution,
    });
  }),
);

// ------------------------------------------------------------------
// Bens
// ------------------------------------------------------------------
const assetSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do bem').max(120),
  type: z.enum(['imovel', 'veiculo', 'equipamento', 'participacao', 'outros']).optional().default('outros'),
  value: money,
  acquisition_date: isoDate.optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

router.get('/assets', asyncHandler(async (req, res) => {
  res.json({ data: all('SELECT * FROM assets WHERE user_id = ? ORDER BY value DESC', [req.user.id]) });
}));

router.post('/assets', validate(assetSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const { lastInsertRowid } = run(
    'INSERT INTO assets (user_id, name, type, value, acquisition_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, b.name, b.type, toCents(b.value), b.acquisition_date ?? null, b.notes ?? null],
  );
  const created = get('SELECT * FROM assets WHERE id = ?', [Number(lastInsertRowid)]);
  logAudit({ userId: req.user.id, entity: 'assets', entityId: created.id, action: 'create', summary: `Bem "${created.name}" cadastrado`, after: created });
  res.status(201).json({ data: created });
}));

router.patch('/assets/:id', validate(assetSchema.partial()), asyncHandler(async (req, res) => {
  const before = get('SELECT * FROM assets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!before) throw notFound('Bem não encontrado');
  const b = req.body;
  buildUpdate('assets', before.id, req.user.id, {
    name: b.name, type: b.type,
    value: b.value !== undefined ? toCents(b.value) : undefined,
    acquisition_date: b.acquisition_date, notes: b.notes,
  });
  const after = get('SELECT * FROM assets WHERE id = ?', [before.id]);
  logAudit({ userId: req.user.id, entity: 'assets', entityId: before.id, action: 'update', summary: `Bem "${after.name}" atualizado`, before, after });
  res.json({ data: after });
}));

router.delete('/assets/:id', asyncHandler(async (req, res) => {
  const a = get('SELECT * FROM assets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!a) throw notFound('Bem não encontrado');
  run('DELETE FROM assets WHERE id = ?', [a.id]);
  logAudit({ userId: req.user.id, entity: 'assets', entityId: a.id, action: 'delete', summary: `Bem "${a.name}" excluído`, before: a });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------
// Dívidas
// ------------------------------------------------------------------
const liabilitySchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da dívida').max(120),
  type: z.enum(['financiamento', 'emprestimo', 'cartao', 'consorcio', 'outros']).optional().default('outros'),
  total_amount: money.optional().default(0),
  remaining_amount: money,
  monthly_payment: money.optional().default(0),
  interest_rate: z.coerce.number().min(0).max(100).optional().default(0),
  start_date: isoDate.optional().nullable(),
  end_date: isoDate.optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

router.get('/liabilities', asyncHandler(async (req, res) => {
  const data = all('SELECT * FROM liabilities WHERE user_id = ? ORDER BY remaining_amount DESC', [req.user.id]).map((l) => ({
    ...l,
    paid_amount: Math.max(0, l.total_amount - l.remaining_amount),
    paid_pct: pct(l.total_amount - l.remaining_amount, l.total_amount),
  }));
  res.json({ data, total: data.reduce((s, l) => s + l.remaining_amount, 0) });
}));

router.post('/liabilities', validate(liabilitySchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const remaining = toCents(b.remaining_amount);
  const total = toCents(b.total_amount) || remaining;
  const { lastInsertRowid } = run(
    `INSERT INTO liabilities (user_id, name, type, total_amount, remaining_amount, monthly_payment,
                              interest_rate, start_date, end_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, b.name, b.type, total, remaining, toCents(b.monthly_payment),
     b.interest_rate, b.start_date ?? null, b.end_date ?? null, b.notes ?? null],
  );
  const created = get('SELECT * FROM liabilities WHERE id = ?', [Number(lastInsertRowid)]);
  logAudit({ userId: req.user.id, entity: 'liabilities', entityId: created.id, action: 'create', summary: `Dívida "${created.name}" cadastrada`, after: created });
  res.status(201).json({ data: created });
}));

router.patch('/liabilities/:id', validate(liabilitySchema.partial()), asyncHandler(async (req, res) => {
  const before = get('SELECT * FROM liabilities WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!before) throw notFound('Dívida não encontrada');
  const b = req.body;
  buildUpdate('liabilities', before.id, req.user.id, {
    name: b.name, type: b.type,
    total_amount: b.total_amount !== undefined ? toCents(b.total_amount) : undefined,
    remaining_amount: b.remaining_amount !== undefined ? toCents(b.remaining_amount) : undefined,
    monthly_payment: b.monthly_payment !== undefined ? toCents(b.monthly_payment) : undefined,
    interest_rate: b.interest_rate, start_date: b.start_date, end_date: b.end_date, notes: b.notes,
  });
  const after = get('SELECT * FROM liabilities WHERE id = ?', [before.id]);
  logAudit({ userId: req.user.id, entity: 'liabilities', entityId: before.id, action: 'update', summary: `Dívida "${after.name}" atualizada`, before, after });
  res.json({ data: after });
}));

router.delete('/liabilities/:id', asyncHandler(async (req, res) => {
  const l = get('SELECT * FROM liabilities WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!l) throw notFound('Dívida não encontrada');
  run('DELETE FROM liabilities WHERE id = ?', [l.id]);
  logAudit({ userId: req.user.id, entity: 'liabilities', entityId: l.id, action: 'delete', summary: `Dívida "${l.name}" excluída`, before: l });
  res.json({ ok: true });
}));

/** Simulador livre — o usuário testa cenários de aporte e taxa. */
router.post(
  '/simulate',
  validate(z.object({
    present_value: money.optional(),
    monthly_contribution: money,
    monthly_rate: z.coerce.number().min(0).max(0.05),
    years: z.array(z.coerce.number().int().min(1).max(50)).min(1).max(6).optional().default([1, 5, 10]),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const pv = b.present_value !== undefined ? toCents(b.present_value) : 0;
    const contribution = toCents(b.monthly_contribution);
    res.json({ data: b.years.map((y) => project(pv, contribution, b.monthly_rate, y)) });
  }),
);

export default router;
