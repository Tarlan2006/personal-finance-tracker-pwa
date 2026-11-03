import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { lockScroll } from './scroll-lock';
import { api } from './api';
import type { FinancialProfileRecord } from '../../shared/financial-profile';

export const fmt = (minor: number) => {
  const abs = Math.abs(minor), t = Math.floor(abs / 100), k = abs % 100;
  return `${minor < 0 ? '-' : ''}${String(t).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${k ? ',' + String(k).padStart(2, '0') : ''} ₸`;
};
export const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'Asia/Almaty' });
export const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };
export const todayStr = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0,10);
export const thisMonth = () => todayStr().slice(0, 7);
export const shiftMonth = (m: string, d: number) => { const [y, mo] = m.split('-').map(Number); const x = new Date(y, mo - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };

// ---- глобальное состояние ----
export interface Cat { id: string; name: string; type: 'expense' | 'income'; color: string }
interface State { login: string | null; name: string; queueKey: string; cats: Cat[]; ready: boolean; version: number; financialProfile: FinancialProfileRecord | null; onboardingRequired:boolean;activeImports:number }
let state: State = { login: null, name: '', queueKey: '', cats: [], ready: false, version: 0, financialProfile:null, onboardingRequired:false,activeImports:0 };
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
  const restore=useRef(document.activeElement as HTMLElement|null);
  const ref=useRef<HTMLElement>(null), close=useRef(onClose); close.current=onClose;
  useEffect(()=>{
    const previous=restore.current, unlock=lockScroll();
    const focus=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
    const frame=requestAnimationFrame(()=>{if(!ref.current?.contains(document.activeElement))(ref.current?.querySelector<HTMLElement>('[data-autofocus]')??focus()[0]??ref.current)?.focus({preventScroll:true});});
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();close.current();}
      if(e.key==='Tab') { const items=focus(), first=items[0], last=items[items.length-1];
        if(!first){e.preventDefault();ref.current?.focus();}
        else if(e.shiftKey&&(document.activeElement===first||!ref.current?.contains(document.activeElement))){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||!ref.current?.contains(document.activeElement))){e.preventDefault();first.focus();}
      }
    };
    window.addEventListener('keydown',key);
    return ()=>{cancelAnimationFrame(frame);unlock();window.removeEventListener('keydown',key);requestAnimationFrame(()=>{if(previous?.isConnected)previous.focus({preventScroll:true});});};
  },[]);
  return <><div className="sheet-bg" onClick={onClose} aria-hidden="true" /><section ref={ref} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label={title}><div className="sheet-handle" aria-hidden="true"/><header className="sheet-heading"><h3>{title}</h3><button className="close-sheet" aria-label="Закрыть" onClick={onClose}>×</button></header>{children}</section></>;
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="field"><label>{label}</label>{children}</div>;

const P = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
export const Icons = {
  feed: P('M4 6h16M4 12h16M4 18h10'), chart: P('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  upload: P('M12 21v-8m-4 4 4-4 4 4M20.9 18.1A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 3 16.3'), search: P('m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'), check: P('m5 12 4 4L19 6'),
  plus: P('M12 5v14M5 12h14'), more: P('M5 12h.01M12 12h.01M19 12h.01'),
};

export { normName, inputMinor } from './money';
