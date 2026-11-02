import {it,expect,vi} from 'vitest';
import {addAccount,call,loginAs,makeEnv} from './helpers';
import {readBody} from '../src/util';

it('краш-тест: некорректные JSON, типы полей, URL и параметры возвращают 4xx, не 500',async()=>{
 const {env,store}=makeEnv();await addAccount(store,'audit');const {cookie}=await loginAs(env,'audit');
 const failures:string[]=[];
 const cases:Array<[string,string,unknown]>=[
  ...['/api/entries','/api/entries/batch','/api/categories','/api/rules','/api/financial-profile'].map(p=>[p==='/api/financial-profile'?'PUT':'POST',p,null] as [string,string,unknown]),
  ['POST','/api/entries/batch',{items:[null,1,[]]}],
  ['POST','/api/entries',{direction:'out',amountMinor:100,categoryId:{}}],
  ['POST','/api/entries',{direction:'out',amountMinor:100,counterparty:['x']}],
  ['POST','/api/entries',{direction:'out',amountMinor:100,occurredAt:'2026-02-31'}],
  ['POST','/api/entries',{direction:'out',amountMinor:100,occurredAt:Date.now()+.5}],
  ['POST','/api/rules',{pattern:{}}],
  ['POST','/api/import',{csv:'date;amount\n01.11.2026;1',mapping:{dateCol:0,amountCol:1,inValues:{}}}],
  ['GET','/api/entries?limit=1.5',undefined],['GET','/api/entries?from=NaN',undefined],['GET','/api/entries?beforeTime=Infinity&beforeId=a',undefined],
  ['DELETE','/api/entries/%E0%A4%A',undefined],
 ];
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{for(const [method,path,body] of cases){const r=await call(env,method,path,{cookie,body});if(path.endsWith('/batch')&&r.status===200){if(!r.data.results.every((x:any)=>!x.ok))failures.push(path+' invalid item accepted');}else if(r.status<400||r.status>=500)failures.push(`${method} ${path} = ${r.status}`);}}finally{log.mockRestore();}
 expect(failures).toEqual([]);
 expect((await call(env,'GET','/api/entries',{cookie})).data.items).toEqual([]);
});
it('краш-тест: незакрытая CSV-кавычка не поглощает остальные операции',async()=>{
 const {env,store}=makeEnv();await addAccount(store,'audit');const {cookie}=await loginAs(env,'audit');
 const r=await call(env,'POST','/api/import',{cookie,body:{csv:'date;amount;name\n01.11.2026;-1;"BROKEN\n02.11.2026;-2;AUDIT',mapping:{dateCol:0,amountCol:1,counterpartyCol:2}}});
 expect(r.status).toBe(400);expect((await call(env,'GET','/api/entries',{cookie})).data.items).toEqual([]);
});
it('краш-тест: размер потока ограничивается до чтения всего тела',async()=>{
 let pulls=0,cancelled=false;const stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(8));if(pulls===100)c.close();},cancel(){cancelled=true;}});
 const req=new Request('https://test.local',{method:'POST',body:stream,duplex:'half'} as any);
 await expect(readBody(req,10)).rejects.toMatchObject({status:413});expect(pulls).toBeLessThan(5);expect(cancelled).toBe(true);
});
it('краш-тест: клиентские имена не выдаются без входа, login защищён от чужого Origin',async()=>{
 const {env,store}=makeEnv();await addAccount(store,'audit');await addAccount(store,'other');
 expect((await call(env,'GET','/api/accounts')).status).toBe(401);
 const {cookie}=await loginAs(env,'audit');const r=await call(env,'GET','/api/accounts',{cookie});expect(r.data.accounts.map((a:any)=>a.login)).toEqual(['audit']);
 expect((await call(env,'POST','/api/auth/login',{headers:{origin:'https://evil.test'},body:{login:'audit',password:'correct-horse-battery'}})).status).toBe(403);
});
it('краш-тест: категории не обрезаются и переименование в существующую запрещено',async()=>{
 const {env,store}=makeEnv();await addAccount(store,'audit');const {cookie}=await loginAs(env,'audit');
 for(const name of [{},['abc'],'a'.repeat(41)])expect((await call(env,'POST','/api/categories',{cookie,body:{name,type:'expense'}})).status).toBe(400);
 const cats=(await call(env,'GET','/api/categories',{cookie})).data.categories;const a=cats.find((c:any)=>c.name==='Транспорт');
 expect((await call(env,'PATCH','/api/categories/'+a.id,{cookie,body:{name:'магазины'}})).status).toBe(409);
});
it('краш-тест: экстремальный месячный итог не округляет тиыны молча',async()=>{
 const {env,store}=makeEnv();await addAccount(store,'audit');const {cookie}=await loginAs(env,'audit');
 const csv='date;amount;name\n'+Array.from({length:1000},(_,i)=>`01.11.2026;-100000000000;AUDIT EXTREME ${i}`).join('\n');
 expect((await call(env,'POST','/api/import',{cookie,body:{csv,mapping:{dateCol:0,amountCol:1,counterpartyCol:2}}})).data.imported).toBe(1000);
 const report=await call(env,'GET','/api/reports/summary?month=2026-11',{cookie});expect(report.status).toBe(422);expect(report.data.error).toBe('total_too_large');
});
it('краш-тест: конкурентное создание категории не дублирует имя, повтор после удаления не оживляет старый id',async()=>{
 const {env,store}=makeEnv();await addAccount(store,'audit');const {cookie}=await loginAs(env,'audit');
 const responses=await Promise.all(['AUDIT CATEGORY','audit category'].map(name=>call(env,'POST','/api/categories',{cookie,body:{name,type:'expense'}})));
 expect(responses.map(r=>r.status).sort()).toEqual([201,409]);const first=responses.find(r=>r.status===201)!.data;
 expect((await call(env,'DELETE','/api/categories/'+first.id,{cookie})).status).toBe(200);
 const next=await call(env,'POST','/api/categories',{cookie,body:{name:'Audit Category',type:'expense'}});expect(next.status).toBe(201);expect(next.data.id).not.toBe(first.id);
});
it('краш-тест: конкурентные rename/rename и create/rename не обходят уникальность названия',async()=>{
 const {env,store}=makeEnv();await addAccount(store,'audit');const {cookie}=await loginAs(env,'audit');
 const cats=(await call(env,'GET','/api/categories',{cookie})).data.categories.filter((c:any)=>c.type==='expense');
 const names=['AUDIT "ЁЛКА" \\ TEST','AUDIT "ЁЛКА" \\ TEST'];
 const renamed=await Promise.all(cats.slice(0,2).map((c:any,i:number)=>call(env,'PATCH','/api/categories/'+c.id,{cookie,body:{name:names[i]}})));
 expect(renamed.map(r=>r.status).sort()).toEqual([200,409]);
 const mixed=await Promise.all([call(env,'PATCH','/api/categories/'+cats[2].id,{cookie,body:{name:'AUDIT MIXED'}}),call(env,'POST','/api/categories',{cookie,body:{name:'audit mixed',type:'expense'}})]);
 expect(mixed.filter(r=>r.status<300)).toHaveLength(1);expect(mixed.filter(r=>r.status===409)).toHaveLength(1);
 const current=(await call(env,'GET','/api/categories',{cookie})).data.categories;expect(current.filter((c:any)=>c.name.toLowerCase()==='audit mixed')).toHaveLength(1);
});
