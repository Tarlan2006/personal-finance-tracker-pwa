import { getResolvedPDFJS, type getDocumentProxy } from 'unpdf';
import { HttpError } from '../../env';
import { MAX_IMPORT_ROWS } from './import-limits';

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof getDocumentProxy>>['getPage']>>;
type Item = {str:string;transform:number[]};
export interface FreedomRow {cells:string[];page:number;first:boolean;last:boolean}
type Matrix = [number,number,number,number,number,number];
const multiply=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m:Matrix,x:number,y:number)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];

/** Row borders, not nearest dates: Freedom vertically centres multi-line cells. */
export async function freedomRows(page:Page, items:Item[], remaining:number, continuation=false):Promise<FreedomRow[]> {
  const headers=[['Дата',83.25],['Сумма',222.68],['Валюта',264.41],['Операция',321.41],['Детали',451.76]] as const;
  const header=items.find(t=>t.str.trim()==='Детали'&&Math.abs(t.transform[4]-451.76)<2);
  if((!header&&!continuation)||(header&&headers.some(([label,x])=>!items.some(t=>t.str.trim()===label&&Math.abs(t.transform[4]-x)<2&&Math.abs(t.transform[5]-header.transform[5])<2)))||Math.abs(page.getViewport({scale:1}).width-612)>1)
    throw new HttpError(400,'unknown_layout','Неизвестный макет таблицы Freedom PDF');
  const tableTop=header?header.transform[5]-3:page.getViewport({scale:1}).height-52;
  const {OPS}=await getResolvedPDFJS(), list=await page.getOperatorList();
  if(list.fnArray.length>50000)throw new HttpError(413,'pdf_too_complex','Слишком сложная страница PDF');
  let matrix:Matrix=[1,0,0,1,0,0];const stack:Matrix[]=[],borders:number[]=[];
  const edge=(x:number,y:number,xx:number,yy:number)=>{
    const a=point(matrix,x,y),b=point(matrix,xx,yy);
    if(Math.abs(a[1]-b[1])<.15&&Math.abs(Math.min(a[0],b[0])-56.7)<1.5&&Math.abs(Math.max(a[0],b[0])-131.5)<1.5) borders.push((a[1]+b[1])/2);
  };
  for(let i=0;i<list.fnArray.length;i++){
    const op=list.fnArray[i],args=list.argsArray[i];
    if(op===OPS.save){stack.push([...matrix]);continue;}
    if(op===OPS.restore){matrix=stack.pop()??[1,0,0,1,0,0];continue;}
    if(op===OPS.transform){matrix=multiply(matrix,args as Matrix);continue;}
    if(op!==OPS.constructPath)continue;
    // PDF.js 6 path commands: move=0, line=1, cubic=2, quadratic=3, close=4.
    const paths=typeof args?.[1]?.[0]==='number'?[args[1]]:args?.[1]??[];
    for(const path of paths){
      if(!path)continue;
      let x=0,y=0,sx=0,sy=0;
      for(let j=0;j<path.length;){
        const command=path[j++];
        if(command===0){x=path[j++];y=path[j++];sx=x;sy=y;}
        else if(command===1){const xx=path[j++],yy=path[j++];edge(x,y,xx,yy);x=xx;y=yy;}
        else if(command===2){j+=4;x=path[j++];y=path[j++];}
        else if(command===3){j+=2;x=path[j++];y=path[j++];}
        else if(command===4){edge(x,y,sx,sy);x=sx;y=sy;}
        else throw new HttpError(400,'unknown_layout','Не распознаны границы строк Freedom');
      }
    }
  }
  const clusters:Array<{sum:number;n:number}>=[];
  for(const y of borders.filter(y=>y<tableTop&&y>98).sort((a,b)=>b-a)){
    const last=clusters[clusters.length-1];if(last&&Math.abs(y-last.sum/last.n)<1.1){last.sum+=y;last.n++;}else clusters.push({sum:y,n:1});
  }
  const bounds=clusters.map(c=>c.sum/c.n),rows:FreedomRow[]=[];let matchedDates=0;
  const anchors=items.filter(t=>t.transform[4]>=56&&t.transform[4]<132&&t.transform[5]<tableTop&&t.transform[5]>99&&/^\d{2}\.\d{2}\.\d{4}$/.test(t.str.trim()));
  for(let i=0;i<bounds.length-1;i++){
    const upper=bounds[i],lower=bounds[i+1];if(upper-lower<12)continue;
    const inRow=items.filter(t=>t.str.trim()&&t.transform[4]>=56&&t.transform[4]<556&&t.transform[5]<upper&&t.transform[5]>lower).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4]);
    if(!inRow.length)continue;
    if(rows.length>=remaining)throw new HttpError(413,'too_many_rows',`Не больше ${MAX_IMPORT_ROWS} строк за раз`);
    const cells:string[][]=[[],[],[],[],[]];
    for(const t of inRow){const x=t.transform[4];const c=[131.5,256.2,306,380.8,556].findIndex(b=>x<b);if(c>=0)cells[c].push(t.str);}
    const [date,amount,currency,operation,details]=cells.map(c=>c.join(' ').replace(/\s+/g,' ').trim());
    const dates=anchors.filter(t=>t.transform[5]<upper&&t.transform[5]>lower);
    if(dates.length>1)throw new HttpError(400,'unknown_layout','Неоднозначная строка Freedom');matchedDates+=dates.length;
    rows.push({cells:[date,amount,currency,operation,details],page:page.pageNumber,first:false,last:false});
  }
  if(!anchors.length||matchedDates!==anchors.length)throw new HttpError(400,'unknown_layout','Не удалось однозначно связать все операции Freedom с границами строк');
  rows.forEach((row,i)=>{row.first=i===0;row.last=i===rows.length-1;});
  return rows;
}


