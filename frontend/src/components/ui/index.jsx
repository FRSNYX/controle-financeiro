import { useEffect, useRef, useState, createContext, useContext, useId } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, Search, AlertTriangle, Check, Info, TriangleAlert, Loader2, Inbox } from 'lucide-react';
import { useToast } from '../../context/AppProviders';
import { money, parseMoney, moneyPlain } from '../../lib/format';

export const cx = (...classes) => classes.filter(Boolean).join(' ');

// ==============================================================
// Botão
// ==============================================================
const BUTTON_VARIANTS = {
  primary: 'bg-brand text-white hover:opacity-90 shadow-sm',
  secondary: 'bg-surface-2 text-ink hover:bg-line',
  outline: 'border border-line bg-transparent text-ink hover:bg-surface-2',
  ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-negative text-white hover:opacity-90',
  success: 'bg-positive text-white hover:opacity-90',
};

const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-9 w-9 justify-center',
};

export function Button({
  variant = 'primary', size = 'md', loading = false, icon: Icon,
  className, children, disabled, ...props
}) {
  return (
    <button
      className={cx(
        'inline-flex items-center rounded-lg font-medium transition-all',
        'disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]',
        BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

// ==============================================================
// Cartão
// ==============================================================
export function Card({ className, children, ...props }) {
  return (
    <div className={cx('card p-4 sm:p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon: Icon, className }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 mb-4', className)}>
      <div className="min-w-0">
        <h3 className="font-semibold text-ink flex items-center gap-2 text-[15px]">
          {Icon && <Icon size={17} className="text-brand shrink-0" />}
          <span className="truncate">{title}</span>
        </h3>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ==============================================================
// Campos de formulário
// ==============================================================
export function Field({ label, hint, error, required, children, className }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-xs font-medium text-muted">
          {label}
          {required && <span className="text-negative ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="text-xs text-negative">{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </div>
  );
}

const INPUT_BASE =
  'w-full h-10 px-3 rounded-lg border border-line bg-surface text-ink text-sm ' +
  'placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none ' +
  'transition disabled:opacity-60 disabled:cursor-not-allowed';

export function Input({ className, ...props }) {
  return <input className={cx(INPUT_BASE, className)} {...props} />;
}

export function Textarea({ className, rows = 3, ...props }) {
  return <textarea rows={rows} className={cx(INPUT_BASE, 'h-auto py-2 resize-y', className)} {...props} />;
}

export function Select({ className, options = [], placeholder, children, ...props }) {
  return (
    <div className="relative">
      <select
        className={cx(INPUT_BASE, 'appearance-none pr-9 cursor-pointer', className)}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children ??
          options.map((o) => (
            <option key={o.value ?? o} value={o.value ?? o}>
              {o.label ?? o}
            </option>
          ))}
      </select>
      <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
    </div>
  );
}

/**
 * Campo de dinheiro.
 * Guarda CENTAVOS no estado do formulário e mostra o texto formatado;
 * enquanto o campo está focado, respeita o que o usuário está digitando.
 */
export function MoneyInput({ value, onChange, className, ...props }) {
  const [text, setText] = useState(() => (value ? moneyPlain(value) : ''));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value ? moneyPlain(value) : '');
  }, [value, focused]);

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">R$</span>
      <input
        type="text"
        inputMode="decimal"
        className={cx(INPUT_BASE, 'pl-9 text-right font-medium', className)}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(value ? moneyPlain(value) : '');
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,-]/g, '');
          setText(raw);
          onChange?.(parseMoney(raw));
        }}
        placeholder="0,00"
        {...props}
      />
    </div>
  );
}

