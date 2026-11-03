import { MAX_NOTE_LENGTH } from '../../../../shared/types';
import { HttpError, type Store } from '../../env';
import { now, uuid } from '../../util';
import { normName, parseAmountMinor, parseDateMs } from './normalize';
import { effectiveCategory, loadMeta, type Meta } from './meta';
import type { EntryDTO, TxPayload } from '../../../../shared/types';

export const KIND_TX = 'tx';
const ID_RE = /^[A-Za-z0-9_.:-]{8,80}$/;

export interface TxInput {
  id?: string; occurredAt?: number | string; direction: string; amountMinor?: number; amount?: string | number;
  counterparty?: string; categoryId?: string | null; note?: string; title?: string; bank?: string;
}

export function validateId(id: unknown): string {
  if (id === undefined || id === null || id === '') return uuid();
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'bad_id', 'Некорректный id записи');
  return id;
}

export function normalizeTx(inp: TxInput, nowMs = now()) {
  if(!inp||typeof inp!=='object'||Array.isArray(inp))throw new HttpError(400,'bad_entry','Нужен объект операции');
  for(const [key,max] of [['counterparty',120],['note',MAX_NOTE_LENGTH],['title',120],['bank',30],['categoryId',80]] as const){
    const value=inp[key];if(value!=null&&(typeof value!=='string'||value.length>max))throw new HttpError(400,'bad_field',`Некорректное поле ${key}`);
  }
  if(inp.amount!=null&&!['string','number'].includes(typeof inp.amount))throw new HttpError(400,'bad_amount','Некорректная сумма');
  const direction = inp.direction === 'in' || inp.direction === 'out' ? inp.direction : null;
  if (!direction) throw new HttpError(400, 'bad_direction', 'Направление: in (доход) или out (расход)');
  let minor = inp.amountMinor ?? (inp.amount !== undefined ? parseAmountMinor(inp.amount) : null);
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) throw new HttpError(400, 'bad_amount', 'Некорректная сумма');
  minor = Math.abs(minor);
  if (minor === 0) throw new HttpError(400, 'bad_amount', 'Сумма должна быть больше нуля');
  if (minor > 100_000_000_000_00) throw new HttpError(400, 'bad_amount', 'Слишком большая сумма');
  let occurredAt = nowMs;
  if (inp.occurredAt !== undefined && inp.occurredAt !== null && inp.occurredAt !== '') {
    const raw=inp.occurredAt;
    const iso=typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)&&parseDateMs(raw.slice(0,10))!==null;
    const v = typeof raw === 'number' ? raw : (typeof raw==='string'?(parseDateMs(raw) ?? (iso?Date.parse(raw):NaN)):NaN);
    if (!Number.isSafeInteger(v) || v! < Date.UTC(2000, 0, 1) || v! > nowMs + 366 * 864e5) throw new HttpError(400, 'bad_date', 'Некорректная дата');
    occurredAt = v;
  }
  const payload: TxPayload = {
    direction, amountMinor: minor,
    counterparty: String(inp.counterparty ?? '').trim().slice(0, 120),
    categoryId: inp.categoryId || null,
    note: String(inp.note ?? '').trim().slice(0, MAX_NOTE_LENGTH),
    title: String(inp.title ?? '').trim().slice(0, 120) || undefined,
    bank: inp.bank ? String(inp.bank).slice(0, 30) : undefined,
    currency: 'KZT',
  };
  return { payload, occurredAt };
}

export const searchText = (p: TxPayload) => normName(`${p.counterparty} ${p.note ?? ''} ${p.title ?? ''}`);

