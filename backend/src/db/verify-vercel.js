/**
 * Verifica a função serverless de /api exatamente como a Vercel a executa:
 * importando o handler e passando requisições HTTP reais.
 *
 * Uso: node backend/src/db/verify-vercel.js
 */
import http from 'node:http';
import handler from '../../../api/index.js';

const server = http.createServer((req, res) => handler(req, res));
await new Promise((resolve) => server.listen(0, resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;

const check = async (label, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${label}`);
  } catch (err) {
    failed++;
    console.log(`  FALHA ${label}\n          ${err.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log('\nVerificação da função serverless (/api)\n');

let token;
const email = `vercel_${Date.now()}@teste.local`;

await check('GET /api/health responde pela função', async () => {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  assert(res.status === 200 && body.status === 'ok', `status ${res.status}`);
});

await check('migrations rodam sozinhas na primeira chamada', async () => {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Vercel Teste', email, password: 'senha1234' }),
  });
  const body = await res.json();
  assert(res.status === 201, `status ${res.status}: ${JSON.stringify(body)}`);
  token = body.accessToken;
});

await check('rota autenticada funciona', async () => {
  const res = await fetch(`${BASE}/api/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  assert(res.status === 200, `status ${res.status}: ${JSON.stringify(body).slice(0, 150)}`);
  assert(body.cards, 'sem os cards do dashboard');
});

await check('segunda chamada reaproveita a conexão (sem remigrar)', async () => {
  const inicio = Date.now();
  const res = await fetch(`${BASE}/api/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(res.status === 200, `status ${res.status}`);
  const ms = Date.now() - inicio;
  assert(ms < 3000, `demorou ${ms}ms — a instância não está sendo reaproveitada`);
});

await check('rota inexistente devolve 404 em JSON', async () => {
  const res = await fetch(`${BASE}/api/nao-existe`);
  assert(res.status === 404, `status ${res.status}`);
  const body = await res.json();
  assert(body.error, 'sem mensagem de erro');
});

await check('anexos recusados com mensagem clara quando não há disco', async () => {
  // Simula o comportamento de produção sem armazenamento permanente.
  const { env } = await import('../config/env.js');
  if (env.uploadsEnabled) {
    console.log('        (pulado: ambiente local tem disco)');
    return;
  }
  const res = await fetch(`${BASE}/api/data/attachments/1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(res.status === 400, `status ${res.status}`);
});

server.close();
console.log(`\n  ${passed} passaram, ${failed} falharam\n`);
process.exit(failed > 0 ? 1 : 0);
