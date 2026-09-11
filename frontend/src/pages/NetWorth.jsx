import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Gem, Plus, Home, Car, Landmark, TrendingUp, Wallet, LineChart, Pencil,
  Trash2, MoreVertical, Calculator, ArrowRight, Minus, Equal, Info,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Card, CardHeader, Button, Input, Select, Textarea, Field, MoneyInput, Modal,
  PageHeader, Dropdown, DropdownItem, DropdownDivider, ConfirmDialog, EmptyState,
  ErrorState, Stat, Badge, Table, ProgressBar, cx,
} from '../components/ui';
import { NetWorthChart, DonutChart, ProjectionChart } from '../components/charts';
import { useApiMutation } from '../hooks/useLookups';
import { money, percent, date as fmtDate, ASSET_TYPES, LIABILITY_TYPES, todayISO } from '../lib/format';

const ASSET_ICONS = { imovel: Home, veiculo: Car, equipamento: LineChart, participacao: Landmark, outros: Gem };

function AssetForm({ open, onClose, asset, onSaved }) {
  const isEdit = !!asset?.id;
  const [form, setForm] = useState(() =>
    asset
      ? { ...asset, acquisition_date: asset.acquisition_date ?? '' }
      : { name: '', type: 'outros', value: 0, acquisition_date: todayISO(), notes: '' },
  );
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const mutation = useApiMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/networth/assets/${asset.id}`, payload) : api.post('/networth/assets', payload),
    invalidate: ['networth'],
    successMessage: isEdit ? 'Bem atualizado' : 'Bem cadastrado',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar bem' : 'Novo bem'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            loading={mutation.isPending}
            disabled={!form.name.trim() || form.value <= 0}
            onClick={() =>
              mutation.mutate({
                name: form.name.trim(),
                type: form.type,
                value: form.value / 100,
                acquisition_date: form.acquisition_date || null,
                notes: form.notes || null,
              })
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome do bem" required>
          <Input
            autoFocus
            placeholder="Ex.: Apartamento"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo">
            <Select
              value={form.type}
              onChange={(e) => set({ type: e.target.value })}
              options={Object.entries(ASSET_TYPES).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Valor atual" required>
            <MoneyInput value={form.value} onChange={(cents) => set({ value: cents })} />
          </Field>
        </div>
        <Field label="Data de aquisição">
          <Input type="date" value={form.acquisition_date} onChange={(e) => set({ acquisition_date: e.target.value })} />
        </Field>
        <Field label="Observações">
          <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function LiabilityForm({ open, onClose, liability, onSaved }) {
  const isEdit = !!liability?.id;
  const [form, setForm] = useState(() =>
    liability
      ? { ...liability, start_date: liability.start_date ?? '', end_date: liability.end_date ?? '' }
      : {
          name: '', type: 'financiamento', total_amount: 0, remaining_amount: 0,
          monthly_payment: 0, interest_rate: 0, start_date: todayISO(), end_date: '', notes: '',
        },
  );
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const mutation = useApiMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/networth/liabilities/${liability.id}`, payload) : api.post('/networth/liabilities', payload),
    invalidate: ['networth'],
    successMessage: isEdit ? 'Dívida atualizada' : 'Dívida cadastrada',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar dívida' : 'Nova dívida'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            loading={mutation.isPending}
            disabled={!form.name.trim() || form.remaining_amount <= 0}
            onClick={() =>
              mutation.mutate({
                name: form.name.trim(),
                type: form.type,
                total_amount: form.total_amount / 100,
                remaining_amount: form.remaining_amount / 100,
                monthly_payment: form.monthly_payment / 100,
                interest_rate: Number(form.interest_rate) || 0,
                start_date: form.start_date || null,
                end_date: form.end_date || null,
                notes: form.notes || null,
              })
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome da dívida" required>
            <Input
              autoFocus
              placeholder="Ex.: Financiamento do carro"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Tipo">
            <Select
              value={form.type}
              onChange={(e) => set({ type: e.target.value })}
              options={Object.entries(LIABILITY_TYPES).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Valor total" hint="Original">
            <MoneyInput value={form.total_amount} onChange={(cents) => set({ total_amount: cents })} />
          </Field>
          <Field label="Saldo devedor" required>
            <MoneyInput value={form.remaining_amount} onChange={(cents) => set({ remaining_amount: cents })} />
          </Field>
          <Field label="Parcela mensal">
            <MoneyInput value={form.monthly_payment} onChange={(cents) => set({ monthly_payment: cents })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Juros (% a.m.)">
            <Input
              type="number"
              step="0.01"
              min={0}
              value={form.interest_rate}
              onChange={(e) => set({ interest_rate: e.target.value })}
            />
          </Field>
          <Field label="Início">
            <Input type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </Field>
          <Field label="Quitação prevista">
            <Input type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />
          </Field>
        </div>

        <Field label="Observações">
          <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** Simulador livre — o usuário testa aporte e taxa sem alterar dados reais. */
function SimulatorModal({ open, onClose, currentNetWorth, defaultContribution, defaultRate }) {
  const [contribution, setContribution] = useState(defaultContribution ?? 0);
  const [rate, setRate] = useState(((defaultRate ?? 0.008) * 100).toFixed(2));
  const [result, setResult] = useState(null);

  const mutation = useApiMutation({
    mutationFn: () =>
      api.post('/networth/simulate', {
        present_value: currentNetWorth / 100,
        monthly_contribution: contribution / 100,
        monthly_rate: Number(rate) / 100,
        years: [1, 3, 5, 10, 20],
      }),
    successMessage: null,
    onSuccess: (data) => setResult(data.data),
  });

  const annualRate = ((1 + Number(rate) / 100) ** 12 - 1) * 100;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Simulador de patrimônio"
      subtitle="Teste cenários de aporte e rentabilidade"
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Patrimônio atual">
            <Input disabled value={money(currentNetWorth)} className="text-right" />
          </Field>
          <Field label="Aporte mensal">
            <MoneyInput value={contribution} onChange={setContribution} />
          </Field>
          <Field label="Rentabilidade (% a.m.)" hint={`≈ ${annualRate.toFixed(2)}% ao ano`}>
            <Input type="number" step="0.01" min={0} max={5} value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>

        <Button icon={Calculator} onClick={() => mutation.mutate()} loading={mutation.isPending}>
          Calcular projeção
        </Button>

        {result && (
          <>
            <ProjectionChart scenarios={result.slice(0, 4)} currentValue={currentNetWorth} height={260} />
            <Table
              rows={result}
              rowKey={(r) => r.years}
              columns={[
                {
                  key: 'years',
                  header: 'Prazo',
                  render: (r) => <span className="text-sm text-ink">{r.years} {r.years === 1 ? 'ano' : 'anos'}</span>,
                },
                {
                  key: 'contributed_total',
                  header: 'Total aportado',
                  align: 'right',
                  width: 140,
                  render: (r) => <span className="text-sm text-muted tabular-nums">{money(r.contributed_total)}</span>,
                },
                {
                  key: 'interest_earned',
                  header: 'Juros ganhos',
                  align: 'right',
                  width: 140,
                  render: (r) => <span className="text-sm text-positive tabular-nums">{money(r.interest_earned)}</span>,
                },
                {
                  key: 'future_value',
                  header: 'Patrimônio final',
                  align: 'right',
                  width: 150,
                  render: (r) => <span className="font-semibold text-ink tabular-nums">{money(r.future_value)}</span>,
                },
              ]}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

export default function NetWorth() {
  const [assetForm, setAssetForm] = useState({ open: false, item: null });
  const [liabilityForm, setLiabilityForm] = useState({ open: false, item: null });
  const [deleting, setDeleting] = useState(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['networth'],
    queryFn: () => api.get('/networth', { months: 12 }),
  });

  const deleteAsset = useApiMutation({
    mutationFn: (id) => api.del(`/networth/assets/${id}`),
    invalidate: ['networth'],
    successMessage: 'Bem excluído',
    onSuccess: () => setDeleting(null),
  });

  const deleteLiability = useApiMutation({
    mutationFn: (id) => api.del(`/networth/liabilities/${id}`),
    invalidate: ['networth'],
    successMessage: 'Dívida excluída',
    onSuccess: () => setDeleting(null),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-32 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const s = data.summary;
  const projection = data.projection;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Minha vida financeira"
        subtitle="Tudo o que você tem, tudo o que você deve e para onde isso vai"
        actions={
          <Button variant="outline" icon={Calculator} onClick={() => setSimulatorOpen(true)}>
            Simular cenários
          </Button>
        }
      />

      {/* ---------- Equação do patrimônio ---------- */}
      <Card className="bg-brand/5 border-brand/20">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4">
          <div className="flex-1 text-center lg:text-left">
            <p className="text-xs text-muted uppercase tracking-wide font-medium">Patrimônio total</p>
            <p className="text-2xl sm:text-3xl font-semibold text-ink mt-1">{money(s.total_assets)}</p>
            <p className="text-xs text-muted mt-0.5">contas + investimentos + bens</p>
          </div>

          <div className="flex items-center justify-center text-muted">
            <Minus size={20} />
          </div>

          <div className="flex-1 text-center lg:text-left">
            <p className="text-xs text-muted uppercase tracking-wide font-medium">Dívidas</p>
            <p className="text-2xl sm:text-3xl font-semibold text-negative mt-1">{money(s.total_debts)}</p>
            <p className="text-xs text-muted mt-0.5">financiamentos + faturas em aberto</p>
          </div>

          <div className="flex items-center justify-center text-muted">
            <Equal size={20} />
          </div>

          <div className="flex-1 text-center lg:text-left">
            <p className="text-xs text-muted uppercase tracking-wide font-medium">Patrimônio líquido</p>
            <p className={cx('text-2xl sm:text-3xl font-semibold mt-1', s.net_worth >= 0 ? 'text-positive' : 'text-negative')}>
              {money(s.net_worth)}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {s.growth_period_amount >= 0 ? '+' : ''}
              {money(s.growth_period_amount)} nos últimos 12 meses
            </p>
          </div>
        </div>

        {s.total_assets > 0 && (
          <div className="mt-5 pt-4 border-t border-brand/20">
            <div className="flex justify-between text-xs text-muted mb-1.5">
              <span>Endividamento sobre o patrimônio</span>
              <span className={cx('font-medium', s.debt_ratio > 50 ? 'text-negative' : 'text-ink')}>
                {percent(s.debt_ratio)}
              </span>
            </div>
            <ProgressBar value={s.debt_ratio} height={8} color={s.debt_ratio > 50 ? 'rgb(var(--negative))' : 'rgb(var(--positive))'} />
          </div>
        )}
      </Card>

      {/* ---------- Composição ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Contas e carteiras" value={money(s.cash_total)} icon={Wallet} />
        <Stat
          label="Investimentos"
          value={money(s.investments_total)}
          icon={LineChart}
          tone="brand"
          hint={`${money(s.investments_total - s.investments_invested)} de retorno`}
        />
        <Stat label="Bens" value={money(s.physical_assets_total)} icon={Home} />
        <Stat
          label="Faturas em aberto"
          value={money(s.open_invoices_total)}
          tone={s.open_invoices_total > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* ---------- Projeções ---------- */}
      <Card>
        <CardHeader
          title="Para onde isso vai"
          subtitle={`Mantendo ${money(projection.monthly_contribution)} por mês a ${percent(projection.monthly_rate * 100, 2)} a.m. (${percent(projection.annual_rate_pct)} a.a.)`}
          icon={TrendingUp}
          action={
            <Button size="sm" variant="outline" icon={Calculator} onClick={() => setSimulatorOpen(true)}>
              Ajustar
            </Button>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {projection.scenarios.map((scenario) => (
            <div key={scenario.years} className="rounded-xl border border-line p-4">
              <p className="text-xs text-muted">
                Em {scenario.years} {scenario.years === 1 ? 'ano' : 'anos'}
              </p>
              <p className="text-xl font-semibold text-ink mt-1">{money(scenario.future_value)}</p>
              <div className="flex items-center gap-1.5 mt-2 text-xs">
                <ArrowRight size={12} className="text-positive" />
                <span className="text-positive font-medium">
                  +{money(scenario.future_value - s.net_worth)}
                </span>
                <span className="text-muted">({percent(scenario.growth_pct)})</span>
              </div>
              <p className="text-xs text-muted mt-1.5">
                {money(scenario.contributed_total)} aportados · {money(scenario.interest_earned)} em juros
              </p>
            </div>
          ))}
        </div>

        <ProjectionChart scenarios={projection.scenarios} currentValue={s.net_worth} height={260} />

        <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 mt-4">
          <Info size={15} className="text-muted shrink-0 mt-0.5" />
          <p className="text-xs text-muted leading-relaxed">
            O aporte mensal usado é o maior valor entre a sobra média de caixa
            ({money(data.savings.cash_savings_avg)}) e os aportes efetivos em investimentos
            ({money(data.savings.invested_avg)}) dos últimos {data.savings.months} meses.
            A projeção é uma estimativa de juros compostos — não é garantia de rentabilidade.
          </p>
        </div>
      </Card>

      {/* ---------- Evolução e composição ---------- */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader title="Evolução do patrimônio" subtitle="Últimos 12 meses" />
          <NetWorthChart data={data.evolution} height={300} />
        </Card>

        <Card>
          <CardHeader title="Composição dos ativos" />
          <DonutChart
            data={data.composition.assets.map((a) => ({ name: a.label, total: a.value, color: a.color }))}
            centerLabel="Total"
            centerValue={s.total_assets}
          />
        </Card>
      </div>

      {/* ---------- Bens ---------- */}
      <Card>
        <CardHeader
          title="Bens"
          subtitle="Imóveis, veículos e outros patrimônios físicos"
          icon={Home}
          action={
            <Button size="sm" icon={Plus} onClick={() => setAssetForm({ open: true, item: null })}>
              Novo bem
            </Button>
          }
        />
        <Table
          rows={data.assets}
          empty={
            <EmptyState
              icon={Home}
              title="Nenhum bem cadastrado"
              message="Cadastre imóveis, veículos e equipamentos para completar seu patrimônio."
              action={<Button icon={Plus} onClick={() => setAssetForm({ open: true, item: null })}>Cadastrar bem</Button>}
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Bem',
              render: (r) => {
                const Icon = ASSET_ICONS[r.type] ?? Gem;
                return (
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon size={16} className="text-muted shrink-0" />
                    <span className="min-w-0">
                      <span className="text-sm text-ink block truncate">{r.name}</span>
                      <span className="text-xs text-muted">{ASSET_TYPES[r.type]}</span>
                    </span>
                  </span>
                );
              },
            },
            {
              key: 'acquisition_date',
              header: 'Aquisição',
              width: 120,
              render: (r) => <span className="text-sm text-muted">{r.acquisition_date ? fmtDate(r.acquisition_date) : '—'}</span>,
            },
            {
              key: 'value',
              header: 'Valor',
              align: 'right',
              width: 140,
              render: (r) => <span className="font-medium text-ink tabular-nums">{money(r.value)}</span>,
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
                  <DropdownItem icon={Pencil} onClick={() => setAssetForm({ open: true, item: r })}>
                    Editar
                  </DropdownItem>
                  <DropdownDivider />
                  <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting({ kind: 'asset', item: r })}>
                    Excluir
                  </DropdownItem>
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>

      {/* ---------- Dívidas ---------- */}
      <Card>
        <CardHeader
          title="Dívidas e financiamentos"
          subtitle="Saldo devedor e progresso de quitação"
          icon={Landmark}
          action={
            <Button size="sm" icon={Plus} onClick={() => setLiabilityForm({ open: true, item: null })}>
              Nova dívida
            </Button>
          }
        />
        <Table
          rows={data.liabilities}
          empty={
            <EmptyState
              icon={Landmark}
              title="Nenhuma dívida cadastrada"
              message="Se você não tem dívidas, ótimo. Caso tenha, cadastre para ver o patrimônio líquido real."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Dívida',
              render: (r) => (
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">{r.name}</p>
                  <p className="text-xs text-muted">
                    {LIABILITY_TYPES[r.type]}
                    {r.interest_rate > 0 && ` · ${r.interest_rate}% a.m.`}
                  </p>
                </div>
              ),
            },
            {
              key: 'monthly_payment',
              header: 'Parcela',
              align: 'right',
              width: 110,
              render: (r) => (
                <span className="text-sm text-muted tabular-nums">
                  {r.monthly_payment > 0 ? money(r.monthly_payment) : '—'}
                </span>
              ),
            },
            {
              key: 'progress',
              header: 'Quitado',
              width: 140,
              render: (r) =>
                r.total_amount > 0 ? (
                  <div>
                    <ProgressBar value={r.paid_pct} height={6} color="rgb(var(--positive))" />
                    <p className="text-xs text-muted mt-1">{percent(r.paid_pct)}</p>
                  </div>
                ) : (
                  <span className="text-sm text-muted">—</span>
                ),
            },
            {
              key: 'remaining_amount',
              header: 'Saldo devedor',
              align: 'right',
              width: 140,
              render: (r) => <span className="font-medium text-negative tabular-nums">{money(r.remaining_amount)}</span>,
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
                  <DropdownItem icon={Pencil} onClick={() => setLiabilityForm({ open: true, item: r })}>
                    Editar
                  </DropdownItem>
                  <DropdownDivider />
                  <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting({ kind: 'liability', item: r })}>
                    Excluir
                  </DropdownItem>
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>

      <AssetForm
        key={`asset-${assetForm.item?.id ?? 'new'}`}
        open={assetForm.open}
        onClose={() => setAssetForm({ open: false, item: null })}
        asset={assetForm.item}
        onSaved={refetch}
      />

      <LiabilityForm
        key={`liability-${liabilityForm.item?.id ?? 'new'}`}
        open={liabilityForm.open}
        onClose={() => setLiabilityForm({ open: false, item: null })}
        liability={liabilityForm.item}
        onSaved={refetch}
      />

      <SimulatorModal
        key={simulatorOpen ? 'sim-open' : 'sim-closed'}
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        currentNetWorth={s.net_worth}
        defaultContribution={projection.monthly_contribution}
        defaultRate={projection.monthly_rate}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting.kind === 'asset'
            ? deleteAsset.mutate(deleting.item.id)
            : deleteLiability.mutate(deleting.item.id)
        }
        loading={deleteAsset.isPending || deleteLiability.isPending}
        title={deleting?.kind === 'asset' ? 'Excluir bem' : 'Excluir dívida'}
        message={`Excluir "${deleting?.item?.name}"? O cálculo do patrimônio será atualizado.`}
      />
    </div>
  );
}
