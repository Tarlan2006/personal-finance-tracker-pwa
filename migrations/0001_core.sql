-- Ядро: предметно-нейтральные таблицы
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_iter INTEGER NOT NULL,
  queue_key TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  label TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('write','read')),
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_keys_account ON api_keys(account_id);

CREATE TABLE kinds (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, key)
);

CREATE TABLE entries (
  id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  value INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'app',
  import_id TEXT,
  dedupe_key TEXT,
  search TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, id)
);
CREATE INDEX idx_entries_time ON entries(account_id, occurred_at DESC);
CREATE INDEX idx_entries_kind ON entries(account_id, kind, occurred_at DESC);
CREATE UNIQUE INDEX idx_entries_dedupe ON entries(account_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE settings (
  account_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
