import { Router } from 'express';
import { z } from 'zod';
import { all } from '../../db/index.js';
import { validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';
import { monthRange, monthKey, today } from '../../utils/dates.js';
import { TX_SELECT, serializeTx } from '../../utils/txQuery.js';

const router = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Eventos do calendário vêm de quatro origens, unificadas num formato só:
 * transações (receitas/despesas), faturas de cartão, aportes de investimento
 * e transferências entre contas.
 */
async function collectEvents(userId, start, end, { types } = {}) {
  const wants = async (t) => !types || types.includes(t);
  const events = [];

  if (wants('income') || wants('expense')) {
    const rows = await all(
      `${TX_SELECT}
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.neutral = 0
          AND t.due_date >= ? AND t.due_date <= ?
        ORDER BY t.due_date, t.id`,
      [userId, start, end],
    );
    for (const r of rows) {
      if (!wants(r.kind)) continue;
      const tx = serializeTx(r);
      events.push({
        id: `tx-${r.id}`,
        entity: 'transaction',
        entity_id: r.id,
        type: r.kind,
        date: r.due_date,
        title: r.description,
        amount: r.amount,
        status: r.status,
        status_label: tx.status_label,
        is_overdue: tx.is_overdue,
        color: r.category_color ?? (r.kind === 'income' ? '#22c55e' : '#ef4444'),
        meta: {
          category: r.category_name,
          account: r.account_name,
          card: r.card_name,
          installment: tx.installment_label,
        },
      });
    }
  }

  if (wants('invoice')) {
    const invoices = await all(
      `SELECT i.*, c.name AS card_name, c.color AS card_color,
              COALESCE((SELECT SUM(t.amount) FROM transactions t
                         WHERE t.invoice_id = i.id AND t.deleted_at IS NULL AND t.status <> 'canceled'), 0) AS total
         FROM card_invoices i JOIN credit_cards c ON c.id = i.card_id
        WHERE i.user_id = ? AND i.due_date >= ? AND i.due_date <= ?`,
      [userId, start, end],
    );
    for (const i of invoices) {
      if (i.total <= 0) continue; // fatura vazia não vira evento
      events.push({
        id: `invoice-${i.id}`,
        entity: 'invoice',
        entity_id: i.id,
        type: 'invoice',
        date: i.due_date,
        title: `Fatura ${i.card_name}`,
        amount: i.total,
        status: i.status,
        status_label: i.status === 'paid' ? 'paga' : i.due_date < today() ? 'atrasada' : 'em aberto',
        is_overdue: i.status !== 'paid' && i.due_date < today(),
        color: i.card_color,
        meta: { reference: i.reference_month, closing: i.closing_date },
      });
    }
  }

  if (wants('investment')) {
    const movements = await all(
      `SELECT m.*, i.name AS investment_name FROM investment_movements m
         JOIN investments i ON i.id = m.investment_id
        WHERE m.user_id = ? AND m.date >= ? AND m.date <= ?`,
      [userId, start, end],
    );
    const LABELS = {
      contribution: 'Aporte', withdrawal: 'Retirada', dividend: 'Dividendo',
      interest: 'Juros', jcp: 'JCP', rent: 'Aluguel',
    };
    for (const m of movements) {
      events.push({
        id: `inv-${m.id}`,
        entity: 'investment_movement',
        entity_id: m.investment_id,
        type: 'investment',
        date: m.date,
        title: `${LABELS[m.type] ?? m.type} — ${m.investment_name}`,
        amount: m.amount,
        status: 'settled',
        status_label: LABELS[m.type] ?? m.type,
        is_overdue: false,
        color: '#6366f1',
        meta: { movement_type: m.type },
      });
    }
  }

  if (wants('transfer')) {
    const transfers = await all(
      `SELECT t.*, af.name AS from_name, at.name AS to_name FROM transfers t
         JOIN accounts af ON af.id = t.from_account_id
         JOIN accounts at ON at.id = t.to_account_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.date >= ? AND t.date <= ?`,
      [userId, start, end],
    );
    for (const t of transfers) {
      events.push({
        id: `transfer-${t.id}`,
        entity: 'transfer',
        entity_id: t.id,
        type: 'transfer',
        date: t.date,
        title: `${t.from_name} → ${t.to_name}`,
        amount: t.amount,
        status: 'settled',
        status_label: 'transferência',
        is_overdue: false,
        color: '#0ea5e9',
        meta: { from: t.from_name, to: t.to_name },
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** GET /api/calendar?month=YYYY-MM — agregado por dia, para pintar o calendário. */
router.get(
  '/',
  validateQuery(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    types: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const range = q.from && q.to
      ? { start: q.from, end: q.to }
      : monthRange(q.month ?? monthKey(today()));

    const types = q.types ? q.types.split(',').map((s) => s.trim()).filter(Boolean) : null;
    const events = await collectEvents(req.user.id, range.start, range.end, { types });

    // Agrupa por dia com os totais que o calendário precisa exibir na célula.
    const byDay = new Map();
    for (const e of events) {
      if (!byDay.has(e.date)) {
        byDay.set(e.date, { date: e.date, income: 0, expense: 0, count: 0, has_overdue: false, events: [] });
      }
      const day = byDay.get(e.date);
      day.count++;
      day.has_overdue = day.has_overdue || e.is_overdue;
      if (e.type === 'income') day.income += e.amount;
      if (e.type === 'expense' || e.type === 'invoice') day.expense += e.amount;
      day.events.push(e);
    }

    const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      period: range,
      days,
      summary: {
        total_events: events.length,
        income_total: days.reduce((s, d) => s + d.income, 0),
        expense_total: days.reduce((s, d) => s + d.expense, 0),
        overdue_days: days.filter((d) => d.has_overdue).length,
      },
    });
  }),
);

/** GET /api/calendar/day/:date — tudo o que acontece num dia específico. */
router.get(
  '/day/:date',
  asyncHandler(async (req, res) => {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(422).json({ error: 'Data inválida. Use o formato AAAA-MM-DD.' });
    }

    const events = await collectEvents(req.user.id, date, date);
    res.json({
      date,
      data: events,
      summary: {
        count: events.length,
        income: events.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0),
        expense: events.filter((e) => e.type === 'expense' || e.type === 'invoice').reduce((s, e) => s + e.amount, 0),
      },
    });
  }),
);

export default router;
