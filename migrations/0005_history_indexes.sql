CREATE INDEX idx_entries_import ON entries(account_id, import_id, deleted_at);
CREATE INDEX idx_entries_history_search ON entries(account_id, search);
CREATE INDEX idx_batches_cursor ON import_batches(account_id, created_at DESC, id DESC);
