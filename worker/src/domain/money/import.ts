import { HttpError, type Store } from '../../env';
import { now, sha256, uuid } from '../../util';
import { MAX_IMPORT_ROWS, MAX_IMPORT_REPORT_BYTES, MAX_IMPORT_REASON_CHARS } from './import-limits';
import { bankPdf } from './bank-pdf';
import { parseCsv } from './csv';
import { normName, parseAmountMinor, parseDateMs } from './normalize';
import { insertStatements, normalizeTx } from './entries';
import { loadMeta } from './meta';
import { MAX_NOTE_LENGTH, type TxPayload } from '../../../../shared/types';

export interface Mapping {
  bank?: string; delimiter?: string; hasHeader?: boolean;
  dateCol: number; rejectionCol?: number; counterpartyCol?: number; noteCol?: number;
  /** Вариант 1: одна колонка суммы; минус = расход, плюс = доход */
  amountCol?: number;
  /** Вариант 2: отдельные колонки списания/зачисления */
  debitCol?: number; creditCol?: number;
  /** Вариант 3: колонка направления со значениями */
  directionCol?: number; inValues?: string[]; outValues?: string[];
}

/** Профили проверенных макетов; ограничения — раздел «Профили банков» в DECISIONS.ru.md. */
export const BANK_PROFILES: Record<string, { title: string; ready: boolean; mapping?: Mapping }> = {
  generic: { title: 'Универсальный CSV (ручная привязка колонок)', ready: true },
  kaspi: { title: 'Kaspi Gold / депозит (PDF)', ready: true },
  halyk: { title: 'Halyk (PDF)', ready: true },
  freedom: { title: 'Freedom (PDF)', ready: true },
};

export type RowStatus = 'imported' | 'duplicate' | 'rejected';
export interface ImportReport {
  total: number; imported: number; duplicates: number; rejected: number; dryRun: boolean; batchId: string | null;
  rows: Array<{ line: number; status: RowStatus; reason?: string; preview?: string }>;
  newCounterparties: string[];
}



interface Parsed { line: number; payload?: TxPayload; occurredAt?: number; key?: string; reject?: string; preview: string }

