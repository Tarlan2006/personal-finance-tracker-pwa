import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { api } from './api';

export const fmt = (minor: number) => {
  const abs = Math.abs(minor), t = Math.floor(abs / 100), k = abs % 100;
  return `${minor < 0 ? '-' : ''}${String(t).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${k ? ',' + String(k).padStart(2, '0') : ''} ₸`;
};
export const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
export const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const thisMonth = () => todayStr().slice(0, 7);
export const shiftMonth = (m: string, d: number) => { const [y, mo] = m.split('-').map(Number); const x = new Date(y, mo - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };

// ---- глобальное состояние ----
export interface Cat { id: string; name: string; type: 'expense' | 'income'; color: string }
interface State { login: string | null; name: string; queueKey: string; cats: Cat[]; ready: boolean; version: number }
let state: State = { login: null, name: '', queueKey: '', cats: [], ready: false, version: 0 };
const subs = new Set<() => void>();
export const getState = () => state;
export const setState = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach(f => f()); };
export const bump = () => setState({ version: state.version + 1 }); // сигнал «данные изменились»
export const useAppState = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, getState);
export async function loadCats() { setState({ cats: (await api('GET', '/api/categories')).categories }); }
export const catMap = (cats: Cat[]) => new Map(cats.map(c => [c.id, c]));

export function applyTheme(t: string) {
  try { localStorage.setItem('theme', t); } catch {}
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}
export const savedTheme = () => { try { return localStorage.getItem('theme') ?? 'system'; } catch { return 'system'; } };

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <><div className="sheet-bg" onClick={onClose} /><div className="sheet" role="dialog" aria-label={title}><h3>{title}</h3>{children}</div></>;
}
export const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="field"><label>{label}</label>{children}</div>;

const P = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
export const Icons = {
  feed: P('M4 6h16M4 12h16M4 18h10'), chart: P('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  plus: P('M12 5v14M5 12h14'), more: P('M5 12h.01M12 12h.01M19 12h.01'),
};