/** A description-only last cell is the top fragment of the next page's first row. */
export function finishFreedomRows(raw:FreedomRow[]):string[][] {
  const rows:string[][]=[];let prefix:FreedomRow|null=null;
  for(const row of raw){
    let [date,amount,currency,operation,details]=row.cells;
    if(!date&&!amount&&!currency&&!operation&&details){
      if(!row.last||prefix)throw new HttpError(400,'unknown_layout','Неоднозначное продолжение Freedom');
      prefix=row;continue;
    }
    if(prefix){
      if(!row.first||row.page!==prefix.page+1||!/^\d{2}\.\d{2}\.\d{4}$/.test(date))throw new HttpError(400,'unknown_layout','Не найдено продолжение операции Freedom');
      details=prefix.cells[4]+' '+details;prefix=null;
    }
    const rejected=currency!=='KZT'?'валюта операции не KZT':/сумма в (?:блокировке|обработке)|ожидает|отклонен|не завершен/i.test(operation)?'операция не завершена (блокировка или ожидание)':/перевод между своими (?:счетами|картами)/i.test(operation+' '+details)?'перевод между своими счетами':'';
    const labelled=details.match(/(?:Отправитель|Получатель):\s*(.+)$/iu)?.[1];
    const instant=details.match(/^(.+?)\.?\s+Мгновенный перевод\.?$/iu)?.[1];
    const contract=details.match(/^(.*?)\.\s*По договору\s*№/iu)?.[1];
    let counterparty=(labelled??instant??contract??details).replace(/[.;]\s*$/,'').trim();
    // Preserve unparsed descriptions in note; never shorten a name into a guess.
    if(counterparty.length>120)counterparty='';
    rows.push([date,amount,counterparty,[operation,details].filter(Boolean).join(': '),'','',rejected]);
    if(rows.length>MAX_IMPORT_ROWS)throw new HttpError(413,'too_many_rows',`Не больше ${MAX_IMPORT_ROWS} строк за раз`);
  }
  if(prefix)throw new HttpError(400,'unknown_layout','Выписка Freedom обрывается внутри операции');
  return rows;
}
