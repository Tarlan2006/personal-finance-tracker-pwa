import { measureSession } from '../worker/test/ops-measure';
const rows = await measureSession();
console.log('| Запрос | Обращений к хранилищу |\n|---|---|');
for (const r of rows) console.log(`| ${r.step} | ${r.ops} |`);
