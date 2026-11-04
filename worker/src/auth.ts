import { HttpError, type Store } from './env';
import { getCookie, hashPassword, now, randomToken, sha256, timingSafeEqual, uuid, b64, PBKDF2_ITER } from './util';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const COOKIE = 'qs';
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface AuthCtx { accountId: string; sessionId: string | null; accountLogin?:string; keyScope?: 'write' | 'read'; keyId?: string }

export async function createAccount(store: Store, login: string, displayName: string, password: string) {
  if (!/^[a-z0-9_.-]{2,32}$/.test(login)) throw new HttpError(400, 'bad_login', 'Логин: 2–32 символа a-z 0-9 _ . -');
  checkPasswordStrength(password);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const id = uuid(); const t = now();
  await store.run(
    `INSERT INTO accounts (id, login, display_name, pass_hash, pass_salt, pass_iter, queue_key, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, login, displayName, await hashPassword(password, salt), salt, PBKDF2_ITER, randomToken(32), t, t);
  return id;
}
export function checkPasswordStrength(p: string) {
  if (typeof p !== 'string' || p.length < 10) throw new HttpError(400, 'weak_password', 'Пароль не короче 10 символов');
}

export async function listLogins(store: Store) {
  return store.all<{ login: string; display_name: string }>('SELECT login, display_name FROM accounts WHERE disabled = 0 ORDER BY login');
}

/** Public login picker: only explicitly configured, enabled accounts; no account IDs. */
export async function loginOptions(store: Store, configured?: string) {
  const logins=[...new Set((configured??'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>/^[a-z0-9_.-]{2,32}$/.test(s)))].slice(0,30);
  if(!logins.length)return [];
  const rows=await store.all<{login:string;display_name:string}>(
    'SELECT login, display_name FROM accounts WHERE disabled=0 AND login IN (SELECT value FROM json_each(?))',JSON.stringify(logins));
  return logins.flatMap(login=>{const row=rows.find(r=>r.login===login);return row?[{login:row.login,name:row.display_name}]:[];});
}

export async function login(store: Store, loginName: string, password: string, device: string) {
  const acc = await store.first<any>('SELECT * FROM accounts WHERE login = ?', String(loginName));
  const t = now();
  const fail = () => new HttpError(401, 'bad_credentials', 'Неверный логин или пароль');
  if (!acc) { await hashPassword(password || 'x', 'AAAAAAAAAAAAAAAAAAAAAA'); throw fail(); } // выравниваем время
  if (acc.disabled) throw new HttpError(403, 'disabled', 'Аккаунт отключён');
  if (acc.locked_until > t) {
    throw new HttpError(429, 'locked', 'Слишком много попыток, вход временно заблокирован',
      { 'Retry-After': String(Math.ceil((acc.locked_until - t) / 1000)) });
  }
  const h = await hashPassword(String(password ?? ''), acc.pass_salt, acc.pass_iter);
  if (!timingSafeEqual(h, acc.pass_hash)) {
    const fails = acc.failed_count + 1;
    const lock = fails >= MAX_FAILS ? t + LOCK_MS : 0;
    await store.run('UPDATE accounts SET failed_count = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock, acc.id);
    throw fail();
  }
  if (acc.failed_count) await store.run('UPDATE accounts SET failed_count = 0, locked_until = 0 WHERE id = ?', acc.id);
  const token = randomToken(32);
  const sid = uuid();
  await store.run(
    `INSERT INTO sessions (id, account_id, token_hash, device_label, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?)`,
    sid, acc.id, await sha256(token), String(device || 'Устройство').slice(0, 60), t, t, t + SESSION_TTL_MS);
  return { token, accountId: acc.id as string, sessionId: sid, queueKey: acc.queue_key as string };
}

/** Сессия по cookie. Обновляет last_seen не чаще раза в час (экономия записей). */
export async function sessionFromRequest(store: Store, req: Request): Promise<AuthCtx | null> {
  const tok = getCookie(req, COOKIE); if (!tok) return null;
  const s = await store.first<any>(
    `SELECT s.id, s.account_id, s.last_seen_at, s.expires_at, s.revoked_at, a.disabled, a.login FROM sessions s
     JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?`, await sha256(tok));
  const t = now();
  if (!s || s.revoked_at || s.expires_at < t || s.disabled) return null;
  if (t - s.last_seen_at > 3600_000) await store.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', t, s.id);
  return { accountId: s.account_id, sessionId: s.id,accountLogin:s.login };
}

const KEY_RE = /^qk_(w|r)_[A-Za-z0-9_-]{30,}$/;
export async function keyFromRequest(store: Store, req: Request): Promise<AuthCtx | null> {
  const auth = req.headers.get('authorization') ?? '';
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.headers.get('x-api-key') ?? '').trim();
  if (!raw || !KEY_RE.test(raw)) return null;
  const k = await store.first<any>(
    `SELECT k.id, k.account_id, k.scope, k.last_used_at, k.revoked_at, a.disabled FROM api_keys k
     JOIN accounts a ON a.id = k.account_id WHERE k.key_hash = ?`, await sha256(raw));
  if (!k || k.revoked_at || k.disabled) return null;
  const t = now();
  if (!k.last_used_at || t - k.last_used_at > 60_000) await store.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', t, k.id);
  return { accountId: k.account_id, sessionId: null, keyScope: k.scope, keyId: k.id };
}

export async function createKey(store: Store, accountId: string, label: string, scope: 'write' | 'read') {
  if (scope !== 'write' && scope !== 'read') throw new HttpError(400, 'bad_scope', 'Тип ключа: write или read');
  label = String(label ?? '').trim().slice(0, 40);
  if (!label) throw new HttpError(400, 'bad_label', 'Укажите метку ключа');
  const n = await store.first<{ c: number }>('SELECT COUNT(*) c FROM api_keys WHERE account_id = ? AND revoked_at IS NULL', accountId);
  if ((n?.c ?? 0) >= 20) throw new HttpError(409, 'too_many_keys', 'Не больше 20 активных ключей');
  const raw = `qk_${scope === 'write' ? 'w' : 'r'}_${randomToken(30)}`;
  const id = uuid();
  await store.run(`INSERT INTO api_keys (id, account_id, label, scope, key_hash, prefix, created_at) VALUES (?,?,?,?,?,?,?)`,
    id, accountId, label, scope, await sha256(raw), raw.slice(0, 9), now());
  return { id, key: raw, label, scope };
}
export const listKeys = (store: Store, accountId: string) =>
  store.all('SELECT id, label, scope, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE account_id = ? ORDER BY created_at DESC', accountId);
export async function revokeKey(store: Store, accountId: string, id: string) {
  const r = await store.run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL', now(), id, accountId);
  if (!(r.meta?.changes)) throw new HttpError(404, 'not_found', 'Ключ не найден');
}

export const listDevices = (store: Store, accountId: string) =>
  store.all('SELECT id, device_label, created_at, last_seen_at FROM sessions WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC', accountId, now());
export async function revokeSession(store: Store, accountId: string, id: string) {
  const r = await store.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL', now(), id, accountId);
  if (!(r.meta?.changes)) throw new HttpError(404, 'not_found', 'Устройство не найдено');
}
export async function changePassword(store: Store, accountId: string, current: string, next: string, keepSessionId: string | null) {
  checkPasswordStrength(next);
  const acc = await store.first<any>('SELECT * FROM accounts WHERE id = ?', accountId);
  if (!acc || !timingSafeEqual(await hashPassword(String(current ?? ''), acc.pass_salt, acc.pass_iter), acc.pass_hash))
    throw new HttpError(403, 'bad_credentials', 'Текущий пароль неверен');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const t = now();
  await store.batch([
    store.stmt('UPDATE accounts SET pass_hash=?, pass_salt=?, pass_iter=?, updated_at=? WHERE id=?', await hashPassword(next, salt), salt, PBKDF2_ITER, t, accountId),
    store.stmt('UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL AND id != ?', t, accountId, keepSessionId ?? ''),
  ]);
}
