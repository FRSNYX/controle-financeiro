import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowLeftRight, ArrowRight, Pencil, Trash2, MoreVertical, Info } from 'lucide-react';
import { api } from '../lib/api';
import { usePeriod } from '../context/AppProviders';
import {
  Card, Button, Input, Select, Textarea, Field, MoneyInput, Modal, PageHeader,
  Table, Pagination, Dropdown, DropdownItem, DropdownDivider, ConfirmDialog,
  EmptyState, ErrorState, Stat,
} from '../components/ui';
import { useAccounts, accountOptions, useApiMutation } from '../hooks/useLookups';
import { money, date as fmtDate, todayISO } from '../lib/format';

const emptyTransfer = {
  from_account_id: '', to_account_id: '', amount: 0, fee: 0,
  date: todayISO(), description: 'Transferência', notes: '',
};

function TransferForm({ open, onClose, transfer, onSaved }) {
  const isEdit = !!transfer?.id;
  const [form, setForm] = useState(() => (transfer ? { ...emptyTransfer, ...transfer } : emptyTransfer));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: accountsData } = useAccounts();
  const options = accountOptions(accountsData);

  const sameAccount = form.from_account_id && form.from_account_id === form.to_account_id;

  const mutation = useApiMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/transfers/${transfer.id}`, payload) : api.post('/transfers', payload),
    invalidate: ['transfers', 'accounts', 'calendar'],
    successMessage: isEdit ? 'Transferência atualizada' : 'Transferência registrada',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar transferência' : 'Nova transferência'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            form="transfer-form"
            type="submit"
            loading={mutation.isPending}
            disabled={!form.from_account_id || !form.to_account_id || sameAccount || form.amount <= 0}
          >
            {isEdit ? 'Salvar' : 'Transferir'}
          </Button>
        </>
      }
    >
      <form
        id="transfer-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            from_account_id: Number(form.from_account_id),
            to_account_id: Number(form.to_account_id),
            amount: form.amount / 100,
            fee: form.fee / 100,
            date: form.date,
            description: form.description.trim() || 'Transferência',
            notes: form.notes || null,
          });
        }}
        className="space-y-4"
      >
        <div className="flex items-start gap-2 rounded-lg bg-info/10 border border-info/30 p-3">
          <Info size={15} className="text-info shrink-0 mt-0.5" />
          <p className="text-xs text-ink leading-relaxed">
            A transferência move o saldo entre contas, mas <strong>não é contabilizada</strong> como
            receita nem despesa — ela não afeta o resultado do mês.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Conta de origem" required>
            <Select
              required
              value={form.from_account_id}
              onChange={(e) => set({ from_account_id: e.target.value })}
              placeholder="De onde sai"
              options={options}
            />
          </Field>

          <Field
            label="Conta de destino"
            required
            error={sameAccount ? 'Escolha uma conta diferente da origem' : null}
          >
            <Select
              required
              value={form.to_account_id}
              onChange={(e) => set({ to_account_id: e.target.value })}
              placeholder="Para onde vai"
              options={options.filter((o) => String(o.value) !== String(form.from_account_id))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Valor" required>
            <MoneyInput value={form.amount} onChange={(cents) => set({ amount: cents })} />
          </Field>

          <Field label="Tarifa" hint="Vira despesa real">
            <MoneyInput value={form.fee} onChange={(cents) => set({ fee: cents })} />
          </Field>

          <Field label="Data" required>
            <Input type="date" required value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        </div>

        <Field label="Descrição">
          <Input
            maxLength={200}
            placeholder="Ex.: Reserva mensal"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>

        <Field label="Observações">
          <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

export default function Transfers() {
  const { range, label } = usePeriod();
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [accountFilter, setAccountFilter] = useState('');

  const { data: accountsData } = useAccounts();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['transfers', range.from, range.to, page, accountFilter],
    queryFn: () =>
      api.get('/transfers', {
        from: range.from,
        to: range.to,
        page,
        pageSize: 25,
        accountId: accountFilter || undefined,
      }),
  });

  const deleteMutation = useApiMutation({
    mutationFn: (id) => api.del(`/transfers/${id}`),
    invalidate: ['transfers', 'accounts'],
    successMessage: 'Transferência excluída',
    onSuccess: () => setDeleting(null),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const transfers = data?.data ?? [];
  const total = transfers.reduce((s, t) => s + t.amount, 0);
  const fees = transfers.reduce((s, t) => s + t.fee, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transferências"
        subtitle={`${label} — movimentações entre suas contas`}
        actions={
          <Button
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Nova transferência
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Total transferido" value={money(total)} icon={ArrowLeftRight} tone="info" />
        <Stat label="Transferências" value={data?.pagination?.total ?? 0} hint="No período" />
        <Stat label="Tarifas pagas" value={money(fees)} tone={fees > 0 ? 'negative' : 'neutral'} hint="Contam como despesa" />
      </div>

      <Card>
        <div className="mb-3 max-w-xs">
          <Select
            value={accountFilter}
            onChange={(e) => {
              setAccountFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Todas as contas"
            options={accountOptions(accountsData)}
          />
        </div>

        <Table
          loading={isLoading}
          rows={transfers}
          empty={
            <EmptyState
              icon={ArrowLeftRight}
              title="Nenhuma transferência no período"
              message="Registre movimentações entre suas contas sem afetar o resultado do mês."
              action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Nova transferência</Button>}
            />
          }
          columns={[
            { key: 'date', header: 'Data', width: 100, render: (r) => fmtDate(r.date) },
            {
              key: 'route',
              header: 'Origem e destino',
              render: (r) => (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: r.from_account_color }} />
                    <span className="text-sm text-ink truncate">{r.from_account_name}</span>
                  </span>
                  <ArrowRight size={14} className="text-muted shrink-0" />
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: r.to_account_color }} />
                    <span className="text-sm text-ink truncate">{r.to_account_name}</span>
                  </span>
                </div>
              ),
            },
            {
              key: 'description',
              header: 'Descrição',
              render: (r) => <span className="text-sm text-muted truncate">{r.description}</span>,
            },
            {
              key: 'fee',
              header: 'Tarifa',
              align: 'right',
              width: 90,
              render: (r) => (
                <span className="text-sm text-muted tabular-nums">{r.fee > 0 ? money(r.fee) : '—'}</span>
              ),
            },
            {
              key: 'amount',
              header: 'Valor',
              align: 'right',
              width: 120,
              render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.amount)}</span>,
            },
            {
              key: 'actions',
              header: '',
              width: 50,
              align: 'right',
              render: (r) => (
                <Dropdown
                  trigger={
                    <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2" aria-label="Ações">
                      <MoreVertical size={15} />
                    </button>
                  }
                >
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

        <Pagination
          page={data?.pagination?.page ?? 1}
          totalPages={data?.pagination?.totalPages}
          total={data?.pagination?.total}
          onChange={setPage}
        />
      </Card>

      <TransferForm
        key={editing?.id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        transfer={editing}
        onSaved={refetch}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Excluir transferência"
        message={`Excluir a transferência de ${money(deleting?.amount)}? Os saldos das duas contas serão recalculados.`}
      />
    </div>
  );
}
