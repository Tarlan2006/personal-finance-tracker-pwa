ALTER TABLE entries ADD COLUMN financial_account_id TEXT;
ALTER TABLE entries ADD COLUMN transfer_to_account_id TEXT;
UPDATE entries SET financial_account_id = NULLIF(json_extract(payload_json, '$.financialAccountId'), '') WHERE kind='tx';
UPDATE entries SET financial_account_id=json_extract(payload_json,'$.fromId'), transfer_to_account_id=json_extract(payload_json,'$.toId'), value=-json_extract(payload_json,'$.amountMinor') WHERE kind='transfer';
CREATE INDEX idx_entries_active_time ON entries(account_id,kind,deleted_at,occurred_at DESC,id DESC);
CREATE INDEX idx_entries_financial_time ON entries(account_id,kind,deleted_at,financial_account_id,occurred_at DESC,id DESC);
