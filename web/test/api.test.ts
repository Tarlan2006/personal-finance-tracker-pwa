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
it('запоздалый 401 старой сессии не выбрасывает новый аккаунт',async()=>{
 let reply!:(r:Response)=>void;const oldResponse=new Promise<Response>(r=>{reply=r;});
 vi.stubGlobal('fetch',vi.fn().mockImplementationOnce(()=>oldResponse).mockResolvedValueOnce(Response.json({ok:true})));
 const {api,setUnauthorizedHandler}=await import('../src/api');const unauthorized=vi.fn();setUnauthorizedHandler(unauthorized);
 const old=api('GET','/api/entries');const rejected=expect(old).rejects.toMatchObject({status:401});
 await api('POST','/api/auth/login',{login:'synthetic'});reply(Response.json({message:'expired'},{status:401}));await rejected;expect(unauthorized).not.toHaveBeenCalled();
});
it('429 не запрещает выход и не переносит паузу импорта на новый вход',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({message:'limit'},{status:429,headers:{'retry-after':'60'}})).mockImplementation(()=>Promise.resolve(Response.json({ok:true}))));
 const {api}=await import('../src/api');await expect(api('POST','/api/import',{})).rejects.toMatchObject({status:429});
 await expect(api('POST','/api/auth/logout',{})).resolves.toMatchObject({ok:true});await api('POST','/api/auth/login',{});await expect(api('GET','/api/me')).resolves.toMatchObject({ok:true});
});
it('запоздалый 429 старой сессии не останавливает новую',async()=>{
 let reply!:(r:Response)=>void;const oldResponse=new Promise<Response>(r=>{reply=r;});
 vi.stubGlobal('fetch',vi.fn().mockImplementationOnce(()=>oldResponse).mockImplementation(()=>Promise.resolve(Response.json({ok:true}))));
 const {api}=await import('../src/api');const old=api('POST','/api/import',{}),rejected=expect(old).rejects.toMatchObject({status:429});
 await api('POST','/api/auth/login',{});reply(Response.json({message:'limit'},{status:429,headers:{'retry-after':'60'}}));await rejected;await expect(api('GET','/api/me')).resolves.toMatchObject({ok:true});
});
it('ошибки инфраструктуры и повреждённый JSON не выводят технические подробности',async()=>{
 vi.stubGlobal('fetch',vi.fn()
  .mockResolvedValueOnce(Response.json({error:'internal',message:'D1_ERROR: SELECT private_table failed'},{status:503}))
  .mockResolvedValueOnce(new Response('<html>upstream failed</html>',{status:502}))
  .mockResolvedValueOnce(Response.json(null,{status:502}))
  .mockResolvedValueOnce(new Response('{broken',{headers:{'content-type':'application/json'}}))
  .mockResolvedValueOnce(Response.json({error:'bad_amount',message:'Введите положительную сумму'},{status:400})));
 const {api}=await import('../src/api');
 for(const path of ['/api/report-1','/api/report-2','/api/report-null'])await expect(api('GET',path)).rejects.toMatchObject({message:'Сервис временно недоступен. Повторите действие чуть позже.'});
 await expect(api('GET','/api/report-3')).rejects.toMatchObject({status:502,code:'bad_response',message:'Не удалось прочитать ответ сервера. Обновите экран и повторите действие.'});
 await expect(api('POST','/api/entries',{})).rejects.toMatchObject({status:400,message:'Введите положительную сумму'});
});
