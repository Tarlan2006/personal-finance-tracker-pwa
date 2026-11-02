import { describe, it, expect } from 'vitest';
import { addAccount, call, loginAs, makeEnv } from './helpers';
import { parseAmountMinor, parseDateMs, normName, formatMoney } from '../src/domain/money/normalize';
import { parseCsv } from '../src/domain/money/csv';

async function setup() {
  const e = makeEnv(); await addAccount(e.store, 'owner'); await addAccount(e.store, 'other');
  const o = await loginAs(e.env, 'owner'); const x = await loginAs(e.env, 'other');
  return { ...e, o: o.cookie, x: x.cookie };
}
const catId = async (env: any, cookie: string, name: string) =>
  (await call(env, 'GET', '/api/categories', { cookie })).data.categories.find((c: any) => c.name === name).id;

describe('разбор сумм и дат', () => {
  it('суммы', () => {
    const t: Array<[string, number | null]> = [['1 500,50', 150050], ['1,500.50', 150050], ['-1500', -150000], ['1.500.000', 150000000], ['1500.5 ₸', 150050], ['12 000 ₸', 1200000], ['abc', null], ['', null], ['+2500,00', 250000], ['0,5', 50]];
    for (const [i, o] of t) expect(parseAmountMinor(i), i).toBe(o);
  });
  it('даты', () => {
    expect(parseDateMs('31.10.2026')).toBe(Date.UTC(2026, 9, 31, 7, 0));
    expect(parseDateMs('2026-10-31 14:05')).toBe(Date.UTC(2026, 9, 31, 9, 5));
    expect(parseDateMs('31.02.2026')).toBeNull();
    expect(parseDateMs('мусор')).toBeNull();
  });
  it('нормализация имени и деньги', () => {
    expect(normName('  ИП  «Мирас» ')).toBe('ип мирас');
    expect(formatMoney(150050)).toBe('1 500,50 ₸');
  });
  it('CSV: кавычки, переносы, ;', () => {
    const r = parseCsv('a;b\n"x;1";"два\nстроки"\n');
    expect(r.rows).toEqual([['a', 'b'], ['x;1', 'два\nстроки']]);
  });
});

