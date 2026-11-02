import type { FinancialProfile, FinancialProfileRecord } from '../../../../shared/financial-profile';
import { HttpError, type Store } from '../../env';
import { parseDateMs } from './normalize';

const fail=(message:string):never=>{throw new HttpError(400,'bad_profile',message);};
function text(value:unknown,label:string,max=80){
  if(typeof value!=='string'||value.trim().length>max||/[\u0000-\u001f]/.test(value))return fail(`Проверьте поле «${label}»`);
  return value.trim();
}
function money(value:unknown,label:string,signed=false):number|null{
  if(value===null)return null;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||Math.abs(value)>100_000_000_000_000||(!signed&&value<0))return fail(`Проверьте сумму «${label}»`);
  return value;
}
function array(value:unknown,max:number,label:string):any[]{if(!Array.isArray(value)||value.length>max)return fail(`Слишком много элементов: ${label}`);return value;}
function obj(value:any){if(!value||typeof value!=='object'||Array.isArray(value))return fail('Некорректная анкета');return value;}
function uniqueIds(rows:{id:string}[]){if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>!r.id))fail('Идентификаторы строк должны быть уникальными');}

export async function readProfile(store:Store,accountId:string):Promise<FinancialProfileRecord>{
  const row=await store.first<any>('SELECT status, version, payload_json, updated_at FROM financial_profiles WHERE account_id = ?',accountId);
  return row?{status:row.status,version:row.version,profile:JSON.parse(row.payload_json),updatedAt:row.updated_at}:{status:'new',version:0,profile:null,updatedAt:null};
}
export async function saveProfile(store:Store,accountId:string,body:any):Promise<FinancialProfileRecord>{
  obj(body);
  if(!Number.isSafeInteger(body.version)||body.version<0)fail('Некорректная версия анкеты');
  if(!['draft','complete','deferred'].includes(body.status))fail('Некорректный статус анкеты');
  const p=obj(body.profile);
  const balanceDate=text(p.balanceDate,'Дата остатков',10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(balanceDate)||parseDateMs(balanceDate)===null)fail('Укажите существующую дату остатков');
  const categories=await store.all<{id:string;type:string}>('SELECT id, type FROM categories WHERE account_id=? AND deleted_at IS NULL',accountId);
  const category=(id:unknown,type:string)=>{if(typeof id!=='string'||!categories.some(c=>c.id===id&&c.type===type))fail('Категория недоступна в вашем аккаунте');return id as string;};
  const accounts=array(p.accounts,30,'счета').map(a=>{
    obj(a);const kind=a.kind;if(!['card','deposit','account','cash'].includes(kind))fail('Неизвестный вид счёта');
    const bank=text(a.bank,'Банк'),name=text(a.name,'Название счёта');
    if(!bank||!name)fail('Укажите банк и название каждого счёта');
    return {id:text(a.id,'ID счёта'),bank,name,kind,openingBalanceMinor:money(a.openingBalanceMinor,'Остаток',kind==='card'||kind==='account')};
  });uniqueIds(accounts);
  const expenseCategoryIds=array(p.expenseCategoryIds,100,'категории').map(id=>category(id,'expense'));
  if(new Set(expenseCategoryIds).size!==expenseCategoryIds.length)fail('Категории не должны повторяться');
  const incomes=array(p.incomes,30,'доходы').map(a=>{
    obj(a);const name=text(a.name,'Источник дохода');if(!name)fail('Назовите источник дохода');
    if(typeof a.regular!=='boolean')fail('Укажите регулярность дохода');
    return {id:text(a.id,'ID дохода'),name,categoryId:a.categoryId===''?'':category(a.categoryId,'income'),monthlyMinor:money(a.monthlyMinor,'Доход в месяц'),regular:a.regular};
  });uniqueIds(incomes);
  const obligations=array(p.obligations,30,'обязательства').map(a=>{obj(a);const name=text(a.name,'Обязательство');if(!name)fail('Назовите обязательство');return {id:text(a.id,'ID обязательства'),name,monthlyMinor:money(a.monthlyMinor,'Платёж в месяц'),debtMinor:money(a.debtMinor,'Остаток долга')};});uniqueIds(obligations);
  if(!Number.isInteger(p.householdSize)||p.householdSize<1||p.householdSize>30)fail('Число человек: от 1 до 30');
  const profile:FinancialProfile={balanceDate,accounts,expenseCategoryIds,incomes,obligations,householdSize:p.householdSize,monthlyBudgetMinor:money(p.monthlyBudgetMinor,'Бюджет расходов'),goal:text(p.goal,'Цель',200),goalTargetMinor:money(p.goalTargetMinor,'Сумма цели'),monthlySavingMinor:money(p.monthlySavingMinor,'Накопления в месяц')};
  const payload=JSON.stringify(profile),updatedAt=Date.now();
  if(new TextEncoder().encode(payload).length>24000)fail('Анкета слишком большая');
  // Compare-and-swap in SQL: stale tabs cannot silently overwrite client finances.
  const result=body.version===0
    ?await store.run('INSERT INTO financial_profiles (account_id,status,version,payload_json,updated_at) VALUES (?,?,1,?,?) ON CONFLICT(account_id) DO NOTHING',accountId,body.status,payload,updatedAt)
    :await store.run('UPDATE financial_profiles SET status=?,version=version+1,payload_json=?,updated_at=? WHERE account_id=? AND version=?',body.status,payload,updatedAt,accountId,body.version);
  if(!result.meta?.changes)throw new HttpError(409,'profile_conflict','Анкета изменена в другом окне. Обновите страницу, чтобы загрузить сохранённую версию.');
  return {status:body.status,version:body.version+1,profile,updatedAt};
}
