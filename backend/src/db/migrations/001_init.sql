-- ============================================================
-- 001_init.sql - Schema inicial
-- Convencoes:
--   * Valores monetarios em CENTAVOS (INTEGER). Nunca REAL.
--   * Datas em TEXT ISO 'YYYY-MM-DD'. Timestamps em ISO completo.
--   * Todo registro pertence a um user_id (isolamento multiusuario).
-- ============================================================

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  email           TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  password_salt   TEXT    NOT NULL,
  reset_token     TEXT,
  reset_expires   TEXT,
  theme           TEXT    NOT NULL DEFAULT 'dark',
  currency        TEXT    NOT NULL DEFAULT 'BRL',
  projection_rate REAL    NOT NULL DEFAULT 0.008,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT    NOT NULL UNIQUE,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- ------------------------------------------------------------
-- Contas e carteiras
-- ------------------------------------------------------------
CREATE TABLE accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  type             TEXT    NOT NULL CHECK (type IN
                     ('checking','savings','wallet','cash','digital','broker','other')),
  institution      TEXT,
  initial_balance  INTEGER NOT NULL DEFAULT 0,
  color            TEXT    NOT NULL DEFAULT '#6366f1',
  icon             TEXT    NOT NULL DEFAULT 'wallet',
  include_in_total INTEGER NOT NULL DEFAULT 1,
  archived         INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_accounts_user ON accounts(user_id, archived);

-- ------------------------------------------------------------
-- Categorias (parent_id = subcategoria)
-- ------------------------------------------------------------
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('income','expense')),
  parent_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  color      TEXT    NOT NULL DEFAULT '#64748b',
  icon       TEXT    NOT NULL DEFAULT 'tag',
  is_system  INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_categories_user ON categories(user_id, kind, archived);

-- ------------------------------------------------------------
-- Cartoes de credito e faturas
-- ------------------------------------------------------------
CREATE TABLE credit_cards (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT    NOT NULL,
  institution        TEXT,
  brand              TEXT,
  limit_amount       INTEGER NOT NULL DEFAULT 0,
  closing_day        INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day            INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  default_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  color              TEXT    NOT NULL DEFAULT '#8b5cf6',
  archived           INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_cards_user ON credit_cards(user_id, archived);

CREATE TABLE card_invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id         INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  reference_month TEXT    NOT NULL,
  closing_date    TEXT    NOT NULL,
  due_date        TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','paid')),
  paid_amount     INTEGER NOT NULL DEFAULT 0,
  paid_at         TEXT,
  payment_tx_id   INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (card_id, reference_month)
);
CREATE INDEX idx_invoices_card ON card_invoices(card_id, reference_month);

-- ------------------------------------------------------------
-- Recorrencias (templates que materializam transactions)
-- ------------------------------------------------------------
CREATE TABLE recurrences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('income','expense')),
  frequency    TEXT    NOT NULL CHECK (frequency IN
                 ('daily','weekly','biweekly','monthly','bimonthly','quarterly','semiannual','annual')),
  interval_n   INTEGER NOT NULL DEFAULT 1,
  start_date   TEXT    NOT NULL,
  end_date     TEXT,
  max_count    INTEGER,
  template     TEXT    NOT NULL,
  last_run     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_recurrences_user ON recurrences(user_id, active);

-- ------------------------------------------------------------
-- Transferencias entre contas (RN-02: nunca e receita/despesa)
-- ------------------------------------------------------------
CREATE TABLE transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  fee             INTEGER NOT NULL DEFAULT 0,
  date            TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT 'Transferencia',
  notes           TEXT,
  deleted_at      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX idx_transfers_user ON transfers(user_id, date);

-- ------------------------------------------------------------
-- TRANSACTIONS - nucleo (receitas, despesas e pernas de transferencia)
-- ------------------------------------------------------------
CREATE TABLE transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT    NOT NULL CHECK (kind IN
                     ('income','expense','transfer_in','transfer_out')),
  description      TEXT    NOT NULL,
  amount           INTEGER NOT NULL CHECK (amount >= 0),
  status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','settled','canceled')),
  neutral          INTEGER NOT NULL DEFAULT 0,

  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id       INTEGER REFERENCES accounts(id) ON DELETE SET NULL,

  competence_date  TEXT    NOT NULL,
  due_date         TEXT    NOT NULL,
  settle_date      TEXT,

  income_type      TEXT CHECK (income_type IS NULL OR income_type IN
                     ('salario','renda_extra','comissao','venda','dividendos',
                      'juros','reembolso','aluguel','premio','outros')),
  receipt_method   TEXT,

  expense_nature   TEXT CHECK (expense_nature IS NULL OR expense_nature IN ('fixed','variable')),
  payment_method   TEXT CHECK (payment_method IS NULL OR payment_method IN
                     ('dinheiro','pix','debito','credito','boleto','transferencia',
                      'cheque','vale','outros')),
  card_id          INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL,
  invoice_id       INTEGER REFERENCES card_invoices(id) ON DELETE SET NULL,

  installment_group TEXT,
  installment_no    INTEGER,
  installment_total INTEGER,

  recurrence_id    INTEGER REFERENCES recurrences(id) ON DELETE SET NULL,
  transfer_id      INTEGER REFERENCES transfers(id) ON DELETE CASCADE,
  goal_id          INTEGER,
  tags             TEXT,
  notes            TEXT,

  deleted_at       TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_tx_user_due    ON transactions(user_id, due_date, deleted_at);
