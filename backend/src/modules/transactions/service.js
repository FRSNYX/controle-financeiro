import { randomUUID } from 'node:crypto';
import { all, get, run, transaction } from '../../db/index.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { toCents, splitInstallments } from '../../utils/money.js';
import { addMonths, monthKey, resolveInvoicePeriod, stepDate, today } from '../../utils/dates.js';
import { logAudit } from '../../utils/audit.js';

/** Horizonte de materialização de recorrências (RN-06). */
const RECURRENCE_HORIZON_MONTHS = 12;

/**
 * RN-04 — devolve (criando se preciso) a fatura em que uma compra cai.
 * A unicidade é (card_id, reference_month), então repetir a chamada é idempotente.
 */
export function getOrCreateInvoice(userId, card, purchaseDate) {
  const { referenceMonth, closingDate, dueDate } = resolveInvoicePeriod(
    purchaseDate,
    card.closing_day,
    card.due_day,
  );

  const existing = get('SELECT * FROM card_invoices WHERE card_id = ? AND reference_month = ?', [
    card.id,
    referenceMonth,
  ]);
  if (existing) return existing;

  const { lastInsertRowid } = run(
    `INSERT INTO card_invoices (user_id, card_id, reference_month, closing_date, due_date, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, card.id, referenceMonth, closingDate, dueDate, closingDate <= today() ? 'closed' : 'open'],
  );
  return get('SELECT * FROM card_invoices WHERE id = ?', [Number(lastInsertRowid)]);
}

/** Campos aceitos na criação/edição, já normalizados para o formato do banco. */
function normalizeInput(userId, input) {
  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw badRequest('O valor deve ser maior que zero');

  const competence = input.competence_date ?? input.due_date ?? today();
  const due = input.due_date ?? competence;

  return {
    kind: input.kind,
    description: String(input.description).trim(),
    amount: amountCents,
    status: input.status ?? 'pending',
    category_id: input.category_id ?? null,
    subcategory_id: input.subcategory_id ?? null,
    account_id: input.account_id ?? null,
    competence_date: competence,
    due_date: due,
    settle_date: input.settle_date ?? null,
    income_type: input.kind === 'income' ? (input.income_type ?? null) : null,
    receipt_method: input.kind === 'income' ? (input.receipt_method ?? null) : null,
    expense_nature: input.kind === 'expense' ? (input.expense_nature ?? 'variable') : null,
    payment_method: input.kind === 'expense' ? (input.payment_method ?? null) : null,
    card_id: input.card_id ?? null,
    tags: input.tags ?? null,
    notes: input.notes ?? null,
    goal_id: input.goal_id ?? null,
  };
}

/** Valida que contas/categorias/cartões informados pertencem ao usuário. */
function assertOwnership(userId, data) {
  const check = (table, id, label) => {
    if (!id) return;
    if (!get(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, [id, userId])) {
      throw badRequest(`${label} não encontrado(a)`);
    }
  };
  check('accounts', data.account_id, 'Conta');
  check('categories', data.category_id, 'Categoria');
  check('categories', data.subcategory_id, 'Subcategoria');
  check('credit_cards', data.card_id, 'Cartão');
}

const INSERT_SQL = `
  INSERT INTO transactions
    (user_id, kind, description, amount, status, neutral, category_id, subcategory_id, account_id,
     competence_date, due_date, settle_date, income_type, receipt_method, expense_nature,
     payment_method, card_id, invoice_id, installment_group, installment_no, installment_total,
     recurrence_id, transfer_id, goal_id, tags, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function insertRow(userId, d) {
  const { lastInsertRowid } = run(INSERT_SQL, [
    userId, d.kind, d.description, d.amount, d.status, d.neutral ?? 0,
    d.category_id, d.subcategory_id, d.account_id,
    d.competence_date, d.due_date, d.settle_date,
    d.income_type, d.receipt_method, d.expense_nature,
    d.payment_method, d.card_id, d.invoice_id ?? null,
    d.installment_group ?? null, d.installment_no ?? null, d.installment_total ?? null,
    d.recurrence_id ?? null, d.transfer_id ?? null, d.goal_id ?? null,
    d.tags, d.notes,
  ]);
  return Number(lastInsertRowid);
}

/**
 * Cria uma receita ou despesa.
 *
 * Três caminhos, nesta ordem de precedência:
 *   1. Parcelada  (installment_total > 1) -> N lançamentos, um por mês
 *   2. Recorrente (recurrence)            -> template + ocorrências materializadas
 *   3. Simples                            -> 1 lançamento
 *
 * Compra no cartão (payment_method 'credito' + card_id) nunca movimenta conta:
 * ela é amarrada a uma fatura e só o pagamento da fatura debita a conta (RN-04).
 */
export function createTransaction(userId, input) {
  const data = normalizeInput(userId, input);
  assertOwnership(userId, data);

  const isCard = data.kind === 'expense' && data.card_id && data.payment_method === 'credito';
  if (isCard) data.account_id = null;
  if (data.status === 'settled' && !data.settle_date) data.settle_date = today();
  if (data.status !== 'settled') data.settle_date = null;

  const card = isCard
    ? get('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [data.card_id, userId])
    : null;
  if (isCard && !card) throw badRequest('Cartão não encontrado');

  const installmentTotal = Number(input.installment_total ?? 1);

  return transaction(() => {
    // ---------- 1. Parcelamento (RN-03) ----------
    if (installmentTotal > 1) {
      if (installmentTotal > 480) throw badRequest('Número de parcelas acima do limite (480)');

      const group = randomUUID();
      const parts = splitInstallments(data.amount, installmentTotal);
      const ids = [];

      for (let i = 0; i < installmentTotal; i++) {
        const dueDate = addMonths(data.due_date, i);
        const competence = addMonths(data.competence_date, i);

        let invoiceId = null;
        let effectiveDue = dueDate;
        if (isCard) {
          // Cada parcela cai na fatura do mês seguinte à anterior.
          const invoice = getOrCreateInvoice(userId, card, addMonths(data.competence_date, i));
          invoiceId = invoice.id;
          effectiveDue = invoice.due_date;
        }

        ids.push(
          insertRow(userId, {
            ...data,
            amount: parts[i],
            description: data.description,
            competence_date: isCard ? data.competence_date : competence,
            due_date: effectiveDue,
            // Só a primeira parcela pode nascer liquidada; as futuras são pendentes.
            status: i === 0 ? data.status : 'pending',
            settle_date: i === 0 ? data.settle_date : null,
            invoice_id: invoiceId,
            installment_group: group,
            installment_no: i + 1,
            installment_total: installmentTotal,
          }),
        );
      }

      logAudit({
        userId, entity: 'transactions', entityId: ids[0], action: 'create',
        summary: `${data.description} — ${installmentTotal} parcelas`,
      });
      return { ids, installment_group: group, count: ids.length };
    }

    // ---------- 2. Recorrência (RN-06) ----------
    if (input.recurrence?.frequency) {
      const r = input.recurrence;
      const { lastInsertRowid } = run(
        `INSERT INTO recurrences (user_id, kind, frequency, interval_n, start_date, end_date, max_count, template)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, data.kind, r.frequency, r.interval_n ?? 1, data.due_date,
         r.end_date ?? null, r.max_count ?? null, JSON.stringify({ ...data, card_id: data.card_id })],
      );
      const recurrenceId = Number(lastInsertRowid);
      const ids = materializeRecurrence(userId, recurrenceId);

      logAudit({
        userId, entity: 'transactions', entityId: ids[0] ?? null, action: 'create',
        summary: `${data.description} — recorrente (${r.frequency})`,
      });
      return { ids, recurrence_id: recurrenceId, count: ids.length };
    }

    // ---------- 3. Lançamento simples ----------
    let invoiceId = null;
    if (isCard) {
      const invoice = getOrCreateInvoice(userId, card, data.competence_date);
      invoiceId = invoice.id;
      data.due_date = invoice.due_date;
    }

    const id = insertRow(userId, { ...data, invoice_id: invoiceId, installment_total: 1, installment_no: 1 });
    logAudit({ userId, entity: 'transactions', entityId: id, action: 'create', summary: data.description, after: data });
    return { ids: [id], count: 1 };
  });
}

/**
 * Materializa as ocorrências de uma recorrência até o horizonte.
 * Idempotente: pula datas que já possuem lançamento para a mesma recorrência.
 */
export function materializeRecurrence(userId, recurrenceId) {
  const rec = get('SELECT * FROM recurrences WHERE id = ? AND user_id = ?', [recurrenceId, userId]);
  if (!rec || !rec.active) return [];

  const template = JSON.parse(rec.template);
  const horizon = addMonths(today(), RECURRENCE_HORIZON_MONTHS);
  const limit = rec.end_date && rec.end_date < horizon ? rec.end_date : horizon;

  const existing = new Set(
    all('SELECT due_date FROM transactions WHERE recurrence_id = ?', [recurrenceId]).map((r) => r.due_date),
  );

  const card = template.card_id
    ? get('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [template.card_id, userId])
    : null;

  const ids = [];
  let cursor = rec.start_date;
  let count = existing.size;

  // O teto de 600 iterações protege contra frequência diária + horizonte longo.
  for (let i = 0; i < 600 && cursor <= limit; i++) {
    if (rec.max_count && count >= rec.max_count) break;

    if (!existing.has(cursor)) {
      let invoiceId = null;
      let due = cursor;
      if (card && template.payment_method === 'credito') {
        const invoice = getOrCreateInvoice(userId, card, cursor);
        invoiceId = invoice.id;
        due = invoice.due_date;
      }
      ids.push(
        insertRow(userId, {
          ...template,
          competence_date: cursor,
          due_date: due,
          status: 'pending',
          settle_date: null,
          invoice_id: invoiceId,
          recurrence_id: recurrenceId,
          installment_no: null,
          installment_total: null,
        }),
      );
      count++;
    }
    cursor = stepDate(cursor, rec.frequency, rec.interval_n);
  }

  run("UPDATE recurrences SET last_run = datetime('now','localtime') WHERE id = ?", [recurrenceId]);
  return ids;
}

/** Roda todas as recorrências ativas — chamado no boot e diariamente. */
export function runAllRecurrences(userId) {
  const list = all('SELECT id FROM recurrences WHERE user_id = ? AND active = 1', [userId]);
  let total = 0;
  for (const r of list) total += materializeRecurrence(userId, r.id).length;
  return total;
}

export function updateTransaction(userId, id, input) {
  const before = get('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId]);
  if (!before) throw notFound('Lançamento não encontrado');
  if (before.neutral) throw badRequest('Edite a transferência pelo módulo de Transferências');

  const fields = {};
  const setIf = (key, value) => { if (value !== undefined) fields[key] = value; };

  setIf('description', input.description?.trim());
  setIf('amount', input.amount !== undefined ? toCents(input.amount) : undefined);
  setIf('category_id', input.category_id);
  setIf('subcategory_id', input.subcategory_id);
  setIf('account_id', input.account_id);
  setIf('competence_date', input.competence_date);
  setIf('due_date', input.due_date);
  setIf('income_type', input.income_type);
  setIf('receipt_method', input.receipt_method);
  setIf('expense_nature', input.expense_nature);
  setIf('payment_method', input.payment_method);
  setIf('tags', input.tags);
  setIf('notes', input.notes);
  setIf('goal_id', input.goal_id);

  if (input.status !== undefined) {
    fields.status = input.status;
    // Liquidar sem data informada usa hoje; despachar de volta para pendente limpa a data.
    if (input.status === 'settled') fields.settle_date = input.settle_date ?? before.settle_date ?? today();
    else fields.settle_date = null;
  } else if (input.settle_date !== undefined) {
    fields.settle_date = input.settle_date;
  }

  if (fields.amount !== undefined && fields.amount <= 0) throw badRequest('O valor deve ser maior que zero');
  assertOwnership(userId, { ...before, ...fields });

  const entries = Object.entries(fields);
  if (entries.length > 0) {
    run(
      `UPDATE transactions SET ${entries.map(([k]) => `${k} = ?`).join(', ')},
              updated_at = datetime('now','localtime')
        WHERE id = ? AND user_id = ?`,
      [...entries.map(([, v]) => v), id, userId],
    );
  }

  const after = get('SELECT * FROM transactions WHERE id = ?', [id]);
  logAudit({ userId, entity: 'transactions', entityId: id, action: 'update', summary: `Lançamento "${after.description}" editado`, before, after });
  return after;
}

/**
 * Exclusão em escopo (RN-11 — soft delete, o histórico nunca some):
 *   one    -> só este lançamento
 *   future -> este e os seguintes da mesma série (parcelas ou recorrência)
 *   all    -> a série inteira
 */
export function deleteTransaction(userId, id, scope = 'one') {
  const tx = get('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId]);
  if (!tx) throw notFound('Lançamento não encontrado');

  const seriesKey = tx.installment_group
    ? { column: 'installment_group', value: tx.installment_group }
    : tx.recurrence_id
      ? { column: 'recurrence_id', value: tx.recurrence_id }
      : null;

  return transaction(() => {
    let where = 'id = ? AND user_id = ?';
    let params = [id, userId];

    if (scope !== 'one' && seriesKey) {
      where = `${seriesKey.column} = ? AND user_id = ? AND deleted_at IS NULL`;
      params = [seriesKey.value, userId];
      if (scope === 'future') {
        where += ' AND due_date >= ?';
        params.push(tx.due_date);
      }
      if (seriesKey.column === 'recurrence_id' && scope === 'all') {
        run('UPDATE recurrences SET active = 0 WHERE id = ? AND user_id = ?', [seriesKey.value, userId]);
      }
    }

    const { changes } = run(
      `UPDATE transactions SET deleted_at = datetime('now','localtime') WHERE ${where}`,
      params,
    );
    logAudit({ userId, entity: 'transactions', entityId: id, action: 'delete', summary: `${changes} lançamento(s) excluído(s): "${tx.description}"`, before: tx });
    return changes;
  });
}

/** Duplica um lançamento — atalho para despesas parecidas mês a mês. */
export function duplicateTransaction(userId, id, overrides = {}) {
  const src = get('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [id, userId]);
  if (!src) throw notFound('Lançamento não encontrado');

  return createTransaction(userId, {
    kind: src.kind,
    description: overrides.description ?? src.description,
    amount: (overrides.amount !== undefined ? toCents(overrides.amount) : src.amount) / 100,
    status: 'pending',
    category_id: src.category_id,
    subcategory_id: src.subcategory_id,
    account_id: src.account_id,
    competence_date: overrides.competence_date ?? today(),
    due_date: overrides.due_date ?? addMonths(src.due_date, 1),
    income_type: src.income_type,
    receipt_method: src.receipt_method,
    expense_nature: src.expense_nature,
    payment_method: src.payment_method,
    card_id: src.card_id,
    tags: src.tags,
    notes: src.notes,
  });
}

/** Marca como pago/recebido (ou desfaz). */
export function settleTransaction(userId, id, { settled = true, date, accountId } = {}) {
  const tx = get('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId]);
  if (!tx) throw notFound('Lançamento não encontrado');

  run(
    `UPDATE transactions
        SET status = ?, settle_date = ?, account_id = COALESCE(?, account_id),
            updated_at = datetime('now','localtime')
      WHERE id = ? AND user_id = ?`,
    [settled ? 'settled' : 'pending', settled ? (date ?? today()) : null, accountId ?? null, id, userId],
  );

  const after = get('SELECT * FROM transactions WHERE id = ?', [id]);
  logAudit({
    userId, entity: 'transactions', entityId: id, action: 'update',
    summary: settled
      ? `"${tx.description}" marcado como ${tx.kind === 'income' ? 'recebido' : 'pago'}`
      : `"${tx.description}" voltou para pendente`,
    before: tx, after,
  });
  return after;
}

export { monthKey };
