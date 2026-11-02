export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter = 0) { super(message); }
  get network() { return this.status === 0; }
  get retryable() { return this.status === 0 || this.status === 429 || this.status >= 500; }
}
let pausedUntil = 0;
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f; };
const inflight = new Map<string, Promise<any>>();

async function doFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (Date.now() < pausedUntil && !path.startsWith('/api/auth/login')) {
    throw new ApiError(429, 'paused', 'Сервер просит подождать', Math.ceil((pausedUntil - Date.now()) / 1000));
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined, credentials: 'same-origin', cache: 'no-store' });
  } catch { throw new ApiError(0, 'network', 'Нет связи с сервером'); }
  if (res.ok && method !== 'GET') inflight.clear(); // Reads started before a mutation must not satisfy a later refresh.
  if (res.ok) return (res.headers.get('content-type')?.includes('json') ? res.json() : res.text()) as Promise<T>;
  let data: any = {}; try { data = await res.json(); } catch {}
  const retry = Number(res.headers.get('retry-after') ?? 0);
  if (res.status === 429 && retry) pausedUntil = Date.now() + retry * 1000;
  if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized();
  throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Ошибка ${res.status}`, retry);
}
/** GET-запросы с одинаковым путём, идущие одновременно, объединяются в один сетевой вызов. */
export function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== 'GET') return doFetch<T>(method, path, body);
  const hit = inflight.get(path); if (hit) return hit;
  const p: Promise<T> = doFetch<T>(method, path).finally(() => { if (inflight.get(path) === p) inflight.delete(path); });
  inflight.set(path, p); return p;
}
export const pauseRemainingSec = () => Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000));
