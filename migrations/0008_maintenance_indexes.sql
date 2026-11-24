CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
CREATE INDEX idx_sessions_expiry ON sessions(account_id,expires_at);
CREATE INDEX idx_sessions_revoked ON sessions(account_id,revoked_at);
