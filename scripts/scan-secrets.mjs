// Простой сканер секретов по отслеживаемым и неигнорируемым файлам.
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
const rules = [
  ['Cloudflare/API токен', /\b[A-Za-z0-9_-]{37,}\b(?=.*cloudflare)/i],
  ['приватный ключ', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS ключ', /AKIA[0-9A-Z]{16}/],
  ['токен GitHub', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['ключ qarjy (реальный формат)', /qk_[wr]_[A-Za-z0-9_-]{40,}/],
  ['пароль в присваивании', /(password|passwd|secret|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i],
];
const allow = [/test\/|tests-e2e\/|\.test\.|SHORTCUTS\.md|README\.md|scan-secrets/];
let bad = 0;
for (const f of files) {
  try { if (statSync(f).size > 1_500_000) continue; } catch { continue; }
  let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
  if (allow.some(a => a.test(f))) continue;
  for (const [name, re] of rules) { const m = re.exec(t); if (m) { bad++; console.log(`${f}: возможный секрет (${name})`); } }
}
console.log(bad ? `Найдено: ${bad}` : `Секреты не найдены (проверено файлов: ${files.length})`);
process.exit(bad ? 1 : 0);
