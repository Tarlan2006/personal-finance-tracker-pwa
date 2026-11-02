import { HttpError, Store, type Env } from './env';
import { json, text, readJson, readBody, parseJsonObject, SECURITY_HEADERS, cookie, getCookie } from './util';
import * as auth from './auth';
import { rateLimit } from './ratelimit';
import * as cats from './domain/money/categories';
import * as ent from './domain/money/entries';
import * as imp from './domain/money/import';
import * as cps from './domain/money/counterparties';
import { readProfile, saveProfile } from './domain/money/financial-profile';
import { monthlySummary, unmappedCounterparties } from './domain/money/reports';
import { shortcutAdd, shortcutSummary } from './domain/money/shortcuts';
import { currentMonth } from './domain/money/normalize';

type Ctx = { req: Request; url: URL; store: Store; env: Env; auth: auth.AuthCtx | null; params: string[] };
type Handler = (c: Ctx) => Promise<Response>;
const routes: Array<{ method: string; re: RegExp; h: Handler; mode: 'public' | 'session' | 'key' }> = [];
function route(method: string, path: string, mode: 'public' | 'session' | 'key', h: Handler) {
  routes.push({ method, re: new RegExp('^' + path.replace(/:[a-z]+/g, '([^/]+)') + '$'), h, mode });
}
const acc = (c: Ctx) => c.auth!.accountId;

// ---------- Публичные / аккаунт ----------
route('GET', '/api/health', 'public', async () => json({ ok: true }));
route('GET', '/api/accounts', 'session', async c => json({ accounts: (await c.store.all<any>('SELECT login, display_name FROM accounts WHERE id=? AND disabled=0',acc(c))).map(a => ({ login: a.login, name: a.display_name })) }));
route('POST', '/api/auth/login', 'public', async c => {
  const ip = c.req.headers.get('cf-connecting-ip') ?? 'local';
  await rateLimit(c.store, 'login:' + ip, 30, 10 * 60_000);
  const b = await readJson(c.req, 2048);
  const r = await auth.login(c.store, b.login, b.password, b.device);
  return json({ ok: true, queueKey: r.queueKey }, 200, { 'Set-Cookie': cookie(auth.COOKIE, r.token, auth.SESSION_TTL_MS / 1000) });
});
route('POST', '/api/auth/logout', 'session', async c => {
  await c.store.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', Date.now(), c.auth!.sessionId);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(auth.COOKIE, '', 0) });
});
route('GET', '/api/me', 'session', async c => {
  const a = await c.store.first<any>('SELECT login, display_name, queue_key FROM accounts WHERE id = ?', acc(c));
  return json({ login: a.login, name: a.display_name, queueKey: a.queue_key, sessionId: c.auth!.sessionId });
});
route('POST', '/api/auth/password', 'session', async c => {
  await rateLimit(c.store, 'pw:' + acc(c), 10, 10 * 60_000);
  const b = await readJson(c.req, 2048);
  await auth.changePassword(c.store, acc(c), b.current, b.next, c.auth!.sessionId);
  return json({ ok: true });
});
route('GET', '/api/devices', 'session', async c => json({ devices: await auth.listDevices(c.store, acc(c)), current: c.auth!.sessionId }));
route('DELETE', '/api/devices/:id', 'session', async c => { await auth.revokeSession(c.store, acc(c), c.params[0]); return json({ ok: true }); });
route('GET', '/api/keys', 'session', async c => json({ keys: await auth.listKeys(c.store, acc(c)) }));
route('POST', '/api/keys', 'session', async c => {
  const b = await readJson(c.req, 1024);
  return json(await auth.createKey(c.store, acc(c), b.label, b.scope), 201); // ключ виден только в этом ответе
});
route('DELETE', '/api/keys/:id', 'session', async c => { await auth.revokeKey(c.store, acc(c), c.params[0]); return json({ ok: true }); });

// ---------- Записи ----------
route('GET', '/api/financial-profile', 'session', async c => json(await readProfile(c.store, acc(c))));
route('PUT', '/api/financial-profile', 'session', async c => json(await saveProfile(c.store, acc(c), await readJson(c.req, 32 * 1024))));