describe('записи', () => {
  it('идемпотентность по id: повтор не создаёт дубль', async () => {
    const { env, o } = await setup();
    const body = { id: 'client-uuid-0001', direction: 'out', amountMinor: 150000, counterparty: 'Magnum' };
    const a = await call(env, 'POST', '/api/entries', { cookie: o, body });
    const b = await call(env, 'POST', '/api/entries', { cookie: o, body });
    expect(a.status).toBe(201); expect(b.status).toBe(200); expect(b.data.duplicate).toBe(true);
    expect((await call(env, 'GET', '/api/entries', { cookie: o })).data.items.length).toBe(1);
  });
  it('валидация: нулевая сумма, плохое направление, чужая/неверная категория', async () => {
    const { env, o } = await setup();
    expect((await call(env, 'POST', '/api/entries', { cookie: o, body: { direction: 'out', amountMinor: 0 } })).status).toBe(400);
    expect((await call(env, 'POST', '/api/entries', { cookie: o, body: { direction: 'x', amountMinor: 5 } })).status).toBe(400);
    const salary = await catId(env, o, 'Зарплата');
    expect((await call(env, 'POST', '/api/entries', { cookie: o, body: { direction: 'out', amountMinor: 500, categoryId: salary } })).status).toBe(400);
  });
  it('правка с версией, конфликт 409, мягкое удаление и повтор удаления', async () => {
    const { env, o } = await setup();
    const c = (await call(env, 'POST', '/api/entries', { cookie: o, body: { direction: 'out', amountMinor: 1000, counterparty: 'A' } })).data.entry;
    const u = await call(env, 'PATCH', `/api/entries/${c.id}`, { cookie: o, body: { version: 1, amountMinor: 2000 } });
    expect(u.data.entry.payload.amountMinor).toBe(2000); expect(u.data.entry.version).toBe(2);
    expect((await call(env, 'PATCH', `/api/entries/${c.id}`, { cookie: o, body: { version: 1, amountMinor: 3000 } })).status).toBe(409);
    expect((await call(env, 'DELETE', `/api/entries/${c.id}`, { cookie: o })).status).toBe(200);
    expect((await call(env, 'DELETE', `/api/entries/${c.id}`, { cookie: o })).status).toBe(200);
    expect((await call(env, 'GET', '/api/entries', { cookie: o })).data.items.length).toBe(0);
  });
  it('поиск по кириллице и пагинация', async () => {
    const { env, o } = await setup();
    for (let i = 0; i < 5; i++) await call(env, 'POST', '/api/entries', { cookie: o, body: { id: `entry-id-${i}00`, direction: 'out', amountMinor: 100 + i, counterparty: i % 2 ? 'ИП Мирас' : 'Magnum', occurredAt: Date.now() - i * 1000 } });
    expect((await call(env, 'GET', '/api/entries?q=мирас', { cookie: o })).data.items.length).toBe(2);
    const p1 = (await call(env, 'GET', '/api/entries?limit=2', { cookie: o })).data;
    expect(p1.items.length).toBe(2); expect(p1.next).toBeTruthy();
    const p2 = (await call(env, 'GET', `/api/entries?limit=2&beforeTime=${p1.next.beforeTime}&beforeId=${p1.next.beforeId}`, { cookie: o })).data;
    const ids = [...p1.items, ...p2.items].map((e: any) => e.id);
    expect(new Set(ids).size).toBe(4);
  });
  it('пакетная отправка очереди: часть ошибок не ломает остальное', async () => {
    const { env, o } = await setup();
    const r = await call(env, 'POST', '/api/entries/batch', { cookie: o, body: { items: [
      { id: 'batch-id-0001', direction: 'out', amountMinor: 100 }, { id: 'batch-id-0002', direction: 'zzz', amountMinor: 100 }, { id: 'batch-id-0001', direction: 'out', amountMinor: 100 }] } });
    expect(r.data.results.map((x: any) => x.ok)).toEqual([true, false, true]);
    expect(r.data.results[2].duplicate).toBe(true);
  });
});

describe('изоляция аккаунтов', () => {
  it('чужие записи, категории, контрагенты, ключи недоступны ни по одному маршруту', async () => {
    const { env, o, x } = await setup();
    const e = (await call(env, 'POST', '/api/entries', { cookie: o, body: { direction: 'out', amountMinor: 1000, counterparty: 'Секрет' } })).data.entry;
    const cat = await catId(env, o, 'Магазины');
    const key = (await call(env, 'POST', '/api/keys', { cookie: o, body: { label: 'k', scope: 'write' } })).data;
    const cp = (await call(env, 'GET', '/api/counterparties', { cookie: o })).data.counterparties[0];
    const rule = (await call(env, 'POST', '/api/rules', { cookie: o, body: { pattern: 'секрет', categoryId: cat } })).data;
    expect((await call(env, 'GET', '/api/entries', { cookie: x })).data.items).toEqual([]);
    expect((await call(env, 'PATCH', `/api/entries/${e.id}`, { cookie: x, body: { amountMinor: 1 } })).status).toBe(404);
    expect((await call(env, 'DELETE', `/api/entries/${e.id}`, { cookie: x })).status).toBe(404);
    expect((await call(env, 'PATCH', `/api/categories/${cat}`, { cookie: x, body: { name: 'взлом' } })).status).toBe(404);
    expect((await call(env, 'DELETE', `/api/categories/${cat}`, { cookie: x })).status).toBe(404);
    expect((await call(env, 'PUT', `/api/counterparties/${cp.id}`, { cookie: x, body: { categoryOutId: cat } })).status).toBe(404);
    expect((await call(env, 'DELETE', `/api/rules/${rule.id}`, { cookie: x })).status).toBe(404);
    expect((await call(env, 'DELETE', `/api/keys/${key.id}`, { cookie: x })).status).toBe(404);
    expect((await call(env, 'GET', '/api/keys', { cookie: x })).data.keys).toEqual([]);
    expect((await call(env, 'GET', '/api/counterparties', { cookie: x })).data.counterparties).toEqual([]);
    expect((await call(env, 'GET', '/api/export.csv', { cookie: x })).data).not.toContain('Секрет');
    expect(JSON.stringify((await call(env, 'GET', '/api/reports/summary', { cookie: x })).data)).not.toContain('Секрет');
    // чужая категория в записи
    expect((await call(env, 'POST', '/api/entries', { cookie: x, body: { direction: 'out', amountMinor: 5, categoryId: cat } })).status).toBe(400);
    // одинаковый id записи у двух аккаунтов не конфликтует
    const same = { id: 'same-id-12345', direction: 'out', amountMinor: 100 };
    expect((await call(env, 'POST', '/api/entries', { cookie: o, body: same })).status).toBe(201);
    expect((await call(env, 'POST', '/api/entries', { cookie: x, body: same })).status).toBe(201);
  });
  it('без входа все /api (кроме публичных) → 401', async () => {
    const { env } = await setup();
    for (const [m, p] of [['GET', '/api/entries'], ['GET', '/api/categories'], ['GET', '/api/keys'], ['GET', '/api/reports/summary'], ['POST', '/api/import'], ['GET', '/api/export.csv'], ['GET', '/api/devices']])
      expect((await call(env, m, p)).status, p).toBe(401);
  });
});

