import { HttpError, type Store } from '../../env';
import { now, uuid } from '../../util';
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

function clean(body: any, partial = false) {
  const out: any = {};
  if (!partial || body.name !== undefined) {
    const n = String(body.name ?? '').trim().slice(0, 40);
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
  const c = clean(body); const id = uuid();
  // lower() в SQLite не знает кириллицу — сравниваем в JS
  const same = await store.all<{ name: string }>('SELECT name FROM categories WHERE account_id=? AND type=? AND deleted_at IS NULL', accountId, c.type);
  if (same.some(x => normName(x.name) === normName(c.name))) throw new HttpError(409, 'exists', 'Такая категория уже есть');
  const max = await store.first<{ m: number | null }>('SELECT MAX(sort) m FROM categories WHERE account_id=?', accountId);
  await store.run('INSERT INTO categories (id, account_id, name, type, color, sort, created_at) VALUES (?,?,?,?,?,?,?)',
    id, accountId, c.name, c.type, c.color ?? '#8e8e93', (max?.m ?? 0) + 1, now());
  return { id, ...c, color: c.color ?? '#8e8e93' };
}
export async function updateCategory(store: Store, accountId: string, id: string, body: any) {
  const c = clean(body, true);
  const sets = Object.keys(c).map(k => `${k} = ?`);
  if (!sets.length) throw new HttpError(400, 'empty', 'Нечего менять');
  const r = await store.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ? AND account_id = ? AND deleted_at IS NULL`, ...Object.values(c), id, accountId);
  if (!r.meta?.changes) throw new HttpError(404, 'not_found', 'Категория не найдена');
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
