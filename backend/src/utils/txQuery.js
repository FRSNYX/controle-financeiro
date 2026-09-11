import { today } from './dates.js';

/**
 * Construtor único de filtros sobre `transactions`.
 * Usado por Receitas, Despesas, Histórico, Calendário, Relatórios e Dashboard —
 * garantindo que todas as telas concordem sobre o que é "o mês de março".
 *
 * Campo de data filtrado (`dateField`):
 *   due         -> vencimento / previsão   (padrão: é o que o usuário planeja)
 *   competence  -> data da compra/receita  (regime de competência)
 *   settle      -> pagamento/recebimento   (regime de caixa)
 */
const DATE_COLUMNS = {
  due: 't.due_date',
  competence: 't.competence_date',
  settle: 't.settle_date',
};

export function buildTxFilters(f = {}, { alias = 't' } = {}) {
  const where = [`${alias}.user_id = ?`, `${alias}.deleted_at IS NULL`];
  const params = [f.userId];

  // Transferências são neutras (RN-02): fora de qualquer soma de receita/despesa.
  if (!f.includeNeutral) where.push(`${alias}.neutral = 0`);

  const dateCol = DATE_COLUMNS[f.dateField ?? 'due'] ?? DATE_COLUMNS.due;
  if (f.from) {
    where.push(`${dateCol} >= ?`);
    params.push(f.from);
  }
  if (f.to) {
    where.push(`${dateCol} <= ?`);
    params.push(f.to);
  }

  if (f.kind) {
    where.push(`${alias}.kind = ?`);
    params.push(f.kind);
  }

  // 'overdue' é derivado, não é uma coluna (ver ARQUITETURA §2).
  if (f.status === 'overdue') {
    where.push(`${alias}.status = 'pending' AND ${alias}.due_date < ?`);
    params.push(today());
  } else if (f.status === 'pending') {
    where.push(`${alias}.status = 'pending' AND ${alias}.due_date >= ?`);
    params.push(today());
  } else if (f.status) {
    where.push(`${alias}.status = ?`);
    params.push(f.status);
  }

  // Categoria: casa tanto a categoria-pai quanto a subcategoria.
  if (f.categoryId) {
    where.push(`(${alias}.category_id = ? OR ${alias}.subcategory_id = ?)`);
    params.push(f.categoryId, f.categoryId);
  }
  if (f.accountId) {
    where.push(`${alias}.account_id = ?`);
    params.push(f.accountId);
  }
  if (f.cardId) {
    where.push(`${alias}.card_id = ?`);
    params.push(f.cardId);
  }
  if (f.invoiceId) {
    where.push(`${alias}.invoice_id = ?`);
    params.push(f.invoiceId);
  }
  if (f.incomeType) {
    where.push(`${alias}.income_type = ?`);
    params.push(f.incomeType);
  }
  if (f.expenseNature) {
    where.push(`${alias}.expense_nature = ?`);
    params.push(f.expenseNature);
  }
  if (f.paymentMethod) {
    where.push(`${alias}.payment_method = ?`);
    params.push(f.paymentMethod);
  }

  if (f.minAmount != null) {
    where.push(`${alias}.amount >= ?`);
    params.push(f.minAmount);
  }
  if (f.maxAmount != null) {
    where.push(`${alias}.amount <= ?`);
    params.push(f.maxAmount);
  }

  if (f.onlyInstallments) where.push(`${alias}.installment_group IS NOT NULL`);
  if (f.onlyRecurring) where.push(`${alias}.recurrence_id IS NOT NULL`);

  if (f.search) {
    where.push(`(${alias}.description LIKE ? OR ${alias}.notes LIKE ? OR ${alias}.tags LIKE ?)`);
    const like = `%${f.search}%`;
    params.push(like, like, like);
  }

  return { where: where.join(' AND '), params };
}

/** SELECT padrão com os joins que a UI sempre precisa (nomes legíveis). */
export const TX_SELECT = `
  SELECT t.*,
         c.name  AS category_name,  c.color AS category_color, c.icon AS category_icon,
         s.name  AS subcategory_name,
         a.name  AS account_name,   a.color AS account_color,
         cc.name AS card_name,      cc.color AS card_color
    FROM transactions t
    LEFT JOIN categories   c  ON c.id  = t.category_id
    LEFT JOIN categories   s  ON s.id  = t.subcategory_id
    LEFT JOIN accounts     a  ON a.id  = t.account_id
    LEFT JOIN credit_cards cc ON cc.id = t.card_id
`;

const ORDER_COLUMNS = {
  due_date: 't.due_date',
  competence_date: 't.competence_date',
  settle_date: 't.settle_date',
  amount: 't.amount',
  description: 't.description',
  created_at: 't.created_at',
};

export function buildOrder(sort = 'due_date', dir = 'desc') {
  const col = ORDER_COLUMNS[sort] ?? ORDER_COLUMNS.due_date;
  const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${col} ${direction}, t.id ${direction}`;
}

/** Rótulos pt-BR por tipo — receita "recebida", despesa "paga". */
export function statusLabel(row, todayISO = today()) {
  if (row.status === 'canceled') return 'cancelado';
  if (row.status === 'settled') return row.kind === 'income' ? 'recebido' : 'pago';
  if (row.due_date < todayISO) return 'atrasado';
  return row.kind === 'income' ? 'previsto' : 'pendente';
}

/** Normaliza a linha do banco para o formato da API. Valores seguem em CENTAVOS. */
export function serializeTx(row, todayISO = today()) {
  if (!row) return null;
  return {
    ...row,
    neutral: !!row.neutral,
    is_overdue: row.status === 'pending' && row.due_date < todayISO,
    status_label: statusLabel(row, todayISO),
    installment_label:
      row.installment_total > 1 ? `${row.installment_no}/${row.installment_total}` : null,
  };
}
