import {it,expect,vi} from 'vitest';
import {lockScroll,shiftDocumentScroll} from '../src/scroll-lock';
it('вложенные шторки восстанавливают прокрутку только после последнего закрытия',()=>{
 const body={style:{overflow:'',position:'',top:'',left:'',width:''}},root={style:{overflowY:'auto'}};
 const scrollTo=vi.fn();vi.stubGlobal('document',{body,documentElement:root});vi.stubGlobal('window',{scrollX:0,scrollY:345,scrollTo});
 try{
  const first=lockScroll(),second=lockScroll();expect(body.style.position).toBe('fixed');expect(body.style.top).toBe('-345px');
  first();first();expect(root.style.overflowY).toBe('hidden');expect(scrollTo).not.toHaveBeenCalled();
  second();expect(root.style.overflowY).toBe('auto');expect(body.style.position).toBe('');expect(body.style.overflow).toBe('');expect(scrollTo).toHaveBeenCalledWith(0,345);
 }finally{vi.unstubAllGlobals();}
});
it('обновление отчёта под шторкой сохраняет скорректированную позицию после последнего закрытия',()=>{
 const body={style:{overflow:'',position:'',top:'',left:'',width:''}},root={style:{overflowY:'auto'}};
 const scrollTo=vi.fn(),scrollBy=vi.fn();vi.stubGlobal('document',{body,documentElement:root});vi.stubGlobal('window',{scrollX:0,scrollY:900,scrollTo,scrollBy});
 const first=lockScroll(),second=lockScroll();
 try{shiftDocumentScroll(64);expect(body.style.top).toBe('-964px');first();expect(scrollTo).not.toHaveBeenCalled();shiftDocumentScroll(-24);second();expect(scrollTo).toHaveBeenCalledWith(0,940);expect(scrollBy).not.toHaveBeenCalled();expect(body.style.position).toBe('');}
 finally{first();second();vi.unstubAllGlobals();}
});
it('сдвиг без шторки меняет прокрутку документа; неверное смещение игнорируется',()=>{
 const scrollBy=vi.fn();vi.stubGlobal('window',{scrollBy});
 try{shiftDocumentScroll(48);shiftDocumentScroll(NaN);shiftDocumentScroll(0);expect(scrollBy).toHaveBeenCalledExactlyOnceWith(0,48);}finally{vi.unstubAllGlobals();}
});
