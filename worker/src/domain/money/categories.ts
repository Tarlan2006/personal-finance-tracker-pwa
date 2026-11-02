import { HttpError, type Store } from '../../env';
import { now, uuid, sha256 } from '../../util';
import { normName } from './normalize';

export const DEFAULT_CATEGORIES: Array<{ name: string; type: 'expense' | 'income'; color: string }> = [
  { name: 'Магазины', type: 'expense', color: '#34c759' },
  { name: 'Кафе и рестораны', type: 'expense', color: '#ff9f0a' },
  { name: 'Транспорт', type: 'expense', color: '#0a84ff' },
  { name: 'Связь и интернет', type: 'expense', color: '#5e5ce6' },
  { name: 'Здоровье', type: 'expense', color: '#ff453a' },
  { name: 'Развлечения', type: 'expense', color: '#bf5af2' },
  { name: 'Другое', type: 'expense', color: '#8e8e93' },
  { name: 'Зарплата', type: 'income', color: '#30d158' },
  { name: 'Переводы', type: 'income', color: '#64d2ff' },
  { name: 'Подарки', type: 'income', color: '#ff375f' },
  { name: 'Возврат долга', type: 'income', color: '#ffd60a' },
  { name: 'Другие доходы', type: 'income', color: '#8e8e93' },
];

/** Стартовые правила для доходов: слова в описании → категория. Пользователь может удалить или добавить свои. */
export const DEFAULT_RULES: Array<{ pattern: string; category: string }> = [
  { pattern: 'зарплат', category: 'Зарплата' }, { pattern: 'заработн', category: 'Зарплата' }, { pattern: 'salary', category: 'Зарплата' },
];

export async function seedDefaultCategories(store: Store, accountId: string) {
  const t = now(); const ids = new Map<string, string>();
  const stmts = DEFAULT_CATEGORIES.map((c, i) => { const id = uuid(); ids.set(c.name, id); return store.stmt('INSERT INTO categories (id, account_id, name, type, color, sort, created_at) VALUES (?,?,?,?,?,?,?)', id, accountId, c.name, c.type, c.color, i, t); });
  for (const r of DEFAULT_RULES) stmts.push(store.stmt('INSERT INTO rules (id, account_id, pattern, direction, category_id, created_at) VALUES (?,?,?,?,?,?)', uuid(), accountId, r.pattern, 'in', ids.get(r.category)!, t));
  await store.batch(stmts);
}

export const listCategories = (store: Store, accountId: string) =>
  store.all('SELECT id, name, type, color, sort FROM categories WHERE account_id = ? AND deleted_at IS NULL ORDER BY type DESC, sort, name', accountId);

type CategoryNameRow={id:string;name:string;type:string;deleted_at:number|null};
const nameSnapshotSQL='(SELECT json_group_array(json_array(id,name,type,deleted_at)) FROM (SELECT id,name,type,deleted_at FROM categories WHERE account_id=? ORDER BY id))';
const nameSnapshot=(rows:CategoryNameRow[])=>JSON.stringify(rows.map(r=>[r.id,r.name,r.type,r.deleted_at]));
const categoryNames=(store:Store,accountId:string)=>store.all<CategoryNameRow>('SELECT id,name,type,deleted_at FROM categories WHERE account_id=? ORDER BY id',accountId);

function clean(body: any, partial = false) {
  const out: any = {};
  if (!partial || body.name !== undefined) {
    if(typeof body.name!=='string'||body.name.trim().length>40)throw new HttpError(400,'bad_name','Название категории: до 40 символов');
    const n = body.name.trim();
    if (!n) throw new HttpError(400, 'bad_name', 'Название категории пустое');
    out.name = n;
  }
  if (!partial || body.type !== undefined) {
    if (body.type !== 'expense' && body.type !== 'income') throw new HttpError(400, 'bad_type', 'Тип: expense или income');
    out.type = body.type;
  }
  if (body.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(body.color))) throw new HttpError(400, 'bad_color', 'Цвет в формате #rrggbb');
    out.color = body.color;
  }
  return out;
}

export async function createCategory(store: Store, accountId: string, body: any) {
  const c = clean(body);
  // lower() в SQLite не знает кириллицу — сравниваем в JS
  const same = await categoryNames(store,accountId);
  if (same.some(x => x.deleted_at===null&&x.type===c.type&&normName(x.name) === normName(c.name))) throw new HttpError(409, 'exists', 'Такая категория уже есть');
  // Concurrent equal names allocate the same free id. Deleted/renamed ids are
  // never reused, so recreating a category cannot revive old classifications.
  const occupied=new Set(same.map(x=>x.id));let ordinal=0,id:string;
  do{id='cat_'+await sha256(`${accountId}|${c.type}|${normName(c.name)}|${ordinal++}`);}while(occupied.has(id));
  const max = await store.first<{ m: number | null }>('SELECT MAX(sort) m FROM categories WHERE account_id=?', accountId);
  const result=await store.run(`INSERT INTO categories (id, account_id, name, type, color, sort, created_at) SELECT ?,?,?,?,?,?,? WHERE ${nameSnapshotSQL}=? ON CONFLICT(id) DO NOTHING`,
    id, accountId, c.name, c.type, c.color ?? '#8e8e93', (max?.m ?? 0) + 1, now(),accountId,nameSnapshot(same));
  if(!result.meta?.changes)throw new HttpError(409,'category_conflict','Список категорий изменился; обновите список и повторите');
  return { id, ...c, color: c.color ?? '#8e8e93' };
}
export async function updateCategory(store: Store, accountId: string, id: string, body: any) {
  const c = clean(body, true);
  const sets = Object.keys(c).map(k => `${k} = ?`);
  if (!sets.length) throw new HttpError(400, 'empty', 'Нечего менять');
  const rows=await categoryNames(store,accountId);
  const current=rows.find(r=>r.id===id&&r.deleted_at===null);
  if(!current)throw new HttpError(404,'not_found','Категория не найдена');
  const others=rows.filter(r=>r.id!==id&&r.type===(c.type??current.type)&&r.deleted_at===null);
  if(others.some(x=>normName(x.name)===normName(c.name??current.name)))throw new HttpError(409,'exists','Такая категория уже есть');
  const r = await store.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ? AND account_id = ? AND deleted_at IS NULL AND ${nameSnapshotSQL}=?`, ...Object.values(c), id, accountId,accountId,nameSnapshot(rows));
  if (!r.meta?.changes) throw new HttpError(409, 'category_conflict', 'Список категорий изменился; обновите список и повторите');
}
/** Мягкое удаление: записи остаются, становятся «без категории». Привязки и правила на неё снимаются. */
export async function deleteCategory(store: Store, accountId: string, id: string) {
  const res = await store.batch([
    store.stmt('UPDATE categories SET deleted_at = ? WHERE id = ? AND account_id = ? AND deleted_at IS NULL', now(), id, accountId),
    store.stmt('UPDATE counterparties SET category_out_id = NULL WHERE account_id = ? AND category_out_id = ?', accountId, id),
    store.stmt('UPDATE counterparties SET category_in_id = NULL WHERE account_id = ? AND category_in_id = ?', accountId, id),
    store.stmt('DELETE FROM rules WHERE account_id = ? AND category_id = ?', accountId, id),
  ]);
  if (!res[0].meta?.changes) throw new HttpError(404, 'not_found', 'Категория не найдена');
}
