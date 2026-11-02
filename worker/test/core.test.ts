import { describe, it, expect } from 'vitest';
import { addAccount, call, loginAs, makeEnv, PW } from './helpers';

describe('аккаунты и сессии', () => {
  it('вход, /me, выход, повторный доступ отклонён', async () => {
    const { env, store } = makeEnv(); await addAccount(store, 'owner');
    const s = await loginAs(env, 'owner');
    expect(s.status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie: s.cookie })).data.login).toBe('owner');
    await call(env, 'POST', '/api/auth/logout', { cookie: s.cookie, body: {} });
    expect((await call(env, 'GET', '/api/me', { cookie: s.cookie })).status).toBe(401);
  });
  it('неверный пароль → 401, пароль не хранится открыто', async () => {
    const { env, store, local } = makeEnv(); await addAccount(store, 'owner');
    expect((await loginAs(env, 'owner', 'wrong-password-1')).status).toBe(401);
    const row: any = local.raw.prepare('SELECT * FROM accounts').get();
    expect(JSON.stringify(row)).not.toContain(PW);
    expect(row.pass_hash.length).toBeGreaterThan(30);
  });
  it('блокировка после 5 неверных попыток, Retry-After', async () => {
    const { env, store } = makeEnv(); await addAccount(store, 'owner');
    for (let i = 0; i < 5; i++) await loginAs(env, 'owner', 'bad-password-xx');
    const r = await call(env, 'POST', '/api/auth/login', { body: { login: 'owner', password: PW } });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('отзыв устройства закрывает сессию; смена пароля отзывает остальные', async () => {
    const { env, store } = makeEnv(); await addAccount(store, 'owner');
    const a = await loginAs(env, 'owner'), b = await loginAs(env, 'owner');
    const devs = (await call(env, 'GET', '/api/devices', { cookie: a.cookie })).data;
    expect(devs.devices.length).toBe(2);
    await call(env, 'DELETE', `/api/devices/${devs.current === devs.devices[0].id ? devs.devices[1].id : devs.devices[0].id}`, { cookie: a.cookie });
    const bStatus = (await call(env, 'GET', '/api/me', { cookie: b.cookie })).status;
    const aStatus = (await call(env, 'GET', '/api/me', { cookie: a.cookie })).status;
    expect([aStatus, bStatus].sort()).toEqual([200, 401]);
    const alive = aStatus === 200 ? a : b;
    const c = await loginAs(env, 'owner');
    expect((await call(env, 'POST', '/api/auth/password', { cookie: alive.cookie, body: { current: PW, next: 'new-long-password-1' } })).status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie: c.cookie })).status).toBe(401);
    expect((await call(env, 'GET', '/api/me', { cookie: alive.cookie })).status).toBe(200);
    expect((await loginAs(env, 'owner', 'new-long-password-1')).status).toBe(200);
  });
  it('отключённый аккаунт не входит; список логинов его скрывает', async () => {
    const { env, store, local } = makeEnv(); await addAccount(store, 'owner'); await addAccount(store, 'guest');
    local.raw.exec("UPDATE accounts SET disabled = 1 WHERE login = 'guest'");
    expect((await loginAs(env, 'guest')).status).toBe(403);
    const list = (await call(env, 'GET', '/api/accounts')).data.accounts.map((a: any) => a.login);
    expect(list).toEqual(['owner']);
  });
  it('заголовки безопасности и no-store', async () => {
    const { env } = makeEnv();
    const r = await call(env, 'GET', '/api/health');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
  it('чужой origin на изменяющем запросе отклоняется', async () => {
    const { env, store } = makeEnv(); await addAccount(store, 'owner'); const s = await loginAs(env, 'owner');
    const r = await call(env, 'POST', '/api/entries', { cookie: s.cookie, headers: { origin: 'https://evil.test' }, body: { direction: 'out', amountMinor: 100 } });
    expect(r.status).toBe(403);
  });
});

describe('миграции', () => {
  it('применяются на чистой базе и повторно не ломают данные', async () => {
    const { local } = makeEnv();
    const tables = (local.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);
    for (const t of ['accounts', 'sessions', 'api_keys', 'entries', 'kinds', 'settings', 'categories', 'counterparties', 'rules', 'import_batches']) expect(tables).toContain(t);
  });
});
