import {useEffect,useRef,type ReactNode,type PointerEvent} from 'react';

/** A scroll gesture must never become a long press or open the editor afterwards. */
export function EntryCard({id,label,selecting,selected,disabled,onSelect,onOpen,children}:{id:string;label:string;selecting:boolean;selected:boolean;disabled:boolean;onSelect:()=>void;onOpen:()=>void;children:ReactNode}){
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),start=useRef<{x:number;y:number;id:number}|null>(null),consumed=useRef(false);
 const choose=useRef(onSelect);choose.current=onSelect;
 const cancel=()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;start.current=null;};
 useEffect(()=>{const scroll=()=>{if(timer.current!==null)consumed.current=true;cancel();};window.addEventListener('scroll',scroll,true);window.addEventListener('blur',scroll);document.addEventListener('visibilitychange',scroll);return()=>{cancel();window.removeEventListener('scroll',scroll,true);window.removeEventListener('blur',scroll);document.removeEventListener('visibilitychange',scroll);};},[]);
 function down(e:PointerEvent<HTMLButtonElement>){
   if(!e.isPrimary){consumed.current=true;cancel();return;}
   if(disabled||e.button!==0)return;
   cancel();consumed.current=false;start.current={x:e.clientX,y:e.clientY,id:e.pointerId};
   if(!selecting)timer.current=setTimeout(()=>{timer.current=null;consumed.current=true;choose.current();},500);
 }
 return <button className={'row feed-entry'+(selected?' selected':'')} data-entry-id={id} data-testid="entry-row" disabled={disabled}
   role={selecting?'checkbox':undefined} aria-checked={selecting?selected:undefined} aria-label={label}
   onPointerDown={down} onPointerMove={e=>{const p=start.current;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>10){consumed.current=true;cancel();}}}
   onPointerUp={cancel} onPointerCancel={()=>{consumed.current=true;cancel();}} onContextMenu={e=>e.preventDefault()}
   onClick={e=>{if(consumed.current&&e.detail!==0){consumed.current=false;return;}if(selecting)onSelect();else onOpen();}}>
   {selecting&&<span className="entry-check" aria-hidden="true">{selected?'✓':''}</span>}{children}
 </button>;
}
