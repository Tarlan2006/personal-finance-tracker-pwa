import {HttpError,type Store} from '../../env';
import {readProfile} from './financial-profile';
import {validateId} from './entries';
const conflict=()=>new HttpError(409,'transfer_conflict','Перевод уже изменён или отменён. Обновите список переводов.');
function requireVersion(body:any){if(!Number.isSafeInteger(body?.version)||body.version<1)throw new HttpError(400,'version_required','Укажите версию перевода');return body.version as number;}
function normalize(body:any){
  const {fromId,toId,amountMinor,occurredAt}=body??{},comment=body?.comment??'';
  if(typeof fromId!=='string'||typeof toId!=='string'||fromId===toId||!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor>100_000_000_000_00||!Number.isSafeInteger(occurredAt)||occurredAt<Date.UTC(2000,0,1)||occurredAt>Date.now()+60000||typeof comment!=='string'||comment.length>500)
    throw new HttpError(400,'bad_transfer','Выберите разные счета, положительную сумму, дату не позднее текущей и комментарий до 500 символов');
  return {fromId,toId,amountMinor,occurredAt,comment:comment.trim()};
}
const payload=(p:ReturnType<typeof normalize>)=>JSON.stringify({fromId:p.fromId,toId:p.toId,amountMinor:p.amountMinor,comment:p.comment});
function same(row:any,p:ReturnType<typeof normalize>){const old=JSON.parse(row.payload_json);return row.kind==='transfer'&&row.occurred_at===p.occurredAt&&old.fromId===p.fromId&&old.toId===p.toId&&old.amountMinor===p.amountMinor&&(old.comment??'')===p.comment;}
async function validateAccounts(store:Store,accountId:string,p:ReturnType<typeof normalize>){
  const {profile}=await readProfile(store,accountId);
  if(!profile||![p.fromId,p.toId].every(id=>profile.accounts.some(a=>a.id===id)))throw new HttpError(400,'bad_financial_account','Выберите два своих счёта');
  if(p.occurredAt<Date.parse(profile.balanceDate+'T00:00:00+05:00'))throw new HttpError(400,'bad_transfer_date','Дата перевода раньше начальных остатков');
}
export async function createTransfer(store:Store,accountId:string,body:any){
  if(typeof body?.id!=='string'||!body.id)throw new HttpError(400,'bad_transfer','Нужен идентификатор перевода');
  const id=validateId(body.id),p=normalize(body);
  const read=()=>store.first<any>('SELECT kind,payload_json,occurred_at,deleted_at,version FROM entries WHERE account_id=? AND id=?',accountId,id);
  const duplicate=(row:any)=>{if(!row||row.deleted_at!==null||!same(row,p))throw conflict();return {duplicate:true,version:row.version};};
  const existing=await read();if(existing)return duplicate(existing);await validateAccounts(store,accountId,p);
  const time=Date.now();
  const [result]=await store.batch([store.stmt("INSERT INTO entries(id,account_id,kind,occurred_at,created_at,updated_at,value,payload_json,source,financial_account_id,transfer_to_account_id) VALUES (?,?,'transfer',?,?,?,?,?,'app',?,?) ON CONFLICT(account_id,id) DO NOTHING",id,accountId,p.occurredAt,time,time,-p.amountMinor,payload(p),p.fromId,p.toId)]);
  return result.meta?.changes?{duplicate:false,version:1}:duplicate(await read());
}
export async function listTransfers(store:Store,accountId:string){
  const rows=await store.all<any>("SELECT id,version,occurred_at,payload_json FROM entries WHERE account_id=? AND kind='transfer' AND deleted_at IS NULL ORDER BY occurred_at DESC,id DESC LIMIT 50",accountId);
  return {items:rows.map(row=>({id:row.id,version:row.version,occurredAt:row.occurred_at,comment:'',...JSON.parse(row.payload_json)}))};
}
export async function updateTransfer(store:Store,accountId:string,id:string,body:any){
  const row=await store.first<any>("SELECT * FROM entries WHERE account_id=? AND id=? AND kind='transfer' AND deleted_at IS NULL",accountId,id);
  if(!row)throw new HttpError(404,'not_found','Перевод не найден');const version=requireVersion(body),p=normalize({...JSON.parse(row.payload_json),occurredAt:row.occurred_at,...body});
  // Retrying a lost successful PATCH response is safe, without accepting another edit.
  if(row.version===version+1&&same(row,p))return {ok:true,version:row.version};
  if(row.version!==version)throw conflict();await validateAccounts(store,accountId,p);
  const [r]=await store.batch([store.stmt("UPDATE entries SET payload_json=?,value=?,financial_account_id=?,transfer_to_account_id=?,occurred_at=?,updated_at=?,version=version+1 WHERE account_id=? AND id=? AND kind='transfer' AND version=? AND deleted_at IS NULL",payload(p),-p.amountMinor,p.fromId,p.toId,p.occurredAt,Date.now(),accountId,id,version)]);
  if(!r.meta?.changes)throw conflict();return {ok:true,version:version+1};
}
export async function cancelTransfer(store:Store,accountId:string,id:string,body:any){
  const row=await store.first<any>("SELECT version,deleted_at FROM entries WHERE account_id=? AND id=? AND kind='transfer'",accountId,id);
  if(!row)throw new HttpError(404,'not_found','Перевод не найден');const version=requireVersion(body);
  if(row.deleted_at!==null&&row.version===version+1)return {ok:true};
  if(row.deleted_at!==null||row.version!==version)throw conflict();
  const time=Date.now(),[r]=await store.batch([store.stmt("UPDATE entries SET deleted_at=?,updated_at=?,version=version+1 WHERE account_id=? AND id=? AND kind='transfer' AND version=? AND deleted_at IS NULL",time,time,accountId,id,version)]);
  if(!r.meta?.changes)throw conflict();return {ok:true};
}
