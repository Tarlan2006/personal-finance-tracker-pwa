import {test,expect,type Page} from '@playwright/test';
const row=(page:Page,n:number)=>page.getByTestId('cp-row').filter({hasText:`SCROLL KEEP ${String(n).padStart(3,'0')}`});
async function prepare(page:Page){
 await page.setExtraHTTPHeaders({'CF-Connecting-IP':'198.18.0.5'});await page.goto('/');await page.getByLabel('Логин',{exact:true}).fill('zz-scroll');await page.getByLabel('Пароль').fill('e2e-scroll-password-1');await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();const later=page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true});if(await later.isVisible())await later.click();
 await page.evaluate(async()=>{
  const clear=await fetch('/api/history/clear',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:'DELETE_ALL_HISTORY',accountLogin:'zz-scroll'})});if(!clear.ok)throw new Error('synthetic reset');
  const date=new Date(Date.now()+5*3600e3).toISOString().slice(0,10);const csv='date;amount;name\n'+Array.from({length:90},(_,i)=>`${date};-${1000+i};SCROLL KEEP ${String(i).padStart(3,'0')}`).join('\n');
  const r=await fetch('/api/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csv,mapping:{dateCol:0,amountCol:1,counterpartyCol:2}})});if(!r.ok||(await r.json()).imported!==90)throw new Error('synthetic seed');
 });
 await page.getByRole('navigation').getByRole('button',{name:'Отчёты',exact:true}).click();await expect(page.getByTestId('cp-row')).toHaveCount(90);
}
async function holdSummary(page:Page){
 let release!:()=>void,started!:()=>void;const held=new Promise<void>(r=>{release=r;}),requested=new Promise<void>(r=>{started=r;});
 await page.route('**/api/reports/summary?month=*',async route=>{const response=await route.fetch();started();await held;await route.fulfill({response});},{times:1});return {release,requested};
}
async function closeEnough(page:Page,n:number,top:number){await expect.poll(async()=>Math.abs((await row(page,n).boundingBox())!.y-top)).toBeLessThan(4);}

test('категория: длинный отчёт сохраняет строки, фокус и место при добавлении/снятии привязки',async({page})=>{
 await prepare(page);const target=row(page,40);await target.scrollIntoViewIfNeeded();await page.evaluate(()=>scrollBy(0,-80));const top=(await target.boundingBox())!.y;expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(1000);await target.evaluate(el=>el.setAttribute('data-scroll-marker','kept'));
 const navigation=await page.evaluate(()=>performance.getEntriesByType('navigation').length);let gate=await holdSummary(page);
 await target.click();let sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'Магазины',exact:true}).click();await expect(sheet).toHaveCount(0);await gate.requested;
 await expect(page.getByTestId('cp-row')).toHaveCount(90);await expect(target).toHaveAttribute('data-scroll-marker','kept');await closeEnough(page,40,top);gate.release();await expect(target).toContainText('Магазины');await closeEnough(page,40,top);
 await expect.poll(()=>page.evaluate(()=>document.activeElement?.getAttribute('data-counterparty'))).toBe('scroll keep 040');expect(await page.evaluate(()=>performance.getEntriesByType('navigation').length)).toBe(navigation);
 gate=await holdSummary(page);await target.click();sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'Снять привязку',exact:true}).click();await expect(sheet).toHaveCount(0);await gate.requested;await expect(page.getByTestId('cp-row')).toHaveCount(90);gate.release();await expect(target).toContainText('выбрать категорию');await closeEnough(page,40,top);await expect(target).toHaveAttribute('data-scroll-marker','kept');
 await page.route('**/api/reports/summary?month=*',route=>route.abort(),{times:1});await target.click();await page.getByRole('dialog').getByRole('button',{name:'Магазины',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('Нет связи');await expect(page.getByTestId('cp-row')).toHaveCount(90);await closeEnough(page,40,top);
 await target.click();await page.getByRole('dialog').getByRole('button',{name:'Магазины',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(target).toContainText('Магазины');await expect(page.getByRole('alert')).toHaveCount(0);await closeEnough(page,40,top);
});
test('категория: позднее обновление не уводит от следующего получателя, в открытой шторке и при ошибке',async({page})=>{
 await prepare(page);await row(page,40).scrollIntoViewIfNeeded();let gate=await holdSummary(page);await row(page,40).click();await page.getByRole('dialog').getByRole('button',{name:'Магазины',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await gate.requested;
 await row(page,20).scrollIntoViewIfNeeded();const top=(await row(page,20).boundingBox())!.y;await row(page,20).click();await expect(page.getByRole('dialog')).toBeVisible();gate.release();await expect(row(page,40)).toContainText('Магазины');expect(await page.evaluate(()=>document.body.style.position)).toBe('fixed');await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();await closeEnough(page,20,top);
 gate=await holdSummary(page);await row(page,20).click();await page.getByRole('dialog').getByRole('button',{name:'Транспорт',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await gate.requested;await row(page,10).scrollIntoViewIfNeeded();const movedTop=(await row(page,10).boundingBox())!.y;gate.release();await expect(row(page,20)).toContainText('Транспорт');await closeEnough(page,10,movedTop);
 await page.route('**/api/counterparties/*',route=>route.abort(),{times:1});await row(page,10).click();await page.getByRole('dialog').getByRole('button',{name:'Магазины',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Нет связи');await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();await closeEnough(page,10,movedTop);await expect(page.getByTestId('cp-row')).toHaveCount(90);await expect(row(page,10)).toContainText('выбрать категорию');
});
