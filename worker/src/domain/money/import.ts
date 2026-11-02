import { HttpError, type Store } from '../../env';
import { now, sha256, uuid } from '../../util';
import { bankPdf } from './bank-pdf';
import { parseCsv } from './csv';
import { normName, parseAmountMinor, parseDateMs } from './normalize';
import { insertStatements, normalizeTx } from './entries';
import { loadMeta } from './meta';
import type { TxPayload } from '../../../../shared/types';

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
  freedom: { title: 'Freedom PDF — формат пока не поддержан', ready: false },
};

export type RowStatus = 'imported' | 'duplicate' | 'rejected';
export interface ImportReport {
  total: number; imported: number; duplicates: number; rejected: number; dryRun: boolean; batchId: string | null;
  rows: Array<{ line: number; status: RowStatus; reason?: string; preview?: string }>;
  newCounterparties: string[];
}

const MAX_ROWS = 20000;

interface Parsed { line: number; payload?: TxPayload; occurredAt?: number; key?: string; reject?: string; preview: string }

export function parseRows(csv: string, m: Mapping): { parsed: Parsed[]; headerLine: number | null } {
  if (!m || !Number.isInteger(m.dateCol)) throw new HttpError(400, 'bad_mapping', 'Не указана колонка даты');
  const hasAmount = Number.isInteger(m.amountCol), hasSplit = Number.isInteger(m.debitCol) || Number.isInteger(m.creditCol);
  if (!hasAmount && !hasSplit) throw new HttpError(400, 'bad_mapping', 'Не указана колонка суммы');
  const { rows, lines } = parseCsv(csv, m.delimiter);
  if (rows.length > MAX_ROWS + 1) throw new HttpError(413, 'too_many_rows', `Не больше ${MAX_ROWS} строк за раз`);
  const start = m.hasHeader === false ? 0 : 1;
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
  const bank = input.bank ?? input.mapping?.bank ?? 'generic';
  if (!BANK_PROFILES[bank]?.ready) throw new HttpError(400, 'profile_not_ready', 'Этот формат банка пока не поддержан');
  const csv = bank !== 'generic' ? await bankPdf(input.pdfBase64 ?? '', bank) : input.csv;
  if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'empty_file', 'Файл пустой');
  if (new TextEncoder().encode(csv).length > 3 * 1024 * 1024) throw new HttpError(413, 'file_too_large', 'Файл слишком большой');
  const mapping = bank === 'halyk' ? { bank, delimiter: ';', rejectionCol: 6, dateCol: 0, creditCol: 4, debitCol: 5, counterpartyCol: 2, noteCol: 3 } : bank === 'kaspi' ? { bank, delimiter: ';', rejectionCol: 6, dateCol: 0, amountCol: 1, counterpartyCol: 2, noteCol: 3 } : input.mapping!;
  const { parsed } = parseRows(csv, mapping);
  const report: ImportReport = { total: parsed.length, imported: 0, duplicates: 0, rejected: 0, dryRun: !!input.dryRun, batchId: null, rows: [], newCounterparties: [] };
  const good = parsed.filter(p => p.payload);
  for (const p of parsed) if (p.reject) { report.rejected++; report.rows.push({ line: p.line, status: 'rejected', reason: p.reject, preview: p.preview }); }
  const keys = await Promise.all(good.map(async p => ({ p, key: await sha256(`${accountId}|${p.key}`) })));
  const batchId = uuid();
  const dupLines = new Set<number>();

  if (input.dryRun) {
    for (let i = 0; i < keys.length; i += 90) {
      const chunk = keys.slice(i, i + 90);
      const found = await store.all<{ dedupe_key: string }>(
        `SELECT dedupe_key FROM entries WHERE account_id = ? AND dedupe_key IN (${chunk.map(() => '?').join(',')})`, accountId, ...chunk.map(c => c.key));
      const set = new Set(found.map(f => f.dedupe_key));
      for (const c of chunk) if (set.has(c.key)) dupLines.add(c.p.line);
    }
  } else {
    for (let i = 0; i < keys.length; i += 40) {
      const chunk = keys.slice(i, i + 40); const stmts: D1PreparedStatement[] = []; const spans: number[] = [];
      for (const c of chunk) {
        spans.push(stmts.length);
        stmts.push(...insertStatements(store, accountId, uuid(), c.p.payload!, c.p.occurredAt!, 'import', { importId: batchId, dedupeKey: c.key }));
      }
      const res = await store.batch(stmts);
      chunk.forEach((c, j) => { if (!res[spans[j]].meta?.changes) dupLines.add(c.p.line); });
    }
  }
  for (const c of keys) {
    if (dupLines.has(c.p.line)) { report.duplicates++; report.rows.push({ line: c.p.line, status: 'duplicate', reason: 'операция уже импортирована', preview: c.p.preview }); }
    else { report.imported++; report.rows.push({ line: c.p.line, status: 'imported', reason: input.dryRun ? 'готова к импорту' : 'добавлена', preview: c.p.preview }); }
  }
  report.rows.sort((a, b) => a.line - b.line);
  if (report.imported + report.duplicates + report.rejected !== report.total) throw new Error('import invariant violated');
  if (!input.dryRun) {
    report.batchId = batchId;
    await store.run('INSERT INTO import_batches (id, account_id, source, filename, created_at, total, imported, duplicates, rejected, report_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
      batchId, accountId, bank, String(input.filename ?? 'file.csv').slice(0, 120), now(), report.total, report.imported, report.duplicates, report.rejected, JSON.stringify(report.rows));
  }
  const meta = await loadMeta(store, accountId);
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
