import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, CalendarDays, TrendingUp, TrendingDown,
  CreditCard, LineChart, ArrowLeftRight, AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api';
import { usePeriod } from '../context/AppProviders';
import {
  Card, CardHeader, Button, Modal, PageHeader, EmptyState, ErrorState,
  Stat, Badge, cx,
} from '../components/ui';
import { money, monthName, monthKey, addMonthKey, todayISO, date as fmtDate } from '../lib/format';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const TYPE_META = {
  income: { label: 'Receitas', icon: TrendingUp, tone: 'positive' },
  expense: { label: 'Despesas', icon: TrendingDown, tone: 'negative' },
  invoice: { label: 'Faturas', icon: CreditCard, tone: 'warning' },
  investment: { label: 'Investimentos', icon: LineChart, tone: 'brand' },
  transfer: { label: 'Transferências', icon: ArrowLeftRight, tone: 'info' },
};

/** Monta a grade do mês incluindo os dias vizinhos que completam as semanas. */
function buildGrid(ym) {
  const [year, month] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = first.getUTCDay();

  const cells = [];

  // Dias do mês anterior para alinhar a primeira semana.
  const prevDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevDays - i;
    const prev = addMonthKey(ym, -1);
    cells.push({ date: `${prev}-${String(d).padStart(2, '0')}`, day: d, outside: true });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: `${ym}-${String(d).padStart(2, '0')}`, day: d, outside: false });
  }

  // Completa a última semana.
  const next = addMonthKey(ym, 1);
  let d = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ date: `${next}-${String(d).padStart(2, '0')}`, day: d, outside: true });
    d++;
  }

  return cells;
}

