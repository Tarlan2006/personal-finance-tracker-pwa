import { HttpError, type Store } from '../../env';
import { loadMeta, effectiveCategory } from './meta';
import { monthRange, normName } from './normalize';
import { KIND_TX } from './entries';
import type { TxPayload } from '../../../../shared/types';

interface Agg { sum: number; count: number }
interface CounterpartyAgg extends Agg {
  display: string;
  effectiveCategoryId: string | null;
  uncategorizedCount: number;
}
function add(a:number,b:number){const result=a+b;if(!Number.isSafeInteger(result))throw new HttpError(422,'total_too_large','Итог месяца превышает точный денежный диапазон; проверьте суммы операций');return result;}
export async function monthlySummary(store: Store, accountId: string, month: string, query = new URLSearchParams()) {
  const { from, to } = monthRange(month);
  const rows = await store.all<{ id: string; occurred_at: number; payload_json: string }>(
    'SELECT id, occurred_at, payload_json FROM entries WHERE account_id = ? AND kind = ? AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ?', accountId, KIND_TX, from, to);
  const meta = await loadMeta(store, accountId);
  const selectedCategory = query.get('category');
  const top: Record<'in'|'out', Array<{id: string; occurredAt: number; amountMinor: number; counterparty: string; note: string; categoryId: string|null}>> = {in: [], out: []};
  const totals = { in: 0, out: 0, count: 0 };
  const cat = { in: new Map<string, Agg>(), out: new Map<string, Agg>() };
  const cp = { in: new Map<string, CounterpartyAgg>(), out: new Map<string, CounterpartyAgg>() };
  let uncat = { count: 0, sum: 0 };
  for (const r of rows) {
    const p = JSON.parse(r.payload_json) as TxPayload;
    if (query.has('financialAccountId') && (p.financialAccountId ?? '') !== query.get('financialAccountId')) continue;
    totals[p.direction] = add(totals[p.direction],p.amountMinor); totals.count++;
    const cid = effectiveCategory(meta, p);
    const key = cid ?? '_none';
    const a = cat[p.direction].get(key) ?? { sum: 0, count: 0 }; a.sum = add(a.sum,p.amountMinor); a.count++; cat[p.direction].set(key, a);
    if (!cid) { uncat.count++; uncat.sum = add(uncat.sum,p.amountMinor); }
    if (selectedCategory !== null && key !== selectedCategory) continue;
    top[p.direction].push({ id: r.id, occurredAt: r.occurred_at, amountMinor: p.amountMinor, counterparty: p.counterparty, note: p.note ?? '', categoryId: cid });
    top[p.direction].sort((a,b)=>b.amountMinor-a.amountMinor || b.occurredAt-a.occurredAt || a.id.localeCompare(b.id));
    if (top[p.direction].length > 10) top[p.direction].pop();
    const nk = normName(p.counterparty) || '_none';
    const c = cp[p.direction].get(nk) ?? {
      sum: 0, count: 0, display: p.counterparty || 'Без контрагента', effectiveCategoryId: cid, uncategorizedCount: 0,
    };
    if (c.effectiveCategoryId !== cid) c.effectiveCategoryId = null;
    if (cid === null) c.uncategorizedCount++;
    c.sum = add(c.sum,p.amountMinor); c.count++; cp[p.direction].set(nk, c);
  }
  const catList = (d: 'in' | 'out') => [...cat[d]].map(([id, a]) => {
    const c = meta.cats.get(id);
    return { id: c ? id : null, name: c?.name ?? 'Без категории', color: c?.color ?? '#8e8e93', ...a };
  }).sort((x, y) => y.sum - x.sum);
  const cpList = (d: 'in' | 'out') => [...cp[d]].map(([norm, a]) => ({
    name: norm, ...a,
    // The binding is editable independently of the categories assigned to individual transactions.
    categoryId: (d === 'in' ? meta.cpIn : meta.cpOut).get(norm) ?? null,
  })).sort((x, y) => y.sum - x.sum);
  return {
    selectedCategory, topEntries: top,
    month, totals: { in: totals.in, out: totals.out, net: totals.in - totals.out, count: totals.count },
    byCategory: { out: catList('out'), in: catList('in') },
    byCounterparty: { out: cpList('out'), in: cpList('in') },
    uncategorized: uncat,
  };
}

/** Контрагенты без привязки (очередь «Куда отнести?»), новые сверху. Один SELECT. */
export async function unmappedCounterparties(store: Store, accountId: string) {
  return store.all(
    `SELECT id, display, name_norm, category_out_id, category_in_id FROM counterparties
     WHERE account_id = ? AND category_out_id IS NULL AND category_in_id IS NULL ORDER BY created_at DESC, display LIMIT 300`, accountId);
}
