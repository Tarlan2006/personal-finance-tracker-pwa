import {it,expect} from 'vitest';
import {makeEnv,addAccount} from './helpers';
import {cleanupAfterLogin} from '../src/maintenance';
it('очистка ограничена 100 строками, атомарна по аккаунту и не трогает живые данные',async()=>{
  const {store,local}=makeEnv(),a=await addAccount(store,'cleanup-owner'),b=await addAccount(store,'cleanup-other'),now=Date.now(),day=864e5;
  for(let i=0;i<105;i++){
    await store.run('INSERT INTO sessions(id,account_id,token_hash,device_label,created_at,last_seen_at,expires_at) VALUES (?,?,?,\'test\',0,0,?)','old-'+i,a,'hash-'+i,now-40*day);
    await store.run('INSERT INTO rate_limits VALUES (?,?,1)','old-'+i,now-2*day);
    await store.run("INSERT INTO import_batches(id,account_id,source,filename,created_at,total,imported,duplicates,rejected,report_json,service) VALUES (?,?,'generic','synthetic',?,0,0,0,0,'[]',0)",'old-'+i,a,now-400*day);
  }
  await store.run("INSERT INTO sessions(id,account_id,token_hash,device_label,created_at,last_seen_at,expires_at) VALUES ('other-old',?,'other-hash','test',0,0,0)",b);
  await store.run("INSERT INTO sessions(id,account_id,token_hash,device_label,created_at,last_seen_at,expires_at,revoked_at) VALUES ('recent-revoke',?,'recent-hash','test',0,0,?,?)",a,now+day,now-day);
  await store.run("INSERT INTO rate_limits VALUES ('active',?,30)",now);
  await store.run("INSERT INTO entries(id,account_id,kind,occurred_at,created_at,updated_at,import_id) VALUES ('active',?,'tx',0,0,0,'old-0')",a);
  store.ops=0;await cleanupAfterLogin(store,a,now);expect(store.ops).toBe(2);
  expect(local.raw.prepare('SELECT count(*) n FROM sessions WHERE account_id=?').get(a)).toMatchObject({n:6});
  expect(local.raw.prepare('SELECT id FROM sessions WHERE id=\'other-old\'').get()).toBeTruthy();
  expect(local.raw.prepare('SELECT count(*) n FROM rate_limits').get()).toMatchObject({n:6});
  expect(local.raw.prepare('SELECT count(*) n FROM import_batches WHERE account_id=?').get(a)).toMatchObject({n:5});
  expect(local.raw.prepare("SELECT id FROM import_batches WHERE id='old-0'").get()).toBeTruthy();
  store.ops=0;await cleanupAfterLogin(store,a,now+1000);expect(store.ops).toBe(1);
  await cleanupAfterLogin(store,a,now+day);expect(local.raw.prepare('SELECT count(*) n FROM import_batches WHERE account_id=?').get(a)).toMatchObject({n:1});
});