function DayModal({ date, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['calendar-day', date],
    queryFn: () => api.get(`/calendar/day/${date}`),
    enabled: !!date,
  });

  return (
    <Modal open={!!date} onClose={onClose} title={date ? fmtDate(date) : ''} subtitle="Movimentações do dia" size="md">
      {isLoading ? (
        <div className="skeleton h-40 rounded-xl" />
      ) : !data?.data?.length ? (
        <EmptyState icon={CalendarDays} title="Nenhuma movimentação" message="Não há lançamentos nesta data." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Entradas" value={money(data.summary.income)} tone="positive" />
            <Stat label="Saídas" value={money(data.summary.expense)} tone="negative" />
          </div>

          <div className="space-y-1">
            {data.data.map((event) => {
              const meta = TYPE_META[event.type] ?? TYPE_META.expense;
              const Icon = meta.icon;
              return (
                <div key={event.id} className="flex items-center gap-3 py-2.5 border-b border-line/50 last:border-0">
                  <div
                    className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${event.color}1f`, color: event.color }}
                  >
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink truncate">{event.title}</p>
                    <p className="text-xs text-muted truncate">
                      {[event.meta?.category, event.meta?.account, event.meta?.card, event.meta?.installment]
                        .filter(Boolean)
                        .join(' · ') || meta.label}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cx(
                        'text-sm font-medium tabular-nums',
                        event.type === 'income' ? 'text-positive' : event.type === 'transfer' ? 'text-ink' : 'text-negative',
                      )}
                    >
                      {money(event.amount)}
                    </p>
                    <Badge tone={event.is_overdue ? 'negative' : 'neutral'}>{event.status_label}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Calendar() {
  const { month: periodMonth, mode, setMonth } = usePeriod();
  const [localMonth, setLocalMonth] = useState(mode === 'month' ? periodMonth : monthKey(todayISO()));
  const [selectedDay, setSelectedDay] = useState(null);
  const [activeTypes, setActiveTypes] = useState(Object.keys(TYPE_META));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['calendar', localMonth, activeTypes],
    queryFn: () => api.get('/calendar', { month: localMonth, types: activeTypes.join(',') }),
  });

  const byDate = useMemo(() => {
    const map = new Map();
    for (const day of data?.days ?? []) map.set(day.date, day);
    return map;
  }, [data]);

  const grid = useMemo(() => buildGrid(localMonth), [localMonth]);
  const today = todayISO();

  const toggleType = (type) =>
    setActiveTypes((types) =>
      types.includes(type) ? types.filter((t) => t !== type) : [...types, type],
    );

  const changeMonth = (offset) => {
    const next = addMonthKey(localMonth, offset);
    setLocalMonth(next);
    setMonth(next); // mantém o período global em sincronia
  };

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendário financeiro"
        subtitle="Receitas, despesas, faturas e investimentos por data"
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => changeMonth(-1)} aria-label="Mês anterior">
              <ChevronLeft size={16} />
            </Button>
            <span className="px-3 text-sm font-medium text-ink min-w-[150px] text-center">
              {monthName(localMonth)}
            </span>
            <Button variant="outline" size="icon" onClick={() => changeMonth(1)} aria-label="Próximo mês">
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Entradas previstas" value={money(data?.summary?.income_total)} tone="positive" icon={TrendingUp} />
        <Stat label="Saídas previstas" value={money(data?.summary?.expense_total)} tone="negative" icon={TrendingDown} />
        <Stat
          label="Resultado do mês"
          value={money((data?.summary?.income_total ?? 0) - (data?.summary?.expense_total ?? 0))}
          tone={(data?.summary?.income_total ?? 0) >= (data?.summary?.expense_total ?? 0) ? 'positive' : 'negative'}
        />
        <Stat
          label="Dias com atraso"
          value={data?.summary?.overdue_days ?? 0}
          tone={(data?.summary?.overdue_days ?? 0) > 0 ? 'negative' : 'neutral'}
          icon={AlertTriangle}
        />
      </div>

      {/* Filtros por tipo de evento. */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(TYPE_META).map(([type, meta]) => {
          const active = activeTypes.includes(type);
          const Icon = meta.icon;
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={cx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                active
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-line text-muted hover:text-ink hover:bg-surface-2',
              )}
            >
              <Icon size={13} />
              {meta.label}
            </button>
          );
        })}
      </div>

      <Card className="p-2 sm:p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((day) => (
            <div key={day} className="text-center text-[11px] font-medium text-muted uppercase py-1.5">
              {day}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="skeleton h-20 sm:h-24 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell) => {
              const day = byDate.get(cell.date);
              const isToday = cell.date === today;
              const hasEvents = !!day?.count;

              return (
                <button
                  key={cell.date}
                  onClick={() => hasEvents && setSelectedDay(cell.date)}
                  disabled={!hasEvents}
                  className={cx(
                    'h-20 sm:h-24 rounded-lg border p-1.5 flex flex-col text-left transition-colors',
                    cell.outside ? 'opacity-35' : '',
                    isToday ? 'border-brand bg-brand/5' : 'border-line',
                    hasEvents ? 'hover:border-brand hover:bg-surface-2 cursor-pointer' : 'cursor-default',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cx(
                        'text-xs font-medium',
                        isToday ? 'text-brand' : 'text-ink',
                      )}
                    >
                      {cell.day}
                    </span>
                    {day?.has_overdue && <span className="h-1.5 w-1.5 rounded-full bg-negative shrink-0" />}
                  </div>

                  {hasEvents && (
                    <div className="mt-auto space-y-0.5 w-full overflow-hidden">
                      {day.income > 0 && (
                        <p className="text-[10px] sm:text-[11px] text-positive font-medium truncate tabular-nums">
                          +{money(day.income)}
                        </p>
                      )}
                      {day.expense > 0 && (
                        <p className="text-[10px] sm:text-[11px] text-negative font-medium truncate tabular-nums">
                          −{money(day.expense)}
                        </p>
                      )}
                      <p className="text-[10px] text-muted">
                        {day.count} {day.count === 1 ? 'item' : 'itens'}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <DayModal date={selectedDay} onClose={() => setSelectedDay(null)} />
    </div>
  );
}
