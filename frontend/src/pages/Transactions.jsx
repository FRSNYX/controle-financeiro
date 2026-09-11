import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Filter, X, MoreVertical, Pencil, Copy, Trash2, Check, RotateCcw,
  Download, TrendingUp, TrendingDown, CircleSlash,
} from 'lucide-react';
import { api, download } from '../lib/api';
import { usePeriod, useToast } from '../context/AppProviders';
import {
  Card, Button, Input, Select, SearchInput, Field, Table, Pagination, Badge,
  Stat, PageHeader, Dropdown, DropdownItem, DropdownDivider, ConfirmDialog,
  EmptyState, ErrorState, Modal, cx,
} from '../components/ui';
import TransactionForm from '../components/forms/TransactionForm';
import { useAccounts, useCategories, useCards, accountOptions, useApiMutation } from '../hooks/useLookups';
import {
  money, date as fmtDate, percent, STATUS_STYLES, PAYMENT_METHODS, INCOME_TYPES,
} from '../lib/format';

const EMPTY_FILTERS = {
  status: '', categoryId: '', accountId: '', cardId: '',
  minAmount: '', maxAmount: '', paymentMethod: '', incomeType: '',
  expenseNature: '', dateField: 'due', onlyInstallments: '', onlyRecurring: '',
};

