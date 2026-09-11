import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileBarChart, Download, TrendingUp, TrendingDown, Scale, PiggyBank,
  Trophy, Calendar, Wallet, CreditCard, Percent, ArrowUpRight,
} from 'lucide-react';
import { api, download } from '../lib/api';
import { usePeriod, useToast } from '../context/AppProviders';
import {
  Card, CardHeader, Button, Select, Field, PageHeader, Tabs, Table,
  Dropdown, DropdownItem, EmptyState, ErrorState, Stat, Badge, cx,
} from '../components/ui';
import {
  IncomeExpenseChart, BalanceEvolutionChart, DonutChart, CategoryBarChart, ResultChart,
} from '../components/charts';
import { money, percent, date as fmtDate, number, PAYMENT_METHODS } from '../lib/format';

export default function Reports() {
  const { range, label } = usePeriod();
  const toast = useToast();

  const [tab, setTab] = useState('resumo');
  const [groupBy, setGroupBy] = useState('month');
  const [categoryKind, setCategoryKind] = useState('expense');

  const params = { from: range.from, to: range.to };

  const summary = useQuery({
    queryKey: ['report-summary', params, groupBy],
    queryFn: () => api.get('/reports/summary', { ...params, groupBy }),
  });

  const indicators = useQuery({
    queryKey: ['report-indicators', params],
    queryFn: () => api.get('/reports/indicators', params),
  });

  const byCategory = useQuery({
    queryKey: ['report-category', params, categoryKind],
    queryFn: () => api.get('/reports/by-category', { ...params, kind: categoryKind }),
  });

  const byAccount = useQuery({
    queryKey: ['report-account', params],
    queryFn: () => api.get('/reports/by-account', params),
    enabled: tab === 'contas',
  });

  const byCard = useQuery({
    queryKey: ['report-card', params],
    queryFn: () => api.get('/reports/by-card', params),
    enabled: tab === 'contas',
  });

  const byMethod = useQuery({
    queryKey: ['report-method', params],
    queryFn: () => api.get('/reports/by-payment-method', params),
    enabled: tab === 'contas',
  });

  const comparison = useQuery({
    queryKey: ['report-comparison'],
    queryFn: () => api.get('/reports/monthly-comparison', { months: 12 }),
    enabled: tab === 'comparativo',
  });

  const exportFile = async (format) => {
    try {
      toast.info('Gerando arquivo...');
      await download(
        '/reports/export',
        { ...params, format },
        `relatorio-${range.from}-a-${range.to}.${format}`,
      );
      toast.success('Arquivo baixado');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (indicators.error) return <ErrorState error={indicators.error} onRetry={indicators.refetch} />;

  const ind = indicators.data?.indicators;
  const comp = indicators.data?.comparison;

  // Série temporal com rótulo legível conforme o agrupamento.
  const series = (summary.data?.data ?? []).map((row) => ({
    ...row,
    label:
      groupBy === 'month'
        ? `${row.bucket.slice(5)}/${row.bucket.slice(2, 4)}`
        : groupBy === 'day'
          ? `${row.bucket.slice(8, 10)}/${row.bucket.slice(5, 7)}`
          : row.bucket,
    balance: row.accumulated,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Relatórios"
        subtitle={label}
        actions={
          <Dropdown
            trigger={
              <Button icon={Download}>Exportar</Button>
            }
          >
            <DropdownItem onClick={() => exportFile('csv')}>CSV (Excel pt-BR)</DropdownItem>
            <DropdownItem onClick={() => exportFile('xlsx')}>Excel (.xlsx)</DropdownItem>
            <DropdownItem onClick={() => exportFile('pdf')}>PDF</DropdownItem>
          </Dropdown>
        }
      />

      {/* ---------- Indicadores ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Receitas"
          value={money(ind?.income_total)}
          tone="positive"
          icon={TrendingUp}
          trend={comp?.income_change_pct}
          hint={`${ind?.income_count ?? 0} lançamento(s)`}
        />
        <Stat
          label="Despesas"
          value={money(ind?.expense_total)}
          tone="negative"
          icon={TrendingDown}
          trend={comp?.expense_change_pct ? -comp.expense_change_pct : undefined}
          hint={`${ind?.expense_count ?? 0} lançamento(s)`}
        />
        <Stat
          label="Economia"
          value={money(ind?.result)}
          tone={(ind?.result ?? 0) >= 0 ? 'positive' : 'negative'}
          icon={Scale}
          hint={`vs ${money(comp?.result)} no período anterior`}
        />
        <Stat
          label="Taxa de economia"
          value={percent(ind?.savings_rate ?? 0)}
          tone={(ind?.savings_rate ?? 0) >= 20 ? 'positive' : (ind?.savings_rate ?? 0) >= 0 ? 'warning' : 'negative'}
          icon={Percent}
          hint="Do que entrou, quanto sobrou"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Média de gasto por dia" value={money(ind?.avg_expense_per_day)} icon={Calendar} />
        <Stat label="Média por mês" value={money(ind?.avg_expense_per_month)} hint={`${indicators.data?.period?.months ?? 0} mês(es)`} />
        <Stat label="Gasto médio por lançamento" value={money(ind?.avg_expense_per_transaction)} />
        <Stat
          label="Crescimento patrimonial"
          value={money(ind?.net_worth_growth)}
          tone={(ind?.net_worth_growth ?? 0) >= 0 ? 'positive' : 'negative'}
          icon={ArrowUpRight}
          hint={percent(ind?.net_worth_growth_pct ?? 0)}
        />
      </div>

      {/* ---------- Destaques ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Maior despesa do período" icon={Trophy} />
          {ind?.biggest_expense ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink font-medium truncate">{ind.biggest_expense.description}</p>
                <p className="text-xs text-muted truncate">
                  {ind.biggest_expense.category_name ?? 'Sem categoria'} · {fmtDate(ind.biggest_expense.due_date)}
                </p>
              </div>
              <p className="text-xl font-semibold text-negative shrink-0">{money(ind.biggest_expense.amount)}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Nenhuma despesa no período.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Categoria com maior gasto" icon={PiggyBank} />
          {ind?.top_category ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ background: ind.top_category.color }} />
                <span className="text-ink font-medium truncate">{ind.top_category.name}</span>
              </span>
              <div className="text-right shrink-0">
                <p className="text-xl font-semibold text-ink">{money(ind.top_category.total)}</p>
                <p className="text-xs text-muted">{percent((ind.top_category.total / (ind.expense_total || 1)) * 100)} do total</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Nenhuma despesa categorizada.</p>
          )}
        </Card>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'resumo', label: 'Resumo', icon: FileBarChart },
          { value: 'categorias', label: 'Categorias', icon: PiggyBank },
          { value: 'contas', label: 'Contas e cartões', icon: Wallet },
          { value: 'comparativo', label: 'Comparativo', icon: TrendingUp },
        ]}
      />

      {/* ---------- Resumo ---------- */}
      {tab === 'resumo' && (
        <>
          <Card>
            <CardHeader
              title="Receitas x Despesas"
              subtitle={`Agrupado por ${{ day: 'dia', week: 'semana', month: 'mês', year: 'ano' }[groupBy]}`}
              action={
                <Select
                  className="w-36"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  options={[
                    { value: 'day', label: 'Por dia' },
                    { value: 'week', label: 'Por semana' },
                    { value: 'month', label: 'Por mês' },
                    { value: 'year', label: 'Por ano' },
                  ]}
                />
              }
            />
            <IncomeExpenseChart data={series} height={300} />
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Resultado por período" subtitle="Sobra ou falta em cada intervalo" />
              <ResultChart data={series} />
            </Card>
            <Card>
              <CardHeader title="Saldo acumulado" subtitle="Soma progressiva do resultado" />
              <BalanceEvolutionChart data={series} dataKey="balance" label="Acumulado" />
            </Card>
          </div>

          <Card>
            <CardHeader title="Detalhamento por período" />
            <Table
              loading={summary.isLoading}
              rows={series}
              rowKey={(r) => r.bucket}
              empty={<EmptyState title="Sem dados no período" />}
              columns={[
                { key: 'label', header: 'Período', render: (r) => <span className="text-sm text-ink">{r.label}</span> },
                { key: 'tx_count', header: 'Lançamentos', align: 'center', width: 110 },
                {
                  key: 'income',
                  header: 'Receitas',
                  align: 'right',
                  width: 130,
                  render: (r) => <span className="text-positive tabular-nums">{money(r.income)}</span>,
                },
                {
                  key: 'expense',
                  header: 'Despesas',
                  align: 'right',
                  width: 130,
                  render: (r) => <span className="text-negative tabular-nums">{money(r.expense)}</span>,
                },
                {
                  key: 'result',
                  header: 'Resultado',
                  align: 'right',
                  width: 130,
                  render: (r) => (
                    <span className={cx('font-medium tabular-nums', r.result >= 0 ? 'text-positive' : 'text-negative')}>
                      {money(r.result)}
                    </span>
                  ),
                },
                {
                  key: 'savings_rate',
                  header: 'Economia',
                  align: 'right',
                  width: 100,
                  render: (r) => <span className="text-sm text-muted">{percent(r.savings_rate)}</span>,
                },
              ]}
            />
          </Card>
        </>
      )}

      {/* ---------- Categorias ---------- */}
      {tab === 'categorias' && (
        <>
          <div className="flex justify-end">
            <Select
              className="w-48"
              value={categoryKind}
              onChange={(e) => setCategoryKind(e.target.value)}
              options={[
                { value: 'expense', label: 'Despesas' },
                { value: 'income', label: 'Receitas' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Distribuição" subtitle={categoryKind === 'expense' ? 'Gastos por categoria' : 'Receitas por categoria'} />
              <DonutChart
                data={byCategory.data?.data ?? []}
                centerLabel="Total"
                centerValue={byCategory.data?.total}
              />
            </Card>

            <Card>
              <CardHeader title="Ranking" subtitle="Da maior para a menor" />
              <CategoryBarChart data={byCategory.data?.data ?? []} height={360} />
            </Card>
          </div>

          <Card>
            <CardHeader title="Detalhamento por categoria" />
            <Table
              loading={byCategory.isLoading}
              rows={byCategory.data?.data}
              rowKey={(r) => r.category_id}
              empty={<EmptyState title="Sem dados no período" />}
              columns={[
                {
                  key: 'name',
                  header: 'Categoria',
                  render: (r) => (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                      <span className="text-sm text-ink truncate">{r.name}</span>
                    </span>
                  ),
                },
                { key: 'tx_count', header: 'Lançamentos', align: 'center', width: 110 },
                {
                  key: 'avg_amount',
                  header: 'Ticket médio',
                  align: 'right',
                  width: 120,
                  render: (r) => <span className="text-sm text-muted tabular-nums">{money(r.avg_amount)}</span>,
                },
                {
                  key: 'max_amount',
                  header: 'Maior',
                  align: 'right',
                  width: 120,
                  render: (r) => <span className="text-sm text-muted tabular-nums">{money(r.max_amount)}</span>,
                },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  width: 130,
                  render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.total)}</span>,
                },
                {
                  key: 'share_pct',
                  header: '%',
                  align: 'right',
                  width: 80,
                  render: (r) => <span className="text-sm text-muted">{percent(r.share_pct)}</span>,
                },
              ]}
            />
          </Card>
        </>
      )}

      {/* ---------- Contas e cartões ---------- */}
      {tab === 'contas' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Movimentação por conta" icon={Wallet} />
            <Table
              loading={byAccount.isLoading}
              rows={byAccount.data?.data}
              empty={<EmptyState title="Nenhuma conta com movimento" />}
              columns={[
                {
                  key: 'name',
                  header: 'Conta',
                  render: (r) => (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                      <span className="text-sm text-ink truncate">{r.name}</span>
                    </span>
                  ),
                },
                {
                  key: 'income',
                  header: 'Entradas',
                  align: 'right',
                  width: 110,
                  render: (r) => <span className="text-positive text-sm tabular-nums">{money(r.income)}</span>,
                },
                {
                  key: 'expense',
                  header: 'Saídas',
                  align: 'right',
                  width: 110,
                  render: (r) => <span className="text-negative text-sm tabular-nums">{money(r.expense)}</span>,
                },
                {
                  key: 'result',
                  header: 'Saldo',
                  align: 'right',
                  width: 110,
                  render: (r) => (
                    <span className={cx('text-sm font-medium tabular-nums', r.result >= 0 ? 'text-positive' : 'text-negative')}>
                      {money(r.result)}
                    </span>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Gasto por cartão" icon={CreditCard} />
            <Table
              loading={byCard.isLoading}
              rows={byCard.data?.data}
              empty={<EmptyState title="Nenhum cartão com movimento" />}
              columns={[
                {
                  key: 'name',
                  header: 'Cartão',
                  render: (r) => (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                      <span className="text-sm text-ink truncate">{r.name}</span>
                    </span>
                  ),
                },
                { key: 'tx_count', header: 'Compras', align: 'center', width: 90 },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  width: 130,
                  render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.total)}</span>,
                },
              ]}
            />
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader title="Gasto por forma de pagamento" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DonutChart
                data={(byMethod.data?.data ?? []).map((m) => ({
                  name: PAYMENT_METHODS[m.method] ?? 'Não informado',
                  total: m.total,
                }))}
                centerLabel="Total"
                centerValue={byMethod.data?.total}
              />
              <Table
                rows={byMethod.data?.data}
                rowKey={(r) => r.method}
                empty={<EmptyState title="Sem dados" />}
                columns={[
                  {
                    key: 'method',
                    header: 'Forma',
                    render: (r) => (
                      <span className="text-sm text-ink">{PAYMENT_METHODS[r.method] ?? 'Não informado'}</span>
                    ),
                  },
                  { key: 'tx_count', header: 'Qtd.', align: 'center', width: 70 },
                  {
                    key: 'total',
                    header: 'Total',
                    align: 'right',
                    width: 120,
                    render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.total)}</span>,
                  },
                  {
                    key: 'share_pct',
                    header: '%',
                    align: 'right',
                    width: 70,
                    render: (r) => <span className="text-sm text-muted">{percent(r.share_pct)}</span>,
                  },
                ]}
              />
            </div>
          </Card>
        </div>
      )}

      {/* ---------- Comparativo ---------- */}
      {tab === 'comparativo' && (
        <>
          <Card>
            <CardHeader title="Comparativo mensal" subtitle="Últimos 12 meses" />
            <IncomeExpenseChart data={comparison.data?.data ?? []} height={300} />
          </Card>

          <Card>
            <CardHeader
              title="Mês a mês"
              subtitle={`Média de despesas: ${money(comparison.data?.averages?.expense)}`}
            />
            <Table
              loading={comparison.isLoading}
              rows={comparison.data?.data}
              rowKey={(r) => r.month}
              empty={<EmptyState title="Sem dados" />}
              columns={[
                { key: 'label', header: 'Mês', render: (r) => <span className="text-sm text-ink">{r.label}</span> },
                {
                  key: 'income',
                  header: 'Receitas',
                  align: 'right',
                  width: 130,
                  render: (r) => <span className="text-positive tabular-nums">{money(r.income)}</span>,
                },
                {
                  key: 'expense',
                  header: 'Despesas',
                  align: 'right',
                  width: 130,
                  render: (r) => <span className="text-negative tabular-nums">{money(r.expense)}</span>,
                },
                {
                  key: 'result',
                  header: 'Resultado',
                  align: 'right',
                  width: 130,
                  render: (r) => (
                    <span className={cx('font-medium tabular-nums', r.result >= 0 ? 'text-positive' : 'text-negative')}>
                      {money(r.result)}
                    </span>
                  ),
                },
                {
                  key: 'vs_average_pct',
                  header: 'vs. média',
                  align: 'right',
                  width: 110,
                  render: (r) => (
                    <Badge tone={r.vs_average_pct > 10 ? 'negative' : r.vs_average_pct < -10 ? 'positive' : 'neutral'}>
                      {r.vs_average_pct > 0 ? '+' : ''}
                      {percent(r.vs_average_pct)}
                    </Badge>
                  ),
                },
                {
                  key: 'savings_rate',
                  header: 'Economia',
                  align: 'right',
                  width: 100,
                  render: (r) => <span className="text-sm text-muted">{percent(r.savings_rate)}</span>,
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
