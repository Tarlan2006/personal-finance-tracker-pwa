import { afterEach, expect, it, vi } from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('GET до записи не подменяет обновление после записи; старый ответ не удаляет новый запрос',async()=>{
  let resolveOld!:(r:Response)=>void, resolveFresh!:(r:Response)=>void;
  const oldResponse=new Promise<Response>(r=>{resolveOld=r;}),freshResponse=new Promise<Response>(r=>{resolveFresh=r;});
  const fetch=vi.fn().mockImplementationOnce(()=>oldResponse).mockResolvedValueOnce(Response.json({ok:true})).mockImplementationOnce(()=>freshResponse);
  vi.stubGlobal('fetch',fetch);
  const {api}=await import('../src/api');
  const old=api('GET','/api/entries');expect(api('GET','/api/entries')).toBe(old);
  await api('POST','/api/entries',{id:'synthetic-client-refresh'});
  const fresh=api('GET','/api/entries');expect(fresh).not.toBe(old);
  resolveOld(Response.json({version:1}));await expect(old).resolves.toEqual({version:1});
  expect(api('GET','/api/entries')).toBe(fresh);
  resolveFresh(Response.json({version:2}));await expect(fresh).resolves.toEqual({version:2});expect(fetch).toHaveBeenCalledTimes(3);
});
