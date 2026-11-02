export const normName = (s:string) => s.toLowerCase().replace(/ё/g,'е').replace(/["'«»“”`]/g,'').replace(/\s+/g,' ').trim();
export const inputMinor = (s:string):number|null => {
  const m=/^(\d+)(?:[.,](\d{1,2}))?$/.exec(s.replace(/\s/g,'')); if(!m)return null;
  const n=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0')); return Number.isSafeInteger(n)?n:null;
};
