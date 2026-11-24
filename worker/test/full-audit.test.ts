import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {addAccount,call,loginAs,makeEnv} from './helpers';
import {parseAmountMinor,parseDateMs} from '../src/domain/money/normalize';

it('parses tenge suffixes once and rejects malformed grouping',()=>{
  expect(['123 KZT','123 тг.','123 ₸'].map(parseAmountMinor)).toEqual([12300,12300,12300]);
  for(const input of ['1t2','1.2.3','1,23,4.56','2.3456'])expect(parseAmountMinor(input),input).toBeNull();
});
it('rejects seconds outside the minute',()=>{
  expect(parseDateMs('31.12.2025 12:59:75')).toBeNull();
});
it('does not relabel foreign currency as tenge on create or edit',async()=>{
 const {store,env}=makeEnv();await addAccount(store,'audit-money');const {cookie}=await loginAs(env,'audit-money');
 const body={id:'audit-currency-1',direction:'out',amountMinor:1};
 expect((await call(env,'POST','/api/entries',{cookie,body:{...body,currency:'USD'}})).status).toBe(400);
 expect((await call(env,'POST','/api/entries',{cookie,body:{...body,currency:'KZT'}})).status).toBe(201);
 expect((await call(env,'PATCH','/api/entries/'+body.id,{cookie,body:{version:1,currency:'EUR'}})).status).toBe(400);
});

it('limits a filtered monthly report to the selected account in SQLite',async()=>{
 const {store,local}=makeEnv(),id=await addAccount(store,'audit-plan');
 const {monthlySummary}=await import('../src/domain/money/reports');
 let plan='';
 const query=store.all.bind(store);
 store.all=async function<T>(sql:string,...args:unknown[]) {
   if(sql.includes('FROM entries'))plan=local.raw.prepare('EXPLAIN QUERY PLAN '+sql).all(...args as string[]).map(row=>row.detail).join(' ');
   return query<T>(sql,...args);
 };
 await monthlySummary(store,id,'2025-01',new URLSearchParams({financialAccountId:'example'}));
 expect(plan).toMatch(/idx_entries_financial_time.*financial_account_id=/);local.raw.close();
});
it('an idempotent retry does not insert a counterparty from a discarded payload',async()=>{
 const {store,env}=makeEnv();await addAccount(store,'audit-retry');const {cookie}=await loginAs(env,'audit-retry');
 const body={id:'audit-retry-01',direction:'in',amountMinor:100,counterparty:'A'};
 await call(env,'POST','/api/entries',{cookie,body});
 await call(env,'POST','/api/entries',{cookie,body:{...body,counterparty:'B'}});
 const names=(await call(env,'GET','/api/counterparties',{cookie})).data.counterparties.map((c:any)=>c.display);
 expect(names).toEqual(['A']);
});

it('keeps an actual counterparty named _none separate from anonymous transactions',async()=>{
 const {store,env}=makeEnv();await addAccount(store,'audit-cp');const {cookie}=await loginAs(env,'audit-cp');
 for(const name of ['','_none'])await call(env,'POST','/api/entries',{cookie,body:{direction:'out',amountMinor:7,counterparty:name,occurredAt:'2025-04-03'}});
 const r=await call(env,'GET','/api/reports/summary?month=2025-04',{cookie});
 expect(r.data.byCounterparty.out.map((c:any)=>[c.display,c.count]).sort()).toEqual([['_none',1],['Без контрагента',1]].sort());
});

it('returns a controlled precision error for wallet and report totals exceeding safe integers',async()=>{
 const {env,store,local}=makeEnv();const owner=await addAccount(store,'audit-limit'),{cookie}=await loginAs(env,'audit-limit');
 const month=new Date(Date.now()+18e6).toISOString().slice(0,7),now=Date.now();
 const profile={balanceDate:month+'-01',accounts:[{id:'a',bank:'bank',kind:'card',name:'card',openingBalanceMinor:0}],expenseCategoryIds:[],monthlyBudgetMinor:null,incomes:[],obligations:[],householdSize:1,goal:'',goalTargetMinor:null,monthlySavingMinor:null};
 await call(env,'PUT','/api/financial-profile',{cookie,body:{version:0,status:'complete',profile}});
 const value=10_000_000_000_000,payload=JSON.stringify({amountMinor:value,direction:'in',financialAccountId:'a',counterparty:'synthetic'});
 local.raw.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<901)
 INSERT INTO entries(id,account_id,kind,occurred_at,created_at,updated_at,value,payload_json,financial_account_id)
 SELECT 'limit-'||i,?,'tx',?,?,?,?,?,'a' FROM n`).run(owner,now,now,now,value,payload);
 for(const path of ['/api/reports/summary?month='+month,'/api/wallet']){
  const r=await call(env,'GET',path,{cookie});expect(r.status,path).toBe(422);expect(r.data.error).toBe('total_too_large');
 }
 local.raw.close();
});

it('only matches the exact path of the CSV export',async()=>{
 const {store,env}=makeEnv();await addAccount(store,'audit-path');
 const {cookie}=await loginAs(env,'audit-path');
 expect((await call(env,'GET','/api/export-csv',{cookie})).status).toBe(404);
 expect((await call(env,'GET','/api/export.csv',{cookie})).status).toBe(200);
});

it('checks credentials on every private route and accountLogin on every session mutation',async()=>{
 const {env,store,local}=makeEnv();
 await addAccount(store,'audit-routes');const {cookie}=await loginAs(env,'audit-routes');
 const source=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
 const routes=[...source.matchAll(/^route\('([A-Z]+)',\s*'([^']+)',\s*'(session|key)'/gm)];
 expect(routes.length).toBeGreaterThanOrEqual(42);
 for(const [,method,template,mode] of routes){
   const path=template.replace(':id','test-id');
   const body=method==='GET'?undefined:{accountLogin:'different-owner'};
   const anonymous=await call(env,method,path,{body});
   expect(anonymous.status,method+' '+path).toBe(401);
   if(mode==='session'&&body){
     const mismatch=await call(env,method,path,{cookie,body});
     expect([mismatch.status,mismatch.data.error],method+' '+path).toEqual([409,'account_changed']);
   }
 }
 local.raw.close();
});
