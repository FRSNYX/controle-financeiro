# Arquitetura — Sistema de Controle Financeiro Pessoal

## 1. Stack

| Camada | Tecnologia | Motivo |
|---|---|---|
| Banco | **SQLite** via `node:sqlite` (nativo do Node 24) | Zero dependência nativa/compilação no Windows. SQL padrão, migrável para Postgres. |
| Backend | **Node.js 24 + Express 5** (ESM) | API REST, camadas route → controller → service → repository. |
| Validação | **Zod** | Schemas de entrada em todas as rotas de escrita. |
| Auth | **JWT** (access + refresh) + **scrypt** (`node:crypto`) | Sem dependência nativa de bcrypt. |
| Frontend | **React 19 + Vite + React Router + TanStack Query** | SPA rápida, cache de dados, invalidação automática. |
| UI | **Tailwind CSS v4** + componentes próprios | Tema claro/escuro por tokens CSS, responsivo. |
| Gráficos | **Recharts** | Composição declarativa, responsivo. |
| Export | **ExcelJS** (xlsx), **PDFKit** (pdf), CSV nativo | Relatórios. |

Portas: backend `4000`, frontend `5173` (proxy `/api` → backend).

## 2. Princípio central do modelo de dados

Receitas e despesas **não** são tabelas separadas. Ambas são linhas de `transactions`
diferenciadas por `kind` (`income` | `expense`). Isso permite que Dashboard, Calendário,
Relatórios, Histórico e Busca consultem **uma única fonte de verdade**, sem UNION entre tabelas.

Transferências vivem em `transfers` e geram **duas** linhas espelhadas em `transactions`
com `kind = 'transfer_out'` / `'transfer_in'`, marcadas com `neutral = 1`. Elas movimentam
saldo de conta mas são **excluídas** de qualquer soma de receita/despesa.

### Status: armazenado vs. derivado
Armazenamos apenas 3 estados reais: `pending` | `settled` | `canceled`.
`overdue` (atrasado) é **derivado** em tempo de consulta:
```
overdue = status = 'pending' AND due_date < hoje
```
Motivo: um status "atrasado" gravado em banco fica obsoleto na virada do dia e exigiria job.
Derivar garante que a tela nunca mente. A API expõe `status_label` em pt-BR
(`previsto/recebido/pendente/pago/atrasado/cancelado`) conforme `kind`.

## 3. Tabelas e relacionamentos

```
users 1──N accounts 1──N transactions N──1 categories (self-FK parent_id = subcategoria)
      1──N credit_cards 1──N card_invoices 1──N transactions
      1──N transfers ──> gera 2 transactions neutras
      1──N investments 1──N investment_movements
                       1──N asset_valuations
      1──N budgets (mês + categoria|geral)
      1──N goals 1──N goal_contributions
      1──N assets          (bens: imóvel, veículo…)
      1──N liabilities     (dívidas: financiamento, empréstimo…)
      1──N recurrences ──> gera transactions futuras
      1──N attachments, audit_log, notifications
```

### Tabelas
1. **users** — id, name, email(unique), password_hash, password_salt, reset_token, reset_expires, theme, currency, created_at, updated_at
2. **accounts** — type: `checking|savings|wallet|cash|digital|broker|other`; `initial_balance`; saldo atual **calculado**, nunca gravado (evita divergência).
3. **categories** — `kind: income|expense`; `parent_id` self-FK para subcategoria; `is_system` protege as padrão contra exclusão.
4. **credit_cards** — limite, `closing_day`, `due_day`, conta de pagamento padrão.
5. **card_invoices** — uma por cartão/mês de referência (`reference_month` = `YYYY-MM`), com `closing_date`, `due_date`, `status`.
6. **transactions** — núcleo. Colunas por domínio:
   - comuns: `kind, description, amount, category_id, subcategory_id, account_id, notes, neutral`
   - datas: `competence_date` (compra/receita), `due_date` (vencimento/previsto), `settle_date` (pagamento/recebimento)
   - receita: `income_type`, `receipt_method`
   - despesa: `expense_nature` (`fixed|variable`), `payment_method`, `card_id`, `invoice_id`
   - parcelamento: `installment_group`, `installment_no`, `installment_total`
   - recorrência: `recurrence_id`
   - transferência: `transfer_id`
