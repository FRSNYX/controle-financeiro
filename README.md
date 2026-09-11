# Controle Financeiro

Sistema completo de gestão financeira pessoal: receitas, despesas, contas, cartões,
investimentos, orçamento, metas, patrimônio e projeções.

Moeda **R$ (BRL)**, datas em **DD/MM/AAAA**, interface em português.

---

## Como rodar

Requisitos: **Node.js 20 ou superior**. Não é preciso instalar banco de dados: sem
`DATABASE_URL` o sistema sobe um PostgreSQL embarcado (PGlite), que é o Postgres
de verdade rodando dentro do Node.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # opcional em desenvolvimento
npm run seed              # opcional: cria dados de demonstração
npm run dev
```

A API sobe em `http://localhost:4000/api`.

### 2. Frontend

Em outro terminal:

```bash
cd frontend
npm install
npm run dev
```

A aplicação abre em `http://localhost:5173`.

### Conta de demonstração

Depois de `npm run seed`:

| Campo | Valor |
|---|---|
| E-mail | `demo@financas.local` |
| Senha | `demo1234` |

Vêm 8 meses de lançamentos, 2 cartões, 8 investimentos, 4 metas, orçamentos,
bens e financiamentos — o suficiente para todos os gráficos terem forma.

Para começar do zero, basta criar uma conta nova pela tela de cadastro: as
categorias padrão e uma carteira já são criadas automaticamente.

---

## Publicar na internet (Vercel + Postgres)

Para acessar de qualquer máquina e do celular. O plano gratuito atende de sobra.

