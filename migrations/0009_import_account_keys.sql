-- Retain existing fingerprints; distinguish equal rows from different financial accounts.
UPDATE entries SET dedupe_key = dedupe_key || ':' || financial_account_id
WHERE kind = 'tx' AND length(dedupe_key) = 64 AND financial_account_id IS NOT NULL AND financial_account_id <> '';
