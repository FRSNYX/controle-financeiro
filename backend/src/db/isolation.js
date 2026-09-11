/**
 * Verificação de isolamento entre contas.
 *
 * Cria dois usuários e tenta, de todas as formas, fazer o usuário B ler ou
 * alterar os dados do usuário A — inclusive informando os ids reais de A.
 *
 * Uso: node backend/src/db/isolation.js [url-da-api]
 */
const BASE = (process.argv[2] ?? 'https://controle-financeiro-five-swart.vercel.app').replace(/\/$/, '');
const API = `${BASE}/api`;

let ok = 0;
let falhas = 0;

const chamar = async (token, metodo, rota, corpo) => {
  const res = await fetch(`${API}${rota}`, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  let json;
  try { json = texto ? JSON.parse(texto) : {}; } catch { json = { _raw: texto.slice(0, 120) }; }
  return { status: res.status, body: json };
};

const check = async (label, fn) => {
  try {
    await fn();
    ok++;
    console.log(`  ok       ${label}`);
  } catch (err) {
    falhas++;
    console.log(`  VAZOU    ${label}\n           ${err.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const hoje = new Date().toISOString().slice(0, 10);

console.log(`\nIsolamento entre contas — ${BASE}\n`);

// ---------- Duas contas independentes ----------
const criar = async (nome) => {
  const slug = nome.toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = `${slug}${Date.now()}${Math.random().toString(36).slice(2, 6)}@teste.com`;
  const r = await chamar(null, 'POST', '/auth/register', { name: nome, email, password: 'senha1234' });
  if (r.status !== 201) throw new Error(`falha ao criar ${nome}: ${JSON.stringify(r.body)}`);
  return { token: r.body.accessToken, email, id: r.body.user.id };
};

const A = await criar('Pessoa A');
const B = await criar('Pessoa B');
console.log(`  duas contas criadas (ids ${A.id} e ${B.id})\n`);

// ---------- A cria dados reais ----------
const contaA = (await chamar(A.token, 'POST', '/accounts', {
  name: 'Conta secreta de A', type: 'checking', initial_balance: 9999,
})).body.data;

const lancA = (await chamar(A.token, 'POST', '/transactions', {
  kind: 'income', description: 'Salario secreto de A', amount: 12345,
  status: 'settled', account_id: contaA.id, due_date: hoje, income_type: 'salario',
})).body.ids[0];

const metaA = (await chamar(A.token, 'POST', '/goals', {
  name: 'Meta secreta de A', target_amount: 50000, target_date: '2027-12-31',
})).body.data;

const cartaoA = (await chamar(A.token, 'POST', '/cards', {
  name: 'Cartao de A', limit_amount: 5000, closing_day: 20, due_day: 28,
})).body.data;

const invA = (await chamar(A.token, 'POST', '/investments', {
  name: 'Investimento de A', type: 'cdb', quantity: 1,
  invested_amount: 10000, current_value: 11000, purchase_date: hoje,
})).body.data;

// ================= LEITURA =================
console.log('  --- B tentando LER os dados de A ---');

await check('B não vê a conta de A na listagem', async () => {
  const r = await chamar(B.token, 'GET', '/accounts');
  const nomes = r.body.data.map((c) => c.name);
  assert(!nomes.includes('Conta secreta de A'), `B enxergou: ${nomes.join(', ')}`);
});

await check('B não abre a conta de A pelo id', async () => {
  const r = await chamar(B.token, 'GET', `/accounts/${contaA.id}`);
  assert(r.status === 404, `status ${r.status} — devolveu ${JSON.stringify(r.body).slice(0, 100)}`);
});

await check('B não abre o lançamento de A pelo id', async () => {
  const r = await chamar(B.token, 'GET', `/transactions/${lancA}`);
  assert(r.status === 404, `status ${r.status}`);
});

await check('B não vê lançamentos de A na listagem', async () => {
  const r = await chamar(B.token, 'GET', '/transactions?pageSize=200');
  assert(r.body.data.length === 0, `B viu ${r.body.data.length} lançamento(s)`);
});

await check('B não encontra dados de A na busca geral', async () => {
  const r = await chamar(B.token, 'GET', '/history/search?q=secreto');
  const total = Object.values(r.body.results).reduce((s, lista) => s + lista.length, 0);
  assert(total === 0, `busca retornou ${total} resultado(s) de A`);
});

await check('B não abre a meta de A', async () => {
  const r = await chamar(B.token, 'GET', `/goals/${metaA.id}`);
  assert(r.status === 404, `status ${r.status}`);
});

await check('B não abre o investimento de A', async () => {
  const r = await chamar(B.token, 'GET', `/investments/${invA.id}`);
  assert(r.status === 404, `status ${r.status}`);
});

await check('B não vê as faturas do cartão de A', async () => {
  const r = await chamar(B.token, 'GET', `/cards/${cartaoA.id}/invoices`);
  assert(r.status === 404, `status ${r.status}`);
});

await check('B não vê o extrato da conta de A', async () => {
  const r = await chamar(B.token, 'GET', `/accounts/${contaA.id}/statement`);
  assert(r.status === 404, `status ${r.status}`);
});

await check('saldo do dashboard de B não inclui o dinheiro de A', async () => {
  const r = await chamar(B.token, 'GET', '/dashboard');
  assert(r.body.cards.total_balance === 0, `B vê saldo ${r.body.cards.total_balance}`);
  assert(r.body.cards.income_total === 0, `B vê receitas ${r.body.cards.income_total}`);
});

await check('patrimônio de B não inclui os bens de A', async () => {
  const r = await chamar(B.token, 'GET', '/networth');
  assert(r.body.summary.total_assets === 0, `B vê patrimônio ${r.body.summary.total_assets}`);
});

await check('backup de B não contém nada de A', async () => {
  const res = await fetch(`${API}/data/backup`, { headers: { Authorization: `Bearer ${B.token}` } });
  const texto = await res.text();
  assert(!texto.includes('secreto') && !texto.includes('secreta'), 'o backup de B trouxe dados de A');
});

await check('histórico de B não mostra ações de A', async () => {
  const r = await chamar(B.token, 'GET', '/history');
  const temA = r.body.data.some((h) => String(h.summary ?? '').includes('de A'));
  assert(!temA, 'histórico de B mostrou ações de A');
});

// ================= ESCRITA =================
console.log('\n  --- B tentando ALTERAR os dados de A ---');

await check('B não edita o lançamento de A', async () => {
  const r = await chamar(B.token, 'PATCH', `/transactions/${lancA}`, { amount: 1 });
  assert(r.status === 404, `status ${r.status}`);
  const conferir = await chamar(A.token, 'GET', `/transactions/${lancA}`);
  assert(conferir.body.data.amount === 1234500, `valor de A mudou para ${conferir.body.data.amount}`);
});

await check('B não exclui o lançamento de A', async () => {
  const r = await chamar(B.token, 'DELETE', `/transactions/${lancA}`);
  assert(r.status === 404, `status ${r.status}`);
  const conferir = await chamar(A.token, 'GET', `/transactions/${lancA}`);
  assert(conferir.status === 200, 'o lançamento de A foi excluído por B');
});

await check('B não edita a conta de A', async () => {
  const r = await chamar(B.token, 'PATCH', `/accounts/${contaA.id}`, { name: 'Invadida' });
  assert(r.status === 404, `status ${r.status}`);
  const conferir = await chamar(A.token, 'GET', `/accounts/${contaA.id}`);
  assert(conferir.body.data.name === 'Conta secreta de A', `nome virou "${conferir.body.data.name}"`);
});

await check('B não exclui a conta de A', async () => {
  const r = await chamar(B.token, 'DELETE', `/accounts/${contaA.id}`);
  assert(r.status === 404, `status ${r.status}`);
});

await check('B não aporta na meta de A', async () => {
  const r = await chamar(B.token, 'POST', `/goals/${metaA.id}/contributions`, { amount: 100 });
  assert(r.status === 404, `status ${r.status}`);
});

await check('B não lança despesa no cartão de A', async () => {
  const r = await chamar(B.token, 'POST', '/transactions', {
    kind: 'expense', description: 'Compra indevida', amount: 500,
    card_id: cartaoA.id, payment_method: 'credito', due_date: hoje,
  });
  assert(r.status === 400 || r.status === 404, `status ${r.status} — conseguiu usar o cartão de A`);
});

await check('B não transfere da conta de A', async () => {
  const contaB = (await chamar(B.token, 'POST', '/accounts', { name: 'Conta de B', type: 'wallet' })).body.data;
  const r = await chamar(B.token, 'POST', '/transfers', {
    from_account_id: contaA.id, to_account_id: contaB.id, amount: 100, date: hoje,
  });
  assert(r.status === 400 || r.status === 404, `status ${r.status} — conseguiu mover dinheiro de A`);
});

await check('B não movimenta o investimento de A', async () => {
  const r = await chamar(B.token, 'POST', `/investments/${invA.id}/movements`, {
    type: 'withdrawal', quantity: 1, amount: 10000,
  });
  assert(r.status === 404, `status ${r.status}`);
});

// ================= SESSÃO =================
console.log('\n  --- Sessão e senha ---');

await check('sem token, nada é acessível', async () => {
  const r = await chamar(null, 'GET', '/transactions');
  assert(r.status === 401, `status ${r.status}`);
});

await check('token inventado é rejeitado', async () => {
  const r = await chamar('token.falso.inventado', 'GET', '/accounts');
  assert(r.status === 401, `status ${r.status}`);
});

await check('senha de A não funciona com o e-mail de B', async () => {
  const r = await chamar(null, 'POST', '/auth/login', { email: B.email, password: 'outra-senha' });
  assert(r.status === 401, `status ${r.status}`);
});

await check('recuperação de senha não revela se o e-mail existe', async () => {
  const existe = await chamar(null, 'POST', '/auth/forgot-password', { email: A.email });
  const naoExiste = await chamar(null, 'POST', '/auth/forgot-password', { email: 'ninguem@lugar-nenhum.com' });
  assert(
    existe.body.message === naoExiste.body.message,
    'as respostas diferem e revelam quais e-mails estão cadastrados',
  );
});

console.log(`\n  ${ok} verificações passaram, ${falhas} vazamento(s)\n`);
process.exit(falhas ? 1 : 0);
