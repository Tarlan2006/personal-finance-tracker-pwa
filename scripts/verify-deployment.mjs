// Только публичные GET. Использование: node scripts/verify-deployment.mjs https://<origin>
const origin = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https:\/\//.test(origin)) { console.error('Укажите https-origin'); process.exit(2); }
const checks = [
  ['GET /api/health', '/api/health', r => r.status === 200],
  ['GET /api/accounts', '/api/accounts', r => r.status === 200],
  ['GET /api/entries без входа → 401', '/api/entries', r => r.status === 401],
  ['GET /api/shortcuts/summary без ключа → 401', '/api/shortcuts/summary', r => r.status === 401],
  ['главная страница', '/', r => r.status === 200 && (r.headers.get('content-type') ?? '').includes('text/html')],
  ['manifest', '/manifest.webmanifest', r => r.status === 200],
  ['заголовки безопасности', '/api/health', r => r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('cache-control') === 'no-store'],
];
let fail = 0;
for (const [name, path, ok] of checks) {
  try { const r = await fetch(origin + path); const pass = ok(r); if (!pass) fail++; console.log(`${pass ? 'OK ' : 'FAIL'} ${name} (${r.status})`); }
  catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
}
process.exit(fail ? 1 : 0);
