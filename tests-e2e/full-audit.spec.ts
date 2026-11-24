import {test,expect} from '@playwright/test';
import {importStatement} from './import-helper';
import {auditLedger} from '../scripts/audit-ledger';

test('финансовая сверка: значения SQLite на экране при 250 операциях',async({page,baseURL})=>{
  test.skip(!baseURL || !['localhost','127.0.0.1'].includes(new URL(baseURL).hostname),'Только локальная синтетическая база');
  const oracle=await auditLedger();
  await page.goto('/');
  await page.getByLabel('Логин',{exact:true}).fill('zz-audit');
  await page.getByLabel('Пароль',{exact:true}).fill('e2e-local-audit-only');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();
  await page.evaluate(async ({profile,entries,categoryNames})=>{
    const send=async(method:string,path:string,body?:unknown)=>{
      const r=await fetch(path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
      if(!r.ok)throw Error(method+' '+path+' '+r.status);return r.json();
    };
    const login='zz-audit';
    await send('POST','/api/history/clear',{confirmation:'DELETE_ALL_HISTORY',accountLogin:login});
    const current=await send('GET','/api/financial-profile');
    await send('PUT','/api/financial-profile',{version:current.version,status:'complete',profile});
    const {categories}=await send('GET','/api/categories');
    const ids=new Map(categoryNames.map(c=>[c.id,categories.find((v:any)=>v.name===c.name&&v.type===c.type).id]));
    const mapped=entries.map(row=>({...row,login,categoryId:ids.get(row.categoryId??'')??null}));
    for(let i=0;i<mapped.length;i+=50) {
      const batch=await send('POST','/api/entries/batch',{items:mapped.slice(i,i+50)});
      if(batch.results.some((r:any)=>!r.ok))throw Error('Ошибка синтетического импорта');
    }
    await send('DELETE','/api/entries/'+entries[17].id);
    await send('POST','/api/transfers',{id:'audit-transfer',accountLogin:login,fromId:'card',toId:'deposit',amountMinor:101,occurredAt:Date.parse(profile.balanceDate+'T00:00:00+05:00')});
  },{profile:oracle.profile,entries:oracle.entries,categoryNames:oracle.categoryNames});
  await page.reload();
  await page.emulateMedia({reducedMotion:'reduce'});
  const money=(s:string)=>Math.round(Number(s.replace(/[\s₸]/g,'').replace('−','-').replace(',','.'))*100);
  const wallet=page.getByTestId('wallet-card');
  await expect(wallet).toHaveCount(3);
  for(let i=0;i<3;i++)await expect.poll(async()=>money(await wallet.nth(i).locator('.wallet-mini-balance b').innerText())).toBe(oracle.balances[i]);
  await expect.poll(async()=>money(await page.locator('.balance-value').innerText())).toBe(oracle.currentTotals.net);
  const cashBudget=wallet.nth(2).locator('.wallet-budget-tile strong');
  expect(money(await cashBudget.textContent()??'')).toBe(oracle.plansMinor.cash);
  await page.getByRole('navigation').getByRole('button',{name:'Отчёты',exact:true}).click();
  for(const [dir,label] of [['out','Расходы'],['in','Доходы']] as const){
    await page.getByRole('button',{name:label,exact:true}).click();
    const rows=page.getByTestId('cat-row'), exp=oracle.expectedReport.byCategory[dir];
    await expect(rows).toHaveCount(exp.length);
    const shares=(await rows.locator('.sub').allTextContents()).map(s=>Number(s.match(/(\d+)%/)![1]));
    expect(shares.reduce((s,n)=>s+n,0)).toBe(100);
    for(const c of exp)expect(money(await rows.filter({hasText:c.name}).locator('.amt').innerText())).toBe(c.sum);
    for(const c of oracle.expectedReport.byCounterparty[dir]){
      expect(money(await page.getByTestId('cp-row').filter({hasText:c.display}).locator('.amt').innerText())).toBe(c.sum);
    }
    const arcs=page.locator('.category-donut circle[role="button"]');
    for(let i=0;i<exp.length;i++){
      const dash=Number((await arcs.nth(i).getAttribute('stroke-dasharray'))!.split(' ')[0]);
      expect(dash).toBeCloseTo(Math.max(0,exp[i].sum/oracle.currentTotals[dir]*2*Math.PI*54-1),8);
    }
    const actual=(await page.getByTestId('top-entry').locator('.amt').allTextContents()).map(money);
    expect(actual).toEqual(oracle.expectedReport.topEntries[dir].map((r:any)=>r.amountMinor));
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('navigation').getByRole('button',{name:'Ещё',exact:true}).click();
  await page.getByRole('button',{name:/Финансовый профиль/}).click();
  const summary=page.getByTestId('financial-profile-summary');
  for(const [label,key] of [['План расходов / месяц','budget'],['Откладывать / месяц','saving']] as const){
    const row=summary.locator('.row').filter({hasText:label});
    expect(money(await row.locator('span').last().innerText())).toBe(oracle.plansMinor[key]);
  }
  const opening=await summary.locator('.row').first().locator('.sub').innerText();
  expect(money(opening.replace('Указано:',''))).toBe(oracle.plansMinor.opening);
  expect(money(await summary.locator('.row').filter({hasText:'Цель:'}).locator('.sub').innerText())).toBe(oracle.plansMinor.target);
});

test('нажатие подписи переводит фокус на поле входа',async({page})=>{
  await page.goto('/');
  await page.locator('.field label').filter({hasText:/^Пароль$/}).click();
  await expect(page.getByLabel('Пароль',{exact:true})).toBeFocused();
});

test('три PDF: загрузка с диска, инвариант, повтор и отмена через историю',async({page,baseURL})=>{
  test.skip(!baseURL||new URL(baseURL).hostname!=='localhost','Только локальный стенд');
  await page.goto('/');await page.getByLabel('Логин',{exact:true}).fill('zz-audit');
  await page.getByLabel('Пароль',{exact:true}).fill('e2e-local-audit-only');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:/^(Лента|Где ваши деньги\?)$/})).toBeVisible();
  const later=page.getByRole('button',{name:'Сохранить и заполнить позже',exact:true});
  if(await later.isVisible())await later.click();
  await page.getByRole('navigation').getByRole('button',{name:'Выписка',exact:true}).click();
  for(const [bank,n] of [['Halyk',2],['Kaspi',2],['Freedom',4]] as const){
    await page.getByLabel(bank+' PDF',{exact:true}).check();
    for(let pass=0;pass<2;pass++){
      await page.getByLabel('Файл выписки').setInputFiles('web/public/examples/'+bank.toLowerCase()+'.pdf');
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/import'&&r.request().method()==='POST');
      await importStatement(page);
      const report=await (await response).json();
      expect(report.imported+report.duplicates+report.rejected+report.service).toBe(report.total);
      expect(report.imported).toBe(pass?0:n);expect(report.duplicates).toBe(pass?n:0);
      await expect(page.getByTestId('import-report')).toBeVisible();
    }
  }
  await page.getByRole('button',{name:'История импортов',exact:true}).click();
  const row=page.getByRole('button',{name:/Удалить документ/}).first();
  await row.click();
  const sheet=page.getByRole('dialog');
  await sheet.getByRole('button',{name:'Удалить документ и операции',exact:true}).click();
  await expect(sheet).toHaveCount(0);
});
