import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, PiggyBank, AlertTriangle, CheckCircle2, Copy, Trash2, Pencil, TrendingDown } from 'lucide-react';
import { api } from '../lib/api';
import { usePeriod } from '../context/AppProviders';
import {
  Card, CardHeader, Button, Select, Field, MoneyInput, Modal, PageHeader,
  ConfirmDialog, EmptyState, ErrorState, Stat, Badge, ProgressBar, Input, cx,
} from '../components/ui';
import { useCategories, useApiMutation } from '../hooks/useLookups';
import { money, percent, monthName, monthKey, addMonthKey, todayISO } from '../lib/format';

const ALERT_TONES = { ok: 'positive', warning: 'warning', critical: 'danger', exceeded: 'danger' };

function BudgetForm({ open, onClose, month, budget, onSaved }) {
  const isEdit = !!budget?.id;
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? '');
  const [limit, setLimit] = useState(budget?.limit_amount ?? 0);

  const { data: categoriesData } = useCategories('expense');
  const parents = (categoriesData?.data ?? []).filter((c) => !c.parent_id);

  const mutation = useApiMutation({
    mutationFn: () =>
      api.put('/budgets', {
        month,
        category_id: categoryId || null,
        limit_amount: limit / 100,
      }),
    invalidate: ['budgets'],
    successMessage: 'Orçamento definido',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar limite' : 'Novo limite de orçamento'}
      subtitle={monthName(month)}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={mutation.isPending} disabled={limit <= 0} onClick={() => mutation.mutate()}>
            Salvar limite
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Categoria" hint="Deixe em branco para o orçamento geral do mês">
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="Orçamento geral (todas as despesas)"
            disabled={isEdit}
            options={parents.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>

        <Field label="Limite mensal" required>
          <MoneyInput value={limit} onChange={setLimit} autoFocus />
        </Field>

        <p className="text-xs text-muted">
          Você receberá alertas ao atingir 80%, 90% e 100% do limite.
        </p>
      </div>
    </Modal>
  );
}

export default function Budgets() {
  const { month: periodMonth, mode } = usePeriod();
  // Orçamento é sempre mensal: períodos customizados caem no mês corrente.
  const month = mode === 'month' ? periodMonth : monthKey(todayISO());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [copyOpen, setCopyOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['budgets', month],
    queryFn: () => api.get('/budgets', { month }),
  });

  const deleteMutation = useApiMutation({
    mutationFn: (id) => api.del(`/budgets/${id}`),
    invalidate: ['budgets'],
    successMessage: 'Limite removido',
    onSuccess: () => setDeleting(null),
  });

  const copyMutation = useApiMutation({
    mutationFn: (from) => api.post('/budgets/copy', { from, to: month }),
    invalidate: ['budgets'],
    successMessage: (r) => r.message,
    onSuccess: () => setCopyOpen(false),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const budgets = data?.data ?? [];
  const summary = data?.summary;
  const general = data?.general;
  const generalPct = general?.limit_amount > 0 ? (general.spent / general.limit_amount) * 100 : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orçamento"
        subtitle={`Limites de gasto para ${monthName(month).toLowerCase()}`}
        actions={
          <>
            <Button variant="outline" icon={Copy} onClick={() => setCopyOpen(true)}>
              Copiar de outro mês
            </Button>
            <Button
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Novo limite
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Limite total" value={money(summary?.limit_total)} icon={PiggyBank} hint={`${summary?.categories_count ?? 0} categoria(s)`} />
        <Stat label="Gasto no mês" value={money(summary?.spent_total)} tone="negative" icon={TrendingDown} />
        <Stat
          label="Disponível"
          value={money(summary?.remaining_total)}
          tone={(summary?.remaining_total ?? 0) >= 0 ? 'positive' : 'negative'}
          hint={percent(summary?.percent_used ?? 0) + ' usado'}
        />
        <Stat
          label="Categorias em alerta"
          value={summary?.alerts ?? 0}
          tone={(summary?.alerts ?? 0) > 0 ? 'warning' : 'positive'}
          icon={(summary?.alerts ?? 0) > 0 ? AlertTriangle : CheckCircle2}
          hint="Acima de 80%"
        />
      </div>

      {/* ---------- Orçamento geral ---------- */}
      <Card>
        <CardHeader
          title="Orçamento geral do mês"
          subtitle="Teto de gasto somando todas as categorias"
          icon={PiggyBank}
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Pencil}
              onClick={() => {
                setEditing({ id: general?.id, category_id: null, limit_amount: general?.limit_amount ?? 0 });
                setFormOpen(true);
              }}
            >
              {general?.limit_amount > 0 ? 'Editar' : 'Definir'}
            </Button>
          }
        />

        {general?.limit_amount > 0 ? (
          <>
            <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
              <div>
                <p className="text-2xl font-semibold text-ink">{money(general.spent)}</p>
                <p className="text-xs text-muted">de {money(general.limit_amount)} definidos</p>
              </div>
              <div className="text-right">
                <p className={cx('text-lg font-semibold', general.remaining >= 0 ? 'text-positive' : 'text-negative')}>
                  {money(Math.abs(general.remaining))}
                </p>
                <p className="text-xs text-muted">{general.remaining >= 0 ? 'ainda disponível' : 'acima do limite'}</p>
              </div>
            </div>
            <ProgressBar value={generalPct} height={10} />
            <div className="flex items-center gap-2 mt-3">
              <Badge tone={ALERT_TONES[general.alert.level] === 'danger' ? 'negative' : ALERT_TONES[general.alert.level]} dot>
                {general.alert.label}
              </Badge>
              <span className="text-xs text-muted">{percent(generalPct)} do limite usado</span>
            </div>
          </>
        ) : (
          <EmptyState
            icon={PiggyBank}
            title="Sem orçamento geral definido"
            message={`Você já gastou ${money(general?.spent ?? 0)} neste mês. Defina um teto para acompanhar.`}
          />
        )}
      </Card>

      {/* ---------- Limites por categoria ---------- */}
      <Card>
        <CardHeader title="Limites por categoria" subtitle="Acompanhe o consumo de cada categoria" />

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-16 rounded-lg" />
            ))}
          </div>
        ) : budgets.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="Nenhum limite por categoria"
            message="Defina quanto quer gastar em alimentação, transporte, lazer e outras categorias."
            action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Definir primeiro limite</Button>}
          />
        ) : (
          <div className="space-y-4">
            {budgets.map((b) => (
              <div key={b.id} className="group">
                <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: b.category_color }} />
                    <span className="text-sm font-medium text-ink truncate">{b.category_name}</span>
                    {b.alert.level !== 'ok' && (
                      <Badge tone={b.alert.level === 'warning' ? 'warning' : 'negative'}>{b.alert.label}</Badge>
                    )}
                  </span>

                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-sm">
                      <span className="text-ink font-medium tabular-nums">{money(b.spent)}</span>
                      <span className="text-muted"> / {money(b.limit_amount)}</span>
                    </span>
                    <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setEditing(b);
                          setFormOpen(true);
                        }}
                        className="p-1 rounded text-muted hover:text-ink"
                        aria-label="Editar limite"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setDeleting(b)}
                        className="p-1 rounded text-muted hover:text-negative"
                        aria-label="Remover limite"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </span>
                </div>

                <ProgressBar value={b.percent_used} height={8} />

                <div className="flex justify-between mt-1 text-xs text-muted">
                  <span>{percent(b.percent_used)} usado</span>
                  <span className={b.remaining < 0 ? 'text-negative' : undefined}>
                    {b.remaining >= 0 ? `${money(b.remaining)} restante` : `${money(-b.remaining)} acima`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BudgetForm
        key={editing?.id ?? editing?.category_id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        month={month}
        budget={editing}
        onSaved={refetch}
      />

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Copiar orçamento"
        subtitle={`Os limites serão aplicados em ${monthName(month)}`}
        size="sm"
        footer={<Button variant="ghost" onClick={() => setCopyOpen(false)}>Fechar</Button>}
      >
        <p className="text-sm text-muted mb-3">Escolha o mês de origem:</p>
        <div className="space-y-1.5">
          {[1, 2, 3].map((offset) => {
            const from = addMonthKey(month, -offset);
            return (
              <button
                key={from}
                onClick={() => copyMutation.mutate(from)}
                disabled={copyMutation.isPending}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-line hover:border-brand hover:bg-surface-2 text-left disabled:opacity-50"
              >
                <span className="text-sm text-ink">{monthName(from)}</span>
                <Copy size={14} className="text-muted" />
              </button>
            );
          })}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Remover limite"
        message={`Remover o limite de "${deleting?.category_name}"? Os lançamentos não são afetados.`}
        confirmLabel="Remover"
      />
    </div>
  );
}
