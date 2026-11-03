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

it('история: 500 строк, просмотр и удаление укладываются в бюджет D1',async()=>{
 const {makeEnv,addAccount,loginAs,call}=await import('./helpers');
 const {env,store}=makeEnv();await addAccount(store,'history-ops');const cookie=(await loginAs(env,'history-ops')).cookie;
 const body={csv:'date;amount;name\n'+Array.from({length:500},(_,i)=>`01.11.2026;-${i+1};HISTORY OPS ${i}`).join('\n'),mapping:{dateCol:0,amountCol:1,counterpartyCol:2}};
 const report=(await call(env,'POST','/api/import',{cookie,body})).data;
 for(const path of ['/api/import/batches','/api/history/summary']){const r=await call(env,'GET',path,{cookie});expect(r.status).toBe(200);expect(Number(r.headers.get('X-Storage-Ops'))).toBeLessThanOrEqual(2);}
 const removed=await call(env,'DELETE','/api/import/batches/'+report.batchId,{cookie,body:{confirmation:'DELETE_DOCUMENT',accountLogin:'history-ops'}});expect(removed.data.removed).toBe(500);expect(Number(removed.headers.get('X-Storage-Ops'))).toBeLessThanOrEqual(3);
 await call(env,'POST','/api/import',{cookie,body});const clear=await call(env,'POST','/api/history/clear',{cookie,body:{confirmation:'DELETE_ALL_HISTORY',accountLogin:'history-ops'}});expect(clear.data.removed).toBe(500);expect(Number(clear.headers.get('X-Storage-Ops'))).toBeLessThanOrEqual(3);
});
