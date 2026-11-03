import {useRef,useState,useSyncExternalStore} from 'react';
import {api,ApiError} from './api';
import {bump,Sheet,useAppState} from './ui';
import {getQueueStatus,subscribeQueue,withEmptyQueue} from './queue';
import {ImportReportView} from './import-report';
type Batch={id:string;filename:string;source:string;created_at:number;imported:number;duplicates:number;rejected:number;service:number;activeOperations:number};
export function HistoryPanel({onOpen,onChanged,disabled=false}:{onOpen?:(r:any)=>void;onChanged?:()=>void;disabled?:boolean}={}){
 const {login,activeImports}=useAppState();const queue=useSyncExternalStore(subscribeQueue,getQueueStatus);disabled=disabled||activeImports>0;
 const [batches,setBatches]=useState<Batch[]|null>(null),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[report,setReport]=useState<any>(null);
 const [dialog,setDialog]=useState<{kind:'document';batch:Batch}|{kind:'all';summary:any}|null>(null),[typed,setTyped]=useState('');const running=useRef(false);
 async function load(more=false){const r=await api('GET','/api/import/batches'+(more&&next?'?before='+encodeURIComponent(next):''));setBatches(old=>more?[...(old??[]),...r.batches]:r.batches);setNext(r.next);}
 async function act(work:()=>Promise<void>){if(running.current||disabled)return;running.current=true;setBusy(true);setError('');setMessage('');try{await work();}catch(e){setError((e as Error).message+(e instanceof ApiError&&e.network?' — результат мог сохраниться. Обновите историю или повторите действие.':''));}finally{running.current=false;setBusy(false);}}
 async function remove(){if(!dialog)return;const target=dialog;await act(async()=>{
  if(target.kind==='all'){
   if(typed!=='УДАЛИТЬ'||!login)return;
   await withEmptyQueue(login,()=>api('POST','/api/history/clear',{confirmation:'DELETE_ALL_HISTORY',accountLogin:login}));
   setMessage('История операций и загрузок очищена');
  }else{const r=await api('DELETE','/api/import/batches/'+target.batch.id,{confirmation:'DELETE_DOCUMENT',accountLogin:login});setMessage(`Документ удалён. Удалено операций: ${r.removed}`);}
  setDialog(null);setReport(null);onChanged?.();bump();await load();
 });}
 return <section aria-label="История загрузок">
  {activeImports>0&&<p className="sub">Дождитесь окончания загрузки выписки перед удалением истории.</p>}
  <button className="btn sec" disabled={busy||disabled} style={{margin:'20px 0'}} onClick={()=>act(()=>load())}>История импортов</button>
  {message&&<p role="status">{message}</p>}{error&&!dialog&&<div className="err" role="alert">{error}</div>}
  {batches&&<div className="group" role="group" aria-label="Сохранённые импорты">{batches.map(b=><article key={b.id} style={{borderBottom:'1px solid var(--sep)',paddingBottom:12}}>
   <button className="row" disabled={busy||disabled} onClick={()=>act(async()=>{const r=await api('GET','/api/import/batches/'+b.id);const value={...r,dryRun:false,saved:true,batchId:r.id,newCounterparties:[]};if(onOpen)onOpen(value);else setReport(value);})}><div className="grow"><div style={{overflowWrap:'anywhere'}}>{b.filename}</div><div className="sub">{b.source==='generic'?'CSV':b.source} · {new Date(b.created_at).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})}</div><div className="sub">Добавлено {b.imported} · повторы {b.duplicates} · отклонено {b.rejected} · служебных {b.service}</div><div className="sub">Операций сейчас: {b.activeOperations}</div></div></button>
   <button className="text-action" disabled={busy||disabled} style={{color:'var(--red)',marginLeft:8}} onClick={()=>{setError('');setDialog({kind:'document',batch:b});}}>Удалить документ</button>
  </article>)}{!batches.length&&<div className="row muted">Сохранённых импортов нет</div>}</div>}
  {next&&<button className="btn sec" disabled={busy||disabled} onClick={()=>act(()=>load(true))}>Показать ещё загрузки</button>}
  {report&&<ImportReportView report={report}/>}
  <button className="btn sec" disabled={busy||disabled} style={{color:'var(--red)',margin:'20px 0'}} onClick={()=>act(async()=>{const summary=await api('GET','/api/history/summary');setTyped('');setDialog({kind:'all',summary});})}>Очистить всю историю</button>
  {dialog&&<Sheet title={dialog.kind==='document'?'Удалить документ?':'Очистить всю историю?'} onClose={()=>{if(!running.current){setDialog(null);setError('');}}}>
   <p className="sub">Аккаунт: {login}</p>
   {dialog.kind==='document'?<><p style={{overflowWrap:'anywhere'}}>{dialog.batch.filename}</p><p>Откатим операции, добавленные этой загрузкой, включая изменённые вручную. Отчёт и имя файла удалятся. Операции других загрузок и ручные записи сохранятся.</p><p>Активных операций: {dialog.batch.activeOperations}. Строки-повторы не удаляют операции других документов. Получатели без оставшихся операций также очищаются.</p></>:<><p>Удалятся все операции, история загрузок, получатели и их привязки к категориям. Операций: {dialog.summary.operations}; документов: {dialog.summary.documents}.</p><p>Аккаунт, банковские счета и начальные остатки, категории и автоматические правила сохранятся.</p><label>Для подтверждения введите УДАЛИТЬ<input aria-label="Введите УДАЛИТЬ" value={typed} disabled={busy||disabled} onChange={e=>setTyped(e.target.value)}/></label>{queue.count>0&&<div className="err">Сначала отправьте {queue.count} операций из очереди. Очистка пока недоступна.</div>}</>}
   <p className="sub">Вернуть удалённую историю этой кнопкой нельзя. Выписку можно загрузить заново. Оригинальный файл на вашем устройстве не удаляется.</p>
   {dialog.kind==='all'&&<p className="sub">Перед очисткой завершите загрузки и отправку очереди на других устройствах: новые отправки после очистки снова появятся в истории.</p>}
   {!queue.online&&<div className="err">Для удаления нужно подключение к интернету.</div>}{error&&<div className="err" role="alert">{error}</div>}
   <div style={{display:'flex',gap:8,marginTop:16}}><button className="btn sec" disabled={busy||disabled} onClick={()=>{setDialog(null);setError('');}}>Отмена</button><button className="btn" style={{background:'var(--red)'}} disabled={busy||!queue.online||(dialog.kind==='all'&&(typed!=='УДАЛИТЬ'||queue.count>0))} onClick={remove}>{busy?'Удаляем…':dialog.kind==='document'?'Удалить документ и операции':'Удалить всю историю'}</button></div>
  </Sheet>}
 </section>;
}