7. **transfers**, 8. **recurrences**, 9. **attachments**
10. **investments** — quantidade, preço médio, valor aplicado, valor atual.
11. **investment_movements** — `contribution|withdrawal|dividend|interest`; recalcula preço médio.
12. **asset_valuations** — histórico de valor de mercado por data → alimenta gráfico de evolução.
13. **budgets** — `month` + `category_id` NULL = orçamento geral.
14. **goals** / **goal_contributions**
15. **assets** / **liabilities** — base de "Minha Vida Financeira".
16. **audit_log** — before/after JSON de toda escrita.
17. **notifications** — vencimentos, estouro de orçamento.

## 4. Regras de negócio

**RN-01 Saldo da conta** = `initial_balance` + Σ(`income`+`transfer_in` liquidadas) − Σ(`expense`+`transfer_out` liquidadas). Só conta `status='settled'`. Saldo *previsto* inclui pendentes.

**RN-02 Transferência** nunca entra em receita/despesa: todo agregado filtra `neutral = 0`.

**RN-03 Parcelamento** — compra de N parcelas cria N transactions com o mesmo `installment_group`, `installment_no` 1..N, vencimentos mês a mês. Valor dividido com **ajuste de centavos na 1ª parcela** (Σ parcelas = total exato).

**RN-04 Fatura de cartão** — a compra entra na fatura cujo fechamento é o primeiro `closing_day` ≥ data da compra; se a compra ocorre no dia do fechamento ou depois, vai para a fatura seguinte. Despesa no cartão **não** baixa saldo de conta; só o **pagamento da fatura** gera saída na conta.

**RN-05 Limite disponível** = `limit_amount` − Σ(compras não pagas do cartão).

**RN-06 Recorrência** — gerador materializa as ocorrências até 12 meses à frente (idempotente por `recurrence_id + due_date`).

**RN-07 Preço médio** (aporte) = `(qtd_ant × pm_ant + qtd_nova × preço_novo) / (qtd_ant + qtd_nova)`. Retirada não altera preço médio. Rentabilidade R$ = `valor_atual − valor_aplicado`; % = `R$ / valor_aplicado`.

**RN-08 Orçamento** — `% usado = gasto / limite`. Alertas em 80%, 90%, 100%.

**RN-09 Patrimônio total** = saldo de contas + valor atual de investimentos + bens.
**Patrimônio líquido** = patrimônio total − dívidas.

**RN-10 Projeção (1/5/10 anos)** — juros compostos sobre aporte médio dos últimos 6 meses:
`VF = PL × (1+i)^n + aporte × [((1+i)^n − 1) / i]`, com `i` = taxa mensal configurável (padrão 0,8% a.m.).

**RN-11 Exclusão** — soft delete (`deleted_at`) em transações; histórico nunca some na virada de mês/ano.

**RN-12 Dinheiro** — todos os valores em **centavos (INTEGER)** no banco. Evita erro de ponto flutuante. Conversão para reais só na borda (API/UI).

## 5. Segurança
- Senha: scrypt (N=16384) + salt aleatório 16 bytes.
- JWT access 15min + refresh 7 dias; refresh rotativo.
- Rate limit no login e no "esqueci a senha".
- **Todo** query filtra por `user_id` (isolamento multiusuário).
- Helmet, CORS restrito, payload limitado, upload com whitelist de MIME.
- Zod valida 100% das entradas de escrita; handler central de erros sem vazar stack.

## 6. Páginas (frontend)
Login · Cadastro · Recuperar senha · Dashboard · Receitas · Despesas · Contas · Transferências ·
Cartões · Investimentos · Orçamento · Metas · Calendário · Relatórios · Histórico ·
**Minha Vida Financeira** · Categorias · Configurações (tema, backup, importação)