describe('категории и контрагенты', () => {
  it('привязка контрагента перекатегоризирует всю историю; удаление категории → «Без категории»', async () => {
    const { env, o } = await setup();
    for (let i = 0; i < 5; i++) await call(env, 'POST', '/api/entries', { cookie: o, body: { id: `mir-id-00${i}`, direction: 'out', amountMinor: 240000, counterparty: 'ИП Мирас' } });
    const s0 = (await call(env, 'GET', '/api/reports/summary', { cookie: o })).data;
    expect(s0.uncategorized.count).toBe(5);
    expect(s0.byCounterparty.out[0]).toMatchObject({ display: 'ИП Мирас', count: 5, sum: 1200000 });
    const cp = (await call(env, 'GET', '/api/counterparties?unmapped=1', { cookie: o })).data.counterparties[0];
    const shops = await catId(env, o, 'Магазины');
    await call(env, 'PUT', `/api/counterparties/${cp.id}`, { cookie: o, body: { categoryOutId: shops } });
    const s1 = (await call(env, 'GET', '/api/reports/summary', { cookie: o })).data;
    expect(s1.uncategorized.count).toBe(0);
    expect(s1.byCategory.out[0]).toMatchObject({ name: 'Магазины', sum: 1200000, count: 5 });
    await call(env, 'DELETE', `/api/categories/${shops}`, { cookie: o });
    expect((await call(env, 'GET', '/api/reports/summary', { cookie: o })).data.uncategorized.count).toBe(5);
  });
  it('создание/переименование/дубликат; правило «зарплата» для доходов', async () => {
    const { env, o } = await setup();
    const c = (await call(env, 'POST', '/api/categories', { cookie: o, body: { name: 'Печать', type: 'expense', color: '#112233' } })).data;
    expect((await call(env, 'POST', '/api/categories', { cookie: o, body: { name: 'печать', type: 'expense' } })).status).toBe(409);
    await call(env, 'PATCH', `/api/categories/${c.id}`, { cookie: o, body: { name: 'Типография' } });
    expect((await call(env, 'GET', '/api/categories', { cookie: o })).data.categories.some((x: any) => x.name === 'Типография')).toBe(true);
    const sal = await catId(env, o, 'Зарплата');
    await call(env, 'POST', '/api/rules', { cookie: o, body: { pattern: 'ТОО Ромашка', direction: 'in', categoryId: sal } });
    await call(env, 'POST', '/api/entries', { cookie: o, body: { direction: 'in', amountMinor: 50000000, counterparty: 'ТОО «Ромашка»', note: 'зарплата за октябрь' } });
    const s = (await call(env, 'GET', '/api/reports/summary', { cookie: o })).data;
    expect(s.byCategory.in[0].name).toBe('Зарплата');
  });
});

