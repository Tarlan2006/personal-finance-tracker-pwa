-- Questionnaire snapshots are separate from income/expense entries.
CREATE TABLE financial_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  status TEXT NOT NULL CHECK (status IN ('draft','complete','deferred')),
  version INTEGER NOT NULL CHECK (version > 0),
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
