import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // Em produção o site e a API vivem no mesmo domínio, então o próprio host
  // é sempre aceito — sem isso, seria preciso reconfigurar a lista a cada
  // novo endereço de deploy (e a Vercel gera um por publicação).
  const vercelOrigins = process.env.VERCEL_URL
    ? [`https://${process.env.VERCEL_URL}`, `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
    : [];
  const allowed = new Set([...env.corsOrigins, ...vercelOrigins].filter(Boolean));

  app.use(
    cors({
      origin(origin, cb) {
        // Sem Origin = mesma origem ou ferramenta local (curl, Postman).
        if (!origin) return cb(null, true);
        if (allowed.has(origin)) return cb(null, true);
        // Qualquer subdomínio de pré-visualização da própria aplicação.
        if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin) && process.env.VERCEL) return cb(null, true);
        return cb(new Error(`Origem não permitida: ${origin}`));
      },
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

  // ------------------------------------------------------------------
  // Site (build do frontend)
  //
  // Em produção o mesmo processo serve a interface e a API, no mesmo
  // endereço — o que elimina CORS e a necessidade de rotear dois serviços.
  // Em desenvolvimento a pasta não existe e este bloco é ignorado: quem
  // serve a interface é o Vite, com recarga automática.
  // ------------------------------------------------------------------
  const here = path.dirname(fileURLToPath(import.meta.url));
  const siteDir = process.env.SITE_DIR ?? path.resolve(here, '..', '..', 'frontend', 'dist');
  const indexFile = path.join(siteDir, 'index.html');

  if (fs.existsSync(indexFile)) {
    // Os arquivos em /assets têm hash no nome, então podem ser cacheados
    // para sempre; o index.html nunca, senão o navegador serviria a versão
    // antiga da aplicação depois de uma atualização.
    app.use(
      express.static(siteDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );

    // O roteamento das telas acontece no navegador: qualquer caminho que não
    // seja da API nem um arquivo existente devolve o index.html para a
    // aplicação assumir dali. Sem isto, abrir /login direto — ou recarregar
    // a página — resultaria em 404.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
