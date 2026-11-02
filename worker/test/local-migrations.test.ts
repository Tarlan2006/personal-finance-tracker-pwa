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
    expect(local.raw.prepare('SELECT count(*) n FROM local_schema_migrations').get()).toMatchObject({n:3});
    expect(local.raw.prepare('SELECT count(*) n FROM categories').get()).toMatchObject({n:12});
  }finally{local.raw.close();for(const suffix of ['','-shm','-wal'])if(existsSync(file+suffix))unlinkSync(file+suffix);}
});