route('GET', '/api/entries', 'session', async c => json(await ent.listTx(c.store, acc(c), c.url.searchParams)));
route('POST', '/api/entries', 'session', async c => {
  const b = await readJson(c.req);
  const r = await ent.createTx(c.store, acc(c), b);
  return json(r, r.duplicate ? 200 : 201);
});
route('POST', '/api/entries/batch', 'session', async c => {
  const b = await readJson(c.req, 256 * 1024);
  if (!Array.isArray(b.items) || b.items.length > 50) throw new HttpError(400, 'bad_batch', 'До 50 записей за раз');
  const results = [];
  for (const it of b.items) {
    try { const r = await ent.createTx(c.store, acc(c), it); results.push({ id: r.entry.id, ok: true, duplicate: r.duplicate }); }
    catch (e) { if (e instanceof HttpError && e.status < 500) results.push({ id: it?.id ?? null, ok: false, code: e.code, error: e.message }); else throw e; }
  }
  return json({ results });
});
route('PATCH', '/api/entries/:id', 'session', async c => json({ entry: await ent.updateTx(c.store, acc(c), c.params[0], await readJson(c.req)) }));
route('DELETE', '/api/entries/:id', 'session', async c => { await ent.deleteTx(c.store, acc(c), c.params[0]); return json({ ok: true }); });
route('GET', '/api/export.csv', 'session', async c =>
  new Response(await ent.exportCsv(c.store, acc(c)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="qarjy-export.csv"', 'Cache-Control': 'no-store' } }));

// ---------- Категории, контрагенты, правила ----------
route('GET', '/api/categories', 'session', async c => json({ categories: await cats.listCategories(c.store, acc(c)) }));
route('POST', '/api/categories', 'session', async c => json(await cats.createCategory(c.store, acc(c), await readJson(c.req)), 201));
route('PATCH', '/api/categories/:id', 'session', async c => { await cats.updateCategory(c.store, acc(c), c.params[0], await readJson(c.req)); return json({ ok: true }); });
route('DELETE', '/api/categories/:id', 'session', async c => { await cats.deleteCategory(c.store, acc(c), c.params[0]); return json({ ok: true }); });
route('GET', '/api/counterparties', 'session', async c =>
  json({ counterparties: c.url.searchParams.get('unmapped') ? await unmappedCounterparties(c.store, acc(c)) : await cps.listCounterparties(c.store, acc(c)) }));
route('PUT', '/api/counterparties/:id', 'session', async c => { await cps.setCounterpartyCategory(c.store, acc(c), c.params[0], await readJson(c.req)); return json({ ok: true }); });
route('GET', '/api/rules', 'session', async c => json({ rules: await cps.listRules(c.store, acc(c)) }));
route('POST', '/api/rules', 'session', async c => json(await cps.createRule(c.store, acc(c), await readJson(c.req)), 201));
route('DELETE', '/api/rules/:id', 'session', async c => { await cps.deleteRule(c.store, acc(c), c.params[0]); return json({ ok: true }); });

// ---------- Отчёты, импорт ----------
route('GET', '/api/reports/summary', 'session', async c => json(await monthlySummary(c.store, acc(c), c.url.searchParams.get('month') ?? currentMonth())));
route('GET', '/api/import/profiles', 'session', async () => json({ profiles: Object.entries(imp.BANK_PROFILES).map(([id, p]) => ({ id, title: p.title, ready: p.ready })) }));
route('POST', '/api/import', 'session', async c => {
  await rateLimit(c.store, 'import:' + acc(c), 30, 10 * 60_000);
  const b = await readJson(c.req, 3 * 1024 * 1024);
  return json(await imp.runImport(c.store, acc(c), b));
});
route('GET', '/api/import/batches', 'session', async c => json({ batches: await imp.listBatches(c.store, acc(c)) }));
route('GET', '/api/import/batches/:id', 'session', async c => json(await imp.getBatch(c.store, acc(c), c.params[0])));
route('DELETE', '/api/import/batches/:id', 'session', async c => json(await imp.undoBatch(c.store, acc(c), c.params[0])));

// ---------- «Команды» (ключи) ----------
async function formBody(t: string, ct: string): Promise<Record<string, any>> {
  if (ct.includes('multipart/form-data')) { // режим «Форма» в «Командах» отправляет multipart
    try { const fd = await new Response(t, { headers: { 'content-type': ct } }).formData(); const o: Record<string, any> = {}; fd.forEach((v, k) => { if (typeof v === 'string') o[k] = v; }); return o; }
    catch { throw new HttpError(400, 'bad_form', 'Не удалось разобрать форму'); }
  }
  if (ct.includes('application/json')) return parseJsonObject(t);
  return Object.fromEntries(new URLSearchParams(t));
}
route('POST', '/api/shortcuts/add', 'key', async c => {
  if (c.auth!.keyScope !== 'write') throw new HttpError(403, 'wrong_scope', 'Этот ключ только для чтения, нужен ключ записи');
  await rateLimit(c.store, 'key:' + c.auth!.keyId, 60, 60_000);
  const f = await formBody(await readBody(c.req, 4096), c.req.headers.get('content-type') ?? '');
  return text(await shortcutAdd(c.store, acc(c), f, c.req.headers.get('idempotency-key')));
});
route('GET', '/api/shortcuts/summary', 'key', async c => {
  if (c.auth!.keyScope !== 'read') throw new HttpError(403, 'wrong_scope', 'Этот ключ только для записи, нужен ключ чтения');
  await rateLimit(c.store, 'key:' + c.auth!.keyId, 60, 60_000);
  return text(await shortcutSummary(c.store, acc(c), c.url.searchParams.get('month') ?? undefined));
});

const KEY_MSG: Record<string, string> = { bad_credentials: 'Неверный ключ' };

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const store = new Store(env.DB);
  const url = new URL(req.url);
  const isShortcut = url.pathname.startsWith('/api/shortcuts/');
  try {
    const match = routes.map(r => ({ r, m: r.method === req.method ? r.re.exec(url.pathname) : null })).find(x => x.m);
    if (!match) {
      if (routes.some(r => r.re.test(url.pathname))) throw new HttpError(405, 'method_not_allowed', 'Метод не поддерживается');
      throw new HttpError(404, 'not_found', 'Не найдено');
    }
    const { r, m } = match;
    if(req.method!=='GET'&&(r.mode==='session'||url.pathname==='/api/auth/login')){
      const origin=req.headers.get('origin');
      if(origin&&origin!==url.origin)throw new HttpError(403,'bad_origin','Чужой origin');
      if(req.method!=='DELETE'&&!req.headers.get('content-type')?.includes('json'))throw new HttpError(415,'bad_type','Нужен JSON');
    }
    let a: auth.AuthCtx | null = null;
    if (r.mode === 'session') {
      a = await auth.sessionFromRequest(store, req);
      if (!a) throw new HttpError(401, 'unauthorized', 'Требуется вход');
    } else if (r.mode === 'key') {
      a = await auth.keyFromRequest(store, req);
      if (!a) throw new HttpError(401, 'bad_key', 'Неверный или отозванный ключ');
    }
    let params:string[];try{params=m!.slice(1).map(decodeURIComponent);}catch{throw new HttpError(400,'bad_path','Некорректный адрес');}
    const res = await r.h({ req, url, store, env, auth: a, params });
    res.headers.set('X-Storage-Ops', String(store.ops));
    return res;
  } catch (e) {
    if (e instanceof HttpError) {
      const body = isShortcut ? text(`Ошибка: ${KEY_MSG[e.code] ?? e.message}`, e.status, e.headers) : json({ error: e.code, message: e.message }, e.status, e.headers);
      body.headers.set('X-Storage-Ops', String(store.ops));
      return body;
    }
    console.error('unhandled request failure');
    return json({ error: 'internal', message: 'Внутренняя ошибка' }, 500,{'X-Storage-Ops':String(store.ops)});
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    let res: Response;
    if (url.pathname.startsWith('/api/')) res = await handleApi(req, env);
    else if (env.ASSETS) res = await env.ASSETS.fetch(req);
    else res = new Response('Not found', { status: 404 });
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    if (url.pathname === '/sw.js' || url.pathname === '/index.html' || url.pathname === '/') out.headers.set('Cache-Control', 'no-cache');
    return out;
  },
};
