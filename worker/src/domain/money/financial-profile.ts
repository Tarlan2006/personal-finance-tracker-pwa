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
    const budgets=array(a.budgets??[],20,'бюджеты счёта').map(b=>{obj(b);const name=text(b.name,'Название бюджета',60),amountMinor=money(b.amountMinor,'Бюджет');if(!name||amountMinor===null)fail('Укажите название и сумму бюджета');return {id:text(b.id,'ID бюджета'),name,amountMinor:amountMinor!};});uniqueIds(budgets);
    return {id:text(a.id,'ID счёта'),bank,name,kind,openingBalanceMinor:money(a.openingBalanceMinor,'Остаток',kind==='card'||kind==='account'),...(a.budgets!==undefined?{budgets}:{})};
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
  const previous=body.version?await readProfile(store,accountId):null;
  const removed=previous?.profile?.accounts.filter(old=>!accounts.some(a=>a.id===old.id))??[];
  if(removed.length){
    const choices=array(body.accountResolutions??[],30,'решения по удалённым счетам'),mapping:Record<string,string|null>={};
    for(const c of choices){obj(c);if(!removed.some(a=>a.id===c.id)||c.targetId!==null&&!accounts.some(a=>a.id===c.targetId))fail('Выберите существующий счёт для переноса');if(Object.hasOwn(mapping,c.id))fail('Решение по счёту повторяется');mapping[c.id]=c.targetId;}
    const removedIds=JSON.stringify(removed.map(a=>a.id)),resolvedIds=JSON.stringify(Object.keys(mapping)),mapJson=JSON.stringify(mapping);
    const dependencies=async()=>{
      const rows=await store.all<{id:string;operations:number;transfers:number}>(`WITH refs AS (
        SELECT id AS entry_id,kind,financial_account_id AS id FROM entries WHERE account_id=? AND kind IN ('tx','transfer')
        UNION SELECT id,kind,transfer_to_account_id FROM entries WHERE account_id=? AND kind='transfer'
      ) SELECT id,SUM(kind='tx') AS operations,SUM(kind='transfer') AS transfers FROM refs WHERE id IN (SELECT value FROM json_each(?)) GROUP BY id`,accountId,accountId,removedIds);
      return rows.filter(r=>!Object.hasOwn(mapping,r.id)).map(r=>({...r,name:removed.find(a=>a.id===r.id)!.name}));
    };
    const reject=(rows:Awaited<ReturnType<typeof dependencies>>)=>{throw new HttpError(409,'account_in_use','У удаляемых счетов есть операции. Выберите, что с ними сделать',{}, {removedAccounts:rows});};
    const used=await dependencies();if(used.length)reject(used);
    // SQL guard catches a concurrent insertion after the dependency check. changes() binds
    // relocation to this successful profile CAS, rather than another tab's saved version.
    const [saved]=await store.batch([
      store.stmt(`UPDATE financial_profiles SET status=?,version=version+1,payload_json=?,updated_at=? WHERE account_id=? AND version=? AND NOT EXISTS (
        SELECT 1 FROM entries WHERE account_id=? AND kind IN ('tx','transfer') AND (
          (financial_account_id IN (SELECT value FROM json_each(?)) AND financial_account_id NOT IN (SELECT value FROM json_each(?))) OR
          (transfer_to_account_id IN (SELECT value FROM json_each(?)) AND transfer_to_account_id NOT IN (SELECT value FROM json_each(?)))
        ))`,body.status,payload,updatedAt,accountId,body.version,accountId,removedIds,resolvedIds,removedIds,resolvedIds),
      store.stmt(`UPDATE entries SET
        payload_json=CASE WHEN kind='tx' THEN json_set(payload_json,'$.financialAccountId',CASE WHEN financial_account_id IN (SELECT value FROM json_each(?)) THEN (SELECT value FROM json_each(?) WHERE key=financial_account_id) ELSE financial_account_id END)
          ELSE json_set(payload_json,'$.fromId',CASE WHEN financial_account_id IN (SELECT value FROM json_each(?)) THEN (SELECT value FROM json_each(?) WHERE key=financial_account_id) ELSE financial_account_id END,
            '$.toId',CASE WHEN transfer_to_account_id IN (SELECT value FROM json_each(?)) THEN (SELECT value FROM json_each(?) WHERE key=transfer_to_account_id) ELSE transfer_to_account_id END) END,
        financial_account_id=CASE WHEN financial_account_id IN (SELECT value FROM json_each(?)) THEN (SELECT value FROM json_each(?) WHERE key=financial_account_id) ELSE financial_account_id END,
        transfer_to_account_id=CASE WHEN transfer_to_account_id IN (SELECT value FROM json_each(?)) THEN (SELECT value FROM json_each(?) WHERE key=transfer_to_account_id) ELSE transfer_to_account_id END,
        version=version+1,updated_at=? WHERE account_id=? AND kind IN ('tx','transfer') AND changes()=1 AND (financial_account_id IN (SELECT value FROM json_each(?)) OR transfer_to_account_id IN (SELECT value FROM json_each(?)))`,resolvedIds,mapJson,resolvedIds,mapJson,resolvedIds,mapJson,resolvedIds,mapJson,resolvedIds,mapJson,updatedAt,accountId,resolvedIds,resolvedIds),
    ]);
    if(!saved.meta?.changes){const raced=await dependencies();if(raced.length)reject(raced);throw new HttpError(409,'profile_conflict','Анкета изменена в другом окне. Обновите страницу');}
    return {status:body.status,version:body.version+1,profile,updatedAt};
  }
  // Compare-and-swap in SQL: stale tabs cannot silently overwrite client finances.
  const result=body.version===0
    ?await store.run('INSERT INTO financial_profiles (account_id,status,version,payload_json,updated_at) VALUES (?,?,1,?,?) ON CONFLICT(account_id) DO NOTHING',accountId,body.status,payload,updatedAt)
    :await store.run('UPDATE financial_profiles SET status=?,version=version+1,payload_json=?,updated_at=? WHERE account_id=? AND version=?',body.status,payload,updatedAt,accountId,body.version);
  if(!result.meta?.changes)throw new HttpError(409,'profile_conflict','Анкета изменена в другом окне. Обновите страницу, чтобы загрузить сохранённую версию.');
  return {status:body.status,version:body.version+1,profile,updatedAt};
}
