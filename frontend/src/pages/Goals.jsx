import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Target, Trophy, CalendarClock, MoreVertical, Pencil, Trash2,
  TrendingUp, CircleDollarSign, PartyPopper,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Card, CardHeader, Button, Input, Select, Textarea, Field, MoneyInput, Modal,
  PageHeader, Dropdown, DropdownItem, DropdownDivider, ConfirmDialog, EmptyState,
  ErrorState, Stat, Badge, ProgressBar, Tabs, Table, cx,
} from '../components/ui';
import { useAccounts, accountOptions, useApiMutation } from '../hooks/useLookups';
import { money, percent, date as fmtDate, relativeDays, GOAL_TYPES, todayISO, addMonthsISO } from '../lib/format';

const COLORS = ['#1baf7a', '#2a78d6', '#eb6834', '#4a3aa7', '#e87ba4', '#eda100', '#008300', '#e34948'];

const emptyGoal = {
  name: '', type: 'outros', target_amount: 0, start_date: todayISO(),
  target_date: addMonthsISO(todayISO(), 12), account_id: '', color: '#1baf7a', notes: '',
};

function GoalForm({ open, onClose, goal, onSaved }) {
  const isEdit = !!goal?.id;
  const [form, setForm] = useState(() => (goal ? { ...emptyGoal, ...goal, account_id: goal.account_id ?? '' } : emptyGoal));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: accountsData } = useAccounts();

  const mutation = useApiMutation({
    mutationFn: (payload) => (isEdit ? api.patch(`/goals/${goal.id}`, payload) : api.post('/goals', payload)),
    invalidate: ['goals'],
    successMessage: isEdit ? 'Meta atualizada' : 'Meta criada',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  const invalidDates = form.target_date && form.start_date && form.target_date < form.start_date;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar meta' : 'Nova meta financeira'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            form="goal-form"
            type="submit"
            loading={mutation.isPending}
            disabled={!form.name.trim() || form.target_amount <= 0 || invalidDates}
          >
            {isEdit ? 'Salvar' : 'Criar meta'}
          </Button>
        </>
      }
    >
      <form
        id="goal-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            name: form.name.trim(),
            type: form.type,
            target_amount: form.target_amount / 100,
            start_date: form.start_date,
            target_date: form.target_date,
            account_id: form.account_id || null,
            color: form.color,
            notes: form.notes || null,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome da meta" required>
            <Input
              autoFocus
              required
              placeholder="Ex.: Reserva de emergência"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Tipo">
            <Select
              value={form.type}
              onChange={(e) => set({ type: e.target.value })}
              options={Object.entries(GOAL_TYPES).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Valor objetivo" required>
            <MoneyInput value={form.target_amount} onChange={(cents) => set({ target_amount: cents })} />
          </Field>
          <Field label="Data de início">
            <Input type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </Field>
          <Field label="Previsão" required error={invalidDates ? 'Deve ser após o início' : null}>
            <Input
              type="date"
              required
              value={form.target_date}
              onChange={(e) => set({ target_date: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Conta vinculada" hint="Opcional — onde o dinheiro fica guardado">
          <Select
            value={form.account_id}
            onChange={(e) => set({ account_id: e.target.value })}
            placeholder="Selecione"
            options={accountOptions(accountsData)}
          />
        </Field>

        <Field label="Cor">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => set({ color })}
                className={cx(
                  'h-8 w-8 rounded-lg transition-transform',
                  form.color === color ? 'ring-2 ring-offset-2 ring-brand scale-110' : 'hover:scale-105',
                )}
                style={{ background: color }}
                aria-label={`Cor ${color}`}
              />
            ))}
          </div>
        </Field>

        <Field label="Observações">
          <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

function ContributionModal({ goal, onClose, onSaved }) {
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState('');
  const [createTx, setCreateTx] = useState(false);

  const { data: accountsData } = useAccounts();

  const mutation = useApiMutation({
    mutationFn: () =>
      api.post(`/goals/${goal.id}/contributions`, {
        amount: amount / 100,
        date,
        notes: notes || null,
        account_id: accountId || null,
        create_transaction: createTx,
      }),
    invalidate: ['goals', 'goal', 'transactions', 'accounts'],
    successMessage: 'Aporte registrado',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={!!goal}
      onClose={onClose}
      title="Novo aporte"
      subtitle={goal?.name}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={mutation.isPending} disabled={amount === 0} onClick={() => mutation.mutate()}>
            Registrar aporte
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-surface-2 p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Acumulado</span>
            <span className="text-ink font-medium">{money(goal?.current_amount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Falta</span>
            <span className="text-ink font-medium">{money(goal?.remaining_amount)}</span>
          </div>
          {goal?.monthly_needed > 0 && (
            <div className="flex justify-between text-sm pt-1 border-t border-line">
              <span className="text-muted">Sugerido por mês</span>
              <span className="text-brand font-medium">{money(goal.monthly_needed)}</span>
            </div>
          )}
        </div>

        <Field label="Valor do aporte" required hint="Use valor negativo para registrar uma retirada">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>

        <Field label="Data">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Conta de origem" hint="Opcional">
          <Select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Selecione"
            options={accountOptions(accountsData)}
          />
        </Field>

        {accountId && amount > 0 && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]"
              checked={createTx}
              onChange={(e) => setCreateTx(e.target.checked)}
            />
            <span>
              <span className="text-sm text-ink block">Lançar como despesa na conta</span>
              <span className="text-xs text-muted block mt-0.5">
                Registra a saída no fluxo de caixa da conta escolhida.
              </span>
            </span>
          </label>
        )}

        <Field label="Observação">
          <Input placeholder="Ex.: sobra do mês" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function GoalDetail({ goalId, onClose, onContribute }) {
  const { data, isLoading } = useQuery({
    queryKey: ['goal', goalId],
    queryFn: () => api.get(`/goals/${goalId}`),
    enabled: !!goalId,
  });

  const goal = data?.data;

  return (
    <Modal open={!!goalId} onClose={onClose} title={goal?.name ?? 'Carregando...'} size="md">
      {isLoading ? (
        <div className="skeleton h-64 rounded-xl" />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex items-end justify-between gap-3 mb-2">
              <div>
                <p className="text-2xl font-semibold text-ink">{money(goal.current_amount)}</p>
                <p className="text-xs text-muted">de {money(goal.target_amount)}</p>
              </div>
              <p className="text-lg font-semibold" style={{ color: goal.color }}>
                {percent(goal.percent)}
              </p>
            </div>
            <ProgressBar value={goal.percent} color={goal.color} height={10} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Falta" value={money(goal.remaining_amount)} />
            <Stat label="Por mês" value={money(goal.monthly_needed)} tone="brand" hint="Para cumprir o prazo" />
            <Stat label="Prazo" value={fmtDate(goal.target_date)} hint={relativeDays(goal.target_date)} />
            <Stat
              label="Situação"
              value={goal.is_complete ? 'Concluída' : goal.is_late ? 'Atrasada' : 'Em andamento'}
              tone={goal.is_complete ? 'positive' : goal.is_late ? 'negative' : 'neutral'}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-ink">Histórico de aportes</p>
              <Button size="sm" icon={Plus} onClick={() => onContribute(goal)}>
                Novo aporte
              </Button>
            </div>
            <Table
              rows={goal.contributions}
              empty={<EmptyState title="Nenhum aporte ainda" message="Registre o primeiro aporte para esta meta." />}
              columns={[
                { key: 'date', header: 'Data', width: 110, render: (r) => fmtDate(r.date) },
                {
                  key: 'notes',
                  header: 'Observação',
                  render: (r) => <span className="text-sm text-muted">{r.notes ?? '—'}</span>,
                },
                {
                  key: 'amount',
                  header: 'Valor',
                  align: 'right',
                  width: 120,
                  render: (r) => (
                    <span className={cx('font-medium tabular-nums', r.amount >= 0 ? 'text-positive' : 'text-negative')}>
                      {r.amount >= 0 ? '+' : '−'}
                      {money(Math.abs(r.amount))}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Goals() {
  const [status, setStatus] = useState('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [contributing, setContributing] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['goals', status],
    queryFn: () => api.get('/goals', { status }),
  });

  const deleteMutation = useApiMutation({
    mutationFn: (id) => api.del(`/goals/${id}`),
    invalidate: ['goals'],
    successMessage: 'Meta excluída',
    onSuccess: () => setDeleting(null),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const goals = data?.data ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metas financeiras"
        subtitle="Objetivos, progresso e ritmo de aportes"
        actions={
          <Button
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Nova meta
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Metas ativas" value={summary?.count ?? 0} icon={Target} />
        <Stat label="Total acumulado" value={money(summary?.current_total)} tone="positive" icon={CircleDollarSign} />
        <Stat label="Total objetivado" value={money(summary?.target_total)} icon={TrendingUp} />
        <Stat
          label="Concluídas"
          value={summary?.completed ?? 0}
          tone="positive"
          icon={Trophy}
          hint={summary?.late > 0 ? `${summary.late} atrasada(s)` : 'Nenhuma atrasada'}
        />
      </div>

      <Tabs
        active={status}
        onChange={setStatus}
        tabs={[
          { value: 'active', label: 'Em andamento' },
          { value: 'done', label: 'Concluídas' },
          { value: 'all', label: 'Todas' },
        ]}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-xl" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title="Nenhuma meta por aqui"
            message="Crie metas como reserva de emergência, viagem ou entrada de um imóvel."
            action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Criar primeira meta</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {goals.map((goal) => (
            <Card key={goal.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${goal.color}1f`, color: goal.color }}
                  >
                    {goal.is_complete ? <Trophy size={19} /> : <Target size={19} />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{goal.name}</p>
                    <p className="text-xs text-muted">{GOAL_TYPES[goal.type] ?? goal.type}</p>
                  </div>
                </div>

                <Dropdown
                  trigger={
                    <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2" aria-label="Ações">
                      <MoreVertical size={15} />
                    </button>
                  }
                >
                  <DropdownItem icon={Plus} onClick={() => setContributing(goal)}>
                    Novo aporte
                  </DropdownItem>
                  <DropdownItem icon={Target} onClick={() => setDetailId(goal.id)}>
                    Ver detalhes
                  </DropdownItem>
                  <DropdownItem
                    icon={Pencil}
                    onClick={() => {
                      setEditing(goal);
                      setFormOpen(true);
                    }}
                  >
                    Editar
                  </DropdownItem>
                  <DropdownDivider />
                  <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting(goal)}>
                    Excluir
                  </DropdownItem>
                </Dropdown>
              </div>

              <div className="flex items-end justify-between gap-2 mb-2">
                <div>
                  <p className="text-xl font-semibold text-ink">{money(goal.current_amount)}</p>
                  <p className="text-xs text-muted">de {money(goal.target_amount)}</p>
                </div>
                <p className="text-lg font-semibold" style={{ color: goal.color }}>
                  {percent(goal.percent)}
                </p>
              </div>

              <ProgressBar value={goal.percent} color={goal.color} height={8} />

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line flex-wrap">
                {goal.is_complete ? (
                  <Badge tone="positive">
                    <PartyPopper size={11} /> Meta atingida
                  </Badge>
                ) : goal.is_late ? (
                  <Badge tone="negative" dot>
                    Prazo vencido
                  </Badge>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <CalendarClock size={12} />
                    {relativeDays(goal.target_date)}
                  </span>
                )}

                {!goal.is_complete && goal.monthly_needed > 0 && (
                  <span className="text-xs text-muted ml-auto">{money(goal.monthly_needed)}/mês</span>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full justify-center mt-3"
                onClick={() => setContributing(goal)}
              >
                Registrar aporte
              </Button>
            </Card>
          ))}
        </div>
      )}

      <GoalForm
        key={editing?.id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        goal={editing}
        onSaved={refetch}
      />

      <GoalDetail
        goalId={detailId}
        onClose={() => setDetailId(null)}
        onContribute={(goal) => {
          setDetailId(null);
          setContributing(goal);
        }}
      />

      {contributing && (
        <ContributionModal
          key={contributing.id}
          goal={contributing}
          onClose={() => setContributing(null)}
          onSaved={refetch}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Excluir meta"
        message={`Excluir a meta "${deleting?.name}"? Todo o histórico de aportes dela será removido.`}
      />
    </div>
  );
}