export function parseRows(csv: string, m: Mapping): { parsed: Parsed[]; headerLine: number | null } {
  if (!m || !Number.isInteger(m.dateCol)) throw new HttpError(400, 'bad_mapping', 'Не указана колонка даты');
  for(const key of ['dateCol','amountCol','debitCol','creditCol','directionCol','counterpartyCol','noteCol','rejectionCol'] as const){const v=m[key];if(v!==undefined&&(!Number.isInteger(v)||v<0||v>255))throw new HttpError(400,'bad_mapping','Колонки должны быть от 0 до 255');}
  if(m.delimiter!==undefined&&(typeof m.delimiter!=='string'||m.delimiter.length!==1||/[\r\n"]/.test(m.delimiter)))throw new HttpError(400,'bad_mapping','Нужен один символ разделителя');
  if(m.hasHeader!==undefined&&typeof m.hasHeader!=='boolean')throw new HttpError(400,'bad_mapping','Укажите наличие заголовка');
  for(const values of [m.inValues,m.outValues])if(values!==undefined&&(!Array.isArray(values)||values.length>40||values.some(v=>typeof v!=='string'||v.length>80)))throw new HttpError(400,'bad_mapping','Некорректные значения направлений');
  if((m.inValues??[]).some(v=>(m.outValues??[]).map(normName).includes(normName(v))))throw new HttpError(400,'bad_mapping','Доход и расход не могут иметь одинаковое обозначение');
  const hasAmount = Number.isInteger(m.amountCol), hasSplit = Number.isInteger(m.debitCol) || Number.isInteger(m.creditCol);
  if (!hasAmount && !hasSplit) throw new HttpError(400, 'bad_mapping', 'Не указана колонка суммы');
  const { rows, lines } = parseCsv(csv, m.delimiter,{rows:MAX_IMPORT_ROWS+(m.hasHeader===false?0:1),columns:256});
  const start = m.hasHeader === false ? 0 : 1;
  if (rows.length - start > MAX_IMPORT_ROWS) throw new HttpError(413, 'too_many_rows', `Не больше ${MAX_IMPORT_ROWS} строк за раз; разделите выписку на части`);
  const seen = new Map<string, number>();
  const inV = (m.inValues ?? []).map(normName), outV = (m.outValues ?? []).map(normName);
  const parsed: Parsed[] = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]; const line = lines[i];
    const cell = (c?: number) => (Number.isInteger(c) ? (r[c as number] ?? '') : '').trim();
    const preview = r.join(' | ').slice(0, 140);
    if (r.every(c => !c.trim())) { parsed.push({ line, reject: 'пустая строка', preview }); continue; }
    if (cell(m.rejectionCol)) { parsed.push({ line, reject: cell(m.rejectionCol), preview }); continue; }
    const occurredAt = parseDateMs(cell(m.dateCol));
    if (occurredAt === null) { parsed.push({ line, reject: `не распознана дата «${cell(m.dateCol)}»`, preview }); continue; }
    let direction: 'in' | 'out' | null = null; let minor: number | null = null;
    if (hasSplit) {
      const d = cell(m.debitCol) ? parseAmountMinor(cell(m.debitCol)) : null;
      const c = cell(m.creditCol) ? parseAmountMinor(cell(m.creditCol)) : null;
      if ((cell(m.debitCol) && d === null) || (cell(m.creditCol) && c === null)) { parsed.push({ line, reject: 'не распознана сумма списания или зачисления', preview }); continue; }
      if (d && c) { parsed.push({ line, reject: 'заполнены и списание, и зачисление', preview }); continue; }
      if (d) { direction = 'out'; minor = Math.abs(d); } else if (c) { direction = 'in'; minor = Math.abs(c); }
      else { parsed.push({ line, reject: 'нет суммы (или она нулевая/нераспознана)', preview }); continue; }
    } else {
      const a = parseAmountMinor(cell(m.amountCol));
      if (a === null || a === 0) { parsed.push({ line, reject: `не распознана сумма «${cell(m.amountCol)}»`, preview }); continue; }
      minor = Math.abs(a);
      if (Number.isInteger(m.directionCol)) {
        const v = normName(cell(m.directionCol));
        if (inV.includes(v)) direction = 'in'; else if (outV.includes(v)) direction = 'out';
        else { parsed.push({ line, reject: `неизвестное направление «${cell(m.directionCol)}»`, preview }); continue; }
      } else direction = a < 0 ? 'out' : 'in';
    }
    if (cell(m.counterpartyCol).length > 120 || cell(m.noteCol).length > MAX_NOTE_LENGTH) { parsed.push({ line, reject: 'слишком длинное имя или описание; требуется ручная проверка', preview }); continue; }
    let norm;
    try {
      norm = normalizeTx({ direction, amountMinor: minor!, occurredAt, counterparty: cell(m.counterpartyCol), note: cell(m.noteCol), bank: m.bank });
    } catch (e: any) { parsed.push({ line, reject: e.message, preview }); continue; }
    const base = [m.bank ?? 'generic', norm.occurredAt, direction, minor, normName(norm.payload.counterparty), normName(norm.payload.note ?? '')].join('|');
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    parsed.push({ line, payload: norm.payload, occurredAt: norm.occurredAt, key: base + '|' + n, preview });
  }
  return { parsed, headerLine: start ? lines[0] ?? null : null };
}

/** Инвариант: imported + duplicates + rejected === total. Ни одна строка не теряется молча. */
export async function runImport(store: Store, accountId: string, input: { csv?: string; pdfBase64?: string; bank?: string; filename?: string; mapping?: Mapping; dryRun?: boolean }): Promise<ImportReport> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'bad_import', 'Нужен объект параметров импорта');
  for(const key of ['csv','pdfBase64','bank','filename'] as const)if(input[key]!==undefined&&typeof input[key]!=='string')throw new HttpError(400,'bad_import','Некорректные параметры файла');
  if(input.dryRun!==undefined&&typeof input.dryRun!=='boolean')throw new HttpError(400,'bad_import','dryRun должен быть логическим значением');
  const bank = input.bank ?? input.mapping?.bank ?? 'generic';
  if(typeof bank!=='string')throw new HttpError(400,'bad_import','Некорректный банк');
  if (!BANK_PROFILES[bank]?.ready) throw new HttpError(400, 'profile_not_ready', 'Этот формат банка пока не поддержан');
  const csv = bank !== 'generic' ? await bankPdf(input.pdfBase64 ?? '', bank) : input.csv;
  if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'empty_file', 'Файл пустой');
  if (new TextEncoder().encode(csv).length > 3 * 1024 * 1024) throw new HttpError(413, 'file_too_large', 'Файл слишком большой');
  const mapping = bank === 'halyk' ? { bank, delimiter: ';', rejectionCol: 6, dateCol: 0, creditCol: 4, debitCol: 5, counterpartyCol: 2, noteCol: 3 } : bank !== 'generic' ? { bank, delimiter: ';', rejectionCol: 6, dateCol: 0, amountCol: 1, counterpartyCol: 2, noteCol: 3 } : input.mapping!;
  const { parsed } = parseRows(csv, mapping);
  // All fallible reads/preparation happen before the financial transaction.
  const meta = await loadMeta(store, accountId);
  const report: ImportReport = { total: parsed.length, imported: 0, duplicates: 0, rejected: 0, dryRun: !!input.dryRun, batchId: null, rows: [], newCounterparties: [] };
  const good = parsed.filter(p => p.payload);
  const keys = await Promise.all(good.map(async p => ({ p, id: uuid(), key: await sha256(`${accountId}|${p.key}`) })));
  const batchId = uuid();
  const candidates = new Map(keys.map(c => [c.p.line, c.id]));
  const sourceRows = parsed.map(p => ({ line: p.line, status: p.reject ? 'rejected' : 'duplicate',
    reason: p.reject ? p.reject.slice(0, MAX_IMPORT_REASON_CHARS) : 'операция уже импортирована', preview: p.preview,
    ...(p.payload ? { entryId: candidates.get(p.line) } : {}) }));
  const sourceJson = JSON.stringify(sourceRows);
  // The persisted JSON only removes entryId and shortens successful reasons.
  // Reserve headroom for other columns in D1's 2 MB row limit.
  if (new TextEncoder().encode(sourceJson).length > MAX_IMPORT_REPORT_BYTES - 1024)
    throw new HttpError(413, 'report_too_large', 'Отчёт слишком большой; разделите выписку на части');

  if (input.dryRun) {
    const foundKeys = new Set<string>();
    for (let i = 0; i < keys.length; i += 90) {
      const chunk = keys.slice(i, i + 90);
      const found = await store.all<{ dedupe_key: string }>(
        `SELECT dedupe_key FROM entries WHERE account_id = ? AND dedupe_key IN (${chunk.map(() => '?').join(',')})`, accountId, ...chunk.map(c => c.key));
      for (const row of found) foundKeys.add(row.dedupe_key);
    }
    const keyByLine = new Map(keys.map(c => [c.p.line, c.key]));
    report.rows = sourceRows.map(({entryId, ...r}) => r.status === 'rejected' ? { ...r, status: 'rejected' as const } :
      foundKeys.has(keyByLine.get(r.line)!) ? { ...r, status: 'duplicate' as const } :
      { ...r, status: 'imported' as const, reason: 'готова к импорту' });
    report.imported = report.rows.filter(r => r.status === 'imported').length;
    report.duplicates = report.rows.filter(r => r.status === 'duplicate').length;
    report.rejected = report.rows.filter(r => r.status === 'rejected').length;
  } else {
    const stmts: D1PreparedStatement[] = [];
    for (const c of keys) stmts.push(...insertStatements(store, accountId, c.id, c.p.payload!, c.p.occurredAt!, 'import', { importId: batchId, dedupeKey: c.key }));
    // Evaluate duplicates after the inserts, inside the SAME transaction. A competing
    // import may win the unique key; a preflight SELECT cannot decide this safely.
    stmts.push(store.stmt(`WITH context AS (SELECT ? AS account_id, ? AS batch_id),
      evaluated AS (
        SELECT CAST(json_extract(j.value, '$.line') AS INTEGER) AS line, j.value AS row_json,
          CASE WHEN json_extract(j.value, '$.status') = 'rejected' THEN 'rejected'
            WHEN EXISTS (SELECT 1 FROM entries e WHERE e.account_id = context.account_id
              AND e.id = json_extract(j.value, '$.entryId') AND e.import_id = context.batch_id)
            THEN 'imported' ELSE 'duplicate' END AS status
        FROM json_each(?) j CROSS JOIN context
      ), normalized AS (
        SELECT line, status, json_set(json_remove(row_json, '$.entryId'), '$.status', status,
          '$.reason', CASE WHEN status = 'imported' THEN 'добавлена' WHEN status = 'duplicate'
            THEN 'операция уже импортирована' ELSE json_extract(row_json, '$.reason') END) AS row_json
        FROM evaluated ORDER BY line
      )
      INSERT INTO import_batches (id, account_id, source, filename, created_at, total, imported, duplicates, rejected, report_json)
      SELECT ?,?,?,?,?,count(*),coalesce(sum(status = 'imported'),0),coalesce(sum(status = 'duplicate'),0),
        coalesce(sum(status = 'rejected'),0),json_group_array(json(row_json)) FROM normalized`,
      accountId, batchId, sourceJson, batchId, accountId, bank, String(input.filename ?? 'file').slice(0,120), now()));
    stmts.push(store.stmt('SELECT total, imported, duplicates, rejected, report_json FROM import_batches WHERE account_id = ? AND id = ?', accountId, batchId));
    let results;
    try { results = await store.batch(stmts); }
    catch { throw new HttpError(503, 'import_failed', 'Не удалось подтвердить импорт. Обновите список пакетов или повторите файл: уже записанные операции будут распознаны как дубли'); }
    const saved = results[results.length - 1].results[0] as any;
    report.batchId = batchId;
    report.total = saved.total; report.imported = saved.imported; report.duplicates = saved.duplicates; report.rejected = saved.rejected;
    report.rows = JSON.parse(saved.report_json);
  }
  if (report.rows.length !== report.total || report.imported + report.duplicates + report.rejected !== report.total) throw new Error('import invariant violated');
  const seenN = new Set<string>();
  for (const c of keys) {
    const p = c.p.payload!; const n = normName(p.counterparty);
    if (!n || seenN.has(n)) continue; seenN.add(n);
    if (!(p.direction === 'in' ? meta.cpIn : meta.cpOut).has(n)) report.newCounterparties.push(p.counterparty);
  }
  report.newCounterparties = report.newCounterparties.slice(0, 200);
  return report;
}

export const listBatches = (store: Store, accountId: string) =>
  store.all('SELECT id, source, filename, created_at, total, imported, duplicates, rejected FROM import_batches WHERE account_id = ? ORDER BY created_at DESC LIMIT 50', accountId);
export async function getBatch(store: Store, accountId: string, id: string) {
  const b = await store.first<any>('SELECT * FROM import_batches WHERE id = ? AND account_id = ?', id, accountId);
  if (!b) throw new HttpError(404, 'not_found', 'Импорт не найден');
  return { ...b, report_json: undefined, rows: JSON.parse(b.report_json) };
}
/** Откат импорта целиком (мягкое удаление записей пакета). */
export async function undoBatch(store: Store, accountId: string, id: string) {
  const r = await store.run('UPDATE entries SET deleted_at = ?, updated_at = ?, dedupe_key = NULL, version = version + 1 WHERE account_id = ? AND import_id = ? AND deleted_at IS NULL', now(), now(), accountId, id);
  return { removed: r.meta?.changes ?? 0 };
}
