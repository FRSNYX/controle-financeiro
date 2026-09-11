import { useState, useEffect, useMemo } from 'react';
import { Repeat, Layers, Paperclip, Info } from 'lucide-react';
import { api } from '../../lib/api';
import {
  Modal, Button, Input, Select, Textarea, Field, MoneyInput, Checkbox, cx, Badge,
} from '../ui';
import { useAccounts, useCategories, useCards, accountOptions, categoryOptions, useApiMutation } from '../../hooks/useLookups';
import { todayISO, money, INCOME_TYPES, PAYMENT_METHODS, FREQUENCIES, date as fmtDate } from '../../lib/format';

const emptyForm = (kind) => ({
  kind,
  description: '',
  amount: 0,
  status: 'pending',
  category_id: '',
  subcategory_id: '',
  account_id: '',
  competence_date: todayISO(),
  due_date: todayISO(),
  settle_date: '',
  income_type: kind === 'income' ? 'salario' : '',
  receipt_method: '',
  expense_nature: 'variable',
  payment_method: kind === 'expense' ? 'pix' : '',
  card_id: '',
  installment_total: 1,
  tags: '',
  notes: '',
});

/**
 * Formulário único de receita e despesa.
 * Os campos específicos aparecem conforme `kind`, e parcelamento/recorrência
 * são mutuamente exclusivos — combinar os dois geraria séries ambíguas.
 */
