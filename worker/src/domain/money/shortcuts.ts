import { HttpError, type Store } from '../../env';
import { createTx, validateId } from './entries';
import { monthlySummary } from './reports';
import { currentMonth, formatMoney, normName } from './normalize';
import { listCategories } from './categories';

const OUT = ['out', 'расход', 'трата', 'минус', '-', 'expense'];
const IN = ['in', 'доход', 'приход', 'плюс', '+', 'income'];

export async function shortcutAdd(store: Store, accountId: string, f: Record<string, any>, idemKey: string | null) {
  const dirRaw = normName(f.direction ?? f.type ?? 'out');
  const direction = OUT.includes(dirRaw) ? 'out' : IN.includes(dirRaw) ? 'in' : null;
  if (!direction) throw new HttpError(400, 'bad_direction', 'Не понял направление: укажите «расход» или «доход»');
  const id = validateId(f.id ?? idemKey ?? undefined);
  let categoryId: string | null = null;
  if (f.category) {
    const want = normName(f.category);
    const cats = (await listCategories(store, accountId)) as any[];
    const c = cats.find(c => normName(c.name) === want && c.type === (direction === 'in' ? 'income' : 'expense'));
    if (!c) throw new HttpError(400, 'bad_category', `Нет категории «${f.category}»`);
    categoryId = c.id;
  }
  const { entry, duplicate } = await createTx(store, accountId, {
    id, direction, amount: f.amount, counterparty: f.counterparty ?? f.merchant ?? '', categoryId,
    note: f.note ?? '', occurredAt: f.date || undefined,
  }, 'shortcut');
  const p = entry.payload;
  const word = p.direction === 'in' ? 'доход' : 'расход';
  const who = p.counterparty ? ` — ${p.counterparty}` : '';
  return `${duplicate ? 'Уже записано (повтор): ' : 'Записано: '}${word} ${formatMoney(p.amountMinor)}${who}`;
}

export async function shortcutSummary(store: Store, accountId: string, month?: string) {
  const m = month || currentMonth();
  const s = await monthlySummary(store, accountId, m);
  const top = s.byCategory.out.slice(0, 3).map(c => `${c.name} ${formatMoney(c.sum)}`).join('; ');
  return `${m}: расходы ${formatMoney(s.totals.out)}, доходы ${formatMoney(s.totals.in)}, баланс ${formatMoney(s.totals.net)}.` +
    (top ? ` Больше всего: ${top}.` : '') + (s.uncategorized.count ? ` Без категории: ${s.uncategorized.count}.` : '');
}
