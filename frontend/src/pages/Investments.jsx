import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, LineChart as LineChartIcon, TrendingUp, TrendingDown, MoreVertical,
  Pencil, Trash2, ArrowDownCircle, ArrowUpCircle, Coins, RefreshCw, PieChart,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Card, CardHeader, Button, Input, Select, Textarea, Field, MoneyInput, Modal,
  PageHeader, Dropdown, DropdownItem, DropdownDivider, ConfirmDialog, EmptyState,
  ErrorState, Stat, Badge, Table, Tabs, SearchInput, cx,
} from '../components/ui';
import { DonutChart, NetWorthChart, BalanceEvolutionChart } from '../components/charts';
import { useAccounts, accountOptions, useApiMutation } from '../hooks/useLookups';
import { money, percent, number, date as fmtDate, INVESTMENT_TYPES, todayISO } from '../lib/format';

const MOVEMENT_TYPES = {
  contribution: 'Aporte', withdrawal: 'Retirada', dividend: 'Dividendo',
  interest: 'Juros', jcp: 'JCP', rent: 'Aluguel (FII)',
};

const emptyInvestment = {
  name: '', ticker: '', type: 'tesouro', institution: '', quantity: 1,
  avg_price: 0, invested_amount: 0, current_value: 0,
  purchase_date: todayISO(), maturity_date: '', index_ref: '', notes: '',
};

