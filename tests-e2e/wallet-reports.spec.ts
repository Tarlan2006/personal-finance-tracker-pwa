import { test, expect, type Page } from '@playwright/test';
import { importStatement } from './import-helper';

async function headerContrast(page:Page) {
  const stack=page.locator('.wallet-stack');
  const shot=await stack.screenshot({scale:'css',style:
    '.wallet-card-title,.wallet-mini-balance,.wallet-account-name,.wallet-mini-balance b,.wallet-mini-balance small{color:transparent!important}.tabbar,.fab,.island-toast{visibility:hidden!important}'});
  return stack.evaluate(async(el,base64)=>{
    const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,image.width,image.height).data;
    const bounds=el.getBoundingClientRect();
    const linear=(byte:number)=>{const v=byte/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
    let worst=21;
    for(const field of el.querySelectorAll('.wallet-card-title,.wallet-mini-balance')){
      const rect=field.getBoundingClientRect();
      for(let y=Math.ceil(rect.top-bounds.top);y<Math.floor(rect.bottom-bounds.top);y++){
        for(let x=Math.ceil(rect.left-bounds.left);x<Math.floor(rect.right-bounds.left);x++){
          const k=4*(y*image.width+x);
          const L=.2126*linear(pixels[k])+.7152*linear(pixels[k+1])+.0722*linear(pixels[k+2]);
          worst=Math.min(worst,1.05/(L+.05));
        }
      }
    }
    return worst;
  },shot.toString('base64'));
}

