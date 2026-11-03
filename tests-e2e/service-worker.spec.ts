import {test,expect} from '@playwright/test';

test('Service Worker: запрещённый кэш не блокирует сайт, офлайн показывает повтор',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await page.evaluate(async()=>{
  await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
 });
 const worker=context.serviceWorkers().find(w=>new URL(w.url()).pathname==='/sw.js');expect(worker).toBeTruthy();
 for(const mode of ['missing','throws','rejects']){
  await worker!.evaluate(mode=>Object.defineProperty(self,'caches',{configurable:true,get(){if(mode==='throws')throw new DOMException('Synthetic storage denial','SecurityError');if(mode==='rejects')return {open:async()=>{throw new Error('Synthetic quota denial');}};return undefined;}}),mode);
  await page.reload();await expect(page.getByLabel('Логин',{exact:true})).toBeVisible();
  await context.setOffline(true);const response=await page.reload();expect(response?.status()).toBe(503);await expect(page.getByRole('button',{name:'Попробовать снова'})).toBeVisible();
  await context.setOffline(false);await page.getByRole('button',{name:'Попробовать снова'}).click();await expect(page.getByLabel('Логин',{exact:true})).toBeVisible();
 }
 expect(errors).toEqual([]);
});
