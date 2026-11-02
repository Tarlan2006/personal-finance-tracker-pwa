import {it,expect,vi} from 'vitest';
import {lockScroll} from '../src/scroll-lock';
it('вложенные шторки восстанавливают прокрутку только после последнего закрытия',()=>{
 const body={style:{overflow:'',position:'',top:'',left:'',width:''}},root={style:{overflowY:'auto'}};
 const scrollTo=vi.fn();vi.stubGlobal('document',{body,documentElement:root});vi.stubGlobal('window',{scrollX:0,scrollY:345,scrollTo});
 try{
  const first=lockScroll(),second=lockScroll();expect(body.style.position).toBe('fixed');expect(body.style.top).toBe('-345px');
  first();first();expect(root.style.overflowY).toBe('hidden');expect(scrollTo).not.toHaveBeenCalled();
  second();expect(root.style.overflowY).toBe('auto');expect(body.style.position).toBe('');expect(body.style.overflow).toBe('');expect(scrollTo).toHaveBeenCalledWith(0,345);
 }finally{vi.unstubAllGlobals();}
});
