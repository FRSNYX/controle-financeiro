import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Wallet, Landmark, PiggyBank, Banknote, Smartphone, LineChart, Circle,
  MoreVertical, Pencil, Archive, Trash2, ArrowUpRight, ArrowDownRight, Eye,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Card, CardHeader, Button, Input, Select, Textarea, Field, MoneyInput, Checkbox,
  Modal, PageHeader, Dropdown, DropdownItem, DropdownDivider, ConfirmDialog,
  EmptyState, ErrorState, Stat, Badge, Table, cx,
} from '../components/ui';
import { useApiMutation } from '../hooks/useLookups';
import { money, date as fmtDate, ACCOUNT_TYPES, todayISO } from '../lib/format';

const TYPE_ICONS = {
  checking: Landmark, savings: PiggyBank, wallet: Wallet,
  cash: Banknote, digital: Smartphone, broker: LineChart, other: Circle,
};

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

const emptyAccount = {
  name: '', type: 'checking', institution: '', initial_balance: 0,
  color: '#2a78d6', include_in_total: true, notes: '',
};

function AccountForm({ open, onClose, account, onSaved }) {
  const isEdit = !!account?.id;
  // A página remonta este componente via `key`, então o estado inicial
  // já nasce com o registro certo — não há herança do formulário anterior.
  const [form, setForm] = useState(() => (account ? { ...emptyAccount, ...account } : emptyAccount));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const mutation = useApiMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/accounts/${account.id}`, payload) : api.post('/accounts', payload),
    invalidate: ['accounts'],
    successMessage: isEdit ? 'Conta atualizada' : 'Conta criada',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar conta' : 'Nova conta'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button form="account-form" type="submit" loading={mutation.isPending} disabled={!form.name.trim()}>
            {isEdit ? 'Salvar' : 'Criar conta'}
          </Button>
        </>
      }
    >
      <form
        id="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            name: form.name.trim(),
            type: form.type,
            institution: form.institution || null,
            initial_balance: form.initial_balance / 100,
            color: form.color,
            include_in_total: form.include_in_total,
            notes: form.notes || null,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome da conta" required>
            <Input
              autoFocus
              required
              placeholder="Ex.: Conta Corrente"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>

          <Field label="Tipo" required>
            <Select
              value={form.type}
              onChange={(e) => set({ type: e.target.value })}
              options={Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Banco / Instituição">
            <Input
              placeholder="Ex.: Nubank"
              value={form.institution ?? ''}
              onChange={(e) => set({ institution: e.target.value })}
            />
          </Field>

          <Field
            label="Saldo inicial"
            hint={isEdit ? 'Alterar recalcula todo o histórico' : 'Saldo antes do primeiro lançamento'}
          >
            <MoneyInput value={form.initial_balance} onChange={(cents) => set({ initial_balance: cents })} />
          </Field>
        </div>

        <Field label="Cor de identificação">
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

        <Checkbox
          label="Somar no saldo total"
          hint="Desmarque para contas que não devem entrar no patrimônio consolidado"
          checked={form.include_in_total}
          onChange={(v) => set({ include_in_total: v })}
        />

        <Field label="Observações">
          <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

/** Extrato da conta com saldo acumulado linha a linha. */
function StatementModal({ account, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['statement', account?.id],
    queryFn: () => api.get(`/accounts/${account.id}/statement`, { limit: 200 }),
    enabled: !!account,
  });

  return (
    <Modal open={!!account} onClose={onClose} title={`Extrato — ${account?.name ?? ''}`} size="lg">
      <Table
        loading={isLoading}
        rows={data?.data}
        empty={<EmptyState title="Nenhuma movimentação" message="Esta conta ainda não tem lançamentos." />}
        columns={[
          { key: 'due_date', header: 'Data', width: 100, render: (r) => fmtDate(r.due_date) },
          {
            key: 'description',
            header: 'Descrição',
            render: (r) => (
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">{r.description}</p>
                <p className="text-xs text-muted">{r.category_name ?? r.status_label}</p>
              </div>
            ),
          },
          {
            key: 'signed_amount',
            header: 'Valor',
            align: 'right',
            width: 120,
            render: (r) => (
              <span className={cx('font-medium tabular-nums', r.signed_amount >= 0 ? 'text-positive' : 'text-negative')}>
                {r.signed_amount >= 0 ? '+' : '−'}
                {money(Math.abs(r.signed_amount))}
              </span>
            ),
          },
          {
            key: 'running_balance',
            header: 'Saldo',
            align: 'right',
            width: 120,
            render: (r) => <span className="text-sm text-muted tabular-nums">{money(r.running_balance)}</span>,
          },
        ]}
      />
    </Modal>
  );
}

export default function Accounts() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [statement, setStatement] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['accounts', showArchived],
    queryFn: () => api.get('/accounts', { archived: showArchived ? 'all' : '0' }),
  });

  const archiveMutation = useApiMutation({
    mutationFn: ({ id, archived }) => api.patch(`/accounts/${id}`, { archived }),
    invalidate: ['accounts'],
    successMessage: (r) => (r.data.archived ? 'Conta arquivada' : 'Conta reativada'),
  });

  const deleteMutation = useApiMutation({
    mutationFn: (id) => api.del(`/accounts/${id}`),
    invalidate: ['accounts'],
    successMessage: 'Conta excluída',
    onSuccess: () => setDeleting(null),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const accounts = data?.data ?? [];
  const active = accounts.filter((a) => !a.archived);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contas e carteiras"
        subtitle="Saldos calculados a partir dos lançamentos liquidados"
        actions={
          <>
            <Button variant="outline" onClick={() => setShowArchived((s) => !s)}>
              {showArchived ? 'Ocultar arquivadas' : 'Ver arquivadas'}
            </Button>
            <Button
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Nova conta
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Saldo total" value={money(data?.total_balance)} icon={Wallet} tone="brand" hint={`${active.length} conta(s)`} />
        <Stat
          label="Maior saldo"
          value={money(Math.max(0, ...active.map((a) => a.current_balance)))}
          hint={active.length ? active.reduce((max, a) => (a.current_balance > max.current_balance ? a : max), active[0]).name : '—'}
        />
        <Stat
          label="Saldo previsto"
          value={money(active.reduce((s, a) => s + (a.include_in_total ? a.predicted_balance : 0), 0))}
          hint="Incluindo pendentes"
          tone="info"
        />
        <Stat
          label="Contas negativas"
          value={active.filter((a) => a.current_balance < 0).length}
          tone={active.some((a) => a.current_balance < 0) ? 'negative' : 'neutral'}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-36 rounded-xl" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="Nenhuma conta cadastrada"
            message="Cadastre suas contas para acompanhar os saldos."
            action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Criar primeira conta</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const Icon = TYPE_ICONS[account.type] ?? Circle;
            const pending = account.predicted_balance - account.current_balance;

            return (
              <Card key={account.id} className={cx('relative', account.archived && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${account.color}1f`, color: account.color }}
                    >
                      <Icon size={19} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{account.name}</p>
                      <p className="text-xs text-muted truncate">
                        {account.institution ?? ACCOUNT_TYPES[account.type]}
                      </p>
                    </div>
                  </div>

                  <Dropdown
                    trigger={
                      <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2" aria-label="Ações">
                        <MoreVertical size={15} />
                      </button>
                    }
                  >
                    <DropdownItem icon={Eye} onClick={() => setStatement(account)}>
                      Ver extrato
                    </DropdownItem>
                    <DropdownItem
                      icon={Pencil}
                      onClick={() => {
                        setEditing(account);
                        setFormOpen(true);
                      }}
                    >
                      Editar
                    </DropdownItem>
                    <DropdownItem
                      icon={Archive}
                      onClick={() => archiveMutation.mutate({ id: account.id, archived: !account.archived })}
                    >
                      {account.archived ? 'Reativar' : 'Arquivar'}
                    </DropdownItem>
                    <DropdownDivider />
                    <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting(account)}>
                      Excluir
                    </DropdownItem>
                  </Dropdown>
                </div>

                <p className="text-xs text-muted">Saldo atual</p>
                <p
                  className={cx(
                    'text-2xl font-semibold tracking-tight',
                    account.current_balance >= 0 ? 'text-ink' : 'text-negative',
                  )}
                >
                  {money(account.current_balance)}
                </p>

                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-line flex-wrap">
                  {pending !== 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      {pending > 0 ? (
                        <ArrowUpRight size={13} className="text-positive" />
                      ) : (
                        <ArrowDownRight size={13} className="text-negative" />
                      )}
                      Previsto: {money(account.predicted_balance)}
                    </span>
                  )}
                  {account.archived && <Badge tone="neutral">Arquivada</Badge>}
                  {!account.include_in_total && <Badge tone="warning">Fora do total</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AccountForm
        key={editing?.id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        account={editing}
        onSaved={refetch}
      />

      <StatementModal account={statement} onClose={() => setStatement(null)} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Excluir conta"
        message={`Excluir a conta "${deleting?.name}"? Contas com lançamentos não podem ser excluídas — nesse caso, arquive-a para preservar o histórico.`}
      />
    </div>
  );
}
