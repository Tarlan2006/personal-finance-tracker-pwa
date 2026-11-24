import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeEnv,addAccount,loginAs,call,MIGRATIONS} from './helpers';
import {createLocalD1} from '../dev/sqlite-d1';
import {monthRange,currentMonth} from '../src/domain/money/normalize';

it('0006 переносит счета и обе стороны старого перевода в индексируемые поля',()=>{
  const {raw}=createLocalD1();raw.exec('CREATE TABLE entries(id TEXT,account_id TEXT,kind TEXT,deleted_at INTEGER,occurred_at INTEGER,value INTEGER,payload_json TEXT)');
  raw.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?)').run('old-tx','a','tx',null,1,-100,JSON.stringify({financialAccountId:'card'}));
  raw.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?)').run('old-transfer','a','transfer',null,1,0,JSON.stringify({fromId:'card',toId:'deposit',amountMinor:25}));
  raw.exec(readFileSync(join(MIGRATIONS,'0006_wallet_account_indexes.sql'),'utf8'));
  expect(raw.prepare('SELECT financial_account_id FROM entries WHERE id=?').get('old-tx')).toMatchObject({financial_account_id:'card'});
  expect(raw.prepare('SELECT financial_account_id,transfer_to_account_id,value FROM entries WHERE id=?').get('old-transfer')).toMatchObject({financial_account_id:'card',transfer_to_account_id:'deposit',value:-25});raw.close();
});
it.each([-7,5])('SQL совпадает со старой JS-логикой на 700 случайных записях, начало остатков: %i дней от месяца',async(offset)=>{
  const {store,env}=makeEnv(),owner=await addAccount(store,'wallet-random'),other=await addAccount(store,'wallet-other'),cookie=(await loginAs(env,'wallet-random')).cookie;
  const now=Date.now(),{from,to}=monthRange(currentMonth(now)),balanceFrom=from+offset*864e5,date=new Date(balanceFrom+5*3600e3).toISOString().slice(0,10);
  const accounts=[{id:'a',bank:'Kaspi',name:'Карта',kind:'card',openingBalanceMinor:10000},{id:'b',bank:'Freedom',name:'Депозит',kind:'deposit',openingBalanceMinor:20000},{id:'c',bank:'Halyk',name:'Без остатка',kind:'card',openingBalanceMinor:null}];
  await call(env,'PUT','/api/financial-profile',{cookie,body:{version:0,status:'deferred',profile:{balanceDate:date,accounts,expenseCategoryIds:[],incomes:[],obligations:[],householdSize:1,monthlyBudgetMinor:null,goal:'',goalTargetMinor:null,monthlySavingMinor:null}}});
  let seed=12345;const rand=(max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  const expected=accounts.map(a=>({...a,balanceMinor:a.openingBalanceMinor,in:0,out:0})),byId=new Map(expected.map(a=>[a.id,a]));let unassigned=0;
  const stmts=[];
  for(let i=0;i<700;i++){
    const id=['a','b','c','removed',null][rand(5)],dest=['a','b','c'][rand(3)],amount=1+rand(99999),direction=rand(2)?'in':'out',transfer=rand(4)===0,deleted=rand(9)===0,alien=rand(7)===0;
    const time=from+(rand(65)-20)*864e5,value=transfer?-amount:direction==='in'?amount:-amount;
    const p=transfer?{fromId:id,toId:dest,amountMinor:amount}:{financialAccountId:id,direction,amountMinor:amount};
    stmts.push(store.stmt('INSERT INTO entries(id,account_id,kind,occurred_at,created_at,updated_at,deleted_at,value,payload_json,financial_account_id,transfer_to_account_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)','random-'+i,alien?other:owner,transfer?'transfer':'tx',time,now,now,deleted?now:null,value,JSON.stringify(p),id,transfer?dest:null));
    if(alien||deleted||time>now)continue;
    if(transfer){if(time>=balanceFrom)for(const [key,sign] of [[id,-1],[dest,1]] as const){const a=byId.get(key??'');if(a&&a.balanceMinor!==null)a.balanceMinor+=sign*amount;}continue;}
    const a=byId.get(id??'');if(!a){unassigned++;continue;}if(time>=balanceFrom&&a.balanceMinor!==null)a.balanceMinor+=value;if(time>=from&&time<to)a[direction]+=amount;
  }
  await store.batch(stmts);const result=await call(env,'GET','/api/wallet',{cookie});expect(result.status).toBe(200);expect(result.data).toEqual({accounts:expected,balanceDate:date,unassigned});expect(Number(result.headers.get('X-Storage-Ops'))).toBeLessThanOrEqual(3);
});
