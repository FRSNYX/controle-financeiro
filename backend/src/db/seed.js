/**
 * Popula o banco com um cenário realista de 8 meses para demonstração.
 * Uso: npm run seed  (cria/reaproveita o usuário demo@financas.local)
 */
import { migrate } from './migrate.js';
import { all, get, run, transaction } from './index.js';
import { seedUserDefaults } from './defaults.js';
import { hashPassword } from '../utils/password.js';
import { toCents } from '../utils/money.js';
import { today, addMonths, monthKey, safeDate } from '../utils/dates.js';
import { createTransaction } from '../modules/transactions/service.js';

const EMAIL = 'demo@financas.local';
const SENHA = 'demo1234';

await migrate({ silent: true });

const existing = await get('SELECT id FROM users WHERE email = ?', [EMAIL]);
if (existing) {
  console.log('Removendo dados demo anteriores...');
  await run('DELETE FROM users WHERE id = ?', [existing.id]); // CASCADE limpa o resto
}

const { hash, salt } = hashPassword(SENHA);
const userId = Number(
  (await run('INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)', [
    'Usuário Demo', EMAIL, hash, salt,
  ])).lastInsertRowid,
);
await seedUserDefaults(userId);

const catId = async (name) =>
  (await get('SELECT id FROM categories WHERE user_id = ? AND name = ? AND parent_id IS NULL', [userId, name]))?.id ?? null;

