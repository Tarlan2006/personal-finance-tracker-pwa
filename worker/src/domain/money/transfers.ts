import {HttpError,type Store} from '../../env';
import {readProfile} from './financial-profile';
import {validateId} from './entries';

export interface Transfer {id:string;fromId:string;toId:string;amountMinor:number;occurredAt:number}
export async function createTransfer(store:Store,accountId:string,body:any){
  if(!body||typeof body!=='object'||typeof body.id!=='string'||!body.id)throw new HttpError(400,'bad_transfer','Нужен идентификатор перевода');
  const id=validateId(body.id),{fromId,toId,amountMinor,occurredAt}=body;
  if(typeof fromId!=='string'||typeof toId!=='string'||fromId===toId||!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor>100_000_000_000_00||!Number.isSafeInteger(occurredAt)||occurredAt<Date.UTC(2000,0,1)||occurredAt>Date.now()+60000)
    throw new HttpError(400,'bad_transfer','Выберите разные счета, положительную сумму и дату не позднее текущей');
  const payload=JSON.stringify({fromId,toId,amountMinor});
  const existing=await store.first<any>('SELECT kind,payload_json,occurred_at,deleted_at FROM entries WHERE account_id=? AND id=?',accountId,id);
  const duplicate=(row:any)=>{if(row.kind!=='transfer'||row.payload_json!==payload||row.occurred_at!==occurredAt||row.deleted_at!==null)throw new HttpError(409,'transfer_conflict','Этот перевод уже изменён или отменён. Обновите список переводов.');return {duplicate:true};};
  if(existing)return duplicate(existing);
  const {profile}=await readProfile(store,accountId);
  if(!profile||![fromId,toId].every(id=>profile.accounts.some(a=>a.id===id)))throw new HttpError(400,'bad_financial_account','Выберите два своих счёта');
  if(occurredAt<Date.parse(profile.balanceDate+'T00:00:00+05:00'))throw new HttpError(400,'bad_transfer_date','Дата перевода раньше начальных остатков');
  // A single row represents both legs: it cannot debit one side without crediting the other.
  const time=Date.now();
  const result=await store.run("INSERT INTO entries(id,account_id,kind,occurred_at,created_at,updated_at,value,payload_json,source) VALUES (?,?,'transfer',?,?,?,0,?,'app') ON CONFLICT(account_id,id) DO NOTHING",id,accountId,occurredAt,time,time,payload);
  if(!result.meta?.changes)return duplicate(await store.first('SELECT kind,payload_json,occurred_at,deleted_at FROM entries WHERE account_id=? AND id=?',accountId,id));
  return {duplicate:false};
}
export async function listTransfers(store:Store,accountId:string){
  const rows=await store.all<any>("SELECT id,occurred_at,payload_json FROM entries WHERE account_id=? AND kind='transfer' AND deleted_at IS NULL ORDER BY occurred_at DESC,id DESC LIMIT 50",accountId);
  return {items:rows.map(row=>({id:row.id,occurredAt:row.occurred_at,...JSON.parse(row.payload_json)}))};
}
export async function cancelTransfer(store:Store,accountId:string,id:string){
  const time=Date.now();const r=await store.run("UPDATE entries SET deleted_at=COALESCE(deleted_at,?),updated_at=?,version=version+1 WHERE account_id=? AND id=? AND kind='transfer'",time,time,accountId,id);
  if(!r.meta?.changes)throw new HttpError(404,'not_found','Перевод не найден');
  return {ok:true};
}