export function Checkbox({ label, checked, onChange, hint, disabled }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cx('flex items-start gap-2.5 cursor-pointer select-none', disabled && 'opacity-60 cursor-not-allowed')}
    >
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-line text-brand accent-[rgb(var(--brand))] cursor-pointer"
      />
      <span className="min-w-0">
        <span className="text-sm text-ink block">{label}</span>
        {hint && <span className="text-xs text-muted block mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Buscar...', className }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        className={cx(INPUT_BASE, 'pl-9')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
          aria-label="Limpar busca"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ==============================================================
// Selo
// ==============================================================
export function Badge({ children, className, tone = 'neutral', dot }) {
  const TONES = {
    neutral: 'bg-surface-2 text-muted',
    brand: 'bg-brand/10 text-brand',
    positive: 'bg-positive/10 text-positive',
    negative: 'bg-negative/10 text-negative',
    warning: 'bg-warn/10 text-warn',
    info: 'bg-info/10 text-info',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap',
        TONES[tone], className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ==============================================================
// Modal
// ==============================================================
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  const SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    // Trava o scroll do fundo enquanto o modal está aberto.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative w-full bg-surface border border-line shadow-2xl animate-in',
          'rounded-t-2xl sm:rounded-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col',
          SIZES[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-line shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink truncate">{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:bg-surface-2 hover:text-ink shrink-0"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-line bg-surface-2/40 shrink-0 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmação antes de excluir — nunca apaga sem perguntar. */
export function ConfirmDialog({
  open, onClose, onConfirm, title = 'Confirmar exclusão',
  message, confirmLabel = 'Excluir', tone = 'danger', loading,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div
          className={cx(
            'h-10 w-10 rounded-full flex items-center justify-center shrink-0',
            tone === 'danger' ? 'bg-negative/10 text-negative' : 'bg-warn/10 text-warn',
          )}
        >
          <AlertTriangle size={20} />
        </div>
        <p className="text-sm text-ink leading-relaxed pt-2">{message}</p>
      </div>
    </Modal>
  );
}

// ==============================================================
// Tabela
// ==============================================================
export function Table({ columns, rows, onRowClick, empty, loading, rowKey = (r) => r.id, footer }) {
  if (loading) return <TableSkeleton columns={columns.length} />;
  if (!rows?.length) return empty ?? <EmptyState title="Nenhum registro encontrado" />;

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cx(
                  'text-left font-medium text-muted text-xs uppercase tracking-wide py-2.5 px-3 whitespace-nowrap',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.className,
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cx(
                'border-b border-line/60 last:border-0',
                onRowClick && 'cursor-pointer hover:bg-surface-2/60 transition-colors',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cx(
                    'py-2.5 px-3 text-ink',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.cellClassName,
                  )}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="border-t-2 border-line font-medium">{footer}</tfoot>}
      </table>
    </div>
  );
}

function TableSkeleton({ columns = 5, rows = 6 }) {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: columns }).map((_, j) => (
            <div key={j} className="skeleton h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onChange }) {
  if (!totalPages || totalPages <= 1) {
    return total ? <p className="text-xs text-muted py-3">{total} registro(s)</p> : null;
  }
  return (
    <div className="flex items-center justify-between gap-3 pt-4 flex-wrap">
      <p className="text-xs text-muted">
        Página {page} de {totalPages} · {total} registro(s)
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          Anterior
        </Button>
        <Button size="sm" variant="outline" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

// ==============================================================
// Estados
// ==============================================================
export function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="h-12 w-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
        <Icon size={22} className="text-muted" />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {message && <p className="text-sm text-muted mt-1 max-w-sm">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 20, className }) {
  return <Loader2 size={size} className={cx('animate-spin text-brand', className)} />;
}

export function PageLoader({ label = 'Carregando...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Spinner size={28} />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Não foi possível carregar"
      message={error?.message ?? 'Tente novamente em instantes.'}
      action={onRetry && <Button variant="outline" onClick={onRetry}>Tentar novamente</Button>}
    />
  );
}

// ==============================================================
// Barra de progresso
// ==============================================================
export function ProgressBar({ value, color, height = 8, showLabel = false, className }) {
  const clamped = Math.min(100, Math.max(0, Number(value) || 0));
  // O tom muda sozinho conforme o consumo: 80% amarelo, 100% vermelho.
  const tone = color ?? (clamped >= 100 ? 'rgb(var(--negative))' : clamped >= 80 ? 'rgb(var(--warning))' : 'rgb(var(--positive))');

  return (
    <div className={className}>
      <div className="w-full rounded-full bg-surface-2 overflow-hidden" style={{ height }}>
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: tone }}
        />
      </div>
      {showLabel && <p className="text-xs text-muted mt-1">{clamped.toFixed(1)}%</p>}
    </div>
  );
}

// ==============================================================
// Abas
// ==============================================================
export function Tabs({ tabs, active, onChange, className }) {
  return (
    <div className={cx('flex gap-1 p-1 bg-surface-2 rounded-lg overflow-x-auto', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            'px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1.5',
            active === tab.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {tab.icon && <tab.icon size={14} />}
          {tab.label}
          {tab.count !== undefined && (
            <span className="text-xs opacity-60">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ==============================================================
// Indicador
// ==============================================================
export function Stat({ label, value, hint, tone = 'neutral', icon: Icon, trend, className, onClick }) {
  const TONES = {
    neutral: 'text-ink',
    positive: 'text-positive',
    negative: 'text-negative',
    brand: 'text-brand',
    warning: 'text-warn',
    info: 'text-info',
  };

  return (
    <div
      className={cx('card p-4 flex flex-col gap-1', onClick && 'cursor-pointer hover:border-brand/40 transition-colors', className)}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted font-medium">{label}</span>
        {Icon && <Icon size={15} className="text-muted shrink-0" />}
      </div>
      <span className={cx('text-xl font-semibold tracking-tight', TONES[tone])}>{value}</span>
      <div className="flex items-center gap-2 min-h-[16px]">
        {trend !== undefined && trend !== null && Number.isFinite(trend) && (
          <span className={cx('text-xs font-medium', trend >= 0 ? 'text-positive' : 'text-negative')}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
        {hint && <span className="text-xs text-muted truncate">{hint}</span>}
      </div>
    </div>
  );
}

// ==============================================================
// Avisos flutuantes
// ==============================================================
export function ToastViewport() {
  const { toasts, remove } = useToast();

  const ICONS = { success: Check, error: TriangleAlert, warning: AlertTriangle, info: Info };
  const TONES = {
    success: 'border-positive/40 bg-positive/10 text-positive',
    error: 'border-negative/40 bg-negative/10 text-negative',
    warning: 'border-warn/40 bg-warn/10 text-warn',
    info: 'border-info/40 bg-info/10 text-info',
  };

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] sm:max-w-sm">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type] ?? Info;
        return (
          <div
            key={toast.id}
            role="status"
            className={cx(
              'flex items-start gap-2.5 px-3.5 py-3 rounded-lg border shadow-lg animate-in',
              'bg-surface backdrop-blur', TONES[toast.type],
            )}
          >
            <Icon size={16} className="shrink-0 mt-0.5" />
            <p className="text-sm flex-1 text-ink break-words">{toast.message}</p>
            <button onClick={() => remove(toast.id)} className="text-muted hover:text-ink shrink-0" aria-label="Fechar">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

// ==============================================================
// Menu suspenso
// ==============================================================
export function Dropdown({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cx(
            'absolute mt-1 min-w-[180px] rounded-lg border border-line bg-surface shadow-xl z-40 py-1 animate-in',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ icon: Icon, children, onClick, tone = 'neutral', disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
        'hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed',
        tone === 'danger' ? 'text-negative' : 'text-ink',
      )}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export const DropdownDivider = () => <div className="h-px bg-line my-1" />;

// ==============================================================
// Cabeçalho de página
// ==============================================================
export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="flex flex-col gap-4 mb-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Célula de valor com cor por natureza — receita verde, despesa vermelha. */
export function Amount({ cents, kind, className, showSign = false }) {
  const isIncome = kind === 'income';
  return (
    <span
      className={cx(
        'font-medium tabular-nums',
        kind ? (isIncome ? 'text-positive' : 'text-negative') : 'text-ink',
        className,
      )}
    >
      {showSign && kind ? (isIncome ? '+' : '−') : ''}
      {money(cents)}
    </span>
  );
}
