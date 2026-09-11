import { createApp } from './app.js';
import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { all } from './db/index.js';
import { runAllRecurrences } from './modules/transactions/service.js';
import { checkDueNotifications } from './modules/history/index.js';

console.log('Iniciando Controle Financeiro...');
migrate();

/**
 * Manutenção diária: materializa recorrências e gera avisos de vencimento.
 * Roda no boot e a cada 24h — sem depender de cron externo.
 */
function dailyMaintenance() {
  try {
    const users = all('SELECT id FROM users');
    let recurrences = 0;
    let notifications = 0;
    for (const u of users) {
      recurrences += runAllRecurrences(u.id);
      notifications += checkDueNotifications(u.id);
    }
    if (recurrences || notifications) {
      console.log(`  manutenção: ${recurrences} recorrência(s), ${notifications} notificação(ões)`);
    }
  } catch (err) {
    // Falha na manutenção não pode derrubar a API.
    console.error('[manutencao] erro:', err.message);
  }
}

dailyMaintenance();
const maintenanceTimer = setInterval(dailyMaintenance, 24 * 60 * 60 * 1000);
maintenanceTimer.unref();

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`\n  API em http://localhost:${env.port}/api`);
  console.log(`  Banco: ${env.dbFile}`);
  console.log(`  Ambiente: ${env.nodeEnv}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nEncerrando servidor...');
    server.close(() => process.exit(0));
  });
}