const CSV = `Дата;Сумма;Контрагент;Описание
01.10.2026;-1 500,00;ИП Мирас;оплата
02.10.2026;-1 500,00;ИП Мирас;оплата
02.10.2026;-1 500,00;ИП Мирас;оплата
03.10.2026;450 000,00;ТОО Ромашка;Зарплата
вчера;100;X;плохая дата
;;;
05.10.2026;abc;Y;плохая сумма
`;
const MAP = { dateCol: 0, amountCol: 1, counterpartyCol: 2, noteCol: 3, hasHeader: true };

describe('импорт: ни одна строка не теряется', () => {
  it('отчёт сходится: imported + duplicates + rejected = total; одинаковые строки внутри файла сохраняются все', async () => {
    const { env, o } = await setup();
    const dry = (await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: MAP, dryRun: true } })).data;
    expect(dry.total).toBe(7); expect(dry.imported).toBe(4); expect(dry.rejected).toBe(3); expect(dry.duplicates).toBe(0);
    expect((await call(env, 'GET', '/api/entries', { cookie: o })).data.items.length).toBe(0);
    const r = (await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: MAP, filename: 'a.csv' } })).data;
    expect(r.imported + r.duplicates + r.rejected).toBe(r.total);
    expect(r.imported).toBe(4);
    expect(r.rows.filter((x: any) => x.status === 'rejected').map((x: any) => x.line)).toEqual([6, 7, 8]);
    const list = (await call(env, 'GET', '/api/entries', { cookie: o })).data.items;
    expect(list.length).toBe(4);
    expect(list.filter((e: any) => e.payload.counterparty === 'ИП Мирас').length).toBe(3);
  });
  it('повторный импорт того же файла → все допустимые строки «дубликат», ничего не добавлено', async () => {
    const { env, o } = await setup();
    await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: MAP } });
    const again = (await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: MAP } })).data;
    expect(again.imported).toBe(0); expect(again.duplicates).toBe(4); expect(again.rejected).toBe(3);
    expect((await call(env, 'GET', '/api/entries', { cookie: o })).data.items.length).toBe(4);
  });
  it('откат импорта убирает записи и разрешает повторный импорт', async () => {
    const { env, o } = await setup();
    const r = (await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: MAP } })).data;
    expect((await call(env, 'DELETE', `/api/import/batches/${r.batchId}`, { cookie: o })).data.removed).toBe(4);
    const again = (await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: MAP } })).data;
    expect(again.imported).toBe(4);
  });
  it('раздельные колонки списание/зачисление и колонка направления', async () => {
    const { env, o } = await setup();
    const a = (await call(env, 'POST', '/api/import', { cookie: o, body: { csv: 'd,out,in\n01.10.2026,100,\n02.10.2026,,250\n03.10.2026,5,6\n', mapping: { dateCol: 0, debitCol: 1, creditCol: 2 } } })).data;
    expect([a.imported, a.rejected]).toEqual([2, 1]);
    const b = (await call(env, 'POST', '/api/import', { cookie: o, body: { csv: 'd,s,t\n01.11.2026,100,Покупка\n02.11.2026,250,Пополнение\n03.11.2026,9,Что-то\n', mapping: { dateCol: 0, amountCol: 1, directionCol: 2, outValues: ['Покупка'], inValues: ['Пополнение'] } } })).data;
    expect([b.imported, b.rejected]).toEqual([2, 1]);
  });
  it('неизвестный профиль отклоняется', async () => {
    const { env, o } = await setup();
    const r = await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: { ...MAP, bank: 'unknown-bank' } } });
    expect(r.status).toBe(400); expect(r.data.error).toBe('profile_not_ready');
  });
  it('отчёт по месяцу и экспорт CSV содержат все импортированные строки', async () => {
    const { env, o } = await setup();
    await call(env, 'POST', '/api/import', { cookie: o, body: { csv: CSV, mapping: MAP } });
    const s = (await call(env, 'GET', '/api/reports/summary?month=2026-10', { cookie: o })).data;
    expect(s.totals).toMatchObject({ out: 450000, in: 45000000, count: 4 });
    const csv = (await call(env, 'GET', '/api/export.csv', { cookie: o })).data as string;
    expect(csv.trim().split('\r\n').length).toBe(5);
  });
  it('CSV-инъекция в экспорте экранируется', async () => {
    const { env, o } = await setup();
    await call(env, 'POST', '/api/entries', { cookie: o, body: { direction: 'out', amountMinor: 100, counterparty: '=HYPERLINK("x")' } });
    expect(((await call(env, 'GET', '/api/export.csv', { cookie: o })).data as string)).toContain("\"'=HYPERLINK");
  });
});

