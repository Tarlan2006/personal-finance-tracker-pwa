import { it, expect } from 'vitest';
import { measureSession } from './ops-measure';

it('бюджет обращений к хранилищу на запрос не превышен', async () => {
  const rows = await measureSession();
  const budget: Record<string, number> = {
    'POST /api/auth/login': 4, 'GET /api/accounts (свой аккаунт)': 2, 'GET /api/me': 2, 'GET /api/categories': 2, 'GET /api/financial-profile': 2, 'PUT /api/financial-profile': 3,
    'GET /api/entries (лента, 100)': 3, 'POST /api/entries (добавить)': 5, 'POST /api/entries (повтор, дубль)': 5,
    'GET /api/reports/summary': 3, 'POST /api/import (1000 строк)': 7, 'POST /api/import (1000 строк, dryRun)': 18, 'POST /api/import (500 строк)': 7, 'POST /api/import (500 строк, dryRun)': 12, 'POST /api/import (200 строк)': 7, 'POST /api/shortcuts/add': 8,
  };
  for (const r of rows) if (budget[r.step] !== undefined) expect(r.ops, r.step).toBeLessThanOrEqual(budget[r.step]);
});
