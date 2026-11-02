import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalD1 } from '../dev/sqlite-d1';
import { Store, type Env } from '../src/env';
import { createAccount } from '../src/auth';
import { seedDefaultCategories } from '../src/domain/money/categories';
import worker from '../src/index';

export const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');
export const PW = 'correct-horse-battery';

export function makeEnv() {
  const l = createLocalD1(':memory:', MIGRATIONS);
  const env: Env = { DB: l.db };
  return { env, local: l, store: new Store(l.db) };
}
export async function addAccount(store: Store, login: string, password = PW) {
  const id = await createAccount(store, login, login.toUpperCase(), password);
  await seedDefaultCategories(store, id);
  return id;
}
export async function call(env: Env, method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: string | undefined = opts.raw;
  if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['content-type'] = 'application/json'; }
  else if (method !== 'GET' && method !== 'DELETE' && !headers['content-type'] && opts.raw === undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await worker.fetch(new Request('https://t.test' + path, { method, headers, body }), env);
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data: data as any, headers: res.headers };
}
export async function loginAs(env: Env, login: string, password = PW) {
  const r = await call(env, 'POST', '/api/auth/login', { body: { login, password, device: 'test' } });
  const sc = r.headers.get('set-cookie') ?? '';
  return { status: r.status, cookie: sc.split(';')[0], data: r.data };
}
