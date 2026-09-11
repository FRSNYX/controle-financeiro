import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, TrendingUp, TrendingDown, Wallet, ArrowLeftRight, CreditCard,
  LineChart, PiggyBank, Target, CalendarDays, FileBarChart, History, Gem,
  Tags, Settings, Menu, X, Sun, Moon, LogOut, Search, Bell, ChevronLeft,
  ChevronRight, User, Calendar,
} from 'lucide-react';
import { useAuth, useTheme, usePeriod } from '../../context/AppProviders';
import { api } from '../../lib/api';
import { Button, Dropdown, DropdownItem, DropdownDivider, Badge, cx, Modal, Input } from '../ui';
import { money, date as fmtDate, monthKey, addMonthKey, todayISO } from '../../lib/format';

const NAV_GROUPS = [
  {
    label: 'Visão geral',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/vida-financeira', icon: Gem, label: 'Minha vida financeira' },
      { to: '/calendario', icon: CalendarDays, label: 'Calendário' },
    ],
  },
  {
    label: 'Movimentações',
    items: [
      { to: '/receitas', icon: TrendingUp, label: 'Receitas' },
      { to: '/despesas', icon: TrendingDown, label: 'Despesas' },
      { to: '/transferencias', icon: ArrowLeftRight, label: 'Transferências' },
    ],
  },
  {
    label: 'Patrimônio',
    items: [
      { to: '/contas', icon: Wallet, label: 'Contas' },
      { to: '/cartoes', icon: CreditCard, label: 'Cartões' },
      { to: '/investimentos', icon: LineChart, label: 'Investimentos' },
    ],
  },
  {
    label: 'Planejamento',
    items: [
      { to: '/orcamento', icon: PiggyBank, label: 'Orçamento' },
      { to: '/metas', icon: Target, label: 'Metas' },
    ],
  },
  {
    label: 'Análise',
    items: [
      { to: '/relatorios', icon: FileBarChart, label: 'Relatórios' },
      { to: '/historico', icon: History, label: 'Histórico' },
    ],
  },
  {
    label: 'Configurações',
    items: [
      { to: '/categorias', icon: Tags, label: 'Categorias' },
      { to: '/configuracoes', icon: Settings, label: 'Preferências' },
    ],
  },
];

// ==============================================================
// Barra lateral
// ==============================================================
function Sidebar({ open, onClose, collapsed, onToggleCollapse }) {
  return (
    <>
      {/* Véu só no mobile, onde a lateral vira gaveta. */}
      {open && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={onClose} />}

      <aside
        className={cx(
          'fixed lg:sticky top-0 left-0 h-screen bg-surface border-r border-line z-40',
          'flex flex-col transition-[width,transform] duration-200 shrink-0',
          collapsed ? 'lg:w-[68px]' : 'lg:w-60',
          'w-64',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-line shrink-0">
          <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center shrink-0">
            <Wallet size={17} className="text-white" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-ink truncate">
              Controle<span className="text-brand">Financeiro</span>
            </span>
          )}
          <button onClick={onClose} className="ml-auto lg:hidden text-muted hover:text-ink" aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              {!collapsed && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted px-2.5 mb-1.5">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors',
                        collapsed && 'lg:justify-center',
                        isActive
                          ? 'bg-brand/10 text-brand font-medium'
                          : 'text-muted hover:bg-surface-2 hover:text-ink',
                      )
                    }
                  >
                    <item.icon size={17} className="shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex items-center justify-center h-10 border-t border-line text-muted hover:text-ink shrink-0"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </aside>
    </>
  );
}

