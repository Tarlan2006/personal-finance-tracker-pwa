import {useEffect,useState} from 'react';
import type {ImportRow} from '../../shared/import-report';
interface Report {total:number;imported:number;duplicates:number;rejected:number;service:number;rows:ImportRow[];dryRun?:boolean;saved?:boolean;newCounterparties?:string[]}
export function ImportReportView({report:r,onViewFeed}:{report:Report;onViewFeed?:()=>void}){
 const [visible,setVisible]=useState(100),[visibleService,setVisibleService]=useState(100),[showService,setShowService]=useState(false);
 useEffect(()=>{setVisible(100);setVisibleService(100);setShowService(false);},[r]);
 const rejected=r.rows.filter(x=>x.status==='rejected'),duplicates=r.rows.filter(x=>x.status==='duplicate'),service=r.rows.filter(x=>x.status==='service');
 return <section aria-label="Отчёт импорта">
  <h2>{r.dryRun?'Проверка (ничего не записано)':r.saved?'Сохранённый отчёт':'Готово'}</h2>
  <div className="group" data-testid="import-report">{[['Всего строк',r.total],[r.dryRun?'Будет добавлено':'Добавлено',r.imported],['Уже были (повторы)',r.duplicates],['Отклонено',r.rejected],['Служебные строки',r.service]].map(([label,value])=><div className="row" key={label}><span className="grow">{label}</span><b>{value}</b></div>)}</div>
  {rejected.length>0&&<section aria-label="Отклонённые операции"><h2>Отклонённые операции ({r.rejected})</h2>{rejected.slice(0,visible).map(row=><div className="banner" data-testid="import-row-result" key={row.line}>Строка {row.line}: {row.reason}<div className="sub" style={{overflowWrap:'anywhere'}}>{row.preview}</div></div>)}</section>}
  {duplicates.length>0&&<section aria-label="Повторы"><h2>Повторы ({r.duplicates})</h2>{duplicates.slice(0,visible).map(row=><div className="banner" data-testid="import-row-result" key={row.line}>Строка {row.line}: повтор<div className="sub" style={{overflowWrap:'anywhere'}}>{row.preview}</div></div>)}</section>}
  {(rejected.length>visible||duplicates.length>visible)&&<button className="btn sec" onClick={()=>setVisible(n=>n+100)}>Показать ещё строки отчёта</button>}
  {service.length>0&&<section aria-label="Служебные строки" className="group" style={{padding:16,margin:'16px 0'}}>
    <button className="text-action" aria-expanded={showService} onClick={()=>setShowService(v=>!v)}>{showService?'Скрыть':'Показать'} служебные строки ({r.service})</button>
    <p className="sub">Это не отклонённые операции: здесь примечания банка, реквизиты, пустые строки и переносы текста. Продолжения описаний сохранены вместе с операциями.</p>
    {showService&&<>{service.slice(0,visibleService).map(row=><div className="row" data-testid="service-row-result" key={row.line}><div><div>Строка {row.line}: {row.reason}</div><div className="sub" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{row.text??row.preview}</div></div></div>)}{service.length>visibleService&&<button className="btn sec" onClick={()=>setVisibleService(n=>n+100)}>Показать ещё служебные строки</button>}</>}
  </section>}
  {!r.dryRun&&onViewFeed&&<button className="btn sec" style={{marginBottom:16}} onClick={onViewFeed}>Посмотреть в Ленте</button>}
  {!r.dryRun&&!!r.newCounterparties?.length&&<div className="banner">Новых получателей без категории: {r.newCounterparties.length}. Назначьте категории в «Отчётах».</div>}
 </section>;
}
