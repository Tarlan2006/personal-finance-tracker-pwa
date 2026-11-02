import type { Store } from '../../env';
import { normName } from './normalize';
import type { Direction } from '../../../../shared/types';

export interface Meta {
  cats: Map<string, { id: string; name: string; type: 'expense' | 'income'; color: string }>;
  cpOut: Map<string, string>; cpIn: Map<string, string>;
  rules: Array<{ pattern: string; direction: 'in' | 'out' | 'any'; categoryId: string }>;
}

/** Категории + привязки контрагентов + правила — одним обращением к хранилищу (batch из трёх SELECT). */
export async function loadMeta(store: Store, accountId: string): Promise<Meta> {
  const [c, cp, r] = await store.batch([
    store.stmt('SELECT id, name, type, color FROM categories WHERE account_id = ? AND deleted_at IS NULL', accountId),
    store.stmt('SELECT name_norm, category_out_id, category_in_id FROM counterparties WHERE account_id = ? AND (category_out_id IS NOT NULL OR category_in_id IS NOT NULL)', accountId),
    store.stmt('SELECT pattern, direction, category_id FROM rules WHERE account_id = ? ORDER BY created_at', accountId),
  ]);
  const m: Meta = { cats: new Map(), cpOut: new Map(), cpIn: new Map(), rules: [] };
  for (const x of c.results as any[]) m.cats.set(x.id, x);
  for (const x of cp.results as any[]) {
    if (x.category_out_id) m.cpOut.set(x.name_norm, x.category_out_id);
    if (x.category_in_id) m.cpIn.set(x.name_norm, x.category_in_id);
  }
  for (const x of r.results as any[]) m.rules.push({ pattern: normName(x.pattern), direction: x.direction, categoryId: x.category_id });
  return m;
}

/** Явная категория записи → привязка контрагента → правило по подстроке → null. Вычисляется при чтении, поэтому смена привязки сразу перекатегоризирует историю. */
export function effectiveCategory(meta: Meta, p: { direction: Direction; counterparty: string; note?: string; categoryId?: string | null }): string | null {
  const want = p.direction === 'in' ? 'income' : 'expense';
  const ok = (id?: string | null) => (id && meta.cats.get(id)?.type === want ? id : null);
  const explicit = ok(p.categoryId); if (explicit) return explicit;
  const norm = normName(p.counterparty);
  const mapped = ok((p.direction === 'in' ? meta.cpIn : meta.cpOut).get(norm)); if (mapped) return mapped;
  const hay = norm + ' ' + normName(p.note ?? '');
  for (const r of meta.rules) {
    if (r.direction !== 'any' && r.direction !== p.direction) continue;
    if (r.pattern && hay.includes(r.pattern) && ok(r.categoryId)) return r.categoryId;
  }
  return null;
}
