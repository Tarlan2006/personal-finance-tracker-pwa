import { addAccount, call, loginAs, makeEnv } from './helpers';

/** Типичный сеанс: вход → открытие приложения → добавление → импорт → отчёты → Команды. Считает обращения к хранилищу (X-Storage-Ops). */
export async function measureSession() {
  const { env, store } = makeEnv(); await addAccount(store, 'owner');
  const rows: Array<{ step: string; ops: number }> = [];
  const rec = async (step: string, p: Promise<{ headers: Headers }>) => { const r = await p; rows.push({ step, ops: Number(r.headers.get('x-storage-ops')) }); return r as any; };
  const login = await rec('POST /api/auth/login', call(env, 'POST', '/api/auth/login', { body: { login: 'owner', password: 'correct-horse-battery', device: 't' } }));
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  await rec('GET /api/accounts (экран входа)', call(env, 'GET', '/api/accounts'));
  await rec('GET /api/me', call(env, 'GET', '/api/me', { cookie }));
  await rec('GET /api/categories', call(env, 'GET', '/api/categories', { cookie }));
  await rec('GET /api/entries (лента, 100)', call(env, 'GET', '/api/entries', { cookie }));
  await rec('POST /api/entries (добавить)', call(env, 'POST', '/api/entries', { cookie, body: { id: 'ops-entry-0001', direction: 'out', amountMinor: 150000, counterparty: 'Magnum' } }));
  await rec('POST /api/entries (повтор, дубль)', call(env, 'POST', '/api/entries', { cookie, body: { id: 'ops-entry-0001', direction: 'out', amountMinor: 150000, counterparty: 'Magnum' } }));
  await rec('GET /api/reports/summary', call(env, 'GET', '/api/reports/summary', { cookie }));
  const csv = 'Дата;Сумма;Контрагент\n' + Array.from({ length: 200 }, (_, i) => `${String(1 + (i % 28)).padStart(2, '0')}.10.2026;-${100 + i};Контрагент ${i % 20}`).join('\n');
  await rec('POST /api/import (200 строк)', call(env, 'POST', '/api/import', { cookie, body: { csv, mapping: { dateCol: 0, amountCol: 1, counterpartyCol: 2, hasHeader: true } } }));
  const key = (await rec('POST /api/keys', call(env, 'POST', '/api/keys', { cookie, body: { label: 'W', scope: 'write' } }))).data;
  await rec('POST /api/shortcuts/add', call(env, 'POST', '/api/shortcuts/add', { raw: 'amount=500&counterparty=Кофе', headers: { authorization: 'Bearer ' + key.key, 'content-type': 'application/x-www-form-urlencoded' } }));
  return rows;
}