CREATE INDEX idx_tx_user_kind   ON transactions(user_id, kind, status, deleted_at);
CREATE INDEX idx_tx_account     ON transactions(account_id, status, deleted_at);
CREATE INDEX idx_tx_category    ON transactions(category_id);
CREATE INDEX idx_tx_invoice     ON transactions(invoice_id);
CREATE INDEX idx_tx_installment ON transactions(installment_group);
CREATE INDEX idx_tx_settle      ON transactions(user_id, settle_date);

-- ------------------------------------------------------------
-- Anexos / comprovantes
-- ------------------------------------------------------------
CREATE TABLE attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
  filename       TEXT    NOT NULL,
  original_name  TEXT    NOT NULL,
  mime_type      TEXT    NOT NULL,
  size_bytes     INTEGER NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_attach_tx ON attachments(transaction_id);

-- ------------------------------------------------------------
-- Investimentos
-- ------------------------------------------------------------
CREATE TABLE investments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  ticker          TEXT,
  type            TEXT    NOT NULL CHECK (type IN
                    ('tesouro','cdb','lci_lca','acoes','fiis','etf','fundos',
                     'cripto','poupanca','previdencia','debenture','outros')),
  institution     TEXT,
  quantity        REAL    NOT NULL DEFAULT 0,
  avg_price       INTEGER NOT NULL DEFAULT 0,
  invested_amount INTEGER NOT NULL DEFAULT 0,
  current_value   INTEGER NOT NULL DEFAULT 0,
  purchase_date   TEXT    NOT NULL,
  maturity_date   TEXT,
  index_ref       TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_inv_user ON investments(user_id, archived);

CREATE TABLE investment_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL CHECK (type IN
                  ('contribution','withdrawal','dividend','interest','jcp','rent')),
  quantity      REAL    NOT NULL DEFAULT 0,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL,
  date          TEXT    NOT NULL,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_invmov      ON investment_movements(investment_id, date);
CREATE INDEX idx_invmov_user ON investment_movements(user_id, date, type);

CREATE TABLE asset_valuations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,
  market_value  INTEGER NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (investment_id, date)
);

-- ------------------------------------------------------------
-- Orcamento
-- ------------------------------------------------------------
CREATE TABLE budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month        TEXT    NOT NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  limit_amount INTEGER NOT NULL CHECK (limit_amount >= 0),
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX idx_budget_unique ON budgets(user_id, month, IFNULL(category_id, -1));

-- ------------------------------------------------------------
-- Metas
-- ------------------------------------------------------------
CREATE TABLE goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  type          TEXT    NOT NULL DEFAULT 'outros',
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  start_date    TEXT    NOT NULL,
  target_date   TEXT    NOT NULL,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  color         TEXT    NOT NULL DEFAULT '#10b981',
  icon          TEXT    NOT NULL DEFAULT 'target',
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','canceled')),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_goals_user ON goals(user_id, status);

CREATE TABLE goal_contributions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  notes      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_goalcontrib ON goal_contributions(goal_id, date);

-- ------------------------------------------------------------
-- Patrimonio: bens e dividas (Minha Vida Financeira)
-- ------------------------------------------------------------
CREATE TABLE assets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  type             TEXT    NOT NULL DEFAULT 'outros'
                     CHECK (type IN ('imovel','veiculo','equipamento','participacao','outros')),
  value            INTEGER NOT NULL DEFAULT 0,
  acquisition_date TEXT,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_assets_user ON assets(user_id);

CREATE TABLE liabilities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  type             TEXT    NOT NULL DEFAULT 'outros'
                     CHECK (type IN ('financiamento','emprestimo','cartao','consorcio','outros')),
  total_amount     INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL DEFAULT 0,
  monthly_payment  INTEGER NOT NULL DEFAULT 0,
  interest_rate    REAL    NOT NULL DEFAULT 0,
  start_date       TEXT,
  end_date         TEXT,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_liab_user ON liabilities(user_id);

-- ------------------------------------------------------------
-- Auditoria e notificacoes
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity      TEXT    NOT NULL,
  entity_id   INTEGER,
  action      TEXT    NOT NULL CHECK (action IN
                ('create','update','delete','restore','login','import')),
  summary     TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  severity   TEXT    NOT NULL DEFAULT 'info'
               CHECK (severity IN ('info','warning','danger','success')),
  title      TEXT    NOT NULL,
  message    TEXT,
  entity     TEXT,
  entity_id  INTEGER,
  ref_date   TEXT,
  read_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at, created_at DESC);
