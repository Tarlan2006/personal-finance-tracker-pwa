// Админ-скрипт аккаунтов.  Примеры:
//   npm run accounts -- list --db .wrangler/dev.sqlite
//   npm run accounts -- add owner "Владелец" --db .wrangler/dev.sqlite
//   npm run accounts -- set-password owner --remote --confirm-origin https://qarjy.<субдомен>.workers.dev
// Пароль вводится скрытым вводом (или переменной QARJY_PASSWORD для автоматизации). Он нигде не печатается.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { hashPassword, b64, randomToken, PBKDF2_ITER } from '../worker/src/util';
import { checkPasswordStrength } from '../worker/src/auth';
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from '../worker/src/domain/money/categories';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(arr[i - 1] ?? '').startsWith('--'));
const remote = args.includes('--remote');
const dbPath = flag('--db');

function sqlStr(s: string) { return "'" + s.replace(/'/g, "''") + "'"; }

function wranglerOrigin(): string {
  const t = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  return /APP_ORIGIN\s*=\s*"([^"]+)"/.exec(t)?.[1] ?? '';
}

function exec(sql: string, wantRows = false): any[] {
  if (remote) {
    const want = wranglerOrigin(); const got = flag('--confirm-origin');
    if (!got || got !== want || want.includes('example')) {
      console.error(`Отказ: --confirm-origin должен точно совпадать с APP_ORIGIN из wrangler.toml (сейчас «${want}»; значение с example — это заглушка).`);
      process.exit(2);
    }
    let r;
    if (wantRows) {
      // SELECT: при --file wrangler строк не возвращает, поэтому --command. На Windows (shell) оборачиваем SQL в кавычки сами.
      const sqlArg = process.platform === 'win32' ? '"' + sql.replace(/"/g, '\\"') + '"' : sql;
      r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'qarjy', '--remote', '--yes', '--json', '--command', sqlArg], { encoding: 'utf8', shell: process.platform === 'win32' });
    } else {
      // Запись: SQL через файл (путь без пробелов). Файл может содержать хеш пароля — удаляем всегда.
      mkdirSync('.wrangler', { recursive: true });
      const tmp = '.wrangler/accounts-tmp.sql';
      writeFileSync(tmp, sql);
      try { r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'qarjy', '--remote', '--yes', '--json', '--file', tmp], { encoding: 'utf8', shell: process.platform === 'win32' }); }
      finally { try { unlinkSync(tmp); } catch {} }
    }
    if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
    if (!wantRows) return [];
    // wrangler перед JSON печатает строки прогресса; ищем начало JSON-массива (строка «[» или «[{»)
    const out: string = r.stdout ?? '';
    const i1 = out.search(/^\[\s*$/m); const start = i1 >= 0 ? i1 : out.search(/^\[\{/m);
    if (start < 0) { console.error('Не удалось разобрать ответ wrangler:\n' + out); process.exit(1); }
    return JSON.parse(out.slice(start))[0]?.results ?? [];
  }
  if (!dbPath) { console.error('Укажите --db <файл sqlite> или --remote'); process.exit(2); }
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  if (wantRows) return db.prepare(sql).all() as any[];
  db.exec(sql); return [];
}

async function askHidden(prompt: string): Promise<string> {
  if (process.env.QARJY_PASSWORD) return process.env.QARJY_PASSWORD;
  if (!process.stdin.isTTY) { console.error('Нужен терминал для скрытого ввода (или QARJY_PASSWORD).'); process.exit(2); }
  process.stdout.write(prompt);
  return new Promise(resolve => {
    let s = ''; process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const on = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stdout.write('\n'); return resolve(s); }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') s = s.slice(0, -1); else s += c;
      }
    };
    process.stdin.on('data', on);
  });
}
async function askNewPassword() {
  const a = await askHidden('Новый пароль (скрыто): ');
  if (!process.env.QARJY_PASSWORD) { const b = await askHidden('Повторите пароль: '); if (a !== b) { console.error('Пароли не совпадают'); process.exit(2); } }
  if (args.includes('--allow-weak')) {
    if (a.length < 4) { console.error('Даже со --allow-weak пароль не короче 4 символов'); process.exit(2); }
    if (a.length < 10) console.warn('ВНИМАНИЕ: слабый пароль. Допустимо для теста; перед реальными данными замените (set-password без --allow-weak).');
  } else checkPasswordStrength(a);
  return a;
}
const t = Date.now();
async function main() {
  switch (cmd) {
    case 'add': {
      const [login, name] = pos;
      if (!login || !/^[a-z0-9_.-]{2,32}$/.test(login)) { console.error('Использование: add <login> ["Имя"]; login: a-z 0-9 _ . -'); process.exit(2); }
      const pw = await askNewPassword();
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const id = crypto.randomUUID();
      const stmts = [`INSERT INTO accounts (id, login, display_name, pass_hash, pass_salt, pass_iter, queue_key, created_at, updated_at) VALUES (${sqlStr(id)}, ${sqlStr(login)}, ${sqlStr(name ?? login)}, ${sqlStr(await hashPassword(pw, salt))}, ${sqlStr(salt)}, ${PBKDF2_ITER}, ${sqlStr(randomToken(32))}, ${t}, ${t});`];
      const catIds = new Map<string, string>();
      DEFAULT_CATEGORIES.forEach((c, i) => { const cid = crypto.randomUUID(); catIds.set(c.name, cid); stmts.push(`INSERT INTO categories (id, account_id, name, type, color, sort, created_at) VALUES (${sqlStr(cid)}, ${sqlStr(id)}, ${sqlStr(c.name)}, '${c.type}', '${c.color}', ${i}, ${t});`); });
      for (const r of DEFAULT_RULES) stmts.push(`INSERT INTO rules (id, account_id, pattern, direction, category_id, created_at) VALUES (${sqlStr(crypto.randomUUID())}, ${sqlStr(id)}, ${sqlStr(r.pattern)}, 'in', ${sqlStr(catIds.get(r.category)!)}, ${t});`);
      exec(stmts.join('\n')); console.log(`Аккаунт «${login}» создан.`); break;
    }
    case 'set-password': {
      const [login] = pos; if (!login) { console.error('Использование: set-password <login>'); process.exit(2); }
      const pw = await askNewPassword(); const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      exec(`UPDATE accounts SET pass_hash=${sqlStr(await hashPassword(pw, salt))}, pass_salt=${sqlStr(salt)}, pass_iter=${PBKDF2_ITER}, failed_count=0, locked_until=0, updated_at=${t} WHERE login=${sqlStr(login)};
UPDATE sessions SET revoked_at=${t} WHERE revoked_at IS NULL AND account_id=(SELECT id FROM accounts WHERE login=${sqlStr(login)});`);
      console.log('Пароль обновлён, все устройства отозваны.'); break;
    }
    case 'list': {
      const rows = exec(`SELECT login, display_name, disabled, (SELECT COUNT(*) FROM sessions s WHERE s.account_id=a.id AND s.revoked_at IS NULL AND s.expires_at>${t}) AS sessions FROM accounts a ORDER BY login`, true);
      for (const r of rows) console.log(`${r.login}\t${r.display_name}\t${r.disabled ? 'ОТКЛЮЧЁН' : 'активен'}\tсессий: ${r.sessions}`); break;
    }
    case 'revoke': {
      const [login] = pos; if (!login) { console.error('Использование: revoke <login>'); process.exit(2); }
      exec(`UPDATE sessions SET revoked_at=${t} WHERE revoked_at IS NULL AND account_id=(SELECT id FROM accounts WHERE login=${sqlStr(login)}); UPDATE api_keys SET revoked_at=${t} WHERE revoked_at IS NULL AND account_id=(SELECT id FROM accounts WHERE login=${sqlStr(login)});`);
      console.log('Все устройства и ключи аккаунта отозваны.'); break;
    }
    case 'disable': case 'enable': {
      const [login] = pos; if (!login) { console.error(`Использование: ${cmd} <login>`); process.exit(2); }
      exec(`UPDATE accounts SET disabled=${cmd === 'disable' ? 1 : 0}, updated_at=${t} WHERE login=${sqlStr(login)};` + (cmd === 'disable' ? `UPDATE sessions SET revoked_at=${t} WHERE revoked_at IS NULL AND account_id=(SELECT id FROM accounts WHERE login=${sqlStr(login)});` : ''));
      console.log(cmd === 'disable' ? 'Аккаунт отключён, сессии отозваны.' : 'Аккаунт включён.'); break;
    }
    default: console.log('Команды: add | set-password | list | revoke | disable | enable (+ --db <файл> | --remote --confirm-origin <origin>)');
  }
}
main();
