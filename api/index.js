/**
 * Ponto de entrada da API na Vercel.
 *
 * A mesma aplicação Express que roda localmente é servida aqui como função
 * serverless — não existe uma segunda versão do backend para manter.
 */
import { createApp } from '../backend/src/app.js';
import { migrate } from '../backend/src/db/migrate.js';

const app = createApp();

/**
 * As migrations rodam na primeira requisição de cada instância, não a cada
 * chamada: a promessa é guardada e reaproveitada. Como o próprio `migrate`
 * pula o que já foi aplicado, isso é seguro mesmo com várias instâncias
 * subindo ao mesmo tempo.
 */
let ready = null;

export default async function handler(req, res) {
  try {
    ready ??= migrate({ silent: true });
    await ready;
  } catch (err) {
    // Uma falha de migration não pode ficar em cache: a próxima requisição
    // precisa poder tentar de novo.
    ready = null;
    console.error('[api] falha ao preparar o banco:', err.message);
    return res.status(503).json({
      error: 'Banco de dados indisponível. Verifique se a variável DATABASE_URL está configurada.',
    });
  }

  return app(req, res);
}
