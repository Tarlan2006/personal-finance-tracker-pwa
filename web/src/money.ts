export const normName = (s:string) => s.toLowerCase().replace(/ё/g,'е').replace(/["'«»“”`]/g,'').replace(/\s+/g,' ').trim();
export const inputMinor = (s:string):number|null => {
  const m=/^(\d+)(?:[.,](\d{1,2}))?$/.exec(s.replace(/\s/g,'')); if(!m)return null;
  const n=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0')); return Number.isSafeInteger(n)?n:null;
};

export const ledgerDate = (ms:number) => new Date(ms + 5 * 3600_000).toISOString().slice(0,10);
const ledgerDay = new Intl.DateTimeFormat('ru-RU', {weekday:'short', day:'numeric', month:'long', year:'numeric', timeZone:'Etc/GMT-5'});
export const ledgerDayLabel = (ms:number) => ledgerDay.format(ms);

// Largest remainder allocation; BigInt preserves ordering even for totals near MAX_SAFE_INTEGER.
export function categoryPercentages(amounts:number[]) {
  const total = amounts.reduce((sum,n)=>sum+BigInt(n),0n);
  if (total===0n) return amounts.map(()=>0);
  const scaled = amounts.map(amount=>BigInt(amount)*100n);
  const shares = scaled.map(value=>Number(value/total));
  const order = scaled.map((value,index)=>({index,rest:value%total}))
    .sort((a,b)=>a.rest===b.rest?a.index-b.index:a.rest>b.rest?-1:1);
  const remaining = 100-shares.reduce((sum,n)=>sum+n,0);
  for(const {index} of order.slice(0,remaining)) shares[index]++;
  return shares;
}
