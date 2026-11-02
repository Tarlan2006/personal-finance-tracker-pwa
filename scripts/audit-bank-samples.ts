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
if bank=='freedom':
 import pdfplumber
 raw=[]; anchors=0
 with pdfplumber.open(sys.argv[1]) as document:
  for pn,page in enumerate(document.pages,1):
   words=page.extract_words()
   dates=[w for w in words if w['x0']<132 and re.fullmatch(r'\d{2}\.\d{2}\.\d{4}',w['text'])]
   if not dates: continue
   anchors+=len(dates)
   header=next((w for w in words if w['text']=='Детали' and abs(w['x0']-451.76)<2),None)
   minimum=header['bottom']+1 if header else 52
   edges=sorted(e['top'] for e in page.edges if e.get('orientation')=='h' and abs(e['x0']-56.7)<1.5 and abs(e['x1']-131.5)<1.5 and minimum<e['top']<page.height-98)
   groups=[]
   for y in edges:
    if groups and abs(y-sum(groups[-1])/len(groups[-1]))<1.1: groups[-1].append(y)
    else: groups.append([y])
   ys=[sum(g)/len(g) for g in groups]; page_rows=[]
   for top,bottom in zip(ys,ys[1:]):
    if bottom-top<12:continue
    selected=sorted([w for w in words if top<(w['top']+w['bottom'])/2<bottom and 56<=w['x0']<556],key=lambda w:(w['top'],w['x0']))
    if not selected:continue
    cells=[[],[],[],[],[]]
    for w in selected:
     index=next(i for i,x in enumerate([131.5,256.2,306,380.8,556]) if w['x0']<x)
     cells[index].append(w['text'])
    page_rows.append({'cells':[' '.join(c) for c in cells],'page':pn})
   for i,r in enumerate(page_rows):r['first']=i==0;r['last']=i==len(page_rows)-1
   raw.extend(page_rows)
 prefix=None; total=0; rejected={}
 for r in raw:
  date,money,currency,kind,details=r['cells']
  if not date and not money and not currency and not kind and details:
   if not r['last'] or prefix: raise ValueError('ambiguous reference fragment')
   prefix=r;continue
  if prefix:
   if not r['first'] or r['page']!=prefix['page']+1: raise ValueError('reference continuation')
   details=prefix['cells'][4]+' '+details;prefix=None
  total+=1
  reason='currency' if currency!='KZT' else 'pending' if re.search(r'сумма в (?:обработке|блокировке)|ожидает|отклонен|не завершен',kind,re.I) else 'own' if re.search(r'перевод между своими (?:счетами|картами)',kind+' '+details,re.I) else None
  if reason:rejected[reason]=rejected.get(reason,0)+1;continue
  value=int(Decimal(money.replace('₸','').replace(',','').replace(' ','').replace('\xa0','').replace('−','-'))*100)
  d,mo,y=date.split('.');rows.append([f'{y}-{mo}-{d}',value])
 if prefix or total!=anchors: raise ValueError('incomplete reference rows')
 print(json.dumps({'bank':bank,'rows':rows,'total':total,'rejectedCounts':rejected}));sys.exit(0)
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
const root=process.argv[2]??'files_for_train';
const collect=(directory:string):string[]=>readdirSync(directory,{withFileTypes:true}).flatMap(f=>f.isDirectory()?collect(join(directory,f.name)):/\.pdf$/i.test(f.name)?[join(directory,f.name)]:[]);
const files=collect(root);
for (const [index, file] of files.entries()) {
  try {
    const path = file;
    const child = spawnSync(process.env.AUDIT_PYTHON ?? 'python', ['-c', reference, path], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (child.status !== 0) throw new Error('reference unavailable');
    const ref = JSON.parse(child.stdout) as {bank:string;rows:Array<[string,number]>;total?:number;rejectedCounts?:Record<string,number>};
    if (!['kaspi','halyk','freedom'].includes(ref.bank)) { console.log(JSON.stringify({sample:index+1,bank:ref.bank,supported:false})); continue; }
    const csv = await bankPdf(readFileSync(path).toString('base64'),ref.bank);
    const {parsed} = parseRows(csv,{bank:ref.bank,delimiter:';',dateCol:0,counterpartyCol:2,noteCol:3,rejectionCol:6,
      ...(ref.bank==='halyk'?{creditCol:4,debitCol:5}:{amountCol:1})});
    const actual = parsed.filter(r=>r.payload).map(r=>[new Date(r.occurredAt!+5*3600000).toISOString().slice(0,10),r.payload!.amountMinor*(r.payload!.direction==='in'?1:-1)]);
    const expectedKeys=ref.rows.map(r=>JSON.stringify(r)).sort(),actualKeys=actual.map(r=>JSON.stringify(r)).sort();
    const matches=JSON.stringify(expectedKeys)===JSON.stringify(actualKeys) && (ref.total===undefined||ref.total===parsed.length);
    if (!matches) failures++;
    console.log(JSON.stringify({sample:index+1,bank:ref.bank,supported:true,referenceOperations:ref.rows.length,parsedOperations:actual.length,dateAmountDirectionMatch:matches,referenceTotal:ref.total,referenceRejected:ref.rejectedCounts,rejectedTextLines:parsed.filter(r=>r.reject).length}));
  } catch { failures++; console.log(JSON.stringify({sample:index+1,error:'Локальная проверка не выполнена; проверьте AUDIT_PYTHON и pypdf. Содержимое не выводится.'})); }
}
if (!files.length) throw new Error('Нет локальных PDF-образцов');
process.exitCode=failures?1:0;
