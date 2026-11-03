import { it, expect } from 'vitest';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalD1 } from '../dev/sqlite-d1';
import { Store } from '../src/env';
import { addAccount, MIGRATIONS } from './helpers';

it('локальная существующая база получает новую миграцию один раз и сохраняет аккаунты',async()=>{
  const file=join(tmpdir(),`qarjy-migration-${crypto.randomUUID()}.sqlite`);
  let local=createLocalD1(file);
  try{
    for(const f of ['0001_core.sql','0002_money.sql'])local.raw.exec(readFileSync(join(MIGRATIONS,f),'utf8'));
    await addAccount(new Store(local.db),'synthetic-upgrade');local.raw.close();
    local=createLocalD1(file,MIGRATIONS);
    expect(local.raw.prepare('SELECT login FROM accounts').get()).toMatchObject({login:'synthetic-upgrade'});
    expect(local.raw.prepare('SELECT count(*) n FROM categories').get()).toMatchObject({n:12});
    expect(local.raw.prepare('SELECT count(*) n FROM financial_profiles').get()).toMatchObject({n:0});
    local.raw.close();local=createLocalD1(file,MIGRATIONS);
    expect(local.raw.prepare('SELECT count(*) n FROM local_schema_migrations').get()).toMatchObject({n:5});
    expect(local.raw.prepare('SELECT count(*) n FROM categories').get()).toMatchObject({n:12});
  }finally{local.raw.close();for(const suffix of ['','-shm','-wal'])if(existsSync(file+suffix))unlinkSync(file+suffix);}
});

it('миграция отчётов отделяет служебные строки, сохраняя порядок и финансовые записи',async()=>{
 const local=createLocalD1(':memory:');
 try{
  for(const f of ['0001_core.sql','0002_money.sql','0003_financial_profiles.sql'])local.raw.exec(readFileSync(join(MIGRATIONS,f),'utf8'));
  const account=await addAccount(new Store(local.db),'synthetic-reports');
  local.raw.prepare("INSERT INTO entries (id,account_id,kind,occurred_at,created_at,updated_at,value,payload_json,dedupe_key) VALUES ('synthetic-entry',?,'tx',1,1,1,-123,'{}','synthetic-dedupe')").run(account);
  const entry=local.raw.prepare('SELECT * FROM entries').get();
  const rows=[{line:2,status:'imported'},{line:3,status:'duplicate'},{line:4,status:'rejected',reason:'служебная строка или продолжение описания',preview:'SYNTHETIC FOOTER'},{line:5,status:'rejected',reason:'операция не завершена'},{line:6,status:'rejected',reason:'не распознана сумма'},{line:7,status:'rejected',reason:'служебная строка или продолжение описания',preview:'SYNTHETIC CONTINUATION'}];
  const put=local.raw.prepare('INSERT INTO import_batches (id,account_id,source,filename,created_at,total,imported,duplicates,rejected,report_json) VALUES (?,?,?,\'synthetic\',0,?,?,?, ?,?)');
  put.run('old-bank',account,'kaspi',6,1,1,4,JSON.stringify(rows));
  put.run('old-csv',account,'generic',1,0,0,1,JSON.stringify([rows[2]]));
  put.run('empty-csv',account,'generic',1,0,0,1,JSON.stringify([{line:2,status:'rejected',reason:'пустая строка',preview:' | | '}]));
  local.raw.exec(readFileSync(join(MIGRATIONS,'0004_import_service_rows.sql'),'utf8'));
  const b=local.raw.prepare("SELECT * FROM import_batches WHERE id='old-bank'").get() as any;
  expect(b).toMatchObject({total:6,imported:1,duplicates:1,rejected:2,service:2});expect(JSON.parse(b.report_json).map((r:any)=>r.line)).toEqual([2,3,4,5,6,7]);expect(JSON.parse(b.report_json).map((r:any)=>r.status)).toEqual(['imported','duplicate','service','rejected','rejected','service']);
  expect(local.raw.prepare("SELECT rejected,service FROM import_batches WHERE id='old-csv'").get()).toMatchObject({rejected:1,service:0});expect(local.raw.prepare("SELECT rejected,service FROM import_batches WHERE id='empty-csv'").get()).toMatchObject({rejected:0,service:1});
  expect(local.raw.prepare('SELECT * FROM entries').get()).toEqual(entry);
 }finally{local.raw.close();}
});