**1. Importar o repositório**
Em [vercel.com/new](https://vercel.com/new), escolha este repositório e clique em
**Import**. O `vercel.json` declara dois serviços — o site (Vite) em `/` e a API
(Express) em `/api` — e a Vercel os publica no mesmo endereço.

**2. Criar o banco**
No projeto: aba **Storage** → **Create Database** → **Neon (Postgres)** → plano
gratuito. A `DATABASE_URL` é injetada automaticamente.

**3. Definir o segredo de sessão**
Em **Settings** → **Environment Variables**, crie `JWT_SECRET` com um valor longo
e aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**4. Liberar o acesso público**
Em **Settings** → **Deployment Protection**, desligue o **Vercel Authentication**.
Sem isso, só quem tem conta na Vercel consegue abrir o site.

**5. Publicar**
Aba **Deployments** → **Redeploy**. As tabelas são criadas sozinhas na primeira
requisição.

A partir daí, cada `git push` publica a nova versão automaticamente.

### O que muda na versão publicada

| | Local | Vercel |
|---|---|---|
| Banco | PGlite (arquivo) | Neon Postgres |
| Acesso | só este computador | qualquer lugar, inclusive celular |
| Anexos | funcionam | desligados — servidor sem disco permanente |

Os anexos são recusados com mensagem explícita em vez de aceitar arquivos que
sumiriam na requisição seguinte. Para habilitá-los, é preciso um serviço de
armazenamento de objetos (Vercel Blob, S3) — a troca fica isolada em
`backend/src/modules/data/index.js`.

---

## Comandos

### Backend
| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a API com recarga automática |
| `npm start` | Sobe a API em modo produção |
| `npm run migrate` | Aplica as migrations pendentes |
| `npm run seed` | Recria os dados de demonstração |
| `node src/db/smoke.js` | Roda os 62 testes de integração da API |

### Frontend
| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Gera a versão de produção em `dist/` |
| `npm run preview` | Serve a versão gerada |

---

## O que o sistema faz

**Dashboard** — saldo, receitas, despesas, resultado, investido, patrimônio,
contas a pagar e a receber, gastos por categoria, evolução do saldo e do
patrimônio, receitas x despesas por mês, últimas movimentações e próximos
vencimentos. Tudo recalcula ao trocar o período no topo (mês, ano ou intervalo).

**Receitas e despesas** — categoria e subcategoria, conta ou cartão, forma de
pagamento, três datas (compra, vencimento, pagamento), status, natureza fixa ou
variável, parcelamento, recorrência, etiquetas, observações e anexos.

**Contas e carteiras** — sete tipos, saldo atual e previsto, extrato com saldo
acumulado linha a linha, e transferências entre contas que **não** contaminam o
resultado do mês.

**Cartões** — limite, fechamento, vencimento, fatura atual e próxima, histórico
de faturas e pagamento que debita a conta escolhida. Uma compra parcelada cria
as parcelas nas faturas dos meses seguintes automaticamente.

**Investimentos** — 12 tipos de ativo, preço médio recalculado a cada aporte,
rentabilidade em R$ e %, proventos, histórico de movimentos, distribuição da
carteira e evolução do valor de mercado.

**Orçamento** — limite geral do mês e limites por categoria, com valor gasto,
restante, percentual e alertas em 80%, 90% e 100%. Dá para copiar os limites de
um mês para outro.

**Metas** — valor objetivo, prazo, percentual atingido, histórico de aportes e o
quanto guardar por mês para cumprir o prazo.

**Calendário** — grade mensal com receitas, despesas, faturas, investimentos e
transferências; clicar num dia abre tudo o que acontece nele.

**Relatórios** — por dia, semana, mês, ano ou período livre; por categoria,
conta, cartão e forma de pagamento. Indicadores de média de gasto, maior
despesa, categoria com maior gasto, taxa de economia, crescimento patrimonial e
comparação com o período anterior. Exportação em **CSV, Excel e PDF**.

**Minha vida financeira** — a equação `Patrimônio − Dívidas = Patrimônio
líquido`, composição dos ativos, evolução de 12 meses e projeção de quanto você
terá em **1, 5 e 10 anos** mantendo o ritmo atual de aportes, com simulador para
testar outros cenários.

**Histórico** — trilha de auditoria de toda criação, alteração e exclusão, e
lixeira para restaurar lançamentos excluídos. Nada se perde na virada de mês ou
de ano.

**Outros** — tema claro e escuro, interface responsiva, confirmação antes de
excluir, duplicação de lançamentos, importação de CSV/Excel, backup e
restauração, notificações de vencimento, login com recuperação de senha e busca
geral (Ctrl+K).

---

## Arquitetura

```
contas/
├── docs/ARQUITETURA.md      Modelagem, relacionamentos e regras de negócio
├── backend/
│   └── src/
│       ├── config/          Variáveis de ambiente
│       ├── db/              Conexão, migrations, seed e testes
│       ├── middleware/      Autenticação, validação, tratamento de erros
│       ├── modules/         Um diretório por domínio
│       └── utils/           Dinheiro, datas, filtros, auditoria
└── frontend/
    └── src/
        ├── components/      ui, layout, charts, forms
        ├── context/         Autenticação, tema, período, avisos
        ├── hooks/           Consultas e mutações compartilhadas
        ├── lib/             Cliente da API e formatadores pt-BR
        └── pages/           Uma por tela
```

| Camada | Tecnologia |
|---|---|
| Banco | PostgreSQL (`pg`); em desenvolvimento, PGlite embarcado |
| Backend | Node.js 20+ + Express 5 + Zod + JWT + scrypt |
| Frontend | React 19 + Vite + React Router + TanStack Query |
| UI | Tailwind CSS v4, componentes próprios, Recharts |
| Exportação | ExcelJS, PDFKit, CSV nativo |

Detalhes de modelagem e das regras de negócio em
[docs/ARQUITETURA.md](docs/ARQUITETURA.md).

---

## Decisões que valem saber

**Dinheiro em centavos.** Todo valor monetário é inteiro de centavos no banco e
na API. A conversão para reais acontece só na hora de exibir. Isso elimina a
classe inteira de erros de arredondamento de ponto flutuante.

**Receita e despesa na mesma tabela.** As duas são linhas de `transactions`
separadas por `kind`. Dashboard, calendário, relatórios, histórico e busca
consultam uma única fonte de verdade, sem `UNION` entre tabelas.

**"Atrasado" é calculado, não gravado.** O banco guarda só `pending`, `settled` e
`canceled`; o atraso é derivado comparando o vencimento com a data de hoje. Um
status gravado ficaria obsoleto na virada do dia e exigiria um job para corrigir.

**Saldo nunca é armazenado.** É sempre derivado dos lançamentos liquidados, então
não existe a possibilidade de o saldo divergir do extrato.

**Transferência não é receita nem despesa.** Ela gera duas linhas espelhadas
marcadas como neutras, que movimentam saldo mas são excluídas de todo agregado
de receita ou despesa.

**Parcela não perde centavo.** Ao dividir R$ 1.000,00 em 3, o sistema gera
R$ 333,34 + R$ 333,33 + R$ 333,33 — o resto vai na primeira parcela para a soma
bater exatamente com o total.

**Excluir não apaga.** Lançamentos excluídos vão para a lixeira e podem ser
restaurados. Contas, categorias e cartões com histórico não podem ser excluídos:
o sistema oferece arquivar.

**Cores dos gráficos validadas.** A paleta categórica foi verificada para
daltonismo (ΔE ≥ 8 entre tons vizinhos) e contraste, em tema claro e escuro.
Séries de receita x despesa usam azul e laranja em vez de verde e vermelho —
esse par é justamente o que falha nas simulações de daltonismo. Verde e vermelho
seguem valendo no texto dos indicadores, onde são cor de tipografia e não
identidade de série.

---

## Segurança

- Senha com **scrypt** (N=16384) e sal aleatório de 16 bytes por usuário,
  comparação em tempo constante.
- **JWT** de acesso com 15 minutos e token de atualização rotativo de 7 dias;
  trocar a senha revoga todas as sessões.
- **Isolamento por usuário** em toda consulta ao banco.
- **Limite de tentativas** no login e na recuperação de senha.
- **Zod** valida 100% das entradas de escrita; o handler central de erros não
  vaza stack trace em produção.
- Upload com lista branca de tipos e nome de arquivo gerado no servidor.
- Helmet, CORS restrito e limite de tamanho de payload.

### Antes de publicar em produção

1. Defina `JWT_SECRET` no `.env` — a aplicação se recusa a subir em produção com
   o segredo padrão.
2. Ajuste `CORS_ORIGINS` para o domínio real.
3. Configure um serviço de e-mail para a recuperação de senha. Hoje o token é
   escrito no log do servidor (e devolvido na resposta apenas fora de produção);
   o ponto de integração está em `backend/src/modules/auth/index.js`.
4. Faça backup do arquivo `backend/data/financas.db` — é onde tudo mora.
