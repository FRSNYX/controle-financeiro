import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, tokens, ApiError } from '../lib/api';
import { monthKey, monthRange, todayISO } from '../lib/format';

// ==============================================================
// React Query
// ==============================================================
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Repetir uma chamada negada por 401/403/404 só atrasa o erro na tela.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) && failureCount < 2,
    },
  },
});

// ==============================================================
// Tema
// ==============================================================
const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);

function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('fin.theme');
    if (saved) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('fin.theme', theme);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, isDark: theme === 'dark', toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), setTheme }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ==============================================================
// Avisos (toasts)
// ==============================================================
const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const remove = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message, type = 'info', duration = 4000) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, type }]);
      if (duration) setTimeout(() => remove(id), duration);
      return id;
    },
    [remove],
  );

  const value = useMemo(
    () => ({
      toasts,
      remove,
      show: push,
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error', 6000),
      warning: (m) => push(m, 'warning'),
      info: (m) => push(m, 'info'),
    }),
    [toasts, push, remove],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

// ==============================================================
// Autenticação
// ==============================================================
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => tokens.user);
  const [loading, setLoading] = useState(!!tokens.access);

  // Valida a sessão guardada: um token no localStorage pode já ter sido revogado.
  useEffect(() => {
    if (!tokens.access) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => {
        tokens.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // O interceptor de refresh avisa quando a sessão morreu de vez.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    tokens.save(data);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const data = await api.post('/auth/register', { name, email, password });
    tokens.save(data);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokens.refresh });
    } catch {
      // Sair localmente é o que importa; falha no servidor não deve travar.
    }
    tokens.clear();
    setUser(null);
    queryClient.clear();
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((u) => {
      const next = { ...u, ...patch };
      tokens.save({ user: next });
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, updateUser, isAuthenticated: !!user }),
    [user, loading, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ==============================================================
// Período global — o seletor do topo comanda todas as telas
// ==============================================================
const PeriodContext = createContext(null);
export const usePeriod = () => useContext(PeriodContext);

function PeriodProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem('fin.periodMode') ?? 'month');
  const [month, setMonth] = useState(() => localStorage.getItem('fin.month') ?? monthKey());
  const [year, setYear] = useState(() => Number(localStorage.getItem('fin.year')) || new Date().getFullYear());
  const [custom, setCustom] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('fin.custom') ?? 'null') ?? monthRange(monthKey());
    } catch {
      return monthRange(monthKey());
    }
  });

  useEffect(() => {
    localStorage.setItem('fin.periodMode', mode);
    localStorage.setItem('fin.month', month);
    localStorage.setItem('fin.year', String(year));
    localStorage.setItem('fin.custom', JSON.stringify(custom));
  }, [mode, month, year, custom]);

  // Um único intervalo derivado do modo — as telas só consomem `range`.
  const range = useMemo(() => {
    if (mode === 'month') return monthRange(month);
    if (mode === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
    return custom;
  }, [mode, month, year, custom]);

  const label = useMemo(() => {
    if (mode === 'month') {
      const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      const [y, m] = month.split('-');
      return `${MESES[Number(m) - 1]} ${y}`;
    }
    if (mode === 'year') return `Ano de ${year}`;
    const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    return `${br(custom.from)} a ${br(custom.to)}`;
  }, [mode, month, year, custom]);

  const value = useMemo(
    () => ({
      mode, setMode, month, setMonth, year, setYear, custom, setCustom,
      range, label,
      isCurrentMonth: mode === 'month' && month === monthKey(todayISO()),
    }),
    [mode, month, year, custom, range, label],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

// ==============================================================
export function AppProviders({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <PeriodProvider>{children}</PeriodProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
