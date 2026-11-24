import { HttpError, type Store } from '../../env';
import { readProfile } from './financial-profile';
import { monthRange, currentMonth } from './normalize';
function safe(value:number){if(!Number.isSafeInteger(value))throw new HttpError(422,'total_too_large','Остаток превышает точный денежный диапазон');return value;}
export async function walletSummary(store:Store,accountId:string){
  const {profile}=await readProfile(store,accountId);
  if(!profile)return {accounts:[],balanceDate:null,unassigned:0};
  const now=Date.now(),{from,to}=monthRange(currentMonth(now)),balanceFrom=Date.parse(profile.balanceDate+'T00:00:00+05:00');
  // At most configured accounts + one unassigned group leave SQL, never raw history.
  let rows:Array<{id:string|null;delta:string;income:string;expense:string;unassigned:number}>;
  try{rows=await store.all(`WITH configured AS (SELECT value AS id FROM json_each(?)),
    legs AS (
      SELECT financial_account_id AS id,value,occurred_at,kind='tx' AS is_tx FROM entries
      WHERE account_id=? AND kind IN ('tx','transfer') AND deleted_at IS NULL AND occurred_at<=?
      UNION ALL
      SELECT transfer_to_account_id,-value,occurred_at,0 FROM entries
      WHERE account_id=? AND kind='transfer' AND deleted_at IS NULL AND occurred_at<=?
    ), grouped AS (
      SELECT CASE WHEN id IN (SELECT id FROM configured) THEN id ELSE NULL END AS id,value,occurred_at,is_tx FROM legs
    ) SELECT id,
      CAST(SUM(CASE WHEN id IS NOT NULL AND occurred_at>=? THEN value ELSE 0 END) AS TEXT) AS delta,
      CAST(SUM(CASE WHEN id IS NOT NULL AND is_tx AND occurred_at>=? AND occurred_at<? AND value>0 THEN value ELSE 0 END) AS TEXT) AS income,
      CAST(SUM(CASE WHEN id IS NOT NULL AND is_tx AND occurred_at>=? AND occurred_at<? AND value<0 THEN -value ELSE 0 END) AS TEXT) AS expense,
      SUM(CASE WHEN id IS NULL AND is_tx THEN 1 ELSE 0 END) AS unassigned
      FROM grouped GROUP BY id`,JSON.stringify(profile.accounts.map(a=>a.id)),accountId,now,accountId,now,balanceFrom,from,to,from,to);
  }catch(e){if(e instanceof Error&&/integer overflow/i.test(e.message))throw new HttpError(422,'total_too_large','Итоги превышают точный денежный диапазон');throw e;}
  const sums=new Map(rows.map(r=>[r.id,r]));
  return {accounts:profile.accounts.map(a=>{const r=sums.get(a.id);return {...a,balanceMinor:a.openingBalanceMinor===null?null:safe(a.openingBalanceMinor+safe(Number(r?.delta??0))),in:safe(Number(r?.income??0)),out:safe(Number(r?.expense??0))};}),balanceDate:profile.balanceDate,unassigned:sums.get(null)?.unassigned??0};
}
