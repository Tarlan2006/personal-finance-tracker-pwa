import {importStatement} from './import-helper';
import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const examples=JSON.parse(readFileSync('worker/test/fixtures/examples.json','utf8'));
async function login(page:Page){
 await page.setExtraHTTPHeaders({'CF-Connecting-IP':'198.18.0.3'});await page.goto('/');await page.getByLabel('Логин',{exact:true}).fill('zz-safari');await page.getByLabel('Пароль',{exact:true}).fill('e2e-safari-password-1');await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible({timeout:10000});const later=page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true});if(await later.isVisible())await later.click();await expect(page.getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
}
const input=(page:Page)=>page.getByLabel('Файл выписки',{exact:true});

test('запуск: недоступный API показывает ошибку и позволяет повтор',async({page})=>{
 await page.route('**/api/me',route=>route.abort());await page.goto('/');await expect(page.getByRole('alert')).toContainText('Не удалось запустить приложение');
 await page.unroute('**/api/me');await page.getByRole('button',{name:'Попробовать снова',exact:true}).click();await expect(page.getByLabel('Логин',{exact:true})).toBeVisible();
});
test('запуск: зависший запрос не оставляет пустой экран и не запускает опрос',async({page})=>{
 await page.clock.install();let release!:()=>void;const held=new Promise<void>(r=>{release=r;});let count=0;
 await page.route('**/api/me',async route=>{count++;await held;await route.fulfill({status:401,contentType:'application/json',body:'{}'});});
 await page.goto('/');await expect(page.getByRole('status')).toContainText('Загружаем');await expect.poll(()=>count).toBe(1);await page.clock.runFor(12001);await expect(page.getByRole('status')).toContainText('Загрузка занимает больше времени');await expect(page.getByRole('button',{name:'Попробовать снова'})).toBeVisible();expect(count).toBe(1);release();await expect(page.getByLabel('Логин',{exact:true})).toBeVisible();
});
test('запуск: потерянный JS оставляет HTML-сообщение и ссылку восстановления',async({page})=>{
 await page.route('**/assets/*.js',route=>route.abort());await page.goto('/');await expect(page.getByRole('link',{name:'откройте страницу снова'})).toBeVisible();
 await page.unroute('**/assets/*.js');await page.getByRole('link',{name:'откройте страницу снова'}).click();await expect(page.getByLabel('Логин',{exact:true})).toBeVisible();
});
test('приватный режим: запрет localStorage и регистрации SW не мешает входу',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Synthetic denied','SecurityError');}});Object.defineProperty(navigator,'serviceWorker',{get(){throw new DOMException('Synthetic denied','SecurityError');}});});
 await login(page);await expect(page.getByRole('status').filter({hasText:'Обновляем ленту'})).toHaveCount(0);await page.reload();await expect(page.getByRole('heading',{name:'Лента',exact:true})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'Обновляем ленту'})).toHaveCount(0);expect(errors).toEqual([]);
});
test('PDF: сбой чтения файла из облака, повторный выбор того же файла',async({page})=>{
 await login(page);await page.getByRole('navigation').getByRole('button',{name:'Выписка',exact:true}).click();await page.getByRole('radio',{name:'Kaspi PDF',exact:true}).check();
 await page.evaluate(()=>{const original=File.prototype.arrayBuffer;let first=true;File.prototype.arrayBuffer=function(){if(first){first=false;return Promise.reject(new DOMException('Synthetic cloud unavailable','NotReadableError'));}return original.call(this);};});
 await input(page).setInputFiles('worker/test/fixtures/kaspi/gold.pdf');await expect(page.getByRole('alert')).toContainText('Не удалось прочитать файл');await expect(input(page)).toHaveValue('');
 await input(page).setInputFiles('worker/test/fixtures/kaspi/gold.pdf');await expect(input(page)).toHaveValue('');await expect(page.getByTestId('selected-statement')).toContainText('Выбран файл: gold.pdf');await page.getByRole('button',{name:'Проверить',exact:true}).click();await expect(page.getByTestId('import-report')).toContainText('Будет добавлено2');
 await page.screenshot({path:`test-results/safari-selected-file-${test.info().project.name}.png`,fullPage:true});
});
for(const [bank,fixture] of [['kaspi','gold'],['halyk','statement'],['freedom','statement']])test(`${bank} PDF: потерян ответ после записи, повтор без потерь и дублей`,async({page})=>{
 const expected=examples.cases.find((c:any)=>c.fixture===`${bank}/${fixture}.pdf`).expected;
 await login(page);const before=await page.evaluate(async()=>new Set((await(await fetch('/api/entries?limit=200')).json()).items.map((e:any)=>e.id)).size);
 await page.getByRole('navigation').getByRole('button',{name:'Выписка',exact:true}).click();await page.getByRole('radio',{name:(bank==='kaspi'?'Kaspi':bank==='halyk'?'Halyk':'Freedom')+' PDF',exact:true}).check();await input(page).setInputFiles(`worker/test/fixtures/${bank}/${fixture}.pdf`);
 let lost:any;await page.route('**/api/import',async route=>{lost=await(await route.fetch()).json();await route.abort();},{times:1});
 await importStatement(page);await expect(page.getByRole('alert')).toContainText('Нет связи');expect(lost).toMatchObject(expected);
 await importStatement(page);const report=page.getByTestId('import-report');await expect(report).toContainText('Добавлено0');await expect(report).toContainText(`Уже были (повторы)${expected.imported}`);await expect(report).toContainText(`Отклонено${expected.rejected}`);await expect(report).toContainText(`Служебные строки${expected.service}`);
 const after=await page.evaluate(async()=>new Set((await(await fetch('/api/entries?limit=200')).json()).items.map((e:any)=>e.id)).size);expect(after-before).toBe(expected.imported);
});
test('прокрутка: короткий и горизонтальный экран, фокус и повторное закрытие шторки',async({page})=>{
 await login(page);await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();
 for(const viewport of [{width:393,height:430},{width:852,height:393},{width:320,height:568}]){
  await page.setViewportSize(viewport);await page.evaluate(()=>window.scrollTo(0,120));const before=await page.evaluate(()=>scrollY);
  await page.getByRole('button',{name:'Добавить операцию',exact:true}).click();const sheet=page.getByRole('dialog',{name:'Добавить',exact:true});await sheet.getByLabel('Получатель',{exact:true}).fill('SAFARI SYNTHETIC');await sheet.getByLabel('Заметка',{exact:true}).fill('synthetic');await sheet.getByRole('button',{name:'Сохранить',exact:true}).scrollIntoViewIfNeeded();
  expect(await sheet.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await sheet.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(sheet).toHaveCount(0);expect(await page.evaluate(()=>document.body.style.position)).not.toBe('fixed');await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThanOrEqual(before-5);
 }
});

test('IndexedDB: зависшее открытие не блокирует вход и не обещает сохранение',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:{open(){return {get error(){throw new DOMException('pending','InvalidStateError');}};}}}));
 await login(page);await expect(page.getByRole('alert')).toContainText('Локальное хранилище недоступно',{timeout:10000});
 await page.getByRole('button',{name:'Добавить операцию',exact:true}).click();const sheet=page.getByRole('dialog',{name:'Добавить',exact:true});await sheet.getByLabel('Сумма',{exact:true}).fill('1');await sheet.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('Не удалось сохранить',{timeout:10000});expect(errors).toEqual([]);
});