// ==============================================================
// Seletor de período — comanda todas as telas
// ==============================================================
function PeriodPicker() {
  const { mode, setMode, month, setMonth, year, setYear, custom, setCustom, label } = usePeriod();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const currentYear = new Date().getFullYear();

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-0.5">
        {mode === 'month' && (
          <button
            onClick={() => setMonth(addMonthKey(month, -1))}
            className="h-9 w-7 flex items-center justify-center rounded-l-lg border border-r-0 border-line text-muted hover:text-ink hover:bg-surface-2"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={15} />
          </button>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className={cx(
            'h-9 px-3 flex items-center gap-2 border border-line text-sm text-ink hover:bg-surface-2 transition-colors',
            mode === 'month' ? 'rounded-none' : 'rounded-lg',
          )}
        >
          <Calendar size={14} className="text-muted" />
          <span className="font-medium whitespace-nowrap">{label}</span>
        </button>
        {mode === 'month' && (
          <button
            onClick={() => setMonth(addMonthKey(month, 1))}
            className="h-9 w-7 flex items-center justify-center rounded-r-lg border border-l-0 border-line text-muted hover:text-ink hover:bg-surface-2"
            aria-label="Próximo mês"
          >
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 mt-1.5 w-72 rounded-xl border border-line bg-surface shadow-xl z-50 p-3 animate-in">
          <div className="flex gap-1 p-1 bg-surface-2 rounded-lg mb-3">
            {[
              { value: 'month', label: 'Mês' },
              { value: 'year', label: 'Ano' },
              { value: 'custom', label: 'Período' },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setMode(tab.value)}
                className={cx(
                  'flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors',
                  mode === tab.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === 'month' && (
            <>
              <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[0, -1, -2].map((offset) => {
                  const key = addMonthKey(monthKey(todayISO()), offset);
                  const NOMES = ['Este mês', 'Mês passado', '2 meses atrás'];
                  return (
                    <button
                      key={key}
                      onClick={() => { setMonth(key); setOpen(false); }}
                      className="px-2 py-1 rounded-md text-xs bg-surface-2 text-muted hover:text-ink"
                    >
                      {NOMES[-offset]}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {mode === 'year' && (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 6 }, (_, i) => currentYear - i).map((y) => (
                <button
                  key={y}
                  onClick={() => { setYear(y); setOpen(false); }}
                  className={cx(
                    'py-2 rounded-lg text-sm transition-colors',
                    year === y ? 'bg-brand text-white' : 'bg-surface-2 text-muted hover:text-ink',
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          {mode === 'custom' && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs text-muted">De</span>
                <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Até</span>
                <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </label>
              <Button size="sm" className="w-full" onClick={() => setOpen(false)}>
                Aplicar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==============================================================
// Busca global
// ==============================================================
function GlobalSearch({ open, onClose }) {
  const [term, setTerm] = useState('');
  const navigate = useNavigate();

  const { data, isFetching } = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.get('/history/search', { q: term }),
    enabled: term.trim().length >= 2,
  });

  useEffect(() => {
    if (!open) setTerm('');
  }, [open]);

  const go = (path) => {
    onClose();
    navigate(path);
  };

  const groups = [
    { key: 'transactions', label: 'Lançamentos', path: (i) => (i.kind === 'income' ? '/receitas' : '/despesas') },
    { key: 'accounts', label: 'Contas', path: () => '/contas' },
    { key: 'categories', label: 'Categorias', path: () => '/categorias' },
    { key: 'cards', label: 'Cartões', path: () => '/cartoes' },
    { key: 'investments', label: 'Investimentos', path: () => '/investimentos' },
    { key: 'goals', label: 'Metas', path: () => '/metas' },
  ];

  const hasResults = groups.some((g) => data?.results?.[g.key]?.length);

  return (
    <Modal open={open} onClose={onClose} title="Busca geral" size="md">
      <Input
        autoFocus
        placeholder="Buscar lançamentos, contas, categorias, investimentos..."
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />

      <div className="mt-4 space-y-4 min-h-[120px]">
        {term.trim().length < 2 && (
          <p className="text-sm text-muted text-center py-8">Digite ao menos 2 caracteres para buscar.</p>
        )}
        {term.trim().length >= 2 && isFetching && (
          <p className="text-sm text-muted text-center py-8">Buscando...</p>
        )}
        {term.trim().length >= 2 && !isFetching && !hasResults && (
          <p className="text-sm text-muted text-center py-8">Nada encontrado para "{term}".</p>
        )}

        {groups.map((group) => {
          const items = data?.results?.[group.key] ?? [];
          if (!items.length) return null;
          return (
            <div key={group.key}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">{group.label}</p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button
                    key={`${group.key}-${item.id}`}
                    onClick={() => go(group.path(item))}
                    className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg hover:bg-surface-2 text-left"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {item.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: item.color }} />}
                      <span className="text-sm text-ink truncate">{item.description ?? item.name}</span>
                    </span>
                    {item.amount !== undefined && (
                      <span className="text-xs text-muted shrink-0">
                        {money(item.amount)} · {fmtDate(item.due_date)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ==============================================================
// Notificações
// ==============================================================
function NotificationBell() {
  const navigate = useNavigate();
  const { data, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/history/notifications', { limit: 12 }),
    refetchInterval: 5 * 60 * 1000,
  });

  const unread = data?.unread_count ?? 0;

  const markRead = async () => {
    await api.post('/history/notifications/read', {});
    refetch();
  };

  return (
    <Dropdown
      trigger={
        <button className="relative h-9 w-9 flex items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Notificações">
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-negative text-white text-[10px] font-medium flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      }
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-line">
        <span className="text-sm font-medium text-ink">Notificações</span>
        {unread > 0 && (
          <button onClick={markRead} className="text-xs text-brand hover:underline">
            Marcar lidas
          </button>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto w-80">
        {!data?.data?.length && <p className="text-sm text-muted text-center py-6">Nada por aqui.</p>}
        {data?.data?.map((n) => (
          <button
            key={n.id}
            onClick={() => navigate(n.entity === 'transactions' ? '/despesas' : '/')}
            className={cx('w-full text-left px-3 py-2.5 hover:bg-surface-2 border-b border-line/50 last:border-0',
              !n.read_at && 'bg-brand/5')}
          >
            <div className="flex items-start gap-2">
              <span
                className={cx('h-1.5 w-1.5 rounded-full mt-1.5 shrink-0',
                  n.severity === 'danger' ? 'bg-negative' : n.severity === 'warning' ? 'bg-warn' : 'bg-info')}
              />
              <div className="min-w-0">
                <p className="text-sm text-ink leading-snug">{n.title}</p>
                {n.message && <p className="text-xs text-muted mt-0.5">{n.message}</p>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Dropdown>
  );
}

// ==============================================================
// Topo
// ==============================================================
function Topbar({ onMenu }) {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();

  // Ctrl/Cmd+K abre a busca de qualquer tela.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 h-14 bg-surface/85 backdrop-blur border-b border-line flex items-center gap-2 px-3 sm:px-4 shrink-0">
        <button onClick={onMenu} className="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg text-muted hover:bg-surface-2" aria-label="Abrir menu">
          <Menu size={18} />
        </button>

        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line text-muted hover:bg-surface-2 text-sm min-w-0"
        >
          <Search size={15} />
          <span className="hidden sm:inline">Buscar</span>
          <kbd className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-line ml-2">Ctrl K</kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <PeriodPicker />
          <NotificationBell />
          <button
            onClick={toggle}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            aria-label={isDark ? 'Tema claro' : 'Tema escuro'}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <Dropdown
            trigger={
              <button className="h-9 pl-1.5 pr-2 flex items-center gap-2 rounded-lg hover:bg-surface-2">
                <span className="h-7 w-7 rounded-full bg-brand text-white text-xs font-semibold flex items-center justify-center">
                  {user?.name?.charAt(0).toUpperCase() ?? '?'}
                </span>
                <span className="hidden sm:block text-sm text-ink max-w-[100px] truncate">
                  {user?.name?.split(' ')[0]}
                </span>
              </button>
            }
          >
            <div className="px-3 py-2 border-b border-line">
              <p className="text-sm font-medium text-ink truncate">{user?.name}</p>
              <p className="text-xs text-muted truncate">{user?.email}</p>
            </div>
            <DropdownItem icon={User} onClick={() => navigate('/configuracoes')}>
              Minha conta
            </DropdownItem>
            <DropdownItem icon={isDark ? Sun : Moon} onClick={toggle}>
              Tema {isDark ? 'claro' : 'escuro'}
            </DropdownItem>
            <DropdownDivider />
            <DropdownItem icon={LogOut} tone="danger" onClick={logout}>
              Sair
            </DropdownItem>
          </Dropdown>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

// ==============================================================
export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fin.collapsed') === '1');
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem('fin.collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // Trocar de página rola de volta ao topo.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="flex-1 p-3 sm:p-5 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
