import { HttpError } from '../../env';

export const TZ_OFFSET_MS = 5 * 3600 * 1000; // Казахстан, UTC+5

export function normName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/["'«»“”`]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** "1 500,50", "1,500.50", "-1500", "1500.5 ₸" → тиын (целое со знаком) или null. */
export function parseAmountMinor(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = String(raw ?? '').replace(/[\s  ₸тТtT]|KZT|kzt|тг\.?/g, '').replace(/[−–—]/g, '-').replace(/^\+/, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const neg = s.startsWith('-'); s = s.replace(/^-/, '');
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  const sep = Math.max(lastDot, lastComma);
  let intPart = s, frac = '';
  if (sep >= 0) {
    const after = s.length - sep - 1;
    const other = s[sep] === '.' ? ',' : '.';
    // разделитель дробный, если после него 1–2 цифры, либо второго вида разделителя нет и цифр не 3
    if (after > 0 && after <= 2 || (after !== 3 && !s.includes(other) && s.split(s[sep]).length === 2)) {
      intPart = s.slice(0, sep); frac = s.slice(sep + 1);
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (intPart === '' && frac === '')) return null;
  const minor = Number(intPart || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor)) return null;
  return neg ? -minor : minor;
}

export function localToMs(y: number, mo: number, d: number, h = 12, mi = 0, sec = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
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
