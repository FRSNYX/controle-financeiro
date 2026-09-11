import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, CreditCard, MoreVertical, Pencil, Archive, Trash2, Receipt,
  CheckCircle2, AlertTriangle, Calendar,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Card, CardHeader, Button, Input, Select, Textarea, Field, MoneyInput, Modal,
  PageHeader, Dropdown, DropdownItem, DropdownDivider, ConfirmDialog, EmptyState,
  ErrorState, Stat, Badge, Table, ProgressBar, Tabs, cx,
} from '../components/ui';
import { useAccounts, accountOptions, useApiMutation } from '../hooks/useLookups';
import { money, percent, date as fmtDate, monthName, todayISO, STATUS_STYLES } from '../lib/format';

const emptyCard = {
  name: '', institution: '', brand: '', limit_amount: 0,
  closing_day: 20, due_day: 28, default_account_id: '', color: '#4a3aa7', notes: '',
};

const COLORS = ['#4a3aa7', '#2a78d6', '#eb6834', '#1baf7a', '#e34948', '#e87ba4', '#eda100', '#008300'];

function CardForm({ open, onClose, card, onSaved }) {
  const isEdit = !!card?.id;
  const [form, setForm] = useState(() => (card ? { ...emptyCard, ...card, default_account_id: card.default_account_id ?? '' } : emptyCard));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: accountsData } = useAccounts();

  const mutation = useApiMutation({
    mutationFn: (payload) => (isEdit ? api.patch(`/cards/${card.id}`, payload) : api.post('/cards', payload)),
    invalidate: ['cards'],
    successMessage: isEdit ? 'Cartão atualizado' : 'Cartão criado',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar cartão' : 'Novo cartão de crédito'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button form="card-form" type="submit" loading={mutation.isPending} disabled={!form.name.trim()}>
            {isEdit ? 'Salvar' : 'Criar cartão'}
          </Button>
        </>
      }
    >
      <form
        id="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            name: form.name.trim(),
            institution: form.institution || null,
            brand: form.brand || null,
            limit_amount: form.limit_amount / 100,
            closing_day: Number(form.closing_day),
            due_day: Number(form.due_day),
            default_account_id: form.default_account_id || null,
            color: form.color,
            notes: form.notes || null,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome do cartão" required>
            <Input
              autoFocus
              required
              placeholder="Ex.: Nubank Roxinho"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Banco / Emissor">
            <Input
              placeholder="Ex.: Nu Pagamentos"
              value={form.institution ?? ''}
              onChange={(e) => set({ institution: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Bandeira">
            <Select
              value={form.brand ?? ''}
              onChange={(e) => set({ brand: e.target.value })}
              placeholder="Selecione"
              options={['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Outra']}
            />
          </Field>
          <Field label="Limite total" required>
            <MoneyInput value={form.limit_amount} onChange={(cents) => set({ limit_amount: cents })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Dia do fechamento" required hint="Compras após esse dia vão para a fatura seguinte">
            <Input
              type="number"
              min={1}
              max={31}
              required
              value={form.closing_day}
              onChange={(e) => set({ closing_day: e.target.value })}
            />
          </Field>
          <Field label="Dia do vencimento" required>
            <Input
              type="number"
              min={1}
              max={31}
              required
              value={form.due_day}
              onChange={(e) => set({ due_day: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Conta de pagamento padrão" hint="Conta debitada ao pagar a fatura">
          <Select
            value={form.default_account_id}
            onChange={(e) => set({ default_account_id: e.target.value })}
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

/** Pagamento da fatura — é aqui que o dinheiro sai da conta. */
function PayInvoiceModal({ invoice, card, onClose, onPaid }) {
  const { data: accountsData } = useAccounts();
  const [accountId, setAccountId] = useState(card?.default_account_id ?? '');
  const [amount, setAmount] = useState(invoice?.total ?? 0);
  const [date, setDate] = useState(todayISO());

  const mutation = useApiMutation({
    mutationFn: () =>
      api.post(`/cards/invoices/${invoice.id}/pay`, {
        account_id: Number(accountId),
        amount: amount / 100,
        date,
      }),
    invalidate: ['cards', 'accounts', 'transactions', 'invoices'],
    successMessage: (r) => r.message,
    onSuccess: () => {
      onPaid?.();
      onClose();
    },
  });

  const partial = amount > 0 && amount < (invoice?.total ?? 0);

  return (
    <Modal
      open={!!invoice}
      onClose={onClose}
      title="Pagar fatura"
      subtitle={card ? `${card.name} — ${monthName(invoice?.reference_month ?? '')}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="success"
            loading={mutation.isPending}
            disabled={!accountId || amount <= 0}
            onClick={() => mutation.mutate()}
          >
            Confirmar pagamento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-surface-2 p-3 flex items-center justify-between">
          <span className="text-sm text-muted">Total da fatura</span>
          <span className="text-lg font-semibold text-ink">{money(invoice?.total)}</span>
        </div>

        <Field label="Conta de pagamento" required>
          <Select
            required
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Selecione a conta"
            options={accountOptions(accountsData)}
          />
        </Field>

        <Field label="Valor a pagar" hint={partial ? 'Pagamento parcial mantém a fatura em aberto' : undefined}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>

        <Field label="Data do pagamento">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <p className="text-xs text-muted">
          O pagamento gera uma despesa na conta escolhida e quita as compras desta fatura.
        </p>
      </div>
    </Modal>
  );
}

/** Detalhe do cartão: faturas e lançamentos de cada uma. */
function CardDetail({ card, onClose, onPay }) {
  const [tab, setTab] = useState('invoices');
  const [openInvoice, setOpenInvoice] = useState(null);

  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', card?.id],
    queryFn: () => api.get(`/cards/${card.id}/invoices`, { limit: 24 }),
    enabled: !!card,
  });

  const { data: txData } = useQuery({
    queryKey: ['invoice-tx', openInvoice?.id],
    queryFn: () => api.get(`/cards/invoices/${openInvoice.id}/transactions`),
    enabled: !!openInvoice,
  });

  return (
    <Modal open={!!card} onClose={onClose} title={card?.name ?? ''} subtitle={card?.institution} size="lg">
      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'invoices', label: 'Faturas', icon: Receipt },
          { value: 'summary', label: 'Resumo', icon: CreditCard },
        ]}
      />

      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Limite total" value={money(card?.limit_amount)} />
            <Stat label="Limite disponível" value={money(card?.available_limit)} tone="positive" />
            <Stat label="Fatura atual" value={money(card?.current_invoice?.total)} tone="warning" />
            <Stat label="Próxima fatura" value={money(card?.next_invoice?.total)} />
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>Limite utilizado</span>
              <span>{percent(card?.limit_usage_pct ?? 0)}</span>
            </div>
            <ProgressBar value={card?.limit_usage_pct ?? 0} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-xs text-muted">Fechamento</p>
              <p className="text-ink font-medium">Todo dia {card?.closing_day}</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-xs text-muted">Vencimento</p>
              <p className="text-ink font-medium">Todo dia {card?.due_day}</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'invoices' && !openInvoice && (
        <Table
          loading={isLoading}
          rows={invoicesData?.data}
          onRowClick={(inv) => setOpenInvoice(inv)}
          empty={<EmptyState icon={Receipt} title="Nenhuma fatura" message="As faturas aparecem conforme você lança compras." />}
          columns={[
            {
              key: 'reference_month',
              header: 'Referência',
              render: (r) => <span className="text-sm text-ink">{monthName(r.reference_month)}</span>,
            },
            { key: 'closing_date', header: 'Fechamento', width: 110, render: (r) => fmtDate(r.closing_date) },
            { key: 'due_date', header: 'Vencimento', width: 110, render: (r) => fmtDate(r.due_date) },
            {
              key: 'status',
              header: 'Status',
              width: 110,
              render: (r) => (
                <Badge tone={r.status === 'paid' ? 'positive' : r.is_overdue ? 'negative' : 'warning'}>
                  {r.status === 'paid' ? 'paga' : r.is_overdue ? 'atrasada' : r.status === 'closed' ? 'fechada' : 'aberta'}
                </Badge>
              ),
            },
            {
              key: 'total',
              header: 'Total',
              align: 'right',
              width: 120,
              render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.total)}</span>,
            },
            {
              key: 'action',
              header: '',
              width: 90,
              align: 'right',
              render: (r) =>
                r.status !== 'paid' && r.total > 0 ? (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPay(r);
                    }}
                  >
                    Pagar
                  </Button>
                ) : null,
            },
          ]}
        />
      )}

      {tab === 'invoices' && openInvoice && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <Button size="sm" variant="ghost" onClick={() => setOpenInvoice(null)}>
              ← Voltar às faturas
            </Button>
            <span className="text-sm">
              <span className="text-muted">Total: </span>
              <span className="font-semibold text-ink">{money(txData?.invoice?.total)}</span>
            </span>
          </div>

          <Table
            rows={txData?.data}
            empty={<EmptyState title="Fatura sem lançamentos" />}
            columns={[
              { key: 'competence_date', header: 'Compra', width: 100, render: (r) => fmtDate(r.competence_date) },
              {
                key: 'description',
                header: 'Descrição',
                render: (r) => (
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{r.description}</p>
                    <p className="text-xs text-muted">
                      {r.category_name ?? 'Sem categoria'}
                      {r.installment_label && ` · parcela ${r.installment_label}`}
                    </p>
                  </div>
                ),
              },
              {
                key: 'amount',
                header: 'Valor',
                align: 'right',
                width: 110,
                render: (r) => <span className="font-medium text-negative tabular-nums">{money(r.amount)}</span>,
              },
            ]}
          />
        </div>
      )}
    </Modal>
  );
}

export default function Cards() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [detail, setDetail] = useState(null);
  const [paying, setPaying] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cards'],
    queryFn: () => api.get('/cards'),
  });

  const archiveMutation = useApiMutation({
    mutationFn: ({ id, archived }) => api.patch(`/cards/${id}`, { archived }),
    invalidate: ['cards'],
    successMessage: 'Cartão atualizado',
  });

  const deleteMutation = useApiMutation({
    mutationFn: (id) => api.del(`/cards/${id}`),
    invalidate: ['cards'],
    successMessage: 'Cartão excluído',
    onSuccess: () => setDeleting(null),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const cards = data?.data ?? [];
  const totalLimit = cards.reduce((s, c) => s + c.limit_amount, 0);
  const totalUsed = cards.reduce((s, c) => s + c.used_limit, 0);
  const currentInvoices = cards.reduce((s, c) => s + (c.current_invoice?.total ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cartões de crédito"
        subtitle="Faturas, limites e compras parceladas"
        actions={
          <Button
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Novo cartão
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Limite total" value={money(totalLimit)} icon={CreditCard} />
        <Stat label="Limite usado" value={money(totalUsed)} tone="warning" hint={percent(totalLimit ? (totalUsed / totalLimit) * 100 : 0)} />
        <Stat label="Limite disponível" value={money(Math.max(0, totalLimit - totalUsed))} tone="positive" />
        <Stat label="Faturas atuais" value={money(currentInvoices)} tone="negative" hint={`${cards.length} cartão(ões)`} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-52 rounded-xl" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="Nenhum cartão cadastrado"
            message="Cadastre seus cartões para acompanhar faturas e compras parceladas."
            action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Criar primeiro cartão</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((card) => {
            const invoice = card.current_invoice;
            const overdue = invoice && invoice.status !== 'paid' && invoice.due_date < todayISO();

            return (
              <Card key={card.id}>
                {/* Faixa colorida identifica o cartão de relance. */}
                <div className="h-1.5 -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-4 rounded-t-xl" style={{ background: card.color }} />

                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{card.name}</p>
                    <p className="text-xs text-muted truncate">
                      {[card.institution, card.brand].filter(Boolean).join(' · ') || 'Cartão de crédito'}
                    </p>
                  </div>
                  <Dropdown
                    trigger={
                      <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2" aria-label="Ações">
                        <MoreVertical size={15} />
                      </button>
                    }
                  >
                    <DropdownItem icon={Receipt} onClick={() => setDetail(card)}>
                      Ver faturas
                    </DropdownItem>
                    <DropdownItem
                      icon={Pencil}
                      onClick={() => {
                        setEditing(card);
                        setFormOpen(true);
                      }}
                    >
                      Editar
                    </DropdownItem>
                    <DropdownItem icon={Archive} onClick={() => archiveMutation.mutate({ id: card.id, archived: !card.archived })}>
                      {card.archived ? 'Reativar' : 'Arquivar'}
                    </DropdownItem>
                    <DropdownDivider />
                    <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting(card)}>
                      Excluir
                    </DropdownItem>
                  </Dropdown>
                </div>

                <div className="flex items-end justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs text-muted">Fatura atual</p>
                    <p className="text-xl font-semibold text-ink">{money(invoice?.total)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">Vence em</p>
                    <p className={cx('text-sm font-medium', overdue ? 'text-negative' : 'text-ink')}>
                      {fmtDate(invoice?.due_date)}
                    </p>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs text-muted mb-1">
                    <span>Limite disponível</span>
                    <span className="text-ink font-medium">{money(card.available_limit)}</span>
                  </div>
                  <ProgressBar value={card.limit_usage_pct} height={6} />
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-line">
                  {overdue && (
                    <Badge tone="negative" dot>
                      Fatura atrasada
                    </Badge>
                  )}
                  {invoice?.status === 'paid' && (
                    <Badge tone="positive">
                      <CheckCircle2 size={11} /> Paga
                    </Badge>
                  )}
                  <div className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setDetail(card)}>
                      Faturas
                    </Button>
                    {invoice?.total > 0 && invoice.status !== 'paid' && (
                      <Button size="sm" variant="success" onClick={() => setPaying({ invoice, card })}>
                        Pagar
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CardForm
        key={editing?.id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        card={editing}
        onSaved={refetch}
      />

      <CardDetail
        card={detail}
        onClose={() => setDetail(null)}
        onPay={(invoice) => setPaying({ invoice, card: detail })}
      />

      {paying && (
        <PayInvoiceModal
          key={paying.invoice.id}
          invoice={paying.invoice}
          card={paying.card}
          onClose={() => setPaying(null)}
          onPaid={refetch}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Excluir cartão"
        message={`Excluir o cartão "${deleting?.name}"? Cartões com lançamentos não podem ser excluídos — arquive-o para preservar o histórico.`}
      />
    </div>
  );
}
