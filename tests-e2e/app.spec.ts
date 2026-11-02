import { test, expect, type Page } from '@playwright/test';

const PW = 'e2e-test-password-1';
async function login(page: Page, pw = PW) {
  await page.goto('/');
  await page.getByLabel('Пароль').fill(pw);
  await page.getByRole('button', { name: 'Войти' }).click();
}
async function loggedIn(page: Page) { await login(page); await expect(page.getByRole('heading', { name: 'Лента' })).toBeVisible(); }
const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name });
async function add(page: Page, amount: string, cp: string, dir: 'Расход' | 'Доход' = 'Расход') {
  await tab(page, 'Добавить').click();
  await page.getByRole('button', { name: dir, exact: true }).click();
  await page.getByLabel('Сумма').fill(amount);
  await page.getByLabel('Получатель').fill(cp);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('heading', { name: 'Лента' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('вход: неверный пароль → ошибка, верный → лента', async ({ page }) => {
  await login(page, 'wrong-password-1');
  await expect(page.getByRole('alert')).toContainText('Неверный логин или пароль');
  await page.getByLabel('Пароль').fill(PW);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Лента' })).toBeVisible();
});

test('добавление расхода и дохода, итоги в отчёте', async ({ page }) => {
  await loggedIn(page);
  await add(page, '1 500', 'Magnum E2E');
  await add(page, '450000', 'ТОО Ромашка E2E', 'Доход');
  await expect(page.getByText('Magnum E2E')).toBeVisible();
  await expect(page.getByText('ТОО Ромашка E2E')).toBeVisible();
  await tab(page, 'Отчёты').click();
  await expect(page.getByText('Баланс')).toBeVisible();
  await expect(page.getByTestId('cp-row').filter({ hasText: 'Magnum E2E' })).toContainText('1 500');
});

test('офлайн → онлайн: запись ждёт в очереди, затем уходит без дублей', async ({ page, context }) => {
  await loggedIn(page);
  await context.setOffline(true);
  await add(page, '777', 'Офлайн Кофейня');
  await expect(page.getByText('Ждут отправки (1)')).toBeVisible();
  await tab(page, 'Ещё').click(); await page.getByRole('button', { name: /Синхронизация/ }).click();
  await expect(page.getByTestId('q-count')).toHaveText('1');
  await expect(page.getByText('офлайн', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByTestId('q-count')).toHaveText('0', { timeout: 15_000 });
  await expect(page.getByTestId('q-result')).toHaveText('успешно');
  await page.getByRole('button', { name: '‹ Ещё' }).click(); await tab(page, 'Лента').click();
  await expect(page.getByText('Офлайн Кофейня')).toHaveCount(1);
});

test('повтор запроса с тем же id не создаёт дубль', async ({ page }) => {
  await loggedIn(page);
  const body = { id: 'e2e-dup-0000001', direction: 'out', amountMinor: 12300, counterparty: 'Дубль E2E' };
  const post = () => page.evaluate(async b => (await fetch('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status, body);
  expect(await post()).toBe(201); expect(await post()).toBe(200);
  await tab(page, 'Лента').click();
  await page.getByLabel('Поиск').fill('Дубль E2E');
  await expect(page.getByRole('button', { name: /Дубль E2E/ })).toHaveCount(1);
});

test('правка и удаление записи', async ({ page }) => {
  await loggedIn(page);
  await page.getByLabel('Поиск').fill('Magnum E2E');
  await page.getByRole('button', { name: /Magnum E2E/ }).click();
  await page.getByLabel('Сумма').fill('2000');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: /Magnum E2E 2.000/ })).toBeVisible();
  await page.getByRole('button', { name: /Magnum E2E/ }).click();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('button', { name: /Magnum E2E/ })).toHaveCount(0);
});

test('импорт CSV: отчёт сходится; назначение категории получателю обновляет график', async ({ page }) => {
  await loggedIn(page);
  const d = new Date(); const mm = String(d.getMonth() + 1).padStart(2, '0'); const yy = d.getFullYear();
  const csv = `Дата;Сумма;Получатель;Описание\n01.${mm}.${yy};-3 000,00;ИП Мирас;оплата\n02.${mm}.${yy};-4 500,00;ИП Мирас;оплата\n03.${mm}.${yy};-4 500,00;ИП Мирас;оплата\n04.${mm}.${yy};250 000,00;ТОО Альфа;Зарплата\nвчера;5;Z;плохая дата\n`;
  await tab(page, 'Ещё').click(); await page.getByRole('button', { name: /Загрузить выписку/ }).click();
  await page.getByLabel('Файл выписки').setInputFiles({ name: 'st.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByRole('button', { name: 'Проверить' }).click();
  const rep = page.getByTestId('import-report');
  await expect(rep).toContainText('Всего строк5'); await expect(rep).toContainText('Будет добавлено4'); await expect(rep).toContainText('Отклонено1');
  await page.getByRole('button', { name: 'Импортировать' }).click();
  await expect(rep).toContainText('Добавлено4');
  await page.getByRole('button', { name: 'Импортировать' }).click(); // повтор того же файла
  await expect(rep).toContainText('Уже были (повторы)4'); await expect(rep).toContainText('Добавлено0');
  await page.getByRole('button', { name: '‹ Ещё' }).click();
  await tab(page, 'Отчёты').click();
  const row = page.getByTestId('cp-row').filter({ hasText: 'ИП Мирас' });
  await expect(row).toContainText('3 операции'); await expect(row).toContainText('12 000');
  await row.click(); await page.getByRole('dialog').getByRole('button', { name: 'Магазины' }).click();
  await expect(page.getByTestId('cat-row').filter({ hasText: 'Магазины' })).toContainText('12 000');
});

test('PDF Kaspi: загрузка фикстуры → отчёт → получатели', async ({page}) => {
  await loggedIn(page);
  await tab(page,'Ещё').click(); await page.getByRole('button',{name:/Загрузить выписку/}).click();
  await page.getByLabel('Банк').selectOption('kaspi');
  await page.getByLabel('Файл выписки').setInputFiles('worker/test/fixtures/kaspi/gold.pdf');
  await expect(page.getByRole('heading',{name:'Колонки'})).toHaveCount(0);
  await page.getByRole('button',{name:'Проверить'}).click();
  await expect(page.getByTestId('import-report')).toContainText('Будет добавлено2');
  await page.getByRole('button',{name:'Импортировать',exact:true}).click();
  await expect(page.getByTestId('import-report')).toContainText('Добавлено2');
  await page.getByRole('button',{name:'‹ Ещё'}).click(); await tab(page,'Отчёты').click();
  await expect(page.getByTestId('cp-row').filter({hasText:'TEST SHOP'})).toBeVisible();
});

test('слишком большая выписка: понятная ошибка без частичного импорта', async ({page}) => {
  await loggedIn(page);
  await tab(page,'Ещё').click(); await page.getByRole('button',{name:/Загрузить выписку/}).click();
  const csv='date;amount;counterparty\n'+Array.from({length:501},(_,i)=>`01.11.2026;-${i+1};LIMIT-TEST-501`).join('\n');
  await page.getByLabel('Файл выписки').setInputFiles({name:'oversized.csv',mimeType:'text/csv',buffer:Buffer.from(csv,'utf8')});
  await page.getByRole('button',{name:'Импортировать',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Не больше 500 строк');
  await expect(page.getByTestId('import-report')).toHaveCount(0);
  const count=await page.evaluate(async()=>{const r=await fetch('/api/entries?q=LIMIT-TEST-501');return (await r.json()).items.length;});
  expect(count).toBe(0);
});

test('категории: создать, переименовать, удалить', async ({ page }) => {
  await loggedIn(page);
  await tab(page, 'Ещё').click(); await page.getByRole('button', { name: /Категории и правила/ }).click();
  await page.getByRole('button', { name: 'Добавить категорию' }).click();
  await page.getByLabel('Название категории').fill('Печать E2E');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Печать E2E')).toBeVisible();
  await page.getByRole('button', { name: /Печать E2E/ }).click();
  await page.getByLabel('Название категории').fill('Типография E2E');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Типография E2E')).toBeVisible();
  await page.getByRole('button', { name: /Типография E2E/ }).click();
  page.once('dialog', d => d.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText('Типография E2E')).toHaveCount(0);
});

test('ключи: создание показывает ключ один раз, работает, отзыв → 401', async ({ page }) => {
  await loggedIn(page);
  await tab(page, 'Ещё').click(); await page.getByRole('button', { name: /Быстрые команды/ }).click();
  await page.getByRole('button', { name: 'Чтение' }).click();
  await page.getByLabel('Метка ключа').fill('E2E чтение');
  await page.getByRole('button', { name: 'Создать ключ' }).click();
  const key = (await page.getByTestId('new-key').textContent())!.trim();
  expect(key).toMatch(/^qk_r_/);
  await page.getByRole('dialog').press('Escape');
  const call = () => page.request.get('/api/shortcuts/summary', { headers: { Authorization: `Bearer ${key}` } });
  const ok = await call(); expect(ok.status()).toBe(200); expect(await ok.text()).toContain('расходы');
  await expect(page.getByText(key)).toHaveCount(0); // повторно ключ не показывается
  await page.getByRole('button', { name: 'Отозвать' }).first().click();
  await expect(page.getByText('E2E чтение')).toHaveCount(0);
  expect((await call()).status()).toBe(401);
});

test('очередь шифруется при выходе и восстанавливается после входа; офлайн-выход запрещён', async ({ page, context }) => {
  await loggedIn(page);
  await page.route('**/api/entries/batch', r => r.abort()); // отправка записей недоступна, остальной API работает
  await add(page, '999', 'СекретныйПолучатель');
  await expect(page.getByText('Ждут отправки (1)')).toBeVisible();
  await context.setOffline(true);
  await tab(page, 'Ещё').click(); await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('alert')).toContainText('выйти можно только при подключении');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  const dump = await page.evaluate(() => new Promise<string>(res => {
    const r = indexedDB.open('qarjy-queue'); r.onsuccess = () => {
      const db = r.result; const out: any = {};
      const t = db.transaction(['queue', 'meta'], 'readonly');
      t.objectStore('queue').getAll().onsuccess = e => { out.queue = (e.target as any).result; };
      t.objectStore('meta').getAll().onsuccess = e => { out.meta = (e.target as any).result; };
      t.oncomplete = () => res(JSON.stringify(out));
    };
  }));
  expect(dump).not.toContain('СекретныйПолучатель'); expect(JSON.parse(dump).queue).toEqual([]); expect(JSON.parse(dump).meta.length).toBe(1);
  await page.unroute('**/api/entries/batch');
  await login(page); await expect(page.getByRole('heading', { name: 'Лента' })).toBeVisible();
  await expect(page.getByText('СекретныйПолучатель')).toBeVisible({ timeout: 15_000 });
});

test('раскладка: нет горизонтального скролла, нижняя панель и safe-area на всех экранах', async ({ page }) => {
  await loggedIn(page);
  for (const name of ['Лента', 'Отчёты', 'Добавить', 'Ещё']) {
    await tab(page, name).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, name).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/shot-${test.info().project.name}-${name}.png` });
  }
  expect(await page.evaluate(() => { const i = document.querySelector('input:not([type=file]):not([type=search])') as HTMLInputElement | null; return i ? parseFloat(getComputedStyle(i).fontSize) : 16; })).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.querySelector('meta[name=viewport]')!.getAttribute('content'))).toContain('viewport-fit=cover');
  await page.screenshot({ path: `test-results/shot-${test.info().project.name}.png` });
});

test('смена пароля: старый перестаёт работать (в конце набора)', async ({ page }) => {
  await loggedIn(page);
  await tab(page, 'Ещё').click(); await page.getByRole('button', { name: /Сменить пароль/ }).click();
  await page.getByLabel('Текущий пароль').fill(PW); await page.getByLabel('Новый пароль').fill('e2e-test-password-2');
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(page.getByRole('status')).toContainText('Пароль изменён');
  await page.getByRole('button', { name: '‹ Ещё' }).click(); await page.getByRole('button', { name: 'Выйти' }).click();
  await login(page, PW); await expect(page.getByRole('alert')).toContainText('Неверный');
  await page.getByLabel('Пароль').fill('e2e-test-password-2'); await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Лента' })).toBeVisible();
  // вернуть исходный пароль, чтобы следующий проект (другой размер/тема) мог войти
  await tab(page, 'Ещё').click(); await page.getByRole('button', { name: /Сменить пароль/ }).click();
  await page.getByLabel('Текущий пароль').fill('e2e-test-password-2'); await page.getByLabel('Новый пароль').fill(PW);
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(page.getByRole('status')).toContainText('Пароль изменён');
});
