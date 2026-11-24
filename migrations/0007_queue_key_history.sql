-- Retain old keys for offline devices; only password-authenticated login returns them.
ALTER TABLE accounts ADD COLUMN queue_key_history TEXT NOT NULL DEFAULT '[]';
