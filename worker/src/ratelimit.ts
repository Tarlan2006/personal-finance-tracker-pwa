import { HttpError, type Store } from './env';
import { now } from './util';

/** Фиксированное окно в D1. Одно обращение на проверку. */
export async function rateLimit(store: Store, bucket: string, limit: number, windowMs: number): Promise<void> {
  const t = now();
  const start = t - (t % windowMs);
  const row = await store.first<{ count: number }>(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`, bucket, start);
  if ((row?.count ?? 1) > limit) {
    const retry = Math.max(1, Math.ceil((start + windowMs - t) / 1000));
    throw new HttpError(429, 'rate_limited', 'Слишком много запросов, подождите', { 'Retry-After': String(retry) });
  }
}
