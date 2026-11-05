import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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

/** A synchronous guard also covers two clicks in the same render/event. */
export function useAction(){
  const running=useRef(false),active=useRef(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function run(work:()=>Promise<unknown>){
    if(running.current)return false;
    running.current=true;setBusy(true);setError('');
    try{await work();return true;}
    catch(e){if(active.current)setError(e instanceof Error?e.message:'Не удалось выполнить действие');return false;}
    finally{running.current=false;if(active.current)setBusy(false);}
  }
  return {busy,error,setError,run,running};
}
const sheetStack:HTMLElement[]=[];

export function Sheet({ title, onClose, children, busy=false }: { title: string; onClose: () => void; children: ReactNode; busy?:boolean }) {
  const restore=useRef(document.activeElement as HTMLElement|null);
  const [layer,setLayer]=useState(0);
  const ref=useRef<HTMLElement>(null), close=useRef(onClose); close.current=()=>{if(!busy)onClose();};
  useLayoutEffect(()=>{
    const element=ref.current!,viewport=window.visualViewport;
    if(!viewport)return;
    let frame=0;
    const update=()=>{
      // iOS can shrink/pan only the visual viewport when its keyboard appears.
      // Ignore pinch zoom: the browser owns panning the magnified page.
      const zoomed=viewport.scale>1.05;
      element.style.bottom=zoomed?'':`${Math.max(0,innerHeight-viewport.offsetTop-viewport.height)}px`;
      element.style.maxHeight=zoomed?'':`calc(${Math.max(0,viewport.height)}px - var(--sat) - 12px)`;
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
        const field=document.activeElement;
        if(!zoomed&&sheetStack.at(-1)===element&&field instanceof HTMLElement&&element.contains(field)&&field.matches('input,textarea,select')){
          const bounds=field.getBoundingClientRect(),sheet=element.getBoundingClientRect();
          if(bounds.bottom>sheet.bottom-12)element.scrollTop+=bounds.bottom-sheet.bottom+12;
          else if(bounds.top<sheet.top+12)element.scrollTop+=bounds.top-sheet.top-12;
        }
      });
    };
    update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);element.addEventListener('focusin',update);
    return()=>{cancelAnimationFrame(frame);viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);element.removeEventListener('focusin',update);};
  },[]);
  useEffect(()=>{
    const previous=restore.current, unlock=lockScroll(),element=ref.current!;setLayer(sheetStack.length);sheetStack.push(element);
    const focus=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
    const frame=requestAnimationFrame(()=>{if(sheetStack.at(-1)===element&&!ref.current?.contains(document.activeElement))(ref.current?.querySelector<HTMLElement>('[data-autofocus]')??focus()[0]??ref.current)?.focus({preventScroll:true});});
    const key=(e:KeyboardEvent)=>{
      if(sheetStack.at(-1)!==element)return;
      if(e.key==='Escape'){e.preventDefault();close.current();}
      if(e.key==='Tab') { const items=focus(), first=items[0], last=items[items.length-1];
        if(!first){e.preventDefault();ref.current?.focus();}
        else if(e.shiftKey&&(document.activeElement===first||!ref.current?.contains(document.activeElement))){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||!ref.current?.contains(document.activeElement))){e.preventDefault();first.focus();}
      }
    };
    window.addEventListener('keydown',key);
    return ()=>{cancelAnimationFrame(frame);sheetStack.splice(sheetStack.indexOf(element),1);unlock();window.removeEventListener('keydown',key);requestAnimationFrame(()=>{if(previous?.isConnected&&(!sheetStack.length||sheetStack.at(-1)?.contains(previous)))previous.focus({preventScroll:true});});};
  },[]);
  return <><div className="sheet-bg" style={{zIndex:20+layer*2}} onClick={()=>close.current()} aria-hidden="true" /><section ref={ref} tabIndex={-1} className="sheet" style={{zIndex:21+layer*2}} aria-busy={busy||undefined} role="dialog" aria-modal="true" aria-label={title}><div className="sheet-handle" aria-hidden="true"/><header className="sheet-heading"><h3>{title}</h3><button className="close-sheet" aria-label="Закрыть" disabled={busy} onClick={()=>close.current()}>×</button></header>{children}</section></>;
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="field"><label>{label}</label>{children}</div>;

const P = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
export const Icons = {
  feed: P('M4 6h16M4 12h16M4 18h10'), chart: P('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  upload: P('M12 21v-8m-4 4 4-4 4 4M20.9 18.1A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 3 16.3'), search: P('m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'), check: P('m5 12 4 4L19 6'),
  plus: P('M12 5v14M5 12h14'), more: P('M5 12h.01M12 12h.01M19 12h.01'),
};

export { normName, inputMinor } from './money';
