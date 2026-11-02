-- Домен «деньги»: категории, контрагенты, правила, пакеты импорта
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income')),
  color TEXT NOT NULL DEFAULT '#8e8e93',
  sort INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_categories_account ON categories(account_id);

CREATE TABLE counterparties (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name_norm TEXT NOT NULL,
  display TEXT NOT NULL,
  category_out_id TEXT,
  category_in_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, name_norm)
);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  pattern TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out','any')),
  category_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rules_account ON rules(account_id);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  source TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  total INTEGER NOT NULL,
  imported INTEGER NOT NULL,
  duplicates INTEGER NOT NULL,
  rejected INTEGER NOT NULL,
  report_json TEXT NOT NULL
);
CREATE INDEX idx_batches_account ON import_batches(account_id, created_at DESC);
