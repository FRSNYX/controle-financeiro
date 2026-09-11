import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon, Trash2, RotateCcw, Filter, X, Search } from 'lucide-react';
import { api } from '../lib/api';
import {
  Card, CardHeader, Button, Select, Input, Field, SearchInput, Table, Pagination,
  PageHeader, Tabs, Badge, EmptyState, ErrorState, cx,
} from '../components/ui';
import { useApiMutation } from '../hooks/useLookups';
import { money, date as fmtDate, STATUS_STYLES } from '../lib/format';

const ENTITIES = {
  transactions: 'Lançamentos', accounts: 'Contas', categories: 'Categorias',
  credit_cards: 'Cartões', card_invoices: 'Faturas', transfers: 'Transferências',
  investments: 'Investimentos', budgets: 'Orçamentos', goals: 'Metas',
  assets: 'Bens', liabilities: 'Dívidas', users: 'Conta de usuário',
};

const ACTION_TONES = {
  create: 'positive', update: 'info', delete: 'negative',
  restore: 'warning', login: 'neutral', import: 'brand',
};

function AuditTab() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['history', page, entity, action, search],
    queryFn: () =>
      api.get('/history', {
        page,
        pageSize: 30,
        entity: entity || undefined,
        action: action || undefined,
        search: search.trim() || undefined,
      }),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <Card>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <SearchInput
          className="flex-1"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Buscar no histórico..."
        />
        <Select
          className="sm:w-48"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
          placeholder="Todos os módulos"
          options={Object.entries(ENTITIES).map(([value, label]) => ({ value, label }))}
        />
        <Select
          className="sm:w-40"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          placeholder="Todas as ações"
          options={[
            { value: 'create', label: 'Criação' },
            { value: 'update', label: 'Alteração' },
            { value: 'delete', label: 'Exclusão' },
            { value: 'restore', label: 'Restauração' },
            { value: 'import', label: 'Importação' },
            { value: 'login', label: 'Acesso' },
          ]}
        />
      </div>

      <Table
        loading={isLoading}
        rows={data?.data}
        empty={
          <EmptyState
            icon={HistoryIcon}
            title="Nenhum registro no histórico"
            message="Toda criação, alteração e exclusão fica registrada aqui."
          />
        }
        columns={[
          {
            key: 'created_at',
            header: 'Data e hora',
            width: 150,
            render: (r) => (
              <div>
                <p className="text-sm text-ink">{fmtDate(r.date)}</p>
                <p className="text-xs text-muted tabular-nums">{r.time}</p>
              </div>
            ),
          },
          {
            key: 'action',
            header: 'Ação',
            width: 120,
            render: (r) => <Badge tone={ACTION_TONES[r.action] ?? 'neutral'}>{r.action_label}</Badge>,
          },
          {
            key: 'entity',
            header: 'Módulo',
            width: 140,
            render: (r) => <span className="text-sm text-muted">{r.entity_label}</span>,
          },
          {
            key: 'summary',
            header: 'Descrição',
            render: (r) => <span className="text-sm text-ink">{r.summary ?? '—'}</span>,
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
  );
}

function TrashTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['trash', page],
    queryFn: () => api.get('/history/trash', { page, pageSize: 30 }),
  });

  const restoreMutation = useApiMutation({
    mutationFn: (id) => api.post(`/history/trash/${id}/restore`),
    invalidate: ['trash', 'transactions', 'accounts', 'history'],
    successMessage: 'Lançamento restaurado',
    onSuccess: refetch,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <Card>
      <CardHeader
        title="Lixeira"
        subtitle="Lançamentos excluídos continuam aqui e podem ser restaurados"
        icon={Trash2}
      />

      <Table
        loading={isLoading}
        rows={data?.data}
        empty={
          <EmptyState
            icon={Trash2}
            title="Lixeira vazia"
            message="Nenhum lançamento excluído. Ao excluir algo, ele aparece aqui."
          />
        }
        columns={[
          { key: 'due_date', header: 'Vencimento', width: 110, render: (r) => fmtDate(r.due_date) },
          {
            key: 'description',
            header: 'Descrição',
            render: (r) => (
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">{r.description}</p>
                <p className="text-xs text-muted truncate">
                  {r.category_name ?? 'Sem categoria'}
                  {r.installment_label && ` · parcela ${r.installment_label}`}
                </p>
              </div>
            ),
          },
          {
            key: 'kind',
            header: 'Tipo',
            width: 100,
            render: (r) => (
              <Badge tone={r.kind === 'income' ? 'positive' : 'negative'}>
                {r.kind === 'income' ? 'Receita' : 'Despesa'}
              </Badge>
            ),
          },
          {
            key: 'deleted_at',
            header: 'Excluído em',
            width: 150,
            render: (r) => <span className="text-sm text-muted">{r.deleted_at?.slice(0, 16).replace('T', ' ')}</span>,
          },
          {
            key: 'amount',
            header: 'Valor',
            align: 'right',
            width: 120,
            render: (r) => (
              <span className={cx('font-medium tabular-nums', r.kind === 'income' ? 'text-positive' : 'text-negative')}>
                {money(r.amount)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            width: 120,
            align: 'right',
            render: (r) => (
              <Button
                size="sm"
                variant="outline"
                icon={RotateCcw}
                onClick={() => restoreMutation.mutate(r.id)}
                loading={restoreMutation.isPending && restoreMutation.variables === r.id}
              >
                Restaurar
              </Button>
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
  );
}

export default function History() {
  const [tab, setTab] = useState('auditoria');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Histórico"
        subtitle="Registro completo de alterações e lançamentos excluídos"
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'auditoria', label: 'Alterações', icon: HistoryIcon },
          { value: 'lixeira', label: 'Lixeira', icon: Trash2 },
        ]}
      />

      {tab === 'auditoria' ? <AuditTab /> : <TrashTab />}
    </div>
  );
}
