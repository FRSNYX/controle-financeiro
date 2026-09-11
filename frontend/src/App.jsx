import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AppProviders';
import Layout from './components/layout/Layout';
import { PageLoader, ToastViewport } from './components/ui';

import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';

// As telas internas entram sob demanda: o primeiro carregamento fica leve.
const Transactions = lazy(() => import('./pages/Transactions'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Transfers = lazy(() => import('./pages/Transfers'));
const Cards = lazy(() => import('./pages/Cards'));
const Investments = lazy(() => import('./pages/Investments'));
const Budgets = lazy(() => import('./pages/Budgets'));
const Goals = lazy(() => import('./pages/Goals'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Reports = lazy(() => import('./pages/Reports'));
const History = lazy(() => import('./pages/History'));
const NetWorth = lazy(() => import('./pages/NetWorth'));
const Categories = lazy(() => import('./pages/Categories'));
const Settings = lazy(() => import('./pages/Settings'));

function Protected({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader label="Verificando sessão..." />;
  // Guarda de onde o usuário veio para devolvê-lo após o login.
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function PublicOnly({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/cadastro" element={<PublicOnly><Register /></PublicOnly>} />
        <Route path="/recuperar-senha" element={<PublicOnly><ForgotPassword /></PublicOnly>} />

        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route
            path="receitas"
            element={<Suspense fallback={<PageLoader />}><Transactions kind="income" /></Suspense>}
          />
          <Route
            path="despesas"
            element={<Suspense fallback={<PageLoader />}><Transactions kind="expense" /></Suspense>}
          />
          {[
            ['contas', Accounts], ['transferencias', Transfers], ['cartoes', Cards],
            ['investimentos', Investments], ['orcamento', Budgets], ['metas', Goals],
            ['calendario', Calendar], ['relatorios', Reports], ['historico', History],
            ['vida-financeira', NetWorth], ['categorias', Categories], ['configuracoes', Settings],
          ].map(([path, Component]) => (
            <Route
              key={path}
              path={path}
              element={<Suspense fallback={<PageLoader />}><Component /></Suspense>}
            />
          ))}
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ToastViewport />
    </>
  );
}
