import {HttpError,type Store} from '../../env';

export function requireConfirmation(body:any,expected:string,login:string|undefined){
 if(body?.confirmation!==expected)throw new HttpError(400,'confirmation_required','Подтвердите удаление в окне подтверждения');
 if(!login||body.accountLogin!==login)throw new HttpError(409,'account_changed','Аккаунт изменился. Обновите страницу перед удалением');
}
export const historySummary=(store:Store,accountId:string)=>store.first(`SELECT
 (SELECT count(*) FROM entries WHERE account_id=? AND deleted_at IS NULL) AS operations,
 (SELECT count(*) FROM entries WHERE account_id=?) AS storedOperations,
 (SELECT count(*) FROM import_batches WHERE account_id=?) AS documents,
 (SELECT count(*) FROM counterparties WHERE account_id=?) AS counterparties`,accountId,accountId,accountId,accountId);

/** One D1 transaction. Preferences, accounts, categories and rules are preserved. */
export async function clearHistory(store:Store,accountId:string){
 const result=await store.batch([
  store.stmt('DELETE FROM entries WHERE account_id=?',accountId),
  store.stmt('DELETE FROM import_batches WHERE account_id=?',accountId),
  store.stmt('DELETE FROM counterparties WHERE account_id=?',accountId),
 ]);
 return {removed:result[0].meta?.changes??0,documents:result[1].meta?.changes??0,counterparties:result[2].meta?.changes??0};
}