console.log('Criando contas...');
const accounts = {};
for (const a of [
  { name: 'Conta Corrente', type: 'checking', institution: 'Banco do Brasil', balance: 4200, color: '#f59e0b' },
  { name: 'Nubank', type: 'digital', institution: 'Nu Pagamentos', balance: 1850, color: '#8b5cf6' },
  { name: 'Poupança', type: 'savings', institution: 'Caixa', balance: 12000, color: '#0ea5e9' },
  { name: 'Corretora', type: 'broker', institution: 'XP Investimentos', balance: 500, color: '#10b981' },
]) {
  accounts[a.name] = Number(
    (await run(
      `INSERT INTO accounts (user_id, name, type, institution, initial_balance, color)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, a.name, a.type, a.institution, toCents(a.balance), a.color],
    )).lastInsertRowid,
  );
}
// A carteira padrão já veio do seedUserDefaults.
accounts.Carteira = (await get('SELECT id FROM accounts WHERE user_id = ? AND name = ?', [userId, 'Carteira'])).id;

console.log('Criando cartões...');
const cardId = Number(
  (await run(
    `INSERT INTO credit_cards (user_id, name, institution, brand, limit_amount, closing_day, due_day, default_account_id, color)
     VALUES (?, 'Nubank Roxinho', 'Nu Pagamentos', 'Mastercard', ?, 20, 28, ?, '#8b5cf6')`,
    [userId, toCents(8000), accounts['Conta Corrente']],
  )).lastInsertRowid,
);
await run(
  `INSERT INTO credit_cards (user_id, name, institution, brand, limit_amount, closing_day, due_day, default_account_id, color)
   VALUES (?, 'Itaú Platinum', 'Itaú', 'Visa', ?, 5, 15, ?, '#f97316')`,
  [userId, toCents(15000), accounts['Conta Corrente']],
);

console.log('Gerando 8 meses de lançamentos...');
const MESES = 8;
const rand = (min, max) => Math.round(min + Math.random() * (max - min));

const DESPESAS_FIXAS = [
  { desc: 'Aluguel', cat: 'Moradia', valor: 1800, dia: 5, nature: 'fixed', method: 'boleto' },
  { desc: 'Energia elétrica', cat: 'Contas da casa', valor: [140, 260], dia: 12, nature: 'fixed', method: 'boleto' },
  { desc: 'Internet fibra', cat: 'Contas da casa', valor: 119, dia: 10, nature: 'fixed', method: 'debito' },
  { desc: 'Plano de saúde', cat: 'Saúde', valor: 480, dia: 8, nature: 'fixed', method: 'debito' },
  { desc: 'Academia', cat: 'Saúde', valor: 99, dia: 15, nature: 'fixed', method: 'credito' },
  { desc: 'Netflix', cat: 'Assinaturas', valor: 44, dia: 18, nature: 'fixed', method: 'credito' },
  { desc: 'Spotify', cat: 'Assinaturas', valor: 22, dia: 22, nature: 'fixed', method: 'credito' },
];

const DESPESAS_VARIAVEIS = [
  { desc: 'Supermercado', cat: 'Alimentação', valor: [320, 680], vezes: 4, method: 'debito' },
  { desc: 'Restaurante', cat: 'Alimentação', valor: [45, 180], vezes: 3, method: 'credito' },
  { desc: 'Combustível', cat: 'Transporte', valor: [180, 300], vezes: 2, method: 'credito' },
  { desc: 'Uber', cat: 'Transporte', valor: [18, 65], vezes: 4, method: 'credito' },
  { desc: 'Farmácia', cat: 'Saúde', valor: [40, 190], vezes: 1, method: 'debito' },
  { desc: 'Cinema', cat: 'Lazer', valor: [60, 140], vezes: 1, method: 'credito' },
  { desc: 'Roupas', cat: 'Compras', valor: [120, 450], vezes: 1, method: 'credito' },
];

const valorDe = (v) => (Array.isArray(v) ? rand(v[0], v[1]) : v);
const hoje = today();

for (let m = MESES - 1; m >= 0; m--) {
  const ref = addMonths(`${monthKey(hoje)}-01`, -m);
  const [ano, mes] = ref.split('-').map(Number);
  const passado = m > 0;

  // Salário
  await createTransaction(userId, {
    kind: 'income',
    description: 'Salário mensal',
    amount: 7800,
    status: passado ? 'settled' : 'pending',
    category_id: await catId('Salário'),
    account_id: accounts['Conta Corrente'],
    competence_date: safeDate(ano, mes, 5),
    due_date: safeDate(ano, mes, 5),
    settle_date: passado ? safeDate(ano, mes, 5) : null,
    income_type: 'salario',
    receipt_method: 'transferencia',
  });

  // Renda extra eventual
  if (m % 3 === 0) {
    await createTransaction(userId, {
      kind: 'income',
      description: 'Projeto freelance',
      amount: rand(800, 2500),
      status: passado ? 'settled' : 'pending',
      category_id: await catId('Renda extra'),
      account_id: accounts.Nubank,
      competence_date: safeDate(ano, mes, 20),
      due_date: safeDate(ano, mes, 20),
      settle_date: passado ? safeDate(ano, mes, 20) : null,
      income_type: 'renda_extra',
      receipt_method: 'pix',
    });
  }

  for (const d of DESPESAS_FIXAS) {
    await createTransaction(userId, {
      kind: 'expense',
      description: d.desc,
      amount: valorDe(d.valor),
      status: passado ? 'settled' : 'pending',
      category_id: await catId(d.cat),
      account_id: d.method === 'credito' ? null : accounts['Conta Corrente'],
      card_id: d.method === 'credito' ? cardId : null,
      competence_date: safeDate(ano, mes, d.dia),
      due_date: safeDate(ano, mes, d.dia),
      settle_date: passado ? safeDate(ano, mes, d.dia) : null,
      expense_nature: d.nature,
      payment_method: d.method,
    });
  }

  for (const d of DESPESAS_VARIAVEIS) {
    for (let i = 0; i < d.vezes; i++) {
      const dia = Math.min(28, 3 + i * 7 + rand(0, 3));
      await createTransaction(userId, {
        kind: 'expense',
        description: d.desc,
        amount: valorDe(d.valor),
        status: passado ? 'settled' : 'pending',
        category_id: await catId(d.cat),
        account_id: d.method === 'credito' ? null : accounts[rand(0, 1) ? 'Conta Corrente' : 'Nubank'],
        card_id: d.method === 'credito' ? cardId : null,
        competence_date: safeDate(ano, mes, dia),
        due_date: safeDate(ano, mes, dia),
        settle_date: passado ? safeDate(ano, mes, dia) : null,
        expense_nature: 'variable',
        payment_method: d.method,
      });
    }
  }
}

console.log('Criando compra parcelada...');
await createTransaction(userId, {
  kind: 'expense',
  description: 'Notebook Dell',
  amount: 5400,
  category_id: await catId('Compras'),
  card_id: cardId,
  competence_date: addMonths(hoje, -2),
  due_date: addMonths(hoje, -2),
  payment_method: 'credito',
  expense_nature: 'variable',
  installment_total: 12,
});

console.log('Criando transferência...');
await run(
  `INSERT INTO transfers (user_id, from_account_id, to_account_id, amount, date, description)
   VALUES (?, ?, ?, ?, ?, 'Reserva mensal')`,
  [userId, accounts['Conta Corrente'], accounts['Poupança'], toCents(1000), addMonths(hoje, -1)],
);
const transferId = (await get('SELECT id FROM transfers WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId])).id;
for (const [kind, accId, label] of [
  ['transfer_out', accounts['Conta Corrente'], 'Reserva mensal → Poupança'],
  ['transfer_in', accounts['Poupança'], 'Reserva mensal ← Conta Corrente'],
]) {
  await run(
    `INSERT INTO transactions (user_id, kind, description, amount, status, neutral, account_id,
                               competence_date, due_date, settle_date, transfer_id)
     VALUES (?, ?, ?, ?, 'settled', 1, ?, ?, ?, ?, ?)`,
    [userId, kind, label, toCents(1000), accId, addMonths(hoje, -1), addMonths(hoje, -1), addMonths(hoje, -1), transferId],
  );
}

console.log('Criando investimentos...');
const INVESTIMENTOS = [
  { name: 'Tesouro IPCA+ 2029', type: 'tesouro', inst: 'Tesouro Direto', qtd: 8, aplicado: 12000, atual: 13850, idx: 'IPCA+ 5,8%' },
  { name: 'CDB Banco Inter 110% CDI', type: 'cdb', inst: 'Banco Inter', qtd: 1, aplicado: 15000, atual: 16420, idx: '110% CDI' },
  { name: 'PETR4', type: 'acoes', inst: 'XP Investimentos', qtd: 300, aplicado: 10500, atual: 11940, idx: null },
  { name: 'ITSA4', type: 'acoes', inst: 'XP Investimentos', qtd: 500, aplicado: 4800, atual: 5350, idx: null },
  { name: 'MXRF11', type: 'fiis', inst: 'XP Investimentos', qtd: 400, aplicado: 4000, atual: 4180, idx: null },
  { name: 'HGLG11', type: 'fiis', inst: 'XP Investimentos', qtd: 40, aplicado: 6400, atual: 6720, idx: null },
  { name: 'IVVB11', type: 'etf', inst: 'XP Investimentos', qtd: 50, aplicado: 12500, atual: 14900, idx: null },
  { name: 'Bitcoin', type: 'cripto', inst: 'Binance', qtd: 0.05, aplicado: 8000, atual: 11200, idx: null },
];

await transaction(async () => {
  for (const inv of INVESTIMENTOS) {
    const compra = addMonths(hoje, -rand(4, 10));
    const aplicado = toCents(inv.aplicado);
    const atual = toCents(inv.atual);

    const invId = Number(
      (await run(
        `INSERT INTO investments (user_id, name, type, institution, quantity, avg_price,
                                  invested_amount, current_value, purchase_date, index_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, inv.name, inv.type, inv.inst, inv.qtd, Math.round(aplicado / inv.qtd),
         aplicado, atual, compra, inv.idx],
      )).lastInsertRowid,
    );

    await run(
      `INSERT INTO investment_movements (user_id, investment_id, type, quantity, unit_price, amount, date, notes)
       VALUES (?, ?, 'contribution', ?, ?, ?, ?, 'Aporte inicial')`,
      [userId, invId, inv.qtd, Math.round(aplicado / inv.qtd), aplicado, compra],
    );

    // Série de marcação a mercado: interpola do valor aplicado até o atual.
    for (let m = 6; m >= 0; m--) {
      const data = addMonths(`${monthKey(hoje)}-15`, -m);
      if (data < compra) continue;
      const progresso = (6 - m) / 6;
      const valor = Math.round(aplicado + (atual - aplicado) * progresso * (0.9 + Math.random() * 0.2));
      await run(
        `INSERT INTO asset_valuations (user_id, investment_id, date, market_value) VALUES (?, ?, ?, ?)
         ON CONFLICT(investment_id, date) DO UPDATE SET market_value = excluded.market_value`,
        [userId, invId, data, valor],
      );
    }

    // Proventos para FIIs e ações
    if (inv.type === 'fiis' || inv.type === 'acoes') {
      for (let m = 3; m >= 1; m--) {
        await run(
          `INSERT INTO investment_movements (user_id, investment_id, type, amount, date, notes)
           VALUES (?, ?, ?, ?, ?, 'Provento mensal')`,
          [userId, invId, inv.type === 'fiis' ? 'rent' : 'dividend', toCents(rand(25, 120)), addMonths(hoje, -m)],
        );
      }
    }
  }
});