/** SQL вставки; идемпотентна по (account_id, id), и по dedupe_key для импорта. */
export function insertStatements(store: Store, accountId: string, id: string, p: TxPayload, occurredAt: number, source: string, extra: { importId?: string; dedupeKey?: string } = {}) {
  const t = now();
  const stmts = [store.stmt(
    `INSERT INTO entries (id, account_id, kind, occurred_at, created_at, updated_at, version, value, payload_json, source, import_id, dedupe_key, search)
     VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    id, accountId, KIND_TX, occurredAt, t, t, p.direction === 'in' ? p.amountMinor : -p.amountMinor, JSON.stringify(p), source,
    extra.importId ?? null, extra.dedupeKey ?? null, searchText(p))];
  const norm = normName(p.counterparty);
  if (norm) stmts.push(store.stmt(
    'INSERT INTO counterparties (id, account_id, name_norm, display, created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING',
    uuid(), accountId, norm, p.counterparty, t));
  return stmts;
}

export async function createTx(store: Store, accountId: string, inp: TxInput, source = 'app'): Promise<{ entry: EntryDTO; duplicate: boolean }> {
  if(!inp||typeof inp!=='object'||Array.isArray(inp))throw new HttpError(400,'bad_entry','Нужен объект операции');
  const id = validateId(inp.id);
  const { payload, occurredAt } = normalizeTx(inp);
  if (payload.categoryId) await assertCategory(store, accountId, payload.categoryId, payload.direction);
  const res = await store.batch(insertStatements(store, accountId, id, payload, occurredAt, source));
  const duplicate = !res[0].meta?.changes;
  const row = await store.first<any>('SELECT * FROM entries WHERE account_id = ? AND id = ?', accountId, id);
  const meta = await loadMeta(store, accountId);
  return { entry: toDTO(row, meta), duplicate };
}

export async function assertCategory(store: Store, accountId: string, categoryId: string, direction: 'in' | 'out') {
  const c = await store.first<{ type: string }>('SELECT type FROM categories WHERE id = ? AND account_id = ? AND deleted_at IS NULL', categoryId, accountId);
  if (!c) throw new HttpError(400, 'bad_category', 'Категория не найдена');
  if (c.type !== (direction === 'in' ? 'income' : 'expense')) throw new HttpError(400, 'category_type', 'Тип категории не подходит к направлению');
}

export function toDTO(row: any, meta: Meta): EntryDTO {
  const payload = JSON.parse(row.payload_json) as TxPayload;
  return {
    id: row.id, kind: row.kind, occurredAt: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at,
    version: row.version, source: row.source, payload, effectiveCategoryId: effectiveCategory(meta, payload),
  };
}

export async function updateTx(store: Store, accountId: string, id: string, body: any) {
  const row = await store.first<any>('SELECT * FROM entries WHERE account_id = ? AND id = ? AND deleted_at IS NULL', accountId, id);
  if (!row) throw new HttpError(404, 'not_found', 'Запись не найдена');
  if (body.version !== undefined && Number(body.version) !== row.version)
    throw new HttpError(409, 'version_conflict', 'Запись уже изменена на другом устройстве');
  const old = JSON.parse(row.payload_json) as TxPayload;
  const merged = normalizeTx({
    direction: body.direction ?? old.direction, amountMinor: body.amountMinor ?? (body.amount !== undefined ? undefined : old.amountMinor), amount: body.amount,
    counterparty: body.counterparty ?? old.counterparty, categoryId: body.categoryId !== undefined ? body.categoryId : old.categoryId,
    note: body.note ?? old.note, title: body.title ?? old.title, bank: old.bank, occurredAt: body.occurredAt ?? row.occurred_at,
  });
  if (merged.payload.categoryId) await assertCategory(store, accountId, merged.payload.categoryId, merged.payload.direction);
  const t = now();
  const stmts = [store.stmt(
    `UPDATE entries SET occurred_at=?, updated_at=?, version=version+1, value=?, payload_json=?, search=?
     WHERE account_id=? AND id=? AND version=? AND deleted_at IS NULL`,
    merged.occurredAt, t, merged.payload.direction === 'in' ? merged.payload.amountMinor : -merged.payload.amountMinor,
    JSON.stringify(merged.payload), searchText(merged.payload), accountId, id, row.version)];
  const norm = normName(merged.payload.counterparty);
  if (norm) stmts.push(store.stmt('INSERT INTO counterparties (id, account_id, name_norm, display, created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', uuid(), accountId, norm, merged.payload.counterparty, t));
  const res = await store.batch(stmts);
  if (!res[0].meta?.changes) throw new HttpError(409, 'version_conflict', 'Запись уже изменена на другом устройстве');
  const fresh = await store.first<any>('SELECT * FROM entries WHERE account_id = ? AND id = ?', accountId, id);
  return toDTO(fresh, await loadMeta(store, accountId));
}

/** Мягкое удаление; повтор безопасен. */
export async function deleteTransactions(store: Store, accountId: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !ID_RE.test(id)))
    throw new HttpError(400, 'bad_ids', 'Выберите от 1 до 1000 операций');
  const t = now();
  const r = await store.run(`UPDATE entries SET deleted_at=?, updated_at=?, version=version+1
    WHERE account_id=? AND kind='tx' AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
    t, t, accountId, JSON.stringify([...new Set(ids)]));
  return { removed: r.meta?.changes ?? 0 };
}

export async function deleteTx(store: Store, accountId: string, id: string) {
  const r = await store.run('UPDATE entries SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?, version = version + 1 WHERE account_id = ? AND id = ?', now(), now(), accountId, id);
  if (!r.meta?.changes) throw new HttpError(404, 'not_found', 'Запись не найдена');
}

export async function listTx(store: Store, accountId: string, q: URLSearchParams) {
  for(const key of ['limit','from','to','beforeTime'])if(q.has(key)&&(!q.get(key)?.trim()||!Number.isSafeInteger(Number(q.get(key)))))throw new HttpError(400,'bad_query',`Некорректный параметр ${key}`);
  if(q.has('beforeTime')!==q.has('beforeId'))throw new HttpError(400,'bad_query','Курсор содержит время и id');
  const limit = Math.min(Math.max(Number(q.get('limit') ?? 100) || 100, 1), 200);
  const where = ['account_id = ?', 'deleted_at IS NULL', 'kind = ?']; const args: unknown[] = [accountId, KIND_TX];
  const from = q.get('from'), to = q.get('to'), search = normName(q.get('q') ?? '');
  if (from) { where.push('occurred_at >= ?'); args.push(Number(from)); }
  if (to) { where.push('occurred_at < ?'); args.push(Number(to)); }
  if (search) { where.push("search LIKE ? ESCAPE '\\'"); args.push('%' + search.replace(/[\\%_]/g, c => '\\' + c) + '%'); }
  const bt = q.get('beforeTime'), bid = q.get('beforeId');
  if (bt && bid) { where.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))'); args.push(Number(bt), Number(bt), bid); }
  const rows = await store.all(`SELECT * FROM entries WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC, id DESC LIMIT ?`, ...args, limit + 1);
  const meta = await loadMeta(store, accountId);
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map(r => toDTO(r, meta));
  const last = items[items.length - 1];
  return { items, next: more && last ? { beforeTime: last.occurredAt, beforeId: last.id } : null };
}

export async function exportCsv(store: Store, accountId: string): Promise<string> {
  const rows = await store.all('SELECT * FROM entries WHERE account_id = ? AND deleted_at IS NULL AND kind = ? ORDER BY occurred_at, id', accountId, KIND_TX);
  const meta = await loadMeta(store, accountId);
  const esc = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = ['id,date,direction,amount,currency,counterparty,category,note,bank,source'];
  for (const r of rows) {
    const e = toDTO(r, meta); const p = e.payload;
    const date = new Date(e.occurredAt + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    out.push([e.id, date, p.direction, (p.amountMinor / 100).toFixed(2), p.currency ?? 'KZT', p.counterparty,
      meta.cats.get(e.effectiveCategoryId ?? '')?.name ?? '', p.note ?? '', p.bank ?? '', e.source].map(esc).join(','));
  }
  return '﻿' + out.join('\r\n') + '\r\n';
}
