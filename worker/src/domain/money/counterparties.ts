import { HttpError, type Store } from '../../env';
import { now, uuid } from '../../util';
import { normName } from './normalize';

export async function setCounterpartyCategory(store: Store, accountId: string, id: string, body: any) {
  const cp = await store.first<any>('SELECT * FROM counterparties WHERE id = ? AND account_id = ?', id, accountId);
  if (!cp) throw new HttpError(404, 'not_found', 'Контрагент не найден');
  const out = body.categoryOutId !== undefined ? body.categoryOutId : cp.category_out_id;
  const inn = body.categoryInId !== undefined ? body.categoryInId : cp.category_in_id;
  for (const [cid, type] of [[out, 'expense'], [inn, 'income']] as const) {
    if (!cid) continue;
    const c = await store.first<{ type: string }>('SELECT type FROM categories WHERE id = ? AND account_id = ? AND deleted_at IS NULL', cid, accountId);
    if (!c || c.type !== type) throw new HttpError(400, 'bad_category', 'Категория не найдена или не того типа');
  }
  await store.run('UPDATE counterparties SET category_out_id = ?, category_in_id = ? WHERE id = ? AND account_id = ?', out || null, inn || null, id, accountId);
}
export const listCounterparties = (store: Store, accountId: string) =>
  store.all('SELECT id, display, name_norm, category_out_id, category_in_id FROM counterparties WHERE account_id = ? ORDER BY display LIMIT 2000', accountId);

export async function createRule(store: Store, accountId: string, body: any) {
  const pattern = normName(body.pattern ?? '');
  if (pattern.length < 2) throw new HttpError(400, 'bad_pattern', 'Шаблон не короче 2 символов');
  const direction = ['in', 'out', 'any'].includes(body.direction) ? body.direction : 'any';
  const c = await store.first<{ type: string }>('SELECT type FROM categories WHERE id = ? AND account_id = ? AND deleted_at IS NULL', body.categoryId, accountId);
  if (!c) throw new HttpError(400, 'bad_category', 'Категория не найдена');
  const id = uuid();
  await store.run('INSERT INTO rules (id, account_id, pattern, direction, category_id, created_at) VALUES (?,?,?,?,?,?)', id, accountId, pattern, direction, body.categoryId, now());
  return { id, pattern, direction, categoryId: body.categoryId };
}
export const listRules = (store: Store, accountId: string) =>
  store.all('SELECT id, pattern, direction, category_id AS categoryId FROM rules WHERE account_id = ? ORDER BY created_at', accountId);
export async function deleteRule(store: Store, accountId: string, id: string) {
  const r = await store.run('DELETE FROM rules WHERE id = ? AND account_id = ?', id, accountId);
  if (!r.meta?.changes) throw new HttpError(404, 'not_found', 'Правило не найдено');
}