async function setup(page:Page){
  await page.setExtraHTTPHeaders({'CF-Connecting-IP':'198.18.0.8'});
  await page.goto('/');await page.getByLabel('Логин',{exact:true}).fill('zz-wallet');
  await page.getByLabel('Пароль',{exact:true}).fill('e2e-wallet-password-1');await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();
  const result=await page.evaluate(async()=>{
    const request=async(method:string,path:string,body?:unknown)=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error('Synthetic setup failed '+path);return r.json();};
    const current=await request('GET','/api/financial-profile');
    const accounts=[{id:'ui-kaspi-card',bank:'Kaspi',name:'Gold',kind:'card',openingBalanceMinor:100000},{id:'ui-freedom-card',bank:'Freedom',name:'Daily',kind:'card',openingBalanceMinor:200000},{id:'ui-freedom-deposit',bank:'Freedom',name:'Накопления',kind:'deposit',openingBalanceMinor:300000}];
    const accountResolutions=(current.profile?.accounts??[]).filter((a:any)=>!accounts.some(b=>b.id===a.id)).map((a:any)=>({id:a.id,targetId:null}));
    await request('PUT','/api/financial-profile',{version:current.version,status:'deferred',accountResolutions,profile:{balanceDate:'2026-11-01',accounts,expenseCategoryIds:[],monthlyBudgetMinor:null,incomes:[],obligations:[],householdSize:1,goal:'',goalTargetMinor:null,monthlySavingMinor:null}});
    const categories=(await request('GET','/api/categories')).categories;
    const shop=categories.find((c:any)=>c.name==='Магазины'),food=categories.find((c:any)=>c.name==='Кафе и рестораны')??categories.filter((c:any)=>c.type==='expense'&&c.id!==shop.id)[0];
    const date=new Date().toISOString().slice(0,7)+'-02';
    const seed=async(body:any)=>{const r=await request('POST','/api/entries',body);if(r.entry.payload.financialAccountId!==body.financialAccountId)await request('PATCH','/api/entries/'+body.id,{version:r.entry.version,financialAccountId:body.financialAccountId});};
    for(let i=1;i<=12;i++)await seed({id:'ui-wallet-shop-'+i,direction:'out',amountMinor:i*100,categoryId:shop.id,financialAccountId:'ui-kaspi-card',counterparty:'WALLET SHOP '+i,occurredAt:date});
    await seed({id:'ui-wallet-other',direction:'out',amountMinor:90000,categoryId:food.id,financialAccountId:'ui-freedom-card',counterparty:'WALLET OTHER',occurredAt:date});
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
  const depositCard=page.getByTestId('wallet-card').filter({has:deposit});
  await expect(depositCard.locator('.wallet-balance')).toHaveText(/3\s?010 ₸/);
  await expect(page.locator('[data-entry-id]')).toHaveCount(1);
  const kaspi=page.getByRole('button',{name:'Kaspi · Gold · Карта',exact:true});await kaspi.click();
  await expect(kaspi).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-entry-id]')).toHaveCount(12);
  await kaspi.click();await expect(page.getByRole('button',{name:'Все счета',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-entry-id]')).toHaveCount(14);
  await expect(cards.locator('[aria-expanded=true]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await expect(page.locator('.island-toast')).toHaveCount(0);
  await page.getByRole('region',{name:'Мои счета'}).screenshot({path:`test-results/wallet-${test.info().project.name}.png`});
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await depositCard.evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
});

test('wallet: бюджеты сохраняются, перевод повторяется без дубля и отменяется',async({page})=>{
  await setup(page);
  await page.getByRole('button',{name:'Бюджеты Kaspi · Gold',exact:true}).click();
  const budget=page.getByRole('dialog',{name:'Бюджеты счёта',exact:true});
  await budget.getByLabel('Название бюджета',{exact:true}).fill('На продукты');
  await budget.getByLabel('Сумма бюджета',{exact:true}).fill('250');
  await budget.getByRole('button',{name:'Сохранить бюджет',exact:true}).click();
  await expect(budget.getByRole('button',{name:/На продукты · 250/})).toBeVisible();
  await budget.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Бюджеты Kaspi · Gold',exact:true}).click();
  await expect(budget.getByRole('button',{name:/На продукты · 250/})).toBeVisible();
  await budget.getByRole('button',{name:'Закрыть',exact:true}).click();
  const before=await page.evaluate(async()=>await(await fetch('/api/wallet')).json());
  await page.getByRole('button',{name:'Перевод между счетами',exact:true}).click();
  const transfer=page.getByRole('dialog',{name:'Между своими счетами',exact:true});
  await transfer.getByLabel('Откуда',{exact:true}).selectOption('ui-kaspi-card');
  await transfer.getByLabel('Куда',{exact:true}).selectOption('ui-freedom-deposit');
  await transfer.getByLabel('Сумма перевода',{exact:true}).fill('100');
  let lost=false;const sent:string[]=[];
  await page.route('**/api/transfers',async route=>{if(route.request().method()!=='POST')return route.continue();sent.push(route.request().postData()!);if(!lost){lost=true;await route.fetch();return route.abort('failed');}if(sent.length===2)return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'rate_limited',message:'Повторите подтверждение'})});return route.continue();});
  await transfer.getByRole('button',{name:'Учесть перевод',exact:true}).click();
  await expect(transfer.getByRole('button',{name:'Повторить подтверждение',exact:true})).toBeVisible();
  await transfer.getByRole('button',{name:'Повторить подтверждение',exact:true}).click();
  await expect(transfer.getByRole('alert').filter({hasText:'Повторите подтверждение'}).last()).toBeVisible();
  await transfer.getByRole('button',{name:'Повторить подтверждение',exact:true}).click();
  await expect(transfer.getByRole('status')).toHaveText('Перевод учтён');expect(sent).toHaveLength(3);expect(new Set(sent).size).toBe(1);
  const after=await page.evaluate(async()=>await(await fetch('/api/wallet')).json());
  const find=(w:any,id:string)=>w.accounts.find((a:any)=>a.id===id);
  expect(find(after,'ui-kaspi-card').balanceMinor).toBe(find(before,'ui-kaspi-card').balanceMinor-10000);
  expect(find(after,'ui-freedom-deposit').balanceMinor).toBe(find(before,'ui-freedom-deposit').balanceMinor+10000);
  expect(after.accounts.map((a:any)=>[a.in,a.out])).toEqual(before.accounts.map((a:any)=>[a.in,a.out]));
  await transfer.getByRole('button',{name:'Изменить перевод',exact:true}).click();
  await transfer.getByLabel('Сумма перевода',{exact:true}).fill('125');
  await transfer.getByLabel('Комментарий перевода',{exact:true}).fill('SYNTHETIC EDIT');
  await transfer.getByRole('button',{name:'Сохранить перевод',exact:true}).click();
  await expect(transfer.getByText('SYNTHETIC EDIT',{exact:true})).toBeVisible();
  await expect(transfer.getByRole('button',{name:'Отменить перевод 125 ₸',exact:true})).toHaveCount(1);
  page.once('dialog',d=>d.accept());await transfer.getByRole('button',{name:'Отменить перевод 125 ₸',exact:true}).click();
  await expect(transfer.getByRole('button',{name:'Отменить перевод 125 ₸',exact:true})).toHaveCount(0);
  const restored=await page.evaluate(async()=>await(await fetch('/api/wallet')).json());
  expect(restored.accounts.map((a:any)=>a.balanceMinor)).toEqual(before.accounts.map((a:any)=>a.balanceMinor));
});

