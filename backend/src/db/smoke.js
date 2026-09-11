/**
 * Teste de fumaça: sobe a API em porta efêmera e exercita os fluxos principais.
 * Uso: node src/db/smoke.js
 */
import { createApp } from '../app.js';
import { migrate } from './migrate.js';
import { monthKey, today, addMonths } from '../utils/dates.js';

await migrate({ silent: true });

const app = createApp();
const server = app.listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/api`;

let token = null;
let passed = 0;
let failed = 0;
const failures = [];

async function call(method, path, body, { raw = false } = {}) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  return { status: res.status, body: json };
}

async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${label}`);
  } catch (err) {
    failed++;
    failures.push(`${label}: ${err.message}`);
    console.log(`  FALHA ${label}\n          ${err.message}`);
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log('\nTeste de fumaça da API\n');

// ---------------- Autenticação ----------------
const email = `smoke_${Date.now()}@teste.local`;

await check('health responde', async () => {
  const r = await call('GET', '/health');
  assert(r.status === 200 && r.body.status === 'ok', `status ${r.status}`);
});

await check('cadastro cria usuário e categorias padrão', async () => {
  const r = await call('POST', '/auth/register', { name: 'Smoke Test', email, password: 'senha1234' });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.accessToken, 'sem accessToken');
  token = r.body.accessToken;
});

