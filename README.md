# Controle Financeiro

Sistema de controle financeiro pessoal: receitas, despesas, contas, cartões, investimentos, orçamento, metas e projeção de patrimônio. Interface em português, valores em R$ e datas em DD/MM/AAAA.

**Demo:** https://controle-financeiro-frandev1.vercel.app

<!-- Adicione aqui 2 ou 3 prints das telas (dashboard, cartões, investimentos) -->

## Funcionalidades

- **Dashboard:** saldo, receitas, despesas, resultado e gráficos por período
- **Receitas e despesas:** categorias, parcelamento, recorrência, anexos e lixeira
- **Contas e cartões:** extrato, transferências, faturas e limite
- **Investimentos:** preço médio, rentabilidade, proventos e distribuição da carteira
- **Orçamento e metas:** limites por categoria com alertas e acompanhamento de objetivos
- **Relatórios:** filtros por período e exportação em CSV, Excel e PDF
- **Patrimônio:** patrimônio líquido e projeção para 1, 5 e 10 anos
- **Extras:** tema claro e escuro, instalável no celular (PWA), importação de CSV/Excel e backup

## Tecnologias

| Camada | Stack |
|---|---|
| Frontend | React, Vite, React Router, TanStack Query, Tailwind CSS, Recharts |
| Backend | Node.js, Express, Zod, JWT |
| Banco | PostgreSQL (Neon em produção, PGlite embarcado em desenvolvimento) |
| Deploy | Vercel |

## Como rodar

Requisito: Node.js 20 ou superior. Não precisa instalar banco de dados.

**Backend**

```bash
cd backend
npm install
cp .env.example .env
npm run seed   # opcional: dados de demonstração
npm run dev
```

A API sobe em `http://localhost:4000/api`.

**Frontend** (em outro terminal)

```bash
cd frontend
npm install
npm run dev
```

A aplicação abre em `http://localhost:5173`.

**Conta de demonstração** (após `npm run seed`): `demo@financas.local` / `demo1234`

## Estrutura

```
controle-financeiro/
├── backend/    API (rotas, regras de negócio, banco, testes)
├── frontend/   Aplicação React
└── docs/       Modelagem e regras de negócio (ARQUITETURA.md)
```

## Decisões de projeto

- Valores monetários são guardados em centavos (inteiros), evitando erros de arredondamento.
- O saldo nunca é gravado: é calculado a partir dos lançamentos pagos.
- Transferências entre contas não entram no cálculo de receitas e despesas.
- Lançamentos excluídos vão para a lixeira e podem ser restaurados.

Mais detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Testes

```bash
# backend
node src/db/smoke.js        # testes de integração da API
npm run test:isolation      # garante que um usuário não acessa dados de outro

# frontend
npm run test:render         # renderiza todas as telas
npm run test:pwa            # requisitos de app instalável
```

## Publicação na Vercel

1. Importe o repositório em [vercel.com/new](https://vercel.com/new). O `vercel.json` publica o site em `/` e a API em `/api`.
2. Crie um banco Postgres (Neon) na aba **Storage**. A `DATABASE_URL` é configurada automaticamente.
3. Defina `JWT_SECRET` em **Environment Variables** com um valor longo e aleatório.
4. Desative o **Vercel Authentication** em **Deployment Protection** para o site ficar público.
5. Configure `DB_POOL_MAX=2`, `DB_CONNECTION_TIMEOUT_MS=8000`, `DB_IDLE_TIMEOUT_MS=10000` e `DB_STATEMENT_TIMEOUT_MS=20000`.
6. As migrations são executadas durante o build do deploy; a primeira requisição não precisa criar o schema.

Na versão publicada, o envio de anexos fica desativado, pois o servidor não tem disco permanente.

## Antes de usar em produção

- Definir `JWT_SECRET` (a aplicação não sobe em produção com o valor padrão).
- Ajustar `CORS_ORIGINS` para o seu domínio.
- Configurar um serviço de e-mail para a recuperação de senha (ponto de integração em `backend/src/modules/auth/index.js`).
- Manter backup do banco (no Neon, pelo painel do provedor).
