/** Optional enhancement: restricted Safari sessions must still start online. */
export async function registerServiceWorker():Promise<void>{
  try {
    if(location.protocol==='https:'&&'serviceWorker' in navigator){
      await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
    }
  } catch {}
}