describe('«Команды»: ключи', () => {
  async function keys(env: any, cookie: string) {
    const w = (await call(env, 'POST', '/api/keys', { cookie, body: { label: 'Запись', scope: 'write' } })).data;
    const r = (await call(env, 'POST', '/api/keys', { cookie, body: { label: 'Чтение', scope: 'read' } })).data;
    return { w, r };
  }
  const add = (env: any, key: string, raw: string, extra: Record<string, string> = {}, ct = 'application/x-www-form-urlencoded') =>
    call(env, 'POST', '/api/shortcuts/add', { raw, headers: { authorization: `Bearer ${key}`, 'content-type': ct, ...extra } });

  it('write пишет, повтор с тем же Idempotency-Key не дублирует; form и JSON', async () => {
    const { env, o } = await setup(); const { w } = await keys(env, o);
    const a = await add(env, w.key, 'amount=1500&counterparty=Magnum&direction=расход', { 'idempotency-key': 'shortcut-0001' });
    expect(a.status).toBe(200); expect(a.data).toContain('Записано: расход 1 500 ₸ — Magnum');
    const b = await add(env, w.key, 'amount=1500&counterparty=Magnum', { 'idempotency-key': 'shortcut-0001' });
    expect(b.data).toContain('Уже записано');
    const j = await add(env, w.key, JSON.stringify({ amount: '2 000,50', direction: 'доход', counterparty: 'Друг', category: 'Подарки' }), {}, 'application/json');
    expect(j.data).toContain('доход 2 000,50 ₸');
    expect((await call(env, 'GET', '/api/entries', { cookie: o })).data.items.length).toBe(2);
  });
  it('режим «Форма» из Команд (multipart) тоже принимается', async () => {
    const { env, o } = await setup(); const { w } = await keys(env, o);
    const raw = '--XB\r\nContent-Disposition: form-data; name="amount"\r\n\r\n990\r\n--XB\r\nContent-Disposition: form-data; name="counterparty"\r\n\r\nКофе\r\n--XB--\r\n';
    const r = await add(env, w.key, raw, {}, 'multipart/form-data; boundary=XB');
    expect(r.status).toBe(200); expect(r.data).toContain('Кофе');
  });
  it('write-ключ не читает; read-ключ не пишет; без ключа/мусор/чужой/отозванный → 401', async () => {
    const { env, o, x } = await setup(); const { w, r } = await keys(env, o);
    const sum = (k: string) => call(env, 'GET', '/api/shortcuts/summary', { headers: { authorization: `Bearer ${k}` } });
    expect((await sum(w.key)).status).toBe(403);
    expect((await add(env, r.key, 'amount=5')).status).toBe(403);
    expect((await sum(r.key)).status).toBe(200);
    expect((await call(env, 'GET', '/api/shortcuts/summary')).status).toBe(401);
    expect((await sum('qk_r_' + 'x'.repeat(40))).status).toBe(401);
    expect((await call(env, 'GET', '/api/shortcuts/summary', { cookie: o })).status).toBe(401); // cookie не заменяет ключ
    expect((await call(env, 'GET', '/api/entries', { headers: { authorization: `Bearer ${w.key}` } })).status).toBe(401); // ключ не открывает приложение
    await call(env, 'DELETE', `/api/keys/${r.id}`, { cookie: o });
    expect((await sum(r.key)).status).toBe(401);
    // ключ чужого аккаунта пишет только в свой
    const xk = (await call(env, 'POST', '/api/keys', { cookie: x, body: { label: 'x', scope: 'write' } })).data;
    await add(env, xk.key, 'amount=7&counterparty=Чужой');
    expect((await call(env, 'GET', '/api/entries', { cookie: o })).data.items.length).toBe(0);
  });
  it('ключ хранится хешем, показывается один раз, last_used обновляется', async () => {
    const { env, o, local } = await setup(); const { w } = await keys(env, o);
    expect(JSON.stringify(local.raw.prepare('SELECT * FROM api_keys').all())).not.toContain(w.key.slice(5));
    await add(env, w.key, 'amount=5');
    const list = (await call(env, 'GET', '/api/keys', { cookie: o })).data.keys;
    expect(JSON.stringify(list)).not.toContain(w.key); expect(list.find((k: any) => k.id === w.id).last_used_at).toBeTruthy();
  });
  it('лимит частоты 60/мин → 429 + Retry-After; лимит тела → 413; плохая сумма → 400 текстом', async () => {
    const { env, o } = await setup(); const { w } = await keys(env, o);
    for (let i = 0; i < 60; i++) await add(env, w.key, `amount=1&id=rate-limit-${i}0000`);
    const r = await add(env, w.key, 'amount=1');
    expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBeTruthy(); expect(r.data).toContain('Ошибка');
    const { env: e2, o: o2 } = await setup(); const k2 = (await keys(e2, o2)).w;
    expect((await add(e2, k2.key, 'amount=1&note=' + 'я'.repeat(5000))).status).toBe(413);
    expect((await add(e2, k2.key, 'amount=abc')).status).toBe(400);
  });
  it('сводка читаемым русским текстом', async () => {
    const { env, o } = await setup(); const { w, r } = await keys(env, o);
    await add(env, w.key, 'amount=1500&counterparty=Magnum&category=Магазины');
    const s = await call(env, 'GET', '/api/shortcuts/summary', { headers: { authorization: `Bearer ${r.key}` } });
    expect(s.data).toMatch(/расходы 1 500 ₸/); expect(s.data).toContain('Магазины');
  });
});


