// Офлайн-очередь: IndexedDB, идемпотентные id, видимая причина сбоя, backoff с jitter и Retry-After.
// При выходе очередь шифруется (AES-GCM) ключом аккаунта, который сервер отдаёт только после входа.
import { api, ApiError } from './api';

export interface QItem { id: string; login: string; payload: any; createdAt: number; attempts: number; status: 'pending' | 'failed'; lastError?: string }
export interface QStatus { count: number; failed: number; lastAttemptAt: number | null; lastResult: string; nextAttemptAt: number | null; online: boolean }

const DB = 'qarjy-queue';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const r = f(t.objectStore(store));
    t.oncomplete = () => { db.close(); res((r as IDBRequest<T>)?.result as T); }; t.onerror = () => { db.close(); rej(t.error); };
  });
}
const getAll = (): Promise<QItem[]> => tx('queue', 'readonly', s => s.getAll());
const put = (i: QItem) => tx('queue', 'readwrite', s => { s.put(i); });
const del = (id: string) => tx('queue', 'readwrite', s => { s.delete(id); });
const metaGet = (k: string): Promise<any> => tx('meta', 'readonly', s => s.get(k));
const metaPut = (k: string, v: unknown) => tx('meta', 'readwrite', s => { s.put(v, k); });

let status: QStatus = { count: 0, failed: 0, lastAttemptAt: null, lastResult: 'ещё не отправляли', nextAttemptAt: null, online: typeof navigator === 'undefined' ? true : navigator.onLine };
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export const subscribeQueue = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getQueueStatus = () => status;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let currentLogin: string | null = null;

export const listQueue = async (login: string) => (await getAll()).filter(i => i.login === login).sort((a, b) => b.createdAt - a.createdAt);
async function refresh(login: string) {
  const items = await listQueue(login);
  status = { ...status, count: items.length, failed: items.filter(i => i.status === 'failed').length, online: navigator.onLine }; emit();
}

export async function enqueue(login: string, payload: any): Promise<QItem> {
  const item: QItem = { id: payload.id ?? crypto.randomUUID(), login, payload: { ...payload }, createdAt: Date.now(), attempts: 0, status: 'pending' };
  item.payload.id = item.id;
  await put(item); await refresh(login); flush(login);
  return item;
}
export async function removeFromQueue(login: string, id: string) { await del(id); await refresh(login); }
export async function retryFailed(login: string) {
  for (const i of await listQueue(login)) if (i.status === 'failed') await put({ ...i, status: 'pending', lastError: undefined });
  await refresh(login); flush(login);
}

export function startQueue(login: string) {
  currentLogin = login; refresh(login);
  flush(login);
}
const onOnline = () => { if (currentLogin) flush(currentLogin); };
const onVisible = () => { if (document.visibilityState === 'visible' && currentLogin) flush(currentLogin); };
if (typeof window !== 'undefined') {
  window.addEventListener('online', onOnline); window.addEventListener('offline', () => { status = { ...status, online: false }; emit(); });
  document.addEventListener('visibilitychange', onVisible);
}

function schedule(login: string, delayMs: number) {
  if (timer) clearTimeout(timer);
  const jitter = delayMs * (0.15 * Math.random());
  const at = Date.now() + delayMs + jitter;
  status = { ...status, nextAttemptAt: at }; emit();
  timer = setTimeout(() => { timer = null; flush(login); }, delayMs + jitter);
}
let backoff = 5000;

/** Отправляет очередь пачками по 50 через /api/entries/batch. Без постоянного опроса: следующая попытка только после сбоя. */
export async function flush(login: string): Promise<void> {
  if (flushing) return; flushing = true;
  try {
    const items = (await listQueue(login)).filter(i => i.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    if (!items.length) { status = { ...status, nextAttemptAt: null }; await refresh(login); return; }
    if (!navigator.onLine) { status = { ...status, lastResult: 'нет сети — отправим при возвращении онлайн' }; emit(); return; }
    status = { ...status, lastAttemptAt: Date.now() }; emit();
    for (let i = 0; i < items.length; i += 50) {
      const chunk = items.slice(i, i + 50);
      const r: { results: Array<{ id: string; ok: boolean; duplicate?: boolean; error?: string }> } = await api('POST', '/api/entries/batch', { items: chunk.map(c => c.payload) });
      for (const res of r.results) {
        const it = chunk.find(c => c.id === res.id); if (!it) continue;
        if (res.ok) await del(it.id); else await put({ ...it, attempts: it.attempts + 1, status: 'failed', lastError: res.error ?? 'отклонено сервером' });
      }
    }
    backoff = 5000;
    status = { ...status, lastResult: 'успешно', nextAttemptAt: null };
  } catch (e) {
    const err = e as ApiError;
    const wait = err.status === 429 ? Math.max(err.retryAfter, 1) * 1000 : err.status === 401 ? 0 : backoff;
    status = { ...status, lastResult: err.status === 401 ? 'нужен вход' : `${err.message}${err.status ? ` (${err.status})` : ''}` };
    if (err.status !== 401 && (err.retryable ?? true)) { schedule(login, wait); backoff = Math.min(backoff * 2, 15 * 60_000); }
    for (const i of await listQueue(login)) if (i.status === 'pending') await put({ ...i, attempts: i.attempts + 1, lastError: err.message });
  } finally { flushing = false; await refresh(login); }
}

// ---- шифрование при выходе ----
async function aesKey(queueKey: string) {
  const raw = Uint8Array.from(atob(queueKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).slice(0, 32);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealQueue(login: string, queueKey: string) {
  if (timer) { clearTimeout(timer); timer = null; }
  const items = await listQueue(login);
  if (!items.length) { await tx('meta', 'readwrite', s => { s.delete('sealed:' + login); }); return 0; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(queueKey), new TextEncoder().encode(JSON.stringify(items)));
  await metaPut('sealed:' + login, { iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) });
  for (const i of items) await del(i.id);
  currentLogin = null; status = { ...status, count: 0, failed: 0, nextAttemptAt: null }; emit();
  return items.length;
}
export async function unsealQueue(login: string, queueKey: string) {
  const blob = await metaGet('sealed:' + login); if (!blob) return 0;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(blob.iv) }, await aesKey(queueKey), new Uint8Array(blob.ct));
    const items: QItem[] = JSON.parse(new TextDecoder().decode(pt));
    for (const i of items) await put(i);
    await tx('meta', 'readwrite', s => { s.delete('sealed:' + login); });
    return items.length;
  } catch { return 0; }
}
export const rawQueueDump = async () => JSON.stringify(await getAll()); // для тестов: убедиться, что открытого текста нет