export default function Transactions({ kind }) {
  const isIncome = kind === 'income';
  const { range, label } = usePeriod();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'due_date', dir: 'desc' });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteScope, setDeleteScope] = useState('one');

  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories(kind);
  const { data: cardsData } = useCards();

  const query = useMemo(
    () => ({
      kind,
      from: range.from,
      to: range.to,
      search: search.trim() || undefined,
      page,
      pageSize: 25,
      ...sort,
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
    }),
    [kind, range, search, page, sort, filters],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['transactions', query],
    queryFn: () => api.get('/transactions', query),
  });

  const activeFilterCount = Object.values(filters).filter((v) => v !== '' && v !== 'due').length;

  const settleMutation = useApiMutation({
    mutationFn: ({ id, settled }) => api.post(`/transactions/${id}/settle`, { settled }),
    invalidate: ['transactions', 'accounts', 'budgets', 'cards', 'calendar'],
    successMessage: (res) =>
      res.data.status === 'settled'
        ? `Marcado como ${isIncome ? 'recebido' : 'pago'}`
        : 'Voltou para pendente',
  });

  const duplicateMutation = useApiMutation({
    mutationFn: (id) => api.post(`/transactions/${id}/duplicate`, {}),
    invalidate: ['transactions', 'accounts'],
    successMessage: 'Lançamento duplicado para o mês seguinte',
  });

  const deleteMutation = useApiMutation({
    mutationFn: ({ id, scope }) => api.del(`/transactions/${id}`, { scope }),
    invalidate: ['transactions', 'accounts', 'budgets', 'cards', 'calendar'],
    successMessage: (res) => `${res.deleted} lançamento(s) excluído(s)`,
    onSuccess: () => setDeleting(null),
  });

  const exportFile = async (format) => {
    try {
      toast.info('Gerando arquivo...');
      const ext = format === 'xlsx' ? 'xlsx' : format;
      await download(
        '/reports/export',
        { ...query, page: undefined, pageSize: undefined, format },
        `${isIncome ? 'receitas' : 'despesas'}-${range.from}-a-${range.to}.${ext}`,
      );
      toast.success('Arquivo baixado');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (tx) => {
    setEditing(tx);
    setFormOpen(true);
  };

  const askDelete = (tx) => {
    setDeleting(tx);
    setDeleteScope('one');
  };

  const isSeries = deleting?.installment_group || deleting?.recurrence_id;

  const columns = [
    {
      key: 'due_date',
      header: isIncome ? 'Previsão' : 'Vencimento',
      width: 110,
      render: (r) => (
        <span className={cx('text-sm whitespace-nowrap', r.is_overdue && 'text-negative font-medium')}>
          {fmtDate(r.due_date)}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Descrição',
      render: (r) => (
        <div className="min-w-0">
          <p className="text-sm text-ink truncate">{r.description}</p>
          <p className="text-xs text-muted truncate">
            {r.category_name ?? 'Sem categoria'}
            {r.subcategory_name && ` › ${r.subcategory_name}`}
            {r.installment_label && ` · parcela ${r.installment_label}`}
            {r.recurrence_id && ' · recorrente'}
          </p>
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Conta / Cartão',
      width: 150,
      render: (r) =>
        r.card_name ? (
          <span className="flex items-center gap-1.5 text-sm text-muted min-w-0">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: r.card_color }} />
            <span className="truncate">{r.card_name}</span>
          </span>
        ) : r.account_name ? (
          <span className="flex items-center gap-1.5 text-sm text-muted min-w-0">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: r.account_color }} />
            <span className="truncate">{r.account_name}</span>
          </span>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (r) => (
        <span className={cx('text-xs px-2 py-1 rounded-md font-medium', STATUS_STYLES[r.status_label])}>
          {r.status_label}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Valor',
      align: 'right',
      width: 130,
      render: (r) => (
        <span className={cx('font-medium tabular-nums', isIncome ? 'text-positive' : 'text-negative')}>
          {money(r.amount)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 50,
      align: 'right',
      render: (r) => (
        <Dropdown
          trigger={
            <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Ações">
              <MoreVertical size={15} />
            </button>
          }
        >
          <DropdownItem
            icon={r.status === 'settled' ? RotateCcw : Check}
            onClick={() => settleMutation.mutate({ id: r.id, settled: r.status !== 'settled' })}
          >
            {r.status === 'settled'
              ? 'Desfazer baixa'
              : `Marcar como ${isIncome ? 'recebido' : 'pago'}`}
          </DropdownItem>
          <DropdownItem icon={Pencil} onClick={() => openEdit(r)}>
            Editar
          </DropdownItem>
          <DropdownItem icon={Copy} onClick={() => duplicateMutation.mutate(r.id)}>
            Duplicar
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem icon={Trash2} tone="danger" onClick={() => askDelete(r)}>
            Excluir
          </DropdownItem>
        </Dropdown>
      ),
    },
  ];

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const totals = data?.totals;

  return (
    <div className="space-y-4">
      <PageHeader
        title={isIncome ? 'Receitas' : 'Despesas'}
        subtitle={label}
        actions={
          <>
            <Dropdown
              trigger={
                <Button variant="outline" icon={Download}>
                  Exportar
                </Button>
              }
            >
              <DropdownItem onClick={() => exportFile('csv')}>CSV (Excel pt-BR)</DropdownItem>
              <DropdownItem onClick={() => exportFile('xlsx')}>Excel (.xlsx)</DropdownItem>
              <DropdownItem onClick={() => exportFile('pdf')}>PDF</DropdownItem>
            </Dropdown>
            <Button icon={Plus} onClick={openNew}>
              Nova {isIncome ? 'receita' : 'despesa'}
            </Button>
          </>
        }
      />

      {/* ---------- Totais do filtro ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label={`Total de ${isIncome ? 'receitas' : 'despesas'}`}
          value={money(isIncome ? totals?.income_total : totals?.expense_total)}
          tone={isIncome ? 'positive' : 'negative'}
          icon={isIncome ? TrendingUp : TrendingDown}
          hint={`${data?.pagination?.total ?? 0} lançamento(s)`}
        />
        <Stat
          label={isIncome ? 'Já recebido' : 'Já pago'}
          value={money(isIncome ? totals?.income_settled : totals?.expense_settled)}
          tone="neutral"
          icon={Check}
        />
        <Stat
          label={isIncome ? 'A receber' : 'A pagar'}
          value={money(totals?.pending_total)}
          tone="warning"
        />
        <Stat
          label="Em atraso"
          value={money(totals?.overdue_total)}
          tone={totals?.overdue_total > 0 ? 'negative' : 'neutral'}
          icon={CircleSlash}
        />
      </div>

      {/* ---------- Busca e filtros ---------- */}
      <Card>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <SearchInput
            className="flex-1"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Buscar por descrição, observação ou etiqueta..."
          />
          <div className="flex gap-2">
            <Select
              className="w-auto min-w-[150px]"
              value={filters.status}
              onChange={(e) => {
                setFilters({ ...filters, status: e.target.value });
                setPage(1);
              }}
              placeholder="Todos os status"
              options={[
                { value: 'pending', label: isIncome ? 'Previsto' : 'Pendente' },
                { value: 'settled', label: isIncome ? 'Recebido' : 'Pago' },
                { value: 'overdue', label: 'Atrasado' },
                { value: 'canceled', label: 'Cancelado' },
              ]}
            />
            <Button
              variant={showFilters || activeFilterCount ? 'primary' : 'outline'}
              icon={Filter}
              onClick={() => setShowFilters((s) => !s)}
            >
              Filtros
              {activeFilterCount > 0 && (
                <span className="ml-1 px-1.5 rounded-full bg-white/25 text-[10px]">{activeFilterCount}</span>
              )}
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="rounded-lg border border-line p-4 mb-3 space-y-4 animate-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Categoria">
                <Select
                  value={filters.categoryId}
                  onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
                  placeholder="Todas"
                  options={(categoriesData?.data ?? []).map((c) => ({
                    value: c.id,
                    label: c.parent_id ? `   ${c.name}` : c.name,
                  }))}
                />
              </Field>

              <Field label="Conta">
                <Select
                  value={filters.accountId}
                  onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}
                  placeholder="Todas"
                  options={accountOptions(accountsData)}
                />
              </Field>

              {!isIncome && (
                <Field label="Cartão">
                  <Select
                    value={filters.cardId}
                    onChange={(e) => setFilters({ ...filters, cardId: e.target.value })}
                    placeholder="Todos"
                    options={(cardsData?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  />
                </Field>
              )}

              <Field label={isIncome ? 'Tipo de receita' : 'Forma de pagamento'}>
                <Select
                  value={isIncome ? filters.incomeType : filters.paymentMethod}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      [isIncome ? 'incomeType' : 'paymentMethod']: e.target.value,
                    })
                  }
                  placeholder="Todos"
                  options={Object.entries(isIncome ? INCOME_TYPES : PAYMENT_METHODS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Field>

              <Field label="Valor mínimo">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={filters.minAmount}
                  onChange={(e) => setFilters({ ...filters, minAmount: e.target.value })}
                />
              </Field>

              <Field label="Valor máximo">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Sem limite"
                  value={filters.maxAmount}
                  onChange={(e) => setFilters({ ...filters, maxAmount: e.target.value })}
                />
              </Field>

              <Field label="Filtrar datas por">
                <Select
                  value={filters.dateField}
                  onChange={(e) => setFilters({ ...filters, dateField: e.target.value })}
                  options={[
                    { value: 'due', label: isIncome ? 'Previsão' : 'Vencimento' },
                    { value: 'competence', label: isIncome ? 'Data da receita' : 'Data da compra' },
                    { value: 'settle', label: isIncome ? 'Recebimento' : 'Pagamento' },
                  ]}
                />
              </Field>

              {!isIncome && (
                <Field label="Natureza">
                  <Select
                    value={filters.expenseNature}
                    onChange={(e) => setFilters({ ...filters, expenseNature: e.target.value })}
                    placeholder="Todas"
                    options={[
                      { value: 'fixed', label: 'Fixa' },
                      { value: 'variable', label: 'Variável' },
                    ]}
                  />
                </Field>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-3 border-t border-line flex-wrap">
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--brand))]"
                    checked={filters.onlyInstallments === 'true'}
                    onChange={(e) => setFilters({ ...filters, onlyInstallments: e.target.checked ? 'true' : '' })}
                  />
                  Só parcelados
                </label>
                <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--brand))]"
                    checked={filters.onlyRecurring === 'true'}
                    onChange={(e) => setFilters({ ...filters, onlyRecurring: e.target.checked ? 'true' : '' })}
                  />
                  Só recorrentes
                </label>
              </div>

              <Button
                size="sm"
                variant="ghost"
                icon={X}
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setPage(1);
                }}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
        )}

        <Table
          columns={columns}
          rows={data?.data}
          loading={isLoading}
          empty={
            <EmptyState
              icon={isIncome ? TrendingUp : TrendingDown}
              title={`Nenhuma ${isIncome ? 'receita' : 'despesa'} encontrada`}
              message={
                activeFilterCount || search
                  ? 'Tente ajustar os filtros ou o período selecionado.'
                  : `Cadastre sua primeira ${isIncome ? 'receita' : 'despesa'} deste período.`
              }
              action={<Button icon={Plus} onClick={openNew}>Nova {isIncome ? 'receita' : 'despesa'}</Button>}
            />
          }
        />

        <Pagination
          page={data?.pagination?.page ?? 1}
          totalPages={data?.pagination?.totalPages}
          total={data?.pagination?.total}
          onChange={setPage}
        />
      </Card>

      <TransactionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        kind={kind}
        transaction={editing}
        onSaved={refetch}
      />

      {/* Exclusão de série pergunta o alcance antes de apagar. */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir lançamento"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ id: deleting.id, scope: deleteScope })}
            >
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink mb-1">
          Excluir <strong>{deleting?.description}</strong> de {money(deleting?.amount)}?
        </p>
        <p className="text-xs text-muted mb-4">
          O lançamento vai para a lixeira e pode ser restaurado no Histórico.
        </p>

        {isSeries && (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <p className="text-xs font-medium text-muted mb-2">
              Este lançamento faz parte de {deleting?.installment_group ? 'um parcelamento' : 'uma recorrência'}.
              O que você quer excluir?
            </p>
            {[
              { value: 'one', label: 'Apenas este lançamento' },
              { value: 'future', label: 'Este e os próximos' },
              { value: 'all', label: 'Toda a série' },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  className="accent-[rgb(var(--brand))]"
                  checked={deleteScope === opt.value}
                  onChange={() => setDeleteScope(opt.value)}
                />
                <span className="text-sm text-ink">{opt.label}</span>
              </label>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