describe('аудит импорта: повреждённые и неоднозначные строки', () => {
  it('повреждённый дебет нельзя превращать в доход из кредитной колонки', async () => {
    const {env,o} = await setup();
    const r = await call(env,'POST','/api/import',{cookie:o,body:{csv:'date;debit;credit;name\n01.11.2026;BROKEN;123;TEST',mapping:{dateCol:0,debitCol:1,creditCol:2,counterpartyCol:3}}});
    expect(r.data).toMatchObject({imported:0,rejected:1,total:1});
    expect((await call(env,'GET','/api/entries',{cookie:o})).data.items).toEqual([]);
  });
  it('длинные описания не обрезаются молча и не создают ложных дублей', async () => {
    const {env,o} = await setup();
    const r = await call(env,'POST','/api/import',{cookie:o,body:{csv:'date;amount;name;note\n01.11.2026;-123;TEST;'+ 'X'.repeat(501),mapping:{dateCol:0,amountCol:1,counterpartyCol:2,noteCol:3}}});
    expect(r.data).toMatchObject({imported:0,rejected:1,total:1});
    expect(r.data.rows[0].reason).toContain('слишком длинное');
  });
});


it('аудит: null и массив вместо параметров импорта → 400', async () => {
  const {env,o} = await setup();
  for (const body of [null, []]) expect((await call(env,'POST','/api/import',{cookie:o,body})).status).toBe(400);
});
