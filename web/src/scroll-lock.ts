/** One document scroll owner; nested sheets share one reversible iOS body lock. */
let locks=0;
let restore:(()=>void)|null=null;
let lockedY:number|null=null;
/** Adjust an anchored row even while an iOS sheet owns the body scroll lock. */
export function shiftDocumentScroll(delta:number){
  if(!Number.isFinite(delta)||Math.abs(delta)<0.5)return;
  if(locks>0&&lockedY!==null){lockedY=Math.max(0,lockedY+delta);document.body.style.top=`-${lockedY}px`;}
  else window.scrollBy(0,delta);
}
export function lockScroll():()=>void {
  if(locks++===0){
    const root=document.documentElement,body=document.body,x=window.scrollX,y=window.scrollY;
    lockedY=y;
    const old={overflow:body.style.overflow,position:body.style.position,top:body.style.top,left:body.style.left,width:body.style.width,rootOverflow:root.style.overflowY};
    root.style.overflowY='hidden';body.style.overflow='hidden';body.style.position='fixed';body.style.top=`-${y}px`;body.style.left=`-${x}px`;body.style.width='100%';
    restore=()=>{Object.assign(body.style,{overflow:old.overflow,position:old.position,top:old.top,left:old.left,width:old.width});root.style.overflowY=old.rootOverflow;window.scrollTo(x,lockedY??y);lockedY=null;};
  }
  let released=false;
  return ()=>{if(released)return;released=true;if(--locks===0){restore?.();restore=null;}};
}
