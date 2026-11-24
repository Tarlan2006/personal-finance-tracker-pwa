import { test, expect, type Page } from '@playwright/test';
import { importStatement } from './import-helper';

async function setup(page:Page){
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'198.18.0.8'});
  await page.goto('/');await page.getByLabel('Логин',{exact:true}).fill('zz-wallet');
  await page.getByLabel('Пароль',{exact:true}).fill('e2e-wallet-password-1');await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();
  const result=await page.evaluate(async()=>{
    const request=async(method:string,path:string,body?:unknown)=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error('Synthetic setup failed '+path);return r.json();};
    const current=await request('GET','/api/financial-profile');
    const accounts=[{id:'ui-kaspi-card',bank:'Kaspi',name:'Gold',kind:'card',openingBalanceMinor:100000},{id:'ui-freedom-card',bank:'Freedom',name:'Daily',kind:'card',openingBalanceMinor:200000},{id:'ui-freedom-deposit',bank:'Freedom',name:'Накопления',kind:'deposit',openingBalanceMinor:300000}];
    await request('PUT','/api/financial-profile',{version:current.version,status:'deferred',profile:{balanceDate:'2026-11-01',accounts,expenseCategoryIds:[],monthlyBudgetMinor:null,incomes:[],obligations:[],householdSize:1,goal:'',goalTargetMinor:null,monthlySavingMinor:null}});
    const categories=(await request('GET','/api/categories')).categories;
    const shop=categories.find((c:any)=>c.name==='Магазины'),food=categories.find((c:any)=>c.name==='Кафе и рестораны')??categories.filter((c:any)=>c.type==='expense'&&c.id!==shop.id)[0];
    const date=new Date().toISOString().slice(0,7)+'-02';
    for(let i=1;i<=12;i++)await request('POST','/api/entries',{id:'ui-wallet-shop-'+i,direction:'out',amountMinor:i*100,categoryId:shop.id,financialAccountId:'ui-kaspi-card',counterparty:'WALLET SHOP '+i,occurredAt:date});
    await request('POST','/api/entries',{id:'ui-wallet-other',direction:'out',amountMinor:90000,categoryId:food.id,financialAccountId:'ui-freedom-card',counterparty:'WALLET OTHER',occurredAt:date});
    return {shop:shop.name,food:food.name};
  });
  await page.reload();await expect(page.getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
  return result;
}

