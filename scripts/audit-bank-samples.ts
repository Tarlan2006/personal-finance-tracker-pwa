import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { bankPdf } from '../worker/src/domain/money/bank-pdf';
import { parseRows } from '../worker/src/domain/money/import';

// Sensitive text is passed only between local processes in memory. Never print it.
const reference = String.raw`
import json,re,sys
from decimal import Decimal
from pypdf import PdfReader
texts=[p.extract_text(extraction_mode='layout') for p in PdfReader(sys.argv[1]).pages]
alltext='\n'.join(texts).lower()
bank=next((b for b in ['kaspi','halyk','freedom'] if b in alltext),'unknown')
def amount(s): return int(Decimal(s.replace(' ','').replace('\xa0','').replace(',','.'))*100)
rows=[]
for text in texts:
 for line in text.splitlines():
  m=re.match(r'^\s*(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))\s+',line)
  if not m: continue
  if bank=='kaspi':
   a=re.match(r'\s*([+-]\s*[\d \xa0]+,\d{2})\s*₸',line[m.end():])
   if not a: continue
   v=amount(a[1])
  elif bank=='halyk':
   rest=line[m.end():]
   if not re.match(r'\d{2}\.\d{2}\.\d{4}',rest): continue
   currency=re.search(r'\bKZT\b',rest)
   if not currency: continue
   vals=re.findall(r'[+-]?[\d\xa0]+,\d{2}',rest[currency.end():])
   if len(vals)<3: raise ValueError('reference columns')
   credit,debit=amount(vals[0]),amount(vals[1])
   if bool(credit)==bool(debit): raise ValueError('reference direction')
   v=abs(credit) if credit else -abs(debit)
  else: continue
  d,mo,y=m[1].split('.'); y=str(2000+int(y)) if len(y)==2 else y
  rows.append([f'{y}-{mo}-{d}',v])
print(json.dumps({'bank':bank,'rows':rows}))
`;
let failures = 0;
const files = readdirSync('files_for_train').filter(f => /\.pdf$/i.test(f));
for (const [index, file] of files.entries()) {
  try {
    const path = join('files_for_train', file);
    const child = spawnSync(process.env.AUDIT_PYTHON ?? 'python', ['-c', reference, path], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (child.status !== 0) throw new Error('reference unavailable');
    const ref = JSON.parse(child.stdout) as {bank:string;rows:Array<[string,number]>};
    if (!['kaspi','halyk'].includes(ref.bank)) { console.log(JSON.stringify({sample:index+1,bank:ref.bank,supported:false})); continue; }
    const csv = await bankPdf(readFileSync(path).toString('base64'),ref.bank);
    const {parsed} = parseRows(csv,{bank:ref.bank,delimiter:';',dateCol:0,counterpartyCol:2,noteCol:3,rejectionCol:6,
      ...(ref.bank==='halyk'?{creditCol:4,debitCol:5}:{amountCol:1})});
    const actual = parsed.filter(r=>r.payload).map(r=>[new Date(r.occurredAt!+5*3600000).toISOString().slice(0,10),r.payload!.amountMinor*(r.payload!.direction==='in'?1:-1)]);
    const expectedKeys=ref.rows.map(r=>JSON.stringify(r)).sort(),actualKeys=actual.map(r=>JSON.stringify(r)).sort();
    const matches=JSON.stringify(expectedKeys)===JSON.stringify(actualKeys);
    if (!matches) failures++;
    console.log(JSON.stringify({sample:index+1,bank:ref.bank,supported:true,referenceOperations:ref.rows.length,parsedOperations:actual.length,dateAmountDirectionMatch:matches,rejectedTextLines:parsed.filter(r=>r.reject).length}));
  } catch { failures++; console.log(JSON.stringify({sample:index+1,error:'Локальная проверка не выполнена; проверьте AUDIT_PYTHON и pypdf. Содержимое не выводится.'})); }
}
if (!files.length) throw new Error('Нет локальных PDF-образцов');
process.exitCode=failures?1:0;
