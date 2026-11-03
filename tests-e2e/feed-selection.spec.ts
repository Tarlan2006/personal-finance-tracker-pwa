import {test,expect,type Page} from '@playwright/test';
const rows=(page:Page)=>page.getByTestId('entry-row');
async function prepare(page:Page){
 await page.setExtraHTTPHeaders({'CF-Connecting-IP':'198.18.0.8'});await page.goto('/');await page.getByLabel('Логин',{exact:true}).fill('zz-scroll');await page.getByLabel('Пароль').fill('e2e-scroll-password-1');await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();const later=page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true});if(await later.isVisible())await later.click();
 await page.evaluate(async()=>{
  await fetch('/api/history/clear',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:'DELETE_ALL_HISTORY',accountLogin:'zz-scroll'})});
  const csv='date;amount;name\n'+Array.from({length:120},(_,i)=>`2026-10-${String(28-Math.floor(i/6)).padStart(2,'0')};-${1000+i};BULK ${String(i).padStart(3,'0')}`).join('\n');
  const r=await fetch('/api/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csv,mapping:{dateCol:0,amountCol:1,counterpartyCol:2}})});if(!r.ok||(await r.json()).imported!==120)throw new Error('synthetic seed');
 });await page.reload();await expect(rows(page)).toHaveCount(50);
}
async function press(page:Page,index:number){
 const row=rows(page).nth(index);await row.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 if(page.context().browser()!.browserType().name()==='chromium'){
  const box=(await row.boundingBox())!,touch={x:box.x+box.width/2,y:box.y+box.height/2};const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await expect(row).toHaveAttribute('aria-checked','true');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 }else{
  await row.dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,pointerType:'touch',button:0,clientX:100,clientY:200});await expect(row).toHaveAttribute('aria-checked','true');await row.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch'});await row.dispatchEvent('click',{detail:1});
 }
}


test('long press: отмена жеста, выбор, отмена удаления и клавиатурный доступ',async({page},testInfo)=>{
 await prepare(page);const first=rows(page).first();
 await first.dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,pointerType:'touch',button:0,clientX:100,clientY:200});await first.dispatchEvent('pointermove',{pointerId:1,clientX:100,clientY:240});await page.waitForTimeout(550);await first.dispatchEvent('pointerup');await first.dispatchEvent('click',{detail:1});await expect(page.getByRole('region',{name:'Выбор операций'})).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
 await press(page,0);await expect(first).toHaveAttribute('aria-checked','true');await expect(page.getByRole('dialog')).toHaveCount(0);await rows(page).nth(1).click();await expect(page.getByRole('status')).toContainText('Выбрано: 2');await first.click();await expect(first).toHaveAttribute('aria-checked','false');
 await page.getByRole('region').getByRole('button',{name:'Удалить',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();await expect(rows(page)).toHaveCount(50);
 await page.getByRole('region').getByRole('button',{name:'Отмена',exact:true}).click();await page.getByRole('button',{name:'Выбрать операции',exact:true}).click();await first.focus();await page.keyboard.press('Space');await expect(first).toHaveAttribute('aria-checked','true');await page.screenshot({path:testInfo.outputPath('selection.png')});await page.keyboard.press('Escape');await expect(page.getByRole('region',{name:'Выбор операций'})).toHaveCount(0);
});

test('массовое удаление: загруженные страницы, место строки, ошибка и потерянный ответ',async({page})=>{
 await prepare(page);await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await expect(rows(page)).toHaveCount(100);
 await press(page,58);await rows(page).nth(59).click();await rows(page).nth(61).evaluate(el=>scrollBy(0,el.getBoundingClientRect().top-100));
 const anchorId=await rows(page).nth(61).getAttribute('data-entry-id');const anchor=page.locator(`[data-entry-id="${anchorId}"]`);const originalTop=(await anchor.boundingBox())!.y;
 await page.route('**/api/entries/delete',route=>route.abort(),{times:1});
 await page.getByRole('region').getByRole('button',{name:'Удалить',exact:true}).click();const sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'Удалить выбранные',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('Нет связи');await expect(rows(page)).toHaveCount(100);
 // Commit once but lose the response. Retry must not delete any other rows.
 await page.route('**/api/entries/delete',async route=>{await route.fetch();await route.abort();},{times:1});await sheet.getByRole('button',{name:'Удалить выбранные',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('Нет связи');await expect(rows(page)).toHaveCount(100);
 await sheet.getByRole('button',{name:'Удалить выбранные',exact:true}).click();await expect(sheet).toHaveCount(0);await expect(rows(page)).toHaveCount(100);
 await expect.poll(async()=>Math.abs((await anchor.boundingBox())!.y-originalTop)).toBeLessThan(4);expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(1000);
 expect(await page.evaluate(async()=>{const r=await fetch('/api/entries?limit=200');return (await r.json()).items.length;})).toBe(118);
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await expect(rows(page)).toHaveCount(118);await expect(rows(page).last()).toBeAttached();
});

test('последняя операция: медленное удаление блокирует повтор и оставляет корректную пустую ленту',async({page})=>{
 await prepare(page);await page.getByLabel('Поиск',{exact:true}).fill('BULK 119');await expect(rows(page)).toHaveCount(1);await press(page,0);
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),requested=new Promise<void>(r=>started=r);let requests=0;
 await page.route('**/api/entries/delete',async route=>{requests++;const response=await route.fetch();started();await gate;await route.fulfill({response});},{times:1});
 await page.getByRole('region').getByRole('button',{name:'Удалить',exact:true}).click();const sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'Удалить выбранные',exact:true}).click();await requested;
 await expect(sheet.getByRole('button',{name:'Удаляем…',exact:true})).toBeDisabled();await expect(sheet.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();await expect(rows(page)).toHaveCount(1);release();await expect(sheet).toHaveCount(0);await expect(rows(page)).toHaveCount(0);await expect(page.getByText('Ничего не найдено',{exact:true})).toBeVisible();expect(requests).toBe(1);
 await page.getByLabel('Поиск',{exact:true}).fill('');await expect(rows(page)).toHaveCount(50);await expect(page.getByRole('button',{name:'Показать ещё',exact:true})).toBeVisible();
});

test('удаление всей загруженной страницы: следующая страница без промежуточного скачка наверх',async({page})=>{
 await prepare(page);const oldId=await rows(page).first().getAttribute('data-entry-id');await page.getByRole('button',{name:'Выбрать операции',exact:true}).click();await rows(page).evaluateAll(elements=>elements.forEach(el=>(el as HTMLButtonElement).click()));await expect(page.getByRole('status')).toContainText('Выбрано: 50');await rows(page).nth(35).scrollIntoViewIfNeeded();
 await page.getByRole('region').getByRole('button',{name:'Удалить',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Удалить выбранные',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator(`[data-entry-id="${oldId}"]`)).toHaveCount(0);await expect(rows(page)).toHaveCount(50);expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(1000);
});