test('wallet: 390px, планшет, десктоп, логотипы, стопка и бюджеты наличных',async({page})=>{
  await setup(page);
  await page.evaluate(async()=>{
    const record=await(await fetch('/api/financial-profile')).json();
    record.accountResolutions=record.profile.accounts.map((a:any)=>({id:a.id,targetId:null}));
    record.profile.accounts=[
      {id:'design-cash',bank:'Наличные',name:'Кошелёк',kind:'cash',openingBalanceMinor:72586500,budgets:[{id:'cash-personal',name:'Личные',amountMinor:9050000},{id:'cash-business',name:'Бизнес',amountMinor:18000000}]},
      {id:'design-kaspi',bank:'Kaspi',name:'Gold',kind:'card',openingBalanceMinor:25870000},
      {id:'design-forte',bank:'Forte',name:'Основная карта для повседневных покупок',kind:'card',openingBalanceMinor:null},
      {id:'design-halyk',bank:'Halyk',name:'Основная',kind:'card',openingBalanceMinor:75855500},
      {id:'design-freedom',bank:'Freedom',name:'Накопления',kind:'deposit',openingBalanceMinor:99999999999999}];
    const r=await fetch('/api/financial-profile',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(record)});if(!r.ok)throw new Error('Synthetic design profile failed');
  });
  await page.setViewportSize({width:390,height:844});await page.reload();
  const wallet=page.getByRole('region',{name:'Мои счета'}),cards=page.getByTestId('wallet-card');
  await expect(cards).toHaveCount(5);await expect(wallet.getByRole('heading',{name:'Счета и бюджеты'})).toBeVisible();
  await expect(wallet.locator('.bank-logo')).toHaveCount(5);
  await expect.poll(()=>wallet.locator('.bank-logo img').evaluateAll(imgs=>imgs.every(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0))).toBe(true);
  const kaspi=page.getByRole('button',{name:'Kaspi · Gold · Карта',exact:true});
  const positions=()=>cards.evaluateAll(els=>els.map(node=>({y:(node as HTMLElement).offsetTop,h:node.clientHeight})));
  const before=await positions();
  await kaspi.click();await expect(kaspi).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>{
    const after=await positions(),delta=after[1].h-before[1].h;
    return delta>100 && after.every((r,i)=>Math.abs(r.y-before[i].y-(i>1?delta:0))<=1);
  }).toBe(true);
  await page.getByRole('button',{name:'Свернуть карточки',exact:true}).click();await expect(kaspi).toHaveAttribute('aria-pressed','false');
  const cash=page.getByRole('button',{name:'Наличные · Кошелёк · Наличные',exact:true});await cash.click();
  await expect(wallet.locator('.wallet-cash .wallet-balance')).toHaveText(/725\s?865 ₸/);
  await expect(wallet.getByRole('button',{name:/Личные.*90/})).toBeVisible();
  const scroller=wallet.getByLabel('Бюджеты наличных',{exact:true});expect(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  await scroller.evaluate(el=>el.scrollLeft=el.scrollWidth);expect(await scroller.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  for(const width of [360,390,768,1280]){
    await page.setViewportSize({width,height:width===390?844:1024});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await expect.poll(()=>wallet.locator('.wallet-cash').evaluate(el=>el.querySelector('.wallet-flows')!.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom)).toBe(true);
    await expect(wallet.locator('.wallet-cash .wallet-balance')).toHaveText(/725\s?865 ₸/);
    await wallet.screenshot({path:`test-results/wallet-design-${test.info().project.name}-${width}.png`,animations:'disabled',scale:'css',style:'.tabbar,.fab,.island-toast{visibility:hidden!important}'});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await kaspi.click();
  expect(await wallet.locator('.wallet-kaspi.expanded').evaluate(el=>el.clientHeight)).toBeLessThanOrEqual(250);
  await expect(wallet.locator('.wallet-kaspi .wallet-balance')).toHaveText(/258\s?700 ₸/);
  expect(await wallet.locator('.wallet-kaspi').evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);

  const all=wallet.getByRole('button',{name:'Все счета',exact:true});
  const order=wallet.getByRole('button',{name:'Порядок',exact:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const width of [360,390,430]){
    await page.setViewportSize({width,height:932});
    await all.click();
    const shot=async(state:string)=>{
      await wallet.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
      await wallet.screenshot({path:`test-results/wallet-cards/${test.info().project.name}-${width}-${state}.png`,scale:'css',
        style:'.tabbar,.fab,.island-toast{visibility:hidden!important}'});
    };
    const checkHeader=()=>cards.evaluateAll(els=>els.every(card=>{
      const rect=(s:string)=>card.querySelector(s)!.getBoundingClientRect();
      const title=rect('.wallet-card-title'),sum=rect('.wallet-mini-balance'),head=rect('.wallet-card-header');
      const pill=card.querySelector('.wallet-budget-add span,.wallet-budget-count')!.getBoundingClientRect();
      const amount=card.querySelector('.wallet-mini-balance b')!;
      return title.right<=sum.left && sum.right<=head.right && title.bottom < pill.top &&
        sum.bottom<=head.bottom && amount.scrollWidth<=amount.clientWidth+1;
    }));
    expect(await checkHeader()).toBe(true);
    await shot('closed');
    if(width===360)expect(await headerContrast(page)).toBeGreaterThanOrEqual(4.5);
    for(const [index,state] of [[0,'first'],[2,'middle'],[4,'last']] as const){
      await cards.nth(index).locator('.wallet-card-toggle').click();
      await expect(cards.nth(index)).toHaveClass(/expanded/);
      expect(await checkHeader()).toBe(true);
      await shot(state);
    }
    await all.click();await order.click();await shot('order');
    const grip=cards.first().locator('.wallet-grip');
    await grip.scrollIntoViewIfNeeded();
    const box=(await grip.boundingBox())!;
    await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();
    await page.mouse.move(box.x+20,box.y+120,{steps:5});
    await expect(cards.first()).toHaveAttribute('data-lifted','');
    await shot('drag');
    await page.keyboard.press('Escape');await page.mouse.up();
    await wallet.getByRole('button',{name:'Готово'}).click();
  }
  await cards.nth(2).locator('.wallet-card-toggle').click();
  await wallet.getByRole('button',{name:'Указать остаток'}).click();
  const sheet=page.getByRole('dialog',{name:'Указать остаток'});
  await sheet.getByLabel('Начальный остаток',{exact:true}).fill('-12,34');
  await sheet.getByRole('button',{name:'Сохранить остаток'}).click();
  await expect(cards.nth(2).locator('.wallet-balance')).toHaveText('-12,34 ₸');
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

test('банк в интерфейсе: импорт, кошелёк и лента', async ({page}, info) => {
  await setup(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  const wallet = page.getByRole('region', {name:'Мои счета'});
  const day = page.locator('.day-section').first();
  const file = (screen:string) => 'test-results/bank-logos/'+info.project.name+'-'+screen+'.png';
  const settled = async (region:typeof wallet) => {
    await expect(region.locator('.bank-logo').first()).toBeVisible();
    await expect.poll(() => region.locator('.bank-logo img').evaluateAll(images =>
      images.length > 0 && images.every(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth === 128)
    )).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  await settled(wallet);
  await wallet.screenshot({path:file('wallet'), scale:'css', animations:'disabled'});
  await day.getByTestId('entry-row').first().scrollIntoViewIfNeeded();
  await settled(day);
  await page.screenshot({path:file('feed'), scale:'css', animations:'disabled'});
  await page.getByRole('button',{name:'Загрузить выписку',exact:true}).click();
  const banks = page.locator('.bank-cards');
  await expect(banks.locator('.bank-logo')).toHaveCount(3);
  await settled(banks);
  await page.screenshot({path:file('import'), scale:'css', animations:'disabled'});
});

test('банк в интерфейсе: ошибка загрузки сохраняет размер и фокус', async ({page}) => {
  // The wallet already renders Kaspi. Prevent a successful preload before testing a failed response.
  const imageUrl='**/banks/kaspi.png';
  await page.route(imageUrl,route=>route.abort());
  await page.emulateMedia({reducedMotion:'reduce'});
  await setup(page);
  await page.getByRole('button',{name:'Добавить операцию',exact:true}).click();
  const sheet = page.getByRole('dialog',{name:'Добавить',exact:true});
  const select = sheet.getByLabel('Счёт операции');
  const logo = sheet.locator('.bank-select-control .bank-logo');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.unroute(imageUrl);
  await page.route(imageUrl,async route => { await gate; await route.abort(); });
  await select.focus();
  await select.selectOption('ui-kaspi-card');
  // Measure within the field: the sheet itself can move while iOS scrolls to focus.
  const geometry = () => select.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const mark = el.parentElement!.querySelector('.bank-logo')!.getBoundingClientRect();
    return [rect.width, rect.height, mark.width, mark.height, mark.x - rect.x, Math.round(mark.y - rect.y)];
  });
  const before = await geometry();
  release();
  await expect(logo).toHaveText('K');
  await expect(logo.locator('img')).toHaveCount(0);
  expect(await geometry()).toEqual(before);
  await expect(select).toBeFocused();
});

test('четыре фирменных PNG действительно поставляются с приложением',async({page})=>{
  await page.goto('/');
  for(const bank of ['kaspi','halyk','forte','freedom']){
    const size=await page.evaluate(async name=>{
      const img=new Image();img.src='/banks/'+name+'.png';
      try {await img.decode();return [img.naturalWidth,img.naturalHeight];}catch{return [0,0];}
    },bank);
    expect.soft(size,bank).toEqual([128,128]);
  }
});

test('лента показывает банк выписки без привязки к счёту', async ({page}) => {
  await setup(page);
  const rowId='ui-statement-no-account';
  const status=await page.evaluate(async id=>(await fetch('/api/entries',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id,bank:'halyk',direction:'out',amountMinor:75,counterparty:'TEST SHOP'})
  })).status,rowId);
  expect([200,201]).toContain(status);
  await page.reload();
  const logo=page.locator('[data-entry-id="'+rowId+'"] .bank-logo img');
  await expect(logo).toHaveAttribute('src','/banks/halyk.png');
  await logo.scrollIntoViewIfNeeded();
  await expect.poll(()=>logo.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBe(128);
});

test('порядок счетов: клавиатура, перезагрузка, конфликт версий и сохранность анкеты',async({page})=>{
  await setup(page);
  const cards=page.getByTestId('wallet-card');
  const ids=()=>cards.evaluateAll(els=>els.map(el=>el.getAttribute('data-account')));
  const original=await ids();
  const profile=()=>page.evaluate(async()=>await(await fetch('/api/financial-profile')).json());
  const before=await profile();
  const walletBefore=await page.evaluate(async()=>await(await fetch('/api/wallet')).json());
  await page.getByRole('button',{name:'Порядок',exact:true}).click();
  await cards.first().locator('.wallet-card-toggle').dispatchEvent('click');
  await expect(cards.locator('[aria-expanded=true]')).toHaveCount(0);
  const down=page.getByRole('button',{name:'Kaspi · Gold ниже',exact:true});
  await down.focus();await page.keyboard.press('Enter');
  await expect.poll(ids).toEqual([original[1],original[0],original[2]]);
  await expect(page.getByRole('status').filter({hasText:'Порядок сохранён'})).toBeAttached();
  await expect(down).toBeFocused();
  const after=await profile();
  expect(after.profile).toEqual({...before.profile,accounts:[before.profile.accounts[1],before.profile.accounts[0],before.profile.accounts[2]]});
  await page.reload();
  await expect.poll(ids).toEqual(after.profile.accounts.map((a:any)=>a.id));
  const walletAfter=await page.evaluate(async()=>await(await fetch('/api/wallet')).json());
  for(const a of walletBefore.accounts)expect(walletAfter.accounts.find((b:any)=>b.id===a.id)).toEqual(a);
  // A second writer edits the actual profile in SQLite while this page holds the old version.
  await page.evaluate(async()=>{
    const record=await(await fetch('/api/financial-profile')).json();
    record.profile.goal='Цель с другого устройства';
    const response=await fetch('/api/financial-profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
    if(!response.ok)throw Error('Не сохранилась параллельная правка');
  });
  await page.getByRole('button',{name:'Порядок',exact:true}).click();
  const up=page.getByRole('button',{name:'Kaspi · Gold выше',exact:true});
  await up.focus();await page.keyboard.press('Space');
  await expect(page.getByRole('alert')).toContainText('Загружены свежие данные');
  expect(await ids()).toEqual([original[1],original[0],original[2]]);
  await up.focus();await page.keyboard.press('Space');
  await expect.poll(async()=>(await profile()).profile.accounts.map((a:any)=>a.id)).toEqual(original);
  expect((await profile()).profile.goal).toBe('Цель с другого устройства');
});

test('долгое нажатие на шапку и перенос за ручку сохраняют место без выбора счёта',async({page})=>{
  await setup(page);
  const cards=page.getByTestId('wallet-card');
  const values=()=>cards.evaluateAll(els=>els.map(el=>el.getAttribute('data-account')));
  const initial=await values();
  const start=async(target:ReturnType<Page['locator']>)=>{
    await target.scrollIntoViewIfNeeded();
    const box=(await target.boundingBox())!;
    const x=box.x+14,y=box.y+15;
    await page.mouse.move(x,y);await page.mouse.down();
    await expect(page.locator('[data-lifted]')).toHaveCount(1);
    return {x,y};
  };
  const p=await start(cards.first().locator('.wallet-card-toggle'));
  await page.mouse.move(p.x,p.y+115,{steps:8});await page.mouse.up();
  await expect.poll(values).toEqual([initial[1],initial[0],initial[2]]);
  await expect(cards.locator('[aria-expanded=true]')).toHaveCount(0);
  await page.getByRole('button',{name:'Порядок',exact:true}).click();
  const q=await start(cards.nth(1).locator('.wallet-grip'));
  await page.mouse.move(q.x,q.y-110,{steps:8});await page.mouse.up();
  await expect.poll(values).toEqual(initial);
  await expect(page.getByRole('status').filter({hasText:'Порядок сохранён'})).toBeAttached();
  await page.reload();
  await expect.poll(values).toEqual(initial);
});

test('Сенсорный ввод: свайп прокручивает страницу, удержание переносит и прокручивает у края',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Проверка касаний через Chromium DevTools');
  await setup(page);
  const cards=page.getByTestId('wallet-card');
  const touch=await page.context().newCDPSession(page);
  const point=(type:'touchStart'|'touchMove'|'touchEnd',x=0,y=0)=>touch.send('Input.dispatchTouchEvent',{
    type,touchPoints:type==='touchEnd'?[]:[{x,y}]
  });
  const header=cards.first().locator('.wallet-card-toggle');
  const locate=async()=>{
    await header.evaluate(el=>el.scrollIntoView({block:'center'}));
    const box=(await header.boundingBox())!;
    return {x:box.x+20,y:box.y+20};
  };
  let p=await locate();
  const scroll=()=>page.evaluate(()=>window.scrollY),before=await scroll();
  await point('touchStart',p.x,p.y);
  for(let i=1;i<=5;i++)await point('touchMove',p.x,p.y-16*i);
  await point('touchEnd');
  await expect.poll(scroll).toBeGreaterThan(before);
  await expect(page.locator('[data-lifted],.wallet-card.expanded')).toHaveCount(0);
  await page.evaluate(()=>window.scrollTo(0,0));
  p=await locate();
  const id=await cards.first().getAttribute('data-account');
  await point('touchStart',p.x,p.y);
  await expect(page.locator('[data-lifted]')).toHaveCount(1);
  const scrollAtLift=await scroll();
  const edge=await page.evaluate(()=>innerHeight-16);
  await point('touchMove',p.x,edge);
  await expect.poll(scroll).toBeGreaterThan(scrollAtLift+20);
  await point('touchEnd');
  await expect(cards.last()).toHaveAttribute('data-account',id!);
  await expect(cards.locator('[aria-expanded=true]')).toHaveCount(0);
  await touch.detach();
});
