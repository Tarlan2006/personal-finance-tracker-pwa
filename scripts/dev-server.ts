// Локальный сервер: тот же Worker + настоящий SQLite (node:sqlite) + раздача web/dist. Для разработки и браузерных тестов.
// Запуск: npm run build && npm run dev   (порт PORT, база DB_FILE или в памяти)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createLocalD1 } from '../worker/dev/sqlite-d1';
import worker from '../worker/src/index';
import { Store, type Env } from '../worker/src/env';
import { createAccount } from '../worker/src/auth';
import { seedDefaultCategories } from '../worker/src/domain/money/categories';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const port = Number(process.env.PORT ?? 8787);
const local = createLocalD1(process.env.DB_FILE ?? ':memory:', join(root, 'migrations'));
const dist = join(root, 'web/dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const assets = {
  async fetch(req: Request) {
    const p = new URL(req.url).pathname;
    const tryRead = async (f: string) => { try { return await readFile(join(dist, f)); } catch { return null; } };
    let body = await tryRead(p === '/' ? 'index.html' : p.slice(1)); let ext = extname(p) || '.html';
    if (!body) { body = await tryRead('index.html'); ext = '.html'; }
    if (!body) return new Response('build web first (npm run build)', { status: 404 });
    return new Response(body, { headers: { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' } });
  },
} as unknown as Fetcher;
const env: Env = { DB: local.db, ASSETS: assets };

if (process.env.SEED_ACCOUNT) { // только для локальных/браузерных тестов
  const [login, password] = process.env.SEED_ACCOUNT.split(':');
  const s = new Store(local.db); const id = await createAccount(s, login, 'Владелец', password); await seedDefaultCategories(s, id);
}

createServer(async (rq, rs) => {
  const chunks: Buffer[] = []; for await (const c of rq) chunks.push(c as Buffer);
  const url = `http://${rq.headers.host}${rq.url}`;
  const headers = new Headers(); for (const [k, v] of Object.entries(rq.headers)) if (typeof v === 'string') headers.set(k, v);
  // dev по http: зеркалим на https-origin, чтобы проверка Origin и cookie работали одинаково
  const req = new Request(url, { method: rq.method, headers, body: ['GET', 'HEAD'].includes(rq.method ?? 'GET') ? undefined : Buffer.concat(chunks) });
  const res = await worker.fetch(req, env);
  const out: Record<string, string | string[]> = {};
  res.headers.forEach((v, k) => { out[k] = v; });
  const sc = ((res.headers as any).getSetCookie?.() ?? []) as string[]; if (sc.length) out['set-cookie'] = sc.map(c => c.replace('; Secure', ''));
  rs.writeHead(res.status, out); rs.end(Buffer.from(await res.arrayBuffer()));
}).listen(port, () => console.log(`dev-сервер: http://localhost:${port}`));