await check('cadastro rejeita e-mail duplicado', async () => {
  const r = await call('POST', '/auth/register', { name: 'Outro Nome', email, password: 'senha1234' });
  assert(r.status === 409, `esperava 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
});

await check('cadastro rejeita senha curta', async () => {
  const r = await call('POST', '/auth/register', { name: 'Nome Valido', email: `a${Date.now()}@b.com`, password: '123' });
  assert(r.status === 422, `esperava 422, veio ${r.status}`);
});

await check('cadastro rejeita nome com 1 caractere', async () => {
  const r = await call('POST', '/auth/register', { name: 'X', email: `b${Date.now()}@b.com`, password: 'senha1234' });
  assert(r.status === 422, `esperava 422, veio ${r.status}`);
});

await check('login com senha errada é rejeitado', async () => {
  const r = await call('POST', '/auth/login', { email, password: 'errada123' });
  assert(r.status === 401, `esperava 401, veio ${r.status}`);
});

await check('rota protegida exige token', async () => {
  const saved = token;
  token = null;
  const r = await call('GET', '/accounts');
  token = saved;
  assert(r.status === 401, `esperava 401, veio ${r.status}`);
});

await check('categorias padrão foram criadas', async () => {
  const r = await call('GET', '/categories?kind=expense');
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.data.length >= 10, `apenas ${r.body.data.length} categorias`);
  assert(r.body.data.some((c) => c.children.length > 0), 'nenhuma subcategoria');
});

// ---------------- Contas ----------------
let contaId, poupancaId;

await check('cria conta corrente', async () => {
  const r = await call('POST', '/accounts', {
    name: 'Conta Teste', type: 'checking', institution: 'Banco X', initial_balance: 1000,
  });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.current_balance === 100000, `saldo ${r.body.data.current_balance} != 100000 centavos`);
  contaId = r.body.data.id;
});

await check('cria segunda conta', async () => {
  const r = await call('POST', '/accounts', { name: 'Poupança Teste', type: 'savings', initial_balance: 500 });
  assert(r.status === 201, `status ${r.status}`);
  poupancaId = r.body.data.id;
});

await check('rejeita tipo de conta inválido', async () => {
  const r = await call('POST', '/accounts', { name: 'X', type: 'inexistente' });
  assert(r.status === 422, `esperava 422, veio ${r.status}`);
});

// ---------------- Transações ----------------
const cats = (await call('GET', '/categories?kind=expense&flat=true')).body.data;
const catAlimentacao = cats.find((c) => c.name === 'Alimentação');
let despesaId;

await check('cria receita liquidada e atualiza saldo', async () => {
  const r = await call('POST', '/transactions', {
    kind: 'income', description: 'Salário', amount: 5000, status: 'settled',
    account_id: contaId, due_date: today(), income_type: 'salario',
  });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);

  const acc = await call('GET', `/accounts/${contaId}`);
  assert(acc.body.data.current_balance === 600000, `saldo ${acc.body.data.current_balance} != 600000`);
});

await check('cria despesa pendente sem alterar saldo liquidado', async () => {
  const r = await call('POST', '/transactions', {
    kind: 'expense', description: 'Mercado', amount: 350.50, status: 'pending',
    account_id: contaId, category_id: catAlimentacao.id, due_date: today(),
    expense_nature: 'variable', payment_method: 'debito',
  });
  assert(r.status === 201, `status ${r.status}`);
  despesaId = r.body.ids[0];

  const acc = await call('GET', `/accounts/${contaId}`);
  assert(acc.body.data.current_balance === 600000, 'pendente não deveria mexer no saldo');
  assert(acc.body.data.predicted_balance === 564950, `previsto ${acc.body.data.predicted_balance} != 564950`);
});

await check('valor aceita formato brasileiro "1.234,56"', async () => {
  const r = await call('POST', '/transactions', {
    kind: 'expense', description: 'Teste BR', amount: '1.234,56',
    account_id: contaId, due_date: today(),
  });
  assert(r.status === 201, `status ${r.status}`);
  const tx = await call('GET', `/transactions/${r.body.ids[0]}`);
  assert(tx.body.data.amount === 123456, `${tx.body.data.amount} != 123456 centavos`);
});

await check('rejeita valor zero', async () => {
  const r = await call('POST', '/transactions', {
    kind: 'expense', description: 'Zero', amount: 0, due_date: today(),
  });
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
});

await check('baixa de pagamento move o saldo', async () => {
  const r = await call('POST', `/transactions/${despesaId}/settle`, { settled: true });
  assert(r.status === 200, `status ${r.status}`);
  const acc = await call('GET', `/accounts/${contaId}`);
  assert(acc.body.data.current_balance === 600000 - 35050, `saldo ${acc.body.data.current_balance}`);
});

await check('edição altera o valor', async () => {
  const r = await call('PATCH', `/transactions/${despesaId}`, { amount: 400, description: 'Mercado editado' });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.data.amount === 40000, `${r.body.data.amount} != 40000`);
});

await check('duplicação cria novo lançamento pendente', async () => {
  const r = await call('POST', `/transactions/${despesaId}/duplicate`, {});
  assert(r.status === 201, `status ${r.status}`);
  assert(r.body.ids.length === 1, 'esperava 1 lançamento');
});

await check('exclusão é soft delete e vai para a lixeira', async () => {
  const r = await call('DELETE', `/transactions/${despesaId}`);
  assert(r.status === 200, `status ${r.status}`);
  const trash = await call('GET', '/history/trash');
  assert(trash.body.data.some((t) => t.id === despesaId), 'não apareceu na lixeira');
});

await check('restauração traz o lançamento de volta', async () => {
  const r = await call('POST', `/history/trash/${despesaId}/restore`);
  assert(r.status === 200, `status ${r.status}`);
  const tx = await call('GET', `/transactions/${despesaId}`);
  assert(tx.status === 200, 'não foi restaurado');
});

// ---------------- Parcelamento ----------------
await check('parcelamento divide sem perder centavos', async () => {
  const r = await call('POST', '/transactions', {
    kind: 'expense', description: 'Sofá', amount: 1000, installment_total: 3,
    account_id: contaId, due_date: today(), payment_method: 'boleto',
  });
  assert(r.status === 201, `status ${r.status}`);
  assert(r.body.count === 3, `criou ${r.body.count} parcelas`);

  const list = await call('GET', `/transactions?search=Sofá&pageSize=10`);
  const soma = list.body.data.reduce((s, t) => s + t.amount, 0);
  assert(soma === 100000, `soma das parcelas ${soma} != 100000 centavos`);
  assert(list.body.data.some((t) => t.installment_label === '1/3'), 'sem rótulo de parcela');
});

// ---------------- Cartão de crédito ----------------
let cartaoId, faturaId;

await check('cria cartão', async () => {
  const r = await call('POST', '/cards', {
    name: 'Cartão Teste', limit_amount: 5000, closing_day: 20, due_day: 28,
    default_account_id: contaId,
  });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
  cartaoId = r.body.data.id;
});

await check('compra no cartão entra na fatura e não mexe na conta', async () => {
  const antes = (await call('GET', `/accounts/${contaId}`)).body.data.current_balance;
  const r = await call('POST', '/transactions', {
    kind: 'expense', description: 'Compra cartão', amount: 800,
    card_id: cartaoId, payment_method: 'credito', due_date: today(),
    competence_date: today(),
  });
  assert(r.status === 201, `status ${r.status}`);

  const depois = (await call('GET', `/accounts/${contaId}`)).body.data.current_balance;
  assert(antes === depois, 'compra no cartão não pode alterar saldo da conta');

  const tx = await call('GET', `/transactions/${r.body.ids[0]}`);
  assert(tx.body.data.invoice_id, 'compra não foi vinculada a uma fatura');
  assert(tx.body.data.account_id === null, 'compra no cartão não deve ter conta');
  faturaId = tx.body.data.invoice_id;
});

await check('limite disponível desconta a compra', async () => {
  const r = await call('GET', `/cards/${cartaoId}`);
  assert(r.body.data.used_limit === 80000, `usado ${r.body.data.used_limit} != 80000`);
  assert(r.body.data.available_limit === 420000, `disponível ${r.body.data.available_limit} != 420000`);
});

await check('parcelamento no cartão distribui em faturas diferentes', async () => {
  const r = await call('POST', '/transactions', {
    kind: 'expense', description: 'TV parcelada', amount: 3000, installment_total: 6,
    card_id: cartaoId, payment_method: 'credito', due_date: today(), competence_date: today(),
  });
  assert(r.status === 201, `status ${r.status}`);
  const list = await call('GET', '/transactions?search=TV parcelada&pageSize=10');
  const faturas = new Set(list.body.data.map((t) => t.invoice_id));
  assert(faturas.size === 6, `esperava 6 faturas distintas, veio ${faturas.size}`);
});

await check('pagamento da fatura debita a conta', async () => {
  const antes = (await call('GET', `/accounts/${contaId}`)).body.data.current_balance;
  const r = await call('POST', `/cards/invoices/${faturaId}/pay`, { account_id: contaId });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
  const depois = (await call('GET', `/accounts/${contaId}`)).body.data.current_balance;
  assert(depois < antes, 'pagamento da fatura deveria reduzir o saldo');
});

await check('fatura paga devolve o limite do cartão', async () => {
  // Regressão: contar pelo status da FATURA fazia compras antigas de faturas
  // nunca quitadas comprometerem o limite para sempre.
  const r = await call('GET', `/cards/${cartaoId}`);
  const naoLiquidadas = await call('GET', `/transactions?cardId=${cartaoId}&status=pending&pageSize=200`);
  const esperado = naoLiquidadas.body.data.reduce((s, t) => s + t.amount, 0);
  assert(
    r.body.data.used_limit === esperado,
    `limite usado ${r.body.data.used_limit} != soma das pendentes ${esperado}`,
  );
});

// ---------------- Transferências ----------------
await check('transferência move saldo entre contas', async () => {
  const origemAntes = (await call('GET', `/accounts/${contaId}`)).body.data.current_balance;
  const destinoAntes = (await call('GET', `/accounts/${poupancaId}`)).body.data.current_balance;

  const r = await call('POST', '/transfers', {
    from_account_id: contaId, to_account_id: poupancaId, amount: 200, date: today(),
  });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);

  const origemDepois = (await call('GET', `/accounts/${contaId}`)).body.data.current_balance;
  const destinoDepois = (await call('GET', `/accounts/${poupancaId}`)).body.data.current_balance;
  assert(origemDepois === origemAntes - 20000, `origem ${origemDepois}`);
  assert(destinoDepois === destinoAntes + 20000, `destino ${destinoDepois}`);
});

await check('transferência NÃO conta como receita nem despesa', async () => {
  const r = await call('GET', `/transactions?from=${today()}&to=${today()}`);
  const temTransferencia = r.body.data.some((t) => t.kind.startsWith('transfer'));
  assert(!temTransferencia, 'transferência vazou na listagem de receitas/despesas');
});

await check('rejeita transferência para a mesma conta', async () => {
  const r = await call('POST', '/transfers', {
    from_account_id: contaId, to_account_id: contaId, amount: 100,
  });
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
});

// ---------------- Investimentos ----------------
let investimentoId;

await check('cria investimento', async () => {
  const r = await call('POST', '/investments', {
    name: 'CDB Teste', type: 'cdb', institution: 'Banco X',
    quantity: 1, invested_amount: 10000, current_value: 10800, purchase_date: today(),
  });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.profit_amount === 80000, `lucro ${r.body.data.profit_amount} != 80000`);
  assert(r.body.data.profit_pct === 8, `rentabilidade ${r.body.data.profit_pct}% != 8%`);
  investimentoId = r.body.data.id;
});

await check('aporte recalcula preço médio', async () => {
  const r = await call('POST', `/investments/${investimentoId}/movements`, {
    type: 'contribution', quantity: 1, unit_price: 12000, amount: 12000, date: today(),
  });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
  // (1×10000 + 1×12000) / 2 = 11000
  assert(r.body.data.avg_price === 1100000, `preço médio ${r.body.data.avg_price} != 1100000 centavos`);
  assert(r.body.data.quantity === 2, `quantidade ${r.body.data.quantity} != 2`);
});

await check('dividendo é contabilizado como renda, não como aporte', async () => {
  const antes = (await call('GET', `/investments/${investimentoId}`)).body.data.invested_amount;
  const r = await call('POST', `/investments/${investimentoId}/movements`, {
    type: 'dividend', amount: 150, date: today(),
  });
  assert(r.status === 201, `status ${r.status}`);
  assert(r.body.data.invested_amount === antes, 'dividendo não pode alterar valor aplicado');
  assert(r.body.data.income_total === 15000, `proventos ${r.body.data.income_total} != 15000`);
});

await check('rejeita retirada acima da posição', async () => {
  const r = await call('POST', `/investments/${investimentoId}/movements`, {
    type: 'withdrawal', quantity: 999, amount: 100,
  });
  assert(r.status === 400, `esperava 400, veio ${r.status}`);
});

await check('distribuição da carteira soma 100%', async () => {
  const r = await call('GET', '/investments/allocation');
  assert(r.status === 200, `status ${r.status}`);
  const soma = r.body.data.reduce((s, a) => s + a.share_pct, 0);
  assert(Math.abs(soma - 100) < 1, `soma ${soma}% != 100%`);
});

// ---------------- Orçamento ----------------
await check('define orçamento e calcula consumo', async () => {
  const r = await call('PUT', '/budgets', {
    month: monthKey(today()), category_id: catAlimentacao.id, limit_amount: 500,
  });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.limit_amount === 50000, `limite ${r.body.data.limit_amount}`);
  assert(r.body.data.percent_used > 0, 'deveria haver consumo do orçamento');
});

await check('alerta dispara acima de 80%', async () => {
  const r = await call('GET', `/budgets?month=${monthKey(today())}`);
  const alimentacao = r.body.data.find((b) => b.category_id === catAlimentacao.id);
  assert(alimentacao, 'orçamento não encontrado');
  assert(['warning', 'critical', 'exceeded'].includes(alimentacao.alert.level), `nível ${alimentacao.alert.level}`);
});

// ---------------- Metas ----------------
let metaId;

await check('cria meta e calcula progresso', async () => {
  const r = await call('POST', '/goals', {
    name: 'Viagem', type: 'viagem', target_amount: 10000, target_date: addMonths(today(), 10),
  });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.percent === 0, 'meta nova deveria estar em 0%');
  metaId = r.body.data.id;
});

await check('aporte na meta atualiza o percentual', async () => {
  const r = await call('POST', `/goals/${metaId}/contributions`, { amount: 2500, date: today() });
  assert(r.status === 201, `status ${r.status}`);
  assert(r.body.data.percent === 25, `percentual ${r.body.data.percent}% != 25%`);
  assert(r.body.data.monthly_needed > 0, 'deveria calcular aporte mensal necessário');
});

// ---------------- Dashboard, calendário, relatórios ----------------
await check('dashboard retorna todos os indicadores', async () => {
  const r = await call('GET', `/dashboard?month=${monthKey(today())}`);
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const c = r.body.cards;
  for (const campo of ['total_balance', 'income_total', 'expense_total', 'result',
    'invested_total', 'net_worth', 'payable', 'receivable', 'savings_rate']) {
    assert(c[campo] !== undefined, `card "${campo}" ausente`);
  }
  assert(Array.isArray(r.body.charts.monthly), 'série mensal ausente');
  assert(r.body.charts.monthly.length >= 12, `série com ${r.body.charts.monthly.length} meses`);
  assert(Array.isArray(r.body.charts.expenses_by_category), 'gastos por categoria ausente');
  assert(Array.isArray(r.body.lists.upcoming), 'próximos vencimentos ausente');
});

await check('calendário agrupa eventos por dia', async () => {
  const r = await call('GET', `/calendar?month=${monthKey(today())}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.days.length > 0, 'nenhum dia com eventos');
  assert(r.body.days[0].events.length > 0, 'dia sem eventos');
});

