// Read-only public checks: no login, account creation, or financial writes.
import {webkit} from 'playwright';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const origin=new URL(process.argv[2]??'http://localhost:8799').origin;
const waitForLogin=async page=>{await page.getByLabel(/^(Логин|Аккаунт)$/).waitFor();await page.locator('form[aria-busy="true"]').waitFor({state:'hidden'});await page.getByLabel(/^(Логин|Аккаунт)$/).waitFor();};
const assert=(ok,label)=>{if(!ok)throw new Error(label);console.log('OK '+label);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const swResponse=await fetch(origin+'/sw.js');const sw=await swResponse.text();assert(swResponse.ok,'SW script available');
for(const name of ['kaspi','kaspi-russian','halyk','freedom']){
 const response=await fetch(origin+'/examples/'+name+'.pdf');const bytes=Buffer.from(await response.arrayBuffer());assert(response.ok&&bytes.subarray(0,5).toString()==='%PDF-'&&hash(bytes)===hash(readFileSync('web/public/examples/'+name+'.pdf')),name+' synthetic PDF matches');
}
const browser=await webkit.launch();console.log('WebKit '+browser.version());
try{
 for(const colorScheme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,colorScheme});
  try{const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await waitForLogin(page);await page.getByLabel('Пароль',{exact:true}).waitFor();
   assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),colorScheme+' login has no horizontal overflow');
   const status=await page.evaluate(async()=>{const r=await fetch('/api/import/batches');return r.status;});assert(status===401,'saved reports protected');assert(errors.length===0,colorScheme+' launch without page errors');
  }finally{await context.close();}
 }
 for(const mode of ['missing','throws','rejects']){
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
  try{const deny=`Object.defineProperty(self,'caches',{get(){if('${mode}'==='throws')throw new Error('Synthetic denied');if('${mode}'==='rejects')return {open:async()=>{throw new Error('Synthetic denied');},keys:async()=>{throw new Error('Synthetic denied');}};return undefined;}});`;
   await context.route(origin+'/sw.js',route=>route.fulfill({contentType:'application/javascript',body:deny+'\n'+sw}));const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await waitForLogin(page);
   await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
   await page.reload();await waitForLogin(page);await context.setOffline(true);const response=await page.reload();await page.getByRole('button',{name:'Попробовать снова'}).waitFor();assert(response.status()===503,mode+' cache: offline retry page');
   await context.setOffline(false);await page.getByRole('button',{name:'Попробовать снова'}).click();await waitForLogin(page);assert(errors.length===0,mode+' cache: online recovery without page errors');
  }finally{await context.close();}
 }
 const startup=await browser.newContext();
 try{const page=await startup.newPage();
  await page.route('**/api/me',route=>route.abort());await page.goto(origin);await page.getByRole('alert').filter({hasText:'Не удалось запустить приложение'}).waitFor();
  await page.unroute('**/api/me');await page.getByRole('button',{name:'Попробовать снова'}).click();await waitForLogin(page);assert(true,'startup API failure and retry');
 }finally{await startup.close();}
 const assets=await browser.newContext();
 try{const page=await assets.newPage();await page.route('**/assets/*.js',route=>route.abort());await page.goto(origin);await page.getByRole('link',{name:'откройте страницу снова'}).waitFor();
  await page.unroute('**/assets/*.js');await page.getByRole('link',{name:'откройте страницу снова'}).click();await waitForLogin(page);assert(true,'JS failure retains a recovery page');
 }finally{await assets.close();}
 const restricted=await browser.newContext();
 try{const page=await restricted.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{for(const [object,key] of [[window,'localStorage'],[navigator,'serviceWorker']])Object.defineProperty(object,key,{get(){throw new DOMException('Synthetic denied','SecurityError');}});});
  await page.goto(origin);await waitForLogin(page);assert(errors.length===0,'denied navigator.serviceWorker/localStorage still starts');
 }finally{await restricted.close();}
 // A document already controlled by a broken old SW must accept the replacement.
 const context=await browser.newContext();
 try{let fixed=false;
  const broken="self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/')e.respondWith(Promise.reject(new Error('Synthetic legacy cache failure')));});";
  await context.route(origin+'/sw.js',route=>route.fulfill({contentType:'application/javascript',body:fixed?sw:broken}));const page=await context.newPage();await page.goto(origin);await waitForLogin(page);
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  assert(await page.evaluate(async()=>{try{await fetch('/');return false;}catch{return true;}}),'legacy SW failure reproduced');fixed=true;
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();const pending=r.installing||r.waiting;if(pending&&pending.state!=='activated')await new Promise((resolve,reject)=>pending.addEventListener('statechange',()=>{if(pending.state==='activated')resolve();if(pending.state==='redundant')reject(new Error('Update failed'));}));});
  await page.reload();await waitForLogin(page);assert(true,'legacy SW replaced without clearing user storage');
 }finally{await context.close();}
}finally{await browser.close();}
