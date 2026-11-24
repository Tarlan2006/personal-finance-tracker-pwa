import {it,expect} from 'vitest';
import {makeEnv,addAccount,loginAs,call,PW} from './helpers';
const key=async(s:string)=>crypto.subtle.importKey('raw',Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)),'AES-GCM',false,['encrypt','decrypt']);
it('ключ отсутствует в me, ротируется с паролем, старые запечатанные очереди восстанавливаются только после входа',async()=>{
  const {env,store}=makeEnv();await addAccount(store,'rotation-owner');await addAccount(store,'rotation-other');
  const first=await loginAs(env,'rotation-owner'),second=await loginAs(env,'rotation-owner');
  const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode('synthetic sealed queue');
  const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(first.data.queueKey),plain);
  const me=await call(env,'GET','/api/me',{cookie:first.cookie});expect(me.data).not.toHaveProperty('queueKey');expect(me.data).not.toHaveProperty('queueRecoveryKeys');
  const changed=await call(env,'POST','/api/auth/password',{cookie:first.cookie,body:{current:PW,next:'synthetic-new-password'}});expect(changed.status).toBe(200);expect(changed.data).not.toHaveProperty('queueKey');
  expect((await call(env,'GET','/api/me',{cookie:second.cookie})).status).toBe(401);
  const fresh=await loginAs(env,'rotation-owner','synthetic-new-password');expect(fresh.data.queueKey).not.toBe(first.data.queueKey);expect(fresh.data.queueRecoveryKeys).toContain(first.data.queueKey);
  await expect(crypto.subtle.decrypt({name:'AES-GCM',iv},await key(fresh.data.queueKey),sealed)).rejects.toThrow();
  const restored=await crypto.subtle.decrypt({name:'AES-GCM',iv},await key(fresh.data.queueRecoveryKeys[0]),sealed);
  const nextIv=crypto.getRandomValues(new Uint8Array(12)),resealed=await crypto.subtle.encrypt({name:'AES-GCM',iv:nextIv},await key(fresh.data.queueKey),restored);
  expect(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:nextIv},await key(fresh.data.queueKey),resealed))).toBe('synthetic sealed queue');
  const other=await loginAs(env,'rotation-other');expect(other.data.queueRecoveryKeys).toEqual([]);
  const bad=await loginAs(env,'rotation-owner','incorrect-password');expect(bad.data).not.toHaveProperty('queueKey');
});