export default function TransactionForm({ open, onClose, kind, transaction, onSaved }) {
  const isEdit = !!transaction?.id;
  const isIncome = kind === 'income';

  const [form, setForm] = useState(() => emptyForm(kind));
  const [useInstallments, setUseInstallments] = useState(false);
  const [useRecurrence, setUseRecurrence] = useState(false);
  const [recurrence, setRecurrence] = useState({ frequency: 'monthly', interval_n: 1, end_date: '', max_count: '' });
  const [files, setFiles] = useState([]);

  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories(kind);
  const { data: cardsData } = useCards();

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Carrega o registro na edição; volta ao estado limpo ao abrir para criar.
  useEffect(() => {
    if (!open) return;
    if (transaction) {
      setForm({
        ...emptyForm(transaction.kind ?? kind),
        ...transaction,
        category_id: transaction.category_id ?? '',
        subcategory_id: transaction.subcategory_id ?? '',
        account_id: transaction.account_id ?? '',
        card_id: transaction.card_id ?? '',
        settle_date: transaction.settle_date ?? '',
        income_type: transaction.income_type ?? '',
        payment_method: transaction.payment_method ?? '',
        tags: transaction.tags ?? '',
        notes: transaction.notes ?? '',
      });
    } else {
      setForm(emptyForm(kind));
    }
    setUseInstallments(false);
    setUseRecurrence(false);
    setFiles([]);
  }, [open, transaction, kind]);

  const isCardPayment = !isIncome && form.payment_method === 'credito';

  // Uma despesa no cartão pertence à fatura, não a uma conta.
  useEffect(() => {
    if (isCardPayment) set({ account_id: '' });
    else set({ card_id: '' });
  }, [isCardPayment]);

  const subcategories = useMemo(() => {
    if (!form.category_id) return [];
    return (categoriesData?.data ?? []).filter((c) => c.parent_id === Number(form.category_id));
  }, [categoriesData, form.category_id]);

  // Só categorias-pai no seletor principal; a subcategoria tem campo próprio.
  const parentCategories = useMemo(
    () => (categoriesData?.data ?? []).filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name })),
    [categoriesData],
  );

  const installmentPreview = useMemo(() => {
    if (!useInstallments || form.installment_total < 2 || !form.amount) return null;
    const n = Number(form.installment_total);
    const base = Math.floor(form.amount / n);
    // O resto vai na 1ª parcela para a soma bater com o total exato.
    return { first: base + (form.amount - base * n), rest: base, count: n };
  }, [useInstallments, form.installment_total, form.amount]);

  const mutation = useApiMutation({
    mutationFn: async (payload) => {
      if (isEdit) return api.patch(`/transactions/${transaction.id}`, payload);
      const created = await api.post('/transactions', payload);

      // Anexos só existem depois que o lançamento tem id.
      if (files.length && created.ids?.[0]) {
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        await api.upload(`/data/attachments/${created.ids[0]}`, fd);
      }
      return created;
    },
    invalidate: ['transactions', 'accounts', 'cards', 'budgets', 'calendar', 'reports'],
    successMessage: (res) =>
      isEdit ? 'Lançamento atualizado' : (res.count > 1 ? `${res.count} lançamentos criados` : 'Lançamento criado'),
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  const submit = (e) => {
    e.preventDefault();

    const payload = {
      kind: form.kind,
      description: form.description.trim(),
      amount: form.amount / 100, // a API recebe reais e converte para centavos
      status: form.status,
      category_id: form.category_id || null,
      subcategory_id: form.subcategory_id || null,
      account_id: form.account_id || null,
      competence_date: form.competence_date,
      due_date: form.due_date,
      settle_date: form.status === 'settled' ? (form.settle_date || form.due_date) : null,
      tags: form.tags || null,
      notes: form.notes || null,
    };

    if (isIncome) {
      payload.income_type = form.income_type || null;
      payload.receipt_method = form.receipt_method || null;
    } else {
      payload.expense_nature = form.expense_nature;
      payload.payment_method = form.payment_method || null;
      payload.card_id = form.card_id || null;
    }

    if (!isEdit) {
      if (useInstallments && form.installment_total > 1) {
        payload.installment_total = Number(form.installment_total);
      } else if (useRecurrence) {
        payload.recurrence = {
          frequency: recurrence.frequency,
          interval_n: Number(recurrence.interval_n) || 1,
          end_date: recurrence.end_date || null,
          max_count: recurrence.max_count ? Number(recurrence.max_count) : null,
        };
      }
    }

    mutation.mutate(payload);
  };

  const title = isEdit
    ? `Editar ${isIncome ? 'receita' : 'despesa'}`
    : `Nova ${isIncome ? 'receita' : 'despesa'}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="transaction-form"
            loading={mutation.isPending}
            disabled={!form.description.trim() || form.amount <= 0}
          >
            {isEdit ? 'Salvar alterações' : 'Criar lançamento'}
          </Button>
        </>
      }
    >
      <form id="transaction-form" onSubmit={submit} className="space-y-5">
        {/* ---------- Linha principal ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Descrição" required className="sm:col-span-2">
            <Input
              autoFocus
              required
              maxLength={200}
              placeholder={isIncome ? 'Ex.: Salário de março' : 'Ex.: Supermercado'}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>

          <Field label="Valor" required>
            <MoneyInput value={form.amount} onChange={(cents) => set({ amount: cents })} />
          </Field>
        </div>

        {/* ---------- Classificação ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Categoria">
            <Select
              value={form.category_id}
              onChange={(e) => set({ category_id: e.target.value, subcategory_id: '' })}
              placeholder="Selecione uma categoria"
              options={parentCategories}
            />
          </Field>

          <Field label="Subcategoria" hint={!form.category_id ? 'Escolha uma categoria primeiro' : undefined}>
            <Select
              value={form.subcategory_id}
              onChange={(e) => set({ subcategory_id: e.target.value })}
              placeholder={subcategories.length ? 'Opcional' : 'Sem subcategorias'}
              disabled={!subcategories.length}
              options={subcategories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
        </div>

        {/* ---------- Forma de pagamento / recebimento ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isIncome ? (
            <>
              <Field label="Tipo de receita">
                <Select
                  value={form.income_type}
                  onChange={(e) => set({ income_type: e.target.value })}
                  placeholder="Selecione"
                  options={Object.entries(INCOME_TYPES).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label="Forma de recebimento">
                <Select
                  value={form.receipt_method}
                  onChange={(e) => set({ receipt_method: e.target.value })}
                  placeholder="Selecione"
                  options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Forma de pagamento">
                <Select
                  value={form.payment_method}
                  onChange={(e) => set({ payment_method: e.target.value })}
                  placeholder="Selecione"
                  options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label="Natureza">
                <Select
                  value={form.expense_nature}
                  onChange={(e) => set({ expense_nature: e.target.value })}
                  options={[
                    { value: 'variable', label: 'Variável' },
                    { value: 'fixed', label: 'Fixa' },
                  ]}
                />
              </Field>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isCardPayment ? (
            <Field label="Cartão" required hint="A compra entra na fatura, não na conta">
              <Select
                required
                value={form.card_id}
                onChange={(e) => set({ card_id: e.target.value })}
                placeholder="Selecione o cartão"
                options={(cardsData?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          ) : (
            <Field label={isIncome ? 'Conta de destino' : 'Conta utilizada'}>
              <Select
                value={form.account_id}
                onChange={(e) => set({ account_id: e.target.value })}
                placeholder="Selecione a conta"
                options={accountOptions(accountsData)}
              />
            </Field>
          )}

          <Field label="Situação">
            <Select
              value={form.status}
              onChange={(e) => set({ status: e.target.value })}
              options={[
                { value: 'pending', label: isIncome ? 'Previsto' : 'Pendente' },
                { value: 'settled', label: isIncome ? 'Recebido' : 'Pago' },
                { value: 'canceled', label: 'Cancelado' },
              ]}
            />
          </Field>
        </div>

        {/* ---------- Datas ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={isIncome ? 'Data da receita' : 'Data da compra'}>
            <Input
              type="date"
              value={form.competence_date}
              onChange={(e) => set({ competence_date: e.target.value })}
            />
          </Field>

          <Field label={isIncome ? 'Previsão de recebimento' : 'Vencimento'} required>
            <Input
              type="date"
              required
              value={form.due_date}
              onChange={(e) => set({ due_date: e.target.value })}
            />
          </Field>

          <Field
            label={isIncome ? 'Data de recebimento' : 'Data de pagamento'}
            hint={form.status !== 'settled' ? 'Preenchida ao dar baixa' : undefined}
          >
            <Input
              type="date"
              disabled={form.status !== 'settled'}
              value={form.settle_date || (form.status === 'settled' ? form.due_date : '')}
              onChange={(e) => set({ settle_date: e.target.value })}
            />
          </Field>
        </div>

        {/* ---------- Parcelamento e recorrência (só na criação) ---------- */}
        {!isEdit && (
          <div className="rounded-lg border border-line p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Checkbox
                label="Parcelar este lançamento"
                hint="Gera um lançamento por mês"
                checked={useInstallments}
                onChange={(v) => {
                  setUseInstallments(v);
                  if (v) setUseRecurrence(false);
                }}
              />
              <Checkbox
                label="Lançamento recorrente"
                hint="Repete automaticamente"
                checked={useRecurrence}
                onChange={(v) => {
                  setUseRecurrence(v);
                  if (v) setUseInstallments(false);
                }}
              />
            </div>

            {useInstallments && (
              <div className="pt-3 border-t border-line space-y-3">
                <Field label="Número de parcelas" className="max-w-[180px]">
                  <Input
                    type="number"
                    min={2}
                    max={480}
                    value={form.installment_total}
                    onChange={(e) => set({ installment_total: e.target.value })}
                  />
                </Field>

                {installmentPreview && (
                  <div className="flex items-start gap-2 rounded-lg bg-brand/5 border border-brand/20 p-3">
                    <Layers size={15} className="text-brand shrink-0 mt-0.5" />
                    <p className="text-xs text-ink leading-relaxed">
                      Serão criados <strong>{installmentPreview.count} lançamentos</strong>.
                      {installmentPreview.first !== installmentPreview.rest ? (
                        <>
                          {' '}A 1ª parcela sai por <strong>{money(installmentPreview.first)}</strong> e as demais
                          por <strong>{money(installmentPreview.rest)}</strong> — o centavo de diferença vai na
                          primeira para a soma bater exatamente com o total.
                        </>
                      ) : (
                        <> Cada parcela sai por <strong>{money(installmentPreview.rest)}</strong>.</>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}

            {useRecurrence && (
              <div className="pt-3 border-t border-line grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Frequência">
                  <Select
                    value={recurrence.frequency}
                    onChange={(e) => setRecurrence({ ...recurrence, frequency: e.target.value })}
                    options={Object.entries(FREQUENCIES).map(([value, label]) => ({ value, label }))}
                  />
                </Field>
                <Field label="Repetir até" hint="Opcional">
                  <Input
                    type="date"
                    value={recurrence.end_date}
                    onChange={(e) => setRecurrence({ ...recurrence, end_date: e.target.value })}
                  />
                </Field>
                <Field label="Nº de ocorrências" hint="Opcional">
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    placeholder="Ilimitado"
                    value={recurrence.max_count}
                    onChange={(e) => setRecurrence({ ...recurrence, max_count: e.target.value })}
                  />
                </Field>
                <div className="sm:col-span-3 flex items-start gap-2 rounded-lg bg-brand/5 border border-brand/20 p-3">
                  <Repeat size={15} className="text-brand shrink-0 mt-0.5" />
                  <p className="text-xs text-ink">
                    As ocorrências são geradas automaticamente até 12 meses à frente e renovadas conforme
                    o tempo passa.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- Complementos ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Etiquetas" hint="Separe por vírgula">
            <Input
              placeholder="Ex.: viagem, trabalho"
              value={form.tags}
              onChange={(e) => set({ tags: e.target.value })}
            />
          </Field>

          {!isEdit && (
            <Field label="Anexos" hint="Comprovantes: imagem ou PDF, até 5 arquivos">
              <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-dashed border-line cursor-pointer hover:border-brand text-sm text-muted">
                <Paperclip size={15} />
                {files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Escolher arquivos'}
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => setFiles([...e.target.files].slice(0, 5))}
                />
              </label>
            </Field>
          )}
        </div>

        <Field label="Observações">
          <Textarea
            rows={2}
            maxLength={2000}
            placeholder="Anotações sobre este lançamento"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>

        {isEdit && transaction?.installment_label && (
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3">
            <Info size={15} className="text-muted shrink-0" />
            <p className="text-xs text-muted">
              Esta é a parcela <strong className="text-ink">{transaction.installment_label}</strong> de
              uma compra parcelada. Alterações aqui afetam apenas esta parcela.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}
