import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './modules/auth/index.js';
import accountRoutes from './modules/accounts/index.js';
import categoryRoutes from './modules/categories/index.js';
import transactionRoutes from './modules/transactions/index.js';
import transferRoutes from './modules/transfers/index.js';
import cardRoutes from './modules/cards/index.js';
import investmentRoutes from './modules/investments/index.js';
import budgetRoutes from './modules/budgets/index.js';
import goalRoutes from './modules/goals/index.js';
import calendarRoutes from './modules/calendar/index.js';
import reportRoutes from './modules/reports/index.js';
import dashboardRoutes from './modules/dashboard/index.js';
import networthRoutes from './modules/networth/index.js';
import historyRoutes from './modules/history/index.js';
import dataRoutes from './modules/data/index.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // rate-limit precisa do IP real atrás de proxy

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) =>
        // Sem Origin = chamada de mesma origem ou ferramenta local (curl, Postman).
        !origin || env.corsOrigins.includes(origin)
          ? cb(null, true)
          : cb(new Error(`Origem não permitida: ${origin}`)),
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', service: 'controle-financeiro', time: new Date().toISOString() }),
  );

  // Único ponto público da API.
  app.use('/api/auth', authRoutes);

  // Tudo abaixo exige token válido; requireAuth popula req.user.
  app.use('/api/accounts', requireAuth, accountRoutes);
  app.use('/api/categories', requireAuth, categoryRoutes);
  app.use('/api/transactions', requireAuth, transactionRoutes);
  app.use('/api/transfers', requireAuth, transferRoutes);
  app.use('/api/cards', requireAuth, cardRoutes);
  app.use('/api/investments', requireAuth, investmentRoutes);
  app.use('/api/budgets', requireAuth, budgetRoutes);
  app.use('/api/goals', requireAuth, goalRoutes);
  app.use('/api/calendar', requireAuth, calendarRoutes);
  app.use('/api/reports', requireAuth, reportRoutes);
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api/networth', requireAuth, networthRoutes);
  app.use('/api/history', requireAuth, historyRoutes);
  app.use('/api/data', requireAuth, dataRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