test('счета: только свои банки, отдельный депозит, выбор и сохранение операции',async({page})=>{
  await setup(page);
  const cards=page.getByTestId('wallet-card');await expect(cards).toHaveCount(3);
  await expect(cards.filter({hasText:'Halyk'})).toHaveCount(0);
  const deposit=page.getByRole('button',{name:'Freedom · Накопления · Депозит',exact:true});
  await deposit.click();await expect(deposit).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-entry-id]')).toHaveCount(0);
  await page.getByRole('button',{name:'Добавить операцию',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'Добавить',exact:true});
  await expect(sheet.getByLabel('Счёт операции')).toHaveValue('ui-freedom-deposit');
  await sheet.getByRole('button',{name:'Доход',exact:true}).click();
  await sheet.getByLabel('Сумма',{exact:true}).fill('10');await sheet.getByLabel('Получатель',{exact:true}).fill('WALLET DEPOSIT '+test.info().project.name);
  await sheet.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(sheet).toHaveCount(0);
  await expect(deposit.locator('.wallet-balance')).toHaveText(/3\s?010 ₸/);
  await expect(page.locator('[data-entry-id]')).toHaveCount(1);
  const kaspi=page.getByRole('button',{name:'Kaspi · Gold · Карта',exact:true});await kaspi.click();
  await expect(kaspi).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-entry-id]')).toHaveCount(12);
  await kaspi.click();await expect(page.getByRole('button',{name:'Все счета',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-entry-id]')).toHaveCount(14);
  await expect.poll(()=>deposit.evaluate(el=>{const flows=el.querySelector('.wallet-flows')!.getBoundingClientRect();return flows.bottom<=el.getBoundingClientRect().bottom-8;})).toBe(true);
  expect(await deposit.evaluate(el=>getComputedStyle(el).transitionProperty)).toContain('transform');
  expect(await deposit.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('rgb(7, 27, 22)');
  expect(await kaspi.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('rgb(193, 155, 83)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.getByRole('region',{name:'Мои счета'}).screenshot({path:`test-results/wallet-${test.info().project.name}.png`});
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await deposit.evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
});

test('диаграмма: сектор фильтрует топ-10, повтор возвращает все категории',async({page})=>{
  const {shop,food}=await setup(page);
  await page.getByRole('navigation').getByRole('button',{name:'Отчёты',exact:true}).click();
  await expect(page.getByTestId('top-entry')).toHaveCount(10);
  await expect(page.getByTestId('top-entry').first()).toContainText('WALLET OTHER');
  const sector=page.getByRole('group',{name:'Диаграмма по категориям'}).getByRole('button',{name:new RegExp('^'+shop+':')});
  await sector.scrollIntoViewIfNeeded();
  const point=await sector.evaluate(el=>{
    const circle=el as SVGCircleElement,len=Number(circle.getAttribute('stroke-dasharray')!.split(' ')[0]);
    const offset=-Number(circle.getAttribute('stroke-dashoffset')),angle=(offset+len/2)/54;
    const p=new DOMPoint(70+54*Math.cos(angle),70+54*Math.sin(angle)).matrixTransform(circle.getScreenCTM()!);
    return {x:p.x,y:p.y};
  });
  await page.mouse.click(point.x,point.y);await expect(sector).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('top-entry')).toHaveCount(10);await expect(page.getByTestId('top-entry').first()).toContainText('WALLET SHOP 12');
  await expect(page.getByTestId('top-entry').filter({hasText:'WALLET OTHER'})).toHaveCount(0);
  await expect(page.getByTestId('cp-row')).toHaveCount(12);
  await sector.focus();await page.keyboard.press('Enter');await expect(sector).toHaveAttribute('aria-pressed','false');
  await expect(page.getByTestId('top-entry').first()).toContainText('WALLET OTHER');
  await page.getByTestId('cat-row').filter({hasText:food}).click();
  await expect(page.getByTestId('top-entry')).toHaveCount(1);
  await page.getByRole('button',{name:'Все категории',exact:true}).click();await expect(page.getByTestId('top-entry')).toHaveCount(10);
  await page.getByRole('group',{name:'Диаграмма по категориям'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-results/donut-${test.info().project.name}.png`});
});

test('счета: фильтр отчёта, перенос операции, импорт и создание депозита',async({page})=>{
  await setup(page);
  const nav=page.getByRole('navigation');
  await nav.getByRole('button',{name:'Отчёты',exact:true}).click();
  await page.getByLabel('Счёт отчёта').selectOption('ui-freedom-card');
  await expect(page.getByTestId('top-entry')).toHaveCount(1);
  await expect(page.getByTestId('top-entry')).toContainText('WALLET OTHER');
  await nav.getByRole('button',{name:'Лента',exact:true}).click();
  await page.locator('[data-entry-id="ui-wallet-other"]').click();
  const editor=page.getByRole('dialog',{name:'Запись',exact:true});
  await expect(editor.getByLabel('Счёт операции')).toHaveValue('ui-freedom-card');
  await editor.getByLabel('Счёт операции').selectOption('ui-freedom-deposit');
  await editor.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-entry-id]')).toHaveCount(0);
  const deposit=page.getByRole('button',{name:'Freedom · Накопления · Депозит',exact:true});
  await deposit.click();await expect(page.locator('[data-entry-id="ui-wallet-other"]')).toContainText('Накопления');
  await page.getByRole('button',{name:'Загрузить выписку',exact:true}).click();
  await expect(page.getByLabel('Счёт выписки')).toHaveValue('ui-freedom-deposit');
  await expect(page.getByLabel('Freedom PDF',{exact:true})).toBeChecked();
  await page.getByLabel('Универсальный CSV').check();
  await page.getByLabel('Файл выписки').setInputFiles({name:'wallet-deposit.csv',mimeType:'text/csv',buffer:Buffer.from('date;amount;counterparty\n2026-11-03;1;WALLET IMPORT DEPOSIT')});
  await importStatement(page);await expect(page.getByTestId('import-report')).toContainText('Добавлено1');
  await nav.getByRole('button',{name:'Лента',exact:true}).click();
  await expect(page.locator('[data-entry-id]').filter({hasText:'WALLET IMPORT DEPOSIT'})).toContainText('Накопления');
  await nav.getByRole('button',{name:'Ещё',exact:true}).click();
  await page.getByRole('button',{name:/Финансовый профиль/}).click();
  await page.getByRole('button',{name:'Продолжить анкету',exact:true}).click();
  await page.getByRole('button',{name:'+ Депозит',exact:true}).click();
  await expect(page.getByLabel('Вид счёта 4',{exact:true})).toHaveValue('deposit');
  await page.getByLabel('Название счёта 4',{exact:true}).fill('Резерв');
  await page.getByLabel('Начальный остаток счёта 4',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Финансовый профиль',exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'Лента',exact:true}).click();
  await expect(page.getByTestId('wallet-card')).toHaveCount(4);
  await expect(page.getByRole('button',{name:'Freedom · Резерв · Депозит',exact:true})).toBeVisible();
});
