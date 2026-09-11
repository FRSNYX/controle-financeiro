import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { useTheme } from '../../context/AppProviders';
import { money, moneyShort, percent, CHART_COLORS, OTHER_COLOR, SERIES_COLORS, CHART_INK } from '../../lib/format';
import { EmptyState } from '../ui';

/** Tokens do gráfico conforme o tema ativo. */
function useChartTheme() {
  const { isDark } = useTheme();
  const mode = isDark ? 'dark' : 'light';
  return useMemo(
    () => ({
      mode,
      ink: CHART_INK[mode],
      series: SERIES_COLORS[mode],
      palette: CHART_COLORS[mode],
      other: OTHER_COLOR[mode],
    }),
    [mode],
  );
}

/**
 * Acima de 8 fatias nada é inventado: as menores viram uma fatia "Outras"
 * em cinza neutro. Cor de série é identidade, não sobra de paleta.
 */
export function foldToOther(items, { max = 7, valueKey = 'total', nameKey = 'name', otherColor }) {
  if (items.length <= max + 1) return items;
  const sorted = [...items].sort((a, b) => b[valueKey] - a[valueKey]);
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  return [
    ...head,
    {
      [nameKey]: `Outras (${tail.length})`,
      [valueKey]: tail.reduce((s, i) => s + i[valueKey], 0),
      color: otherColor,
      isOther: true,
    },
  ];
}

// ==============================================================
// Dica flutuante
// ==============================================================
function MoneyTooltip({ active, payload, label, showTotal }) {
  if (!active || !payload?.length) return null;

  const visible = payload.filter((p) => p.value !== null && p.value !== undefined);
  const total = visible.reduce((s, p) => s + (Number(p.value) || 0), 0);

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-xl text-xs min-w-[170px]">
      {label && <p className="font-medium text-ink mb-1.5">{label}</p>}
      {visible.map((entry) => (
        <div key={entry.dataKey ?? entry.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: entry.color ?? entry.payload?.color }} />
            {entry.name}
          </span>
          {/* Valor em tinta de texto — a cor de série já está no marcador. */}
          <span className="font-medium text-ink tabular-nums">{money(entry.value)}</span>
        </div>
      ))}
      {showTotal && visible.length > 1 && (
        <div className="flex items-center justify-between gap-4 pt-1.5 mt-1 border-t border-line">
          <span className="text-muted">Total</span>
          <span className="font-semibold text-ink tabular-nums">{money(total)}</span>
        </div>
      )}
    </div>
  );
}

function ShareTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const data = item.payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-xl text-xs">
      <p className="flex items-center gap-1.5 font-medium text-ink mb-1">
        <span className="h-2 w-2 rounded-sm" style={{ background: data.color }} />
        {data.name}
      </p>
      <p className="text-ink font-medium tabular-nums">{money(item.value)}</p>
      {data.share_pct !== undefined && <p className="text-muted">{percent(data.share_pct)} do total</p>}
    </div>
  );
}

