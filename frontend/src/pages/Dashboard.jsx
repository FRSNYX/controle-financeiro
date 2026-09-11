import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Wallet, TrendingUp, TrendingDown, Scale, LineChart, Gem, ArrowDownCircle,
  ArrowUpCircle, AlertTriangle, PiggyBank, ArrowRight, CalendarClock, Activity,
} from 'lucide-react';
import { api } from '../lib/api';
import { usePeriod } from '../context/AppProviders';
import {
  Card, CardHeader, Stat, Badge, PageHeader, ProgressBar, EmptyState, ErrorState, cx,
} from '../components/ui';
import {
  IncomeExpenseChart, BalanceEvolutionChart, DonutChart, CategoryBarChart, ResultChart,
} from '../components/charts';
import { money, percent, date as fmtDate, relativeDays, STATUS_STYLES } from '../lib/format';

function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton h-24 rounded-xl" />
      ))}
    </div>
  );
}

/** Linha compacta de lançamento — usada em "últimas" e "próximos vencimentos". */
function TransactionRow({ tx, showRelative }) {
  const isIncome = tx.kind === 'income';
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-line/50 last:border-0">
      <div
        className={cx(
          'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
          isIncome ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative',
        )}
      >
        {isIncome ? <ArrowUpCircle size={16} /> : <ArrowDownCircle size={16} />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink truncate">{tx.description}</p>
        <p className="text-xs text-muted truncate">
          {tx.category_name ?? 'Sem categoria'}
          {tx.installment_label && ` · ${tx.installment_label}`}
          {' · '}
          {showRelative ? relativeDays(tx.due_date) : fmtDate(tx.due_date)}
        </p>
      </div>

      <div className="text-right shrink-0">
        <p className={cx('text-sm font-medium tabular-nums', isIncome ? 'text-positive' : 'text-negative')}>
          {isIncome ? '+' : '−'}
          {money(tx.amount)}
        </p>
        <span className={cx('text-[10px] px-1.5 py-0.5 rounded', STATUS_STYLES[tx.status_label])}>
          {tx.status_label}
        </span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { range, label, mode, month } = usePeriod();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', range.from, range.to],
    queryFn: () =>
      api.get('/dashboard', {
        ...(mode === 'month' ? { month } : { from: range.from, to: range.to }),
        evolutionMonths: 12,
      }),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const c = data?.cards;
  const charts = data?.charts;
  const lists = data?.lists;
  const comparison = data?.comparison;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle={`Visão geral de ${label.toLowerCase()}`}
      />

      {isLoading ? (
        <StatSkeleton />
      ) : (
        <>
          {/* ---------- Indicadores principais ---------- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat
              label="Saldo atual"
              value={money(c.total_balance)}
              tone={c.total_balance >= 0 ? 'neutral' : 'negative'}
              icon={Wallet}
              hint="Soma das contas"
            />
            <Stat
              label="Receitas"
              value={money(c.income_total)}
              tone="positive"
              icon={TrendingUp}
              trend={comparison?.income_change}
              hint={`${money(c.income_received)} recebido`}
            />
            <Stat
              label="Despesas"
              value={money(c.expense_total)}
              tone="negative"
              icon={TrendingDown}
              trend={comparison?.expense_change ? -comparison.expense_change : undefined}
              hint={`${money(c.expense_paid)} pago`}
            />
            <Stat
              label="Resultado do mês"
              value={money(c.result)}
              tone={c.result >= 0 ? 'positive' : 'negative'}
              icon={Scale}
              hint={c.income_total > 0 ? `${percent(c.savings_rate)} de economia` : 'Sem receitas'}
            />
          </div>

          {/* ---------- Indicadores secundários ---------- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat
              label="Investido"
              value={money(c.invested_total)}
              tone="brand"
              icon={LineChart}
              hint={
                c.invested_amount > 0
                  ? `${c.investment_profit >= 0 ? '+' : ''}${money(c.investment_profit)} de retorno`
                  : 'Nenhum investimento'
              }
            />
            <Stat
              label="Patrimônio líquido"
              value={money(c.net_worth_liquid)}
              tone="brand"
              icon={Gem}
              hint={c.liabilities_total > 0 ? `${money(c.liabilities_total)} em dívidas` : 'Sem dívidas'}
            />
            <Stat
              label="Contas a pagar"
              value={money(c.payable)}
              tone={c.overdue_payable > 0 ? 'negative' : 'warning'}
              icon={ArrowDownCircle}
              hint={c.overdue_payable > 0 ? `${money(c.overdue_payable)} atrasado` : 'Nada atrasado'}
            />
            <Stat
              label="Contas a receber"
              value={money(c.receivable)}
              tone="info"
              icon={ArrowUpCircle}
              hint={c.overdue_receivable > 0 ? `${money(c.overdue_receivable)} atrasado` : 'Nada atrasado'}
            />
          </div>

          {/* ---------- Alertas de orçamento ---------- */}
          {lists?.budget_alerts?.length > 0 && (
            <Card className="border-warn/40 bg-warn/5">
              <CardHeader
                title="Atenção ao orçamento"
                subtitle={`${lists.budget_alerts.length} categoria(s) acima de 80% do limite`}
                icon={AlertTriangle}
                action={
                  <Link to="/orcamento" className="text-xs text-brand hover:underline flex items-center gap-1">
                    Ver orçamento <ArrowRight size={12} />
                  </Link>
                }
              />
              <div className="space-y-3">
                {lists.budget_alerts.slice(0, 4).map((b) => (
                  <div key={b.id}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="flex items-center gap-2 text-sm text-ink min-w-0">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: b.category_color }} />
                        <span className="truncate">{b.category_name}</span>
                      </span>
                      <span className="text-xs shrink-0">
                        <span className="text-ink font-medium">{money(b.spent)}</span>
                        <span className="text-muted"> / {money(b.limit_amount)}</span>
                      </span>
                    </div>
                    <ProgressBar value={b.percent_used} height={6} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ---------- Gráficos principais ---------- */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Receitas x Despesas"
                subtitle="Últimos 12 meses"
                icon={Activity}
              />
              <IncomeExpenseChart data={charts.monthly} />
            </Card>

            <Card>
              <CardHeader title="Gastos por categoria" subtitle={label} />
              {charts.expenses_by_category?.length ? (
                <DonutChart
                  data={charts.expenses_by_category}
                  centerLabel="Total"
                  centerValue={c.expense_total}
                />
              ) : (
                <EmptyState title="Sem despesas no período" message="Lance uma despesa para ver a distribuição." />
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Evolução do saldo" subtitle="Saldo acumulado das contas" />
              <BalanceEvolutionChart data={charts.monthly} dataKey="balance" label="Saldo" />
            </Card>

            <Card>
              <CardHeader title="Evolução do patrimônio" subtitle="Contas + investimentos" />
              <BalanceEvolutionChart
                data={charts.monthly}
                dataKey="net_worth"
                label="Patrimônio"
                colorKey="networth"
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Resultado mensal" subtitle="Quanto sobrou (ou faltou) em cada mês" />
              <ResultChart data={charts.monthly} />
            </Card>

            <Card>
              <CardHeader title="Ranking de gastos" subtitle={`Categorias em ${label.toLowerCase()}`} />
              {charts.expenses_by_category?.length ? (
                <CategoryBarChart data={charts.expenses_by_category} />
              ) : (
                <EmptyState title="Sem despesas no período" />
              )}
            </Card>
          </div>

          {/* ---------- Listas ---------- */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <CardHeader
                title="Próximos vencimentos"
                subtitle="Próximos 30 dias"
                icon={CalendarClock}
                action={
                  <Link to="/calendario" className="text-xs text-brand hover:underline flex items-center gap-1">
                    Calendário <ArrowRight size={12} />
                  </Link>
                }
              />
              {lists?.upcoming?.length ? (
                <div>
                  {lists.upcoming.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} showRelative />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={PiggyBank}
                  title="Nenhum vencimento à vista"
                  message="Você está em dia para os próximos 30 dias."
                />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Últimas movimentações"
                subtitle="Lançamentos mais recentes"
                action={
                  <Link to="/historico" className="text-xs text-brand hover:underline flex items-center gap-1">
                    Histórico <ArrowRight size={12} />
                  </Link>
                }
              />
              {lists?.recent?.length ? (
                <div>
                  {lists.recent.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Nenhum lançamento ainda"
                  message="Comece cadastrando uma receita ou despesa."
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