function InvestmentForm({ open, onClose, investment, onSaved }) {
  const isEdit = !!investment?.id;
  const [form, setForm] = useState(() =>
    investment
      ? { ...emptyInvestment, ...investment, maturity_date: investment.maturity_date ?? '', ticker: investment.ticker ?? '' }
      : emptyInvestment,
  );
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const mutation = useApiMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/investments/${investment.id}`, payload) : api.post('/investments', payload),
    invalidate: ['investments', 'allocation', 'evolution'],
    successMessage: isEdit ? 'Investimento atualizado' : 'Investimento cadastrado',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar investimento' : 'Novo investimento'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button form="investment-form" type="submit" loading={mutation.isPending} disabled={!form.name.trim()}>
            {isEdit ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form
        id="investment-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            name: form.name.trim(),
            ticker: form.ticker || null,
            type: form.type,
            institution: form.institution || null,
            quantity: Number(form.quantity) || 0,
            avg_price: form.avg_price / 100,
            invested_amount: form.invested_amount / 100,
            current_value: form.current_value / 100,
            purchase_date: form.purchase_date,
            maturity_date: form.maturity_date || null,
            index_ref: form.index_ref || null,
            notes: form.notes || null,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Nome do ativo" required className="sm:col-span-2">
            <Input
              autoFocus
              required
              placeholder="Ex.: Tesouro IPCA+ 2029"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Código / Ticker">
            <Input placeholder="Ex.: PETR4" value={form.ticker} onChange={(e) => set({ ticker: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Tipo" required>
            <Select
              value={form.type}
              onChange={(e) => set({ type: e.target.value })}
              options={Object.entries(INVESTMENT_TYPES).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Instituição / Corretora">
            <Input
              placeholder="Ex.: XP Investimentos"
              value={form.institution ?? ''}
              onChange={(e) => set({ institution: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Quantidade">
            <Input
              type="number"
              step="0.00000001"
              min={0}
              value={form.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
            />
          </Field>
          <Field label="Valor aplicado" required>
            <MoneyInput value={form.invested_amount} onChange={(cents) => set({ invested_amount: cents })} />
          </Field>
          <Field label="Valor atual" hint="Em branco usa o aplicado">
            <MoneyInput value={form.current_value} onChange={(cents) => set({ current_value: cents })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Data da aplicação" required>
            <Input
              type="date"
              required
              value={form.purchase_date}
              onChange={(e) => set({ purchase_date: e.target.value })}
            />
          </Field>
          <Field label="Vencimento" hint="Renda fixa">
            <Input type="date" value={form.maturity_date} onChange={(e) => set({ maturity_date: e.target.value })} />
          </Field>
          <Field label="Indexador">
            <Input
              placeholder="Ex.: 110% CDI"
              value={form.index_ref ?? ''}
              onChange={(e) => set({ index_ref: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Observações">
          <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

function MovementForm({ investment, onClose, onSaved }) {
  const [form, setForm] = useState({
    type: 'contribution', quantity: 0, unit_price: 0, amount: 0,
    date: todayISO(), account_id: '', notes: '', create_transaction: false,
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: accountsData } = useAccounts();
  const isPosition = form.type === 'contribution' || form.type === 'withdrawal';

  const mutation = useApiMutation({
    mutationFn: () =>
      api.post(`/investments/${investment.id}/movements`, {
        type: form.type,
        quantity: Number(form.quantity) || 0,
        unit_price: form.unit_price / 100,
        amount: form.amount / 100,
        date: form.date,
        account_id: form.account_id || null,
        notes: form.notes || null,
        create_transaction: form.create_transaction,
      }),
    invalidate: ['investments', 'investment', 'allocation', 'evolution', 'transactions', 'accounts'],
    successMessage: 'Movimento registrado',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={!!investment}
      onClose={onClose}
      title="Novo movimento"
      subtitle={investment?.name}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={mutation.isPending} disabled={form.amount <= 0} onClick={() => mutation.mutate()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tipo de movimento" required>
          <Select
            value={form.type}
            onChange={(e) => set({ type: e.target.value })}
            options={Object.entries(MOVEMENT_TYPES).map(([value, label]) => ({ value, label }))}
          />
        </Field>

        {isPosition && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantidade" hint={form.type === 'withdrawal' ? `Disponível: ${number(investment?.quantity)}` : undefined}>
              <Input
                type="number"
                step="0.00000001"
                min={0}
                value={form.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
              />
            </Field>
            <Field label="Preço unitário">
              <MoneyInput value={form.unit_price} onChange={(cents) => set({ unit_price: cents })} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Valor total" required>
            <MoneyInput value={form.amount} onChange={(cents) => set({ amount: cents })} />
          </Field>
          <Field label="Data" required>
            <Input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        </div>

        <Field label="Conta relacionada" hint="Opcional">
          <Select
            value={form.account_id}
            onChange={(e) => set({ account_id: e.target.value })}
            placeholder="Selecione"
            options={accountOptions(accountsData)}
          />
        </Field>

        {form.account_id && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]"
              checked={form.create_transaction}
              onChange={(e) => set({ create_transaction: e.target.checked })}
            />
            <span>
              <span className="text-sm text-ink block">Lançar também no fluxo de caixa</span>
              <span className="text-xs text-muted block mt-0.5">
                Cria a receita ou despesa correspondente na conta selecionada.
              </span>
            </span>
          </label>
        )}

        <Field label="Observações">
          <Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function InvestmentDetail({ investmentId, onClose, onMovement }) {
  const { data } = useQuery({
    queryKey: ['investment', investmentId],
    queryFn: () => api.get(`/investments/${investmentId}`),
    enabled: !!investmentId,
  });

  const inv = data?.data;

  const series = (inv?.valuations ?? []).map((v) => ({
    label: `${v.date.slice(8, 10)}/${v.date.slice(5, 7)}`,
    balance: v.market_value,
  }));

  return (
    <Modal open={!!investmentId} onClose={onClose} title={inv?.name ?? 'Carregando...'} subtitle={inv?.institution} size="lg">
      {/* A condição olha para o DADO, não para `isLoading`: numa consulta
          desativada o TanStack Query devolve isLoading = false, e confiar
          nele renderizaria o corpo antes de o ativo existir. */}
      {!inv ? (
        <div className="skeleton h-64 rounded-xl" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Valor aplicado" value={money(inv.invested_amount)} />
            <Stat label="Valor atual" value={money(inv.current_value)} tone="brand" />
            <Stat
              label="Rentabilidade"
              value={money(inv.profit_amount)}
              tone={inv.profit_amount >= 0 ? 'positive' : 'negative'}
              hint={percent(inv.profit_pct)}
            />
            <Stat label="Proventos" value={money(inv.income_total)} tone="positive" hint="Recebidos" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ['Quantidade', number(inv.quantity)],
              ['Preço médio', money(inv.avg_price)],
              ['Aplicação', fmtDate(inv.purchase_date)],
              ['Indexador', inv.index_ref ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-surface-2 p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="text-ink font-medium truncate">{value}</p>
              </div>
            ))}
          </div>

          {series.length > 1 && (
            <div>
              <p className="text-sm font-medium text-ink mb-2">Evolução do valor de mercado</p>
              <BalanceEvolutionChart data={series} dataKey="balance" label="Valor" height={200} colorKey="networth" />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-ink">Histórico de movimentos</p>
              <Button size="sm" icon={Plus} onClick={() => onMovement(inv)}>
                Novo movimento
              </Button>
            </div>
            <Table
              rows={inv.movements}
              empty={<EmptyState title="Nenhum movimento" message="Registre aportes, retiradas e proventos." />}
              columns={[
                { key: 'date', header: 'Data', width: 100, render: (r) => fmtDate(r.date) },
                {
                  key: 'type',
                  header: 'Tipo',
                  width: 120,
                  render: (r) => (
                    <Badge tone={r.type === 'contribution' ? 'brand' : r.type === 'withdrawal' ? 'warning' : 'positive'}>
                      {MOVEMENT_TYPES[r.type] ?? r.type}
                    </Badge>
                  ),
                },
                {
                  key: 'quantity',
                  header: 'Qtd.',
                  align: 'right',
                  width: 90,
                  render: (r) => <span className="text-sm text-muted">{r.quantity ? number(r.quantity) : '—'}</span>,
                },
                {
                  key: 'amount',
                  header: 'Valor',
                  align: 'right',
                  width: 120,
                  render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.amount)}</span>,
                },
              ]}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Investments() {
  const [tab, setTab] = useState('carteira');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [movementFor, setMovementFor] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['investments', search, typeFilter],
    queryFn: () => api.get('/investments', { search: search || undefined, type: typeFilter || undefined }),
  });

  const { data: allocation } = useQuery({
    queryKey: ['allocation'],
    queryFn: () => api.get('/investments/allocation'),
  });

  const { data: evolution } = useQuery({
    queryKey: ['evolution'],
    queryFn: () => api.get('/investments/evolution', { months: 12 }),
  });

  const deleteMutation = useApiMutation({
    mutationFn: (id) => api.del(`/investments/${id}`),
    invalidate: ['investments', 'allocation', 'evolution'],
    successMessage: 'Investimento excluído',
    onSuccess: () => setDeleting(null),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const summary = data?.summary;
  const evolutionSeries = (evolution?.data ?? []).map((d) => ({
    label: `${d.month.slice(5)}/${d.month.slice(2, 4)}`,
    cash: 0,
    investments: d.market_value,
    physical_assets: 0,
    net_worth: d.market_value,
    balance: d.market_value,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Investimentos"
        subtitle="Carteira, rentabilidade e proventos"
        actions={
          <Button
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Novo investimento
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Valor aplicado" value={money(summary?.invested_total)} icon={ArrowDownCircle} />
        <Stat label="Valor atual" value={money(summary?.current_total)} icon={LineChartIcon} tone="brand" hint={`${summary?.count ?? 0} ativo(s)`} />
        <Stat
          label="Rentabilidade"
          value={money(summary?.profit_amount)}
          tone={(summary?.profit_amount ?? 0) >= 0 ? 'positive' : 'negative'}
          icon={(summary?.profit_amount ?? 0) >= 0 ? TrendingUp : TrendingDown}
          hint={percent(summary?.profit_pct ?? 0)}
        />
        <Stat
          label="Proventos recebidos"
          value={money(summary?.income_total)}
          tone="positive"
          icon={Coins}
          hint={`Retorno total ${percent(summary?.total_return_pct ?? 0)}`}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'carteira', label: 'Carteira', icon: LineChartIcon },
          { value: 'distribuicao', label: 'Distribuição', icon: PieChart },
          { value: 'evolucao', label: 'Evolução', icon: TrendingUp },
        ]}
      />

      {tab === 'carteira' && (
        <Card>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <SearchInput className="flex-1" value={search} onChange={setSearch} placeholder="Buscar por nome ou ticker..." />
            <Select
              className="sm:w-56"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              placeholder="Todos os tipos"
              options={Object.entries(INVESTMENT_TYPES).map(([value, label]) => ({ value, label }))}
            />
          </div>

          <Table
            loading={isLoading}
            rows={data?.data}
            onRowClick={(r) => setDetailId(r.id)}
            empty={
              <EmptyState
                icon={LineChartIcon}
                title="Nenhum investimento cadastrado"
                message="Cadastre seus ativos para acompanhar rentabilidade e proventos."
                action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Cadastrar investimento</Button>}
              />
            }
            columns={[
              {
                key: 'name',
                header: 'Ativo',
                render: (r) => (
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">
                      {r.name}
                      {r.ticker && <span className="text-muted ml-1.5 text-xs">{r.ticker}</span>}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {r.type_label}
                      {r.institution && ` · ${r.institution}`}
                    </p>
                  </div>
                ),
              },
              {
                key: 'quantity',
                header: 'Qtd.',
                align: 'right',
                width: 90,
                render: (r) => <span className="text-sm text-muted tabular-nums">{number(r.quantity)}</span>,
              },
              {
                key: 'invested_amount',
                header: 'Aplicado',
                align: 'right',
                width: 120,
                render: (r) => <span className="text-sm text-muted tabular-nums">{money(r.invested_amount)}</span>,
              },
              {
                key: 'current_value',
                header: 'Atual',
                align: 'right',
                width: 120,
                render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.current_value)}</span>,
              },
              {
                key: 'profit',
                header: 'Rentabilidade',
                align: 'right',
                width: 150,
                render: (r) => (
                  <div className="text-right">
                    <p className={cx('text-sm font-medium tabular-nums', r.profit_amount >= 0 ? 'text-positive' : 'text-negative')}>
                      {r.profit_amount >= 0 ? '+' : ''}
                      {money(r.profit_amount)}
                    </p>
                    <p className="text-xs text-muted">{percent(r.profit_pct)}</p>
                  </div>
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
                      <button
                        className="p-1.5 rounded-lg text-muted hover:bg-surface-2"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Ações"
                      >
                        <MoreVertical size={15} />
                      </button>
                    }
                  >
                    <DropdownItem icon={Plus} onClick={() => setMovementFor(r)}>
                      Novo movimento
                    </DropdownItem>
                    <DropdownItem
                      icon={Pencil}
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Editar
                    </DropdownItem>
                    <DropdownDivider />
                    <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting(r)}>
                      Excluir
                    </DropdownItem>
                  </Dropdown>
                ),
              },
            ]}
          />
        </Card>
      )}

      {tab === 'distribuicao' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Distribuição da carteira" subtitle="Por tipo de ativo" />
            <DonutChart
              data={(allocation?.data ?? []).map((a) => ({ name: a.type_label, total: a.current_value }))}
              centerLabel="Total"
              centerValue={allocation?.total}
            />
          </Card>

          <Card>
            <CardHeader title="Desempenho por tipo" subtitle="Aplicado x valor atual" />
            <Table
              rows={allocation?.data}
              empty={<EmptyState title="Nenhum investimento" />}
              columns={[
                { key: 'type_label', header: 'Tipo', render: (r) => <span className="text-sm text-ink">{r.type_label}</span> },
                { key: 'count', header: 'Ativos', align: 'center', width: 70 },
                {
                  key: 'invested',
                  header: 'Aplicado',
                  align: 'right',
                  width: 110,
                  render: (r) => <span className="text-sm text-muted tabular-nums">{money(r.invested)}</span>,
                },
                {
                  key: 'current_value',
                  header: 'Atual',
                  align: 'right',
                  width: 110,
                  render: (r) => <span className="text-sm font-medium text-ink tabular-nums">{money(r.current_value)}</span>,
                },
                {
                  key: 'profit_amount',
                  header: 'Resultado',
                  align: 'right',
                  width: 110,
                  render: (r) => (
                    <span className={cx('text-sm tabular-nums', r.profit_amount >= 0 ? 'text-positive' : 'text-negative')}>
                      {r.profit_amount >= 0 ? '+' : ''}
                      {money(r.profit_amount)}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === 'evolucao' && (
        <Card>
          <CardHeader title="Evolução da carteira" subtitle="Valor de mercado nos últimos 12 meses" />
          <BalanceEvolutionChart data={evolutionSeries} dataKey="balance" label="Valor de mercado" height={320} colorKey="networth" />
        </Card>
      )}

      <InvestmentForm
        key={editing?.id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        investment={editing}
        onSaved={refetch}
      />

      <InvestmentDetail
        investmentId={detailId}
        onClose={() => setDetailId(null)}
        onMovement={(inv) => {
          setDetailId(null);
          setMovementFor(inv);
        }}
      />

      {movementFor && (
        <MovementForm
          key={movementFor.id}
          investment={movementFor}
          onClose={() => setMovementFor(null)}
          onSaved={refetch}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Excluir investimento"
        message={`Excluir "${deleting?.name}"? Todo o histórico de aportes, retiradas e proventos deste ativo será removido.`}
      />
    </div>
  );
}
