// Standalone audit. Only an in-memory SQLite database is accepted.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {addAccount,call,loginAs,makeEnv} from '../worker/test/helpers';

export async function auditLedger() {
  const {env,store,local}=makeEnv();
  try {
    const owner=await addAccount(store,'audit-ledger');
    const cookie=(await loginAs(env,'audit-ledger')).cookie;
    async function request(method:string,path:string,body?:unknown) {
      const r=await call(env,method,path,{cookie,body});
      assert.ok(r.status>=200&&r.status<300,method+' '+path+' '+r.status);
      return r.data;
    }
    const now=Date.now();
    const date=(ms:number)=>new Date(ms+18_000_000).toISOString();
    const current=date(now).slice(0,7),year=Number(current.slice(0,4));
    const opening=year+'-01-01',epoch=Date.parse(opening+'T00:00:00+05:00');
    const start=Date.parse(current+'-01T00:00:00+05:00');
    const accounts=[
      {id:'card',kind:'card',name:'Gold',bank:'Каспи',openingBalanceMinor:12345},
      {id:'deposit',kind:'deposit',name:'Резерв',bank:'Халык',openingBalanceMinor:101},
      {id:'cash',kind:'cash',name:'Кошелёк',bank:'Наличные',openingBalanceMinor:0,budgets:[{id:'cash-food',name:'Продукты',amountMinor:1105}]}
    ];
    const profile={balanceDate:opening,accounts,expenseCategoryIds:[],monthlyBudgetMinor:65001,incomes:[],obligations:[],householdSize:2,goal:'Тест',goalTargetMinor:40001,monthlySavingMinor:999};
    await request('PUT','/api/financial-profile',{version:0,status:'complete',profile});
    const stored=local.raw.prepare('SELECT payload_json FROM financial_profiles WHERE account_id=?').get(owner)!;
    const settings=JSON.parse(String(stored.payload_json));
    const plansMinor={
      opening:settings.accounts.reduce((sum:number,a:{openingBalanceMinor:number|null})=>sum+(a.openingBalanceMinor??0),0),
      budget:settings.monthlyBudgetMinor,saving:settings.monthlySavingMinor,target:settings.goalTargetMinor,
      cash:settings.accounts.find((a:{id:string})=>a.id==='cash').budgets[0].amountMinor
    };
    const cats=(await request('GET','/api/categories')).categories as Array<{id:string;type:string;name:string}>;
    const entries=Array.from({length:251},(_,i)=>{
      const direction=i%4===0?'in':'out', eligible=cats.filter(c=>c.type===(direction==='in'?'income':'expense'));
      const times=[epoch-1,epoch,epoch+1,start-1,start,start+1,now-86400000,now+86400000];
      return {id:'audit-tx-'+String(i).padStart(4,'0'),login:'audit-ledger',amountMinor:i===0?10_000_000_000_000:i%19===0?1:i*37+9,
        direction,financialAccountId:i%11===0?null:accounts[i%3].id,occurredAt:times[i%times.length],
        counterparty:'SHOP '+i%9,categoryId:i%5===0?null:eligible[i%eligible.length].id};
    });
    for(let i=0;i<entries.length;i+=50){
      const batch=await request('POST','/api/entries/batch',{items:entries.slice(i,i+50)});
      assert.ok(batch.results.every((r:{ok:boolean})=>r.ok));
    }
    await request('DELETE','/api/entries/'+entries[17].id);
    await request('POST','/api/transfers',{id:'audit-transfer',accountLogin:'audit-ledger',fromId:'card',toId:'deposit',amountMinor:101,occurredAt:epoch});
    const raw=local.raw.prepare('SELECT id,kind,occurred_at,value,deleted_at,payload_json FROM entries WHERE account_id=?').all(owner);
    const live=raw.filter(r=>r.deleted_at===null).map(r=>({id:String(r.id),kind:r.kind,at:Number(r.occurred_at),signed:BigInt(r.value as number),p:JSON.parse(String(r.payload_json))}));
    const tx=live.filter(r=>r.kind==='tx');
    const amount=(n:bigint)=>(n<0n?'-':'')+(Number(n<0n?-n:n)/100).toLocaleString('ru-RU',{minimumFractionDigits:n%100n?2:0,maximumFractionDigits:2})+' ₸';
    const key=(await request('POST','/api/keys',{label:'synthetic audit',scope:'read'})).key;
    const months=[...new Set(tx.map(r=>date(r.at).slice(0,7)))];
    for(const m of months){
      const rows=tx.filter(r=>date(r.at).startsWith(m));
      for(const filter of [null,'','cash','card','deposit']){
        const scope=rows.filter(r=>filter===null||(r.p.financialAccountId??'')===filter);
        const report=await request('GET','/api/reports/summary?month='+m+(filter===null?'':'&financialAccountId='+filter));
        assert.equal(report.totals.count,scope.length);
        for(const dir of ['out','in'] as const){
          const group=scope.filter(r=>dir==='in'?r.signed>0n:r.signed<0n);
          const sums=new Map<string,bigint>(),people=new Map<string,bigint>();let total=0n;
          for(const r of group){const n=r.signed<0n?-r.signed:r.signed;total+=n;const cat=r.p.categoryId??'';
            sums.set(cat,(sums.get(cat)??0n)+n);people.set(r.p.counterparty,(people.get(r.p.counterparty)??0n)+n);}
          assert.equal(BigInt(report.totals[dir]),total);
          assert.deepEqual(new Map(report.byCategory[dir].map((c:any)=>[c.id??'',BigInt(c.sum)])),sums);
          assert.deepEqual(new Map(report.byCounterparty[dir].map((c:any)=>[c.display,BigInt(c.sum)])),people);
          const ordered=group.sort((a,b)=>b.p.amountMinor-a.p.amountMinor||b.at-a.at||a.id.localeCompare(b.id)).slice(0,10);
          assert.deepEqual(report.topEntries[dir].map((r:any)=>r.id),ordered.map(r=>r.id));
        }
        assert.equal(BigInt(report.totals.net),scope.reduce((s,r)=>s+r.signed,0n));
        const uncategorized=scope.filter(r=>!r.p.categoryId);
        assert.deepEqual(report.uncategorized,{count:uncategorized.length,sum:Number(uncategorized.reduce((s,r)=>s+BigInt(r.p.amountMinor),0n))});
        if(filter===null){
          const short=await call(env,'GET','/api/shortcuts/summary?month='+m,{headers:{authorization:'Bearer '+key}});
          assert.equal(short.status,200);
          for(const [word,n] of [['расходы',report.totals.out],['доходы',report.totals.in],['баланс',report.totals.net]] as const)
            assert.ok(short.data.replace(/\s/g,' ').includes(word+' '+amount(BigInt(n)).replace(/\s/g,' ')));
        }
      }
    }
    const csv=await request('GET','/api/export.csv');
    const lines=csv.trim().split(/\r?\n/).slice(1);assert.equal(lines.length,tx.length);
    const byId=new Map(tx.map(r=>[r.id,r]));
    for(const line of lines){const [id,day,dir,n,currency]=line.split(',');const r=byId.get(id)!;assert.ok(r);
      assert.equal(day,date(r.at).slice(0,16).replace('T',' '));assert.equal(currency,'KZT');assert.equal(BigInt(n.replace('.',''))*(dir==='out'?-1n:1n),r.signed);}
    const wallet=await request('GET','/api/wallet');
    for(const a of accounts){
      let balance=BigInt(a.openingBalanceMinor),income=0n,expense=0n;
      for(const r of live){if(r.at>now)continue;
        if(r.kind==='transfer'){if(r.at>=epoch){if(r.p.fromId===a.id)balance-=BigInt(r.p.amountMinor);if(r.p.toId===a.id)balance+=BigInt(r.p.amountMinor);}continue;}
        if(r.p.financialAccountId!==a.id)continue;
        if(r.at>=epoch)balance+=r.signed;
        if(date(r.at).startsWith(current)){if(r.signed>0n)income+=r.signed;else expense-=r.signed;}
      }
      const w=wallet.accounts.find((r:any)=>r.id===a.id);assert.deepEqual([BigInt(w.balanceMinor),BigInt(w.in),BigInt(w.out)],[balance,income,expense]);
    }
    assert.equal(wallet.unassigned,tx.filter(r=>!r.p.financialAccountId&&r.at<=now).length);
    const plans:Record<string,string[]>={};
    let measuring='';
    const prepare=env.DB.prepare.bind(env.DB);
    env.DB.prepare=(sql:string)=>{
      const stmt=prepare(sql);
      if(measuring&&/FROM entries/i.test(sql)){
        const bind=stmt.bind.bind(stmt);
        stmt.bind=(...values:unknown[])=>{
          const steps=local.raw.prepare('EXPLAIN QUERY PLAN '+sql).all(...values as (string|number|null)[]);
          plans[measuring]=steps.map(step=>String(step.detail));
          return bind(...values);
        };
      }
      return stmt;
    };
    for(const [name,path] of Object.entries({wallet:'/api/wallet',search:'/api/entries?q=SHOP',filtered:'/api/reports/summary?month='+current+'&financialAccountId=card'})){
      measuring=name;await request('GET',path);
    }
    measuring='';
    const report=await request('GET','/api/reports/summary?month='+current);
    const walletLegs=live.filter(r=>r.at<=now).reduce((n,r)=>n+(r.kind==='transfer'?2:1),0);
    return {entries,accounts,profile,plans,plansMinor,walletLegs,rawRows:raw.length,exportRows:lines.length,months,reportCases:5*months.length,balances:wallet.accounts.map((a:any)=>a.balanceMinor),currentTotals:report.totals,categoryNames:cats,current,expectedReport:report};
  } finally {local.raw.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {rawRows,exportRows,months,reportCases,plans,walletLegs}=await auditLedger();
  console.log(JSON.stringify({rawRows,exportRows,months,reportCases,walletAccounts:3,walletLegs,plans,result:'OK'}));
}
