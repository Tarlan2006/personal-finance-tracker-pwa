import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';

const source=readFileSync('web/public/sw.js','utf8');
function worker(storage?:any,throws=false,network=vi.fn(async()=>new Response('network'))){
 const handlers:Record<string,(e:any)=>void>={};
 const self:any={location:{origin:'https://qarjy.test'},addEventListener:(name:string,fn:any)=>{handlers[name]=fn;},skipWaiting:vi.fn(),clients:{claim:vi.fn()}};
 Object.defineProperty(self,'caches',{get(){if(throws)throw new DOMException('Storage denied','SecurityError');return storage;}});
 runInNewContext(source,{self,fetch:network,URL,Response});
 return {self,network,async dispatch(name:string,request:any={url:'https://qarjy.test/',method:'GET',mode:'navigate'}){
  const pending:Promise<unknown>[]=[];let response:Promise<Response>|undefined;
  handlers[name]({request,waitUntil:(p:Promise<unknown>)=>pending.push(p),respondWith:(p:Promise<Response>)=>{response=p;}});
  const result=await response;await Promise.all(pending);return result;
 }};
}
for(const kind of ['missing','getter throws','methods reject']){
 it(`SW: ${kind} Cache Storage does not block install, activation or online navigation`,async()=>{
  const denied=()=>Promise.reject(new Error('synthetic denial'));
  const w=worker(kind==='methods reject'?{open:denied,keys:denied}:undefined,kind==='getter throws');
  await w.dispatch('install');await w.dispatch('activate');
  expect(w.self.skipWaiting).toHaveBeenCalledOnce();expect(w.self.clients.claim).toHaveBeenCalledOnce();
  expect(await(await w.dispatch('fetch'))!.text()).toBe('network');
 });
 it(`SW: ${kind} cache and network failure returns a retry page`,async()=>{
  const denied=()=>Promise.reject(new Error('synthetic denial'));
  const w=worker(kind==='methods reject'?{open:denied}:undefined,kind==='getter throws',vi.fn(denied));
  const response=(await w.dispatch('fetch'))!;expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).toContain('Попробовать снова');
 });
}
it('SW: a failed cache write preserves the successful network response',async()=>{
 const put=vi.fn(async()=>{throw new Error('synthetic quota');});const w=worker({open:async()=>({put})});
 expect(await(await w.dispatch('fetch'))!.text()).toBe('network');expect(put).toHaveBeenCalledOnce();
});
it('SW: cached shell is used only for navigation, assets use their own cached response',async()=>{
 const match=vi.fn(async(key:any)=>key==='/'?new Response('shell'):key.url.endsWith('/assets/saved.js')?new Response('cached script'):undefined);
 const w=worker({open:async()=>({match})},false,vi.fn(async()=>{throw new Error('offline');}));
 expect(await(await w.dispatch('fetch'))!.text()).toBe('shell');
 expect(await(await w.dispatch('fetch',{url:'https://qarjy.test/assets/saved.js',method:'GET',mode:'cors'}))!.text()).toBe('cached script');
 match.mockClear();expect((await w.dispatch('fetch',{url:'https://qarjy.test/assets/missing.js',method:'GET',mode:'cors'}))!.type).toBe('error');expect(match).toHaveBeenCalledTimes(1);
});
it('SW: APIs, other origins and mutations bypass interception',async()=>{
 const open=vi.fn();const w=worker({open});
 for(const [url,method] of [['https://qarjy.test/api/private','GET'],['https://qarjy.test/api','GET'],['https://other.test/','GET'],['https://qarjy.test/','POST']])expect(await w.dispatch('fetch',{url,method})).toBeUndefined();
 expect(w.network).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});
it('SW: activation removes only obsolete Qarjy shell caches',async()=>{
 const remove=vi.fn();const w=worker({keys:async()=>['qarjy-shell-v1','qarjy-shell-v2','other-app'],delete:remove});await w.dispatch('activate');
 expect(remove).toHaveBeenCalledExactlyOnceWith('qarjy-shell-v1');
});