await check('detalhe do dia lista movimentações', async () => {
  const r = await call('GET', `/calendar/day/${today()}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.data.length > 0, 'nenhum evento hoje');
});

await check('relatório de indicadores calcula métricas', async () => {
  const inicio = addMonths(today(), -1);
  const r = await call('GET', `/reports/indicators?from=${inicio}&to=${today()}`);
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const i = r.body.indicators;
  assert(i.avg_expense_per_day >= 0, 'média diária ausente');
  assert(i.biggest_expense, 'maior despesa ausente');
  assert(i.top_category, 'categoria com maior gasto ausente');
  assert(r.body.comparison, 'comparação com período anterior ausente');
});

await check('relatório por categoria soma 100%', async () => {
  const r = await call('GET', `/reports/by-category?from=${addMonths(today(), -1)}&to=${today()}`);
  assert(r.status === 200, `status ${r.status}`);
  const soma = r.body.data.reduce((s, c) => s + c.share_pct, 0);
  assert(Math.abs(soma - 100) < 1.5, `soma ${soma}%`);
});

// ---------------- Exportações ----------------
await check('exporta CSV', async () => {
  const r = await call('GET', `/reports/export?format=csv&from=${addMonths(today(), -1)}&to=${today()}`, undefined, { raw: true });
  assert(r.status === 200, `status ${r.status}`);
  const texto = r.buffer.toString('utf8');
  assert(texto.startsWith('﻿'), 'CSV sem BOM (Excel pt-BR quebraria)');
  assert(texto.includes('Descrição'), 'cabeçalho ausente');
  assert(texto.includes(';'), 'separador esperado era ;');
});

await check('exporta Excel', async () => {
  const r = await call('GET', `/reports/export?format=xlsx&from=${addMonths(today(), -1)}&to=${today()}`, undefined, { raw: true });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.buffer.length > 3000, `arquivo muito pequeno: ${r.buffer.length} bytes`);
  assert(r.buffer.subarray(0, 2).toString() === 'PK', 'não é um arquivo xlsx válido');
});

await check('exporta PDF', async () => {
  const r = await call('GET', `/reports/export?format=pdf&from=${addMonths(today(), -1)}&to=${today()}`, undefined, { raw: true });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.buffer.subarray(0, 4).toString() === '%PDF', 'não é um PDF válido');
  assert(r.buffer.length > 1000, `PDF muito pequeno: ${r.buffer.length} bytes`);
});

// ---------------- Patrimônio ----------------
await check('minha vida financeira calcula patrimônio líquido', async () => {
  await call('POST', '/networth/assets', { name: 'Carro', type: 'veiculo', value: 50000 });
  await call('POST', '/networth/liabilities', { name: 'Financiamento', type: 'financiamento', total_amount: 30000, remaining_amount: 20000 });

  const r = await call('GET', '/networth');
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const s = r.body.summary;
  assert(s.physical_assets_total === 5000000, `bens ${s.physical_assets_total}`);
  assert(s.total_debts >= 2000000, `dívidas ${s.total_debts}`);
  assert(s.net_worth === s.total_assets - s.total_debts, 'patrimônio líquido inconsistente');
});

await check('projeções de 1, 5 e 10 anos são crescentes', async () => {
  const r = await call('GET', '/networth');
  const cenarios = r.body.projection.scenarios;
  assert(cenarios.length === 3, `${cenarios.length} cenários`);
  assert(cenarios[0].years === 1 && cenarios[1].years === 5 && cenarios[2].years === 10, 'anos errados');
  assert(cenarios[0].future_value < cenarios[1].future_value, '5 anos deveria superar 1 ano');
  assert(cenarios[1].future_value < cenarios[2].future_value, '10 anos deveria superar 5 anos');
});

await check('simulador de juros compostos confere', async () => {
  // 1000 aplicado + 100/mês a 1% a.m. por 1 ano
  const r = await call('POST', '/networth/simulate', {
    present_value: 1000, monthly_contribution: 100, monthly_rate: 0.01, years: [1],
  });
  assert(r.status === 200, `status ${r.status}`);
  // VF = 1000·1,01^12 + 100·((1,01^12−1)/0,01) = 1126,83 + 1268,25 = 2395,08
  const vf = r.body.data[0].future_value;
  assert(Math.abs(vf - 239508) < 200, `VF ${vf} fora do esperado (~239508 centavos)`);
});

// ---------------- Busca, histórico, notificações ----------------
await check('busca global encontra em várias entidades', async () => {
  const r = await call('GET', '/history/search?q=Teste');
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.results.accounts.length > 0 || r.body.results.investments.length > 0, 'busca não retornou nada');
});

await check('histórico de alterações foi registrado', async () => {
  const r = await call('GET', '/history');
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.data.length > 5, `apenas ${r.body.data.length} registros`);
  assert(r.body.data[0].action_label, 'rótulo de ação ausente');
});

await check('notificações de vencimento são geradas', async () => {
  const r = await call('POST', '/history/notifications/check');
  assert(r.status === 200, `status ${r.status}`);
  const lista = await call('GET', '/history/notifications');
  assert(lista.body.unread_count >= 0, 'contador ausente');
});

// ---------------- Backup ----------------
await check('backup exporta JSON completo', async () => {
  const r = await call('GET', '/data/backup', undefined, { raw: true });
  assert(r.status === 200, `status ${r.status}`);
  const dados = JSON.parse(r.buffer.toString('utf8'));
  assert(dados.format === 'controle-financeiro-backup', 'formato inválido');
  assert(dados.tables.transactions.length > 0, 'backup sem transações');
  assert(dados.tables.accounts.length >= 2, 'backup sem contas');
});

await check('modelo de importação é oferecido', async () => {
  const r = await call('GET', '/data/import/template', undefined, { raw: true });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.buffer.toString('utf8').includes('Descrição'), 'modelo sem cabeçalho');
});

await check('restauração devolve os dados e libera novos cadastros', async () => {
  const backup = await call('GET', '/data/backup', undefined, { raw: true });
  const antes = (await call('GET', '/transactions?pageSize=1')).body.pagination.total;

  const form = new FormData();
  form.append('file', new Blob([backup.buffer], { type: 'application/json' }), 'backup.json');
  form.append('confirm', 'SUBSTITUIR');

  const res = await fetch(`${BASE}/data/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  assert(res.status === 200, `status ${res.status}: ${JSON.stringify(body)}`);

  const depois = (await call('GET', '/transactions?pageSize=1')).body.pagination.total;
  assert(depois === antes, `lançamentos ${depois} != ${antes} após restaurar`);

  // Os ids vêm prontos do backup; sem reposicionar as sequências, este
  // cadastro colidiria com um id existente.
  const nova = await call('POST', '/accounts', { name: 'Pós-restore', type: 'cash' });
  assert(nova.status === 201, `criar conta após restore falhou: ${JSON.stringify(nova.body)}`);
});

// ---------------- Filtros ----------------
await check('filtro por período funciona', async () => {
  const r = await call('GET', `/transactions?from=${today()}&to=${today()}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.data.every((t) => t.due_date === today()), 'filtro de data vazou');
});

await check('filtro por tipo separa receitas de despesas', async () => {
  const r = await call('GET', '/transactions?kind=income');
  assert(r.body.data.every((t) => t.kind === 'income'), 'filtro de tipo vazou');
});

await check('filtro por valor mínimo respeita centavos', async () => {
  const r = await call('GET', '/transactions?minAmount=500');
  assert(r.body.data.every((t) => t.amount >= 50000), 'filtro de valor vazou');
});

await check('busca textual filtra', async () => {
  const r = await call('GET', '/transactions?search=Salário');
  assert(r.body.data.length > 0, 'busca não achou');
  assert(r.body.data.every((t) => t.description.includes('Salário')), 'busca retornou item errado');
});

await check('paginação devolve metadados', async () => {
  const r = await call('GET', '/transactions?page=1&pageSize=5');
  assert(r.body.data.length <= 5, 'ignorou pageSize');
  assert(r.body.pagination.totalPages >= 1, 'metadados de paginação ausentes');
  assert(r.body.totals.income_total !== undefined, 'totais ausentes');
});

// ---------------- Isolamento entre usuários ----------------
await check('usuário não acessa dados de outro usuário', async () => {
  const tokenOriginal = token;
  const outro = await call('POST', '/auth/register', {
    name: 'Outro', email: `outro_${Date.now()}@teste.local`, password: 'senha1234',
  });
  token = outro.body.accessToken;

  const conta = await call('GET', `/accounts/${contaId}`);
  assert(conta.status === 404, `vazou conta de outro usuário (status ${conta.status})`);

  const tx = await call('GET', `/transactions/${despesaId}`);
  assert(tx.status === 404, `vazou lançamento de outro usuário (status ${tx.status})`);

  const lista = await call('GET', '/transactions');
  assert(lista.body.data.length === 0, `usuário novo enxergou ${lista.body.data.length} lançamentos`);

  token = tokenOriginal;
});

// ---------------- Resultado ----------------
server.close();

console.log(`\n${'='.repeat(50)}`);
console.log(`  ${passed} passaram, ${failed} falharam`);
console.log('='.repeat(50));
if (failures.length) {
  console.log('\nFalhas:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(failed > 0 ? 1 : 0);
