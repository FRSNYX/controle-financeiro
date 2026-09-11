import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Tags, ChevronRight, ChevronDown, Pencil, Trash2, Archive,
  MoreVertical, TrendingUp, TrendingDown, Lock,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Card, CardHeader, Button, Input, Select, Field, Modal, PageHeader, Tabs,
  Dropdown, DropdownItem, DropdownDivider, ConfirmDialog, EmptyState, ErrorState,
  Badge, Stat, cx,
} from '../components/ui';
import { useApiMutation } from '../hooks/useLookups';
import { money, percent } from '../lib/format';

const COLORS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#6b7b8c', '#7d6b8c', '#8c7d6b', '#6b8c85', '#898781', '#7a8c6b', '#8c6b7d',
];

function CategoryForm({ open, onClose, category, kind, parentId, onSaved }) {
  const isEdit = !!category?.id;
  const [form, setForm] = useState(() => ({
    name: category?.name ?? '',
    color: category?.color ?? COLORS[0],
    parent_id: category?.parent_id ?? parentId ?? '',
  }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const mutation = useApiMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/categories/${category.id}`, payload) : api.post('/categories', payload),
    invalidate: ['categories', 'categories-tree', 'category-usage'],
    successMessage: isEdit ? 'Categoria atualizada' : 'Categoria criada',
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
  });

  const isSub = !!form.parent_id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar categoria' : isSub ? 'Nova subcategoria' : 'Nova categoria'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            loading={mutation.isPending}
            disabled={!form.name.trim()}
            onClick={() =>
              mutation.mutate({
                name: form.name.trim(),
                kind,
                color: form.color,
                ...(isEdit ? {} : { parent_id: form.parent_id || null }),
              })
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome" required>
          <Input
            autoFocus
            maxLength={60}
            placeholder={isSub ? 'Ex.: Supermercado' : 'Ex.: Alimentação'}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
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

        {isSub && (
          <p className="text-xs text-muted">
            Subcategorias herdam o tipo da categoria pai e aparecem agrupadas nos relatórios.
          </p>
        )}
      </div>
    </Modal>
  );
}

export default function Categories() {
  const [kind, setKind] = useState('expense');
  const [expanded, setExpanded] = useState(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [parentFor, setParentFor] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['categories-tree', kind],
    queryFn: () => api.get('/categories', { kind }),
  });

  const { data: usage } = useQuery({
    queryKey: ['category-usage'],
    queryFn: () => api.get('/categories/usage'),
  });

  const deleteMutation = useApiMutation({
    mutationFn: (id) => api.del(`/categories/${id}`),
    invalidate: ['categories', 'categories-tree', 'category-usage'],
    successMessage: 'Categoria excluída',
    onSuccess: () => setDeleting(null),
  });

  const archiveMutation = useApiMutation({
    mutationFn: ({ id, archived }) => api.patch(`/categories/${id}`, { archived }),
    invalidate: ['categories', 'categories-tree'],
    successMessage: 'Categoria atualizada',
  });

  const toggle = (id) =>
    setExpanded((set) => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const categories = data?.data ?? [];
  const usageById = new Map((usage?.data ?? []).map((u) => [u.id, u]));
  const totalUsage = (usage?.data ?? [])
    .filter((u) => u.kind === kind)
    .reduce((s, u) => s + u.total, 0);

  const openNew = (parent = null) => {
    setEditing(null);
    setParentFor(parent);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Categorias"
        subtitle="Organize seus lançamentos por categoria e subcategoria"
        actions={
          <Button icon={Plus} onClick={() => openNew(null)}>
            Nova categoria
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Categorias" value={categories.length} icon={Tags} />
        <Stat
          label="Subcategorias"
          value={categories.reduce((s, c) => s + c.children.length, 0)}
        />
        <Stat
          label={kind === 'expense' ? 'Total gasto' : 'Total recebido'}
          value={money(totalUsage)}
          tone={kind === 'expense' ? 'negative' : 'positive'}
          hint="Todo o histórico"
        />
      </div>

      <Tabs
        active={kind}
        onChange={(k) => {
          setKind(k);
          setExpanded(new Set());
        }}
        tabs={[
          { value: 'expense', label: 'Despesas', icon: TrendingDown },
          { value: 'income', label: 'Receitas', icon: TrendingUp },
        ]}
      />

      <Card>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-14 rounded-lg" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="Nenhuma categoria"
            message="Crie categorias para organizar seus lançamentos."
            action={<Button icon={Plus} onClick={() => openNew(null)}>Criar categoria</Button>}
          />
        ) : (
          <div className="space-y-1">
            {categories.map((cat) => {
              const isOpen = expanded.has(cat.id);
              const stats = usageById.get(cat.id);
              const share = totalUsage > 0 ? ((stats?.total ?? 0) / totalUsage) * 100 : 0;

              return (
                <div key={cat.id} className="rounded-lg border border-line overflow-hidden">
                  <div
                    className={cx(
                      'flex items-center gap-3 p-3 hover:bg-surface-2/60 transition-colors',
                      cat.archived && 'opacity-50',
                    )}
                  >
                    <button
                      onClick={() => toggle(cat.id)}
                      disabled={!cat.children.length}
                      className={cx('text-muted shrink-0', !cat.children.length && 'opacity-0 cursor-default')}
                      aria-label={isOpen ? 'Recolher' : 'Expandir'}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>

                    <span className="h-3 w-3 rounded-full shrink-0" style={{ background: cat.color }} />

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate flex items-center gap-1.5">
                        {cat.name}
                        {cat.is_system && <Lock size={11} className="text-muted shrink-0" />}
                      </p>
                      <p className="text-xs text-muted">
                        {cat.children.length > 0
                          ? `${cat.children.length} subcategoria(s)`
                          : 'Sem subcategorias'}
                        {stats?.tx_count > 0 && ` · ${stats.tx_count} lançamento(s)`}
                      </p>
                    </div>

                    {stats?.total > 0 && (
                      <div className="text-right shrink-0 hidden sm:block">
                        <p className="text-sm font-medium text-ink tabular-nums">{money(stats.total)}</p>
                        <p className="text-xs text-muted">{percent(share)}</p>
                      </div>
                    )}

                    {cat.archived && <Badge tone="neutral">Arquivada</Badge>}

                    <Dropdown
                      trigger={
                        <button className="p-1.5 rounded-lg text-muted hover:bg-surface-2 shrink-0" aria-label="Ações">
                          <MoreVertical size={15} />
                        </button>
                      }
                    >
                      <DropdownItem icon={Plus} onClick={() => openNew(cat.id)}>
                        Nova subcategoria
                      </DropdownItem>
                      <DropdownItem
                        icon={Pencil}
                        onClick={() => {
                          setEditing(cat);
                          setParentFor(null);
                          setFormOpen(true);
                        }}
                      >
                        Editar
                      </DropdownItem>
                      <DropdownItem
                        icon={Archive}
                        onClick={() => archiveMutation.mutate({ id: cat.id, archived: !cat.archived })}
                      >
                        {cat.archived ? 'Reativar' : 'Arquivar'}
                      </DropdownItem>
                      <DropdownDivider />
                      <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting(cat)}>
                        Excluir
                      </DropdownItem>
                    </Dropdown>
                  </div>

                  {isOpen && cat.children.length > 0 && (
                    <div className="border-t border-line bg-surface-2/30">
                      {cat.children.map((sub) => (
                        <div
                          key={sub.id}
                          className={cx(
                            'flex items-center gap-3 py-2.5 pl-12 pr-3 border-b border-line/40 last:border-0',
                            sub.archived && 'opacity-50',
                          )}
                        >
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: sub.color }} />
                          <span className="text-sm text-ink flex-1 truncate">{sub.name}</span>
                          {sub.archived && <Badge tone="neutral">Arquivada</Badge>}

                          <Dropdown
                            trigger={
                              <button className="p-1 rounded text-muted hover:bg-surface-2 shrink-0" aria-label="Ações">
                                <MoreVertical size={14} />
                              </button>
                            }
                          >
                            <DropdownItem
                              icon={Pencil}
                              onClick={() => {
                                setEditing(sub);
                                setParentFor(null);
                                setFormOpen(true);
                              }}
                            >
                              Editar
                            </DropdownItem>
                            <DropdownItem
                              icon={Archive}
                              onClick={() => archiveMutation.mutate({ id: sub.id, archived: !sub.archived })}
                            >
                              {sub.archived ? 'Reativar' : 'Arquivar'}
                            </DropdownItem>
                            <DropdownDivider />
                            <DropdownItem icon={Trash2} tone="danger" onClick={() => setDeleting(sub)}>
                              Excluir
                            </DropdownItem>
                          </Dropdown>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <CategoryForm
        key={editing?.id ?? `new-${parentFor ?? 'root'}-${kind}`}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        category={editing}
        kind={kind}
        parentId={parentFor}
        onSaved={refetch}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        loading={deleteMutation.isPending}
        title="Excluir categoria"
        message={`Excluir "${deleting?.name}"? Categorias usadas em lançamentos não podem ser excluídas — nesse caso, arquive-a para deixar de oferecê-la sem perder o histórico.`}
      />
    </div>
  );
}
