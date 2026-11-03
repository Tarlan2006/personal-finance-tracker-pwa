import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Instrument the actual SW script, rather than Chromium-only worker inspection.
for(const mode of ['missing','throws','rejects'])test(`Service Worker: ${mode} кэш, онлайн/офлайн и восстановление`,async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const deny=`Object.defineProperty(self,'caches',{configurable:true,get(){if('${mode}'==='throws')throw new DOMException('Synthetic storage denial','SecurityError');if('${mode}'==='rejects')return {open:async()=>{throw new Error('Synthetic quota denial');},keys:async()=>{throw new Error('Synthetic storage denial');}};return undefined;}});`;
 await context.route('**/sw.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:deny+'\n'+readFileSync('web/public/sw.js','utf8')}));
 await page.goto('/');
 await page.evaluate(async()=>{
  await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
 });
 await page.reload();await expect(page.getByLabel('Логин',{exact:true})).toBeVisible();
 await context.setOffline(true);const response=await page.reload();expect(response?.status()).toBe(503);await expect(page.getByRole('button',{name:'Попробовать снова'})).toBeVisible();
 await context.setOffline(false);await page.getByRole('button',{name:'Попробовать снова'}).click();await expect(page.getByLabel('Логин',{exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
