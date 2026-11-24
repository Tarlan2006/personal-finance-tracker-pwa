import type {Store} from './env';
const DAY=864e5,LIMIT=100;
/** One bounded transaction after a successful login, at most once per account/day. */
export async function cleanupAfterLogin(store:Store,accountId:string,time=Date.now()){
  const last=await store.first<{updated_at:number}>("SELECT updated_at FROM settings WHERE account_id=? AND key='maintenance'",accountId);
  if(last&&time-last.updated_at<DAY)return;
  const cutoff=new Date(time);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);
  await store.batch([
    store.stmt(`DELETE FROM sessions WHERE account_id=? AND id IN (SELECT id FROM sessions WHERE account_id=? AND (expires_at<? OR revoked_at<?) ORDER BY expires_at,id LIMIT ?)`,accountId,accountId,time-30*DAY,time-30*DAY,LIMIT),
    store.stmt('DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE window_start<? ORDER BY window_start,bucket LIMIT ?)',time-DAY,LIMIT),
    store.stmt(`DELETE FROM import_batches WHERE account_id=? AND id IN (SELECT b.id FROM import_batches b WHERE b.account_id=? AND b.created_at<? AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.account_id=b.account_id AND e.import_id=b.id AND e.deleted_at IS NULL) ORDER BY b.created_at,b.id LIMIT ?)`,accountId,accountId,cutoff.getTime(),LIMIT),
    store.stmt("INSERT INTO settings(account_id,key,value,updated_at) VALUES (?,'maintenance','done',?) ON CONFLICT(account_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",accountId,time),
  ]);
}