console.log('Criando orçamentos...');
for (const [cat, limite] of [
  ['Alimentação', 1800], ['Transporte', 700], ['Lazer', 400],
  ['Compras', 600], ['Saúde', 700], ['Assinaturas', 150],
]) {
  const id = await catId(cat);
  if (id) {
    await run('INSERT INTO budgets (user_id, month, category_id, limit_amount) VALUES (?, ?, ?, ?)',
      [userId, monthKey(hoje), id, toCents(limite)]);
  }
}
await run('INSERT INTO budgets (user_id, month, category_id, limit_amount) VALUES (?, ?, NULL, ?)',
  [userId, monthKey(hoje), toCents(6000)]);

console.log('Criando metas...');
const METAS = [
  { name: 'Reserva de emergência', type: 'reserva_emergencia', alvo: 45000, atual: 28000, meses: 10, color: '#22c55e' },
  { name: 'Viagem para o Chile', type: 'viagem', alvo: 12000, atual: 4800, meses: 8, color: '#0ea5e9' },
  { name: 'Entrada do apartamento', type: 'imovel', alvo: 80000, atual: 22000, meses: 30, color: '#8b5cf6' },
  { name: 'Troca de carro', type: 'carro', alvo: 35000, atual: 9500, meses: 18, color: '#f59e0b' },
];
for (const meta of METAS) {
  const goalId = Number(
    (await run(
      `INSERT INTO goals (user_id, name, type, target_amount, start_date, target_date, color)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, meta.name, meta.type, toCents(meta.alvo), addMonths(hoje, -6), addMonths(hoje, meta.meses), meta.color],
    )).lastInsertRowid,
  );
  // Distribui o acumulado em 6 aportes mensais.
  const porMes = Math.round(toCents(meta.atual) / 6);
  for (let m = 6; m >= 1; m--) {
    await run('INSERT INTO goal_contributions (user_id, goal_id, amount, date, notes) VALUES (?, ?, ?, ?, ?)',
      [userId, goalId, porMes, addMonths(hoje, -m), 'Aporte mensal']);
  }
}

console.log('Criando bens e dívidas...');
for (const a of [
  { name: 'Apartamento', type: 'imovel', valor: 380000 },
  { name: 'Honda Civic 2021', type: 'veiculo', valor: 98000 },
  { name: 'Equipamentos de informática', type: 'equipamento', valor: 14000 },
]) {
  await run('INSERT INTO assets (user_id, name, type, value, acquisition_date) VALUES (?, ?, ?, ?, ?)',
    [userId, a.name, a.type, toCents(a.valor), addMonths(hoje, -24)]);
}
for (const l of [
  { name: 'Financiamento do apartamento', type: 'financiamento', total: 260000, restante: 214000, parcela: 2180, taxa: 0.79 },
  { name: 'Financiamento do carro', type: 'financiamento', total: 60000, restante: 23500, parcela: 1450, taxa: 1.29 },
]) {
  await run(
    `INSERT INTO liabilities (user_id, name, type, total_amount, remaining_amount, monthly_payment, interest_rate, start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, l.name, l.type, toCents(l.total), toCents(l.restante), toCents(l.parcela), l.taxa, addMonths(hoje, -24)],
  );
}

const { n } = await get('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?', [userId]);
console.log(`
=========================================
  Dados demo criados com sucesso
=========================================
  E-mail: ${EMAIL}
  Senha:  ${SENHA}

  ${n} lançamentos, ${INVESTIMENTOS.length} investimentos,
  ${METAS.length} metas, ${all('SELECT id FROM accounts WHERE user_id = ?', [userId]).length} contas
=========================================
`);
