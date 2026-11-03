import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const scenario=JSON.parse(readFileSync('tests-e2e/fixtures/crash-scenario.json','utf8').replace(/^\uFEFF/,''));
const PW='e2e-crash-password-1';
const empty=()=>({balanceDate:'2026-11-01',accounts:[],expenseCategoryIds:[],monthlyBudgetMinor:null,incomes:[],obligations:[],householdSize:1,goal:'',goalTargetMinor:null,monthlySavingMinor:null});
async function login(page:Page,login='zz-crash'){
 await page.goto('/');await page.getByLabel('Логин',{exact:true}).fill(login);await page.getByLabel('Пароль').fill(PW);await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();
 const later=page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true});if(await later.isVisible())await later.click();
 await expect(page.getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
}
async function questionnaire(page:Page){
 await page.evaluate(async p=>{const current=await(await fetch('/api/financial-profile')).json();const r=await fetch('/api/financial-profile',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({version:current.version,status:'deferred',profile:p})});if(!r.ok)throw new Error('synthetic profile reset failed');},empty());
 await page.reload();await expect(page.getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();await page.getByRole('button',{name:/Финансовый профиль/}).click();await page.getByRole('button',{name:'Продолжить анкету',exact:true}).click();
}
test.beforeEach(async({page})=>{await page.setExtraHTTPHeaders({'CF-Connecting-IP':'198.18.0.2'});await login(page);});
test('краш: семь счетов трёх банков, прокрутка и точные остатки',async({page,browserName})=>{
 await questionnaire(page);
 for(const [i,a] of scenario.accounts.entries()){
  await page.getByRole('button',{name:'+ '+a.bank,exact:true}).click();
  await page.getByLabel(`Название счёта ${i+1}`,{exact:true}).fill(a.name);await page.getByLabel(`Вид счёта ${i+1}`,{exact:true}).selectOption(a.kind);await page.getByLabel(`Начальный остаток счёта ${i+1}`,{exact:true}).fill(String(a.minor/100));
 }
 await page.evaluate(()=>window.scrollTo(0,0));if(browserName==='webkit')await page.evaluate(()=>window.scrollBy(0,1200));else await page.mouse.wheel(0,1200);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(100);
 await page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true}).click();await expect(page.getByRole('heading',{name:'Финансовый профиль',exact:true})).toBeVisible();
 const p=await page.evaluate(async()=>(await(await fetch('/api/financial-profile')).json()).profile);
 expect(p.accounts).toHaveLength(7);expect(p.accounts.reduce((n:number,a:any)=>n+a.openingBalanceMinor,0)).toBe(scenario.expectedOpeningMinor);
 for(const [i,a] of scenario.accounts.entries())expect(p.accounts[i]).toMatchObject({bank:a.bank,name:a.name,kind:a.kind,openingBalanceMinor:a.minor});
 await page.screenshot({path:`test-results/crash-accounts-${test.info().project.name}.png`,fullPage:true});
});
test('краш: своя категория, дубликат и неверная сумма не теряются при Назад',async({page})=>{
 await questionnaire(page);await page.getByRole('button',{name:'Сохранить и продолжить',exact:true}).click();
 await page.getByRole('button',{name:'+ Добавить категорию',exact:true}).click();let sheet=page.getByRole('dialog',{name:'Новая категория расходов',exact:true});
 const name='AUDIT EDUCATION '+test.info().project.name;
 await sheet.getByLabel('Название категории',{exact:true}).fill(name);await sheet.getByLabel('Цвет категории',{exact:true}).fill('#ff9f0a');await sheet.getByRole('button',{name:'Добавить категорию',exact:true}).click();
 await expect(sheet).toHaveCount(0);await expect(page.getByRole('checkbox',{name,exact:true})).toBeChecked();
 await page.getByRole('button',{name:'+ Добавить категорию',exact:true}).click();sheet=page.getByRole('dialog');await sheet.getByLabel('Название категории',{exact:true}).fill(name.toLowerCase());await sheet.getByRole('button',{name:'Добавить категорию',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('уже есть');await page.keyboard.press('Escape');
 await page.getByLabel('План расходов в месяц',{exact:true}).fill('1,234');await page.getByRole('button',{name:'Назад',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Что будем учитывать?'})).toBeVisible();await expect(page.getByLabel('План расходов в месяц',{exact:true})).toHaveValue('1,234');
 await page.getByLabel('План расходов в месяц',{exact:true}).fill('10,50');await page.getByRole('button',{name:'Назад',exact:true}).click();await page.getByRole('button',{name:'Сохранить и продолжить',exact:true}).click();
 await expect(page.getByLabel('План расходов в месяц',{exact:true})).toHaveValue('10,5');await expect(page.getByRole('checkbox',{name,exact:true})).toBeChecked();
 await page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true}).click();await expect(page.getByRole('heading',{name:'Финансовый профиль',exact:true})).toBeVisible();
 const ids=await page.evaluate(async()=>(await(await fetch('/api/financial-profile')).json()).profile.expenseCategoryIds);expect(ids.length).toBe(1);
});
test('краш: лимит 30 счетов, удаление не меняет соседний остаток',async({page})=>{
 await questionnaire(page);
 for(let i=0;i<30;i++)await page.getByRole('button',{name:'+ Kaspi',exact:true}).click();
 await expect(page.getByRole('button',{name:'+ Kaspi',exact:true})).toBeDisabled();
 await page.getByLabel('Начальный остаток счёта 1',{exact:true}).fill('0');await page.getByLabel('Начальный остаток счёта 2',{exact:true}).fill('12,34');
 await page.getByRole('button',{name:'Удалить счёт 1',exact:true}).click();await expect(page.getByLabel('Начальный остаток счёта 1',{exact:true})).toHaveValue('12,34');
 await expect(page.getByRole('button',{name:'+ Kaspi',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true}).click();await expect(page.getByRole('heading',{name:'Финансовый профиль',exact:true})).toBeVisible();
 const p=await page.evaluate(async()=>(await(await fetch('/api/financial-profile')).json()).profile);expect(p.accounts).toHaveLength(29);expect(p.accounts[0].openingBalanceMinor).toBe(1234);expect(p.accounts[1].openingBalanceMinor).toBeNull();
});
test('краш: предсказуемый CSV, повтор и все 150 отклонённых строк видимы',async({page})=>{
 await page.getByRole('navigation').getByRole('button',{name:'Выписка',exact:true}).click();await page.getByRole('radio',{name:'Универсальный CSV',exact:true}).check();
 await page.getByLabel('Файл выписки').setInputFiles({name:'audit.csv',mimeType:'text/csv',buffer:Buffer.from(scenario.csv)});await page.getByRole('button',{name:'Импортировать',exact:true}).click();
 await expect(page.getByTestId('import-report')).toContainText('Добавлено3');await page.getByRole('button',{name:'Импортировать',exact:true}).click();await expect(page.getByTestId('import-report')).toContainText('Добавлено0');await expect(page.getByTestId('import-report')).toContainText('Уже были (повторы)3');
 const entries=await page.evaluate(async()=>(await(await fetch('/api/entries?q=AUDIT%20SYNTHETIC')).json()).items);
 expect(entries).toHaveLength(3);expect(entries.filter((e:any)=>e.payload.direction==='out').reduce((n:number,e:any)=>n+e.payload.amountMinor,0)).toBe(scenario.expectedTotals.out);expect(entries.filter((e:any)=>e.payload.direction==='in').reduce((n:number,e:any)=>n+e.payload.amountMinor,0)).toBe(scenario.expectedTotals.in);
 const bad='Дата;Сумма;Контрагент\n'+Array.from({length:150},(_,i)=>`INVALID;-1;AUDIT REJECTED ${i}`).join('\n');
 await page.getByLabel('Файл выписки').setInputFiles({name:'all-rejected.csv',mimeType:'text/csv',buffer:Buffer.from(bad)});await page.getByRole('button',{name:'Проверить',exact:true}).click();await expect(page.getByTestId('import-report')).toContainText('Отклонено150');
 await expect(page.getByTestId('import-row-result')).toHaveCount(100);await page.getByRole('button',{name:'Показать ещё строки отчёта',exact:true}).click();await expect(page.getByTestId('import-row-result')).toHaveCount(150);
});
test('краш: запоздалый ответ не подменяет месяц отчёта',async({page})=>{
 const now=new Date(),month=now.toISOString().slice(0,7);const previous=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1,7));
 await page.evaluate(async({now,previous})=>{for(const [id,date,amount] of [['audit-report-current',now,100],['audit-report-previous',previous,200]]){const r=await fetch('/api/entries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,direction:'out',amountMinor:amount,counterparty:id,occurredAt:date})});if(!r.ok)throw new Error('synthetic entry seed');}}, {now:Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1,7),previous:previous.getTime()});
 let release!:()=>void,started!:()=>void;const held=new Promise<void>(r=>{release=r;}),requested=new Promise<void>(r=>{started=r;});
 await page.route('**/api/reports/summary?month='+month,async route=>{const response=await route.fetch();started();await held;await route.fulfill({response});});
 await page.getByRole('navigation').getByRole('button',{name:'Отчёты',exact:true}).click();await requested;await page.getByRole('button',{name:'Предыдущий месяц',exact:true}).click();await expect(page.getByTestId('cp-row').filter({hasText:'audit-report-previous'})).toBeVisible();
 const response=page.waitForResponse(r=>r.url().includes('/api/reports/summary?month='+month));release();await response;await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 await expect(page.getByTestId('cp-row').filter({hasText:'audit-report-previous'})).toBeVisible();await expect(page.getByTestId('cp-row').filter({hasText:'audit-report-current'})).toHaveCount(0);
});
test('краш: чтение старого файла не возвращается после выбора другого банка',async({page})=>{
 await page.getByRole('navigation').getByRole('button',{name:'Выписка',exact:true}).click();await page.getByRole('radio',{name:'Универсальный CSV',exact:true}).check();
 await page.evaluate(()=>{const read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){const b=await read.call(this);if(this.name==='slow.csv')return new Promise<ArrayBuffer>(r=>{(window as any).releaseAuditFile=()=>r(b);});return b;};});
 await page.getByLabel('Файл выписки').setInputFiles({name:'slow.csv',mimeType:'text/csv',buffer:Buffer.from(scenario.csv)});await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseAuditFile)).toBe('function');
 await page.getByRole('radio',{name:'Freedom PDF',exact:true}).check();await page.evaluate(()=>(window as any).releaseAuditFile());await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));await expect(page.getByRole('button',{name:'Импортировать',exact:true})).toHaveCount(0);
});
test('краш: очередь из 51 записи не попадает в другой аккаунт при запоздалом ответе',async({page,context})=>{
 await context.setOffline(true);
 await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('qarjy-queue',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('queue','readwrite');for(let i=0;i<51;i++){const id='audit-cross-owner-'+String(i).padStart(4,'0');tx.objectStore('queue').put({id,login:'zz-crash',payload:{id,direction:'out',amountMinor:100+i,counterparty:'AUDIT CROSS OWNER'},createdAt:Date.now()+i,attempts:0,status:'pending'});}tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();});
 let release!:()=>void,started!:()=>void,first=true;const held=new Promise<void>(r=>{release=r;}),requested=new Promise<void>(r=>{started=r;});const chunks:number[]=[];
 await page.route('**/api/entries/batch',async route=>{const items=route.request().postDataJSON().items;if(!items.some((i:any)=>i.id.startsWith('audit-cross-owner-')))return route.continue();chunks.push(items.length);if(first){first=false;started();await held;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({results:items.map((i:any)=>({id:i.id,ok:true}))})});}await route.continue();});
 await context.setOffline(false);await requested;
 await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();await page.getByRole('button',{name:'Выйти',exact:true}).click();
 await page.getByLabel('Логин',{exact:true}).fill('zz-crash-other');await page.getByLabel('Пароль').fill(PW);await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();const later=page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true});if(await later.isVisible())await later.click();
 const response=page.waitForResponse('**/api/entries/batch');release();await response;await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 await expect(page.getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>(await(await fetch('/api/me')).json()).login)).toBe('zz-crash-other');
 expect((await page.evaluate(async()=>(await(await fetch('/api/entries?q=AUDIT%20CROSS%20OWNER')).json()).items)).length).toBe(0);expect(chunks).toEqual([50]);
 await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();await page.getByRole('button',{name:'Выйти',exact:true}).click();
 await page.getByLabel('Логин',{exact:true}).fill(' ZZ-CRASH ');await page.getByLabel('Пароль').fill(PW);await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/entries?q=AUDIT%20CROSS%20OWNER')).json()).items.length)).toBe(51);
 expect(chunks).toEqual([50,50,1]);
});
test('краш: два submit создают одну операцию',async({page})=>{
 await page.getByRole('button',{name:'Добавить операцию',exact:true}).click();const sheet=page.getByRole('dialog',{name:'Добавить',exact:true});await sheet.getByLabel('Сумма',{exact:true}).fill('7,89');await sheet.getByLabel('Получатель',{exact:true}).fill('AUDIT DOUBLE SUBMIT');
 await sheet.locator('form').evaluate(f=>{for(let i=0;i<2;i++)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 await expect(sheet).toHaveCount(0);await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/entries?q=AUDIT%20DOUBLE%20SUBMIT')).json()).items.length)).toBe(1);
});
test('краш: запрет IndexedDB не блокирует вход и не обещает сохранение',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();await page.getByRole('button',{name:'Выйти',exact:true}).click();
 await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{value:{open(){throw new DOMException('SYNTHETIC STORAGE DENIED','SecurityError');}}});});
 await login(page);await expect(page.getByRole('alert')).toContainText('Локальное хранилище недоступно');
 await page.getByRole('button',{name:'Добавить операцию',exact:true}).click();const sheet=page.getByRole('dialog',{name:'Добавить',exact:true});await sheet.getByLabel('Сумма',{exact:true}).fill('1');await sheet.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('Не удалось сохранить');expect(errors).toEqual([]);
});
test('отчёт: 320 операций и 70 служебных строк, история и полная пагинация',async({page})=>{
 await page.getByRole('navigation').getByRole('button',{name:'Выписка',exact:true}).click();await page.getByRole('radio',{name:'Универсальный CSV',exact:true}).check();
 const csv='Дата;Сумма;Контрагент\n'+Array.from({length:320},(_,i)=>`01.11.2026;-${(100+i)/100};AUDIT SERVICE FLOW ${i}`).join('\n')+'\n'+Array(70).fill(';;').join('\n');
 await page.getByLabel('Файл выписки').setInputFiles({name:'audit-service-rows.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.getByRole('button',{name:'Импортировать',exact:true}).click();const report=page.getByTestId('import-report');
 await expect(report).toContainText('Всего строк390');await expect(report).toContainText('Добавлено320');await expect(report).toContainText('Отклонено0');await expect(report).toContainText('Служебные строки70');await expect(page.getByRole('region',{name:'Отклонённые операции',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('service-row-result')).toHaveCount(0);await page.getByRole('button',{name:'Показать служебные строки (70)',exact:true}).click();await expect(page.getByTestId('service-row-result')).toHaveCount(70);
 await page.getByRole('button',{name:'Импортировать',exact:true}).click();await expect(report).toContainText('Добавлено0');await expect(report).toContainText('Уже были (повторы)320');await expect(report).toContainText('Служебные строки70');
 const totals=await page.evaluate(async()=>{let count=0,sum=0,next:any=null;do{const p=new URLSearchParams({q:'AUDIT SERVICE FLOW',limit:'200'});if(next){p.set('beforeTime',String(next.beforeTime));p.set('beforeId',next.beforeId);}const r=await(await fetch('/api/entries?'+p)).json();count+=r.items.length;sum+=r.items.reduce((n:number,e:any)=>n+e.payload.amountMinor,0);next=r.next;}while(next);return{count,sum};});expect(totals).toEqual({count:320,sum:83040});
 await page.getByLabel('Файл выписки').setInputFiles({name:'only-service.csv',mimeType:'text/csv',buffer:Buffer.from('date;amount\n'+Array(150).fill(';').join('\n'))});await page.getByRole('button',{name:'Проверить',exact:true}).click();await expect(report).toContainText('Служебные строки150');await expect(report).toContainText('Отклонено0');
 await page.getByRole('button',{name:'Показать служебные строки (150)',exact:true}).click();await expect(page.getByTestId('service-row-result')).toHaveCount(100);await page.getByRole('button',{name:'Показать ещё служебные строки',exact:true}).click();await expect(page.getByTestId('service-row-result')).toHaveCount(150);
 await page.getByRole('button',{name:'История импортов',exact:true}).click();await page.getByRole('group',{name:'Сохранённые импорты'}).getByRole('button').filter({hasText:'audit-service-rows.csv'}).filter({hasText:'Добавлено 320'}).click();
 await expect(page.getByRole('heading',{name:'Сохранённый отчёт',exact:true})).toBeVisible();await expect(report).toContainText('Добавлено320');await expect(report).toContainText('Отклонено0');await expect(report).toContainText('Служебные строки70');
 await page.screenshot({path:`test-results/service-report-${test.info().project.name}.png`,fullPage:true});
});