/** Legenda própria — a do Recharts não segue os tokens de texto. */
function ChartLegend({ items, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 justify-center ${className}`}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const AXIS_PROPS = (ink) => ({
  tick: { fill: ink.label, fontSize: 11 },
  axisLine: { stroke: ink.axis },
  tickLine: false,
});

function NoData({ message = 'Sem dados no período selecionado' }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

// ==============================================================
// Receitas x Despesas (barras agrupadas)
// ==============================================================
export function IncomeExpenseChart({ data, height = 280 }) {
  const t = useChartTheme();
  if (!data?.length) return <div style={{ height }}><NoData /></div>;

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={t.ink.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" {...AXIS_PROPS(t.ink)} />
            <YAxis {...AXIS_PROPS(t.ink)} tickFormatter={moneyShort} width={70} />
            <Tooltip content={<MoneyTooltip />} cursor={{ fill: t.ink.grid, opacity: 0.35 }} />
            {/* radius nas pontas: 4px arredondado, ancorado na linha de base */}
            <Bar dataKey="income" name="Receitas" fill={t.series.income} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="expense" name="Despesas" fill={t.series.expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        className="mt-2"
        items={[
          { label: 'Receitas', color: t.series.income },
          { label: 'Despesas', color: t.series.expense },
        ]}
      />
    </div>
  );
}

// ==============================================================
// Evolução do saldo (área)
// ==============================================================
export function BalanceEvolutionChart({
  data, dataKey = 'balance', label = 'Saldo', height = 260, colorKey = 'balance',
}) {
  const t = useChartTheme();
  if (!data?.length) return <div style={{ height }}><NoData /></div>;

  const stroke = t.series[colorKey] ?? t.series.balance;
  const gradientId = `grad-${dataKey}-${t.mode}`;
  // Só faz sentido marcar o zero quando a série realmente cruza o eixo.
  const hasNegative = data.some((d) => (d[dataKey] ?? 0) < 0);

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={t.ink.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" {...AXIS_PROPS(t.ink)} />
            <YAxis {...AXIS_PROPS(t.ink)} tickFormatter={moneyShort} width={70} />
            <Tooltip content={<MoneyTooltip />} cursor={{ stroke: t.ink.axis, strokeWidth: 1 }} />
            {hasNegative && <ReferenceLine y={0} stroke={t.ink.axis} strokeWidth={1} />}
            <Area
              type="monotone"
              dataKey={dataKey}
              name={label}
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: t.ink.surface }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* Série única: o título do cartão já a nomeia, dispensa caixa de legenda. */}
    </div>
  );
}

// ==============================================================
// Evolução do patrimônio (linhas, escala única)
// ==============================================================
export function NetWorthChart({ data, height = 300 }) {
  const t = useChartTheme();
  if (!data?.length) return <div style={{ height }}><NoData /></div>;

  // Todas as séries são em R$ — uma escala só. Eixo duplo nunca.
  const series = [
    { key: 'cash', label: 'Contas', color: t.palette[0] },
    { key: 'investments', label: 'Investimentos', color: t.palette[1] },
    { key: 'physical_assets', label: 'Bens', color: t.palette[2] },
    { key: 'net_worth', label: 'Patrimônio total', color: t.palette[6] },
  ].filter((s) => data.some((d) => (d[s.key] ?? 0) !== 0));

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.ink.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" {...AXIS_PROPS(t.ink)} />
            <YAxis {...AXIS_PROPS(t.ink)} tickFormatter={moneyShort} width={70} />
            <Tooltip content={<MoneyTooltip />} cursor={{ stroke: t.ink.axis, strokeWidth: 1 }} />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={s.key === 'net_worth' ? 2.5 : 2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: t.ink.surface }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend className="mt-2" items={series.map((s) => ({ label: s.label, color: s.color }))} />
    </div>
  );
}

// ==============================================================
// Composição (rosca) — categorias, carteira, alocação
// ==============================================================
export function DonutChart({ data, height = 280, nameKey = 'name', valueKey = 'total', centerLabel, centerValue }) {
  const t = useChartTheme();

  const folded = useMemo(() => {
    if (!data?.length) return [];
    const items = foldToOther(
      data.filter((d) => d[valueKey] > 0),
      { max: 7, valueKey, nameKey, otherColor: t.other },
    );
    const total = items.reduce((s, i) => s + i[valueKey], 0);
    // A cor vem da entidade; a paleta só entra quando a entidade não define uma.
    return items.map((item, i) => ({
      name: item[nameKey],
      value: item[valueKey],
      color: item.color ?? t.palette[i % t.palette.length],
      share_pct: total > 0 ? (item[valueKey] / total) * 100 : 0,
      isOther: item.isOther,
    }));
  }, [data, nameKey, valueKey, t]);

  if (!folded.length) return <div style={{ height }}><NoData /></div>;

  return (
    <div>
      <div style={{ height }} className="relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={folded}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="85%"
              paddingAngle={2}
              stroke="none"
            >
              {folded.map((entry) => (
                // Anel de 2px na cor da superfície separa fatias vizinhas.
                <Cell key={entry.name} fill={entry.color} stroke={t.ink.surface} strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip content={<ShareTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {centerValue !== undefined && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xs text-muted">{centerLabel}</span>
            <span className="text-lg font-semibold text-ink">{money(centerValue)}</span>
          </div>
        )}
      </div>

      {/* Rótulos diretos com valor: atende a regra de alívio para tons de baixo contraste. */}
      <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
        {folded.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 min-w-0 text-muted">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: entry.color }} />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-ink font-medium tabular-nums">{money(entry.value)}</span>
              <span className="text-muted tabular-nums w-12 text-right">{percent(entry.share_pct)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==============================================================
// Barras horizontais — ranking de categorias
// ==============================================================
export function CategoryBarChart({ data, height = 300, valueKey = 'total' }) {
  const t = useChartTheme();

  const rows = useMemo(() => {
    if (!data?.length) return [];
    return foldToOther(data.filter((d) => d[valueKey] > 0), { max: 9, valueKey, otherColor: t.other })
      .sort((a, b) => b[valueKey] - a[valueKey]);
  }, [data, valueKey, t]);

  if (!rows.length) return <div style={{ height }}><NoData /></div>;

  const max = rows[0][valueKey];

  // Barras em HTML: mais legível que um gráfico e já traz o rótulo direto.
  return (
    <div className="space-y-2.5" style={{ maxHeight: height, overflowY: 'auto' }}>
      {rows.map((row, i) => (
        <div key={row.name}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="flex items-center gap-2 min-w-0 text-xs text-muted">
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ background: row.color ?? t.palette[i % t.palette.length] }}
              />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="text-xs font-medium text-ink tabular-nums shrink-0">{money(row[valueKey])}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${(row[valueKey] / max) * 100}%`,
                background: row.color ?? t.palette[i % t.palette.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ==============================================================
// Resultado mensal (barras com sinal)
// ==============================================================
export function ResultChart({ data, height = 240 }) {
  const t = useChartTheme();
  if (!data?.length) return <div style={{ height }}><NoData /></div>;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={t.ink.grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...AXIS_PROPS(t.ink)} />
          <YAxis {...AXIS_PROPS(t.ink)} tickFormatter={moneyShort} width={70} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: t.ink.grid, opacity: 0.35 }} />
          <ReferenceLine y={0} stroke={t.ink.axis} strokeWidth={1} />
          <Bar dataKey="result" name="Resultado" radius={[4, 4, 0, 0]} maxBarSize={30}>
            {data.map((entry, i) => (
              // Sobra x falta é polaridade, não identidade: par divergente.
              <Cell key={i} fill={entry.result >= 0 ? t.palette[0] : t.palette[7]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ==============================================================
// Projeção de patrimônio
// ==============================================================
export function ProjectionChart({ scenarios, currentValue, height = 240 }) {
  const t = useChartTheme();
  if (!scenarios?.length) return <div style={{ height }}><NoData /></div>;

  const data = [
    { label: 'Hoje', total: currentValue, contributed: 0, interest: 0 },
    ...scenarios.map((s) => ({
      label: `${s.years} ${s.years === 1 ? 'ano' : 'anos'}`,
      base: currentValue,
      contributed: s.contributed_total,
      interest: Math.max(0, s.interest_earned),
      total: s.future_value,
    })),
  ];

  const stack = [
    { key: 'base', label: 'Patrimônio atual', color: t.palette[0] },
    { key: 'contributed', label: 'Aportes previstos', color: t.palette[1] },
    { key: 'interest', label: 'Juros acumulados', color: t.palette[2] },
  ];

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.ink.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" {...AXIS_PROPS(t.ink)} />
            <YAxis {...AXIS_PROPS(t.ink)} tickFormatter={moneyShort} width={70} />
            <Tooltip content={<MoneyTooltip showTotal />} cursor={{ fill: t.ink.grid, opacity: 0.35 }} />
            {stack.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="proj"
                fill={s.color}
                maxBarSize={56}
                // Só o topo da pilha recebe canto arredondado.
                radius={i === stack.length - 1 ? [4, 4, 0, 0] : 0}
                stroke={t.ink.surface}
                strokeWidth={1}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend className="mt-2" items={stack.map((s) => ({ label: s.label, color: s.color }))} />
    </div>
  );
}

export { useChartTheme, ChartLegend, MoneyTooltip };
