import { test, expect, type Page } from '@playwright/test';
const LOGIN='zz-hardening', PW='e2e-hardening-password-1', NEXT='e2e-hardening-password-2';
async function login(page:Page,password=PW){
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'198.18.0.9'});
  await page.goto('/'); await page.getByLabel('Логин',{exact:true}).fill(LOGIN);
  await page.getByLabel('Пароль',{exact:true}).fill(password); await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();
  const later=page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true});if(await later.isVisible())await later.click();
}
async function queueState(page:Page){return page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('qarjy-queue');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const read=(store:string,key?:string)=>new Promise<any>(resolve=>{const r=key?db.transaction(store).objectStore(store).get(key):db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);});
  const result={queue:await read('queue'),sealed:!!await read('meta','sealed:zz-hardening')};db.close();return result;
});}

test('запечатанная очередь восстанавливается после смены пароля на другом устройстве',async({page,browser})=>{
  await login(page);
  await page.route('**/api/entries/batch',route=>route.abort());
  await page.getByRole('button',{name:'Добавить операцию',exact:true}).click();
  const add=page.getByRole('dialog',{name:'Добавить',exact:true});
  await add.getByLabel('Сумма',{exact:true}).fill('123');await add.getByLabel('Получатель',{exact:true}).fill('SEALED ROTATION SYNTHETIC');
  await add.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(add).toHaveCount(0);
  await expect.poll(async()=>(await queueState(page)).queue.length).toBe(1);
  await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();
  expect(await queueState(page)).toMatchObject({queue:[],sealed:true});
  const second=await browser.newContext({baseURL:test.info().project.use.baseURL});
  try{
    const headers={Origin:new URL(page.url()).origin,'CF-Connecting-IP':'198.18.0.10'};
    expect((await second.request.post('/api/auth/login',{headers,data:{login:LOGIN,password:PW}})).ok()).toBe(true);
    expect((await second.request.post('/api/auth/password',{headers,data:{accountLogin:LOGIN,current:PW,next:NEXT}})).ok()).toBe(true);
    await page.unroute('**/api/entries/batch');await login(page,NEXT);
    await expect.poll(async()=>(await queueState(page)).queue.length).toBe(0);
    expect((await queueState(page)).sealed).toBe(false);
    const me=await(await page.request.get('/api/me')).json();expect(me).not.toHaveProperty('queueKey');expect(me).not.toHaveProperty('queueRecoveryKeys');
    await expect.poll(async()=>{const r=await(await page.request.get('/api/entries?q=SEALED%20ROTATION%20SYNTHETIC')).json();return r.items.length;}).toBe(1);
    expect((await page.request.post('/api/auth/password',{headers,data:{accountLogin:LOGIN,current:NEXT,next:PW}})).ok()).toBe(true);
  }finally{await second.close();}
});

for(const decision of ['unassigned','account:safe-b'])test('удаление счёта требует решения: '+decision,async({page})=>{
  await login(page);
  const entryId=await page.evaluate(async()=>{
    const req=async(method:string,path:string,body?:any)=>{const r=await fetch(path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify({...body,accountLogin:'zz-hardening'}):undefined});if(!r.ok)throw new Error('Synthetic setup '+r.status);return r.json();};
    const record=await req('GET','/api/financial-profile');
    record.profile.accounts=[{id:'safe-a',bank:'Kaspi',name:'SYNTHETIC A',kind:'card',openingBalanceMinor:100000},{id:'safe-b',bank:'Freedom',name:'SYNTHETIC B',kind:'deposit',openingBalanceMinor:200000}];
    record.profile.balanceDate=new Date(Date.now()+5*3600e3).toISOString().slice(0,10);record.status='deferred';
    await req('PUT','/api/financial-profile',record);
    const id=crypto.randomUUID();
    await req('POST','/api/entries',{id,direction:'out',amountMinor:1000,financialAccountId:'safe-a',counterparty:'REMOVAL SYNTHETIC',occurredAt:record.profile.balanceDate});return id;
  });
  await page.reload();await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();
  await page.getByRole('button',{name:/Финансовый профиль/}).click();
  await page.getByRole('button',{name:'Продолжить анкету',exact:true}).click();
  await page.getByRole('button',{name:'Удалить счёт 1',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'Удаление счёта',exact:true});await expect(sheet).toBeVisible();
  const before=await(await page.request.get('/api/financial-profile')).json();expect(before.profile.accounts).toHaveLength(2);
  await sheet.getByLabel('Действие для SYNTHETIC A',{exact:true}).selectOption(decision);
  await sheet.getByRole('button',{name:'Применить решение',exact:true}).click();await expect(sheet).toHaveCount(0);
  const after=await(await page.request.get('/api/financial-profile')).json();expect(after.profile.accounts.map((a:any)=>a.id)).toEqual(['safe-b']);
  const entries=await(await page.request.get('/api/entries?q=REMOVAL%20SYNTHETIC')).json();
  expect(entries.items.find((e:any)=>e.id===entryId).payload.financialAccountId).toBe(decision==='unassigned'?null:'safe-b');
});
