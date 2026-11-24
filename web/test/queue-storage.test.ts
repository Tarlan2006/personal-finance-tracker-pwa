import {it,expect,vi,afterEach} from 'vitest';
import {enqueue,flush,getQueueStatus,listQueue,startQueue,stopQueue} from '../src/queue';
afterEach(()=>{stopQueue();vi.unstubAllGlobals();vi.useRealTimers();});
it('IndexedDB: зависшее открытие отклоняется, позднее соединение закрывается без записи',async()=>{
 vi.useFakeTimers();const close=vi.fn(),transaction=vi.fn();const request:any={result:{close,transaction},get error(){throw new DOMException('pending','InvalidStateError');}};
 vi.stubGlobal('indexedDB',{open:()=>request});const promise=listQueue('synthetic');const rejected=expect(promise).rejects.toThrow('Локальное хранилище недоступно');
 await vi.advanceTimersByTimeAsync(5001);await rejected;request.onsuccess();expect(close).toHaveBeenCalledOnce();expect(transaction).not.toHaveBeenCalled();
});
it('IndexedDB: blocked не обещает успешное сохранение',async()=>{
 const request:any={error:null};vi.stubGlobal('indexedDB',{open:()=>request});const promise=enqueue('synthetic',{id:'synthetic-blocked'});const rejected=expect(promise).rejects.toThrow('Локальное хранилище недоступно');request.onblocked();await rejected;
});
it('IndexedDB: abort транзакции отклоняется и закрывает соединение',async()=>{
 const transaction:any={objectStore:()=>({getAll:()=>({})}),error:null};const db={close:vi.fn(),transaction:()=>transaction};
 const request:any={result:db,error:null};vi.stubGlobal('indexedDB',{open:()=>request});const promise=listQueue('synthetic');const rejected=expect(promise).rejects.toMatchObject({name:'AbortError'});request.onsuccess();await Promise.resolve();transaction.onabort();await rejected;expect(db.close).toHaveBeenCalledOnce();
});
it('IndexedDB: повторное чтение очищает предупреждение при пустой очереди',async()=>{
 vi.stubGlobal('navigator',{onLine:true});
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const open=vi.fn().mockImplementationOnce(()=>{throw new DOMException('Denied','SecurityError');}).mockImplementation(()=>{
   const transaction={objectStore:()=>({getAll:()=>({result:[]})}),oncomplete:()=>{}};
   const request={result:{transaction:()=>{setTimeout(()=>transaction.oncomplete(),0);return transaction;},close:()=>{}},onsuccess:()=>{}};
   queueMicrotask(()=>request.onsuccess());return request;
 });
 vi.stubGlobal('indexedDB',{open});
 startQueue('synthetic');
 await vi.waitFor(()=>expect(getQueueStatus().storageError).toBe('read'));
 await flush('synthetic');
 expect(getQueueStatus().storageError).toBeNull();
 expect(getQueueStatus().count).toBe(0);
 expect(fetch).not.toHaveBeenCalled();
});
