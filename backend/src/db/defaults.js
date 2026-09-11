import { run } from './index.js';

/** Categorias padrão criadas no cadastro. `is_system` impede exclusão acidental. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Alimentação', color: '#eb6834', icon: 'utensils', subs: ['Supermercado', 'Restaurante', 'Delivery', 'Padaria'] },
  { name: 'Transporte', color: '#2a78d6', icon: 'car', subs: ['Combustível', 'Aplicativo', 'Transporte público', 'Estacionamento', 'Manutenção'] },
  { name: 'Moradia', color: '#4a3aa7', icon: 'home', subs: ['Aluguel', 'Condomínio', 'IPTU', 'Reformas'] },
  { name: 'Contas da casa', color: '#1baf7a', icon: 'plug', subs: ['Energia', 'Água', 'Internet', 'Gás', 'Telefone'] },
  { name: 'Saúde', color: '#e34948', icon: 'heart-pulse', subs: ['Plano de saúde', 'Farmácia', 'Consultas', 'Exames', 'Academia'] },
  { name: 'Educação', color: '#eda100', icon: 'graduation-cap', subs: ['Mensalidade', 'Cursos', 'Livros', 'Material'] },
  { name: 'Lazer', color: '#e87ba4', icon: 'party-popper', subs: ['Cinema', 'Shows', 'Bares', 'Hobbies'] },
  { name: 'Compras', color: '#008300', icon: 'shopping-bag', subs: ['Roupas', 'Eletrônicos', 'Casa', 'Presentes'] },
  { name: 'Assinaturas', color: '#6b7b8c', icon: 'repeat', subs: ['Streaming', 'Software', 'Revistas', 'Nuvem'] },
  { name: 'Impostos', color: '#7d6b8c', icon: 'landmark', subs: ['IR', 'IPVA', 'Taxas'] },
  { name: 'Viagens', color: '#8c7d6b', icon: 'plane', subs: ['Passagens', 'Hospedagem', 'Passeios'] },
  { name: 'Investimentos', color: '#6b8c85', icon: 'trending-up', subs: ['Aportes'] },
  { name: 'Pets', color: '#898781', icon: 'dog', subs: ['Ração', 'Veterinário'] },
  { name: 'Cartão de crédito', color: '#7a8c6b', icon: 'credit-card', subs: [] },
  { name: 'Outras', color: '#898781', icon: 'circle-ellipsis', subs: [] },
];

export const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salário', color: '#1baf7a', icon: 'banknote', subs: ['Salário líquido', '13º', 'Férias'] },
  { name: 'Renda extra', color: '#008300', icon: 'coins', subs: ['Freelance', 'Bicos'] },
  { name: 'Comissões', color: '#eda100', icon: 'percent', subs: [] },
  { name: 'Vendas', color: '#eb6834', icon: 'tag', subs: [] },
  { name: 'Rendimentos', color: '#2a78d6', icon: 'trending-up', subs: ['Dividendos', 'Juros', 'Aluguéis'] },
  { name: 'Reembolsos', color: '#4a3aa7', icon: 'rotate-ccw', subs: [] },
  { name: 'Outras receitas', color: '#898781', icon: 'circle-ellipsis', subs: [] },
];

/** Cria categorias padrão (com subcategorias) para um usuário recém-criado. */
export function seedUserDefaults(userId) {
  const insert = (name, kind, parentId, color, icon, isSystem) =>
    run(
      `INSERT INTO categories (user_id, name, kind, parent_id, color, icon, is_system)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, kind, parentId, color, icon, isSystem],
    ).lastInsertRowid;

  for (const group of [
    { kind: 'expense', list: DEFAULT_EXPENSE_CATEGORIES },
    { kind: 'income', list: DEFAULT_INCOME_CATEGORIES },
  ]) {
    for (const cat of group.list) {
      const parentId = insert(cat.name, group.kind, null, cat.color, cat.icon, 1);
      for (const sub of cat.subs) {
        insert(sub, group.kind, parentId, cat.color, 'tag', 0);
      }
    }
  }

  // Uma carteira em dinheiro para o usuário conseguir lançar já no primeiro acesso.
  run(
    `INSERT INTO accounts (user_id, name, type, institution, initial_balance, color, icon)
     VALUES (?, 'Carteira', 'wallet', 'Dinheiro em espécie', 0, '#22c55e', 'wallet')`,
    [userId],
  );
}
