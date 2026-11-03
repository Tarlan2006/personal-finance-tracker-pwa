import {it,expect,vi,afterEach} from 'vitest';
import {registerServiceWorker} from '../src/service-worker';
afterEach(()=>vi.unstubAllGlobals());
for(const mode of ['missing','getter','sync','async','ok'])it(`SW registration: ${mode} does not block startup`,async()=>{
 const register=vi.fn(()=>{if(mode==='sync')throw new Error('denied');return mode==='async'?Promise.reject(new Error('denied')):Promise.resolve({});});
 const nav={};if(mode!=='missing')Object.defineProperty(nav,'serviceWorker',{get(){if(mode==='getter')throw new Error('denied');return{register};}});
 vi.stubGlobal('navigator',nav);vi.stubGlobal('location',{protocol:'https:'});await expect(registerServiceWorker()).resolves.toBeUndefined();
 if(mode==='ok')expect(register).toHaveBeenCalledWith('/sw.js',{updateViaCache:'none'});
});
