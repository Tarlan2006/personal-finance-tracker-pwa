import { HttpError } from '../../env';

export const TZ_OFFSET_MS = 5 * 3600 * 1000; // Казахстан, UTC+5

export function normName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/["'«»“”`]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** "1 500,50", "1,500.50", "-1500", "1500.5 ₸" → тиын (целое со знаком) или null. */
export function parseAmountMinor(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'number' && !/^-?\d+(?:\.\d{1,2})?$/.test(String(raw))) return null;
  const value = String(raw).trim().replace(/\s*(?:₸|kzt|тг\.?|[тt])$/i, '').trim().replace(/[−–—]/g, '-');
  const sign = value.startsWith('-') ? -1 : 1;
  let digits = value.replace(/^[+-]/, '').trimStart();
  // A final group of three is a thousands separator; fractional tenge have at most two digits.
  const decimal = /([.,])(\d{1,2})$/.exec(digits);
  if (decimal) digits = digits.slice(0, decimal.index);
  const grouping = digits.match(/[.,\s]/)?.[0];
  if (grouping) {
    if (grouping === decimal?.[1]) return null;
    const groups = /\s/.test(grouping) ? digits.split(/\s+/) : digits.split(grouping);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(group => !/^\d{3}$/.test(group))) return null;
    digits = groups.join('');
  }
  if (!/^\d+$/.test(digits) && !(decimal && !digits)) return null;
  const minor = Number(digits) * 100 + Number((decimal?.[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? sign * minor : null;
}

export function localToMs(y: number, mo: number, d: number, h = 12, mi = 0, sec = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec) - TZ_OFFSET_MS;
  const chk = new Date(ms + TZ_OFFSET_MS);
  if (chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null; // 31 февраля и т.п.
  return ms;
}

/** Даты банков: 31.10.2026, 31.10.26, 2026-10-31, 31/10/2026, с временем «12:30[:15]». Без времени → 12:00 местного. */
export function parseDateMs(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    return localToMs(y, Number(m[2]), Number(m[1]), m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return localToMs(Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
  return null;
}

export function monthRange(month: string): { from: number; to: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new HttpError(400, 'bad_month', 'Месяц в формате ГГГГ-ММ');
  const y = Number(m[1]), mo = Number(m[2]);
  return { from: Date.UTC(y, mo - 1, 1) - TZ_OFFSET_MS, to: Date.UTC(y, mo, 1) - TZ_OFFSET_MS };
}
export function currentMonth(t = Date.now()): string {
  const d = new Date(t + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function formatMoney(minor: number): string {
  const neg = minor < 0; const abs = Math.abs(minor);
  const t = Math.floor(abs / 100), k = abs % 100;
  const s = String(t).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${s}${k ? ',' + String(k).padStart(2, '0') : ''} ₸`;
}
