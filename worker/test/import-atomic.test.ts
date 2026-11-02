import { describe, it, expect } from 'vitest';
import { addAccount, makeEnv } from './helpers';
import { getBatch, runImport } from '../src/domain/money/import';
import { MAX_IMPORT_ROWS, MAX_IMPORT_REPORT_BYTES } from '../src/domain/money/import-limits';

const mapping = { dateCol:0, amountCol:1, counterpartyCol:2 };
const csv = (n:number) => 'date;amount;name\n' + Array.from({length:n},(_,i)=>`01.11.2026;-${i+1};TEST ${i}`).join('\n');
async function setup() {
  const e=makeEnv(); const account=await addAccount(e.store,'atomic-test'); e.store.ops=0;
  const count=(table:string)=>Number((e.local.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n);
  return {...e,account,count};
}

describe('атомарный импорт и ограничения D1',()=>{
  for(const failure of ['entry','report','final-select']) it(`сбой ${failure}: нет частичных операций, контрагентов или отчёта`,async()=>{
    const {store,local,account,count}=await setup();
    if(failure==='entry') local.raw.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON entries WHEN NEW.value=-4100 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`);
    if(failure==='report') local.raw.exec(`CREATE TRIGGER fail_report BEFORE INSERT ON import_batches BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`);
    if(failure==='final-select') {
      const batch=store.batch.bind(store);
      store.batch=stmts=>batch(stmts.length>3?[...stmts,store.stmt('SELECT * FROM missing_synthetic_table')]:stmts);
    }
    await expect(runImport(store,account,{csv:csv(50),mapping})).rejects.toMatchObject({status:503,code:'import_failed'});
    expect([count('entries'),count('counterparties'),count('import_batches')]).toEqual([0,0,0]);
    local.raw.close();
  });

  it('500 строк: все операции и полный отчёт, параметры и размер в пределах D1',async()=>{
    const {store,local,account,count}=await setup();
    const stmt=store.stmt.bind(store);
    store.stmt=(sql,...args)=>{
      expect(args.length).toBeLessThanOrEqual(100);
      expect(new TextEncoder().encode(sql).length).toBeLessThanOrEqual(100000);
      for(const arg of args) if(typeof arg==='string') expect(new TextEncoder().encode(arg).length).toBeLessThan(MAX_IMPORT_REPORT_BYTES);
      return stmt(sql,...args);
    };
    const r=await runImport(store,account,{csv:csv(500),mapping});
    expect(r).toMatchObject({total:500,imported:500,duplicates:0,rejected:0});
    expect(store.ops).toBeLessThanOrEqual(2);
    expect([count('entries'),count('counterparties'),count('import_batches')]).toEqual([500,500,1]);
    const saved=await getBatch(store,account,r.batchId!);
    expect(saved.rows).toEqual(r.rows); expect(saved.imported).toBe(500);
    expect(saved.rows.map((r:any)=>r.line)).toEqual(Array.from({length:500},(_,i)=>i+2));
    expect(JSON.stringify(saved.rows)).not.toContain('entryId');
    local.raw.close();
  });

  it('dryRun 500 строк: не больше 7 вызовов D1, никаких записей',async()=>{
    const {store,local,account,count}=await setup();
    const r=await runImport(store,account,{csv:csv(500),mapping,dryRun:true});
    expect(r.imported).toBe(500);expect(r.rows.length).toBe(500);expect(store.ops).toBeLessThanOrEqual(7);
    expect([count('entries'),count('counterparties'),count('import_batches')]).toEqual([0,0,0]);local.raw.close();
  });

  for(const hasHeader of [true,false]) it(`1001 строк (шапка ${hasHeader}): 413 до записей`,async()=>{
    const {store,local,account,count}=await setup();
    await expect(runImport(store,account,{csv:hasHeader?csv(1001):csv(1001).split('\n').slice(1).join('\n'),mapping:{...mapping,hasHeader}})).rejects.toMatchObject({status:413,code:'too_many_rows'});
    expect([count('entries'),count('counterparties'),count('import_batches')]).toEqual([0,0,0]);local.raw.close();
  });

  it('потерянный ответ после COMMIT: отчёт сохранён, повтор даёт только дубли',async()=>{
    const {store,local,account,count}=await setup();const batch=store.batch.bind(store);let lose=true;
    store.batch=async stmts=>{const res=await batch(stmts);if(stmts.length>3 && lose){lose=false;throw new Error('synthetic lost response');}return res;};
    await expect(runImport(store,account,{csv:csv(50),mapping})).rejects.toMatchObject({code:'import_failed'});
    expect([count('entries'),count('counterparties'),count('import_batches')]).toEqual([50,50,1]);
    const retry=await runImport(store,account,{csv:csv(50),mapping});
    expect(retry).toMatchObject({imported:0,duplicates:50,total:50});
    expect(count('entries')).toBe(50);expect(count('import_batches')).toBe(2);local.raw.close();
  });

  it('одновременные импорты: точные статусы в обоих сохранённых отчётах',async()=>{
    const {store,local,account,count}=await setup();
    const reports=await Promise.all([runImport(store,account,{csv:csv(50),mapping}),runImport(store,account,{csv:csv(50),mapping})]);
    expect(reports.map(r=>r.imported).sort((a,b)=>a-b)).toEqual([0,50]);
    expect(reports.map(r=>r.duplicates).sort((a,b)=>a-b)).toEqual([0,50]);
    for(const r of reports){ const saved=await getBatch(store,account,r.batchId!);expect(saved.rows).toEqual(r.rows);expect(saved.imported+saved.duplicates+saved.rejected+saved.service).toBe(saved.total); }
    expect(count('entries')).toBe(50);expect(count('import_batches')).toBe(2);local.raw.close();
  });

  it('500 отклонённых Unicode-строк: ограниченные причины и отчёт меньше лимита',async()=>{
    const {store,local,account}=await setup();
    const why='Я'.repeat(500);
    const r=await runImport(store,account,{csv:'why;date;amount\n'+Array(500).fill(`${why};01.11.2026;-1`).join('\n'),mapping:{dateCol:1,amountCol:2,rejectionCol:0}});
    expect(r).toMatchObject({imported:0,rejected:500,total:500});expect(r.rows.every(x=>x.reason!.length<=200)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(r.rows)).length).toBeLessThan(MAX_IMPORT_REPORT_BYTES);local.raw.close();
  });

  it('раздутый JSON из управляющих символов: 413 до записи, а не ошибка D1 после записи',async()=>{
    const {store,local,account,count}=await setup();
    const why='\u0001'.repeat(200);
    await expect(runImport(store,account,{csv:'why;date;amount\n'+Array(1000).fill(`${why};01.11.2026;-1`).join('\n'),mapping:{dateCol:1,amountCol:2,rejectionCol:0}})).rejects.toMatchObject({status:413,code:'report_too_large'});
    expect([count('entries'),count('counterparties'),count('import_batches')]).toEqual([0,0,0]);local.raw.close();
  });

  it('пустая таблица с шапкой: сохранён корректный пустой отчёт',async()=>{
    const {store,local,account}=await setup();const r=await runImport(store,account,{csv:'date;amount;name',mapping});
    expect(r).toMatchObject({total:0,imported:0,duplicates:0,rejected:0,rows:[]});expect((await getBatch(store,account,r.batchId!)).rows).toEqual([]);local.raw.close();
  });
});


it('1000 строк: атомарная запись и ограниченный dryRun',async()=>{
 const {store,local,account,count}=await setup();const r=await runImport(store,account,{csv:csv(MAX_IMPORT_ROWS),mapping});
 expect(r).toMatchObject({total:1000,imported:1000,duplicates:0});expect(store.ops).toBe(2);expect(count('entries')).toBe(1000);
 store.ops=0;const dry=await runImport(store,account,{csv:csv(1000),mapping,dryRun:true});expect(dry.duplicates).toBe(1000);expect(store.ops).toBeLessThanOrEqual(13);local.raw.close();
});
it('1000 служебных строк: полный атомарный отчёт, повтор без операций и прежний бюджет D1',async()=>{
 const {store,local,account,count}=await setup();
 try{const input={csv:'date;amount\n'+Array(1000).fill(';').join('\n'),mapping:{dateCol:0,amountCol:1}};
  store.ops=0;const r=await runImport(store,account,input);expect(r).toMatchObject({total:1000,imported:0,duplicates:0,rejected:0,service:1000});expect(r.rows).toHaveLength(1000);expect(store.ops).toBe(2);expect(count('entries')).toBe(0);
  expect(r.rows.map(x=>x.line)).toEqual(Array.from({length:1000},(_,i)=>i+2));const saved=await getBatch(store,account,r.batchId!);expect(saved.rows).toEqual(r.rows);expect(saved.service).toBe(1000);
  const repeated=await runImport(store,account,input);expect(repeated).toMatchObject({total:1000,imported:0,duplicates:0,rejected:0,service:1000});expect(count('entries')).toBe(0);
 }finally{local.raw.close();}
});
