import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {addAccount,call,loginAs,makeEnv,MIGRATIONS} from './helpers';
it('keeps separate import histories for two financial accounts, including migrated rows',async()=>{
 const {env,local,store}=makeEnv();await addAccount(store,'audit-import');const {cookie}=await loginAs(env,'audit-import');
 const accounts=['card','deposit'].map(id=>({id,bank:'Kaspi',name:id,kind:id,openingBalanceMinor:0}));
 const profile={balanceDate:'2025-01-01',accounts,expenseCategoryIds:[],monthlyBudgetMinor:null,incomes:[],obligations:[],householdSize:1,goal:'',goalTargetMinor:null,monthlySavingMinor:null};
 expect((await call(env,'PUT','/api/financial-profile',{cookie,body:{version:0,status:'deferred',profile}})).status).toBe(200);
 const run=async(id:string,dryRun=false)=>(await call(env,'POST','/api/import',{cookie,body:{financialAccountId:id,bank:'generic',dryRun,csv:'date;amount;shop\n2025-01-01;-1.75;SYNTH',mapping:{delimiter:';',dateCol:0,amountCol:1,counterpartyCol:2}}})).data;
 expect(await run('card')).toMatchObject({imported:1,duplicates:0});
 expect(await run('deposit',true)).toMatchObject({imported:1,duplicates:0});
 expect(await run('deposit')).toMatchObject({imported:1,duplicates:0});
 expect(await run('deposit')).toMatchObject({imported:0,duplicates:1});
 local.raw.exec("UPDATE entries SET dedupe_key=substr(dedupe_key,1,64) WHERE financial_account_id='card'");
 local.raw.exec(readFileSync(join(MIGRATIONS,'0009_import_account_keys.sql'),'utf8'));
 expect(await run('card',true)).toMatchObject({imported:0,duplicates:1});local.raw.close();
});
